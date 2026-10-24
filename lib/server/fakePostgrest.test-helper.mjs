// An in-memory PostgREST (+ the few Supabase auth calls the handlers make) for the growth-reward tests.
// It honours what the reward code relies on, so the tests exercise the real contracts:
//   filters eq / is.null / is.not.null / gte / lte / in.(…) · select (ignored: full rows) · order · limit
//   POST: unique keys per table, `on_conflict` + `resolution=ignore-duplicates` (skips, returns []),
//         otherwise 409 23505 · `return=representation` → the inserted rows
//   PATCH / DELETE with the same filters; PATCH + return=representation → the updated rows ([] = none)
//   a table in `missing` → 404 PGRST205 (the shape PostgREST gives before a migration)
//   the growth_rewards cap trigger (migration 20261024160000), emulated with the same numbers
// Named *.test-helper.mjs: not a test itself (the "**/*.test.mjs" glob skips it) and excluded from
// code scanning with the other test files.
import { randomUUID } from 'node:crypto';
import { pacificMonth } from '../time/pacific.js';
import { REPORT_REWARD_MONTHLY_CAP_DAYS, REFERRAL_MAX_REWARDED } from './creditRules.js';

const UNIQUE = {
  ai_credits: [['user_id']],
  referral_codes: [['user_id'], ['code']],
  referrals: [['invitee_id']],
  growth_rewards: [['kind', 'ref_id']],
};

function matches(row, params) {
  for (const [k, v] of params) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict'].includes(k)) continue;
    const cell = row[k] === undefined ? null : row[k];
    const [op, ...rest] = v.split('.');
    const val = rest.join('.');
    if (op === 'eq') { if (cell == null || String(cell) !== val) return false; }
    else if (op === 'is') { if (val === 'null' ? cell != null : val === 'not.null' ? cell == null : false) return false; }
    else if (op === 'not' && val === 'is.null') { if (cell == null) return false; }
    else if (op === 'gte') { if (cell == null || String(cell) < val) return false; }
    else if (op === 'lte') { if (cell == null || String(cell) > val) return false; }
    else if (op === 'in') { const set = val.replace(/^\(|\)$/g, '').split(','); if (!set.includes(String(cell))) return false; }
  }
  return true;
}

/**
 * @param {{ tables?: Record<string, object[]>, missing?: string[], authUsers?: Record<string, object>,
 *   now?: () => number, failPatch?: (table: string, url: URL) => boolean,
 *   onPatch?: (table: string, url: URL, t: object) => void }} [opts]
 */
export function installFakePostgrest({ tables = {}, missing = [], authUsers = {}, now = () => Date.now(), failPatch, onPatch } = {}) {
  const t = structuredClone(tables);
  const gone = new Set(missing);
  const log = [];
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  globalThis.fetch = async (url, opts = {}) => {
    const u = new URL(String(url));
    const m = (opts.method || 'GET').toUpperCase();
    log.push(`${m} ${u.pathname}${u.search}`);
    if (u.pathname.startsWith('/auth/v1/admin/users/')) {
      const id = decodeURIComponent(u.pathname.split('/').pop());
      return authUsers[id] ? json(authUsers[id]) : json({ msg: 'User not found' }, 404);
    }
    if (u.pathname.startsWith('/auth/v1/')) return json({ id: 'x' });
    if (u.pathname.startsWith('/rest/v1/rpc/')) return json(1);
    if (!u.pathname.startsWith('/rest/v1/')) return json({}, 404);
    const name = u.pathname.slice('/rest/v1/'.length);
    if (gone.has(name)) return json({ code: 'PGRST205', message: `Could not find the table 'public.${name}' in the schema cache` }, 404);
    const rows = t[name] || (t[name] = []);
    const params = [...u.searchParams.entries()];
    const prefer = String((opts.headers && (opts.headers.Prefer || opts.headers.prefer)) || '');
    const wantRows = /return=representation/.test(prefer);

    if (m === 'GET') {
      let out = rows.filter((r) => matches(r, params));
      const order = u.searchParams.get('order');
      if (order) { const [col, dir] = order.split('.'); out = [...out].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (dir === 'desc' ? -1 : 1)); }
      const limit = Number(u.searchParams.get('limit'));
      if (limit) out = out.slice(0, limit);
      return json(out);
    }
    if (m === 'POST') {
      const body = JSON.parse(opts.body || 'null');
      const items = Array.isArray(body) ? body : [body];
      const ignore = /ignore-duplicates/.test(prefer);
      const inserted = [];
      for (const raw of items) {
        const row = { ...raw };
        // Tables keyed by user (ai_credits, referral_codes) or invitee (referrals) have no `id`.
        if (!['ai_credits', 'referral_codes', 'referrals', 'credit_transactions'].includes(name)) row.id = row.id || randomUUID();
        if (!row.created_at && name !== 'referrals') row.created_at = new Date(now()).toISOString();
        if (name === 'referrals' && !row.claimed_at) row.claimed_at = new Date(now()).toISOString();
        const clash = (UNIQUE[name] || []).some((cols) => rows.some((r) => cols.every((c) => r[c] != null && String(r[c]) === String(row[c]))));
        // The cap trigger runs BEFORE the conflict check, as in Postgres.
        if (name === 'growth_rewards') {
          row.pacific_month = pacificMonth(new Date(now()));
          if (row.kind === 'report') {
            const used = rows.filter((r) => r.user_id === row.user_id && r.kind === 'report' && r.pacific_month === row.pacific_month).reduce((s, r) => s + r.days, 0);
            if (used + row.days > REPORT_REWARD_MONTHLY_CAP_DAYS) return json({ code: 'P0001', message: 'growth_reward_cap: monthly report reward cap reached' }, 400);
          }
          if (row.kind === 'referral_referrer' && rows.filter((r) => r.user_id === row.user_id && r.kind === 'referral_referrer').length >= REFERRAL_MAX_REWARDED) {
            return json({ code: 'P0001', message: 'growth_reward_cap: referral reward cap reached' }, 400);
          }
        }
        if (clash) {
          if (ignore) continue;
          return json({ code: '23505', message: 'duplicate key value violates unique constraint' }, 409);
        }
        rows.push(row);
        inserted.push(row);
      }
      return wantRows ? json(inserted, 201) : new Response(null, { status: 201 });
    }
    if (m === 'PATCH') {
      if (failPatch && failPatch(name, u)) return json({ message: 'boom' }, 500);
      if (onPatch) onPatch(name, u, t);
      const body = JSON.parse(opts.body || '{}');
      const hit = rows.filter((r) => matches(r, params));
      for (const r of hit) Object.assign(r, body);
      return wantRows ? json(hit) : new Response(null, { status: 204 });
    }
    if (m === 'DELETE') {
      const hit = rows.filter((r) => matches(r, params));
      t[name] = rows.filter((r) => !hit.includes(r));
      return wantRows ? json(hit) : new Response(null, { status: 204 });
    }
    return json({}, 405);
  };
  return { t, log };
}

/** A PostgREST fetcher in the shape the server modules take (same as api/user-sync.js's `db`). */
export const fakeDb = (base = 'https://db.test') => (path, opts = {}) => fetch(`${base}/rest/v1/${path}`, {
  ...opts,
  headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
});

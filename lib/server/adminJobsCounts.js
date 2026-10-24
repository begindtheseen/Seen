// The admin dashboard's seven jobs-table counts in ONE database pass.
//
// Before: every GET /api/admin-stats fired seven `Prefer: count=exact` requests against `jobs` at
// once (total, active, added today, stale+expired, clearable, kept, overdue) — seven full scans of an
// 80k-row table on seven connections, every time the admin page or Seen Command's Home tab polled
// (every 30–60 s while open). pg_stat_statements on production (2026-10-24) showed those counts as the
// top statements by total time, each hitting the 8 s statement_timeout at its worst, and every
// company-page read queued behind them. One SQL function (migration 20261024120000_admin_jobs_counts.sql)
// answers all seven from a single scan on a single connection.
//
// Deploy order is safe: before the migration is applied the RPC 404s and this falls back to the exact
// counts the dashboard made before, so the numbers are identical either way (never estimated).

export const RPC_NAME = 'admin_jobs_counts';
export const FIELDS = ['total', 'active', 'added_today', 'stale_or_expired', 'stale_clearable', 'expired_kept', 'stale_overdue'];

// Same PostgREST filters the dashboard used, kept here so the fallback and the SQL stay in step
// (lib/server/staleSweep.js STALE_CLEARABLE_FILTER / STALE_KEPT_FILTER).
export function fallbackPaths({ todayISO, overdueISO }) {
  const overdue = encodeURIComponent(overdueISO);
  return {
    total:            'jobs?select=id',
    active:           'jobs?availability_status=eq.active&select=id',
    added_today:      `jobs?created_at=gte.${todayISO}&select=id`,
    stale_or_expired: 'jobs?availability_status=in.(stale,expired)&select=id',
    stale_clearable:  'jobs?availability_status=eq.stale&is_employer_posted=eq.false&select=id',
    expired_kept:     'jobs?availability_status=eq.expired&is_employer_posted=eq.false&select=id',
    stale_overdue:    `jobs?availability_status=eq.stale&is_employer_posted=eq.false&last_seen_at=lt.${overdue}&select=id`,
  };
}

const COUNT_HDR = { Prefer: 'count=exact', 'Range-Unit': 'items', Range: '0-0' };
const toInt = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Math.trunc(Number(v))) : null);
const fromContentRange = (res) => {
  if (!res || !res.ok) return null;
  const cr = res.headers?.get?.('content-range') || '';
  return cr.includes('/') ? toInt(cr.split('/')[1]) : null;
};

/**
 * @param {object} o
 * @param {string} o.supabaseUrl
 * @param {string} o.serviceKey
 * @param {(path: string, opts?: object) => Promise<Response>} o.db   the dashboard's audited request wrapper (fallback only)
 * @param {string} o.todayISO   start of the California day (lib/time/pacific.js)
 * @param {string} o.overdueISO stale rows unseen before this are overdue for the sweep
 * @param {typeof fetch} [o.fetchImpl]
 * @returns {Promise<{source:'rpc'|'exact', total:number|null, active:number|null, added_today:number|null,
 *   stale_or_expired:number|null, stale_clearable:number|null, expired_kept:number|null, stale_overdue:number|null}>}
 */
export async function fetchAdminJobsCounts({ supabaseUrl, serviceKey, db, todayISO, overdueISO, fetchImpl = fetch }) {
  // 1) One pass, one connection.
  try {
    const r = await fetchImpl(`${supabaseUrl}/rest/v1/rpc/${RPC_NAME}`, {
      method: 'POST',
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_today: todayISO, p_overdue: overdueISO }),
    });
    if (r.ok) {
      const j = await r.json();
      const obj = Array.isArray(j) ? j[0] : j;
      if (obj && typeof obj === 'object' && FIELDS.every((k) => toInt(obj[k]) != null)) {
        return { source: 'rpc', ...Object.fromEntries(FIELDS.map((k) => [k, toInt(obj[k])])) };
      }
    }
  } catch { /* fall through to the exact counts */ }
  // 2) Before the migration (404) or on any RPC trouble: the seven exact counts, exactly as before.
  const paths = fallbackPaths({ todayISO, overdueISO });
  const entries = await Promise.all(FIELDS.map(async (k) => {
    try { return [k, fromContentRange(await db(paths[k], { method: 'HEAD', headers: COUNT_HDR }))]; }
    catch { return [k, null]; }
  }));
  return { source: 'exact', ...Object.fromEntries(entries) };
}

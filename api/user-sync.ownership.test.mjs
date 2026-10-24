// Ownership + hygiene + round trips through the real api/user-sync.js handler (locally signed HS256
// token, in-memory PostgREST that honours `Prefer: return=representation` like the real one).
//   M3 (audit 2026-10-24): remove of an id the caller does not own answers 404, the other user's
//       row is untouched; a row deleted elsewhere is a 404; a client-local id is "not_synced".
//       update_application is compare-and-set (#355): a row the caller cannot see — another
//       user's, or deleted elsewhere — answers 410 gone (the client treats 410 and 404 alike).
//   P1: save_profile trims, caps (lib/profileLimits.js) and refuses a blank name.
//   H2: `load` carries the inbox status (one call for the dashboard), the auth check makes no network
//       call for a locally verifiable token, and inbox_status is one DB round trip once warm.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { PROFILE_LIMITS, PROFILE_NAME_REQUIRED } from '../lib/profileLimits.js';
import { resetTablesReady } from '../lib/server/inbox/store.js';

process.env.SUPABASE_URL = 'https://db.test';
process.env.SUPABASE_SERVICE_KEY = 'service';
process.env.SUPABASE_JWT_SECRET = 'jwt-secret';
const { default: handler } = await import('./user-sync.js');

const UID = '22222222-2222-4222-8222-222222222222';
const OTHER = '44444444-4444-4444-8444-444444444444';
const MINE = '33333333-3333-4333-8333-333333333333';
const THEIRS = '55555555-5555-4555-8555-555555555555';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const head = b64({ alg: 'HS256', typ: 'JWT' });
const pay = b64({ sub: UID, exp: Math.floor(Date.now() / 1000) + 3600 });
const TOKEN = `${head}.${pay}.${createHmac('sha256', 'jwt-secret').update(`${head}.${pay}`).digest('base64url')}`;

function install({ sessionAlive = true, hopMs = 0 } = {}) {
  const t = {
    applications: [
      { id: MINE, user_id: UID, company_name: 'Walmart', role: 'Cashier', status: 'active', stage: 'Applied', events: [] },
      { id: THEIRS, user_id: OTHER, company_name: 'Target', role: 'Stocker', status: 'active', stage: 'Applied', events: [] },
    ],
    profiles: [], inbox_addresses: [], inbox_events: [], ai_credits: [], saved_jobs: [], user_recent_cos: [], feature_flags: [], seen_applications: [],
  };
  const calls = [];
  const live = new Set(); // requests in flight — proves which ones overlap
  const overlaps = [];
  const match = (row, u) => [...u.searchParams.entries()].every(([k, v]) => {
    if (['select', 'order', 'limit', 'offset', 'on_conflict'].includes(k)) return true;
    const [op, ...rest] = v.split('.'); const val = rest.join('.'); const cell = row[k] == null ? null : String(row[k]);
    if (op === 'eq') return cell === val;
    if (op === 'in') return val.replace(/^\(|\)$/g, '').split(',').includes(cell);
    return true;
  });
  globalThis.fetch = async (url, opts = {}) => {
    const u = new URL(url);
    const m = opts.method || 'GET';
    calls.push(`${m} ${u.pathname}`);
    // GoTrue: /auth/v1/user answers 403 session_not_found once the session was signed out.
    if (u.pathname === '/auth/v1/user' || u.pathname.includes('/rpc/')) {
      const tag = u.pathname.includes('/rpc/') ? 'rpc' : 'auth';
      live.add(tag); if (live.size > 1) overlaps.push([...live].sort().join('+'));
      await new Promise((r) => setTimeout(r, hopMs));
      live.delete(tag);
      if (tag === 'rpc') return Response.json(1);
      return sessionAlive ? Response.json({ id: UID }) : Response.json({ code: 'session_not_found', msg: 'Session from session_id claim in JWT does not exist' }, { status: 403 });
    }
    if (u.pathname.startsWith('/auth/')) throw new Error('unexpected auth call: ' + u.pathname);
    const name = u.pathname.split('/').pop();
    const rows = t[name] || (t[name] = []);
    const body = opts.body ? JSON.parse(opts.body) : null;
    const represent = /return=representation/.test(String((opts.headers || {}).Prefer || ''));
    if (m === 'GET') return Response.json(rows.filter((r) => match(r, u)));
    if (m === 'POST') {
      if (/merge-duplicates/.test(String(opts.headers?.Prefer))) { const i = rows.findIndex((r) => r.id === body.id); if (i >= 0) Object.assign(rows[i], body); else rows.push({ ...body }); return new Response(null, { status: 201 }); }
      const row = { ...body }; rows.push(row); return Response.json([row], { status: 201 });
    }
    if (m === 'PATCH') { const hit = rows.filter((r) => match(r, u)); for (const r of hit) Object.assign(r, body); return represent ? Response.json(hit) : new Response(null, { status: 204 }); }
    if (m === 'DELETE') { const hit = rows.filter((r) => match(r, u)); t[name] = rows.filter((r) => !match(r, u)); return represent ? Response.json(hit) : new Response(null, { status: 204 }); }
    return new Response(null, { status: 405 });
  };
  return { t, calls, overlaps };
}
function call(body) {
  return new Promise((resolve) => {
    const res = { statusCode: 200, setHeader() {}, status(c) { this.statusCode = c; return this; }, json(b) { resolve({ status: this.statusCode, body: b }); return this; }, end() { resolve({ status: this.statusCode }); } };
    handler({ method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, origin: 'https://seenjobs.io' }, body }, res);
  });
}

test('M3: update of another user\'s application is a 410 (indistinguishable from deleted) and their row is untouched', async () => {
  const { t } = install();
  const r = await call({ action: 'update_application', id: THEIRS, changes: { stage: 'Offer', status: 'hired' } });
  assert.equal(r.status, 410);
  assert.deepEqual(r.body, { error: 'gone' });
  const theirs = t.applications.find((a) => a.id === THEIRS);
  assert.equal(theirs.stage, 'Applied');
  assert.equal(theirs.status, 'active');
  assert.equal(theirs.user_id, OTHER);
});

test('M3: update of my own application is a 200 and lands', async () => {
  const { t } = install();
  const r = await call({ action: 'update_application', id: MINE, changes: { stage: 'Interview' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(t.applications.find((a) => a.id === MINE).stage, 'Interview');
});

test('M3: update of my application after it was removed elsewhere is a 410, not a false ok', async () => {
  const { t } = install();
  assert.deepEqual(await call({ action: 'remove_application', id: MINE }), { status: 200, body: { ok: true } });
  const r = await call({ action: 'update_application', id: MINE, changes: { stage: 'Interview' } });
  assert.deepEqual(r, { status: 410, body: { error: 'gone' } });
  assert.equal(t.applications.length, 1);
});

test('M3: remove of another user\'s application is a 404; mine is removed; a second remove is a 404', async () => {
  const { t } = install();
  const theirs = await call({ action: 'remove_application', id: THEIRS });
  assert.equal(theirs.status, 404);
  assert.equal(t.applications.length, 2, 'nothing deleted');
  const mine = await call({ action: 'remove_application', id: MINE });
  assert.deepEqual(mine, { status: 200, body: { ok: true } });
  assert.equal(t.applications.length, 1);
  assert.equal(t.applications[0].id, THEIRS);
  const again = await call({ action: 'remove_application', id: MINE });
  assert.deepEqual(again, { status: 404, body: { ok: false, reason: 'not_found' } });
});

test('M3: a client-local app_ id is reported as not synced (no DB call), a missing id is a 400', async () => {
  const { calls } = install();
  const r = await call({ action: 'remove_application', id: 'app_1729' });
  assert.deepEqual(r, { status: 200, body: { ok: false, reason: 'not_synced' } });
  assert.ok(!calls.some((c) => c.includes('/rest/v1/applications')), 'no applications query for a client id');
  assert.equal((await call({ action: 'remove_application' })).status, 400);
});

test('P1: save_profile trims, caps name/city and refuses a blank name', async () => {
  const { t } = install();
  const long = 'x'.repeat(500);
  const ok = await call({ action: 'save_profile', profile: { name: `  Jordan  `, city: `  ${long}  `, experience: 'mid' } });
  assert.deepEqual(ok, { status: 200, body: { ok: true } });
  const row = t.profiles.find((p) => p.id === UID);
  assert.equal(row.name, 'Jordan');
  assert.equal(row.city.length, PROFILE_LIMITS.city);
  assert.equal(row.experience, 'mid');
  const blank = await call({ action: 'save_profile', profile: { name: '   ' } });
  assert.deepEqual(blank, { status: 400, body: { ok: false, error: PROFILE_NAME_REQUIRED } });
  assert.equal(row.name, 'Jordan', 'the blank save changed nothing');
  // A save that does not mention the name (the dashboard's onboarding flag) still works.
  const flag = await call({ action: 'save_profile', profile: { onboarding_survey: { dismissed: true } } });
  assert.equal(flag.status, 200);
  assert.equal(row.name, 'Jordan');
  const capped = await call({ action: 'save_profile', profile: { name: long } });
  assert.equal(capped.status, 200);
  assert.equal(row.name.length, PROFILE_LIMITS.name);
  const notText = await call({ action: 'save_profile', profile: { name: { $: 1 } } });
  assert.equal(notText.status, 400);
});

test('H2: load carries the inbox status and credits — one call serves the dashboard tile, pro flag and recent companies', async () => {
  resetTablesReady();
  const { t, calls } = install();
  t.inbox_addresses.push({ user_id: UID, token: 'abcdefghijkl', paused: false, received_count: 3 });
  t.ai_credits.push({ user_id: UID, balance: 1, purchased_credits: 2, last_reset: '2000-01-01', is_pro: false });
  t.user_recent_cos.push({ user_id: UID, company_name: 'Walmart', viewed_at: '2026-10-24T00:00:00Z' });
  const r = await call({ action: 'load' });
  assert.equal(r.status, 200);
  assert.equal(r.body.inbox.ready, true);
  assert.equal(r.body.inbox.enabled, true);
  assert.equal(r.body.inbox.received_count, 3);
  assert.equal(r.body.recent_cos[0].company_name, 'Walmart');
  assert.equal(typeof r.body.credits.pro, 'boolean');
  // Every read of `load` is issued at once (one wave), not one after another.
  const gets = calls.filter((c) => c.startsWith('GET /rest/v1/'));
  assert.ok(gets.length >= 8 && gets.length <= 10, `expected ~9 parallel reads, got ${gets.length}: ${gets.join(', ')}`);
});

test('H2: inbox_status is one DB round trip once the table probe is warm (was three sequential)', async () => {
  resetTablesReady();
  const { t, calls } = install();
  t.inbox_addresses.push({ user_id: UID, token: 'abcdefghijkl', paused: false, received_count: 0 });
  await call({ action: 'inbox_status' }); // cold: probe + address + events
  const cold = calls.filter((c) => c.startsWith('GET /rest/v1/inbox_')).length;
  assert.equal(cold, 3);
  calls.length = 0;
  const r = await call({ action: 'inbox_status' });
  assert.equal(r.body.enabled, true);
  const warm = calls.filter((c) => c.startsWith('GET /rest/v1/inbox_'));
  assert.deepEqual(warm.sort(), ['GET /rest/v1/inbox_addresses', 'GET /rest/v1/inbox_events'], 'address + events only, issued together');
});

test('H2 + C1: the session check runs BESIDE the rate-limit RPC (one hop), and a signed-out session is refused', async () => {
  const { calls, overlaps } = install({ hopMs: 20 });
  const ok = await call({ action: 'load_profile' });
  assert.equal(ok.status, 200);
  assert.deepEqual(overlaps, ['auth+rpc'], 'rate limit and /auth/v1/user were in flight together');
  const before = calls.indexOf('GET /rest/v1/profiles');
  assert.ok(before > calls.indexOf('GET /auth/v1/user') && before > calls.indexOf('POST /rest/v1/rpc/increment_rate_limit'), 'the read waits for both');
  // "Sign out of all devices" deleted the session: its still-signed access token reads nothing.
  const { calls: c2 } = install({ sessionAlive: false });
  const gone = await call({ action: 'load' });
  assert.equal(gone.status, 401);
  assert.ok(!c2.some((c) => c.startsWith('GET /rest/v1/applications')), 'no data read for a revoked session');
});

test('H2: an auth server that does not answer never hangs the call (signature already verified → served)', async () => {
  install();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    if (new URL(url).pathname === '/auth/v1/user') {
      return new Promise((_, reject) => opts.signal?.addEventListener('abort', () => reject(new Error('timeout'))));
    }
    return realFetch(url, opts);
  };
  const keep = setInterval(() => {}, 100); // AbortSignal.timeout's timer is unref'd
  const t0 = Date.now();
  const r = await call({ action: 'load_profile' }).finally(() => clearInterval(keep));
  assert.equal(r.status, 200);
  assert.ok(Date.now() - t0 < 4000, 'bounded by the 2.5 s session-check timeout');
});

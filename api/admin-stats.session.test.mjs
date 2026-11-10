// Sign-in counts one attempt per submit (the old form fired twice on Enter: two sessions, two rate-limit hits),
// requireAdmin is the one session check, and the cron recorder never throws.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';

process.env.SUPABASE_URL = 'https://db.test';
process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
const { default: handler } = await import('./admin-stats.js');
const { world, RPCS, caller, createFakeRest } = await import('../lib/server/admin/testing/world.mjs');
const { requireAdmin } = await import('../lib/server/admin/auth.js');
const { recordCronRun } = await import('../lib/server/cronRun.js');
const C = await import('../lib/server/admin/testing/contract.mjs');

function withPassword() {
  const T = world();
  T.admin_accounts[0].salt = 'salt1';
  T.admin_accounts[0].password_hash = scryptSync('correct horse', 'salt1', 64).toString('hex');
  return T;
}

test('one submit = one attempt and at most one session', async () => {
  const counter = new Map();
  const fake = createFakeRest({ tables: withPassword(), rpcs: { ...RPCS, increment_rate_limit: ({ p_key }) => { const n = (counter.get(p_key) || 0) + 1; counter.set(p_key, n); return n; } } });
  const call = await caller(handler, fake);
  const body = { action: 'admin_login', username: 'owner', password: 'correct horse', submit_id: 'submit-0001' };
  const [a, b] = await Promise.all([call(body, { token: '' }), call(body, { token: '' })].map((p) => p));
  const statuses = [a.statusCode, b.statusCode].sort();
  assert.deepEqual(statuses, [200, 409]);
  const winner = a.statusCode === 200 ? a : b;
  assert.deepEqual(C.checkOk(winner.jsonBody), []);
  assert.match(winner.jsonBody.token, /^[0-9a-f]{64}$/);
  assert.equal(fake.tables.admin_sessions.length, 2, 'the seeded session + exactly one new one');
  const attempts = [...counter.entries()].filter(([k]) => k.includes(':admin_login:')).reduce((n, [, v]) => n + v, 0);
  assert.equal(attempts, 1, 'the duplicate submit was not counted');
});

test('wrong password: AdminErr 401; rate limit: 429', async () => {
  const fake = createFakeRest({ tables: withPassword(), rpcs: RPCS });
  const call = await caller(handler, fake);
  const r = await call({ action: 'admin_login', username: 'owner', password: 'nope' }, { token: '' });
  assert.equal(r.statusCode, 401);
  assert.deepEqual(C.checkErr(r.jsonBody), []);
  for (let i = 0; i < 6; i++) await call({ action: 'admin_login', username: 'owner', password: 'nope' }, { token: '' });
  const limited = await call({ action: 'admin_login', username: 'owner', password: 'correct horse' }, { token: '' });
  assert.equal(limited.statusCode, 429);
  assert.equal(limited.jsonBody.code, 'rate_limited');
});

test('requireAdmin: live session with its username; expired, unknown and disabled are refused', async () => {
  const T = world();
  const fake = createFakeRest({ tables: T });
  const s = await requireAdmin({ headers: { 'x-admin-token': T.admin_sessions[0].token } }, { url: 'https://db.test', key: 'k', fetchImpl: fake.fetch });
  assert.equal(s.username, 'owner');
  assert.equal(s.role, 'super_admin');
  assert.equal(await requireAdmin({ headers: { 'x-admin-token': 'f'.repeat(64) } }, { url: 'https://db.test', key: 'k', fetchImpl: fake.fetch }), null);
  T.admin_accounts[0].is_active = false;
  assert.equal(await requireAdmin({ headers: { 'x-admin-token': T.admin_sessions[0].token } }, { url: 'https://db.test', key: 'k', fetchImpl: fake.fetch }), null);
  T.admin_accounts[0].is_active = true;
  T.admin_sessions[0].expires_at = new Date(Date.now() - 1000).toISOString();
  assert.equal(await requireAdmin({ headers: { 'x-admin-token': T.admin_sessions[0].token } }, { url: 'https://db.test', key: 'k', fetchImpl: fake.fetch }), null);
});

test('logout deletes the session and counts it', async () => {
  const fake = createFakeRest({ tables: world(), rpcs: RPCS });
  const call = await caller(handler, fake);
  const r = await call({ action: 'admin_logout' });
  assert.deepEqual(C.checkOk(r.jsonBody), []);
  assert.equal(r.jsonBody.changed, 1);
  const after = await call({ action: 'whoami' });
  assert.equal(after.statusCode, 401);
});

test('recordCronRun writes one row, and never throws when the table is missing or the network fails', async () => {
  const fake = createFakeRest({ tables: { cron_runs: [] } });
  assert.equal(await recordCronRun('refresh-jobs', 'ok', 'found 10\nupserted 9', { url: 'https://db.test', key: 'k', fetchImpl: fake.fetch }), true);
  assert.equal(fake.tables.cron_runs[0].name, 'refresh-jobs');
  assert.equal(fake.tables.cron_runs[0].detail, 'found 10 upserted 9');
  const missing = createFakeRest({ missing: ['cron_runs'] });
  assert.equal(await recordCronRun('x', 'failed', null, { url: 'https://db.test', key: 'k', fetchImpl: missing.fetch }), false);
  assert.equal(await recordCronRun('x', 'ok', null, { url: 'https://db.test', key: 'k', fetchImpl: async () => { throw new Error('down'); } }), false);
});

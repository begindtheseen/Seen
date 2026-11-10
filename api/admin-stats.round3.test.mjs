// Round 3: a slow database never signs the owner out (503 retryable, not 401); credit and revenue totals are summed
// over every row, never one capped page; a bulk approve cannot publish anti-gaming holds or possible duplicates by
// accident.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://db.test';
process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
delete process.env.STRIPE_SECRET_KEY;
const { default: handler } = await import('./admin-stats.js');
const { world, RPCS, caller, createFakeRest, uid, TOKEN } = await import('../lib/server/admin/testing/world.mjs');
const { checkAdmin } = await import('../lib/server/admin/auth.js');
const C = await import('../lib/server/admin/testing/contract.mjs');

const ago = (ms) => new Date(Date.now() - ms).toISOString();

test('slow session read → 503 retryable, never 401; a missing session is 401', async () => {
  const fake = createFakeRest({ tables: world() });
  const slow = (u, o = {}) => new Promise((resolve, reject) => {
    const t = setTimeout(() => resolve(fake.fetch(u, o)), 300);
    o.signal?.addEventListener('abort', () => { clearTimeout(t); reject(Object.assign(new Error('aborted'), { name: 'TimeoutError' })); });
  });
  const req = { headers: { 'x-admin-token': TOKEN } };
  assert.equal((await checkAdmin(req, { url: 'https://db.test', key: 'k', fetchImpl: slow, timeoutMs: 50 })).status, 503);
  assert.ok((await checkAdmin(req, { url: 'https://db.test', key: 'k', fetchImpl: slow, timeoutMs: 2000 })).sess, 'slow but within the cap: signed in');
  assert.equal((await checkAdmin({ headers: { 'x-admin-token': 'f'.repeat(64) } }, { url: 'https://db.test', key: 'k', fetchImpl: fake.fetch })).status, 401);

  for (const fault of [{ match: '/admin_sessions?', status: 503 }, { match: '/admin_sessions?', status: 500 }, { match: '/admin_sessions?', throw: 'socket hang up' }, { match: '/admin_accounts?', status: 504 }]) {
    const f = createFakeRest({ tables: world(), rpcs: RPCS, faults: [fault] });
    const call = await caller(handler, f);
    const r = await call({ action: 'overview' });
    assert.equal(r.statusCode, 503, JSON.stringify(fault));
    assert.deepEqual(C.checkErr(r.jsonBody), []);
    assert.equal(r.jsonBody.code, 'upstream');
    assert.equal(r.jsonBody.retryable, true);
    assert.match(r.jsonBody.error, /Couldn’t check your session/);
  }
  const f = createFakeRest({ tables: world(), rpcs: RPCS });
  const call = await caller(handler, f);
  f.tables.admin_accounts[0].is_active = false;
  assert.equal((await call({ action: 'overview' })).statusCode, 401, 'a disabled account is unauthorized');
});

test('credit and revenue totals are summed over every row (2,500 transactions, 2,500 buyers)', async () => {
  const T = world();
  T.credit_transactions = Array.from({ length: 2500 }, (_, i) => ({ id: i + 1, user_id: uid(1, '6'), delta: i % 2 ? -1 : 2, reason: i % 2 ? 'spend' : 'earn', created_at: ago(3600e3) }));
  // 2,500 distinct buyers.
  for (let i = 0; i < 2500; i++) T.credit_transactions.push({ id: 10000 + i, user_id: uid(i + 10, '16'), delta: 0, reason: 'purchase_interview', created_at: ago(3600e3) });
  const fake = createFakeRest({ tables: T, rpcs: RPCS });
  const call = await caller(handler, fake);
  const rev = (await call({ action: 'revenue_summary', days: 7 })).jsonBody.rows[0];
  assert.equal(rev.credits.earned, 1250 * 2);
  assert.equal(rev.credits.spent, 1250);
  assert.equal(rev.consumer.find((x) => x.sku === 'interview').count, 2500);
  const u = (await call({ action: 'user_detail', user_id: uid(1, '6') })).jsonBody.rows[0];
  assert.equal(u.credits_earned, 2500);
  assert.equal(u.credits_spent, 1250);
  const funnel = (await call({ action: 'revenue_funnel', days: 7 })).jsonBody;
  assert.equal(funnel.report.revenue.paying_customers, 2500, 'distinct buyers counted past one 1,000-row page');
  const legacy = await call(undefined, { method: 'GET' });
  assert.equal(legacy.jsonBody.credits.earned, 2500);
  assert.equal(legacy.jsonBody.credits.spent, 1250);
});

function heldWorld() {
  const T = world({ held: 10 });
  const extra = [
    { id: uid(901, '1'), trust_reason: 'anonymous_unverified', platform: 'Seen' },
    { id: uid(902, '1'), trust_reason: 'velocity_capped', platform: 'Seen' },
  ].map((x, i) => ({ company_name: 'Tesla', outcome: 'interview', role: 'r', source: 'direct', created_at: ago((i + 1) * 60e3), report_text: `anti gaming hold ${i} with its own words`, outcome_weight: 1, needs_review: true, ...x }));
  const dup = { ...T.reports[0], id: uid(903, '1'), created_at: new Date().toISOString() };
  T.reports.push(...extra, dup);
  return T;
}
const pendingIds = (f) => f.tables.reports.filter((r) => r.needs_review && !['admin_rejected', 'duplicate_import'].includes(r.trust_reason)).map((r) => r.id);

test('bulk approve never publishes anti-gaming holds or possible duplicates unless named in include_ids', async () => {
  const fake = createFakeRest({ tables: heldWorld(), rpcs: RPCS });
  const call = await caller(handler, fake);
  const r = (await call({ action: 'review_held', decision: 'approve', ids: pendingIds(fake) })).jsonBody;
  assert.equal(r.changed, 10);
  assert.deepEqual(r.skipped.map((s) => [s.reason, s.count, [...s.ids].sort()]), [['anti_gaming_hold', 2, [uid(901, '1'), uid(902, '1')]], ['possible_duplicate', 1, [uid(903, '1')]]]);
  assert.match(r.message, /2 anti-gaming holds left for one-by-one review · 1 skipped as possible duplicates/);
  // Named on purpose → approved.
  const named = (await call({ action: 'review_held', decision: 'approve', ids: pendingIds(fake), include_ids: [uid(901, '1')] })).jsonBody;
  // 901 was named; the copy 903 is no longer a duplicate once its original left the queue, so it goes too.
  assert.equal(named.changed, 2);
  assert.deepEqual(named.skipped.map((s) => [s.reason, s.ids]), [['anti_gaming_hold', [uid(902, '1')]]]);
  // One report approved on its own names itself.
  const one = (await call({ action: 'review_held', decision: 'approve', ids: [uid(902, '1')] })).jsonBody;
  assert.equal(one.changed, 1);
});

test('scope "all" (by filter): the server picks the rows, with the same guard; group narrows it', async () => {
  const fake = createFakeRest({ tables: heldWorld(), rpcs: RPCS });
  const call = await caller(handler, fake);
  const pos = (await call({ action: 'review_held', decision: 'approve', scope: 'all', group: 'positive' })).jsonBody;
  assert.deepEqual(C.checkOk(pos), []);
  assert.ok(pos.changed > 0);
  assert.ok(fake.tables.reports.filter((r) => ['anonymous_unverified', 'velocity_capped'].includes(r.trust_reason)).every((r) => r.needs_review), 'holds untouched');
  const all = (await call({ action: 'review_held', decision: 'approve', scope: 'all' })).jsonBody;
  assert.equal(all.skipped.find((s) => s.reason === 'anti_gaming_hold').count, 2);
  assert.equal(pendingIds(fake).length, 3, 'only the 2 holds and the duplicate are left');
  // Rejecting everything is never filtered.
  const rej = (await call({ action: 'review_held', decision: 'reject', scope: 'all' })).jsonBody;
  assert.equal(rej.changed, 3);
});

test('the legacy review_reports alias has the same guard', async () => {
  const fake = createFakeRest({ tables: heldWorld(), rpcs: RPCS });
  const call = await caller(handler, fake);
  const r = (await call({ action: 'review_reports', decision: 'approve', ids: pendingIds(fake) })).jsonBody;
  assert.equal(r.changed, 10);
  assert.equal(r.skipped, 3);
});

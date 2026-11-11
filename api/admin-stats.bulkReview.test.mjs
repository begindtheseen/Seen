// "Approve all" (audit defect 1): any number of held reports in ONE call, ids in the body, every request URL
// short (the old 500-id URL overflowed undici's 16 KB response-header cap and approved nothing), audit rows
// with prior values, honest skips, idempotent retries, honest partial failure, and undo.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://db.test';
process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
const { default: handler } = await import('./admin-stats.js');
const { world, RPCS, caller, createFakeRest } = await import('../lib/server/admin/testing/world.mjs');
const C = await import('../lib/server/admin/testing/contract.mjs');

const COMPANIES = Array.from({ length: 40 }, (_, i) => `Company ${i}`);
const heldIds = (fake) => fake.tables.reports.filter((r) => r.needs_review === true && !['admin_rejected', 'duplicate_import'].includes(r.trust_reason)).map((r) => r.id);

test('1,000 held reports approved in one call: all handled, no URL over 2 KB, audited with prior values', async () => {
  const fake = createFakeRest({ tables: world({ held: 1000, companies: COMPANIES, liveReports: 0 }), rpcs: RPCS });
  const call = await caller(handler, fake);
  const ids = heldIds(fake);
  assert.equal(ids.length, 1000);
  const r = await call({ action: 'review_held', decision: 'approve', ids });
  assert.equal(r.statusCode, 200, JSON.stringify(r.jsonBody).slice(0, 300));
  assert.deepEqual(C.checkOk(r.jsonBody), []);
  assert.equal(r.jsonBody.changed, 1000);
  assert.equal(r.jsonBody.complete, true);
  assert.equal(r.jsonBody.rows.length, 1000);
  assert.match(r.jsonBody.message, /^Approved 1,000 of 1,000/);
  assert.equal(heldIds(fake).length, 0, 'every row left the queue');
  const longest = Math.max(...fake.log.map((e) => e.len));
  assert.ok(longest <= 2048, `longest request URL ${longest} chars`);
  const children = fake.tables.admin_audit_log.filter((a) => a.action === 'approve_held_report');
  assert.equal(children.length, 1000, 'one audit row per report');
  assert.deepEqual(children[0].metadata.prior, { needs_review: true, trust_reason: 'external_import', outcome_weight: 0.55 });
  assert.deepEqual(children[0].metadata.next, { needs_review: false });
  assert.ok(fake.tables.admin_audit_log.some((a) => a.action === 'review_held' && a.target_type === 'bulk'), 'one batch row for the activity log');
  assert.ok(r.jsonBody.undo, 'undo offered');
  assert.equal(r.jsonBody.recompute.queued, 40, 'touched companies queued for a score recompute');
});

test('a second identical call changes nothing and says so plainly (same press → "by your last try")', async () => {
  const fake = createFakeRest({ tables: world({ held: 300, companies: COMPANIES }), rpcs: RPCS });
  const call = await caller(handler, fake);
  const ids = heldIds(fake);
  const request_id = '11111111-2222-4333-8444-555555555555';
  const first = await call({ action: 'review_held', decision: 'approve', ids, request_id });
  assert.equal(first.jsonBody.changed, 300);
  const again = await call({ action: 'review_held', decision: 'approve', ids, request_id });
  assert.equal(again.statusCode, 200);
  assert.equal(again.jsonBody.changed, 0);
  assert.deepEqual(again.jsonBody.skipped.map((s) => [s.reason, s.count]), [['already_done_last_try', 300]]);
  assert.match(again.jsonBody.message, /by your last try/);
  assert.doesNotMatch(again.jsonBody.message, /already decided/);
  // A new press on rows someone (anyone) already decided: plain "already decided".
  const other = await call({ action: 'review_held', decision: 'reject', ids: ids.slice(0, 5) });
  assert.equal(other.jsonBody.changed, 0);
  assert.match(other.jsonBody.message, /^Nothing to do — 5 not held\./);
});

test('a failure halfway reports the partial count and retryable; pressing again finishes the rest', async () => {
  const fake = createFakeRest({ tables: world({ held: 400, companies: COMPANIES }), rpcs: RPCS, faults: [] });
  const call = await caller(handler, fake);
  const ids = heldIds(fake);
  // Fail the 6th PATCH of reports (5 chunks of 40 = 200 rows land first).
  fake.faults.push({ method: 'PATCH', match: '/rest/v1/reports?', status: 503, skip: 5, times: 1 });
  const request_id = '99999999-2222-4333-8444-555555555555';
  const r = await call({ action: 'review_held', decision: 'reject', ids, request_id });
  assert.equal(r.statusCode, 502);
  assert.deepEqual(C.checkErr(r.jsonBody), []);
  assert.equal(r.jsonBody.retryable, true);
  assert.equal(r.jsonBody.changed, 200);
  assert.equal(r.jsonBody.remaining, 200);
  assert.equal(heldIds(fake).length, 200);
  // The 200 that landed are audited; the failed chunk left no audit rows behind.
  assert.equal(fake.tables.admin_audit_log.filter((a) => a.action === 'reject_held_report').length, 200);
  fake.faults.length = 0;
  const retry = await call({ action: 'review_held', decision: 'reject', ids, request_id });
  assert.equal(retry.statusCode, 200);
  assert.equal(retry.jsonBody.changed, 200);
  assert.equal(retry.jsonBody.skipped.find((s) => s.reason === 'already_done_last_try').count, 200);
  assert.equal(heldIds(fake).length, 0);
});

test('possible duplicates are skipped by a bulk approve, and named', async () => {
  const T = world({ held: 10, companies: COMPANIES });
  const copy = { ...T.reports[0], id: '12345678-0000-4000-8000-000000000001', created_at: new Date().toISOString() };
  T.reports.push(copy);
  const fake = createFakeRest({ tables: T, rpcs: RPCS });
  const call = await caller(handler, fake);
  const r = await call({ action: 'review_held', decision: 'approve', ids: heldIds(fake) });
  assert.equal(r.jsonBody.changed, 10);
  assert.deepEqual(r.jsonBody.skipped.map((s) => [s.reason, s.count, s.ids]), [['possible_duplicate', 1, [copy.id]]]);
  assert.match(r.jsonBody.message, /1 skipped as possible duplicates/);
});

test('undo restores every report of the batch, conditionally', async () => {
  const fake = createFakeRest({ tables: world({ held: 120, companies: COMPANIES }), rpcs: RPCS });
  const call = await caller(handler, fake);
  const ids = heldIds(fake);
  const a = await call({ action: 'review_held', decision: 'approve', ids });
  // Someone rejects one of them afterwards (what moderate_report writes): undo must leave it alone.
  Object.assign(fake.tables.reports.find((r) => r.id === ids[0]), { needs_review: true, trust_reason: 'admin_rejected', outcome_weight: 0 });
  const u = await call({ action: 'undo', ...a.jsonBody.undo.args });
  assert.equal(u.statusCode, 200, JSON.stringify(u.jsonBody));
  assert.deepEqual(C.checkOk(u.jsonBody), []);
  assert.equal(u.jsonBody.changed, 119);
  assert.deepEqual(u.jsonBody.skipped, [{ reason: 'changed_since', count: 1 }]);
  assert.equal(heldIds(fake).length, 119, 'the 119 are back in the queue; the one rejected since stays rejected');
  const twice = await call({ action: 'undo', ...a.jsonBody.undo.args });
  assert.equal(twice.statusCode, 409);
});

test('the legacy review_reports alias keeps its old fields', async () => {
  const fake = createFakeRest({ tables: world({ held: 5 }), rpcs: RPCS });
  const call = await caller(handler, fake);
  const ids = heldIds(fake);
  const r = await call({ action: 'review_reports', decision: 'approve', ids });
  assert.equal(r.statusCode, 200);
  assert.equal(r.jsonBody.changed, 5);
  assert.equal(r.jsonBody.skipped, 0, 'a number, as the legacy page reads it');
  assert.equal(typeof r.jsonBody.recomputed, 'number');
});

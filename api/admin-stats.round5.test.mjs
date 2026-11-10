// Round 5: a held copy of a LIVE report is a possible duplicate (classification and the bulk guard), held rows
// carry both strict-rules readings, "mark duplicate copies" has one Undo, outcomes can be corrected (and undone),
// a failed claims read is an error, cron rows carry duration_ms, cluster uuids work, a slow session is 503.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://db.test';
process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
const { default: handler } = await import('./admin-stats.js');
const { default: claimsHandler } = await import('./employer-claims.js');
const { world, RPCS, caller, createFakeRest, uid, TOKEN } = await import('../lib/server/admin/testing/world.mjs');
const { makeRes } = await import('../lib/server/admin/testing/fakeRest.mjs');
const { OUTCOMES } = await import('../lib/server/admin/review.js');
const { REPORT_OUTCOMES } = await import('./reports.js');
const C = await import('../lib/server/admin/testing/contract.mjs');

const ago = (ms) => new Date(Date.now() - ms).toISOString();
const pendingIds = (f) => f.tables.reports.filter((r) => r.needs_review && !['admin_rejected', 'duplicate_import'].includes(r.trust_reason)).map((r) => r.id);

// The rig's shape in miniature: 14 clean positives, and a held copy of every 5th one (copies made an hour later).
function copiesWorld() {
  const T = world({ held: 0, liveReports: 0 });
  T.reports = [];
  for (let i = 0; i < 14; i++) T.reports.push({ id: uid(i + 1, '21'), company_name: `Firm ${i % 3}`, outcome: 'interview', role: 'r', platform: 'Indeed', source: 'external', created_at: ago((20 - i) * 3600e3), report_text: `Positive account ${i}, its own words`, outcome_weight: 0.55, trust_reason: 'external_import', needs_review: true });
  for (let k = 0; k < 3; k++) { const b = T.reports[k * 5]; T.reports.push({ ...b, id: uid(k + 1, '22'), created_at: new Date(Date.parse(b.created_at) + 3600e3).toISOString() }); }
  return T;
}

test('a held copy stays a possible duplicate after its original goes live: listed as such, never bulk-approved', async () => {
  const fake = createFakeRest({ tables: copiesWorld(), rpcs: RPCS });
  const call = await caller(handler, fake);
  // "Approve all positive": the server skips the 3 copies (copies of other HELD rows) and publishes the 14.
  const first = (await call({ action: 'review_held', decision: 'approve', scope: 'all', group: 'positive' })).jsonBody;
  assert.equal(first.changed, 14);
  assert.equal(first.skipped.find((s) => s.reason === 'possible_duplicate').count, 3);
  // Fresh tab: the list still flags the 3 copies — against the now-LIVE originals.
  const list = (await call({ action: 'list_held_reports' })).jsonBody;
  assert.equal(list.total, 3);
  for (const r of list.rows) {
    assert.ok(r.review.flags.includes('possible_duplicate'), 'flagged against the live original');
    assert.equal(r.review.duplicate_of_live, true);
    assert.ok(r.review.duplicate_of);
  }
  // The next bulk press changes 0 and names the 3.
  const again = (await call({ action: 'review_held', decision: 'approve', scope: 'all', group: 'positive' })).jsonBody;
  assert.equal(again.changed, 0);
  assert.deepEqual(again.skipped.map((s) => [s.reason, s.count]), [['possible_duplicate', 3]]);
  const byIds = (await call({ action: 'review_held', decision: 'approve', ids: pendingIds(fake) })).jsonBody;
  assert.equal(byIds.changed, 0);
  // Named on purpose (one id, or include_ids) is still possible.
  const one = (await call({ action: 'review_held', decision: 'approve', ids: [pendingIds(fake)[0]] })).jsonBody;
  assert.equal(one.changed, 1);
});

test('held and recent rows carry the strict-rules verdict and both readings', async () => {
  const T = world({ held: 2 });
  T.reports[0].trust_reason = 'reddit_rule_match';
  T.reports[0].platform = 'Reddit r/jobs';
  T.reports[0].report_text = 'Got rejected from Walmart after the second interview. They never called back after that.';
  T.reports[0].company_name = 'Walmart';
  Object.assign(T.reports[1], { trust_reason: null, platform: 'Seen' }); // a first-party report: the rules do not apply
  const fake = createFakeRest({ tables: T, rpcs: RPCS });
  const call = await caller(handler, fake);
  const rows = (await call({ action: 'list_held_reports' })).jsonBody.rows;
  const r = rows.find((x) => x.id === T.reports[0].id);
  assert.ok(['passes', 'fails'].includes(r.rules));
  assert.deepEqual(Object.keys(r.rules_detail).sort(), ['comment', 'post', 'verdict']);
  assert.equal(typeof r.rules_detail.comment, 'boolean');
  assert.equal(r.rules_detail.verdict, r.rules);
  const other = rows.find((x) => x.id !== T.reports[0].id);
  assert.deepEqual(other.rules_detail, { verdict: null, comment: null, post: null }, 'rules do not apply to a non-imported row');
  const recent = (await call({ action: 'reports_recent', state: 'held' })).jsonBody.rows;
  assert.ok(recent.every((x) => 'rules_detail' in x));
});

test('"mark duplicate copies" offers ONE Undo for the batch', async () => {
  const T = world({ held: 0, liveReports: 0 });
  T.reports = [];
  for (let i = 0; i < 6; i++) T.reports.push({ id: uid(i + 1, '31'), company_name: 'Acme', outcome: 'ghosted', platform: 'Indeed', role: 'Cashier', created_at: ago((10 - i) * 3600e3), report_text: 'The very same imported text appearing twice in the reports table', outcome_weight: 0.55, trust_reason: 'external_import', needs_review: false });
  const fake = createFakeRest({ tables: T, rpcs: RPCS });
  const call = await caller(handler, fake);
  const d = (await call({ action: 'dedupe_reports' })).jsonBody;
  assert.deepEqual(C.checkOk(d), []);
  assert.equal(d.changed, 5);
  assert.ok(d.undo);
  const u = (await call({ action: 'undo', ...d.undo.args })).jsonBody;
  assert.equal(u.changed, 5);
  assert.equal(fake.tables.reports.filter((r) => r.trust_reason === 'duplicate_import').length, 0);
  assert.match(u.message, /no longer marked as copies/);
});

test('correct a report outcome: audited with the prior value, recompute queued, Undo; legacy name', async () => {
  assert.deepEqual([...OUTCOMES].sort(), [...REPORT_OUTCOMES].sort(), 'the same list as api/reports.js');
  const fake = createFakeRest({ tables: world(), rpcs: RPCS });
  const call = await caller(handler, fake);
  const id = uid(1, '2');
  const r = (await call({ action: 'correct_report_outcome', id, outcome: 'rejected', reason: 'thread says no offer' })).jsonBody;
  assert.deepEqual(C.checkOk(r), []);
  assert.equal(r.changed, 1);
  assert.equal(fake.tables.reports.find((x) => x.id === id).outcome, 'rejected');
  const a = fake.tables.admin_audit_log.filter((x) => x.action === 'correct_report_outcome').pop();
  assert.deepEqual([a.metadata.prior, a.metadata.next, a.metadata.reason], [{ outcome: 'offer' }, { outcome: 'rejected' }, 'thread says no offer']);
  assert.equal(r.recompute.queued, 1);
  const same = (await call({ action: 'correct_report_outcome', id, outcome: 'rejected' })).jsonBody;
  assert.equal(same.changed, 0);
  assert.equal((await call({ action: 'correct_report_outcome', id, outcome: 'unknown' })).statusCode, 400);
  const u = (await call({ action: 'undo', ...r.undo.args })).jsonBody;
  assert.equal(u.changed, 1);
  assert.equal(fake.tables.reports.find((x) => x.id === id).outcome, 'offer');
});

test('employer claims: a failed read is a retryable error, never "no claims"', async () => {
  const fake = createFakeRest({ tables: world(), faults: [{ match: '/employer_company_claims?', status: 500 }] });
  global.fetch = fake.fetch;
  const res = makeRes();
  await claimsHandler({ method: 'POST', headers: { 'x-admin-token': TOKEN, origin: '' }, body: { action: 'list' } }, res);
  assert.equal(res.statusCode, 502);
  assert.deepEqual(C.checkErr(res.jsonBody), []);
  assert.equal(res.jsonBody.retryable, true);
});

test('cron rows carry duration_ms from the recorder detail (or finished − started)', async () => {
  const T = world();
  T.cron_runs = [
    { id: 1, name: 'refresh-jobs', status: 'ok', started_at: ago(60e3), finished_at: ago(30e3), detail: 'found 10, upserted 9, duration_ms 29876' },
    { id: 2, name: 'prune-jobs', status: 'ok', started_at: ago(70e3), finished_at: ago(60e3), detail: 'deleted 3' },
  ];
  const fake = createFakeRest({ tables: T, rpcs: RPCS });
  const call = await caller(handler, fake);
  const rows = (await call({ action: 'cron_health' })).jsonBody.rows;
  assert.equal(rows.find((r) => r.name === 'refresh-jobs').duration_ms, 29876);
  assert.ok(Math.abs(rows.find((r) => r.name === 'prune-jobs').duration_ms - 10000) < 50);
  assert.equal('duration_ms' in rows.find((r) => r.name === 'demand'), false, 'absent when nothing recorded');
});

test('update_cluster and cluster_detail accept the rig\'s uuid ids', async () => {
  const T = world();
  const cid = 'a3f1c2d4-9b8e-4c7d-a6b5-0123456789ab';
  T.duplicate_clusters.push({ id: cid, user_ids: [uid(1, '6')], signals: ['ip:7.7.7.7'], risk_score: 30, status: 'suspected', admin_note: null, created_at: ago(1e3) });
  const fake = createFakeRest({ tables: T, rpcs: RPCS });
  const call = await caller(handler, fake);
  const r = await call({ action: 'update_cluster', cluster_id: cid.toUpperCase(), status: 'safe' });
  assert.equal(r.statusCode, 200, JSON.stringify(r.jsonBody));
  assert.equal(fake.tables.duplicate_clusters.find((c) => c.id === cid).status, 'safe');
});

test('round 6: the list does not wait on the duplicate-of-live check; the bulk guard skips what it could not verify', async () => {
  const review = await import('../lib/server/admin/review.js');
  const fake = createFakeRest({ tables: copiesWorld(), rpcs: RPCS });
  const call = await caller(handler, fake);
  await call({ action: 'review_held', decision: 'approve', scope: 'all', group: 'positive' }); // originals go live
  // Published-report reads (the live check) become slow; every other read stays fast.
  const real = fake.fetch;
  fake.fetch = async (u, o) => { if (String(u).includes('/rest/v1/reports?') && String(u).includes('needs_review=is.false')) await new Promise((r) => setTimeout(r, 400)); return real(u, o); };
  const slowCall = await caller(handler, fake);
  const saved = { ...review.LIVE_CHECK };
  Object.assign(review.LIVE_CHECK, { listBudgetMs: 100, guardBudgetMs: 100 });
  try {
    const t0 = Date.now();
    const list = (await slowCall({ action: 'list_held_reports' })).jsonBody;
    assert.ok(Date.now() - t0 < 350, `rows came back in ${Date.now() - t0} ms, not after the slow check`);
    assert.equal(list.duplicate_check, 'pending');
    assert.equal(list.duplicate_check_pending, 3);
    assert.ok(list.rows.every((r) => r.review.duplicate_check === 'pending' && !r.review.flags.includes('possible_duplicate')), 'pending, never a false "clean"');
    const bulk = (await slowCall({ action: 'review_held', decision: 'approve', scope: 'all' })).jsonBody;
    assert.equal(bulk.changed, 0, 'nothing unverified is approved');
    assert.deepEqual(bulk.skipped.map((s) => [s.reason, s.count]), [['not_checked_for_duplicates', 3]]);
    assert.match(bulk.message, /3 not checked for duplicates — try again/);
  } finally { Object.assign(review.LIVE_CHECK, saved); }
  // With time, the same list and guard are exact again.
  const list2 = (await slowCall({ action: 'list_held_reports' })).jsonBody;
  assert.equal(list2.duplicate_check, 'done');
  assert.ok(list2.rows.every((r) => r.review.flags.includes('possible_duplicate')));
});

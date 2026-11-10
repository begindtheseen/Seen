// Round 7: one press = one execution for EVERY write (request_id); audit before write, always (hung or failed audit
// inserts write nothing); Clear stale counts what it will delete and keep; job_status reads the truth; words.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://db.test';
process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
delete process.env.STRIPE_SECRET_KEY;
const { default: handler } = await import('./admin-stats.js');
const { world, RPCS, caller, createFakeRest, uid } = await import('../lib/server/admin/testing/world.mjs');
const { IDEMPOTENT_WRITES, JOB_ACTIONS } = await import('../lib/server/admin/idempotency.js');
const { AUDIT_TUNING } = await import('../lib/server/admin/audit.js');
const words = await import('../lib/server/admin/words.js');
const C = await import('../lib/server/admin/testing/contract.mjs');

const ago = (ms) => new Date(Date.now() - ms).toISOString();

// A body for every write action (the world in testing/world.mjs).
function bodies(T) {
  return {
    moderate_report: { id: uid(1, '2'), decision: 'reject' },
    approve_report: { id: uid(1, '1') }, investigate_report: { id: uid(2, '2') }, deny_hiring_report: { id: uid(3, '2') },
    correct_report_outcome: { id: uid(4, '2'), outcome: 'ghosted' },
    resolve_listing_dispute: { id: 1, decision: 'denied' },
    delete_listing: { job_id: uid(6, '5') }, dismiss_inactive_report: { job_id: uid(3, '5') },
    remove_listing: { job_id: uid(7, '5') }, deny_report: { job_id: uid(8, '5') },
    update_reddit_dispute: { id: 1, status: 'reviewed' }, resolve_issue: { id: 1 }, dismiss_issue: { id: 2 },
    moderate_employer_reply: { reply_id: uid(1, '8'), decision: 'approve' }, fulfill_employer_purchase: { purchase_id: 1 },
    job_edit: { job_id: uid(9, '5'), patch: { title: 'New title' } }, job_update: { job_id: uid(10, '5'), patch: { title: 'Other title' } },
    job_restore: { job_id: uid(11, '5') }, set_job_target: { target: 33 },
    merge: { primary: 'walmart', secondary: 'walmart inc' }, auto_merge: { round: 1 }, undo_merge: { merge_id: 'none' },
    resplit_company: { name: 'nothing-to-split' }, company_recompute: { name: 'Walmart' },
    set_pro_window: { user_id: uid(1, '6'), until: new Date(Date.now() + 9 * 864e5).toISOString() }, set_pro: { user_id: uid(3, '6'), pro: true },
    grant_credits: { user_id: uid(1, '6'), amount: 5 }, set_user_password: { user_id: uid(4, '6'), new_password: 'longenough1' },
    delete_user: { user_id: uid(5, '6') }, update_cluster: { cluster_id: 1, status: 'safe' }, detect_duplicates_by_signals: {},
    set_flag: { flag_name: 'seenfit_engine_enabled', status: 'off' }, seed_flags: {},
    undo: null, // filled after a moderate
    review_reports: { decision: 'approve', ids: T.reports.filter((r) => r.needs_review).slice(0, 3).map((r) => r.id) },
    purge_stale_jobs: { round: 1 }, job_dupes_remove: { round: 1 }, dedupe_jobs: { round: 1 }, recompute_queue_drain: { round: 1 },
    refresh_demand: {}, emergency_job_refresh: {},
  };
}
const snapshot = (T) => JSON.stringify(Object.fromEntries(Object.entries(T).filter(([k]) => k !== 'admin_audit_log').map(([k, v]) => [k, v])));
const auditData = (T) => JSON.stringify(T.admin_audit_log.filter((a) => a.action !== 'request_result'));

test('every write action: two calls with one request_id change the database once', async () => {
  const missing = [...IDEMPOTENT_WRITES].filter((a) => !(a in bodies(world())));
  assert.deepEqual(missing, [], 'a body for every idempotent write');
  for (const action of IDEMPOTENT_WRITES) {
    const T = world();
    const fake = createFakeRest({ tables: T, rpcs: RPCS });
    const call = await caller(handler, fake);
    let body = bodies(T)[action];
    if (action === 'undo') {
      const m = (await call({ action: 'moderate_report', id: uid(2, '2'), decision: 'reject' })).jsonBody;
      body = { ...m.undo.args };
    }
    const request_id = `req-${action}-0001`;
    const first = await call({ action, ...body, request_id });
    const afterFirst = snapshot(fake.tables), auditFirst = auditData(fake.tables);
    const second = await call({ action, ...body, request_id });
    assert.equal(snapshot(fake.tables), afterFirst, `${action}: the second call changed data (first: ${first.statusCode} ${JSON.stringify(first.jsonBody).slice(0, 120)})`);
    assert.equal(auditData(fake.tables), auditFirst, `${action}: the second call wrote audit rows`);
    if (first.statusCode >= 200 && first.statusCode < 300) {
      assert.equal(second.jsonBody.replayed, true, `${action}: a replay says so`);
      assert.equal(second.jsonBody.changed, 0, `${action}: a replay changed nothing`);
      assert.equal(second.statusCode, first.statusCode);
    }
  }
});

test('the credit grant from the judge (F3): Retry after a slow first answer grants once', async () => {
  const fake = createFakeRest({ tables: world(), rpcs: RPCS });
  const call = await caller(handler, fake);
  const body = { action: 'grant_credits', user_id: uid(1, '6'), amount: 5, request_id: 'press-grant-0001' };
  const [a, b] = await Promise.all([call(body), call(body)]);
  const codes = [a.statusCode, b.statusCode].sort();
  assert.deepEqual(codes, [200, 409], 'the concurrent second press answers in_progress');
  assert.equal([a, b].find((r) => r.statusCode === 409).jsonBody.code, 'in_progress');
  assert.equal(fake.tables.ai_credits.find((c) => c.user_id === uid(1, '6')).balance, 12);
  const retry = await call(body);
  assert.equal(retry.jsonBody.replayed, true);
  assert.equal(fake.tables.ai_credits.find((c) => c.user_id === uid(1, '6')).balance, 12, 'balance 12, never 17');
  assert.equal(fake.tables.credit_transactions.filter((t) => t.reason === 'admin_grant').length, 1, 'one ledger row');
  // A failed first try (no write) is NOT replayed: Retry runs it.
  const f2 = createFakeRest({ tables: world(), rpcs: RPCS, faults: [{ match: '/ai_credits?user_id=eq.', method: 'PATCH', status: 500, times: 1 }] });
  const c2 = await caller(handler, f2);
  const failed = await c2({ ...body, request_id: 'press-grant-0002' });
  assert.equal(failed.statusCode, 502);
  const again = await c2({ ...body, request_id: 'press-grant-0002' });
  assert.equal(again.statusCode, 200);
  assert.notEqual(again.jsonBody.replayed, true);
});

test('job rounds are only idempotent when the round is named', () => {
  for (const a of JOB_ACTIONS) assert.ok(IDEMPOTENT_WRITES.has(a));
});

async function withAuditFault(fault, fn) {
  const fake = createFakeRest({ tables: world({ held: 30 }), rpcs: RPCS, faults: [fault] });
  const call = await caller(handler, fake);
  const saved = AUDIT_TUNING.timeoutMs;
  AUDIT_TUNING.timeoutMs = 80;
  try { return await fn(fake, call); } finally { AUDIT_TUNING.timeoutMs = saved; }
}
const held = (f) => f.tables.reports.filter((r) => r.needs_review && !['admin_rejected', 'duplicate_import'].includes(r.trust_reason)).length;

for (const [name, fault] of [['hung', { match: '/admin_audit_log?select=id', method: 'POST', delayMs: 400 }], ['failed', { match: '/admin_audit_log?select=id', method: 'POST', status: 500 }]]) {
  test(`a ${name} audit insert: bulk approve writes nothing and says so (retryable)`, async () => {
    await withAuditFault(fault, async (fake, call) => {
      const ids = fake.tables.reports.filter((r) => r.needs_review).map((r) => r.id);
      const r = await call({ action: 'review_held', decision: 'approve', ids, request_id: '0e0e0e0e-0000-4000-8000-00000000a0d1' });
      assert.ok(r.statusCode >= 500, JSON.stringify(r.jsonBody));
      assert.deepEqual(C.checkErr(r.jsonBody), []);
      assert.equal(r.jsonBody.retryable, true);
      assert.equal(held(fake), 30, 'nothing approved');
      assert.match(r.jsonBody.error, /nothing was changed/i);
    });
  });
  test(`a ${name} audit insert: a single decision writes nothing and says so (retryable)`, async () => {
    await withAuditFault(fault, async (fake, call) => {
      const before = JSON.stringify(fake.tables.reports);
      const r = await call({ action: 'moderate_report', id: uid(1, '2'), decision: 'reject' });
      assert.ok(r.statusCode >= 500);
      assert.equal(r.jsonBody.retryable, true);
      assert.equal(JSON.stringify(fake.tables.reports), before);
      const g = await call({ action: 'grant_credits', user_id: uid(1, '6'), amount: 5 });
      assert.ok(g.statusCode >= 500);
      assert.equal(fake.tables.ai_credits.find((c) => c.user_id === uid(1, '6')).balance, 7);
    });
  });
}

test('Clear stale: what will be deleted and what is kept, separately and exactly; job_status reads it', async () => {
  const T = world({ jobs: 0 });
  const mk = (i, o) => ({ id: uid(i, '61'), title: `T${i}`, company: 'c', location: `L${i}`, source: 's', is_employer_posted: false, availability_status: 'active', expires_at: new Date(Date.now() + 864e5).toISOString(), last_seen_at: ago(3600e3), created_at: ago(30 * 864e5), ...o });
  T.jobs = [];
  for (let i = 1; i <= 1000; i++) T.jobs.push(mk(i, { availability_status: 'stale', expires_at: ago(864e5), last_seen_at: ago(10 * 864e5) }));
  for (let i = 1001; i <= 1350; i++) T.jobs.push(mk(i, { availability_status: 'expired', expires_at: ago(864e5), last_seen_at: ago(20 * 864e5) }));
  for (let i = 1351; i <= 1400; i++) T.jobs.push(mk(i, { last_seen_at: ago(8 * 864e5) })); // aged → swept too
  T.saved_jobs = [...[5, 6, 1100, 1200, 1360].map((n, k) => ({ id: k + 1, job_id: uid(n, '61') }))];
  T.applications = [{ id: uid(1, '62'), job_id: uid(1101, '61') }];
  const fake = createFakeRest({ tables: T, rpcs: RPCS });
  const call = await caller(handler, fake);
  const c = (await call({ action: 'listing_counts' })).jsonBody;
  assert.deepEqual(c.clear_plan, { stale_delete: 998, expired_delete: 347, aging_delete: 49, kept_referenced: 6, expired_kept_referenced: 3, stale_total: 1000, expired_total: 350, aging_total: 50, will_delete: 1394 });
  const js = (await call({ action: 'job_status', kind: 'clear_stale' })).jsonBody;
  assert.deepEqual(C.checkOk(js), []);
  assert.equal(js.remaining, 1394);
  assert.equal((await call({ action: 'job_status', kind: 'recompute' })).jsonBody.complete, true);
  assert.equal(typeof (await call({ action: 'job_status', kind: 'auto_merge' })).jsonBody.remaining, 'number');
  assert.equal((await call({ action: 'job_status', kind: 'nope' })).statusCode, 400);
});

test('words: outcomes, articles, flag states, sources, dates, cron schedules in California time', () => {
  assert.equal(words.withArticle(words.outcomeLabel('autoreject')), 'an Auto-rejected');
  assert.equal(words.outcomeLabel('human'), 'Got a response');
  assert.equal(words.flagStatusWords('fully_on'), 'On for everyone');
  assert.equal(words.flagStatusWords('percentage_rollout', 25), 'On for 25% of users');
  assert.equal(words.sourceLabel({ trust_reason: 'external_import', platform: 'LinkedIn' }), 'Imported · LinkedIn');
  assert.equal(words.sourceLabel({ trust_reason: null, platform: 'Seen' }), 'Sent to Seen · Seen');
  assert.equal(words.dateWords('2026-11-30T12:00:00Z'), 'Nov 30, 2026');
  const at = (iso) => [new Date(iso)];
  assert.equal(words.scheduleWords(['*/15 * * * *'], []), 'Every 15 minutes');
  assert.equal(words.scheduleWords(['0 4 1 * *'], at('2026-12-01T04:00:00Z')), 'Last day of each month at 8:00 PM PT');
  assert.equal(words.scheduleWords(['0 15 * * *'], at('2026-11-11T15:00:00Z')), 'Daily at 7:00 AM PT');
});

test('sentences the server writes: held queue name, merge names, flag words', async () => {
  const fake = createFakeRest({ tables: world(), rpcs: RPCS });
  const call = await caller(handler, fake);
  const h = (await call({ action: 'moderate_report', id: uid(5, '2'), decision: 'hold' })).jsonBody;
  assert.equal(h.message, 'Moved back to Held reports.');
  const f = (await call({ action: 'set_flag', flag_name: 'seenfit_engine_enabled', status: 'fully_on' })).jsonBody;
  assert.match(f.message, /On for everyone/);
  await call({ action: 'merge', primary: 'walmart', secondary: 'walmart inc' });
  const log = (await call({ action: 'activity_log' })).jsonBody.rows;
  const m = log.find((r) => r.action === 'merge_companies');
  assert.equal(m.summary, 'Merged walmart inc into walmart');
  assert.ok(!log.some((r) => r.action === 'request_result'), 'idempotency records are not activity');
  const rows = (await call({ action: 'list_held_reports' })).jsonBody.rows;
  assert.ok(rows.every((r) => r.outcome_label && r.source_label));
});

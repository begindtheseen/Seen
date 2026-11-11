// Round 2: every count the admin shows is an exact count (Content-Range) or null — never the length of a page
// PostgREST capped at 1,000 rows. Each table here holds 2,500 rows; a page-length count would read 1,000.
// Also: the system line tells "no cron has recorded a run" apart from "all on time", and a big Undo runs in
// resumable rounds with running totals.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://db.test';
process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
const { default: handler } = await import('./admin-stats.js');
const { world, RPCS, caller, createFakeRest, uid } = await import('../lib/server/admin/testing/world.mjs');
const C = await import('../lib/server/admin/testing/contract.mjs');
const system = await import('../lib/server/admin/system.js');

const N = 2500;
const ago = (ms) => new Date(Date.now() - ms).toISOString();
const many = (fn) => Array.from({ length: N }, (_, i) => fn(i));

function bigWorld() {
  const T = world({ held: 0, liveReports: 0, jobs: 0 });
  T.reports = many((i) => ({ id: uid(i + 1, '11'), company_name: `Co ${i % 50}`, outcome: 'interview', role: 'r', platform: 'Indeed', source: 'external', created_at: ago(3600e3), report_text: `held ${i} unique text for the count test`, outcome_weight: 0.55, trust_reason: 'external_import', needs_review: true }));
  T.profiles = many((i) => ({ id: uid(i + 1, '12'), email: `p${i}@example.com`, created_at: ago(3600e3) }));
  T.ai_credits = many((i) => ({ user_id: uid(i + 1, '12'), balance: 1, pro: false, pro_until: new Date(Date.now() + 864e5).toISOString(), comped: false }));
  T.user_issues = many((i) => ({ id: i + 1, type: 't', target_type: 'company', target_name: 'x', notes: '', status: 'open', created_at: ago(3600e3) }));
  T.company_reddit_disputes = many((i) => ({ id: i + 1, company_name: 'x', company_key: 'x', reason: 'r', detail: '', permalink: '', contact: null, status: 'open', created_at: ago(3600e3) }));
  T.employer_report_replies = many((i) => ({ id: uid(i + 1, '13'), report_id: uid(1, '11'), company_key: 'x', body: 'b', status: 'pending', created_at: ago(3600e3) }));
  T.employer_purchases = many((i) => ({ id: i + 1, company: 'x', email: 'e', employer_sku: 'featured30', amount_cents: 100, status: 'paid', created_at: ago(3600e3) }));
  T.employer_company_claims = many((i) => ({ id: uid(i + 1, '14'), user_id: uid(1, '12'), company_name: 'x', company_display_name: 'X', status: 'pending', created_at: ago(3600e3) }));
  T.duplicate_clusters = many((i) => ({ id: i + 1, user_ids: [], signals: [], risk_score: 10, status: 'suspected', admin_note: null, created_at: ago(3600e3) }));
  T.listing_disputes = many((i) => ({ id: i + 1, job_id: `job-${i}`, company_name: 'x', company_key: 'x', employer_user_id: uid(1, '12'), kind: 'other', reason: '', detail: '', proposed_changes: null, status: 'open', created_at: ago(3600e3) }));
  T.api_errors = many((i) => ({ id: i + 1, endpoint: '/api/x', error_msg: 'e', created_at: ago(3600e3), context: null }));
  T.job_availability_reports = [];
  T.credit_transactions = [];
  T.jobs = many((i) => ({ id: uid(i + 1, '15'), title: `T${i}`, company: 'c', location: `L${i}`, apply_url: null, source: 's', external_id: null, is_employer_posted: false, availability_status: 'stale', expires_at: ago(864e5), last_seen_at: ago(20 * 864e5), created_at: ago(30 * 864e5) }));
  return T;
}

test('overview (fallback path): every queue and stat counts all 2,500 rows', async () => {
  const fake = createFakeRest({ tables: bigWorld(), rpcs: RPCS });
  const call = await caller(handler, fake);
  const o = (await call({ action: 'overview' })).jsonBody;
  assert.deepEqual(C.checkOverview(o), []);
  assert.equal(o.source, 'fallback');
  for (const q of o.queues) assert.equal(q.count, N, `${q.key} = ${q.count}`);
  assert.equal(o.stats.listings_stale, N);
  assert.equal(o.stats.reports_24h, N);
  assert.equal(o.stats.signups_24h, N);
  assert.equal(o.stats.revenue_7d_cents, N * 100);
  assert.equal(o.extra.listings_counts_source, 'exact');
});

test('lists: totals and status counts are exact past 1,000', async () => {
  const fake = createFakeRest({ tables: bigWorld(), rpcs: RPCS });
  const call = await caller(handler, fake);
  const b = async (body) => (await call(body)).jsonBody;
  assert.equal((await b({ action: 'list_held_reports' })).total, N);
  assert.equal((await b({ action: 'issues_list' })).total, N);
  assert.equal((await b({ action: 'users_list' })).total, N);
  assert.equal((await b({ action: 'users_list', filter: 'pro' })).total, N);
  assert.equal((await b({ action: 'list_reddit_disputes' })).counts.open, N);
  assert.equal((await b({ action: 'list_employer_replies' })).counts.pending, N);
  assert.equal((await b({ action: 'list_listing_tickets' })).counts.open, N);
  assert.equal((await b({ action: 'clusters_list' })).total, N);
  assert.equal((await b({ action: 'errors_list' })).total_24h, N);
  assert.equal((await b({ action: 'revenue_summary', days: 7 })).rows[0].employer_cents, N * 100);
  assert.equal((await b({ action: 'listing_counts' })).counts.stale_clearable, N);
});

test('system line: no recorded run is "unknown", not "all on time"; a missed run is "failing"', () => {
  const row = (over) => ({ name: 'x', path: '/api/x', schedule: '0 * * * *', last_run: null, last_result: 'unknown', next_run: null, overdue: false, ...over });
  const u = system.systemLine([row(), row({ name: 'y' })]);
  assert.deepEqual({ ok: u.ok, state: u.state, recorded: u.recorded, unknown: u.unknown }, { ok: false, state: 'unknown', recorded: 0, unknown: 2 });
  const g = system.systemLine([row({ last_run: ago(60e3), last_result: 'ok' }), row({ name: 'y' })]);
  assert.deepEqual({ ok: g.ok, state: g.state, recorded: g.recorded, unknown: g.unknown }, { ok: true, state: 'ok', recorded: 1, unknown: 1 });
  const f = system.systemLine([row({ last_run: ago(9 * 3600e3), last_result: 'ok', overdue: true })]);
  assert.equal(f.state, 'failing');
  assert.equal(f.ok, false);
  assert.equal(f.failing.length, 1);
});

test('a big Undo runs in resumable rounds with running totals, and only the last round marks it undone', async () => {
  const fake = createFakeRest({ tables: world({ held: 1200, liveReports: 0, companies: ['A', 'B'] }), rpcs: RPCS });
  const call = await caller(handler, fake);
  const ids = fake.tables.reports.filter((r) => r.needs_review).map((r) => r.id);
  const a = (await call({ action: 'review_held', decision: 'approve', ids })).jsonBody;
  assert.equal(a.changed, 1200);
  const parent = () => fake.tables.admin_audit_log.find((x) => String(x.id) === a.undo.args.audit_id);
  system.UNDO_TUNING.roundMs = 1; // one chunk per round
  const seen = [];
  let r = (await call({ action: 'undo', ...a.undo.args })).jsonBody;
  seen.push(r);
  assert.equal(r.complete, false);
  assert.deepEqual(C.checkOk(r), []);
  assert.ok(r.cursor && r.remaining > 0 && r.total === 1200 && r.restored > 0, JSON.stringify(r).slice(0, 200));
  assert.match(r.message, /^Restoring [\d,]+ of 1,200/);
  assert.ok(!parent().metadata.undone_at, 'an interrupted undo never claims to be done');
  assert.equal(parent().metadata.undo_progress.restored, r.restored);
  // "Cancel" here = stop calling; a later Undo press resumes from where it stopped.
  for (let i = 0; i < 200 && !r.complete; i++) { r = (await call({ action: 'undo', ...a.undo.args, cursor: r.cursor })).jsonBody; seen.push(r); }
  system.UNDO_TUNING.roundMs = 40_000;
  assert.equal(r.complete, true);
  assert.equal(r.restored, 1200);
  assert.equal(r.remaining, 0);
  assert.ok(seen.length > 2, `took ${seen.length} rounds`);
  for (let i = 1; i < seen.length; i++) assert.ok(seen[i].restored >= seen[i - 1].restored, 'running totals never go backwards');
  assert.equal(seen.reduce((n, x) => n + x.changed, 0), 1200, 'each row restored once across rounds');
  assert.ok(parent().metadata.undone_at, 'marked undone only when complete');
  assert.equal(fake.tables.reports.filter((x) => x.needs_review).length, 1200);
  assert.equal((await call({ action: 'undo', ...a.undo.args })).statusCode, 409);
});

// Every action in lib/server/admin/SHAPES.md answers the contract (components/admin2/contract.ts).
// The real handler runs against an in-memory PostgREST (lib/server/admin/testing/fakeRest.mjs) with a
// signed-in owner; one validator (testing/contract.mjs) checks each answer.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://db.test';
process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
delete process.env.STRIPE_SECRET_KEY;
const { default: handler, ACTIONS } = await import('./admin-stats.js');
const { world, RPCS, caller, createFakeRest, uid } = await import('../lib/server/admin/testing/world.mjs');
const C = await import('../lib/server/admin/testing/contract.mjs');

const fake = createFakeRest({ tables: world(), rpcs: RPCS });
const call = await caller(handler, fake);

const ok = (r) => C.checkOk(r.jsonBody);
const lst = (rowCheck) => (r) => C.checkList(r.jsonBody, rowCheck);
const err = (r) => C.checkErr(r.jsonBody);
const either = (r) => (r.jsonBody?.ok === false ? C.checkErr(r.jsonBody) : C.checkOk(r.jsonBody));

async function expectShape(name, body, check, status = 200) {
  const r = await call(body);
  if (status !== null) assert.equal(r.statusCode, status, `${name}: HTTP ${r.statusCode} ${JSON.stringify(r.jsonBody).slice(0, 300)}`);
  const problems = check(r);
  assert.deepEqual(problems, [], `${name}: ${problems.join('; ')} — ${JSON.stringify(r.jsonBody).slice(0, 400)}`);
  return r.jsonBody;
}

const covered = new Set();
const run = (name, body, check, status) => { covered.add(body.action); return expectShape(name, body, check, status); };

test('session and Today', async () => {
  await run('whoami', { action: 'whoami' }, ok);
  const o = await run('overview', { action: 'overview' }, (r) => C.checkOverview(r.jsonBody));
  assert.equal(o.queues.find((q) => q.key === 'held_reports').count, 12);
  assert.equal(o.queues.find((q) => q.key === 'data_issues').count, 2);
  assert.equal(o.queues.find((q) => q.key === 'listing_tickets').count, 2, 'one ticket from seeker reports + one open employer dispute');
  assert.equal(o.stats.revenue_7d_cents, 999 + 4900, 'one Interview Prep purchase + one employer purchase, one-time only');
  await run('search company', { action: 'search', q: 'walmart' }, (r) => C.checkSearch(r.jsonBody));
  const s = await run('search id', { action: 'search', q: uid(1, '1') }, (r) => C.checkSearch(r.jsonBody));
  assert.equal(s.results[0].kind, 'report');
  await run('cron_health', { action: 'cron_health' }, lst(C.checkCron));
});

test('review', async () => {
  const held = await run('list_held_reports', { action: 'list_held_reports' }, lst());
  assert.equal(held.total, 12);
  const ids = held.rows.slice(0, 3).map((r) => r.id);
  const a = await run('review_held', { action: 'review_held', decision: 'approve', ids }, ok);
  assert.equal(a.changed, 3);
  assert.ok(a.undo, 'a bulk decision offers undo');
  await run('recompute_queue_drain', { action: 'recompute_queue_drain' }, ok);
  await run('reports_recent', { action: 'reports_recent', limit: 5 }, lst());
  await run('reports_recent state', { action: 'reports_recent', state: 'held' }, lst());
  await run('report_detail', { action: 'report_detail', id: uid(1, '2') }, ok);
  await run('reports_stats', { action: 'reports_stats' }, ok);
  const m = await run('moderate_report', { action: 'moderate_report', id: uid(2, '2'), decision: 'reject' }, ok);
  assert.equal(m.changed, 1);
  const u = await run('undo', { action: 'undo', ...m.undo.args }, ok);
  assert.equal(u.changed, 1);
  await run('undo twice', { action: 'undo', ...m.undo.args }, err, 409);
  await run('activity_log', { action: 'activity_log' }, lst(C.checkActivityRow));
  await run('scan_report_dupes', { action: 'scan_report_dupes' }, lst());
  await run('dedupe_reports', { action: 'dedupe_reports' }, ok);
  await run('list_listing_tickets', { action: 'list_listing_tickets' }, lst());
  await run('resolve_listing_dispute', { action: 'resolve_listing_dispute', id: 1, decision: 'denied' }, ok);
  await run('dismiss_inactive_report', { action: 'dismiss_inactive_report', job_id: uid(3, '5') }, ok);
  await run('list_reddit_disputes', { action: 'list_reddit_disputes' }, lst());
  await run('update_reddit_dispute', { action: 'update_reddit_dispute', id: 1, status: 'reviewed' }, ok);
  await run('issues_list', { action: 'issues_list' }, lst());
  await run('resolve_issue', { action: 'resolve_issue', id: 1 }, ok);
  await run('dismiss_issue', { action: 'dismiss_issue', id: 2 }, ok);
  await run('list_employer_replies', { action: 'list_employer_replies' }, lst());
  await run('moderate_employer_reply', { action: 'moderate_employer_reply', reply_id: uid(1, '8'), decision: 'approve' }, ok);
  await run('list_employer_purchases', { action: 'list_employer_purchases' }, lst());
  const f = await run('fulfill_employer_purchase', { action: 'fulfill_employer_purchase', purchase_id: 1 }, ok);
  assert.equal(f.changed, 1);
  const f2 = await run('fulfill twice', { action: 'fulfill_employer_purchase', purchase_id: 1 }, ok);
  assert.equal(f2.changed, 0, 'a second press grants nothing');
});

test('listings', async () => {
  const c = await run('listing_counts', { action: 'listing_counts' }, ok);
  assert.equal(c.counts.total, 30);
  const b = await run('listings_browse', { action: 'listings_browse', filters: { limit: 10 } }, lst());
  assert.equal(b.rows.length, 10);
  assert.ok(b.next, 'a next page cursor');
  const b2 = await run('listings_browse page 2', { action: 'listings_browse', filters: { limit: 10 }, after: b.next }, lst());
  assert.ok(!b2.rows.some((r) => b.rows.find((x) => x.id === r.id)), 'page 2 has no repeats');
  const jid = uid(4, '5');
  await run('job_detail', { action: 'job_detail', job_id: jid }, ok);
  const e = await run('job_edit', { action: 'job_edit', job_id: jid, patch: { title: 'Edited title' } }, ok);
  assert.equal(e.changed, 1);
  const d = await run('delete_listing', { action: 'delete_listing', job_id: jid }, ok);
  assert.ok(d.undo);
  const und = await run('undo take-down', { action: 'undo', ...d.undo.args }, ok);
  assert.equal(und.changed, 1);
  await run('job_restore', { action: 'job_restore', job_id: jid }, ok);
  const p = await run('purge_stale_jobs', { action: 'purge_stale_jobs' }, ok);
  assert.equal(p.complete, true);
  const sc = await run('job_dupes_scan', { action: 'job_dupes_scan' }, ok);
  assert.equal(sc.complete, true);
  await run('job_dupes_remove', { action: 'job_dupes_remove' }, ok);
  await run('get_job_target', { action: 'get_job_target' }, ok);
  await run('set_job_target', { action: 'set_job_target', target: 22 }, ok);
  await run('get_jobs_grouped', { action: 'get_jobs_grouped' }, lst());
  await run('get_company_jobs', { action: 'get_company_jobs', company: 'Tesla' }, lst());
});

test('companies', async () => {
  await run('companies_list', { action: 'companies_list', q: 'wal' }, lst());
  await run('company_detail', { action: 'company_detail', name: 'Walmart' }, ok);
  await run('company_recompute', { action: 'company_recompute', name: 'Walmart' }, either, null);
  const dup = await run('find_duplicates', { action: 'find_duplicates' }, lst());
  assert.ok(dup.rows.some((g) => g.key === 'walmart'));
  const mg = await run('merge', { action: 'merge', primary: 'walmart', secondary: 'walmart inc' }, ok);
  await run('list_merges', { action: 'list_merges' }, lst());
  const um = await run('undo merge', { action: 'undo', ...mg.undo.args }, ok);
  assert.equal(um.changed, 1);
  await run('resplit_company (nothing left to split)', { action: 'resplit_company', name: 'walmart inc' }, err, 404);
  await run('auto_merge', { action: 'auto_merge' }, ok);
  await run('export_company', { action: 'export_company', company: 'Tesla' }, either, null);
  covered.add('undo_merge');
});

test('people', async () => {
  const u = await run('users_list', { action: 'users_list' }, lst());
  assert.equal(u.total, 5);
  const pro = await run('users_list pro', { action: 'users_list', filter: 'pro' }, lst());
  assert.equal(pro.rows.length, 1);
  await run('user_detail', { action: 'user_detail', user_id: uid(1, '6') }, ok);
  const before = fake.tables.ai_credits.find((c) => c.user_id === uid(2, '6')).balance;
  const w = await run('set_pro_window end', { action: 'set_pro_window', user_id: uid(2, '6'), until: null }, ok);
  assert.equal(fake.tables.ai_credits.find((c) => c.user_id === uid(2, '6')).balance, before, 'ending Pro never touches the balance');
  await run('undo pro', { action: 'undo', ...w.undo.args }, ok);
  await run('set_pro legacy', { action: 'set_pro', user_id: uid(2, '6'), pro: false }, ok);
  assert.equal(fake.tables.ai_credits.find((c) => c.user_id === uid(2, '6')).balance, before, 'the legacy alias never touches the balance');
  const g = await run('grant_credits', { action: 'grant_credits', user_id: uid(1, '6'), amount: 5 }, ok);
  assert.equal(g.balance, 12);
  await run('undo credits', { action: 'undo', ...g.undo.args }, ok);
  assert.equal(fake.tables.ai_credits.find((c) => c.user_id === uid(1, '6')).balance, 7);
  await run('set_user_password', { action: 'set_user_password', user_id: uid(5, '6'), new_password: 'longenough1' }, ok);
  await run('delete_user', { action: 'delete_user', user_id: uid(5, '6') }, ok);
  await run('clusters_list', { action: 'clusters_list' }, lst());
  await run('update_cluster', { action: 'update_cluster', cluster_id: 1, status: 'safe' }, ok);
  await run('detect_duplicates_by_signals', { action: 'detect_duplicates_by_signals' }, ok);
  await run('signup_attribution', { action: 'signup_attribution' }, either, null);
});

test('system', async () => {
  const f = await run('flags_list', { action: 'flags_list' }, lst());
  assert.ok(f.rows.find((r) => r.flag_name === 'ai_credit_system_enabled').dangerous);
  assert.ok(f.unread.includes('job_refresh_enabled'), 'a flag no code reads is listed as unread, not as a toggle');
  await run('set_flag dangerous w/o confirm', { action: 'set_flag', flag_name: 'ai_credit_system_enabled', status: 'off' }, err, 400);
  await run('set_flag unread', { action: 'set_flag', flag_name: 'job_refresh_enabled', status: 'off' }, err, 400);
  await run('set_flag', { action: 'set_flag', flag_name: 'seenfit_engine_enabled', status: 'fully_on' }, ok);
  await run('seed_flags', { action: 'seed_flags' }, ok);
  await run('errors_list', { action: 'errors_list' }, lst());
  const rv = await run('revenue_summary', { action: 'revenue_summary', days: 7 }, ok);
  assert.equal(rv.rows[0].total_cents, 999 + 4900);
  await run('revenue_funnel', { action: 'revenue_funnel' }, ok);
  await run('search_opportunities', { action: 'search_opportunities' }, either, null);
  await run('list_growth_rewards', { action: 'list_growth_rewards' }, ok);
  await run('recent_events', { action: 'recent_events' }, ok);
  await run('export_csv', { action: 'export_csv' }, ok);
  await run('get_kpi_detail', { action: 'get_kpi_detail', metric: 'total_accounts' }, lst());
  await run('list_subscriptions', { action: 'list_subscriptions' }, lst());
});

test('round 4: db size, source health, grant reason, sign-up source, one cluster, flag undo, groups, runs', async () => {
  // (1) db_size: neither size function is deployed in this fake → null, never a guess.
  const d0 = await run('db_size (unreadable)', { action: 'db_size' }, ok);
  assert.equal(d0.rows[0].db_size, null);
  // (2) per-source health (fallback: distinct sources by index steps, exact counts).
  const sh = await run('source_health', { action: 'source_health' }, lst());
  const gh = sh.rows.find((x) => x.source === 'greenhouse');
  assert.equal(gh.live, fake.tables.jobs.filter((j) => j.source === 'greenhouse' && j.availability_status === 'active' && new Date(j.expires_at) > new Date()).length);
  assert.equal(typeof gh.failing, 'boolean');
  // (3) a credit grant's reason reaches the ledger and the audit row.
  const g = await run('grant with reason', { action: 'grant_credits', user_id: uid(3, '6'), amount: 3, reason: 'Refund for a failed tailor' }, ok);
  assert.match(g.message, /Refund for a failed tailor/);
  const det = await run('user_detail ledger', { action: 'user_detail', user_id: uid(3, '6') }, ok);
  assert.equal(det.rows[0].ledger[0].note, 'Refund for a failed tailor');
  assert.equal(fake.tables.admin_audit_log.filter((a) => a.action === 'grant_credits').pop().metadata.reason, 'Refund for a failed tailor');
  // (4) sign-up source: null without a row; the row (and its groups) when there is one.
  assert.equal(det.rows[0].signup_source, null);
  fake.tables.signup_attribution = [{ user_id: uid(3, '6'), landing_path: '/company/walmart', referrer_host: 'www.google.com', utm_source: null, utm_medium: null, utm_campaign: null, ref_code: null, first_seen_at: new Date().toISOString() }];
  const det2 = await run('user_detail signup', { action: 'user_detail', user_id: uid(3, '6') }, ok);
  assert.equal(det2.rows[0].signup_source.landing_path, '/company/walmart');
  assert.ok(det2.rows[0].signup_source.referrer_group);
  // (5) one cluster, by a numeric id (production) and by a uuid (the rig).
  const cl = await run('cluster_detail', { action: 'cluster_detail', cluster_id: 1 }, ok);
  assert.deepEqual(cl.rows[0].users.map((u) => u.email), ['person1@example.com', 'person2@example.com']);
  fake.tables.duplicate_clusters.push({ id: uid(7, 'c'), user_ids: [uid(1, '6')], signals: ['ip:5.5.5.5'], risk_score: 30, status: 'suspected', admin_note: null, created_at: new Date().toISOString() });
  await run('cluster_detail uuid', { action: 'cluster_detail', cluster_id: uid(7, 'c') }, ok);
  const uc = await run('update_cluster uuid', { action: 'update_cluster', cluster_id: uid(7, 'c'), status: 'watching' }, ok);
  await run('undo cluster uuid', { action: 'undo', ...uc.undo.args }, ok);
  // (6) a flag that had no row: Undo deletes the row it created.
  fake.tables.feature_flags = fake.tables.feature_flags.filter((f) => f.flag_name !== 'humanproof_enabled');
  const sf = await run('set_flag new row', { action: 'set_flag', flag_name: 'humanproof_enabled', status: 'off' }, ok);
  const uf = await run('undo created flag', { action: 'undo', ...sf.undo.args }, ok);
  assert.equal(uf.changed, 1);
  assert.ok(!fake.tables.feature_flags.some((f) => f.flag_name === 'humanproof_enabled'));
  // (7) auto-merge counts groups, one unit for changed / remaining / message.
  fake.tables.company_scores.push({ id: uid(50, '3'), company_name: 'acme', overall_score: 50, report_count: 2 }, { id: uid(51, '3'), company_name: 'acme, inc.', overall_score: 40, report_count: 1 }, { id: uid(52, '3'), company_name: 'acme llc', overall_score: 40, report_count: 1 });
  const am = await run('auto_merge groups', { action: 'auto_merge' }, ok);
  assert.equal(am.changed, am.groups.length, 'changed counts groups');
  assert.equal(am.changed + am.remaining <= am.groups_total, true);
  assert.match(am.message, /group/);
  // (8) the two runs: listings cannot run in this function (clear reason + where to run it); demand answers the contract.
  await run('refresh_jobs', { action: 'refresh_jobs' }, (r) => { const p = C.checkErr(r.jsonBody); if (r.jsonBody.code !== 'not_available' || r.jsonBody.run?.path !== '/api/refresh-jobs') p.push('not_available + run'); return p; }, 501);
  await run('refresh_demand', { action: 'refresh_demand' }, either, null);
  await run('job_status', { action: 'job_status', kind: 'clear_stale' }, ok);
  const co = await run('correct_report_outcome', { action: 'correct_report_outcome', id: uid(3, '2'), outcome: 'ghosted' }, ok);
  assert.equal(co.changed, 1);
});

test('db_size reads admin_db_size, else jobs_storage_status (what the legacy page reads)', async () => {
  const MB = 1024 * 1024;
  const legacy = createFakeRest({ tables: world(), rpcs: { ...RPCS, jobs_storage_status: () => ({ db_bytes: 946 * MB, enabled: true, max_mb: 6000, blocking: false }) } });
  const a = (await (await caller(handler, legacy))({ action: 'db_size' })).jsonBody.db_size;
  assert.deepEqual([a.total_mb, a.jobs_mb, a.guard_max_mb, a.used_pct, a.source], [946, null, 6000, 16, 'jobs_storage_status']);
  const full = createFakeRest({ tables: world(), rpcs: { ...RPCS, admin_db_size: () => ({ db_bytes: 946 * MB, jobs_bytes: 625 * MB, max_mb: 6000, enabled: true }) } });
  const b = (await (await caller(handler, full))({ action: 'db_size' })).jsonBody.db_size;
  assert.deepEqual([b.total_mb, b.jobs_mb, b.jobs_pct, b.source], [946, 625, 66, 'admin_db_size']);
});

test('source_health: exact counts past 1,000 rows, the RPC and the fallback agree', async () => {
  const T = world({ jobs: 0 });
  const ago = (ms) => new Date(Date.now() - ms).toISOString();
  T.jobs = Array.from({ length: 2500 }, (_, i) => ({ id: uid(i + 1, '55'), title: 't', company: 'c', location: 'l', source: i % 5 ? 'adzuna' : 'lever', availability_status: 'active', expires_at: new Date(Date.now() + 864e5).toISOString(), last_seen_at: ago(3600e3), created_at: ago(i % 2 ? 3600e3 : 3 * 864e5), is_employer_posted: false }));
  T.jobs.push({ id: uid(9999, '55'), title: 't', company: 'c', location: 'l', source: 'workday', availability_status: 'stale', expires_at: ago(864e5), last_seen_at: ago(5 * 864e5), created_at: ago(9 * 864e5), is_employer_posted: false });
  const SQL = { admin_source_health: ({ p_today }, X) => {
    const by = new Map();
    for (const j of X.jobs) { const k = j.source || '(none)'; const g = by.get(k) || { source: k, live: 0, added_24h: 0, added_today: 0, last_seen: null }; if (j.availability_status === 'active' && new Date(j.expires_at) > new Date()) g.live++; if (Date.parse(j.created_at) >= Date.now() - 864e5) g.added_24h++; if (Date.parse(j.created_at) >= Date.parse(p_today)) g.added_today++; if (!g.last_seen || j.last_seen_at > g.last_seen) g.last_seen = j.last_seen_at; by.set(k, g); }
    return [...by.values()];
  } };
  const pick = (r) => r.rows.map((x) => [x.source, x.live, x.added_24h, x.failing]);
  const without = (await (await caller(handler, createFakeRest({ tables: structuredClone(T), rpcs: RPCS })))({ action: 'source_health' })).jsonBody;
  const withSql = (await (await caller(handler, createFakeRest({ tables: structuredClone(T), rpcs: { ...RPCS, ...SQL } })))({ action: 'source_health' })).jsonBody;
  assert.equal(without.source, 'exact');
  assert.equal(withSql.source, 'admin_source_health');
  assert.deepEqual(pick(without), pick(withSql));
  assert.deepEqual(pick(without), [['adzuna', 2000, 1000, false], ['lever', 500, 250, false], ['workday', 0, 0, true]]);
  assert.match(without.rows[2].why, /No live listings/);
});

test('errors are AdminErr: unknown action, signed out, bad input', async () => {
  const r = await call({ action: 'nope' });
  assert.equal(r.statusCode, 400);
  assert.deepEqual(C.checkErr(r.jsonBody), []);
  assert.equal(r.jsonBody.code, 'unknown_action');
  assert.ok(r.jsonBody.actions.includes('review_held'));
  const s = await call({ action: 'overview' }, { token: 'b'.repeat(64) });
  assert.equal(s.statusCode, 401);
  assert.deepEqual(C.checkErr(s.jsonBody), []);
  assert.equal(s.jsonBody.code, 'unauthorized');
  const b = await call({ action: 'review_held', decision: 'maybe', ids: [] });
  assert.equal(b.statusCode, 400);
  assert.deepEqual(C.checkErr(b.jsonBody), []);
});

test('GET only reads: an action name on GET that is not a read is refused', async () => {
  const r = await call(undefined, { method: 'GET', query: { action: 'review_held' } });
  assert.equal(r.statusCode, 400);
  assert.equal(r.jsonBody.ok, false);
});

test('every new-UI action in SHAPES.md is covered here', () => {
  // Legacy-only names (their answers keep old fields for /admin/legacy and Seen Command; their own tests cover them).
  const legacy = new Set(['review_reports', 'jobs_browse', 'job_update', 'scan_job_dupes', 'dedupe_jobs', 'approve_report', 'investigate_report', 'deny_hiring_report', 'get_recent_jobs', 'list_listing_disputes', 'remove_listing', 'deny_report', 'emergency_job_refresh', 'admin_logout']);
  const missing = Object.keys(ACTIONS).filter((a) => !legacy.has(a) && !covered.has(a));
  assert.deepEqual(missing, [], `actions without a contract check: ${missing.join(', ')}`);
});

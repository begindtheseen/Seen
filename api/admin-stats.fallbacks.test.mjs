// Every reader works before the owner applies the admin migrations: each RPC / table answers 404 in one run and
// exists in the other, and the answer is the same. The RPC stand-ins below implement the SQL in
// supabase/migrations/20261111110000_admin_rpcs.sql in JavaScript (the SQL itself cannot run here).
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://db.test';
process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
const { default: handler } = await import('./admin-stats.js');
const { world, RPCS, caller, createFakeRest } = await import('../lib/server/admin/testing/world.mjs');
const C = await import('../lib/server/admin/testing/contract.mjs');

const pending = (r) => r.needs_review === true && !['admin_rejected', 'duplicate_import'].includes(r.trust_reason);
const EMP = /\bemployee (?:review|discussion)\b/i;
const since = (ms) => Date.now() - ms;

const SQL = {
  admin_overview: ({ p_today }, T) => ({
    held_reports: T.reports.filter(pending).length,
    reddit_disputes: T.company_reddit_disputes.filter((x) => x.status === 'open').length,
    employer_claims: T.employer_company_claims.filter((x) => x.status === 'pending').length,
    employer_replies: T.employer_report_replies.filter((x) => x.status === 'pending').length,
    purchases_to_fulfil: T.employer_purchases.filter((x) => x.status === 'paid').length,
    data_issues: T.user_issues.filter((x) => x.status === 'open').length,
    account_clusters: T.duplicate_clusters.filter((x) => x.status === 'suspected').length,
    reports_24h: T.reports.filter((x) => Date.parse(x.created_at) >= since(864e5)).length,
    signups_24h: T.profiles.filter((x) => Date.parse(x.created_at) >= since(864e5)).length,
    reports_7d: T.reports.filter((x) => Date.parse(x.created_at) >= since(7 * 864e5)).length,
    signups_7d: T.profiles.filter((x) => Date.parse(x.created_at) >= since(7 * 864e5)).length,
    signups_today: T.profiles.filter((x) => Date.parse(x.created_at) >= Date.parse(p_today)).length,
    errors_24h: T.api_errors.filter((x) => Date.parse(x.created_at) >= since(864e5)).length,
    recompute_waiting: (T.company_recompute_queue || []).length,
  }),
  admin_review_reports: ({ p_ids, p_decision, p_admin, p_admin_id, p_batch }, T) => {
    const changed = [], companies = new Set();
    T.company_recompute_queue ||= [];
    for (const r of T.reports.filter((x) => p_ids.includes(x.id) && pending(x))) {
      const prior = { needs_review: r.needs_review, trust_reason: r.trust_reason, outcome_weight: r.outcome_weight };
      const employee = r.trust_reason === 'external_employee_review' || EMP.test(r.report_text || '');
      const next = p_decision === 'reject' ? { needs_review: true, trust_reason: 'admin_rejected', outcome_weight: 0 } : employee ? { needs_review: false, trust_reason: 'external_employee_review' } : { needs_review: false };
      Object.assign(r, next);
      T.admin_audit_log.push({ id: 900000 + T.admin_audit_log.length, admin_id: p_admin_id, username: p_admin, action: `${p_decision}_held_report`, target_type: 'report', target_id: r.id, metadata: { batch_id: p_batch, company: r.company_name, prior, next }, created_at: new Date().toISOString() });
      changed.push(r.id);
      const k = String(r.company_name || '').toLowerCase().trim();
      if (k) { companies.add(k); if (!T.company_recompute_queue.find((q) => q.company_key === k)) T.company_recompute_queue.push({ company_key: k, enqueued_at: new Date().toISOString(), attempts: 0 }); }
    }
    const rest = [...new Set(p_ids)].filter((id) => !changed.includes(id));
    const mine = rest.filter((id) => T.admin_audit_log.some((a) => a.target_id === id && a.metadata?.batch_id === p_batch && /_held_report$/.test(a.action)));
    const st = rest.filter((id) => !mine.includes(id)).map((id) => ({ id, r: T.reports.find((x) => x.id === id) }));
    return { changed, companies: [...companies], audited: changed.length, queued: companies.size, batch_id: p_batch, done_last_try: mine, missing: st.filter((x) => !x.r).map((x) => x.id), not_held: st.filter((x) => x.r && x.r.needs_review !== true).map((x) => x.id), already_decided: st.filter((x) => x.r && x.r.needs_review === true).map((x) => x.id) };
  },
  admin_job_dupes_plan: ({ p_after, p_limit }, T) => {
    const keyed = new Map();
    const add = (k, id) => { if (!keyed.has(k)) keyed.set(k, []); keyed.get(k).push(id); };
    for (const j of T.jobs) {
      if (String(j.title || '').trim()) add(`loc:${j.title.toLowerCase()}|${String(j.company || '').toLowerCase()}|${String(j.location || '').toLowerCase().replace(/[^a-z0-9]+/g, '')}`, j.id);
      if (j.external_id != null) add(`ext:${String(j.source || '').toLowerCase()}|${j.external_id}`, j.id);
    }
    return [...keyed.entries()].filter(([, ids]) => ids.length > 1).map(([k, ids]) => ({ k, ids: ids.sort() })).filter((g) => !p_after || g.k > p_after).sort((a, b) => (a.k < b.k ? -1 : 1)).slice(0, p_limit);
  },
};

async function both(build, fn) {
  const without = createFakeRest({ tables: build(), rpcs: RPCS, missing: ['company_recompute_queue', 'cron_runs'] });
  const withSql = createFakeRest({ tables: { ...build(), company_recompute_queue: [], cron_runs: [] }, rpcs: { ...RPCS, ...SQL } });
  return [await fn(without, await caller(handler, without)), await fn(withSql, await caller(handler, withSql))];
}

test('admin_overview: 404 → bounded counts → the same numbers', async () => {
  const [a, b] = await both(() => world({ held: 7 }), async (_f, call) => (await call({ action: 'overview' })).jsonBody);
  assert.equal(a.source, 'fallback');
  assert.equal(b.source, 'rpc');
  assert.deepEqual(C.checkOverview(a), []);
  assert.deepEqual(C.checkOverview(b), []);
  assert.deepEqual(a.queues, b.queues);
  assert.deepEqual(a.stats, b.stats);
  assert.equal(a.queues.find((q) => q.key === 'held_reports').count, 7);
  assert.equal(a.failed.length, 0);
});

test('admin_overview: a count that fails is null and named, never 0', async () => {
  const fake = createFakeRest({ tables: world(), rpcs: RPCS, faults: [{ match: '/rest/v1/user_issues?', status: 500 }] });
  const call = await caller(handler, fake);
  const o = (await call({ action: 'overview' })).jsonBody;
  assert.deepEqual(C.checkOverview(o), []);
  assert.equal(o.queues.find((q) => q.key === 'data_issues').count, null);
  assert.ok(o.failed.includes('data_issues'));
  assert.equal(o.degraded, true);
});

test('admin_review_reports: 404 → chunked writes → the same answer', async () => {
  const request_id = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const [a, b] = await both(() => world({ held: 90 }), async (f, call) => {
    const ids = f.tables.reports.filter(pending).map((r) => r.id);
    const first = (await call({ action: 'review_held', decision: 'reject', ids: [...ids, '00000000-0000-4000-8000-00000000dead'], request_id })).jsonBody;
    const again = (await call({ action: 'review_held', decision: 'reject', ids, request_id })).jsonBody;
    const rpcCalls = f.log.filter((e) => e.path === '/rest/v1/rpc/admin_review_reports').length;
    return { first, again, rpcCalls, audits: f.tables.admin_audit_log.filter((x) => x.action === 'reject_held_report').length, left: f.tables.reports.filter(pending).length };
  });
  for (const k of ['changed', 'message']) assert.deepEqual(a.first[k], b.first[k], k);
  assert.deepEqual(a.first.skipped, b.first.skipped);
  assert.deepEqual(a.again.skipped, b.again.skipped);
  assert.equal(a.first.changed, 90);
  assert.deepEqual(a.first.skipped, [{ reason: 'not_found', count: 1, ids: ['00000000-0000-4000-8000-00000000dead'] }]);
  assert.equal(a.audits, 90); assert.equal(b.audits, 90);
  assert.equal(a.left, 0); assert.equal(b.left, 0);
  assert.equal(a.rpcCalls, 2, 'tried the RPC, got 404, fell back');
  assert.equal(b.rpcCalls, 2);
  assert.equal(a.first.recompute.mode, 'cursor', 'no queue table → the pending companies ride in the cursor');
  assert.equal(b.first.recompute.mode, 'table');
});

test('company_recompute_queue absent: the drain works through the carried cursor', async () => {
  const fake = createFakeRest({ tables: world({ held: 5, companies: Array.from({ length: 30 }, (_, i) => `Firm ${i}`) }), rpcs: RPCS, missing: ['company_recompute_queue'] });
  const call = await caller(handler, fake);
  const cursorList = Buffer.from(JSON.stringify({ c: ['firm 1', 'firm 2', 'firm 3'] })).toString('base64url');
  const d = (await call({ action: 'recompute_queue_drain', cursor: cursorList })).jsonBody;
  assert.deepEqual(C.checkOk(d), []);
  assert.equal(d.complete, true);
  assert.equal(d.changed + (d.skipped[0]?.count || 0), 3);
  const empty = (await call({ action: 'recompute_queue_drain' })).jsonBody;
  assert.equal(empty.complete, true, 'nothing carried and no table: nothing to do, never a loop');
});

test('admin_job_dupes_plan: 404 → whole-table scan → the same plan', async () => {
  const [a, b] = await both(() => world({ jobs: 60 }), async (f, call) => (await call({ action: 'job_dupes_scan' })).jsonBody);
  assert.equal(a.complete, true); assert.equal(b.complete, true);
  assert.equal(a.suspected, b.suspected);
  assert.ok(a.suspected > 0, 'the world has duplicates (same title, company and town)');
  assert.equal(a.groups, b.groups);
});

test('job dupes, a table too big for one request: resumable passes, never "did not finish"', async () => {
  const fake = createFakeRest({ tables: world({ jobs: 2500 }), rpcs: RPCS });
  const listings = await import('../lib/server/admin/listings.js');
  // Make the whole-table read "run out of time" on the first call by slowing every jobs page.
  const realFetch = fake.fetch;
  let slow = true;
  listings.TUNING.scanBudgetMs = 300;
  const slowFetch = async (u, o) => { if (slow && String(u).includes('/rest/v1/jobs?') && String(u).includes('order=id.asc')) await new Promise((r) => setTimeout(r, 200)); return realFetch(u, o); };
  fake.fetch = slowFetch;
  const call2 = await caller(handler, fake);
  const first = (await call2({ action: 'job_dupes_scan' })).jsonBody;
  assert.equal(first.complete, false);
  assert.ok(first.cursor, 'a cursor to resume from');
  slow = false;
  let r = first, rounds = 0;
  while (!r.complete && rounds < 20) { r = (await call2({ action: 'job_dupes_scan', cursor: r.cursor })).jsonBody; rounds++; }
  assert.equal(r.complete, true);
  assert.ok(r.suspected > 0);
  listings.TUNING.scanBudgetMs = listings.DEDUPE_SCAN_BUDGET_MS;
});

test('cron_runs absent: crons with no record read "unknown", never a guess', async () => {
  const fake = createFakeRest({ tables: world(), rpcs: RPCS, missing: ['cron_runs'] });
  const call = await caller(handler, fake);
  const c = (await call({ action: 'cron_health' })).jsonBody;
  assert.deepEqual(C.checkList(c, C.checkCron), []);
  const refresh = c.rows.find((x) => x.name === 'refresh-jobs');
  assert.equal(refresh.last_result, 'unknown');
  assert.equal(refresh.last_run, null);
  assert.equal(refresh.overdue, false);
  assert.ok(refresh.next_run);
  const archive = c.rows.find((x) => x.name === 'cron-archive-reports');
  assert.equal(archive.last_result, 'ok', 'collector_runs already records this one');
});


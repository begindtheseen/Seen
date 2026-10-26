// End-to-end tests for the enrichment worker + enqueue helper, fully offline: fake Supabase
// (routed by URL), fake Reddit feeds, fake archive. Extraction is the strict first-hand rules
// (lib/reports/applicantRules.js) — no model is called, and a guard on globalThis.fetch proves it.
// Run: node --test lib/server/companyEnrichmentWorker.test.mjs

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { runEnrichment } from './companyEnrichmentWorker.js';
import { enqueueCompanyEnrichment, enrichmentQueueStats } from './enrichmentQueue.js';
import { ENRICH_DEFAULTS } from '../../api/_utils/companyEnrichment.js';

const URL_ = 'https://sb.test';
const json = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body, text: async () => JSON.stringify(body), headers: { get: () => null } });
const xml = (status, text) => ({ status, ok: status >= 200 && status < 300, text: async () => text, json: async () => null, headers: { get: () => null } });

// Every I/O of the worker is injected; nothing may reach the global fetch, least of all a model host.
const MODEL_HOSTS = /(^|\.)(anthropic\.com|openai\.com|groq\.com)$/;
let realFetch;
let globalCalls;
beforeEach(() => {
  realFetch = globalThis.fetch;
  globalCalls = [];
  globalThis.fetch = async (u) => {
    globalCalls.push(String(u));
    if (MODEL_HOSTS.test(new URL(String(u)).hostname)) throw new Error(`model host called: ${u}`);
    throw new Error(`unexpected global fetch: ${u}`);
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
  assert.deepEqual(globalCalls, [], 'the worker never uses the global fetch (no model host, no stray I/O)');
});

// ── Fake Reddit ───────────────────────────────────────────────────────────────────
const searchEntry = (id, title, sub = 'recruitinghell') => `<entry><author><name>/u/a</name></author><category term="${sub}" label="r/${sub}"/><content type="html">&lt;p&gt;${title}&lt;/p&gt;</content><id>t3_${id}</id><link href="https://www.reddit.com/r/${sub}/comments/${id}/slug/"/><updated>2026-09-01T00:00:00+00:00</updated><title>${title}</title></entry>`;
// The opening post is a first-hand ghosting; comment c0 is chatter (no applicant event); comment c1 is a
// second applicant's own rejection; c2 is chatter.
const COMMENTS = [
  'Same thing happened to a friend of mine, comment number zero.',
  'Acme Corp rejected me after the phone screen last month, for a warehouse role.',
  'Has anyone else here applied to Acme Corp this year? Curious how it went.',
];
const commentFeed = (id, sub, n = 3) => `<feed>${[
  `<entry><author><name>/u/op</name></author><category term="${sub}"/><content type="html">&lt;p&gt;I applied to Acme Corp for a data role and never heard back after the final interview.&lt;/p&gt;</content><id>t3_${id}</id><link href="https://www.reddit.com/r/${sub}/comments/${id}/slug/"/><updated>2026-09-01T00:00:00+00:00</updated><title>Acme Corp ghosted me</title></entry>`,
  ...COMMENTS.slice(0, n).map((body, i) => `<entry><author><name>/u/u${i}</name></author><content type="html">&lt;p&gt;${body}&lt;/p&gt;</content><id>t1_c${i}</id><link href="https://www.reddit.com/r/${sub}/comments/${id}/slug/c${i}/"/></entry>`),
].join('')}</feed>`;

function fakeReddit({ searchItems = [['abc111', 'Acme Corp ghosted me after interview'], ['def222', 'Acme Corp recruiter interview process']], statusFor = () => 200 } = {}) {
  const calls = [];
  const fn = async (u) => {
    calls.push(u);
    const st = statusFor(u, calls.length);
    if (st !== 200) return xml(st, '');
    if (u.includes('/search/.rss')) return xml(200, `<feed>${searchItems.map(([id, t]) => searchEntry(id, t)).join('')}</feed>`);
    const m = /\/r\/([^/]+)\/comments\/([a-z0-9]+)\//.exec(u);
    return xml(200, commentFeed(m[2], m[1]));
  };
  return { fn, calls };
}

// ── Fake Supabase ─────────────────────────────────────────────────────────────────
function fakeDb({ claim = [{ company_key: 'acme', company_name: 'acme corp', attempts: 1 }], imported = [], claimStatus = 200, insertStatus = 201, cited = [], citedStatus = 200 } = {}) {
  const log = [];
  const fn = async (u, opts = {}) => {
    const path = u.replace(`${URL_}/rest/v1/`, '');
    const body = opts.body ? JSON.parse(opts.body) : null;
    log.push({ method: opts.method || 'GET', path, body });
    if (path.startsWith('rpc/claim_enrichment_batch')) return json(claimStatus, claimStatus === 200 ? claim : { message: 'missing' });
    if (path.startsWith('reddit_imports?reddit_post_id=in.')) return json(200, imported.map((id) => ({ reddit_post_id: id })));
    if (path.startsWith('reports?company_name=eq.')) return json(citedStatus, citedStatus === 200 ? cited.map((t) => ({ report_text: t })) : { message: 'bad' });
    if (path.startsWith('reports?select=id')) return json(insertStatus, insertStatus < 300 ? body.map((_, i) => ({ id: `r${i + 1}` })) : { message: 'bad' });
    if (path.startsWith('reddit_imports?on_conflict')) return json(201, null);
    if (path.startsWith('company_enrichment_queue?')) return json(204, null);
    return json(404, null);
  };
  const patches = () => log.filter((l) => l.method === 'PATCH').map((l) => ({ key: decodeURIComponent(/company_key=eq\.([^&]+)/.exec(l.path)[1]), ...l.body }));
  return { fn, log, patches };
}

function clock() {
  let t = Date.parse('2026-10-17T12:00:00Z');
  return { now: () => t, sleep: async (ms) => { t += ms; } };
}

function deps(over = {}) {
  const c = clock();
  const recomputed = [];
  const companies = [];
  return {
    url: URL_, key: 'svc', now: c.now, sleep: c.sleep,
    config: { ...ENRICH_DEFAULTS },
    resolveCompany: async (_u, _h, name) => { companies.push(name); return 'cid-1'; },
    recompute: async (_u, _h, name) => { recomputed.push(name); return true; },
    _recomputed: recomputed, _companies: companies,
    ...over,
  };
}

const ATTRIBUTION = / \[Public reddit\.com post, posted \d{4}-\d{2}-\d{2}: https:\/\/www\.reddit\.com\/r\/recruitinghell\/comments\/[a-z0-9]+\/(?:_\/[a-z0-9]+\/)?\]$/;

test('happy path: search → comments → the strict rules → reports + imports + recompute + done', async () => {
  const db = fakeDb();
  const reddit = fakeReddit();
  const d = deps({ fetchImpl: db.fn, redditFetch: reddit.fn });
  const s = await runEnrichment(d);
  assert.equal(s.ok, true);
  assert.equal(s.claimed, 1);
  // Each thread's opening poster (their own ghosting, judged with the thread's title) + c1's rejection.
  // The same words in two threads are ONE account, so def222's copy of c1 adds nothing.
  assert.equal(s.reports_added, 3);
  assert.equal(s.companies[0].status, 'done');
  assert.ok(s.companies[0].dropped.not_an_applicant_account >= 4, JSON.stringify(s.companies[0].dropped));
  assert.equal(s.companies[0].dropped.duplicate, 1);
  const ins = db.log.find((l) => l.path.startsWith('reports?select=id'));
  assert.equal(ins.body.length, 3);
  assert.deepEqual(ins.body.map((r) => r.outcome).sort(), ['ghosted', 'ghosted', 'rejected']);
  for (const row of ins.body) {
    assert.equal(row.source, 'reddit');
    assert.equal(row.outcome_weight, 0.3);
    assert.equal(row.trust_reason, 'reddit_rule_match');
    assert.equal(row.needs_review, false);
    assert.equal(row.company_name, 'acme corp');
    assert.equal(row.company_id, 'cid-1');
    assert.equal(row.role, '');
    assert.equal(row.location_id, null);
    assert.equal('city' in row, false);
    // The person's own words + the thread's own date in the attribution.
    assert.match(row.report_text, ATTRIBUTION);
  }
  // A comment's report links the comment itself (one report per post/comment across pipelines).
  const rej = ins.body.find((r) => r.outcome === 'rejected');
  assert.match(rej.report_text, /^Acme Corp rejected me after the phone screen/);
  assert.match(rej.report_text, /\/comments\/abc111\/_\/c1\/\]$/);
  const gh = ins.body.find((r) => r.outcome === 'ghosted' && /abc111/.test(r.report_text));
  assert.match(gh.report_text, /never heard back/);
  assert.match(gh.report_text, /\/comments\/abc111\/\]$/);
  assert.deepEqual(d._companies, ['Acme Corp']);
  // The cross-pipeline citation check ran once per thread that had accounts.
  assert.equal(db.log.filter((l) => l.path.startsWith('reports?company_name=eq.')).length, 2);
  // reddit_imports for every processed thread (ignore-duplicates on the unique post id).
  const imp = db.log.find((l) => l.path.startsWith('reddit_imports?on_conflict'));
  assert.deepEqual(imp.body.map((r) => r.reddit_post_id).sort(), ['t3_abc111', 't3_def222']);
  assert.equal(imp.body.find((r) => r.reddit_post_id === 't3_abc111').report_id, 'r1');
  assert.equal(imp.body.find((r) => r.reddit_post_id === 't3_def222').report_id, 'r3');
  assert.deepEqual(d._recomputed, ['acme corp']);
  const [p] = db.patches();
  assert.equal(p.status, 'done');
  assert.equal(p.reports_added, 3);
  assert.equal(p.threads_seen, 2);
  assert.equal('llm_called_at' in p, false);
  // The claim carries no daily cap (the rules cost nothing).
  const claim = db.log.find((l) => l.path.startsWith('rpc/claim_enrichment_batch'));
  assert.deepEqual(claim.body, { p_limit: ENRICH_DEFAULTS.batch, p_daily_max: null });
  // Egress: the dedupe read asks for one column only.
  assert.match(db.log.find((l) => l.path.startsWith('reddit_imports?reddit_post_id')).path, /select=reddit_post_id&/);
  // Politeness: biased search, broad fallback (thin), 2 comment feeds — all sequential.
  assert.equal(reddit.calls.length, 4);
});

test('a post/comment another pipeline already reported is skipped (one report per Reddit post/comment)', async () => {
  const db = fakeDb({ cited: ['Some earlier words [Source: https://www.reddit.com/r/recruitinghell/comments/abc111/acme_corp_ghosted_me/c1/]'] });
  const s = await runEnrichment(deps({ fetchImpl: db.fn, redditFetch: fakeReddit().fn }));
  assert.equal(s.reports_added, 2);
  assert.equal(s.companies[0].dropped.already_cited, 1);
  const ins = db.log.find((l) => l.path.startsWith('reports?select=id'));
  assert.deepEqual(ins.body.map((r) => r.outcome), ['ghosted', 'ghosted']);
});

test('the citation lookup failing refuses the write — company retried, nothing written', async () => {
  const db = fakeDb({ citedStatus: 500 });
  const s = await runEnrichment(deps({ fetchImpl: db.fn, redditFetch: fakeReddit().fn }));
  assert.equal(s.companies[0].status, 'retry');
  assert.equal(s.companies[0].reason, 'cited_lookup_500');
  assert.equal(db.log.some((l) => l.path.startsWith('reports?select=id')), false);
  assert.equal(db.log.some((l) => l.path.startsWith('reddit_imports?on_conflict')), false, 'threads stay un-imported so a retry can read them');
});

test('threads with no first-hand account: imported as skipped, company empty, no report written', async () => {
  const db = fakeDb();
  const reddit = { fn: async (u) => (u.includes('/search/.rss')
    ? xml(200, `<feed>${searchEntry('abc111', 'Acme Corp hiring process questions')}</feed>`)
    : xml(200, `<feed><entry><author><name>/u/op</name></author><content type="html">&lt;p&gt;Does anyone know how long Acme Corp takes to reply to an application?&lt;/p&gt;</content><id>t3_abc111</id><link href="https://www.reddit.com/r/recruitinghell/comments/abc111/slug/"/><title>Acme Corp hiring process questions</title></entry></feed>`)) };
  const s = await runEnrichment(deps({ fetchImpl: db.fn, redditFetch: reddit.fn }));
  assert.equal(s.companies[0].status, 'empty');
  assert.equal(db.log.some((l) => l.path.startsWith('reports')), false);
  const imp = db.log.find((l) => l.path.startsWith('reddit_imports?on_conflict'));
  assert.deepEqual(imp.body.map((r) => [r.reddit_post_id, r.skipped, r.skip_reason]), [['t3_abc111', true, 'no_applicant_accounts']]);
});

test('threads already in reddit_imports are skipped; nothing new → empty', async () => {
  const db = fakeDb({ imported: ['t3_abc111', 'def222'] });
  const s = await runEnrichment(deps({ fetchImpl: db.fn, redditFetch: fakeReddit().fn }));
  assert.equal(s.companies[0].status, 'empty');
  assert.equal(s.companies[0].note, 'all_imported');
  assert.equal(db.patches()[0].status, 'empty');
  assert.equal(db.log.some((l) => l.path.startsWith('reports')), false);
});

test('no relevant threads → empty without touching reports', async () => {
  const db = fakeDb();
  const s = await runEnrichment(deps({ fetchImpl: db.fn, redditFetch: fakeReddit({ searchItems: [['zzz999', 'Best pizza in town']] }).fn }));
  assert.equal(s.companies[0].status, 'empty');
  assert.equal(db.log.some((l) => l.path.startsWith('reports')), false);
});

test('reddit-only mode: two Reddit 429s stop the run and requeue every unfinished company with the attempt refunded', async () => {
  const db = fakeDb({ claim: [
    { company_key: 'acme', company_name: 'acme corp', attempts: 1 },
    { company_key: 'globex', company_name: 'globex', attempts: 2 },
  ] });
  const reddit = fakeReddit({ statusFor: () => 429 });
  const d = deps({ fetchImpl: db.fn, redditFetch: reddit.fn, arcticFetch: async () => { throw new Error('archive must not be used in reddit mode'); } });
  d.config = { ...ENRICH_DEFAULTS, source: 'reddit' };
  const s = await runEnrichment(d);
  assert.equal(s.stopped, 'reddit_429');
  assert.equal(reddit.calls.length, 2, 'stopped on the second 429 — no further requests');
  const ps = db.patches();
  assert.deepEqual(ps.map((p) => [p.key, p.status, p.attempts]), [['acme', 'queued', 0], ['globex', 'queued', 1]]);
  assert.ok(Date.parse(ps[0].next_eligible_at) > Date.parse('2026-10-17T12:00:00Z'));
});

test('queue missing → honest no-op', async () => {
  const db = fakeDb({ claimStatus: 404 });
  const s = await runEnrichment(deps({ fetchImpl: db.fn, redditFetch: fakeReddit().fn }));
  assert.equal(s.ok, false);
  assert.equal(s.reason, 'queue_unavailable');
});

test('junk names in a claim are retired to error without a single Reddit request', async () => {
  const db = fakeDb({ claim: [{ company_key: 'na', company_name: 'n/a', attempts: 1 }] });
  const reddit = fakeReddit();
  await runEnrichment(deps({ fetchImpl: db.fn, redditFetch: reddit.fn }));
  assert.equal(reddit.calls.length, 0);
  assert.equal(db.patches()[0].status, 'error');
});

test('run budget spent mid-company → requeued with the attempt refunded, never half-written', async () => {
  const db = fakeDb();
  const d = deps({ fetchImpl: db.fn, redditFetch: fakeReddit().fn });
  d.config = { ...ENRICH_DEFAULTS, runBudgetMs: 10 };
  const s = await runEnrichment(d);
  assert.equal(s.companies[0].status, 'requeued');
  assert.equal(db.log.some((l) => l.path.startsWith('reports')), false);
  assert.equal(db.patches()[0].status, 'queued');
  assert.equal(db.patches()[0].attempts, 0);
});

test('reports insert failure → company retried, imports not written', async () => {
  const db = fakeDb({ insertStatus: 400 });
  const s = await runEnrichment(deps({ fetchImpl: db.fn, redditFetch: fakeReddit().fn }));
  assert.equal(s.companies[0].status, 'retry');
  assert.equal(s.companies[0].reason, 'reports_insert_400');
  assert.equal(db.log.some((l) => l.path.startsWith('reddit_imports?on_conflict')), false);
});

// ── Arctic Shift fallback ─────────────────────────────────────────────────────────
const arcticPost = (id, title, sub = 'recruitinghell', selftext = 'I applied to Acme Corp in March and they never responded to my application.') =>
  ({ id, subreddit: sub, title, selftext, author: 'op_user', created_utc: 1788000000, num_comments: 3 });
function fakeArctic({ posts = [arcticPost('abc111', 'Acme Corp ghosted me after interview'), arcticPost('def222', 'Acme Corp recruiter interview process', 'recruitinghell', 'Acme Corp sent me a rejection email two days after my onsite interview.')], searchError = null, treeError = null } = {}) {
  const calls = [];
  const fn = async (u) => {
    calls.push(u);
    const q = new URL(u);
    if (q.pathname === '/api/posts/search') {
      if (searchError) return json(searchError.status, { data: null, error: searchError.error });
      // Only the first subreddit's full-text search answers with posts; the rest are empty.
      return json(200, { data: q.searchParams.get('subreddit') === 'recruitinghell' ? posts : [] });
    }
    if (q.pathname === '/api/comments/tree') {
      if (treeError) return json(treeError.status, { data: null, error: treeError.error });
      return json(200, { data: [
        { kind: 't1', data: { id: 'k1', author: 'op_user', body: 'Update: still nothing from Acme Corp after three weeks.', replies: '' } },
        { kind: 't1', data: { id: 'k2', author: 'someone', body: 'Same thing happened to a coworker of mine last spring.', replies: { data: { children: [
          { kind: 't1', data: { id: 'k3', author: 'AutoModerator', body: 'I am a bot, beep boop, this action was performed automatically.' } },
        ] } } } },
        { kind: 'more', data: { children: ['x'] } },
      ] });
    }
    return json(404, { error: 'not found' });
  };
  return { fn, calls };
}

test('auto: Reddit 429 → the run switches to the archive (search + comment trees) and still writes reports', async () => {
  const db = fakeDb();
  const reddit = fakeReddit({ statusFor: () => 429 });
  const arc = fakeArctic();
  const s = await runEnrichment(deps({ fetchImpl: db.fn, redditFetch: reddit.fn, arcticFetch: arc.fn }));
  assert.equal(reddit.calls.length, 1, 'one refused Reddit request, then never again this run');
  assert.equal(s.reddit_blocked, 429);
  assert.equal(s.stopped, null);
  assert.equal(s.companies[0].status, 'done');
  assert.equal(s.companies[0].source, 'arctic');
  assert.equal(s.reports_added, 2);
  // Archive: subreddit-scoped, time-windowed full-text searches, then one comment tree per thread.
  const searches = arc.calls.filter((u) => u.includes('/api/posts/search'));
  assert.equal(searches.length, 4);
  for (const u of searches) {
    const q = new URL(u).searchParams;
    assert.ok(q.get('subreddit') && q.get('after') && q.get('before') && q.get('query') === 'acme corp');
    assert.equal(q.get('fields').includes('permalink'), false, 'permalink is not an accepted field');
  }
  assert.deepEqual(arc.calls.filter((u) => u.includes('/api/comments/tree')).map((u) => new URL(u).searchParams.get('link_id')).sort(), ['t3_abc111', 't3_def222']);
  // Same report shape as the Reddit path — the content is still Reddit's; no username or bot text stored.
  const ins = db.log.find((l) => l.path.startsWith('reports?select=id'));
  assert.deepEqual(ins.body.map((r) => r.outcome).sort(), ['ghosted', 'rejected']);
  for (const row of ins.body) {
    assert.equal(row.source, 'reddit');
    assert.equal(row.trust_reason, 'reddit_rule_match');
    assert.match(row.report_text, ATTRIBUTION);
    assert.doesNotMatch(row.report_text, /I am a bot|op_user|someone/);
  }
  assert.equal(db.patches()[0].status, 'done');
});

test('auto: a server-side archive timeout falls back from `query` to `title` for that subreddit', async () => {
  const db = fakeDb();
  const calls = [];
  const arcFn = async (u) => {
    calls.push(u);
    const q = new URL(u).searchParams;
    if (new URL(u).pathname === '/api/comments/tree') return json(200, { data: [] });
    if (q.get('query')) return json(422, { data: null, error: 'Timeout. Maybe slow down a bit' });
    return json(200, { data: q.get('subreddit') === 'jobs' ? [arcticPost('abc111', 'Acme Corp ghosted me after interview', 'jobs')] : [] });
  };
  const s = await runEnrichment(deps({ fetchImpl: db.fn, redditFetch: fakeReddit({ statusFor: () => 403 }).fn, arcticFetch: arcFn }));
  assert.equal(s.reddit_blocked, 403);
  assert.equal(s.companies[0].status, 'done');
  const searches = calls.filter((u) => u.includes('/api/posts/search')).map((u) => new URL(u).searchParams);
  assert.equal(searches.length, 8);
  assert.deepEqual(searches.slice(0, 2).map((q) => [q.get('query'), q.get('title')]), [['acme corp', null], [null, 'acme corp']]);
});

test('auto: Reddit AND the archive both unavailable → run stops, every company requeued with the attempt refunded', async () => {
  const db = fakeDb({ claim: [
    { company_key: 'acme', company_name: 'acme corp', attempts: 1 },
    { company_key: 'globex', company_name: 'globex', attempts: 2 },
  ] });
  const arc = fakeArctic({ searchError: { status: 422, error: 'Timeout. Maybe slow down a bit' } });
  const s = await runEnrichment(deps({ fetchImpl: db.fn, redditFetch: fakeReddit({ statusFor: () => 429 }).fn, arcticFetch: arc.fn }));
  assert.equal(s.stopped, 'sources_unavailable');
  assert.equal(arc.calls.every((u) => !/globex/.test(u)), true, 'second company never searched');
  const ps = db.patches();
  assert.deepEqual(ps.map((p) => [p.key, p.status, p.attempts]), [['acme', 'queued', 0], ['globex', 'queued', 1]]);
  assert.equal(Date.parse(ps[0].next_eligible_at) - Date.parse('2026-10-17T12:00:00Z') >= 30 * 60_000, true);
});

test('auto: the archive rate-limiting a search stops the run (arctic_429), attempts refunded', async () => {
  const db = fakeDb();
  const arc = fakeArctic({ searchError: { status: 429, error: 'Too many requests' } });
  const s = await runEnrichment(deps({ fetchImpl: db.fn, redditFetch: fakeReddit({ statusFor: () => 429 }).fn, arcticFetch: arc.fn }));
  assert.equal(s.stopped, 'arctic_429');
  assert.equal(db.patches()[0].status, 'queued');
  assert.equal(db.patches()[0].attempts, 0);
});

test('auto: archive rate-limited on a comment tree → that company finishes on titles + posts, then the run stops', async () => {
  const db = fakeDb({ claim: [
    { company_key: 'acme', company_name: 'acme corp', attempts: 1 },
    { company_key: 'globex', company_name: 'globex', attempts: 1 },
  ] });
  const arc = fakeArctic({ treeError: { status: 429, error: 'Too many requests' } });
  const s = await runEnrichment(deps({ fetchImpl: db.fn, redditFetch: fakeReddit({ statusFor: () => 429 }).fn, arcticFetch: arc.fn }));
  assert.equal(s.companies[0].status, 'done');
  assert.equal(s.companies[1].status, 'requeued');
  assert.equal(s.stopped, 'arctic_429');
});

test('arctic mode: never touches Reddit', async () => {
  const db = fakeDb();
  const reddit = fakeReddit();
  const d = deps({ fetchImpl: db.fn, redditFetch: reddit.fn, arcticFetch: fakeArctic().fn });
  d.config = { ...ENRICH_DEFAULTS, source: 'arctic' };
  const s = await runEnrichment(d);
  assert.equal(reddit.calls.length, 0);
  assert.equal(s.companies[0].status, 'done');
});

test('auto: Reddit answers thin then refuses the broad search → the archive tops it up (no false "empty")', async () => {
  const db = fakeDb();
  const reddit = fakeReddit({ searchItems: [], statusFor: (_u, n) => (n === 1 ? 200 : 429) });
  const arc = fakeArctic();
  const s = await runEnrichment(deps({ fetchImpl: db.fn, redditFetch: reddit.fn, arcticFetch: arc.fn }));
  assert.equal(reddit.calls.length, 2);
  assert.equal(s.companies[0].status, 'done');
  assert.equal(s.companies[0].source, 'reddit+arctic');
});

test('auto: Reddit healthy → the archive is never called', async () => {
  const db = fakeDb();
  const arcCalls = [];
  const s = await runEnrichment(deps({ fetchImpl: db.fn, redditFetch: fakeReddit().fn, arcticFetch: async (u) => { arcCalls.push(u); return json(500, {}); } }));
  assert.equal(arcCalls.length, 0);
  assert.equal(s.reddit_blocked, null);
  assert.equal(s.arctic, null);
  assert.equal(s.companies[0].source, 'reddit');
});

// ── Enqueue helper ────────────────────────────────────────────────────────────────

test('enqueueCompanyEnrichment: one RPC with the normalized key; status passed through', async () => {
  const calls = [];
  const r = await enqueueCompanyEnrichment(URL_, 'svc', 'Acme, Inc.', { fetchImpl: async (u, o) => { calls.push([u, JSON.parse(o.body)]); return json(200, [{ status: 'queued', requested_at: 't', done_at: null }]); } });
  assert.deepEqual(r, { status: 'queued', requested_at: 't', done_at: null });
  assert.deepEqual(calls, [[`${URL_}/rest/v1/rpc/enqueue_company_enrichment`, { p_key: 'acme', p_name: 'acme, inc.' }]]);
});

test('enqueueCompanyEnrichment: guards and failures always resolve null, never throw', async () => {
  let hit = 0;
  const f = async () => { hit++; return json(200, []); };
  assert.equal(await enqueueCompanyEnrichment(URL_, 'svc', 'n/a', { fetchImpl: f }), null);
  assert.equal(await enqueueCompanyEnrichment(URL_, 'svc', 'Acme', { fetchImpl: f, firstPartyCount: 2 }), null);
  assert.equal(await enqueueCompanyEnrichment('', 'svc', 'Acme', { fetchImpl: f }), null);
  assert.equal(hit, 0, 'guards short-circuit before the DB');
  assert.equal(await enqueueCompanyEnrichment(URL_, 'svc', 'Acme', { fetchImpl: f }), null); // zero rows (refused)
  assert.equal(await enqueueCompanyEnrichment(URL_, 'svc', 'Acme', { fetchImpl: async () => json(404, { code: 'PGRST202' }) }), null);
  assert.equal(await enqueueCompanyEnrichment(URL_, 'svc', 'Acme', { fetchImpl: async () => { throw new Error('down'); } }), null);
  // Timeout: a hung DB resolves null within the bound.
  const t0 = Date.now();
  // (AbortSignal.timeout's timer is unref'd; a real fetch holds a socket open — the keep-alive stands in for it.)
  const keepAlive = setTimeout(() => {}, 5000);
  const hung = (u, o) => new Promise((_, rej) => o.signal.addEventListener('abort', () => rej(new Error('aborted'))));
  assert.equal(await enqueueCompanyEnrichment(URL_, 'svc', 'Acme', { fetchImpl: hung, timeoutMs: 50 }), null);
  clearTimeout(keepAlive);
  assert.ok(Date.now() - t0 < 1000);
});

test('enrichmentQueueStats: numbers when ready, { ready:false } otherwise', async () => {
  const ok = await enrichmentQueueStats(URL_, 'svc', { fetchImpl: async () => json(200, { queued: 3, running: 1, done: 5, empty: 2, error: 0, reports_added_24h: 7, llm_calls_24h: 4 }) });
  assert.deepEqual(ok, { ready: true, queued: 3, running: 1, done: 5, empty: 2, error: 0, reports_added_24h: 7 });
  assert.deepEqual(await enrichmentQueueStats(URL_, 'svc', { fetchImpl: async () => json(404, {}) }), { ready: false });
  assert.deepEqual(await enrichmentQueueStats(URL_, 'svc', { fetchImpl: async () => { throw new Error('x'); } }), { ready: false });
});

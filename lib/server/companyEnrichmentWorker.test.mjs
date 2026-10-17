// End-to-end tests for the enrichment worker + enqueue helper, fully offline: fake Supabase
// (routed by URL), fake Reddit feeds, fake LLM. Run: node --test lib/server/companyEnrichmentWorker.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runEnrichment } from './companyEnrichmentWorker.js';
import { enqueueCompanyEnrichment, enrichmentQueueStats } from './enrichmentQueue.js';
import { ENRICH_DEFAULTS } from '../../api/_utils/companyEnrichment.js';

const URL_ = 'https://sb.test';
const json = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body, text: async () => JSON.stringify(body), headers: { get: () => null } });
const xml = (status, text) => ({ status, ok: status >= 200 && status < 300, text: async () => text, json: async () => null, headers: { get: () => null } });

// ── Fake Reddit ───────────────────────────────────────────────────────────────────
const searchEntry = (id, title, sub = 'recruitinghell') => `<entry><author><name>/u/a</name></author><category term="${sub}" label="r/${sub}"/><content type="html">&lt;p&gt;${title}&lt;/p&gt;</content><id>t3_${id}</id><link href="https://www.reddit.com/r/${sub}/comments/${id}/slug/"/><updated>2026-09-01T00:00:00+00:00</updated><title>${title}</title></entry>`;
const commentFeed = (id, sub, n = 3) => `<feed>${[
  `<entry><author><name>/u/op</name></author><category term="${sub}"/><content type="html">&lt;p&gt;I applied to Acme Corp for a data role and never heard back after the final interview.&lt;/p&gt;</content><id>t3_${id}</id><link href="https://www.reddit.com/r/${sub}/comments/${id}/slug/"/><updated>2026-09-01T00:00:00+00:00</updated><title>Acme Corp ghosted me</title></entry>`,
  ...Array.from({ length: n }, (_, i) => `<entry><author><name>/u/u${i}</name></author><content type="html">&lt;p&gt;Same thing happened to me with Acme Corp, comment number ${i}.&lt;/p&gt;</content><id>t1_c${i}</id><link href="https://www.reddit.com/r/${sub}/comments/${id}/slug/c${i}/"/></entry>`),
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
function fakeDb({ claim = [{ company_key: 'acme', company_name: 'acme corp', attempts: 1 }], imported = [], claimStatus = 200, insertStatus = 201 } = {}) {
  const log = [];
  const fn = async (u, opts = {}) => {
    const path = u.replace(`${URL_}/rest/v1/`, '');
    const body = opts.body ? JSON.parse(opts.body) : null;
    log.push({ method: opts.method || 'GET', path, body });
    if (path.startsWith('rpc/claim_enrichment_batch')) return json(claimStatus, claimStatus === 200 ? claim : { message: 'missing' });
    if (path.startsWith('reddit_imports?reddit_post_id=in.')) return json(200, imported.map((id) => ({ reddit_post_id: id })));
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

const goodExp = (o = {}) => ({ thread_id: 'abc111', comment_index: 0, first_hand: true, about_target: true, outcome: 'ghosted', role: 'Data Analyst', city: 'Austin, Texas', confidence: 'high', summary: 'Applicant reports no response after a final-round interview for a data role.', ...o });

function deps(over = {}) {
  const c = clock();
  const recomputed = [];
  const companies = [];
  const locations = [];
  return {
    url: URL_, key: 'svc', now: c.now, sleep: c.sleep, llmAvailableImpl: () => true,
    config: { ...ENRICH_DEFAULTS },
    resolveCompany: async (_u, _h, name) => { companies.push(name); return 'cid-1'; },
    resolveLocation: async (_u, _h, cid, city) => { locations.push([cid, city]); return 'loc-1'; },
    recompute: async (_u, _h, name) => { recomputed.push(name); return true; },
    _recomputed: recomputed, _companies: companies, _locations: locations,
    ...over,
  };
}

test('happy path: search → comments → one LLM call → reports + imports + recompute + done', async () => {
  const db = fakeDb();
  const reddit = fakeReddit();
  const prompts = [];
  const d = deps({
    fetchImpl: db.fn, redditFetch: reddit.fn,
    chatImpl: async (args) => { prompts.push(args); return { experiences: [goodExp(), goodExp({ thread_id: 'def222', comment_index: 2, outcome: 'interview', city: '' }), goodExp({ comment_index: 1, first_hand: false })] }; },
  });
  const s = await runEnrichment(d);
  assert.equal(s.ok, true);
  assert.equal(s.claimed, 1);
  assert.equal(s.reports_added, 2);
  assert.equal(s.companies[0].status, 'done');
  assert.equal(s.companies[0].dropped.not_first_hand, 1);
  // One LLM call, JSON mode, fenced input.
  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].json, true);
  assert.match(prompts[0].user, /«UNTRUSTED REDDIT THREADS/);
  // Reports: Reddit shape, 0.3 weight, city via location (not a reports column), permalink attribution.
  const ins = db.log.find((l) => l.path.startsWith('reports?select=id'));
  assert.equal(ins.body.length, 2);
  for (const row of ins.body) {
    assert.equal(row.source, 'reddit');
    assert.equal(row.outcome_weight, 0.3);
    assert.equal(row.trust_reason, 'auto_enrich_reddit');
    assert.equal(row.company_name, 'acme corp');
    assert.equal(row.company_id, 'cid-1');
    assert.equal('city' in row, false);
    // Attribution carries the thread's own date — created_at is only the import time.
    assert.match(row.report_text, / \[Public reddit\.com post, posted \d{4}-\d{2}-\d{2}: https:\/\/www\.reddit\.com\/r\/recruitinghell\/comments\/[a-z0-9]+\/\]$/);
  }
  assert.equal(ins.body[0].location_id, 'loc-1');
  assert.equal(ins.body[1].location_id, null);
  assert.deepEqual(d._locations, [['cid-1', 'Austin, TX']]);
  assert.deepEqual(d._companies, ['Acme Corp']);
  // reddit_imports for every processed thread (ignore-duplicates on the unique post id).
  const imp = db.log.find((l) => l.path.startsWith('reddit_imports?on_conflict'));
  assert.deepEqual(imp.body.map((r) => r.reddit_post_id).sort(), ['t3_abc111', 't3_def222']);
  assert.equal(imp.body.find((r) => r.reddit_post_id === 't3_abc111').report_id, 'r1');
  assert.deepEqual(d._recomputed, ['acme corp']);
  const [p] = db.patches();
  assert.equal(p.status, 'done');
  assert.equal(p.reports_added, 2);
  assert.equal(p.threads_seen, 2);
  assert.ok(p.llm_called_at);
  // Egress: the dedupe read asks for one column only.
  assert.match(db.log.find((l) => l.path.startsWith('reddit_imports?reddit_post_id')).path, /select=reddit_post_id&/);
  // Politeness: biased search, broad fallback (thin), 2 comment feeds — all sequential.
  assert.equal(reddit.calls.length, 4);
});

test('threads already in reddit_imports are skipped; nothing new → empty, no LLM call', async () => {
  const db = fakeDb({ imported: ['t3_abc111', 'def222'] });
  let called = 0;
  const s = await runEnrichment(deps({ fetchImpl: db.fn, redditFetch: fakeReddit().fn, chatImpl: async () => { called++; return { experiences: [] }; } }));
  assert.equal(called, 0);
  assert.equal(s.companies[0].status, 'empty');
  assert.equal(s.companies[0].note, 'all_imported');
  assert.equal(db.patches()[0].status, 'empty');
  assert.equal('llm_called_at' in db.patches()[0], false);
});

test('no relevant threads → empty without touching the LLM or reports', async () => {
  const db = fakeDb();
  const s = await runEnrichment(deps({ fetchImpl: db.fn, redditFetch: fakeReddit({ searchItems: [['zzz999', 'Best pizza in town']] }).fn, chatImpl: async () => { throw new Error('must not be called'); } }));
  assert.equal(s.companies[0].status, 'empty');
  assert.equal(db.log.some((l) => l.path.startsWith('reports')), false);
});

test('invalid model JSON is counted and retried later — nothing written', async () => {
  const db = fakeDb();
  const s = await runEnrichment(deps({ fetchImpl: db.fn, redditFetch: fakeReddit().fn, chatImpl: async () => { throw new Error('No JSON object in model response'); } }));
  assert.equal(s.invalid_json, 1);
  assert.equal(s.companies[0].status, 'retry');
  assert.equal(db.log.some((l) => l.path.startsWith('reports?')), false);
  assert.equal(db.log.some((l) => l.path.startsWith('reddit_imports?on_conflict')), false, 'threads stay un-imported so a retry can read them');
  const [p] = db.patches();
  assert.equal(p.status, 'queued');
  assert.equal(p.last_error, 'invalid_json');
  assert.ok(p.llm_called_at, 'spent tokens count toward the daily cap');
  // Off-shape (parsed but wrong) JSON is the same failure.
  const db2 = fakeDb();
  const s2 = await runEnrichment(deps({ fetchImpl: db2.fn, redditFetch: fakeReddit().fn, chatImpl: async () => ({ answer: 'none' }) }));
  assert.equal(s2.invalid_json, 1);
});

test('reddit-only mode: two Reddit 429s stop the run and requeue every unfinished company with the attempt refunded', async () => {
  const db = fakeDb({ claim: [
    { company_key: 'acme', company_name: 'acme corp', attempts: 1 },
    { company_key: 'globex', company_name: 'globex', attempts: 2 },
  ] });
  const reddit = fakeReddit({ statusFor: () => 429 });
  const d = deps({ fetchImpl: db.fn, redditFetch: reddit.fn, arcticFetch: async () => { throw new Error('archive must not be used in reddit mode'); }, chatImpl: async () => ({ experiences: [] }) });
  d.config = { ...ENRICH_DEFAULTS, source: 'reddit' };
  const s = await runEnrichment(d);
  assert.equal(s.stopped, 'reddit_429');
  assert.equal(reddit.calls.length, 2, 'stopped on the second 429 — no further requests');
  const ps = db.patches();
  assert.deepEqual(ps.map((p) => [p.key, p.status, p.attempts]), [['acme', 'queued', 0], ['globex', 'queued', 1]]);
  assert.ok(Date.parse(ps[0].next_eligible_at) > Date.parse('2026-10-17T12:00:00Z'));
});

test('an LLM rate limit stops the run (no more Reddit spend) and requeues', async () => {
  const db = fakeDb({ claim: [
    { company_key: 'acme', company_name: 'acme corp', attempts: 1 },
    { company_key: 'globex', company_name: 'globex', attempts: 1 },
  ] });
  const reddit = fakeReddit();
  const s = await runEnrichment(deps({ fetchImpl: db.fn, redditFetch: reddit.fn, chatImpl: async () => { throw new Error('LLM 429: rate_limit_exceeded'); } }));
  assert.equal(s.stopped, 'llm_rate_limited');
  assert.equal(reddit.calls.every((u) => !/globex/.test(u)), true, 'second company never searched');
  assert.deepEqual(db.patches().map((p) => [p.key, p.status]), [['acme', 'queued'], ['globex', 'queued']]);
});

test('no LLM backend → nothing claimed; queue missing → honest no-op', async () => {
  const db = fakeDb();
  const s = await runEnrichment(deps({ fetchImpl: db.fn, llmAvailableImpl: () => false }));
  assert.equal(s.skipped, 'no_llm');
  assert.equal(db.log.length, 0);
  const db2 = fakeDb({ claimStatus: 404 });
  const s2 = await runEnrichment(deps({ fetchImpl: db2.fn, redditFetch: fakeReddit().fn }));
  assert.equal(s2.ok, false);
  assert.equal(s2.reason, 'queue_unavailable');
});

test('junk names in a claim are retired to error without a single Reddit request', async () => {
  const db = fakeDb({ claim: [{ company_key: 'na', company_name: 'n/a', attempts: 1 }] });
  const reddit = fakeReddit();
  await runEnrichment(deps({ fetchImpl: db.fn, redditFetch: reddit.fn, chatImpl: async () => ({ experiences: [] }) }));
  assert.equal(reddit.calls.length, 0);
  assert.equal(db.patches()[0].status, 'error');
});

test('run budget: a company that would start its LLM call too late is requeued, never half-written', async () => {
  const db = fakeDb();
  const d = deps({ fetchImpl: db.fn, redditFetch: fakeReddit().fn, chatImpl: async () => { throw new Error('must not be called'); } });
  d.config = { ...ENRICH_DEFAULTS, runBudgetMs: 10_000, llmReserveMs: 80_000 };
  const s = await runEnrichment(d);
  assert.equal(s.companies[0].status, 'requeued');
  assert.equal(db.log.some((l) => l.path.startsWith('reports')), false);
  assert.equal(db.patches()[0].status, 'queued');
});

test('reports insert failure → company retried, imports not written', async () => {
  const db = fakeDb({ insertStatus: 400 });
  const s = await runEnrichment(deps({ fetchImpl: db.fn, redditFetch: fakeReddit().fn, chatImpl: async () => ({ experiences: [goodExp()] }) }));
  assert.equal(s.companies[0].status, 'retry');
  assert.equal(s.companies[0].reason, 'reports_insert_400');
  assert.equal(db.log.some((l) => l.path.startsWith('reddit_imports?on_conflict')), false);
});

// ── Arctic Shift fallback ─────────────────────────────────────────────────────────
const arcticPost = (id, title, sub = 'recruitinghell', selftext = 'I applied to Acme Corp and the recruiter stopped replying.') =>
  ({ id, subreddit: sub, title, selftext, author: 'op_user', created_utc: 1788000000, num_comments: 3 });
function fakeArctic({ posts = [arcticPost('abc111', 'Acme Corp ghosted me after interview'), arcticPost('def222', 'Acme Corp recruiter interview process')], searchError = null, treeError = null } = {}) {
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
        { kind: 't1', data: { id: 'k2', author: 'someone', body: 'Same thing happened to me with Acme Corp last spring.', replies: { data: { children: [
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
  const prompts = [];
  const s = await runEnrichment(deps({
    fetchImpl: db.fn, redditFetch: reddit.fn, arcticFetch: arc.fn,
    chatImpl: async (a) => { prompts.push(a); return { experiences: [goodExp(), goodExp({ thread_id: 'def222', comment_index: 2, outcome: 'interview', city: '' })] }; },
  }));
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
  // Comments came from the tree: OP flagged, bot + `more` stub dropped, no usernames in the prompt.
  assert.match(prompts[0].user, /\[1\] \(OP\) Update: still nothing/);
  assert.doesNotMatch(prompts[0].user, /I am a bot|op_user|someone/);
  // Same report shape as the Reddit path — the content is still Reddit's.
  const ins = db.log.find((l) => l.path.startsWith('reports?select=id'));
  for (const row of ins.body) {
    assert.equal(row.source, 'reddit');
    assert.equal(row.trust_reason, 'auto_enrich_reddit');
    // Attribution carries the thread's own date — created_at is only the import time.
    assert.match(row.report_text, / \[Public reddit\.com post, posted \d{4}-\d{2}-\d{2}: https:\/\/www\.reddit\.com\/r\/recruitinghell\/comments\/[a-z0-9]+\/\]$/);
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
  const s = await runEnrichment(deps({ fetchImpl: db.fn, redditFetch: fakeReddit({ statusFor: () => 403 }).fn, arcticFetch: arcFn, chatImpl: async () => ({ experiences: [goodExp()] }) }));
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
  const s = await runEnrichment(deps({ fetchImpl: db.fn, redditFetch: fakeReddit({ statusFor: () => 429 }).fn, arcticFetch: arc.fn, chatImpl: async () => { throw new Error('must not be called'); } }));
  assert.equal(s.stopped, 'sources_unavailable');
  assert.equal(arc.calls.every((u) => !/globex/.test(u)), true, 'second company never searched');
  const ps = db.patches();
  assert.deepEqual(ps.map((p) => [p.key, p.status, p.attempts]), [['acme', 'queued', 0], ['globex', 'queued', 1]]);
  assert.equal(Date.parse(ps[0].next_eligible_at) - Date.parse('2026-10-17T12:00:00Z') >= 30 * 60_000, true);
});

test('auto: the archive rate-limiting a search stops the run (arctic_429), attempts refunded', async () => {
  const db = fakeDb();
  const arc = fakeArctic({ searchError: { status: 429, error: 'Too many requests' } });
  const s = await runEnrichment(deps({ fetchImpl: db.fn, redditFetch: fakeReddit({ statusFor: () => 429 }).fn, arcticFetch: arc.fn, chatImpl: async () => ({ experiences: [] }) }));
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
  const s = await runEnrichment(deps({ fetchImpl: db.fn, redditFetch: fakeReddit({ statusFor: () => 429 }).fn, arcticFetch: arc.fn, chatImpl: async () => ({ experiences: [goodExp()] }) }));
  assert.equal(s.companies[0].status, 'done');
  assert.equal(s.companies[1].status, 'requeued');
  assert.equal(s.stopped, 'arctic_429');
});

test('arctic mode: never touches Reddit', async () => {
  const db = fakeDb();
  const reddit = fakeReddit();
  const d = deps({ fetchImpl: db.fn, redditFetch: reddit.fn, arcticFetch: fakeArctic().fn, chatImpl: async () => ({ experiences: [goodExp()] }) });
  d.config = { ...ENRICH_DEFAULTS, source: 'arctic' };
  const s = await runEnrichment(d);
  assert.equal(reddit.calls.length, 0);
  assert.equal(s.companies[0].status, 'done');
});

test('auto: Reddit answers thin then refuses the broad search → the archive tops it up (no false "empty")', async () => {
  const db = fakeDb();
  const reddit = fakeReddit({ searchItems: [], statusFor: (_u, n) => (n === 1 ? 200 : 429) });
  const arc = fakeArctic();
  const s = await runEnrichment(deps({ fetchImpl: db.fn, redditFetch: reddit.fn, arcticFetch: arc.fn, chatImpl: async () => ({ experiences: [goodExp()] }) }));
  assert.equal(reddit.calls.length, 2);
  assert.equal(s.companies[0].status, 'done');
  assert.equal(s.companies[0].source, 'reddit+arctic');
});

test('auto: Reddit healthy → the archive is never called', async () => {
  const db = fakeDb();
  const arcCalls = [];
  const s = await runEnrichment(deps({ fetchImpl: db.fn, redditFetch: fakeReddit().fn, arcticFetch: async (u) => { arcCalls.push(u); return json(500, {}); }, chatImpl: async () => ({ experiences: [goodExp()] }) }));
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
  assert.deepEqual(ok, { ready: true, queued: 3, running: 1, done: 5, empty: 2, error: 0, reports_added_24h: 7, llm_calls_24h: 4 });
  assert.deepEqual(await enrichmentQueueStats(URL_, 'svc', { fetchImpl: async () => json(404, {}) }), { ready: false });
  assert.deepEqual(await enrichmentQueueStats(URL_, 'svc', { fetchImpl: async () => { throw new Error('x'); } }), { ready: false });
});

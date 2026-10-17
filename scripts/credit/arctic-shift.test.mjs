// Offline tests for the Arctic Shift fetch source. Run: node --test 'scripts/credit/*.test.mjs'
//
// Fixtures follow Arctic Shift's documented API (posts/search, comments/tree) and Reddit's JSON
// field names. The exact envelope ({"data":[…]} / {"error":"…"}) and tree node shape are ASSUMED
// (not reachable from the sandbox) — the parser accepts the plausible variants, tested below.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIVE_SUBREDDITS, ARCTIC_DEFAULTS, ARCTIC_UA, QUICK_SUBREDDITS, QUIET_SUBREDDITS, cleanRedditMarkdown, discoveryScope, createArcticFetcher, createDiscoveryState,
  discoveryQueries, fetchArcticTarget, flattenCommentTree, isRetryable, parseArcticResponse, postToItem,
  resetDelayMs, searchWithFallback,
} from './lib/arcticShift.mjs';
import {
  JOB_SUBREDDITS, buildExtractRequests, buildTargets, coverage, loadAgencies, planWrite, sourceFor, targetSlug,
} from './lib/reddit.mjs';

const AGENCIES = loadAgencies();
const IG = buildTargets({ agencies: AGENCIES }).find((t) => t.displayName === 'Insight Global');
const RH = buildTargets({ agencies: AGENCIES })[0]; // Robert Half

// ── fixtures ──

const post = (o) => ({
  id: o.id, subreddit: o.sub, title: o.title, selftext: o.body ?? '', author: o.author ?? 'poster',
  created_utc: o.utc ?? 1740823200, permalink: `/r/${o.sub}/comments/${o.id}/slug_${o.id}/`, num_comments: 4,
});
const P = {
  aa: post({ id: 'aa1111', sub: 'recruitinghell', title: 'Insight Global recruiter ghosted me after client interview &amp; never called', body: 'Insight Global submitted me to a [bank](https://example.com/bank) &amp; I did **two rounds**, then my recruiter stopped answering for 5 weeks.\n\n&gt; quoted\n\nEmail me at a.b@x.com or call 555-123-4567.' }),
  bb: post({ id: 'bb2222', sub: 'cscareerquestions', title: 'Is Insight Global legit for contract roles?', body: 'Got a call from Insight Global about a 6 month contract.', author: 'second' }),
  cc: post({ id: 'cc3333', sub: 'pics', title: 'My insight on global warming', body: 'Nothing about jobs.' }),
  dd: post({ id: 'dd4444', sub: 'jobs', title: 'Recruiter named Robert wants a call', body: 'No company named here, just a recruiter.' }),
  ee: post({ id: 'ee5555', sub: 'GetEmployed', title: 'Insight Global placed me at a bank', body: 'Applied through Insight Global, got placed after two interviews.' }),
  ff: post({ id: 'ff6666', sub: 'recruitinghell', title: 'Insight Global offer rescinded', body: '[removed]' }),
};

const TREE_AA = { data: [
  { kind: 't1', data: { id: 'c1', author: 'AutoModerator', body: 'Please remember to follow the rules of this subreddit.', replies: '' } },
  { kind: 't1', data: { id: 'c2', author: 'someone', body: 'Same thing happened to me with them, ghosted after the final round. Ask u/helper_99 about it.', replies: { kind: 'Listing', data: { children: [
    { kind: 't1', data: { id: 'c5', author: 'poster', body: 'Update: they finally emailed to say the client went **another way**.', replies: '' } },
    { kind: 'more', data: { count: 4, children: ['x1', 'x2'] } },
  ] } } } },
  { kind: 't1', data: { id: 'c3', author: '[deleted]', body: '[deleted]', replies: [
    { kind: 't1', data: { id: 'c6', author: 'third', body: 'They did the same to me in 2023 &amp; never called back after the screen.', replies: '' } },
  ] } },
  { kind: 't1', data: { id: 'c4', author: 'mod', body: '[removed]' } },
  { kind: 't1', data: { id: 'c7', author: 'tiny', body: 'lol same' } },
  { kind: 'more', data: { count: 10, children: ['y1'] } },
] };

function fakeClock() {
  let t = 0;
  return { now: () => t, sleep: async (ms) => { t += ms; } };
}
const resp = (status, body = '', headers = {}) => ({
  status, ok: status >= 200 && status < 300,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  headers: { get: (k) => headers[k.toLowerCase()] ?? null },
});
const fetcherFor = (fetchImpl, opts = {}) => createArcticFetcher({ fetchImpl, ...fakeClock(), ...opts });

// ── parsing ──

test('parseArcticResponse: envelope, bare array, Listing children, error string/object, bad shapes', () => {
  assert.deepEqual(parseArcticResponse({ data: [1, 2] }), { items: [1, 2], error: null });
  assert.deepEqual(parseArcticResponse([3]), { items: [3], error: null });
  assert.deepEqual(parseArcticResponse({ data: { children: [4] } }), { items: [4], error: null });
  assert.deepEqual(parseArcticResponse({ data: null }), { items: [], error: null });
  assert.deepEqual(parseArcticResponse({ error: 'Query timed out' }), { items: [], error: 'Query timed out' });
  assert.equal(parseArcticResponse({ error: { message: 'Timeout' } }).error, 'Timeout');
  assert.equal(parseArcticResponse({ data: 'x' }).error, 'bad_shape');
  assert.equal(parseArcticResponse(null).error, 'bad_shape');
  assert.equal(isRetryable(200, 'Query timed out'), true);
  assert.equal(isRetryable(500, 'x'), true);
  assert.equal(isRetryable(0, 'network: ECONNRESET'), true);
  assert.equal(isRetryable(400, 'Invalid parameter subreddit'), false);
});

test('cleanRedditMarkdown: entities once, links → label, quote/heading/emphasis markers, dead bodies', () => {
  assert.equal(cleanRedditMarkdown('a [bank](https://x.com/b) &amp; **bold** ~~gone~~'), 'a bank & bold gone');
  assert.equal(cleanRedditMarkdown('## Title\n&gt; quoted\n* item'), 'Title\nquoted\n- item');
  assert.equal(cleanRedditMarkdown('a &amp;amp; b​'), 'a &amp; b');
  for (const d of ['[deleted]', '[removed]', ' ', null]) assert.equal(cleanRedditMarkdown(d), '');
});

test('postToItem: search-item shape, absolute www permalink, ISO created, author kept apart', () => {
  const { item, author } = postToItem(P.aa);
  assert.deepEqual(Object.keys(item).sort(), ['_body', 'created', 'id', 'permalink', 'subreddit', 'title']);
  assert.equal(item.permalink, 'https://www.reddit.com/r/recruitinghell/comments/aa1111/slug_aa1111/');
  assert.equal(item.created, '2025-03-01T10:00:00.000Z');
  assert.equal(item.title, 'Insight Global recruiter ghosted me after client interview & never called');
  assert.match(item._body, /submitted me to a bank & I did two rounds/);
  assert.equal(author, 'poster');
  assert.equal(postToItem({ ...P.aa, id: 't3_aa1111', permalink: '' }).item.permalink, 'https://www.reddit.com/r/recruitinghell/comments/aa1111/');
  assert.equal(postToItem({ id: 'bad id!', subreddit: 'x' }), null);
  assert.equal(postToItem({ id: 'abc' }), null); // no subreddit
});

test('discoveryQueries: global first, quiet subs all-time, active subs in contiguous 1-year windows', () => {
  assert.deepEqual(new Set([...QUIET_SUBREDDITS, ...ACTIVE_SUBREDDITS]), new Set(JOB_SUBREDDITS));
  assert.ok(ACTIVE_SUBREDDITS.every((s) => JOB_SUBREDDITS.includes(s)));
  const nowSec = 1_760_000_000;
  // Default: no global query (the live API requires a subreddit on posts/search).
  const def = discoveryQueries(IG, { nowSec, windows: 3 });
  assert.equal(def.length, QUIET_SUBREDDITS.length + ACTIVE_SUBREDDITS.length * 3);
  assert.ok(def.every((q) => q.params.subreddit));
  assert.ok(def.every((q) => !q.params.fields.split(',').includes('permalink')));
  const qs = discoveryQueries(IG, { nowSec, windows: 3, includeGlobal: true });
  assert.equal(qs.length, 1 + QUIET_SUBREDDITS.length + ACTIVE_SUBREDDITS.length * 3);
  assert.equal(qs[0].name, 'global');
  assert.equal(qs[0].params.subreddit, undefined);
  for (const q of qs) {
    assert.equal(q.term, 'insight global');
    assert.equal(q.params.limit, '100');
    assert.equal(q.params.sort, 'desc');
    assert.ok(!('query' in q.params) && !('title' in q.params)); // text filter added per attempt
  }
  const quiet = qs.filter((q) => QUIET_SUBREDDITS.includes(q.scope));
  assert.ok(quiet.every((q) => !q.params.after && !q.params.before));
  const rh = qs.filter((q) => q.scope === 'recruitinghell');
  assert.equal(rh.length, 3);
  assert.equal(Number(rh[0].params.before), nowSec);
  for (let i = 0; i < 2; i++) assert.equal(rh[i].params.after, rh[i + 1].params.before);
  assert.equal(Number(rh[0].params.before) - Number(rh[0].params.after), 365 * 86400);
});

// ── fetcher ──

test('fetcher: production-style UA, spacing, 429 honors X-RateLimit-Reset (seconds)', async () => {
  const clock = fakeClock();
  const calls = [];
  let n = 0;
  const f = createArcticFetcher({
    ...clock, intervalMs: 1000,
    fetchImpl: async (url, opts) => {
      calls.push({ url, at: clock.now(), ua: opts.headers['User-Agent'] });
      return n++ === 0 ? resp(429, '', { 'x-ratelimit-reset': '20' }) : resp(200, { data: [P.aa] });
    },
  });
  const r = await f.get('/api/posts/search', { query: 'insight global', limit: '100' });
  assert.equal(r.ok, true);
  assert.equal(r.items.length, 1);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((c) => c.ua === ARCTIC_UA));
  assert.equal(new URL(calls[0].url).host, 'arctic-shift.photon-reddit.com');
  assert.equal(new URL(calls[0].url).searchParams.get('query'), 'insight global');
  assert.ok(calls[1].at - calls[0].at >= 20_000);
  assert.equal(f.stats.r429, 1);
  assert.equal(resetDelayMs((k) => ({ 'x-ratelimit-reset-at': '1000' })[k] ?? null, 400_000), 600_000); // epoch seconds
  assert.equal(resetDelayMs((k) => ({ 'x-ratelimit-reset': String(2e9) })[k] ?? null, 2e12 - 5000), 5000); // epoch s
});

test('fetcher: "Query timed out" retried once after the delay, then given up and counted', async () => {
  const clock = fakeClock();
  const at = [];
  const f = createArcticFetcher({ ...clock, retryDelayMs: 5000, fetchImpl: async () => { at.push(clock.now()); return resp(200, { error: 'Query timed out' }); } });
  const r = await f.get('/api/posts/search', { query: 'x' });
  assert.deepEqual({ ok: r.ok, error: r.error, retried: r.retried }, { ok: false, error: 'Query timed out', retried: true });
  assert.equal(at.length, 2);
  assert.ok(at[1] - at[0] >= 5000);
  assert.deepEqual({ retries: f.stats.retries, failed: f.stats.failed, errors: f.stats.errors }, { retries: 1, failed: 1, errors: 2 });
  // plain 4xx: not retried
  let n400 = 0;
  const g = fetcherFor(async () => { n400++; return resp(400, { error: 'Invalid parameter' }); });
  assert.equal((await g.get('/x', {})).error, 'Invalid parameter');
  assert.equal(n400, 1);
  // bad JSON, then OK; network error, then OK; bare array body
  let k = 0;
  const h = fetcherFor(async () => (k++ === 0 ? resp(200, '<html>502</html>') : resp(200, [P.bb])));
  assert.deepEqual((await h.get('/x', {})).items, [P.bb]);
  let m = 0;
  const net = fetcherFor(async () => { if (m++ === 0) throw new Error('ECONNRESET'); return resp(200, { data: [] }); });
  assert.equal((await net.get('/x', {})).ok, true);
  // 5xx without a JSON error body → http_<status>
  assert.equal((await fetcherFor(async () => resp(503, 'down')).get('/x', {})).error, 'http_503');
  assert.equal((await fetcherFor(async () => resp(503, {})).get('/x', {})).error, 'http_503');
  assert.equal((await fetcherFor(async () => resp(504, { error: 'Query timed out' })).get('/x', {})).error, 'Query timed out');
});

test('fetcher: nearly-exhausted budget waits for the advertised reset', async () => {
  const clock = fakeClock();
  const at = [];
  const f = createArcticFetcher({ ...clock, intervalMs: 1000, fetchImpl: async () => { at.push(clock.now()); return resp(200, { data: [] }, { 'x-ratelimit-remaining': '1', 'x-ratelimit-reset': '30' }); } });
  await f.get('/x', {});
  await f.get('/x', {});
  assert.ok(at[1] - at[0] >= 30_000);
});

// ── discovery fallback + breaker ──

test('searchWithFallback: query → title on failure; breaker sends a failing scope straight to title', async () => {
  const seen = [];
  const fetcher = fetcherFor(async (url) => {
    const u = new URL(url);
    seen.push(u.searchParams.has('query') ? 'query' : 'title');
    return u.searchParams.has('query') ? resp(400, { error: 'query not supported for this subreddit' }) : resp(200, { data: [P.ee] });
  });
  const state = createDiscoveryState({ breakerAfter: 2 });
  const q = discoveryQueries(IG, { nowSec: 1_760_000_000, windows: 1 }).find((x) => x.scope === 'GetEmployed');
  const r1 = await searchWithFallback(q, { fetcher, state });
  assert.equal(r1.ok, true);
  assert.equal(r1.param, 'title');
  assert.deepEqual(r1.errors, ['query: query not supported for this subreddit']);
  await searchWithFallback(q, { fetcher, state });
  await searchWithFallback(q, { fetcher, state });
  assert.deepEqual(seen, ['query', 'title', 'query', 'title', 'title']); // tripped after 2 failures
  assert.equal(state.titleOnly('global'), false);
});

// ── comment trees ──

test('flattenCommentTree: Listing replies, more stubs, deleted/removed/bots dropped, OP flagged, no authors', () => {
  const comments = flattenCommentTree(parseArcticResponse(TREE_AA).items, { postAuthor: 'poster' });
  assert.deepEqual(comments.map((c) => c.id), ['c2', 'c5', 'c6']); // c6 survives its deleted parent
  assert.deepEqual(comments.map((c) => c.is_op), [false, true, false]);
  assert.doesNotMatch(comments[0].body, /helper_99/);
  assert.equal(comments[1].body, 'Update: they finally emailed to say the client went another way.');
  assert.match(comments[2].body, /2023 & never/);
  for (const c of comments) assert.deepEqual(Object.keys(c).sort(), ['body', 'id', 'is_op']);
  assert.equal(flattenCommentTree(TREE_AA.data, { postAuthor: 'poster', maxComments: 2 }).length, 2);
  assert.ok(flattenCommentTree(TREE_AA.data, { maxChars: 20 }).every((c) => c.body.length <= 20));
  // a deleted OP must not flag every deleted-author reply as OP
  assert.ok(flattenCommentTree([{ id: 'z1', author: '[deleted]', body: 'This is a long enough comment body.' }], { postAuthor: '[deleted]' }).every((c) => !c.is_op));
  // bare comment objects with array replies
  const bare = flattenCommentTree([{ id: 't1_b1', author: 'x', body: 'They ghosted me after the onsite too.', replies: [{ id: 'b2', author: 'poster', body: 'Sorry to hear that, same here honestly.' }] }], { postAuthor: 'poster' });
  assert.deepEqual(bare, [{ id: 'b1', is_op: false, body: 'They ghosted me after the onsite too.' }, { id: 'b2', is_op: true, body: 'Sorry to hear that, same here honestly.' }]);
  assert.deepEqual(flattenCommentTree(undefined), []);
});

// ── fetchArcticTarget end to end ──

// Routes posts/search by (scope, text param) and comments/tree by link_id; logs every request.
function arcticServer(routes, trees = {}) {
  const log = [];
  const fetchImpl = async (url) => {
    const u = new URL(url);
    const sp = u.searchParams;
    if (u.pathname === '/api/comments/tree') {
      log.push(`tree ${sp.get('link_id')} limit=${sp.get('limit')}`);
      return resp(200, trees[sp.get('link_id')] ?? { data: [] });
    }
    const scope = sp.get('subreddit') || 'global';
    const param = sp.has('query') ? 'query' : 'title';
    log.push(`search ${scope} ${param}${sp.get('after') ? ' windowed' : ''}`);
    const r = routes[`${scope}|${param}`] ?? routes[scope] ?? { data: [] };
    return typeof r === 'function' ? r(sp) : resp(r.status ?? 200, r.body ?? r);
  };
  return { fetchImpl, log };
}

test('fetchArcticTarget: merged + deduped discovery, timeout → title fallback, gate, imported skip, cache shape', async () => {
  const { fetchImpl, log } = arcticServer({
    global: { data: [P.aa, P.bb, P.cc] },                                     // 3 = limit → not exhaustive
    GetEmployed: { data: [P.aa, P.ee] },                                      // aa1111 again → deduped
    'recruitinghell|query': { body: { error: 'Query timed out' } },           // retried once, then title
    'recruitinghell|title': { data: [P.ff] },
    jobs: { data: [P.dd] },                                                   // "Robert" ≠ Insight Global
    AskHR: { status: 400, body: { error: 'Invalid request' } },               // query + title both fail
  }, { t3_aa1111: TREE_AA });
  const fetcher = fetcherFor(fetchImpl);
  const cache = await fetchArcticTarget(IG, { fetcher, importedIds: new Set(['bb2222']), nowSec: 1_760_000_000, windows: 1, limit: 3, includeGlobal: true });
  assert.equal(cache.complete, true);
  assert.equal(cache.source, 'arctic');
  assert.deepEqual(cache.skippedImported, ['bb2222']);
  assert.deepEqual(cache.threads.map((t) => t.id).sort(), ['aa1111', 'ee5555', 'ff6666']); // cc (pics) + dd gated out
  assert.equal(cache.skippedQueries, 1); // AskHR
  assert.deepEqual(cache.searches['r/AskHR'], { ok: false, param: null, items: 0, errors: ['query: Invalid request', 'title: Invalid request'] });
  assert.equal(cache.searches['r/recruitinghell@0-1y'].param, 'title');
  assert.equal(log.filter((l) => l === 'search recruitinghell query windowed').length, 2); // one retry
  assert.equal(log.filter((l) => l.startsWith('tree ')).length, 3);
  assert.ok(log.includes('tree t3_aa1111 limit=200'));

  // Same cache shape the RSS path writes (fetchTarget) — extract/sample/write read exactly these.
  for (const t of cache.threads) {
    assert.deepEqual(Object.keys(t).sort(), ['body', 'comments', 'comments_fetched', 'created', 'feed_status', 'id', 'permalink', 'subreddit', 'title']);
    assert.equal(t.comments_fetched, true);
    assert.equal(t.feed_status, 200);
  }
  for (const k of ['target', 'complete', 'fetchedAt', 'searches', 'skippedImported', 'threads', 'chars']) assert.ok(k in cache, k);
  const aa = cache.threads.find((t) => t.id === 'aa1111');
  assert.equal(aa.subreddit, 'recruitinghell');
  assert.equal(aa.permalink, 'https://www.reddit.com/r/recruitinghell/comments/aa1111/slug_aa1111/');
  assert.equal(aa.created, '2025-03-01T10:00:00.000Z');
  assert.match(aa.body, /two rounds/);
  assert.doesNotMatch(aa.body, /a\.b@x\.com|555-123-4567|https?:/); // PII redacted before caching
  assert.deepEqual(aa.comments.map((c) => [c.id, c.is_op]), [['c2', false], ['c5', true], ['c6', false]]);
  assert.equal(cache.threads.find((t) => t.id === 'ff6666').body, ''); // [removed] post body
  assert.ok(cache.chars > 0);

  // Usernames never reach the cache (and so never reach the model).
  const json = JSON.stringify(cache);
  assert.doesNotMatch(json, /"author"|poster|second|someone|third|helper_99|AutoModerator/);
  const cov = coverage([cache]);
  assert.equal(cov.skippedQueries, 1);
  assert.equal(cov.threads, 3);
});

test('fetchArcticTarget cache feeds extract → plan → QA source unchanged', async () => {
  const { fetchImpl } = arcticServer({ global: { data: [P.aa] } }, { t3_aa1111: TREE_AA });
  const cache = await fetchArcticTarget(IG, { fetcher: fetcherFor(fetchImpl), nowSec: 1_760_000_000, includeGlobal: true });
  const { requests, manifest } = buildExtractRequests([cache]);
  assert.equal(requests.length, 1);
  const content = requests[0].params.messages[0].content;
  assert.match(content, /\[THREAD id=aa1111\] r\/recruitinghell/);
  assert.match(content, /\[0\] ORIGINAL POST: Insight Global submitted me to a bank/);
  assert.match(content, /\[2\] \(OP\) Update: they finally emailed/);
  assert.doesNotMatch(content, /poster|someone|helper_99/);
  assert.deepEqual(manifest[requests[0].custom_id].thread_ids, ['aa1111']);
  const exp = { thread_id: 'aa1111', comment_index: 1, first_hand: true, about_target: true, outcome: 'ghosted', role: '', confidence: 'high', summary: 'Applicant reports the agency stopped responding after the final round.' };
  const plan = planWrite([{ custom_id: requests[0].custom_id, ...manifest[requests[0].custom_id], experiences: [exp] }], new Map([[targetSlug(IG), cache]]));
  assert.equal(plan.kept.length, 1);
  assert.equal(plan.kept[0].subreddit, 'recruitinghell');
  assert.equal(plan.kept[0].permalink, 'https://www.reddit.com/r/recruitinghell/comments/aa1111/slug_aa1111/');
  assert.match(sourceFor(plan.kept[0], cache.threads[0]), /COMMENT \[1\]: Same thing happened to me/);
});

test('fetchArcticTarget: complete global result skips per-subreddit searches; --full-discovery runs them', async () => {
  const a = arcticServer({ global: { data: [P.aa, P.bb] } });
  const c1 = await fetchArcticTarget(IG, { fetcher: fetcherFor(a.fetchImpl), nowSec: 1_760_000_000, includeGlobal: true });
  assert.deepEqual(Object.keys(c1.searches), ['global']);
  assert.equal(a.log.filter((l) => l.startsWith('search ')).length, 1);
  const b = arcticServer({ global: { data: [P.aa, P.bb] } });
  const c2 = await fetchArcticTarget(IG, { fetcher: fetcherFor(b.fetchImpl), nowSec: 1_760_000_000, includeGlobal: true, windows: 1, fullDiscovery: true });
  assert.equal(Object.keys(c2.searches).length, 1 + QUIET_SUBREDDITS.length + ACTIVE_SUBREDDITS.length);
  // a global result that only came from the `title` fallback is NOT exhaustive (misses body mentions)
  const t = arcticServer({ 'global|query': { status: 400, body: { error: 'nope' } }, 'global|title': { data: [P.aa] } });
  const c3 = await fetchArcticTarget(IG, { fetcher: fetcherFor(t.fetchImpl), nowSec: 1_760_000_000, includeGlobal: true, windows: 1 });
  assert.ok(Object.keys(c3.searches).length > 1);
});

test('fetchArcticTarget: relevance gate — "Robert" alone is not Robert Half; all-failed target is incomplete', async () => {
  const { fetchImpl } = arcticServer({ global: { data: [P.dd, P.aa] } });
  assert.equal((await fetchArcticTarget(RH, { fetcher: fetcherFor(fetchImpl), nowSec: 1_760_000_000, includeGlobal: true })).threads.length, 0);
  const down = fetcherFor(async () => resp(503, {}));
  const c = await fetchArcticTarget(IG, { fetcher: down, nowSec: 1_760_000_000, includeGlobal: true, windows: 1 });
  assert.equal(c.complete, false);
  assert.equal(c.threads.length, 0);
  assert.equal(c.skippedQueries, 1 + QUIET_SUBREDDITS.length + ACTIVE_SUBREDDITS.length);
});

test('breadth defaults: 1 window; --quick = 4 busiest subs × 1 window, no quiet subs, passed through fetchArcticTarget', async () => {
  assert.equal(ARCTIC_DEFAULTS.activeWindows, 1);
  assert.deepEqual(QUICK_SUBREDDITS, ['recruitinghell', 'jobs', 'cscareerquestions', 'antiwork']);
  assert.ok(QUICK_SUBREDDITS.every((s) => ACTIVE_SUBREDDITS.includes(s)));
  const nowSec = 1_760_000_000;
  const full = discoveryScope();
  assert.equal(discoveryQueries(IG, { nowSec, ...full }).length, QUIET_SUBREDDITS.length + ACTIVE_SUBREDDITS.length);
  assert.equal(discoveryQueries(IG, { nowSec, ...discoveryScope({ windows: 3 }) }).length, QUIET_SUBREDDITS.length + ACTIVE_SUBREDDITS.length * 3);
  const quick = discoveryScope({ quick: true, windows: 3 });
  assert.equal(quick.windows, 1, 'quick forces one window');
  const qs = discoveryQueries(IG, { nowSec, ...quick });
  assert.deepEqual(qs.map((q) => q.scope), QUICK_SUBREDDITS);
  assert.ok(qs.every((q) => q.params.after && q.params.before));
  const seen = [];
  const fetcher = { stats: {}, get: async (path, params) => { seen.push(params.subreddit || path); return { ok: true, status: 200, items: [], error: null }; } };
  const cache = await fetchArcticTarget(IG, { fetcher, nowSec, ...quick });
  assert.deepEqual(Object.keys(cache.searches), QUICK_SUBREDDITS.map((s) => `r/${s}@0-1y`));
  assert.deepEqual(seen, QUICK_SUBREDDITS);
});

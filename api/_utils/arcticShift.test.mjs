// Offline tests for the Arctic Shift fallback source. Run: node --test api/_utils/arcticShift.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  arcticSearchQueries, cleanRedditMarkdown, createArcticFetcher, discoverArctic, flattenCommentTree,
  parseArcticResponse, postToItem, resetDelayMs,
} from './arcticShift.js';
import { RunStop } from './companyEnrichment.js';

const res = (status, body, headers = {}) => ({
  status, ok: status >= 200 && status < 300,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  headers: { get: (k) => headers[k.toLowerCase()] ?? null },
});
function clock(start = 1_800_000_000_000) {
  let t = start;
  return { now: () => t, sleep: async (ms) => { t += ms; }, advance: (ms) => { t += ms; } };
}

test('parseArcticResponse: data array, Listing children, bare array, error string/object, null data', () => {
  assert.deepEqual(parseArcticResponse({ data: [1] }), { items: [1], error: null });
  assert.deepEqual(parseArcticResponse({ data: { children: [2] } }), { items: [2], error: null });
  assert.deepEqual(parseArcticResponse([3]), { items: [3], error: null });
  assert.equal(parseArcticResponse({ data: null, error: 'Timeout. Maybe slow down a bit' }).error, 'Timeout. Maybe slow down a bit');
  assert.equal(parseArcticResponse({ error: { message: 'bad' } }).error, 'bad');
  assert.deepEqual(parseArcticResponse({ data: null }), { items: [], error: null });
  assert.equal(parseArcticResponse('x').error, 'bad_shape');
});

test('cleanRedditMarkdown: entities once, links → label, markers dropped, deleted → empty', () => {
  assert.equal(cleanRedditMarkdown('**Ghosted** by [Acme](https://acme.com) &amp; co\n\n> quoted'), 'Ghosted by Acme & co\n\nquoted');
  assert.equal(cleanRedditMarkdown('[removed]'), '');
  assert.equal(cleanRedditMarkdown('&amp;lt;b&amp;gt;'), '&lt;b&gt;', 'decoded exactly once');
});

test('postToItem: rebuilt permalink, ISO created, author kept OUT of the item, junk rejected', () => {
  const { item, author } = postToItem({ id: 't3_abc123', subreddit: 'jobs', title: 'Acme &amp; me', selftext: 'body', author: 'someone', created_utc: 1788000000 });
  assert.equal(item.permalink, 'https://www.reddit.com/r/jobs/comments/abc123/');
  assert.equal(item.title, 'Acme & me');
  assert.equal(item.created, new Date(1788000000 * 1000).toISOString());
  assert.equal(author, 'someone');
  assert.equal('author' in item, false);
  assert.equal(postToItem({ id: 'bad id!', subreddit: 'jobs' }), null);
  assert.equal(postToItem({ id: 'abc', subreddit: '../x' }), null);
  assert.equal(postToItem(null), null);
});

test('flattenCommentTree: depth-first, OP flagged, bots / deleted / more stubs dropped, PII redacted, capped', () => {
  const nodes = [
    { kind: 't1', data: { id: 'a', author: 'op', body: 'Still waiting on Acme after three weeks, email me at x@y.com', replies: { data: { children: [
      { kind: 't1', data: { id: 'b', author: 'other', body: 'Same here, they never replied to me either.' } },
      { kind: 't1', data: { id: 'c', author: 'AutoModerator', body: 'This is an automated reminder about the rules.' } },
    ] } } } },
    { kind: 'more', data: {} },
    { id: 'd', author: 'x', body: '[deleted]', replies: [{ id: 'e', author: 'y', body: 'Reply under a deleted comment survives.' }] },
  ];
  const out = flattenCommentTree(nodes, { postAuthor: 'op' });
  assert.deepEqual(out.map((c) => c.id), ['a', 'b', 'e']);
  assert.equal(out[0].is_op, true);
  assert.match(out[0].body, /\[email\]/);
  assert.equal(out.some((c) => 'author' in c), false);
  assert.equal(flattenCommentTree(nodes, { postAuthor: 'op', maxComments: 1 }).length, 1);
});

test('arcticSearchQueries: one windowed, subreddit-scoped search per subreddit; quotes stripped', () => {
  const qs = arcticSearchQueries('Acme "Corp"', { nowMs: 1_800_000_000_000 });
  assert.equal(qs.length, 4);
  for (const q of qs) {
    assert.equal(q.term, 'Acme Corp');
    assert.ok(q.params.subreddit);
    assert.equal(Number(q.params.before) - Number(q.params.after), 365 * 86_400);
    assert.equal(q.params.fields.includes('permalink'), false);
  }
});

test('resetDelayMs: seconds-until-reset, epoch ms, retry-after', () => {
  assert.equal(resetDelayMs((k) => ({ 'x-ratelimit-reset': '12' })[k] ?? null), 12_000);
  assert.equal(resetDelayMs((k) => ({ 'x-ratelimit-reset-at': '1800000005000' })[k] ?? null, 1_800_000_000_000), 5000);
  assert.equal(resetDelayMs((k) => ({ 'retry-after': '3' })[k] ?? null), 3000);
  assert.equal(resetDelayMs(() => null), 0);
});

test('fetcher: spaces requests ≥ intervalMs and returns items', async () => {
  const c = clock();
  const starts = [];
  const f = createArcticFetcher({ fetchImpl: async () => { starts.push(c.now()); return res(200, { data: [1, 2] }); }, sleep: c.sleep, now: c.now, intervalMs: 1500 });
  const a = await f.get('/api/posts/search', { subreddit: 'jobs' });
  await f.get('/api/posts/search', { subreddit: 'jobs' });
  assert.deepEqual(a, { ok: true, status: 200, items: [1, 2], error: null });
  assert.ok(starts[1] - starts[0] >= 1500);
});

test('fetcher: server timeout (422 + error) is a plain failure, never a retry', async () => {
  const c = clock();
  let n = 0;
  const f = createArcticFetcher({ fetchImpl: async () => { n++; return res(422, { data: null, error: 'Timeout. Maybe slow down a bit' }); }, sleep: c.sleep, now: c.now });
  const r = await f.get('/api/posts/search', {});
  assert.equal(r.ok, false);
  assert.equal(r.status, 422);
  assert.match(r.error, /Timeout/);
  assert.equal(n, 1);
});

test('fetcher: rate limit → waits a short reset ONCE, then throws arctic_429', async () => {
  const c = clock();
  let n = 0;
  const limited = async () => { n++; return res(422, { data: null, error: 'Too many requests' }, { 'x-ratelimit-reset': '5' }); };
  const f = createArcticFetcher({ fetchImpl: limited, sleep: c.sleep, now: c.now });
  await assert.rejects(f.get('/x', {}), (e) => e instanceof RunStop && e.reason === 'arctic_429');
  assert.equal(n, 2);
  // A long reset is not waited for at all.
  let m = 0;
  const g = createArcticFetcher({ fetchImpl: async () => { m++; return res(429, '', { 'x-ratelimit-reset': '58' }); }, sleep: c.sleep, now: c.now });
  await assert.rejects(g.get('/x', {}), (e) => e.reason === 'arctic_429');
  assert.equal(m, 1);
  // A wait-then-success recovers.
  let k = 0;
  const h = createArcticFetcher({ fetchImpl: async () => (++k === 1 ? res(429, '', { 'x-ratelimit-reset': '2' }) : res(200, { data: [] })), sleep: c.sleep, now: c.now });
  assert.equal((await h.get('/x', {})).ok, true);
});

test('fetcher: deadline → RunStop("deadline") before a request starts; network error → failure', async () => {
  const c = clock();
  let deadline = c.now() + 10_000;
  let n = 0;
  const f = createArcticFetcher({ fetchImpl: async () => { n++; throw new TypeError('fetch failed'); }, sleep: c.sleep, now: c.now, deadlineAt: () => deadline });
  const r = await f.get('/x', {});
  assert.deepEqual([r.ok, r.status, r.error], [false, 0, 'network']);
  deadline = c.now() - 1;
  await assert.rejects(f.get('/x', {}), (e) => e instanceof RunStop && e.reason === 'deadline');
  assert.equal(n, 1);
});

test('discoverArctic: query → title fallback per subreddit; dedupes; answered only when a search succeeded', async () => {
  const c = clock();
  const calls = [];
  const fetchImpl = async (u) => {
    const q = new URL(u).searchParams;
    calls.push([q.get('subreddit'), q.get('query') ? 'query' : 'title']);
    if (q.get('subreddit') === 'jobs' && q.get('query')) return res(422, { data: null, error: 'Timeout. Maybe slow down a bit' });
    return res(200, { data: [{ id: 'abc111', subreddit: q.get('subreddit'), title: 'Acme ghosted me', selftext: 'x', author: 'op' }] });
  };
  const fetcher = createArcticFetcher({ fetchImpl, sleep: c.sleep, now: c.now });
  const d = await discoverArctic('acme', { fetcher, nowMs: c.now() });
  assert.equal(d.answered, true);
  assert.equal(d.items.length, 1, 'same post id across subreddits kept once');
  assert.equal(d.authors.get('abc111'), 'op');
  assert.deepEqual(calls.filter(([s]) => s === 'jobs'), [['jobs', 'query'], ['jobs', 'title']]);
  assert.equal(calls.length, 5);

  const down = createArcticFetcher({ fetchImpl: async () => res(422, { data: null, error: 'Timeout' }), sleep: c.sleep, now: c.now });
  const e = await discoverArctic('acme', { fetcher: down, nowMs: c.now() });
  assert.equal(e.answered, false);
  assert.equal(e.searches.length, 8);
});

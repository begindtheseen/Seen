import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePost, normalizeListing, fetchRedditJson, listNew } from './redditJson.js';

// Reddit's real envelope shape, trimmed to the fields we consume.
const listing = (children, after = null) => ({ kind: 'Listing', data: { after, children } });
const t3 = d => ({ kind: 't3', data: { id: 'abc123', name: 't3_abc123', subreddit: 'recruitinghell', title: 'T', ...d } });

test('normalizePost flattens a post and keeps aggregation signal', () => {
  const p = normalizePost(t3({
    selftext: 'Ghosted after final round', author: 'someone', created_utc: 1786700000.0,
    score: 42, num_comments: 7, upvote_ratio: 0.95, permalink: '/r/recruitinghell/comments/abc123/x/',
  }));
  assert.equal(p.id, 't3_abc123');
  assert.equal(p.kind, 'post');
  assert.equal(p.score, 42);
  assert.equal(p.num_comments, 7);
  assert.equal(p.created_utc, 1786700000);
  assert.equal(p.permalink, 'https://www.reddit.com/r/recruitinghell/comments/abc123/x/');
  assert.equal(p.removed, false);
});

test('normalizePost marks removed/deleted tombstones', () => {
  assert.equal(normalizePost(t3({ selftext: '[removed]' })).removed, true);
  assert.equal(normalizePost(t3({ selftext: '[deleted]' })).removed, true);
  assert.equal(normalizePost(t3({ selftext: 'ok', removed_by_category: 'moderator' })).removed, true);
});

test('normalizePost returns null for junk instead of a hollow object', () => {
  assert.equal(normalizePost(null), null);
  assert.equal(normalizePost({ kind: 't3' }), null);
  assert.equal(normalizePost({ kind: 't3', data: {} }), null);
});

test('normalizeListing extracts children and the pagination cursor', () => {
  const { items, after } = normalizeListing(listing([t3({}), t3({ id: 'd2', name: 't3_d2' })], 't3_d2'));
  assert.equal(items.length, 2);
  assert.equal(after, 't3_d2');
});

test('normalizeListing skips "more" stubs rather than emitting empties', () => {
  const { items } = normalizeListing(listing([t3({}), { kind: 'more', data: { count: 12 } }]));
  assert.equal(items.length, 1);
});

test('normalizeListing handles the array form used by comment pages', () => {
  const post = listing([t3({})]);
  const comments = listing([{ kind: 't1', data: { id: 'c1', name: 't1_c1', body: 'same happened to me', subreddit: 'recruitinghell' } }]);
  const { items } = normalizeListing([post, comments]);
  assert.equal(items.length, 2);
  assert.equal(items.filter(i => i.kind === 'post').length, 1);
  assert.equal(items.filter(i => i.kind === 'comment').length, 1);
  assert.equal(items.find(i => i.kind === 'comment').body, 'same happened to me');
});

test('normalizeListing degrades safely on a non-listing body', () => {
  // A block/interstitial page parsed as JSON must yield an empty list, not throw.
  assert.deepEqual(normalizeListing({}).items, []);
  assert.deepEqual(normalizeListing(null).items, []);
  assert.deepEqual(normalizeListing({ data: {} }).items, []);
});

// ── Transport behaviour ─────────────────────────────────────────────────────────────
// Backoff is injected at 1ms so these prove the RETRY LOGIC rather than the sleeping.
// With the real schedule a single throttled call takes 34 seconds across both hosts, which
// is exactly why the harvester bounds it — see api/reddit-harvest.js.

const origFetch = globalThis.fetch;
test.after(() => { globalThis.fetch = origFetch; });

/** Replay `responses` in order; record every requested URL. */
function replay(responses) {
  const urls = [];
  let i = 0;
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    const r = responses[Math.min(i++, responses.length - 1)];
    return {
      ok: r.status === 200,
      status: r.status,
      text: async () => (r.body === undefined ? '' : typeof r.body === 'string' ? r.body : JSON.stringify(r.body)),
    };
  };
  return urls;
}

const okListing = { status: 200, body: { kind: 'Listing', data: { after: null, children: [t3({ selftext: 'x' })] } } };

test('429 is retried and a later success is returned', async () => {
  const urls = replay([{ status: 429 }, { status: 429 }, okListing]);
  const r = await fetchRedditJson('/r/x/new', {}, { backoffMs: [1, 1, 1] });
  assert.equal(r.ok, true);
  assert.equal(r.attempts, 3, 'two throttles then success');
  assert.equal(urls.length, 3);
});

test('403 is NOT retried — it fails over to the other host immediately', async () => {
  const urls = replay([{ status: 403 }, { status: 403 }]);
  const r = await fetchRedditJson('/r/x/new', {}, { backoffMs: [1, 1, 1] });
  assert.equal(r.ok, false);
  assert.equal(r.status, 403);
  assert.equal(r.error, 'blocked');
  assert.equal(r.attempts, 2, 'one attempt per host, no retries — hammering deepens an IP block');
  assert.ok(urls[0].startsWith('https://www.reddit.com/'));
  assert.ok(urls[1].startsWith('https://old.reddit.com/'), 'second host is tried');
});

test('retries:0 skips backoff entirely', async () => {
  replay([{ status: 429 }]);
  const r = await fetchRedditJson('/r/x/new', {}, { retries: 0 });
  assert.equal(r.status, 429);
  assert.equal(r.attempts, 2, 'one per host, no waiting');
});

test('every request carries raw_json=1', async () => {
  // Without it Reddit HTML-escapes selftext and "AT&T" arrives as "AT&amp;T", which silently
  // breaks company matching — a miss that looks like an absence of discussion.
  const urls = replay([okListing]);
  await listNew('recruitinghell', { limit: 25 });
  assert.ok(urls[0].includes('raw_json=1'));
  assert.ok(urls[0].includes('limit=25'));
  assert.ok(urls[0].includes('/r/recruitinghell/new.json?'));
});

test('a 200 carrying HTML is a block page, not an empty subreddit', async () => {
  replay([{ status: 200, body: '<!DOCTYPE html><html>whoa there, pardner</html>' }]);
  const r = await fetchRedditJson('/r/x/new', {}, { retries: 0 });
  assert.equal(r.ok, false);
  assert.match(r.error, /non-json/);
});

test('a failed listNew returns an envelope with items:[], never a bare []', async () => {
  replay([{ status: 403 }]);
  const r = await listNew('x', { retries: 0 });
  assert.equal(r.ok, false);
  assert.equal(r.status, 403);
  assert.deepEqual(r.items, [], 'items is empty BUT ok/status say why — the old code lost that');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePost, normalizeListing } from './redditJson.js';

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

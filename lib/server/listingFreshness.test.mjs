import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeListingFreshness } from './listingFreshness.js';

// Fixed clock so every assertion is deterministic.
const NOW = Date.parse('2026-07-20T12:00:00Z');
const daysAgo = (n) => new Date(NOW - n * 86400000).toISOString();

test('aggregated fresh listing states listed-age and last-seen as plain facts', () => {
  const f = computeListingFreshness(
    { created_at: daysAgo(2), last_seen_at: daysAgo(1), availability_report_count: 0 },
    NOW,
  );
  assert.equal(f.daysListed, 2);
  assert.equal(f.daysSinceSeen, 1);
  assert.equal(f.freshness, 'fresh');
  assert.equal(f.label, 'Listed 2 days ago · last seen in results 1 day ago');
});

test('singular vs plural and "today" render correctly', () => {
  const one = computeListingFreshness({ created_at: daysAgo(1), last_seen_at: daysAgo(1) }, NOW);
  assert.equal(one.label, 'Listed 1 day ago · last seen in results 1 day ago');
  const today = computeListingFreshness({ created_at: daysAgo(0), last_seen_at: daysAgo(0) }, NOW);
  assert.equal(today.label, 'Listed today · last seen in results today');
});

test('freshness buckets are our-observation cadence, never an employer verdict', () => {
  assert.equal(computeListingFreshness({ last_seen_at: daysAgo(3) }, NOW).freshness, 'fresh');
  assert.equal(computeListingFreshness({ last_seen_at: daysAgo(14) }, NOW).freshness, 'aging');
  assert.equal(computeListingFreshness({ last_seen_at: daysAgo(45) }, NOW).freshness, 'stale');
  assert.equal(computeListingFreshness({}, NOW).freshness, 'unknown');
  // never emits accusatory language
  assert.doesNotMatch(computeListingFreshness({ last_seen_at: daysAgo(45) }, NOW).label, /ghost|fake|fraud/i);
});

test('last_checked_at is the fallback when last_seen_at is absent', () => {
  const f = computeListingFreshness({ created_at: daysAgo(10), last_checked_at: daysAgo(4) }, NOW);
  assert.equal(f.daysSinceSeen, 4);
  assert.equal(f.freshness, 'fresh');
});

test('employer-posted rows are framed as first-party provenance, not "last seen in results"', () => {
  const f = computeListingFreshness(
    { created_at: daysAgo(5), last_seen_at: daysAgo(5), is_employer_posted: true },
    NOW,
  );
  assert.equal(f.isEmployerPosted, true);
  assert.equal(f.freshness, 'employer');
  assert.equal(f.label, 'Posted directly by the employer 5 days ago');
  assert.doesNotMatch(f.label, /last seen in results/);
});

test('seeker reports are attributed to the seekers, appended as a fact', () => {
  const many = computeListingFreshness({ created_at: daysAgo(30), last_seen_at: daysAgo(20), availability_report_count: 3 }, NOW);
  assert.match(many.label, /3 job-seekers reported it closed$/);
  const one = computeListingFreshness({ created_at: daysAgo(30), last_seen_at: daysAgo(20), availability_report_count: 1 }, NOW);
  assert.match(one.label, /1 job-seeker reported it closed$/);
});

test('availability_report_count as a string still counts (PostgREST numeric-as-text)', () => {
  const f = computeListingFreshness({ created_at: daysAgo(1), last_seen_at: daysAgo(1), availability_report_count: '2' }, NOW);
  assert.equal(f.reportCount, 2);
  assert.match(f.label, /2 job-seekers reported it closed/);
});

test('missing timestamps yield an empty label and no fabricated numbers', () => {
  const f = computeListingFreshness({}, NOW);
  assert.equal(f.daysListed, null);
  assert.equal(f.daysSinceSeen, null);
  assert.equal(f.reportCount, 0);
  assert.equal(f.label, '');
});

test('clock skew (future created_at) clamps to 0, never negative', () => {
  const future = new Date(NOW + 3 * 86400000).toISOString();
  const f = computeListingFreshness({ created_at: future, last_seen_at: future }, NOW);
  assert.equal(f.daysListed, 0);
  assert.equal(f.label, 'Listed today · last seen in results today');
});

test('unparseable timestamps are ignored, not thrown on', () => {
  const f = computeListingFreshness({ created_at: 'not-a-date', last_seen_at: null }, NOW);
  assert.equal(f.daysListed, null);
  assert.equal(f.label, '');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportsReadFromQuery, jobsReadFromQuery, publicCacheControl, setPublicCache, PUBLIC_READ_CACHE } from './publicRead.js';

test('reports GET queries map to the exact POST bodies the handler routes', () => {
  assert.deepEqual(reportsReadFromQuery({ type: 'score', name: 'Home Depot' }), { name: 'Home Depot' });
  assert.deepEqual(reportsReadFromQuery({ type: 'list', company: 'walmart', city: '' }), { company: 'walmart', city: '' });
  assert.deepEqual(reportsReadFromQuery({ type: 'list', company: 'walmart' }), { company: 'walmart', city: '' });
  assert.deepEqual(reportsReadFromQuery({ type: 'benchmark', name: 'Sheetz' }), { action: 'industry_benchmark', name: 'Sheetz' });
  assert.deepEqual(reportsReadFromQuery({ type: 'perk', name: 'Sheetz' }), { action: 'employer_perk', name: 'Sheetz' });
  assert.deepEqual(reportsReadFromQuery({ type: 'leaderboard' }), { action: 'leaderboard' });
});

test('anything that is not a listed public read is refused (null), never guessed', () => {
  assert.equal(reportsReadFromQuery({ type: 'score' }), null);            // no name
  assert.equal(reportsReadFromQuery({ type: 'list', company: '  ' }), null);
  assert.equal(reportsReadFromQuery({ type: 'submit', name: 'x' }), null); // writes stay POST
  assert.equal(reportsReadFromQuery({ type: 'feed' }), null);
  assert.equal(reportsReadFromQuery({ type: 'industry' }), null);         // the legacy GET benchmark path, untouched
  assert.equal(reportsReadFromQuery({}), null);
  assert.equal(reportsReadFromQuery(undefined), null);
});

test('repeated query keys (arrays) use the first value and are length-capped', () => {
  const body = reportsReadFromQuery({ type: ['score', 'list'], name: ['Nike', 'Adidas'] });
  assert.deepEqual(body, { name: 'Nike' });
  const long = reportsReadFromQuery({ type: 'score', name: 'a'.repeat(500) });
  assert.equal(long.name.length, 200);
});

test('jobs GET queries map only the two company-page reads', () => {
  assert.deepEqual(jobsReadFromQuery({ action: 'listing_signals', company: 'SpaceX' }), { action: 'listing_signals', company: 'SpaceX' });
  assert.deepEqual(jobsReadFromQuery({ action: 'company_jobs', company: 'SpaceX' }), { action: 'company_jobs', company: 'SpaceX' });
  assert.equal(jobsReadFromQuery({ action: 'recommended', company: 'x' }), null); // user-specific
  assert.equal(jobsReadFromQuery({ action: 'listing_signals' }), null);
  assert.equal(jobsReadFromQuery({ query: 'nurse', location: 'Dallas' }), null); // search stays POST (per-user buckets)
});

test('cache-control values are public + s-maxage + stale-while-revalidate, one per kind', () => {
  for (const kind of Object.keys(PUBLIC_READ_CACHE)) {
    const v = publicCacheControl(kind);
    assert.match(v, /^public, s-maxage=\d+, stale-while-revalidate=\d+$/);
  }
  assert.equal(publicCacheControl('score'), 'public, s-maxage=60, stale-while-revalidate=600');
  assert.throws(() => publicCacheControl('nope'));
  const headers = {};
  setPublicCache({ setHeader: (k, v) => { headers[k] = v; } }, 'reddit_checking');
  assert.equal(headers['Cache-Control'], 'public, s-maxage=30, stale-while-revalidate=60');
});

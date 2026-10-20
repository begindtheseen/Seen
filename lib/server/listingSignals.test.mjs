// Run: node --test lib/server/listingSignals.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listingSignals, WEIGHTS, hasPay, isDirect } from './listingSignals.js';

const NOW = Date.parse('2026-10-20T12:00:00Z');
const day = (d) => new Date(NOW - d * 86_400_000).toISOString();

test('fewer than 3 posts: no rating, and it says why', () => {
  assert.deepEqual(listingSignals([], { now: NOW }), { rated: false, listings: 0, reason: 'no open job posts on Seen' });
  assert.match(listingSignals([{}, {}], { now: NOW }).reason, /only 2 open job posts — a rating needs 3/);
});

test('the score is exactly the weighted sum of its stated factors', () => {
  const rows = [
    { salary: '$51k–$70k', score: 95, source: 'Greenhouse', source_type: 'ATS_DIRECT', created_at: day(2) },
    { salary: null, score: 18, source: 'Adzuna', created_at: day(40) },
    { salary: '$18/hr', score: 56.5, source: 'Adzuna', created_at: day(5) },
    { salary: '', score: 56.5, source: 'Adzuna', canonical_url: null, created_at: day(3) },
  ];
  const r = listingSignals(rows, { now: NOW });
  assert.equal(r.rated, true);
  const by = Object.fromEntries(r.factors.map((f) => [f.key, f.value]));
  assert.deepEqual(by, { pay: 50, quality: 50, direct: 25, fresh: 75 });
  const expected = Math.round(100 * (WEIGHTS.pay * 0.5 + WEIGHTS.quality * 0.5 + WEIGHTS.direct * 0.25 + WEIGHTS.fresh * 0.75));
  assert.equal(r.score, expected);
  assert.equal(r.band, 'thin');
  assert.match(r.basis, /not applicant reports/);
  assert.match(r.factors.find((f) => f.key === 'fresh').detail, /1 of 4 have been open on Seen 30\+ days/);
});

test('a missing part drops out and the rest are rescaled — never guessed', () => {
  const rows = [1, 2, 3].map(() => ({ salary: '$40k', source: 'Lever', created_at: null }));
  const r = listingSignals(rows, { now: NOW });
  assert.deepEqual(r.factors.map((f) => f.key), ['pay', 'direct']);
  assert.equal(r.score, 100);
  assert.equal(r.band, 'clear');
});

test('what counts as pay and as applying with the employer', () => {
  assert.equal(hasPay({ salary: 'Not listed' }), false);
  assert.equal(hasPay({ salary: '$36k' }), true);
  assert.equal(hasPay({ salary_min: 41000 }), true);
  assert.equal(isDirect({ source: 'Adzuna' }), false);
  assert.equal(isDirect({ source_type: 'EMPLOYER_SITE' }), true);
  assert.equal(isDirect({ is_employer_posted: true }), true);
  assert.equal(isDirect({ source: 'Career site (Chrome)' }), true);
});

// Search priority for listings posted on Seen by employers. Run: node --test lib/server/jobPriority.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normCompany, priorityTier, sortByPriority, companyMatchesQuery, isRemoteListing } from './jobPriority.js';

test('company search matches however the name is typed', () => {
  for (const q of ['seen jobs', 'SeenJobs', 'seen-jobs', 'Seen Jobs software engineer']) {
    assert.equal(companyMatchesQuery('Seen Jobs', q), true, q);
  }
  assert.equal(companyMatchesQuery('Seen Jobs', 'seen'), true); // partial name, ≥4 chars
  assert.equal(companyMatchesQuery('Seen Jobs', 'barista'), false);
  assert.equal(companyMatchesQuery('', 'seen jobs'), false);
  // Short company names need an exact match — "HP" must not match "ship" or "phone".
  assert.equal(companyMatchesQuery('HP', 'shipping clerk'), false);
  assert.equal(companyMatchesQuery('HP', 'hp'), true);
  assert.equal(normCompany('Seen Jobs, Inc.'), 'seenjobsinc');
});

test('tiers: Featured+posted > Featured > posted on Seen > aggregated', () => {
  assert.equal(priorityTier({}), 0);
  assert.equal(priorityTier({ employer_posted: true }), 1);
  assert.equal(priorityTier({ featured: true }), 2);
  assert.equal(priorityTier({ featured: true, employer_posted: true }), 3);
  assert.equal(priorityTier(null), 0);
});

test('sortByPriority is stable within a tier and never mutates', () => {
  const list = [
    { id: 'a1' }, { id: 'p1', employer_posted: true }, { id: 'a2' },
    { id: 'f1', featured: true }, { id: 'p2', employer_posted: true }, { id: 'fp', featured: true, employer_posted: true },
  ];
  const copy = JSON.parse(JSON.stringify(list));
  assert.deepEqual(sortByPriority(list).map((j) => j.id), ['fp', 'f1', 'p1', 'p2', 'a1', 'a2']);
  assert.deepEqual(list, copy);
  assert.deepEqual(sortByPriority(undefined), []);
});

test('isRemoteListing reads the location', () => {
  assert.equal(isRemoteListing({ location: 'Remote' }), true);
  assert.equal(isRemoteListing({ location: 'Austin, TX (work from home)' }), true);
  assert.equal(isRemoteListing({ location: 'Austin, TX' }), false);
});

// Search priority for listings posted on Seen by employers. Run: node --test lib/server/jobPriority.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normCompany, priorityTier, sortByPriority, companyMatchesQuery, queryNamesCompany, isRemoteListing, inSearchedArea } from './jobPriority.js';

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
  // Naming the company outranks paid placement for someone else.
  assert.equal(priorityTier({ company_match: true }), 4);
  assert.ok(priorityTier({ company_match: true }) > priorityTier({ featured: true, employer_posted: true }));
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

test('queryNamesCompany: the search must contain the whole company name', () => {
  assert.equal(queryNamesCompany('Target Corporation', 'target'), true);
  assert.equal(queryNamesCompany('Topgolf', 'topgolf dallas'), true);
  assert.equal(queryNamesCompany('Seen Jobs', 'SeenJobs'), true);
  assert.equal(queryNamesCompany('Nurse Staffing LLC', 'nurse'), false);
  assert.equal(queryNamesCompany('Cashier Depot', 'cashier'), false);
  assert.equal(queryNamesCompany('HP', 'shipping'), false);
  assert.equal(queryNamesCompany('', 'anything'), false);
});

test('sortByPriority keeps in-radius rows ahead of far-away fill-ins, even Featured ones', () => {
  const list = [
    { id: 'far-featured', featured: true, in_radius: false },
    { id: 'near-1', in_radius: true },
    { id: 'far-2', in_radius: false },
    { id: 'near-posted', employer_posted: true, in_radius: true },
    { id: 'unknown' }, // no flag → treated as in the searched area
  ];
  assert.deepEqual(sortByPriority(list).map((j) => j.id), ['near-posted', 'near-1', 'unknown', 'far-featured', 'far-2']);
  assert.equal(inSearchedArea({ in_radius: false }), false);
  assert.equal(inSearchedArea({}), true);
});

test('sortByPriority: every match before every other opening, whatever came first', async () => {
  const { sortByPriority: sort, isMatch } = await import('./jobPriority.js');
  const list = [
    { id: 'other-near-featured', related: false, featured: true, in_radius: true },
    { id: 'match-far', related: true, in_radius: false },
    { id: 'other-near', related: false },
    { id: 'match-near', related: true },
    { id: 'legacy' },
  ];
  assert.deepEqual(sort(list).map((j) => j.id), ['match-near', 'legacy', 'match-far', 'other-near-featured', 'other-near']);
  assert.equal(isMatch({}), true);
  assert.equal(isMatch({ related: false }), false);
});

test('isSeedListing: Seen\'s own seed rows never reach results', async () => {
  const { isSeedListing } = await import('./jobPriority.js');
  assert.equal(isSeedListing({ company: 'Seen Jobs', apply_url: 'https://Seenjobs.io' }), true);
  assert.equal(isSeedListing({ company: 'Acme', url: 'https://www.seenjobs.io/x' }), true);
  assert.equal(isSeedListing({ company: 'Seen', apply_url: null }), true);
  assert.equal(isSeedListing({ company: 'Acme', apply_url: 'https://boards.greenhouse.io/acme/1' }), false);
  assert.equal(isSeedListing({ company: 'Seenergy', apply_url: 'https://evil.com/?r=seenjobs.io' }), false);
});

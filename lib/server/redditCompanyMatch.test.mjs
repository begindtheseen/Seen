import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeName, buildCompanyIndex, detectCompanies } from './redditCompanyMatch.js';

const CATALOGUE = [
  { id: 1, name: 'Stripe, Inc.' },
  { id: 2, name: 'American Express' },
  { id: 3, name: 'Target' },
  { id: 4, name: 'Acme Robotics Holdings LLC' },
  { id: 5, name: 'Deloitte' },
];
const index = buildCompanyIndex(CATALOGUE);

test('normalizeName strips legal suffixes and punctuation', () => {
  assert.equal(normalizeName('Stripe, Inc.'), 'stripe');
  assert.equal(normalizeName('Acme Robotics Holdings LLC'), 'acme robotics');
  assert.equal(normalizeName("Wendy's"), 'wendys');
  assert.equal(normalizeName('  DELOITTE  '), 'deloitte');
  assert.equal(normalizeName(null), '');
});

test('multiword company matches and beats its own prefix', () => {
  const hits = detectCompanies(
    { title: 'Ghosted by American Express after final round', body: 'recruiter never heard back' },
    index,
  );
  const names = hits.map(h => h.name);
  assert.ok(names.includes('American Express'), 'should match the full two-word name');
  // "American" alone is not in the catalogue, so nothing spurious should appear.
  assert.equal(hits.length, 1);
  assert.ok(hits[0].confidence >= 0.8, 'multiword + title should be high confidence');
});

test('ambiguous single word is REJECTED without capitalisation', () => {
  const hits = detectCompanies(
    { title: 'I finally hit my target', body: 'the recruiter said my application was strong' },
    index,
  );
  assert.equal(hits.length, 0, 'lowercase "target" in job text must not become a Target report');
});

test('ambiguous single word is ACCEPTED with capitalisation + job context', () => {
  const hits = detectCompanies(
    { title: 'Target ghosted me', body: 'applied and never heard back from the recruiter' },
    index,
  );
  assert.equal(hits.length, 1);
  assert.equal(hits[0].name, 'Target');
  assert.ok(hits[0].confidence < 0.9, 'ambiguous match should stay below an unambiguous one');
});

test('no job context yields nothing at all', () => {
  const hits = detectCompanies(
    { title: 'Stripe payments integration question', body: 'how do I refund a charge' },
    index,
  );
  assert.equal(hits.length, 0);
});

test('comments contribute matches, and repetition raises confidence', () => {
  const once = detectCompanies({ title: 'Ghosted', body: 'Deloitte never responded to my application' }, index);
  const many = detectCompanies(
    { title: 'Ghosted', body: 'Deloitte never responded to my application', comments: ['Deloitte did the same to me after the interview'] },
    index,
  );
  assert.equal(once[0].name, 'Deloitte');
  assert.ok(many[0].occurrences > once[0].occurrences);
  assert.ok(many[0].confidence >= once[0].confidence);
});

test('legal-suffix variants in text resolve to the catalogue entry', () => {
  const hits = detectCompanies(
    { title: 'Acme Robotics rejected me', body: 'after the phone screen, no offer' },
    index,
  );
  assert.equal(hits.length, 1);
  assert.equal(hits[0].name, 'Acme Robotics Holdings LLC');
});

test('every match carries evidence, never a bare assertion', () => {
  const hits = detectCompanies({ title: 'Stripe ghosted me', body: 'applied, no response' }, index);
  assert.equal(hits.length, 1);
  assert.match(hits[0].evidence, /job context present/);
  assert.match(hits[0].evidence, /in title/);
});

test('empty and malformed inputs do not throw', () => {
  assert.deepEqual(detectCompanies({}, index), []);
  assert.deepEqual(detectCompanies({ title: '' }, index), []);
  assert.deepEqual(detectCompanies({ title: 'Stripe ghosted' }, { byKey: new Map(), maxWords: 1 }), []);
});

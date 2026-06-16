// Tests for job relevance + company matching. Run: node --test api/_utils/jobRelevance.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { relevanceScore, isRelated, looksLikeCompany, filterAndRank, tokenize, parseLocation, locationScore, filterByLocation, locationDbTerm } from './jobRelevance.js';

const J = (title, company, description = '') => ({ title, company, description, score: 65 });
const L = (location) => ({ title: 'Nurse', company: 'X', location, score: 65 });

test('unrelated listings score 0 and are dropped', () => {
  assert.equal(relevanceScore(J('Truck Driver', 'Acme Logistics'), 'react engineer'), 0);
  assert.equal(isRelated(J('Truck Driver', 'Acme Logistics'), 'react engineer'), false);
});

test('title matches rank above description matches', () => {
  const titleHit = relevanceScore(J('Senior React Engineer', 'X'), 'react engineer');
  const descHit = relevanceScore(J('Backend Developer', 'X', 'some react experience helpful'), 'react engineer');
  assert.ok(titleHit > descHit);
  assert.ok(descHit > 0);
});

test('empty query → everything related', () => {
  assert.equal(isRelated(J('Anything', 'AnyCo'), ''), true);
  assert.equal(relevanceScore(J('Anything', 'AnyCo'), ''), 1);
});

test('company-name query scores the company strongly', () => {
  const atCompany = relevanceScore(J('Software Engineer', 'Stripe'), 'stripe');
  const notCompany = relevanceScore(J('Software Engineer', 'Acme'), 'stripe');
  assert.ok(atCompany >= 60);
  assert.equal(notCompany, 0);
});

test('filterAndRank drops junk and orders by relevance', () => {
  const jobs = [
    J('Truck Driver', 'Acme'),                       // unrelated
    J('Backend Developer', 'Y', 'react a plus'),     // weak
    J('Senior React Engineer', 'Z'),                 // strong
  ];
  const out = filterAndRank(jobs, 'react engineer');
  assert.equal(out.length, 2);
  assert.equal(out[0].title, 'Senior React Engineer');
});

test('looksLikeCompany detects a company-name search', () => {
  const known = ['Stripe', 'Amazon', 'Google'];
  assert.equal(looksLikeCompany('stripe', known), true);
  assert.equal(looksLikeCompany('Amazon Inc', known), true);
  assert.equal(looksLikeCompany('react engineer', known), false);
  assert.equal(looksLikeCompany('stripe', undefined), false); // no list → can't assert
});

test('tokenize strips stop words and noise', () => {
  assert.deepEqual(tokenize('Jobs for a Senior Engineer near me'), ['senior', 'engineer']);
  assert.deepEqual(tokenize('C++ developer'), ['c++', 'developer']);
});

test('phrase bonus when full query is in the title', () => {
  const exact = relevanceScore(J('Data Scientist', 'X'), 'data scientist');
  const split = relevanceScore(J('Scientist of Data', 'X'), 'data scientist');
  assert.ok(exact > split);
});

test('parseLocation handles "City, ST", "City, State", bare state, and remote', () => {
  assert.deepEqual(parseLocation('Austin, TX'), { city: 'austin', stateAbbr: 'tx', stateName: 'texas', remote: false });
  assert.deepEqual(parseLocation('Dallas, Texas'), { city: 'dallas', stateAbbr: 'tx', stateName: 'texas', remote: false });
  assert.equal(parseLocation('Austin TX').city, 'austin');
  assert.equal(parseLocation('Austin TX').stateAbbr, 'tx');
  assert.equal(parseLocation('Texas').city, '');
  assert.equal(parseLocation('Texas').stateName, 'texas');
  assert.equal(parseLocation('Remote').remote, true);
  // "Washington, DC" must stay DC, not flip to Washington state.
  assert.equal(parseLocation('Washington, DC').stateAbbr, 'dc');
  assert.equal(parseLocation('Washington, DC').city, 'washington');
});

test('locationScore: city > state > remote/national > none', () => {
  const p = parseLocation('Austin, TX');
  assert.equal(locationScore('Austin, Travis County', p), 3);     // city
  assert.equal(locationScore('Dallas, Texas', p), 2);             // same state
  assert.equal(locationScore('Round Rock, TX', p), 2);            // state abbr token
  assert.equal(locationScore('Remote', p), 1);                    // remote available anywhere
  assert.equal(locationScore('US', p), 1);                        // national
  assert.equal(locationScore('Houston, Harris County', p), 0);    // wrong city, no state token
  assert.equal(locationScore('Los Angeles, Los Angeles County', p), 0);
});

test('filterByLocation drops cross-location, ranks city first (Austin bug)', () => {
  const jobs = [
    L('Los Angeles, Los Angeles County'),
    L('Houston, Harris County'),
    L('Austin, Travis County'),
    L('Grand Central, Manhattan'),
    L('Dallas, Texas'),
  ];
  const out = filterByLocation(jobs, 'Austin, TX');
  assert.deepEqual(out.map((j) => j.location), ['Austin, Travis County', 'Dallas, Texas']);
  // No location → unchanged.
  assert.equal(filterByLocation(jobs, '').length, jobs.length);
});

test('locationDbTerm returns the city (or state) for the DB pre-filter', () => {
  assert.equal(locationDbTerm('Austin, TX'), 'austin');
  assert.equal(locationDbTerm('New York, NY'), 'new york');
  assert.equal(locationDbTerm('Texas'), 'texas');
  assert.equal(locationDbTerm(''), '');
});

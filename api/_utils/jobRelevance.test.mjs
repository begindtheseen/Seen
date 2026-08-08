// Tests for job relevance + company matching. Run: node --test api/_utils/jobRelevance.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { relevanceScore, isRelated, isRelevant, effectiveSynonyms, looksLikeCompany, filterAndRank, tokenize, parseLocation, locationScore, filterByLocation, locationDbTerm, expandQueryTerms } from './jobRelevance.js';

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

test('filterAndRank keeps title/synonym matches, drops description-only + junk', () => {
  const jobs = [
    J('Truck Driver', 'Acme'),                       // unrelated → drop
    J('Backend Developer', 'Y', 'react a plus'),     // "react" only in DESC → drop (strict bar)
    J('Senior React Engineer', 'Z'),                 // title → keep, ranks first
    J('React Native Developer', 'W'),                // title token → keep
  ];
  const out = filterAndRank(jobs, 'react engineer');
  assert.equal(out.length, 2);
  assert.equal(out[0].title, 'Senior React Engineer');
  assert.ok(out.map((j) => j.title).includes('React Native Developer'));
  assert.ok(!out.map((j) => j.title).includes('Backend Developer')); // description-only is not enough
});

// ── THE REPORTED LEAK: "budtender" must not return "Sales Manager" ──────────────
test('budtender: cannabis/dispensary roles are relevant; sales/account roles are NOT', () => {
  const q = 'budtender';
  // Real cannabis roles — relevant. "Cannabis Dispensary Associate" shares NO token with
  // "budtender"; it is recognized via curated true synonyms (cannabis / dispensary).
  assert.equal(isRelevant(J('Budtender', 'Green Cross'), q), true);
  assert.equal(isRelevant(J('Cannabis Dispensary Associate', 'GreenLeaf'), q), true);
  assert.equal(isRelated(J('Dispensary Associate', 'GreenLeaf'), q), true);

  // The exact reported bug — these must be dropped.
  assert.equal(isRelevant(J('Sales Manager', 'BigBox Retail'), q), false);
  assert.equal(isRelevant(J('Account Executive', 'SaaSCo'), q), false);

  // A Sales Manager whose DESCRIPTION merely mentions budtenders is still not a budtender.
  assert.equal(isRelevant(J('Sales Manager', 'BigBox', 'manage a team of budtenders'), q), false);

  // Even if LLM-style expansion injects a generic "sales" term, the leak stays closed
  // (generic single-word synonyms are dropped; phrases are matched against the title).
  assert.equal(isRelevant(J('Sales Manager', 'X'), q, { synonyms: ['sales', 'retail sales associate'] }), false);

  // End-to-end: only the cannabis roles survive filterAndRank.
  const jobs = [
    J('Sales Manager', 'BigBox'),
    J('Budtender', 'Green Cross'),
    J('Cannabis Dispensary Associate', 'GreenLeaf'),
    J('Account Executive', 'SaaSCo'),
  ];
  const kept = new Set(filterAndRank(jobs, q).map((j) => j.title));
  assert.deepEqual(kept, new Set(['Budtender', 'Cannabis Dispensary Associate']));
});

// ── Deterministic role-family expansion (no-AI bridge) ──────────────────────────
test('expandQueryTerms bridges what a seeker types → what employers title the job', () => {
  // "theft prevention" → the loss-prevention / asset-protection / security family.
  const theft = expandQueryTerms('theft prevention');
  assert.ok(theft.includes('asset protection'), 'theft prevention → asset protection');
  assert.ok(theft.includes('loss prevention'));
  assert.ok(theft.includes('security officer'));
  assert.ok(!theft.includes('theft prevention'), 'excludes the query itself');

  // "warehouse" → material-handler family (titles rarely say "warehouse").
  const wh = expandQueryTerms('warehouse');
  assert.ok(wh.includes('material handler'));
  assert.ok(wh.includes('package handler'));

  // Bidirectional: a member query resolves the whole family too.
  assert.ok(expandQueryTerms('asset protection').includes('loss prevention'));

  // Unknown / non-family query → no expansion (never invents synonyms).
  assert.deepEqual(expandQueryTerms('quantum blockchain wizard'), []);

  // No expansion term is a bare generic word that would pull unrelated jobs.
  const GENERIC = new Set(['sales', 'manager', 'associate', 'assistant', 'representative', 'specialist']);
  for (const q of ['theft prevention', 'warehouse', 'budtender', 'cashier', 'delivery driver']) {
    for (const t of expandQueryTerms(q)) assert.ok(!GENERIC.has(t), `${q} expanded to bare generic "${t}"`);
  }
});

test('provenance: a job fetched FOR this query (search_query) is relevant even without a title hit', () => {
  // The exact production bug: "Asset Protection Specialist" cached under search_query="theft
  // prevention" was dropped by the title-only bar. Provenance recovers it.
  const ap = { title: 'Asset Protection Specialist', company: 'Target', description: 'prevent shrink', search_query: 'theft prevention' };
  assert.equal(isRelevant(ap, 'theft prevention'), true);
  assert.ok(relevanceScore(ap, 'theft prevention') > 0);

  // Curated synonyms ALSO recover it by title, independent of provenance.
  const apNoProv = { title: 'Asset Protection Specialist', company: 'Target' };
  assert.equal(isRelevant(apNoProv, 'theft prevention'), true);

  // Provenance is keyed to the ORIGINAL query only — a job stamped with an UNRELATED
  // search_query is NOT rescued (this is what keeps the budtender→Sales Manager leak closed).
  const salesMgr = { title: 'Sales Manager', company: 'BigBox', search_query: 'sales' };
  assert.equal(isRelevant(salesMgr, 'budtender'), false);
  // Canonical is accepted too (aggregation stamps the canonical key).
  const ap2 = { title: 'Loss Prevention Officer', company: 'Macy\'s', search_query: 'loss prevention' };
  assert.equal(isRelevant(ap2, 'theft prevention', { canonical: 'loss prevention' }), true);

  // A BARE company / common word does NOT trust provenance — sources full-text-match "target"
  // inside unrelated descriptions, so a "target" search stamped a Nurse Manager. Only company/
  // title match keeps real results (this is the fix for the "Nurse Manager for target" noise).
  const noise = { title: 'Nurse Manager', company: 'Kaiser', search_query: 'target' };
  assert.equal(isRelevant(noise, 'target'), false);
  const realTarget = { title: 'Cashier', company: 'Target', search_query: 'target' };
  assert.equal(isRelevant(realTarget, 'target'), true); // kept by company match, not provenance
});

test('theft prevention: end-to-end, real titles survive filterAndRank (was 1 → many)', () => {
  const jobs = [
    { title: 'Asset Protection Specialist', company: 'Target', search_query: 'theft prevention' },
    { title: 'Loss Prevention Officer', company: "Macy's", search_query: 'theft prevention' },
    { title: 'Target Security Specialist', company: 'Target', search_query: 'theft prevention' },
    { title: 'Security Officer - San Clemente', company: 'CGS', search_query: 'theft prevention' },
    { title: 'Software Engineer', company: 'Unrelated', search_query: 'software engineer' }, // must NOT leak in
  ];
  const kept = filterAndRank(jobs, 'theft prevention', { synonyms: expandQueryTerms('theft prevention'), canonical: 'theft prevention' });
  assert.equal(kept.length, 4, 'the four loss-prevention roles survive');
  assert.ok(!kept.map((j) => j.title).includes('Software Engineer'), 'unrelated cached job excluded');
});

test('effectiveSynonyms: drops generic single words, keeps discriminating words + phrases', () => {
  const syns = effectiveSynonyms('budtender', ['sales', 'manager', 'cannabis', 'retail sales associate']);
  assert.ok(syns.includes('cannabis'));                 // discriminating single word kept
  assert.ok(syns.includes('retail sales associate'));   // multi-word phrase kept
  assert.ok(!syns.includes('sales'));                   // generic single word dropped
  assert.ok(!syns.includes('manager'));                 // generic single word dropped
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

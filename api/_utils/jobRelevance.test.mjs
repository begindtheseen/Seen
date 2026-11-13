// Tests for job relevance + company matching. Run: node --test api/_utils/jobRelevance.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { relevanceScore, isRelated, isRelevant, effectiveSynonyms, looksLikeCompany, filterAndRank, tokenize, parseLocation, locationScore, filterByLocation, locationDbTerm, expandQueryTerms, seniorityPenalty, tokenInTitle } from './jobRelevance.js';

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

// ── Live audit 2026-10-23: "customer service" opened with a PwC Director + Deloitte "ServiceNow" ──
test('customer service: the plain role outranks Director/Architect titles; "ServiceNow" is not "service"', () => {
  const q = 'customer service';
  const csr = J('Customer Service Representative', 'PLS');
  const dir = J('Managed Services - Data, Analytics & AI - Director', 'PwC');
  const snow = J('Cyber ServiceNow Architect', 'Deloitte');
  const care = J('Customer Care Specialist', 'Lucid', 'customer service for owners');
  assert.equal(isRelevant(snow, q), false, 'token "service" must not match inside "ServiceNow"');
  assert.equal(isRelevant(dir, q), true, 'still relevant (Services), just ranked low');
  assert.ok(relevanceScore(csr, q) > relevanceScore(care, q), 'full phrase beats one token');
  assert.ok(relevanceScore(care, q) > relevanceScore(dir, q), 'one plain token beats a Director with one token');
  const out = filterAndRank([dir, snow, care, csr], q).map((j) => j.title);
  assert.deepEqual(out, ['Customer Service Representative', 'Customer Care Specialist', 'Managed Services - Data, Analytics & AI - Director']);
});

test('a query that names a seniority pays no seniority penalty', () => {
  assert.equal(seniorityPenalty('Senior Registered Nurse', 'senior nurse'), 0);
  assert.equal(seniorityPenalty('Director of Customer Service', 'director customer service'), 0);
  assert.ok(seniorityPenalty('Director of Customer Service', 'customer service') >= 40);
  assert.ok(seniorityPenalty('Senior Customer Service Rep', 'customer service') >= 20);
  assert.equal(seniorityPenalty('Customer Service Representative', 'customer service'), 0);
  // "nurse" still finds "Nurses" / "Nursing", not "Nursery".
  assert.equal(tokenInTitle('registered nurses', 'nurse'), true);
  assert.equal(tokenInTitle('nursing assistant', 'nurse'), false); // "nursing" is nurs+ing, not nurse+ing
  assert.equal(tokenInTitle('nursery worker', 'nurse'), false);
  assert.equal(tokenInTitle('software engineering manager', 'engineer'), true);
});

// H9 (audit 2026-10-24, scratchpad audit3/jobs/matrix.json): rows that shared one word with the search
// were served as matches. Each pair is a real served title.
test('isTitleRelated: a match is the role searched, not a shared word', async () => {
  const { isTitleRelated } = await import('./jobRelevance.js');
  const rel = (title, q, company = 'Acme') => isTitleRelated({ title, company }, q);
  // pharmacy technician · Phoenix
  assert.equal(rel('Environmental Services & Facilities Technician', 'pharmacy technician'), false);
  assert.equal(rel('Pharmacy Technician', 'pharmacy technician'), true);
  assert.equal(rel('Pharmacy Tech II', 'pharmacy technician'), true);
  // call center · Phoenix
  assert.equal(rel('Mechanical Engineer – Mission Critical Data Centers', 'call center'), false);
  assert.equal(rel('Center-Based Behavior Technician', 'call center'), false);
  assert.equal(rel('Call Center Representative', 'call center'), true);
  assert.equal(rel('Customer Service Representative', 'call center'), true, 'same role family');
  // retail manager · Tucson
  assert.equal(rel('Case Manager (PRN/Pool)', 'retail manager'), false);
  assert.equal(rel('Store Manager', 'retail manager'), true);
  // marketing manager / sales associate
  assert.equal(rel('Group Product Manager', 'marketing manager'), false);
  assert.equal(rel('Senior Marketing Manager', 'marketing manager'), true);
  assert.equal(rel('Consulting Associate / Forensic Services', 'sales associate'), false);
  assert.equal(rel('Retail Sales Associate', 'sales associate'), true);
  // single-word and family queries keep working
  assert.equal(rel('Cosmetics Cashier', 'cashier'), true);
  assert.equal(rel('Material Handler', 'warehouse'), true);
  assert.equal(rel('Registered Nurses', 'nurse'), true);
  // a company search matches every row at that company
  assert.equal(rel('Shift Supervisor', 'starbucks', 'Starbucks'), true);
  assert.equal(rel('anything', ''), true, 'no query → nothing to judge');
});

test('isTitleRelated: abbreviations a title uses count as the query word (live 2026-10-24)', async () => {
  const { isTitleRelated } = await import('./jobRelevance.js');
  // A "travel nurse" search on the preview marked these real Phoenix listings as unrelated.
  for (const title of ['Travel Med Surg RN', 'Travel Progressive Care Unit RN - $2,456 per week', 'Travel Behavioral Health RN - $2,184 per week', 'Travel LPN - Long Term Care']) {
    assert.equal(isTitleRelated({ title, company: 'Aya Healthcare' }, 'travel nurse'), true, title);
  }
  assert.equal(isTitleRelated({ title: 'Pharmacy Tech II', company: 'CVS' }, 'pharmacy technician'), true);
  assert.equal(isTitleRelated({ title: 'Customer Service Rep', company: 'X' }, 'customer service representative'), true);
  // still whole-word only, and only real abbreviations
  assert.equal(isTitleRelated({ title: 'Nursery Teacher', company: 'X' }, 'travel nurse'), false);
  assert.equal(isTitleRelated({ title: 'Travel Agent', company: 'X' }, 'travel nurse'), false);
  assert.equal(isTitleRelated({ title: 'Technical Writer', company: 'X' }, 'pharmacy technician'), false);
});

test('ranking: a tighter title match outranks a buried one; the searcher\'s own industry leads among equals (team lead · Phoenix, round 3)', async () => {
  const { relevanceScore, filterAndRank, searchFitFromSignal, industryOf, fitBoost, titleTightness } = await import('./jobRelevance.js');
  // The live rows (2026-11-03): every title matched "team lead" equally; the posting score (88) put the insurer first.
  const jencap = { title: 'Underwriting Operations Team Lead', company: 'Jencap', score: 88, description: 'Why Jencap? We are one of the largest wholesale insurance intermediaries in the United States with expertise in wholesale brokerage, binding authority.' };
  const walmart = { title: '(USA) Member Team Lead', company: 'Walmart', score: 62, description: "Position Summary What you'll do Assists management with the supervision of associates in assigned area of responsibility by assigning duties to associates in the club store." };
  const sonora = { title: 'Patient Services Team Lead (PRQ)', company: 'Sonora Quest Laboratories', score: 50, description: 'Primary City/State: Mesa, Arizona Department Name: PSC-Power Road-PRQ Job Category: Phlebotomy. Patient services in the laboratory.' };
  const hello = { title: 'IT Operations Team Lead (Fulfillment Centres)', company: 'HelloFresh', score: 80, description: 'For our growing North America IT function, we are looking for a Team Lead, IT Operations to own the technology experience across all US fulfillment centres.' };
  const bare = { title: 'Team Lead', company: 'Acme', score: 40, description: 'Lead a team.' };
  const q = 'team lead';
  // Tightness: a bare title is +6, each extra title word costs one.
  assert.equal(titleTightness('Team Lead', ['team', 'lead']), 6);
  assert.equal(titleTightness('Underwriting Operations Team Lead', ['team', 'lead']), 4);
  assert.equal(titleTightness('IT Operations Team Lead (Fulfillment Centres)', ['team', 'lead']), 2);
  assert.equal(titleTightness('Team Lead, Android Core Product - Cleveland, OH, USA', ['team', 'lead']), 3, 'the city clause is not title words');
  assert.ok(relevanceScore(bare, q) > relevanceScore(jencap, q));
  assert.ok(relevanceScore(jencap, q) > relevanceScore(hello, q), 'four title words beat six');
  // No résumé: title tiers first, posting score breaks the tie — the insurer stays a legitimate #1 among 4-word titles.
  assert.deepEqual(filterAndRank([sonora, jencap, walmart, hello], q).map((j) => j.company), ['Jencap', 'Walmart', 'Sonora Quest Laboratories', 'HelloFresh']);
  // Industry read from the row.
  assert.equal(industryOf(walmart), 'retail');
  assert.equal(industryOf(jencap), 'finance');
  assert.equal(industryOf(sonora), 'healthcare');
  // A retail résumé ("Team Lead" / "Department Supervisor" at a grocer are 'general' to the ontology — the industry bucket carries it).
  const fit = searchFitFromSignal({ top_titles: ['Team Lead', 'Department Supervisor'], function: 'other', industry: 'retail' });
  assert.deepEqual(fit, { families: [], industry: 'retail' });
  assert.equal(fitBoost(walmart, fit), 6);
  assert.equal(fitBoost(jencap, fit), 0);
  assert.deepEqual(filterAndRank([sonora, jencap, walmart, hello], q, { fit }).map((j) => j.company), ['Walmart', 'Jencap', 'Sonora Quest Laboratories', 'HelloFresh']);
  // A healthcare résumé: the lab's team lead leads; a family match is worth more than an industry match.
  const nurse = searchFitFromSignal({ top_titles: ['Phlebotomist', 'Patient Care Technician'], function: 'other', industry: null });
  assert.ok(nurse.families.length >= 1 && nurse.industry === 'healthcare', JSON.stringify(nurse));
  assert.equal(filterAndRank([jencap, walmart, sonora], q, { fit: nurse })[0].company, 'Sonora Quest Laboratories');
  // The industry can come from the function alone; nothing known → null (no boost anywhere).
  assert.equal(searchFitFromSignal({ top_titles: [], function: 'engineering' }).industry, 'tech');
  assert.equal(searchFitFromSignal({ top_titles: [], function: 'other' }), null);
  // The fit never makes an unrelated row relevant or lifts a non-match over a match.
  const unrelated = { title: 'Store Manager', company: 'Walmart', score: 90, description: 'Run the store.' };
  assert.equal(filterAndRank([unrelated, jencap], q, { fit }).length, 1);
  assert.ok(relevanceScore(walmart, q, { fit }) > relevanceScore(unrelated, q, { fit }));
});

// ── Oilfield and skilled trades (2026-11-13). Titles are real postings read for the research (Patterson-UTI,
// Halliburton, Nabors, H&P, Liberty, TETRA boards; Indeed postings in resume-hiring-side.md §4) or real production rows.
import { isTitleRelated as titleRelated } from './jobRelevance.js';
const T = (title, company = 'Co') => ({ title, company, description: '', score: 50 });

test('oilfield: a roustabout / oilfield search finds the field-hand titles employers use', () => {
  for (const title of ['Floorhand - Oklahoma', 'Casing Floorhand- OKC', 'Derrickhand - Permian Basin', 'Motorhand - ETX / STX',
    'Workover Rig Hand', 'NexTier Frac Equipment Operator WTX', 'Flowback Operator I', 'Lease Operator', 'ALASKA ROUSTABOUT',
    'US Odessa: Operator Assistant Trainee - Frac/Acid', 'Entry Level Oilfield Operator - Wireline Logging & Perforating',
    'Production Testing Operator', 'Pumping Operator NEX - WTX']) {
    assert.equal(titleRelated(T(title), 'roustabout'), true, `roustabout ↔ ${title}`);
    assert.equal(titleRelated(T(title), 'oilfield'), true, `oilfield ↔ ${title}`);
    assert.equal(isRelevant(T(title), 'oil and gas'), true, `oil and gas ↔ ${title}`);
  }
  assert.equal(titleRelated(T('Floor Hand'), 'floorhand'), true);
  assert.equal(titleRelated(T('Roughneck'), 'floorhand'), true);
  assert.equal(titleRelated(T('Floorhand (Experienced) - Permian Basin'), 'roughneck'), true);
  // beginner words around the trade word still reach the family
  assert.equal(titleRelated(T('Floorhand - Colorado, Utah'), 'entry level roustabout'), true);
  assert.equal(titleRelated(T('Floorhand - Colorado, Utah'), 'oilfield jobs no experience'), true);
  assert.ok(expandQueryTerms('rig').includes('roustabout'));
  assert.ok(expandQueryTerms('oil & gas').includes('floorhand'));
});

test('oilfield: haulers stay haulers; a CDL water hauler search does not call every rig job a match', () => {
  assert.equal(titleRelated(T('CDL-A Water Hauler'), 'cdl water hauler'), true);
  assert.equal(titleRelated(T('SAND HAULER'), 'cdl water hauler'), true);
  assert.equal(titleRelated(T('Crude Oil Hauler'), 'cdl water hauler'), true);
  assert.equal(titleRelated(T('Floorhand - Oklahoma'), 'cdl water hauler'), false);
  // a CDL truck driver row is still relevant (the "cdl" word) but under "Other openings"
  assert.equal(isRelevant(T('CDL A Truck Driver'), 'cdl water hauler'), true);
  assert.equal(titleRelated(T('CDL A Truck Driver'), 'cdl water hauler'), false);
});

test('trades: helper ≈ apprentice ≈ trainee inside a trade title, and the trade nouns read their stand-ins', () => {
  assert.equal(titleRelated(T('Electrician Helper'), 'apprentice electrician'), true);
  assert.equal(titleRelated(T('Electrical Apprentice'), 'apprentice electrician'), true);
  assert.equal(titleRelated(T('Electrical Trainee'), 'electrician helper'), true);
  assert.equal(titleRelated(T('Plumbing Installer  Apprentice'), 'plumber apprentice'), true);
  assert.equal(titleRelated(T("Plumbers Apprentice"), 'plumber apprentice'), true);
  assert.equal(titleRelated(T('HVAC Technician Apprentice'), 'hvac helper'), true);
  assert.equal(titleRelated(T('HVAC Install Helper'), 'hvac apprentice'), true);
  assert.equal(titleRelated(T('Welder Helper'), 'welding apprentice'), true);
  assert.equal(titleRelated(T('Apprentice Lineman/Groundman'), 'lineworker'), true);
  assert.equal(titleRelated(T('Journeyman Lineworker'), 'lineman'), true);
  assert.equal(titleRelated(T('Materials Groundman'), 'apprentice lineman'), true);
  assert.equal(titleRelated(T('Diesel Technician Apprentice-Paid Training'), 'diesel mechanic apprentice'), true);
  assert.equal(titleRelated(T('Fire Sprinkler Fitter Trainee'), 'pipefitter'), true);
  // the beginner rung ranks above the journeyman for an apprentice search
  const q = 'apprentice electrician';
  assert.ok(relevanceScore(T('Electrician Helper'), q) > relevanceScore(T('Journeyman Electrician'), q));
  assert.deepEqual(filterAndRank([T('Journeyman Electrician'), T('Electrician Helper'), T('Apprentice Piercer')], q).map((j) => j.title),
    ['Electrician Helper', 'Journeyman Electrician', 'Apprentice Piercer']);
});

test('trades: "apprentice" / "helper" / "trainee" alone never widen into a trade; non-craft titles are not family matches', () => {
  for (const q of ['apprentice', 'helper', 'trainee', 'apprentice piercer', 'public relations apprentice', 'no experience']) {
    assert.deepEqual(expandQueryTerms(q), [], q);
  }
  // a trade search never calls these a match through its family
  for (const [title, q] of [['Apprentice Piercer', 'electrician apprentice'], ['Winter 2027 Public Relations Apprentice - US Locations', 'apprenticeship'],
    ['Field Service Technician (San Francisco)', 'oilfield'], ['Robotics Field Service Technician', 'roustabout'],
    ['Production Operator - 2nd Shift', 'oilfield'], ['Equipment Operator | 1pm - 9:30pm', 'heavy equipment operator'],
    ['Electrical Apprenticeship Instructor', 'apprentice electrician'], ['Journeyman Lineworker Instructor', 'apprentice lineman'],
    ['Rig Manager - Permian Basin', 'roustabout'], ['Welding Engineer (Starship)', 'welder helper'], ['Driver Helper', 'electrician helper']]) {
    assert.equal(titleRelated(T(title), q), false, `${q} ↛ ${title}`);
  }
  assert.equal(isRelevant(T('Apprentice Piercer'), 'electrician helper'), false);
  assert.equal(isRelevant(T('Electrical Apprenticeship Instructor'), 'apprentice electrician'), false);
  // the query's own words still match as before: an "apprentice" search lists every apprentice title
  assert.equal(titleRelated(T('Apprentice Piercer'), 'apprentice'), true);
  assert.equal(titleRelated(T('Journeyman Lineman Instructor'), 'lineman'), true);
});

test('trades: "apprenticeship" / "trades" reach the beginner rungs of every trade', () => {
  for (const q of ['apprenticeship', 'trades', 'skilled trades', 'union apprenticeship', 'trade jobs']) {
    for (const title of ['Electrical Apprentice', 'Plumbers Apprentice', 'HVAC Technician Apprentice', 'Welder Helper', 'Apprentice Lineman', 'Diesel Technician Apprentice-Paid Training']) {
      assert.equal(titleRelated(T(title), q), true, `${q} ↔ ${title}`);
    }
  }
  assert.equal(titleRelated(T('Journeyman Electrician'), 'apprenticeship'), false);
});

test('trades: a beginner-rung search keeps higher rungs and look-alike titles under "Other openings"', () => {
  // production rows: still relevant by the trade word, never a family match for an apprentice / helper search
  for (const [title, q] of [['Master Electrician', 'apprentice electrician'], ['Journeyman Electrician', 'electrician helper'],
    ['TIG Welder (Starship) - Level 4/5', 'welder helper'], ['Diesel Mechanic Lead', 'diesel mechanic apprentice'], ['Master HVAC Technician', 'hvac helper']]) {
    assert.equal(isRelevant(T(title), q), true, `${q} keeps ${title} in the pool`);
    assert.equal(titleRelated(T(title), q), false, `${q} ↛ ${title}`);
  }
  // a plain trade search still matches every rung
  assert.equal(titleRelated(T('Master Electrician'), 'electrician'), true);
  // "electrician" ↔ "electrical" is not a stand-in: these production rows are not electrician matches
  for (const title of ['Electrical Integration Intern - Avionics (Winter 2027)', 'Electrical Test Technician', 'Vehicle Electrical Integration Technician']) {
    assert.equal(titleRelated(T(title), 'electrician'), false, title);
  }
});

test('trades: families stay apart — an electrician search is not a plumbing match, operators are not mechanics', () => {
  assert.equal(titleRelated(T('Plumbing Apprentice'), 'apprentice electrician'), false);
  assert.equal(titleRelated(T('Heavy Equipment Shop Technician (Mechanic)'), 'heavy equipment operator'), false);
  assert.equal(titleRelated(T('Excavator Operator'), 'heavy equipment operator'), true);
  assert.equal(titleRelated(T('Excavator Operator'), 'equipment operator'), true);
  assert.equal(titleRelated(T('Heavy Equipment Shop Technician (Mechanic)'), 'diesel mechanic'), true);
  assert.equal(titleRelated(T('NexTier Frac Equipment Operator WTX'), 'heavy equipment operator'), false);
});

test('existing families are untouched by the trade tables (spot checks; the full proof is the equivalence harness)', () => {
  assert.deepEqual(expandQueryTerms('forklift operator').slice(0, 3), ['warehouse', 'material handler', 'package handler']);
  assert.deepEqual(expandQueryTerms('truck driver').slice(0, 2), ['delivery driver', 'courier']);
  assert.deepEqual(expandQueryTerms('production operator'), []);
  assert.deepEqual(expandQueryTerms('field service technician'), []);
  assert.equal(titleRelated(T('Electrician Helper'), 'cashier'), false);
});

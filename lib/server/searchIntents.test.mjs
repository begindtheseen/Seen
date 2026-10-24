// Intent classifier + company matcher on realistic job-seeker queries. Run: node --test lib/server/searchIntents.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyIntent, buildCompanyIndex, matchCompany, companyFromPageUrl, tokens, INTENTS } from './searchIntents.js';

const CASES = [
  // application_status
  ['walmart application status', 'application_status'],
  ['lowes application status', 'application_status'],
  ['track my target application', 'application_status'],
  ['starbucks application under review', 'application_status'],
  ['check application status walmart', 'application_status'],
  ['dollar general application pending', 'application_status'],
  ['amazon candidate portal', 'application_status'],
  ['amazon job application in review', 'application_status'],
  // hiring_process
  ['amazon hiring process', 'hiring_process'],
  ['amazon’s hiring process', 'hiring_process'],
  ['does target drug test', 'hiring_process'],
  ['how long does amazon background check take', 'hiring_process'],
  ['how to get hired at costco', 'hiring_process'],
  ['costco hiring timeline', 'hiring_process'],
  ['walmart onboarding', 'hiring_process'],
  // interview_process
  ['amazon interview process reddit', 'interview_process'],
  ['chipotle interview questions', 'interview_process'],
  ['kohls online assessment', 'interview_process'],
  ['fedex virtual job tryout', 'interview_process'],
  ['home depot phone screen', 'interview_process'],
  ['verizon second round interview', 'interview_process'],
  // how_long_to_hear_back
  ['how long does target take to call back', 'how_long_to_hear_back'],
  ['how soon does chipotle respond', 'how_long_to_hear_back'],
  ['how many days does it take amazon to hire', 'how_long_to_hear_back'],
  ['when will walmart get back to me', 'how_long_to_hear_back'],
  ['target response time after applying', 'how_long_to_hear_back'],
  // is_legit
  ['is robert half legit', 'is_legit'],
  ['insight global reviews', 'is_legit'],
  ['insight global reviews reddit', 'is_legit'],
  ['robert half scam', 'is_legit'],
  ['is insight global a real company', 'is_legit'],
  ['randstad complaints', 'is_legit'],
  ['teksystems glassdoor', 'is_legit'],
  ['is aerotek trustworthy', 'is_legit'],
  // does_ghost
  ['does amazon ghost', 'does_ghost'],
  ['never heard back from amazon after interview', 'does_ghost'],
  ['did not hear back from walmart', 'does_ghost'],
  ['target no response after interview', 'does_ghost'],
  ['spacex ghosting applicants', 'does_ghost'],
  ['ghosted by robert half recruiter', 'does_ghost'],
  // jobs_at
  ['jobs at home depot near me', 'jobs_at'],
  ['target careers', 'jobs_at'],
  ['is amazon hiring', 'jobs_at'],
  ['mcdonalds jobs', 'jobs_at'],
  ['apple remote jobs', 'jobs_at'],
  ['ups seasonal jobs', 'jobs_at'],
  ['target application', 'jobs_at'],
  // other
  ['amazon ghost jobs', 'other'],
  ['seen jobs', 'other'],
  ['seenjobs.io', 'other'],
  ['walmart hr phone number', 'other'],
  ['how much does walmart pay', 'other'],
  ['', 'other'],
];

test(`classifier: ${CASES.length} realistic queries`, () => {
  assert.ok(CASES.length >= 40);
  const wrong = CASES.map(([q, want]) => [q, want, classifyIntent(q)]).filter(([, want, got]) => want !== got);
  assert.deepEqual(wrong, []);
  for (const [, want] of CASES) assert.ok(INTENTS.includes(want));
});

test('company matcher: whole words, longest name, possessives, "the", legal suffixes, never a generic word', () => {
  const idx = buildCompanyIndex(['walmart', 'robert half', 'insight global', 'amazon', 'target', 'target optical', 'the home depot', "lowe's", "mcdonald's", "kohl's", 'jobs', 'acme inc',
    { company_name: 'home depot', first_party_report_count: 3 }]);
  const m = (q) => matchCompany(q, idx)?.company_name ?? null;
  assert.equal(m('jobs at home depot near me'), 'home depot', 'two names that read the same: the one with more evidence');
  assert.equal(m('lowes application status'), "lowe's");
  assert.equal(m("lowe's hiring"), "lowe's");
  assert.equal(m('amazon’s hiring process'), 'amazon');
  assert.equal(m('target optical careers'), 'target optical', 'longest name wins');
  assert.equal(m('target careers'), 'target');
  assert.equal(m('mcdonalds jobs'), "mcdonald's");
  assert.equal(m('acme interview'), 'acme inc');
  assert.equal(m('steve jobs'), null, 'a company called "jobs" never matches');
  assert.equal(m('targeted resume tips'), null, 'whole words only');
  assert.equal(matchCompany('anything', buildCompanyIndex([])), null);
});

test('company page URL → name (hyphens are spaces, encoded punctuation decoded)', () => {
  assert.equal(companyFromPageUrl('https://seenjobs.io/company/coca-cola'), 'coca cola');
  assert.equal(companyFromPageUrl('https://seenjobs.io/company/h%26m'), 'h&m');
  assert.equal(companyFromPageUrl('https://seenjobs.io/jobs/123'), null);
  assert.equal(companyFromPageUrl('nope'), null);
  assert.deepEqual(tokens("AT&T's  Careers"), ['at', 'and', 'ts', 'careers']);
});

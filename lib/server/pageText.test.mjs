// The posting on any job page (pageText.js) and the vendor readers added with it — on saved copies of real
// pages from the 2026-11-08 resolver bench.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mainPostingText, headingCount, CLOSED_PAGE_RE } from './pageText.js';
import { extractListingFromHtml, atsApiPlan, mapAtsJson, alternateFetchPlans } from './listingImport.js';
import { cleanDescription } from './jobSources.js';
import { runOptimizer } from '../optimizer/index.js';

const fx = (f) => fs.readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8');

test('Taleo: the posting hidden as URL-encoded HTML in api.fillList is read in full', () => {
  const f = extractListingFromHtml(fx('taleo-jobdetail.html'), 'https://aa270.taleo.net/careersection/ex/jobdetail.ftl?job=827327');
  assert.equal(f.via, 'page-embedded');
  assert.ok(f.description.length > 4000, `got ${f.description.length}`);
  assert.match(f.description, /Texas Workforce Commission/);
  const out = runOptimizer({ resumeText: 'x', jobTitle: f.title, jobDescription: f.description });
  assert.ok(out.requirement_count >= 8, `read ${out.requirement_count} requirements`);
});

test('Oracle Recruiting Cloud: the page URL maps to the public requisition JSON, which holds the whole posting', () => {
  const plan = atsApiPlan('https://ebwh.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/92418');
  assert.equal(plan.kind, 'oracle');
  assert.match(plan.apiUrl, /\/hcmRestApi\/resources\/latest\/recruitingCEJobRequisitionDetails\?expand=all&onlyData=true&finder=ById;Id=%2292418%22,siteNumber=CX_1001$/);
  const f = mapAtsJson(plan, JSON.parse(fx('oracle-requisition.json')));
  assert.match(f.title, /Executive Development Program/);
  assert.ok(cleanDescription(f.description).length > 3000);
  // a closed requisition answers 200 with no items: nothing mapped (the resolver records it as gone)
  assert.equal(mapAtsJson(plan, { items: [] }), null);
});

test('Workable: the page URL maps to the v2 job JSON; description, requirements and benefits are kept', () => {
  const plan = atsApiPlan('https://apply.workable.com/life-is-good/j/361F0FAA94/');
  assert.equal(plan.apiUrl, 'https://apply.workable.com/api/v2/accounts/life-is-good/jobs/361F0FAA94');
  const f = mapAtsJson(plan, { title: 'Accounts Payable Specialist', description: '<p>Process invoices.</p>', requirements: '<ul><li>2+ years of AP experience</li></ul>', benefits: '<p>401(k)</p>', location: { city: 'Boston', region: 'MA', country: 'United States' } });
  assert.match(cleanDescription(f.description), /Requirements\n+• 2\+ years of AP experience/);
  assert.equal(f.location, 'Boston, MA, United States');
});

test('iCIMS: the in_iframe page is tried when the frame host does not give the posting', () => {
  const plans = alternateFetchPlans('https://careers-futurecarehealth.icims.com/jobs/25190/registered-nurse-rn---ft-days/job');
  assert.equal(plans[0].label, 'icims-iframe');
  assert.match(plans[0].url, /\/job\?in_iframe=1$/);
});

test('a description container or the page body is read only when it shows a posting\'s sections', () => {
  const posting = `<html><body><nav><a>Jobs</a><a>Teams</a></nav><div class="job-description"><h2>About the role</h2><p>${'We run the line and keep it safe. '.repeat(8)}</p><h3>Responsibilities</h3><ul><li>Operate the CNC lathe and mill</li><li>Read blueprints and GD&amp;T callouts</li></ul><h3>Qualifications</h3><ul><li>2+ years of machining experience</li><li>Forklift certification preferred</li></ul></div><footer>© Acme</footer></body></html>`;
  const got = mainPostingText(posting);
  assert.equal(got.via, 'container');
  assert.match(got.text, /Responsibilities[\s\S]*Operate the CNC lathe/);
  assert.ok(!/Teams|© Acme/.test(got.text));
  // a sign-in page or a jobs list has job words but no posting sections — never "the posting"
  const login = `<html><body><h1>Careers</h1><p>${'Sign in to view your applications and saved jobs. Experience matters to us. '.repeat(6)}</p><p>412 jobs found · Sorted by newest</p></body></html>`;
  assert.equal(mainPostingText(login).text, '');
  assert.equal(headingCount('Responsibilities\nQualifications:\nWe value experience.'), 2);
});

test('closed-job pages are recognised', () => {
  for (const t of ['This job is no longer available', 'Job Not Found', 'This position has been filled', 'The job you are trying to view is no longer available']) assert.ok(CLOSED_PAGE_RE.test(t), t);
  assert.ok(!CLOSED_PAGE_RE.test('We are hiring for an open position in Phoenix.'));
});

// The Strategy tab's 30/60/90 plan + LinkedIn template ("Build my advantage", 1 credit) must
// follow the TARGET job's field and never interpolate a broken parse.
// Real case (willingness-to-pay test, 2026-10-25): a CRM Marketing Coordinator posting from a
// health system got a nursing plan ("charge nurses, physicians… EHR/charting system… patient
// throughput, chart accuracy"), and the LinkedIn message opened "As a (1,800 subscribers)., I'd
// bring…". Run: node --test lib/server/advantagePlan.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAdvantage, classifyRoleFamily, plausibleJobTitle, detectIndustry } from './resumeAnalysis.js';

const CRM_JD = `About the role: Our health system is hiring a CRM Marketing Coordinator to run patient email and SMS campaigns. You will build segments in Salesforce Marketing Cloud, write campaign copy, and report on open and click rates. Requirements: 2+ years of email marketing or CRM experience; Salesforce Marketing Cloud or similar; strong writing. We are a hospital network of 12 clinics serving 400,000 patients and their care teams. Experience in healthcare marketing or clinical communications a plus.`;
const CREATOR_RESUME = `Taylor Reed
taylor@example.com

EXPERIENCE
(1,800 subscribers). | Reed Reviews | Jan 2021 - Present
• Grew a product-review channel to 1,800 subscribers with weekly videos
• Wrote and scheduled email campaigns for sponsors

Marketing Assistant | Bright Agency | Jun 2019 - Dec 2020
• Built email campaigns in HubSpot that lifted open rates 18%
`;
const CLINICAL_WORDS = /charge nurse|physician|\behr\b|charting|patient throughput|chart accuracy|care team on your unit|shadow a full shift/i;
const planText = (a) => [a.opening_note, a.day_30, a.day_60, a.day_90].join('\n');

test('a CRM marketing coordinator at a hospital gets a MARKETING plan, never the nursing template', () => {
  assert.equal(classifyRoleFamily({ job: 'CRM Marketing Coordinator', jobDescription: CRM_JD, ranked: [] }), 'marketing');
  const a = runAdvantage({ job: 'CRM Marketing Coordinator', company: 'Sharp Health', resume: CREATOR_RESUME, jobDescription: CRM_JD });
  const plan = planText(a);
  assert.doesNotMatch(plan, CLINICAL_WORDS, plan);
  assert.match(a.day_30, /campaign|brand|content/i);
  // the employer's industry is named as context to learn — nothing invented about it
  assert.match(a.day_30, /Learn the healthcare context the work sits in at Sharp Health/);
});

test('posting words alone never pull a job into another field (patient/clinical text, title names the field)', () => {
  for (const [job, fam] of [['Social Media Coordinator', 'marketing'], ['Backend Engineer, Core Technology', 'software_engineering'], ['Staff Accountant', 'finance_accounting'], ['Barista', 'food_service']]) {
    assert.equal(classifyRoleFamily({ job, jobDescription: CRM_JD, ranked: [] }), fam, job);
  }
  // a real clinical title still gets the clinical plan
  assert.equal(classifyRoleFamily({ job: 'Registered Nurse - Med/Surg', jobDescription: CRM_JD, ranked: [] }), 'clinical');
  const rn = runAdvantage({ job: 'Registered Nurse', company: 'Sharp Health', resume: '', jobDescription: CRM_JD });
  assert.match(rn.day_30, /EHR|charting/);
  assert.doesNotMatch(rn.day_30, /Learn the healthcare context/, 'a clinical plan already speaks to healthcare');
});

test('an unknown family gets a generic plan that names the job and company and invents nothing', () => {
  const jd = 'We are looking for an Associate II to join Northwind. You will work with the team on daily priorities and help us grow. Strong communication required. Must be organized and reliable.';
  assert.equal(classifyRoleFamily({ job: 'Associate II', jobDescription: jd, ranked: [] }), 'general');
  const a = runAdvantage({ job: 'Associate II', company: 'Northwind', resume: '', jobDescription: jd });
  const plan = planText(a);
  assert.match(a.day_30, /Associate II role at Northwind/);
  assert.match(a.day_60, /Ask your manager which number matters most for the Associate II role at Northwind/);
  // no field-specific nouns from any template
  assert.doesNotMatch(plan, /\b(?:POS|EHR|codebase|pull request|scanner|WMS|campaigns?|CRM|patients?|guests?|register|pipeline)\b/i, plan);
  assert.match(a.opening_note, /think like an Associate II at Northwind/);
});

test('a broken parsed title is never interpolated into the LinkedIn template or the plan', () => {
  const a = runAdvantage({ job: 'CRM Marketing Coordinator', company: 'Sharp Health', resume: CREATOR_RESUME, jobDescription: CRM_JD });
  const all = Object.values(a).join('\n');
  assert.doesNotMatch(all, /subscribers\)\./);
  assert.doesNotMatch(all, /As an? \(/);
  assert.doesNotMatch(all, /experience as an? \(/);
  // the next real role is used instead
  assert.match(a.hiring_manager_script, /As a Marketing Assistant at Bright Agency, I'd bring/);
});

test('plausibleJobTitle: accepts job titles, rejects what a mis-parse produces', () => {
  for (const ok of ['Marketing Assistant', 'Membership Specialist – UFC Gym', 'Barback', 'Sr. Software Engineer', 'Valet Attendant', 'Founder']) assert.equal(plausibleJobTitle(ok), true, ok);
  for (const bad of ['(1,800 subscribers).', '1,800 subscribers', 'Jan 2020 - Present', 'Grew the channel to 2,000 followers. Ran sponsors.', 'https://youtube.com/@reed', '• Built email campaigns', '', 'Managed a team of 12 associates across three locations and two warehouses daily']) assert.equal(plausibleJobTitle(bad), false, bad);
});

test('detectIndustry needs two different signal words', () => {
  assert.equal(detectIndustry(CRM_JD), 'healthcare');
  assert.equal(detectIndustry('Be patient with customers.'), null);
});

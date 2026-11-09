// The posting's own requirement terms (postingTerms.js), pinned on sentences from real postings read in the
// 2026-11-08 corpus run — each was refused as "no requirements" before, because the fixed vocabulary
// knew none of its words.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractPostingTerms, matchTerm, cleanTerm, termFromLabel } from './postingTerms.js';
import { requirementSentences } from './postingSections.js';
import { runOptimizer } from './index.js';

const labels = (text, opts = {}) => extractPostingTerms(requirementSentences(text), opts).map((t) => t.label);

const RN = `Make an Impact as a Registered Nurse at BAYADA Home Health Care

How You'll Make an Impact:
• Use strong head-to-toe assessment skills with the ability to identify subtle changes in patient condition
• Utilize your experience with acute and post-acute care (e.g., CHF, COPD, wound care, IV therapy, post-surgical care)
• Ability to work independently while knowing when to escalate concerns
• Strong problem-solving skills in unpredictable home environments

Requirements:
• Active RN license in the state of practice
• Paid Parental and Adoptive Leave`;

const SYSTEMS = `Key Responsibilities:
• Develop Failure Modes & Effects Analysis (FMEA) and other system documentation.
• Develop Model-Based Systems Engineering (MBSE) models of SRM systems.

Basic Qualifications:
• B.S. in Aerospace, Systems or Mechanical Engineering.
• Demonstrated organization skills.
• Ability to earn trust and maintain positive and professional relationships.

Desired Experience
• Familiarity with requirements management tools such as DOORS or Jama.
• Experience with MBSE and Cameo.
• Classification: Full-time Exempt
• Employer Paid Short and Long Term Disability, Basic Life, AD&D`;

test('a nursing posting reads its clinical requirements; licences, benefits and soft words are not terms', () => {
  const got = labels(RN, { title: 'Registered Nurse - Home Health', company: 'BAYADA Home Health Care' });
  for (const want of ['head-to-toe assessment', 'wound care', 'IV therapy', 'CHF', 'COPD', 'acute care', 'post-acute care']) assert.ok(got.includes(want), `${want} missing: ${got}`);
  assert.ok(!got.some((l) => /license|leave|ability|problem|BAYADA|RN\b/i.test(l)), got.join(' · '));
});

test('an engineering posting reads acronyms with their long form, tools, and a choice of tools as alternatives', () => {
  const terms = extractPostingTerms(requirementSentences(SYSTEMS), { title: 'Systems Engineer', company: 'Ursa Major' });
  const got = terms.map((t) => t.label);
  assert.ok(got.includes('Model-Based Systems Engineering (MBSE)'), got.join(' · '));
  assert.ok(got.includes('Failure Modes & Effects Analysis (FMEA)'), got.join(' · '));
  assert.ok(got.includes('Cameo'), got.join(' · '));
  const doors = terms.find((t) => t.label === 'DOORS'), jama = terms.find((t) => t.label === 'Jama');
  assert.ok(doors && jama && doors.anyOf && doors.anyOf === jama.anyOf, 'DOORS or Jama is one choice');
  assert.equal(doors.importance, 'preferred');
  // the degree field, benefits, and soft skills are never terms
  assert.ok(!got.some((l) => /Aerospace|organization|trust|Disability|Exempt|AD&D/.test(l)), got.join(' · '));
  // MBSE is listed once, not again as a bare acronym
  assert.equal(got.filter((l) => /MBSE/.test(l)).length, 1, got.join(' · '));
});

test('fragments are never terms: negations, adverbs, run-ons, verbs, generic words', () => {
  for (const bad of ['No previous wound care', 'Consistently foster a positive store', 'account funnel work Production dbt', 'ability', 'the team', 'work independently', 'initiatives', 'combining', 'R Designs the comparisons', '1-3', 'this---from testing'])
    assert.equal(cleanTerm(bad), '', bad);
  for (const [raw, want] of [['strong head-to-toe assessment', 'head-to-toe assessment'], ['setup of research framework', 'research framework'], ['C++', 'C++'], ['Cameo', 'Cameo']])
    assert.equal(cleanTerm(raw), want, raw);
});

test('the job title, the employer and the shift are not requirements', () => {
  const text = `Requirements:\n• Previous CSR experience at PLS or a similar store.\n• Able to work flexible hours, including early morning, evenings, weekends, and holidays.\n• Knowledge of check cashing regulations.`;
  const got = labels(text, { title: 'Customer Service Representative', company: 'plscareers' });
  assert.ok(got.includes('check cashing regulations'), got.join(' · '));
  assert.ok(!got.some((l) => /^(?:CSR|PLS)$|morning|evening|weekend/i.test(l)), got.join(' · '));
});

test('a choice one of whose options the vocabulary knows adds no new requirement', () => {
  const text = `Requirements:\n• Previous customer service experience in industries such as hospitality, financial services, retail or restaurant is preferred.`;
  const got = extractPostingTerms(requirementSentences(text), { taken: [['hospitality'], ['retail']] }).map((t) => t.label);
  assert.deepEqual(got, []);
});

test('matching: the same words on one résumé line, the acronym as a word, or the long form', () => {
  const resume = 'Home Health RN — BAYADA, 2021–present\n• Performed head-to-toe assessments and wound care for 12 patients a day\n• Built MBSE models in Cameo for the SRM program\nEducation: B.S. Nursing';
  assert.equal(matchTerm({ label: 'head-to-toe assessment', stems: ['head-to-toe', 'assessment'] }, resume).matched, true);
  assert.equal(matchTerm({ label: 'IV therapy', stems: ['iv', 'therapy'] }, resume).matched, false);
  assert.equal(matchTerm(termFromLabel('Model-Based Systems Engineering (MBSE)'), resume).matched, true);
  // the acronym must be a whole word ("SRMS" is not SRM, "Cameo" is not "CAM")
  assert.equal(matchTerm(termFromLabel('CAM'), resume).matched, false);
});

test('end to end: a home-health RN posting outside the vocabulary is now scored, and shows what the résumé proves', () => {
  const resume = 'Jordan Lee\nRegistered Nurse\nExperience\nHome Health RN, Amedisys — 2020–present\n• Performed head-to-toe assessments on 10–12 home visits a day\n• Wound care and IV therapy for post-surgical and CHF patients\n• Medication reconciliation and patient teaching\nEducation\nB.S. Nursing, ASU\nLicenses: Active RN license (AZ), BLS';
  const out = runOptimizer({ resumeText: resume, jobTitle: 'Registered Nurse - Home Health', company: 'BAYADA Home Health Care', jobDescription: RN });
  assert.notEqual(out.fit_score, null, 'scored, not withheld');
  const shown = out.matched_requirements.map((m) => m.surface);
  for (const want of ['head-to-toe assessment', 'wound care', 'IV therapy']) assert.ok(shown.includes(want), `${want} not matched: ${shown}`);
  // COPD is not on the résumé, but CHF is — the choice is met, so COPD is not reported as missing
  assert.ok(!out.unsupported_requirements.some((m) => /COPD/.test(m.surface)), out.unsupported_requirements.map((m) => m.surface).join(' · '));
});

test('a duty-only posting is read through its duties — and only when it states almost nothing else', () => {
  const duty = `Express Service Technician\n\nResponsibilities:\n• Perform routine maintenance, including oil changes, tire rotations and filter replacements.\n• Utilize diagnostic tools and equipment to diagnose mechanical and electrical malfunctions.\n• Perform maintenance and repairs with efficiency and in accordance with dealership standards.\n\nRequirements:\n• Valid driver's license and clean driving record\n• Previous experience as an automotive technician preferred`;
  const out = runOptimizer({ resumeText: 'Lube Technician, Jiffy Lube 2022–2025\n• Performed oil changes and tire rotations on 30 cars a day', jobTitle: 'Express Service Technician', company: 'Fletcher Jones', jobDescription: duty });
  assert.notEqual(out.fit_score, null, 'scored, not refused');
  const all = [...out.matched_requirements, ...out.unsupported_requirements].map((m) => m.surface);
  for (const want of ['oil changes', 'tire rotations', 'diagnostic tools']) assert.ok(all.includes(want), `${want}: ${all}`);
  assert.ok(!all.some((l) => /efficiency|accordance/.test(l)), all.join(' · '));
  assert.ok(out.matched_requirements.some((m) => m.surface === 'oil changes'));
  // a posting that already states its requirements gets no duty terms
  const full = runOptimizer({ resumeText: 'x', jobTitle: 'Systems Engineer', company: 'Ursa Major', jobDescription: SYSTEMS });
  assert.ok(![...full.matched_requirements, ...full.unsupported_requirements].some((m) => /documentation|models of SRM/.test(m.surface)));
});

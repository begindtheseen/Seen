// "Before you apply": the pay-to-train caution, the repayment fact, the beginner checks and the term glossary — each
// pinned by the sentence that would otherwise read wrong. Sentences marked (prod) are from production postings read
// 2026-11-14; the rest are written in the shape real postings use.
import test from 'node:test';
import assert from 'node:assert/strict';
import { payToTrain, trainingRepayment } from './payToTrain.js';
import { termsIn, GLOSSARY, glossaryEntry } from './termGlossary.js';
import { beforeYouApply, beginnerChecks, isBeginnerListing } from './beforeYouApply.js';

// ── pay to train ────────────────────────────────────────────────────────────────────────────────────────────────
test('payToTrain: an ask for the applicant to pay fires', () => {
  for (const s of [
    'A $150 refundable training fee is due at orientation.',
    'New agents must purchase a starter kit ($99) before their first appointment.',
    'You will need to pay for your own training and state licensing exam.',
    'Applicants are required to pay for the background check and drug screen.',
    'There is a one-time certification fee of $249 payable before class starts.',
    'A $75 processing fee secures your seat in the next hiring class.',
    'Students pay for the CDL course up front; tuition of $3,995 is due at enrollment.',
    'Training costs $499 and is completed online at your own pace.',
    'A small equipment deposit is required on your first day.',
    'Uniforms are purchased at the applicant\'s own expense.',
  ]) assert.ok(payToTrain(s), s);
});

test('payToTrain: the employer paying, a perk, or a scam warning never fires', () => {
  for (const s of [
    'Company-paid CDL training — we pay for your CDL.',
    'Paid training and certifications, tuition reimbursement.',
    'All training is provided at no cost to you.',
    'There is no application fee and no cost to attend our hiring event.',
    'Free uniforms and safety gear provided.',
    'We cover the cost of your SafeLand and H2S certifications.',
    'Weekly pay with direct deposit.',
    'We will never ask you to pay a fee or buy equipment to get a job with us.',
    'Certification fees are reimbursed after 90 days.',
    'Any training fees are waived for new hires.',
    // (prod) recruiting-agency boilerplate and an employer paying the fees
    'Resumes submitted without prior approval from our Talent Acquisition team will not be eligible for placement fees.',
    'Nova supports Associate Account Managers obtaining industry credentials by paying for study time, exams, and professional membership fees.',
    'Any unsolicited submission - via email, our website, social media, or directly to an employee - will be deemed the property of Relativity Space, and no fee will be owed absent a current, fully executed agreement.',
    // (prod) perks that only mention money
    'NICET certification test reimbursement',
    'Student loan repayment program and tuition assistance.',
    'Up to $100/month reimbursement for gym memberships',
  ]) assert.equal(payToTrain(s), null, s);
});

test('payToTrain: a repayment clause is not the caution', () => {
  const s = 'If you leave before 12 months, you agree to repay the cost of CDL training on a prorated basis.';
  assert.equal(payToTrain(s), null);
  assert.deepEqual(trainingRepayment(s), { months: 12, sentence: s });
});

// ── training repayment ──────────────────────────────────────────────────────────────────────────────────────────
test('trainingRepayment: the span the posting states, in months', () => {
  assert.equal(trainingRepayment('Graduates who resign within one year must pay back the tuition, prorated monthly.').months, 12);
  assert.equal(trainingRepayment('Our CDL school is free if you stay with us for 2 years; otherwise the training cost is repaid when you leave.').months, 24);
  assert.equal(trainingRepayment('Drivers who leave before completing six (6) months of service will reimburse the company for training costs.').months, 6);
  // stated without a span → a fact without a number
  const r = trainingRepayment('A training repayment agreement applies if you quit early.');
  assert.ok(r); assert.equal(r.months, null);
});

test('trainingRepayment: a loan program, a sign-on bonus clawback or a perk is not training repaid', () => {
  for (const s of [
    'Student loan repayment program',
    'Sign-on bonus must be repaid if you leave within 6 months.',
    'Tuition reimbursement for associates',
    'Mileage reimbursement',
  ]) assert.equal(trainingRepayment(s), null, s);
});

// ── glossary ────────────────────────────────────────────────────────────────────────────────────────────────────
test('termsIn: every term the brief names is in the glossary, found by the words postings use', () => {
  const cases = {
    safeland: 'SafeLand USA certification preferred', h2s: 'Must obtain H2S training within 30 days',
    osha10: 'OSHA-10 card a plus', osha30: 'OSHA 30 required for leads', twic: 'TWIC card required for port access',
    cdl_a: 'Valid Class A CDL', cdl_b: 'CDL-B with clean MVR', endorsements: 'Tanker and HazMat endorsements required',
    dot_medical: 'Current DOT medical card', epa608: 'EPA 608 Universal certification', forklift: 'Forklift certification preferred',
    cna: 'Active CNA license in good standing', nremt: 'NREMT certification required', ptcb: 'PTCB certified (CPhT)',
    comptia_a: 'CompTIA A+ preferred',
  };
  for (const [key, text] of Object.entries(cases)) {
    assert.ok(termsIn(text).some((t) => t.key === key), `${key}: ${text}`);
    assert.ok(glossaryEntry(key), key);
  }
  assert.equal(GLOSSARY.length, Object.keys(cases).length);
});

test('termsIn: no term from a word that only looks like one', () => {
  assert.deepEqual(termsIn('Must have a CDL and a clean driving record.').map((t) => t.key), []); // no class named
  assert.deepEqual(termsIn('Celebrity endorsement deals and brand partnerships').map((t) => t.key), []);
  assert.deepEqual(termsIn('Operate a forklift and pallet jack safely.').map((t) => t.key), []); // equipment, not a card
  assert.deepEqual(termsIn('Join our PEC team in Houston').map((t) => t.key), []);
});

test('glossary: an OSHA 10 / 30 is a card, never a certification; no entry promises a price or a pass rate', () => {
  for (const k of ['osha10', 'osha30']) assert.match(glossaryEntry(k).def, /not a certification/);
  for (const g of GLOSSARY) {
    assert.ok(g.def.length <= 260, `${g.key} is short`);
    assert.doesNotMatch(g.def, /\$\s?\d|\bpercent\b|%/, `${g.key} states no price or rate`);
  }
});

// ── beginner checks ─────────────────────────────────────────────────────────────────────────────────────────────
const FLOORHAND = `This is an entry-level job that provides initial introductory training and substantial on-the-job training.
Requirements:
- Must be at least 18 years of age
- Valid driver's license and reliable transportation
- Must pass a pre-employment drug screen and background check
- Able to lift 50 lbs repeatedly
- Work a 14 days on / 7 days off rotation, 12-hour shifts
- SafeLand and H2S certifications will be provided after hire
- OSHA 10 preferred`;

test('beginnerChecks: each line the posting states, phrased plainly, with after-hire / preferred kept apart', () => {
  const checks = beginnerChecks('Floorhand', FLOORHAND);
  const byKey = Object.fromEntries(checks.map((c) => [c.key, c]));
  assert.equal(byKey.age.text, 'Be at least 18 years old');
  assert.equal(byKey.driver.text, "A valid driver's license");
  assert.equal(byKey.drug.text, 'Pass a drug test');
  assert.equal(byKey.background.text, 'Pass a background check');
  assert.match(byKey.physical.text, /lift 50 lbs/);
  assert.match(byKey.schedule.text, /^Schedule: a 14 days on \/ 7 days off rotation/);
  assert.equal(byKey['ticket:safeland'].status, 'after_hire');
  assert.equal(byKey['ticket:h2s'].status, 'after_hire');
  assert.equal(byKey['ticket:osha10'].status, 'preferred');
  for (const c of checks) assert.ok(FLOORHAND.includes(c.sentence.replace(/^- /, '').slice(0, 30)), `${c.key} carries its sentence`);
});

test('beginnerChecks: nothing the posting does not state', () => {
  const plain = 'Roustabout needed for lease maintenance in the Permian. Duties include general labor, cleaning locations and assisting the crew. Will train.';
  const keys = beginnerChecks('Roustabout', plain).map((c) => c.key);
  for (const k of ['age', 'driver', 'drug', 'background', 'cdl', 'mvr']) assert.ok(!keys.includes(k), `${k} is not stated`);
});

test('beginnerChecks: one schedule line, an hours figure never repeated', () => {
  const t = 'Requirements: must be able to work up to 50 hours a week. Overtime: 50 hours per week is common. Weekends and holidays as needed. Must pass a drug test.';
  const sched = beginnerChecks('Journeyman Electrician', t).filter((c) => c.key === 'schedule');
  assert.equal(sched.length, 1);
  assert.doesNotMatch(sched[0].text, /50 hours a week.*50 hours per week/);
});

test('beginnerChecks: a CDL hauler — class, endorsement, medical card, age, MVR', () => {
  const t = 'CDL-A Water Hauler. Requirements: Must have a valid Class A CDL with tanker endorsement. Must have a current DOT medical card. Clean MVR required. Must be 21 years of age or older. TWIC card a plus.';
  const by = Object.fromEntries(beginnerChecks('CDL Water Hauler', t).map((c) => [c.key, c]));
  assert.equal(by.cdl.text, 'A Class A CDL');
  assert.equal(by.age.text, 'Be at least 21 years old');
  assert.ok(by.mvr);
  assert.equal(by['ticket:twic'].status, 'preferred');
  assert.ok(by['ticket:dot_medical']);
});

test('beforeYouApply: shown for beginner / trade postings and for any posting that asks for money — not otherwise', () => {
  assert.ok(isBeginnerListing({ title: 'Floorhand', description: FLOORHAND }));
  assert.equal(beforeYouApply({ title: 'Senior Software Engineer', description: 'Build distributed systems in Go. 5+ years of experience required.' }), null);
  const scam = beforeYouApply({ title: 'Brand Ambassador', description: 'Earn up to $2,000 a week! New reps must purchase a starter kit ($99) before training.' });
  assert.ok(scam && scam.payToTrain);
  assert.equal(scam.beginner, false);
  assert.deepEqual(scam.checks, []);
  const fh = beforeYouApply({ title: 'Floorhand', description: FLOORHAND });
  assert.ok(fh.beginner && fh.entry && fh.checks.length >= 8);
  // a trade posting that asks for years in the job: the checks are what it asks for, not "for a beginner"
  const jm = beforeYouApply({ title: 'Journeyman Electrician', description: 'Requirements: 7+ years of commercial/industrial experience as an electrician. Must pass a drug test. Valid driver\'s license.' });
  assert.ok(jm.beginner); assert.equal(jm.entry, false);
  assert.deepEqual(fh.terms.map((t) => t.key), ['safeland', 'h2s', 'osha10']);
  assert.equal(fh.payToTrain, null);
});

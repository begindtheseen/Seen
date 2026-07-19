// Tests for the deterministic outcome classifier + LLM reconciliation added to the Reddit
// ingest pipeline (api/reports.js). The whole point of the change is POSITIVE-outcome
// detection: the LLM under-detected success, so these prove positives land positive,
// negatives stay intact, and recruitinghell sarcasm does NOT false-positive as hired.
// Run: node --test api/reports.classify.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyOutcomeFromText, reconcileOutcome } from './reports.js';

const POSITIVE = new Set(['offer', 'hired', 'interview', 'human']);
const NEGATIVE = new Set(['ghosted', 'rejected', 'autoreject']);

// ── Positive → positive (the real fix) ───────────────────────────────────────────
test('offers are detected as offer', () => {
  assert.equal(classifyOutcomeFromText('After three rounds I finally got the offer and accepted — start date is next month!'), 'offer');
  assert.equal(classifyOutcomeFromText("Update: I'm hired! Signed the offer letter yesterday and my first day is next Monday."), 'offer');
  assert.equal(classifyOutcomeFromText('They made me an offer! 75k, verbal for now but the written offer is coming Friday.'), 'offer');
  assert.equal(classifyOutcomeFromText('Took the offer at the smaller company — better team.'), 'offer');
});

test('hires are detected as hired', () => {
  assert.equal(classifyOutcomeFromText('Got the job at a mid-size startup after a month. Onboarding starts in two weeks.'), 'hired');
  assert.equal(classifyOutcomeFromText('I was hired! New job starts the 15th.'), 'hired');
  assert.equal(classifyOutcomeFromText('Signed the contract today, start date is Jan 6.'), 'hired');
});

test('interviews / progressing are detected as interview', () => {
  assert.equal(classifyOutcomeFromText('Interview scheduled for Thursday with the hiring manager. Fingers crossed!'), 'interview');
  assert.equal(classifyOutcomeFromText('Recruiter reached out and I have a phone screen next week.'), 'interview');
  assert.equal(classifyOutcomeFromText('Made it through and I am moving forward to the final round.'), 'interview');
});

test('a plain reply / callback is detected as human (reached a person)', () => {
  assert.equal(classifyOutcomeFromText('Finally heard back from them after the assessment, they replied this morning.'), 'human');
  assert.equal(classifyOutcomeFromText('Got a callback from the recruiter today.'), 'human');
});

// ── Ghosting → ghosted (negative detection intact) ───────────────────────────────
test('ghosting is detected as ghosted', () => {
  assert.equal(classifyOutcomeFromText('Applied six weeks ago, did the coding assessment, and never heard back. Total silence.'), 'ghosted');
  assert.equal(classifyOutcomeFromText('Three interviews then radio silence for a month.'), 'ghosted');
  assert.equal(classifyOutcomeFromText("No response after the final round. It's been weeks, just crickets."), 'ghosted');
});

// ── Rejection → rejected / autoreject (negative detection intact) ─────────────────
test('rejections are detected as rejected', () => {
  assert.equal(classifyOutcomeFromText('Made it to the final round and then got rejected. Bummer.'), 'rejected');
  assert.equal(classifyOutcomeFromText('Unfortunately they decided to move forward with other candidates.'), 'rejected');
  assert.equal(classifyOutcomeFromText('Position has been filled, they went with another candidate.'), 'rejected');
  assert.equal(classifyOutcomeFromText('Got the rejection email. Oh well, onto the next.'), 'rejected');
});

test('automated / instant rejections are detected as autoreject', () => {
  assert.equal(classifyOutcomeFromText('Auto-rejected within an hour of applying. Definitely an ATS filter.'), 'autoreject');
  assert.equal(classifyOutcomeFromText('Got an automated rejection email 10 minutes after I hit submit.'), 'autoreject');
  assert.equal(classifyOutcomeFromText('Instantly rejected. No human ever looked at my resume.'), 'autoreject');
});

// ── Recruitinghell sarcasm must NOT false-positive as success ─────────────────────
test('sarcastic "got the offer /s" does not classify as a positive', () => {
  const r = classifyOutcomeFromText('Oh yeah, I totally got the offer. /s');
  assert.ok(!POSITIVE.has(r), `expected non-positive, got ${r}`);
  assert.equal(r, 'unknown');
});

test('sarcasm with a real rejection stays negative, never hired', () => {
  const r = classifyOutcomeFromText('Landed my dream job! Just kidding, another automated rejection.');
  assert.ok(!POSITIVE.has(r), `expected non-positive, got ${r}`);
  assert.equal(r, 'autoreject');
});

test('"perfect fit… then rejected" is not read as hired', () => {
  const r = classifyOutcomeFromText("Congrats to me! Five interviews, told me I was 'the perfect fit'… then rejected me two days later.");
  assert.ok(!POSITIVE.has(r), `expected non-positive, got ${r}`);
  assert.equal(r, 'rejected');
});

test('sarcastic "got hired /s" does not classify as hired', () => {
  const r = classifyOutcomeFromText('Great news everyone, I got hired!! ...at the unemployment office. /s');
  assert.ok(!POSITIVE.has(r), `expected non-positive, got ${r}`);
});

// ── Neutral text is unknown; a fear-mention does not become a rejection ───────────
test('questions and non-outcome text are unknown', () => {
  assert.equal(classifyOutcomeFromText('Has anyone interviewed at Acme recently? Curious about their process.'), 'unknown');
  assert.equal(classifyOutcomeFromText(''), 'unknown');
  assert.equal(classifyOutcomeFromText(null), 'unknown');
  assert.equal(classifyOutcomeFromText(undefined), 'unknown');
});

test('a mere worry about rejection does not override a real offer', () => {
  assert.equal(classifyOutcomeFromText('I was so worried about rejection, but I got the offer!'), 'offer');
});

test('"got the job description" is not a hire', () => {
  const r = classifyOutcomeFromText('Finally got the job description and the pay band is way below market.');
  assert.ok(!POSITIVE.has(r), `expected non-positive, got ${r}`);
});

// ── reconcileOutcome: conservative LLM ↔ deterministic merge ──────────────────────
test('reconcile rescues success the LLM left non-committal', () => {
  assert.equal(reconcileOutcome('unknown', 'offer'), 'offer');
  assert.equal(reconcileOutcome('applied', 'hired'), 'hired');
  assert.equal(reconcileOutcome('waiting', 'interview'), 'interview');
  assert.equal(reconcileOutcome('', 'human'), 'human');
});

test('reconcile also rescues a negative the LLM left non-committal', () => {
  assert.equal(reconcileOutcome('unknown', 'ghosted'), 'ghosted');
  assert.equal(reconcileOutcome('applied', 'rejected'), 'rejected');
});

test('reconcile NEVER flips a committed negative into a positive (sarcasm guardrail)', () => {
  assert.equal(reconcileOutcome('ghosted', 'offer'), 'ghosted');
  assert.equal(reconcileOutcome('rejected', 'hired'), 'rejected');
  assert.equal(reconcileOutcome('autoreject', 'interview'), 'autoreject');
});

test('reconcile strengthens a weak positive but never downgrades a strong one', () => {
  assert.equal(reconcileOutcome('interview', 'offer'), 'offer');   // upgrade
  assert.equal(reconcileOutcome('human', 'interview'), 'interview'); // upgrade
  assert.equal(reconcileOutcome('offer', 'interview'), 'offer');   // no downgrade
  assert.equal(reconcileOutcome('hired', 'human'), 'hired');       // no downgrade
});

test('reconcile keeps the LLM outcome when the detector is unsure', () => {
  assert.equal(reconcileOutcome('rejected', 'unknown'), 'rejected');
  assert.equal(reconcileOutcome('offer', undefined), 'offer');
  assert.equal(reconcileOutcome('ghosted', null), 'ghosted');
});

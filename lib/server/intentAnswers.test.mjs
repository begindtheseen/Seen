// Intent answers built from the real companyMetaFacts output (lib/companyMeta.ts). No data → null; plurals; no
// dashes; every rate names its report count. Run: node --test lib/server/intentAnswers.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { companyMetaFacts } from '../companyMeta.ts';
import {
  applicationStatusAnswer, howLongAnswer, doesGhostAnswer, interviewProcessAnswer, hiringProcessAnswer, isLegitAnswer, jobsAtAnswer,
  answerForIntent, intentFaq, mergeIntentFaq, ANSWERS,
} from './intentAnswers.js';
import { ANSWERABLE_INTENTS } from './searchIntents.js';
import { buildCompanyFaq } from './companyFaq.js';

const target = companyMetaFacts('Target', { gradeable: true, overall_score: 72, response_rate: 0.87, ghost_rate: 0.13, avg_wait_days: 9, report_count: 48, first_party_report_count: 48, mention_count: 2, data_source: 'reports' }, null);
const oneEach = companyMetaFacts('Acme', { gradeable: true, overall_score: 60, response_rate: 0.6, ghost_rate: 0.4, avg_wait_days: 1, report_count: 5, first_party_report_count: 5, mention_count: 0, data_source: 'reports' }, null);
const fewReports = companyMetaFacts('Chipotle', { gradeable: true, overall_score: 77, response_rate: 0.77, ghost_rate: 0.23, avg_wait_days: null, report_count: 4, first_party_report_count: 2, mention_count: 6, data_source: 'reports' }, null);
const ungraded = companyMetaFacts('Tiny Co', { gradeable: false, overall_score: null, response_rate: null, ghost_rate: null, avg_wait_days: null, report_count: 2, first_party_report_count: 2, mention_count: 0, data_source: 'reports' }, null);
const noScore = companyMetaFacts('Nobody', null, null);

const DASH = /[‒-―−]| - /;
const all = (f, extra) => Object.fromEntries(Object.entries(ANSWERS).map(([k, fn]) => [k, fn(f, extra)]));

test('every answerable intent has a template', () => {
  assert.deepEqual(Object.keys(ANSWERS).sort(), [...ANSWERABLE_INTENTS].sort());
});

test('application status (the "target application status" search) leads with the response question, real numbers', () => {
  const a = applicationStatusAnswer(target);
  assert.equal(a.question, 'How long does Target take to respond to applications?');
  assert.match(a.answer, /^48 applicant reports say 87% of applicants heard back from Target and 13% never heard anything\./);
  assert.match(a.answer, /about 9 days on average/);
  assert.match(a.answer, /not verified facts/);
});

test('each template on a fully graded company', () => {
  const x = all(target, { avgRounds: 2.4, openListings: 312 });
  assert.match(x.how_long_to_hear_back.answer, /Applicants report waiting about 9 days on average to hear back from Target, based on 48 applicant reports\./);
  assert.match(x.does_ghost.answer, /^48 applicant reports say 13% of applicants never heard back from Target/);
  assert.match(x.does_ghost.answer, /Most applicants do hear back/);
  assert.match(x.interview_process.answer, /about 2 rounds at Target on average, based on 48 applicant reports/);
  assert.match(x.hiring_process.answer, /^Seen grades Target B \(72\/100\) for hiring transparency from 48 applicant reports and 2 online mentions\./);
  assert.match(x.is_legit.answer, /Seen cannot verify an employer, but 48 applicant reports and 2 online mentions give Target a Seen Grade of B \(72\/100\)/);
  assert.match(x.jobs_at.answer, /^Seen lists 312 open jobs at Target\. Before you apply: 48 applicant reports say 87% of applicants heard back\.$/);
  for (const qa of Object.values(x)) {
    assert.ok(!DASH.test(qa.question + qa.answer), `no dashes: ${qa.answer}`);
    assert.ok(!/undefined|null|NaN/.test(qa.answer), qa.answer);
  }
});

test('plurals: 1 day, 1 round, 1 open job', () => {
  assert.match(howLongAnswer(oneEach).answer, /about 1 day on average/);
  assert.match(interviewProcessAnswer(oneEach, { avgRounds: 1.2 }).answer, /about 1 round at Acme/);
  assert.match(jobsAtAnswer(oneEach, { openListings: 1 }).answer, /^Seen lists 1 open job at Acme\./);
  assert.match(howLongAnswer({ ...oneEach, waitDays: 0 }).answer, /less than a day/);
});

test('no data → null: no grade, no rates, no wait, no rounds, no listings', () => {
  for (const [k, v] of Object.entries(all(ungraded))) assert.equal(v, null, `ungraded ${k}`);
  for (const [k, v] of Object.entries(all(noScore))) assert.equal(v, null, `no score ${k}`);
  // Graded but under 5 applicant reports: no percentage anywhere, no invented wait.
  assert.equal(doesGhostAnswer(fewReports), null);
  assert.equal(howLongAnswer(fewReports), null);
  assert.equal(applicationStatusAnswer(fewReports), null);
  assert.equal(interviewProcessAnswer(fewReports), null);
  assert.equal(jobsAtAnswer(fewReports, { openListings: 0 }), null);
  const legit = isLegitAnswer(fewReports);
  assert.ok(legit && !/%/.test(legit.answer), 'a grade can be quoted, a rate cannot');
  const process = hiringProcessAnswer(fewReports);
  assert.ok(process && !/%/.test(process.answer));
  assert.equal(answerForIntent('other', target), null);
  assert.equal(answerForIntent('nonsense', target), null);
  assert.equal(answerForIntent('does_ghost', null), null);
});

test('jobs_at needs no grade, only a real listing count; ungraded company → no rate sentence', () => {
  const a = jobsAtAnswer(ungraded, { openListings: 7 });
  assert.equal(a.answer, 'Seen lists 7 open jobs at Tiny Co.');
});

test('intentFaq: searched order, deduped, unanswerable skipped, questions already on the page dropped, max', () => {
  const intents = [{ intent: 'application_status' }, { intent: 'interview_process' }, { intent: 'does_ghost' }, 'how_long_to_hear_back', 'is_legit'];
  const out = intentFaq(target, intents, { existing: [{ question: 'Does Target ghost applicants?' }] });
  assert.deepEqual(out.map((q) => q.intent), ['application_status', 'how_long_to_hear_back', 'is_legit'], 'no rounds → interview skipped; ghost already asked');
  assert.equal(intentFaq(target, intents, { max: 1 }).length, 1);
  assert.deepEqual(intentFaq(ungraded, intents), []);
});

test('mergeIntentFaq: searched questions lead, the page FAQ entries asking the same thing are dropped', () => {
  const base = buildCompanyFaq({ name: 'Target', overallScore: target.score, ghostRate: 0.13, responseRate: 0.87, avgWaitDays: target.waitDays, reportCount: target.reportCount });
  const merged = mergeIntentFaq(base, target, [{ intent: 'application_status', impressions: 300, clicks: 2 }, { intent: 'does_ghost', impressions: 40, clicks: 0 }]);
  assert.deepEqual(merged.map((q) => q.question), [
    'How long does Target take to respond to applications?',
    'Does Target ghost applicants?',
    'What is the Target hiring process like?',
  ]);
  // The page's own "application status" question is dropped: the searched one already answers it.
  assert.equal(merged.filter((q) => /application status/i.test(q.question)).length, 0);
  assert.equal(merged[1].intent, 'does_ghost', 'the searched version replaced the page one');
  assert.equal(merged.filter((q) => /ghost applicants/.test(q.question)).length, 1);
  assert.deepEqual(mergeIntentFaq(base, ungraded, ['does_ghost']), base, 'nothing answerable → the page FAQ unchanged');
  assert.deepEqual(mergeIntentFaq(base, target, []), base);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCompanyFaq } from './companyFaq.js';
import { detectAiSlop } from '../humanizer/detectAiSlop.js';
import { BUILTIN_PHRASE_RULES } from '../humanizer/phraseRisk.js';

const all = (faq) => faq.map((f) => `${f.question} ${f.answer}`).join(' ');

test('no grade → empty (no FAQ, no schema)', () => {
  assert.deepEqual(buildCompanyFaq(null), []);
  assert.deepEqual(buildCompanyFaq({ name: 'Acme', overallScore: null }), []);
  assert.deepEqual(buildCompanyFaq({ name: '', overallScore: 70 }), []);
});

test('with rates: application status, hiring process, ghosting and wait, all in report wording', () => {
  const faq = buildCompanyFaq({ name: 'Acme', overallScore: 42, ghostRate: 0.66, responseRate: 0.3, avgWaitDays: 12, reportCount: 40, mentionCount: 3 });
  assert.deepEqual(faq.map((f) => f.question), [
    'Acme application status: do applicants hear back?',
    'What is the Acme hiring process like?',
    'Does Acme ghost applicants?',
    'How long does Acme take to respond to applicants?',
  ]);
  assert.equal(faq[0].answer, 'Of 40 applicant reports on Seen, 30% say Acme got back to them (a rejection counts as an answer) and 66% say they never heard back. The reports put the average wait to hear back at 12 days. These are applicants\' own accounts, not verified facts.');
  assert.match(faq[1].answer, /^Seen grades the Acme hiring process D \(42\/100\) from 40 applicant reports and 3 online mentions\. Those reports say 30% of applicants heard back and 66% never did\./);
  assert.match(faq[2].answer, /66% say Acme never got back to them.*Most say they never heard back\./);
  assert.match(faq[3].answer, /12 days/);
  // Never a bare verdict about the employer.
  assert.doesNotMatch(all(faq), /Acme ghosts|ghosts \d+%|Acme has a \d+% ghost rate/);
  assert.doesNotMatch(all(faq), /[—–]/);
  assert.equal(faq.some((f) => /transparent/i.test(f.question)), false);
});

test('no rates passed (fewer than 5 applicant reports): no percentage anywhere, no ghost / status questions', () => {
  const faq = buildCompanyFaq({ name: 'Globex', overallScore: 72, ghostRate: null, responseRate: null, avgWaitDays: null, reportCount: 2, mentionCount: 6 });
  assert.deepEqual(faq.map((f) => f.question), ['What is the Globex hiring process like?']);
  assert.match(faq[0].answer, /B \(72\/100\) from 2 applicant reports and 6 online mentions\. There are too few applicant reports for a response rate yet\./);
  assert.doesNotMatch(all(faq), /%/);
});

test('never invents a wait: null, 0 and under a day leave every wait sentence out', () => {
  for (const avgWaitDays of [null, undefined, 0, 0.4]) {
    const faq = buildCompanyFaq({ name: 'Solo', overallScore: 70, ghostRate: 0.1, responseRate: 0.9, avgWaitDays, reportCount: 9 });
    assert.doesNotMatch(all(faq), /wait|how long/i, String(avgWaitDays));
  }
  const one = buildCompanyFaq({ name: 'Solo', overallScore: 70, ghostRate: 0.1, responseRate: 0.9, avgWaitDays: 1, reportCount: 1 });
  assert.match(all(one), /1 day\b/);
  assert.match(all(one), /Of 1 applicant report on Seen/);
});

test('staffing agencies get "Is <agency> legit?" in the same neutral wording; others do not', () => {
  const agency = buildCompanyFaq({ name: 'Robert Half', overallScore: 58, ghostRate: 0.4, responseRate: 0.58, avgWaitDays: null, reportCount: 120, isAgency: true });
  const legit = agency.find((f) => f.question === 'Is Robert Half legit?');
  assert.ok(legit);
  assert.equal(legit.answer, 'Seen does not verify companies or job offers. What it has is what applicants report: of 120 applicant reports on Seen about Robert Half, 58% say they heard back and 40% say they never did. Seen grades the Robert Half hiring process C (58/100) from 120 applicant reports. These are applicants\' own accounts, not verified facts.');
  const thin = buildCompanyFaq({ name: 'Kforce', overallScore: 66, reportCount: 2, mentionCount: 6, isAgency: true });
  assert.match(thin.find((f) => /legit/.test(f.question)).answer, /2 applicant reports and 6 online mentions on Seen about Kforce, too few for a response rate yet\./);
  assert.doesNotMatch(all(thin), /%/);
  assert.equal(buildCompanyFaq({ name: 'Walmart', overallScore: 91, ghostRate: 0.13, responseRate: 0.87, reportCount: 48 }).some((f) => /legit/.test(f.question)), false);
});

test('every answer passes the product\'s own AI-slop detector', () => {
  for (const isAgency of [false, true]) for (const [g, r, w, n] of [[0.66, 0.3, 12, 40], [0.13, 0.87, null, 48], [null, null, null, 2]]) {
    for (const f of buildCompanyFaq({ name: 'Acme', overallScore: 61, ghostRate: g, responseRate: r, avgWaitDays: w, reportCount: n, mentionCount: 4, isAgency })) {
      assert.deepEqual(detectAiSlop(f.answer, BUILTIN_PHRASE_RULES), [], f.answer);
    }
  }
});

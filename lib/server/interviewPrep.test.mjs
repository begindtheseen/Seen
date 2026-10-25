import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  interviewRecord, payRange, followUpPlan, numbersBacked, guardPack, fallbackPack, storyBullets, prepEmails,
  splitSource, isInterviewStage, prepKey,
} from './interviewPrep.js';

const RESUME = `Maria Lopez
Phoenix, AZ · maria@example.com
EXPERIENCE
Team Lead, Target — Phoenix, AZ · 2016 – 2026
• Resolved guest complaints without a manager 95% of the time across 40 shifts a month
• Raised guest survey scores from 78% to 91% in one year by coaching a team of 12
• Trained 30 new team members on register, returns and loss prevention
Bilingual English/Spanish`;

test('interview stages are the three tracker stages', () => {
  assert.equal(isInterviewStage('Interview'), true);
  assert.equal(isInterviewStage('Phone Screen'), true);
  assert.equal(isInterviewStage('Final Round'), true);
  assert.equal(isInterviewStage('Applied'), false);
});

test('splitSource pulls the link out of a stored account', () => {
  const r = splitSource('The applicant finished all interview rounds. [Public teamblind.com post: https://www.teamblind.com/post/x-1]');
  assert.equal(r.text, 'The applicant finished all interview rounds.');
  assert.equal(r.url, 'https://www.teamblind.com/post/x-1');
});

test('interviewRecord counts only interview accounts and what happened after', () => {
  const rows = [
    { outcome: 'offer', report_text: 'Two rounds of interviews then an offer a week later from the store manager.', rounds: 2, wait_days: 7, role: 'Assistant Store Manager' },
    { outcome: 'hired', report_text: 'Hired after one interview.', rounds: 1 },
    { outcome: 'ghosted', report_text: 'Had a phone screen and an on-site interview, then heard nothing for a month.', rounds: 2 },
    { outcome: 'rejected', report_text: 'Rejected after the final round interview with the district manager.', rounds: 3 },
    { outcome: 'ghosted', report_text: 'Applied online and never heard back at all.' }, // no interview → not counted
    { outcome: 'interview', report_text: 'Waiting after my interview last Tuesday.' },
  ];
  const rec = interviewRecord(rows, { role: 'Assistant Store Manager' });
  assert.equal(rec.accounts, 5);
  assert.deepEqual(rec.after, { offer: 2, rejected: 1, ghosted: 1, waiting: 1 });
  assert.equal(rec.resolved, 4);
  assert.equal(rec.offerAfterInterviewPct, 50);
  assert.equal(rec.ghostedAfterInterviewPct, 25);
  assert.equal(rec.rounds, 2);
  assert.equal(rec.quotes[0].role, 'Assistant Store Manager', 'role-matching account first');
  assert.ok(rec.quotes.length <= 3);
});

test('interviewRecord never prints a percentage from fewer than 3 resolved accounts', () => {
  const rec = interviewRecord([{ outcome: 'offer', report_text: 'Offer after the interview.' }]);
  assert.equal(rec.offerAfterInterviewPct, null);
  assert.equal(rec.ghostedAfterInterviewPct, null);
});

test('payRange keeps hourly and yearly apart and needs 3 listings', () => {
  assert.equal(payRange([{ salary_min: 16, salary_max: 18 }, { salary_min: 17, salary_max: 19 }]), null);
  const hourly = payRange([
    { salary_min: 16, salary_max: 18 }, { salary_min: 17, salary_max: 19 }, { salary_min: 18, salary_max: 22 },
    { salary_min: 55000, salary_max: 65000 },
  ]);
  assert.equal(hourly.unit, 'hour');
  assert.equal(hourly.listings, 3);
  assert.ok(hourly.low >= 16 && hourly.high <= 22);
});

test('followUpPlan skips weekends', () => {
  const plan = followUpPlan('2026-10-23T15:00:00Z'); // a Friday
  assert.equal(plan.followUpOn.slice(0, 10), '2026-10-30');
  assert.equal(plan.lastCheckOn.slice(0, 10), '2026-11-06');
});

test('numbersBacked: every number must be the résumé\'s', () => {
  assert.equal(numbersBacked('I raised survey scores from 78% to 91%.', RESUME), true);
  assert.equal(numbersBacked('I trained 30 people.', RESUME), true);
  assert.equal(numbersBacked('I grew sales 40% and managed $2M.', RESUME), false);
  assert.equal(numbersBacked('Here is my 30-second intro.', 'no numbers here'), true, 'the format words are not claims');
});

test('guardPack drops an answer with an invented number and fills from real bullets', () => {
  const raw = {
    questions: [{ q: 'How would you handle a guest who wants a refund without a receipt?', why: 'Returns are daily work.' }, { q: 'not a question', why: '' }],
    answers: [
      { q: 'Tell me about a result you are proud of.', answer: 'At Target I raised guest survey scores from 78% to 91% in one year by coaching a team of 12 on greeting and follow-up, and I kept it there.', resume_fact: 'Raised guest survey scores from 78% to 91% in one year by coaching a team of 12' },
      { q: 'Tell me about sales.', answer: 'I grew store sales by 40% and ran a $2M budget, which is the kind of result I want to bring to Ross every single day here.', resume_fact: 'Raised guest survey scores from 78% to 91% in one year by coaching a team of 12' },
      { q: 'Invented story', answer: 'At Walmart I managed the whole store for five years and led every shift with great results for everyone involved.', resume_fact: 'Store manager at Walmart for five years' },
    ],
    intro: 'I led a team at Target for ten years and grew revenue 300% for the district, and now I want to do the same at Ross.',
  };
  const pack = guardPack(raw, { company: 'Ross Stores', role: 'Assistant Store Manager', resumeText: RESUME });
  assert.ok(pack.answers.some((a) => a.answer.includes('78% to 91%')), 'the backed answer stays');
  assert.ok(!pack.answers.some((a) => /40%|\$2M|Walmart/.test(a.answer)), 'invented numbers and employers are gone');
  assert.equal(pack.intro, null, 'an intro with an invented number is dropped');
  assert.ok(!pack.questions.some((q) => q.q === 'not a question'), 'a model line that is not a question is dropped');
  const facts = pack.answers.map((a) => a.resume_fact);
  assert.equal(new Set(facts).size, facts.length, 'no story told twice');
  assert.ok(pack.questions.some((q) => /refund/.test(q.q)));
  assert.ok(pack.answers.length >= 2, 'filled with coached answers from real bullets');
});

test('fallbackPack works with no model and only quotes real résumé lines', () => {
  const pack = fallbackPack({ company: 'Ross Stores', role: 'Assistant Store Manager', resumeText: RESUME });
  assert.ok(pack.questions.length >= 5);
  assert.ok(pack.questions.some((q) => q.q.includes('Ross Stores')));
  for (const a of pack.answers) assert.ok(RESUME.includes(a.resume_fact), `real line: ${a.resume_fact}`);
  assert.equal(pack.model, false);
});

test('storyBullets prefers lines with numbers and skips contact lines', () => {
  const b = storyBullets(RESUME);
  assert.ok(b[0].match(/\d/));
  assert.ok(!b.some((l) => l.includes('@')));
});

test('prepEmails fill company and role and leave the interviewer for the person', () => {
  const e = prepEmails({ company: 'Ross Stores', role: 'Assistant Store Manager', name: 'Maria Lopez' });
  assert.match(e.thankYou.body, /Assistant Store Manager role at Ross Stores/);
  assert.match(e.thankYou.body, /\[interviewer's name\]/);
  assert.match(e.followUp.body, /Maria Lopez$/);
});

test('prepKey is stable across case and punctuation', () => {
  assert.equal(prepKey('Ross Stores, Inc.', 'Assistant Store Manager'), prepKey('ross stores inc', 'assistant store manager'));
});

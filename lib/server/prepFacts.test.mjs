import { test } from 'node:test';
import assert from 'node:assert/strict';
import { factSheet, factSheetText, bulletById, staleLines } from './prepFacts.js';
import { guardPack, verifyPrompt, prepPrompt } from './interviewPrep.js';

const NOW = Date.parse('2026-10-25T20:00:00Z');
const ACC = `Kim Tran
Staff accountant with 6 years in month-end close. Passed FAR and AUD sections of the CPA exam in 2024; sitting for REG in 2025.
EXPERIENCE
Staff Accountant — Bayou Industrial Supply — Apr 2021 – Present
• Own month-end close for 3 entities; cut the close from 8 to 5 business days by building a close checklist
• Supported the 2023 external audit: built 60+ PBC schedules and answered auditor questions
Gulf Coast Marine Services — Houston, TX
Accounts Payable Specialist, Jun 2018 – Mar 2021
• Processed 900+ invoices a month with three-way match in NetSuite and Bill.com
CERTIFICATIONS
ACLS (American Heart Association) — exp. 2025`;

test('fact sheet: numbered jobs and bullets, a split employer header repaired, stale lines found', () => {
  const s = factSheet(ACC, NOW);
  assert.equal(s.jobs[1].title, 'Accounts Payable Specialist');
  assert.equal(s.jobs[1].company, 'Gulf Coast Marine Services');
  assert.equal(bulletById(s, 'J1.2').text.startsWith('Supported the 2023 external audit'), true);
  assert.equal(bulletById(s, 'J9.1'), null);
  const kinds = s.stale.map((x) => `${x.kind}:${x.line}`);
  assert.ok(kinds.some((k) => k.startsWith('past_plan:sitting for REG in 2025')), kinds.join(' | '));
  assert.ok(kinds.some((k) => k.startsWith('expired:ACLS')), kinds.join(' | '));
  assert.ok(!kinds.some((k) => /Passed FAR/.test(k)), 'a done thing is not stale');
  assert.match(factSheetText(s), /J2: Accounts Payable Specialist — Gulf Coast Marine Services · Jun 2018 – Mar 2021/);
  assert.equal(staleLines('Expected graduation May 2027', NOW).length, 0, 'a future date is not stale');
});

test('prompts carry the fact sheet; the check may not add facts', () => {
  const p = prepPrompt({ company: 'Lone Star', role: 'Senior Accountant', resumeText: ACC, nowMs: NOW });
  assert.match(p.user, /FACT SHEET/);
  assert.match(p.user, /"bullet":"J1\.2"/);
  const v = verifyPrompt({ company: 'Lone Star', role: 'Senior Accountant', resumeText: ACC, draft: { answers: [] }, nowMs: NOW });
  assert.match(v.system, /Never add a new fact/);
});

test('guardPack: a story by bullet ID uses that exact line; one bad sentence is cut, the answer kept', () => {
  const raw = {
    questions: [
      { q: 'How do you run a month-end close?', why: 'She wants to see her process.' },
      { q: 'How do you run your month-end close?', why: 'Duplicate.' },
    ],
    answers: [{
      q: 'How do you run a month-end close?', bullet: 'J1.1',
      situation: 'At Bayou the close took too long.',
      action: 'I own month-end close for 3 entities. I built a close checklist and cut the close from 8 to 5 business days. I also hold a daily standup with the AP team at 8 AM.',
      result: 'The close now takes 5 business days.',
    }],
    intro: "I'm a staff accountant at Bayou Industrial Supply, where I own month-end close for 3 entities. I'm sitting for REG in 2025. I'm interested in this role because [the reason].",
  };
  const p = guardPack(raw, { company: 'Lone Star', role: 'Senior Accountant', resumeText: ACC, nowMs: NOW });
  const a = p.answers.find((x) => !x.coached);
  assert.ok(a, JSON.stringify(p.answers));
  assert.equal(a.resume_fact, 'Own month-end close for 3 entities; cut the close from 8 to 5 business days by building a close checklist');
  assert.ok(!/standup|8 AM/.test(a.answer), `invented sentence cut: ${a.answer}`);
  assert.ok(/close checklist/.test(a.answer));
  assert.ok(!/REG in 2025/.test(p.intro || ''), 'a stale line is never repeated as a plan');
  assert.equal(p.questions.filter((q) => /month-end close\?$/.test(q.q)).length, 1, 'near-duplicate questions merged');
  assert.ok(p.questions.some((q) => q.why === 'You want to see your process.'), JSON.stringify(p.questions.map((q) => q.why)));
  assert.equal(p.resume_check.length, 2);
});

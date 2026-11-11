// R8/R9: the label-free reader lint is a measuring tool (scripts/reader-lint.mjs), not a display gate. These tests pin each
// defect class, the repairs the reader makes with certainty, and that nothing is hidden for failing a shape check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lintText, lintReading, postingStructure, hasOwnCue, POSTING_NOTE_FLAT } from './readerLint.js';
import { sentencePieces } from './statements.js';
import { extractJobFacts } from './extractJobFacts.js';
import { runOptimizer } from './index.js';
import { dutyHead } from './statementGate.js';

const fx = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));

test('each defect class is caught on its own wording', () => {
  for (const t of ['Comply with applicable', 'Experience working with', 'Strong knowledge of (', 'and the ability to lead', 'Not a coder']) assert.ok(lintText(t).includes('clipped'), t);
  for (const t of ['Qualifications Bachelor\'s degree in nursing', 'Meet with customers to discuss needs Increase sales of add-on products', 'Lead the team. Must have 5 years of experience with SQL', `${'word '.repeat(50)}end`]) assert.ok(lintText(t).includes('run_on'), t);
  for (const t of ['Salary range is $80,000 - $95,000 per year', 'We are an equal opportunity employer', 'Apply now at our careers page', 'Our mission is to make shipping simple', 'What is our tech stack?', 'Email jobs@acme.example with questions', 'Austin, TX', 'Req ID: 12345']) assert.ok(lintText(t).includes('junk'), t);
  for (const t of ['3+ years of warehouse experience', 'Experience with SQL', 'Valid driver\'s license', 'Apply engineering fundamentals to troubleshoot issues', 'Must be at least 18 years of age', 'Minimum 8+ years of hands-on experience developing compilers']) assert.deepEqual(lintText(t), [], t);
  const { counts } = lintReading([{ id: 'a', text: 'Experience with SQL and Python', importance: 'required' }, { id: 'b', text: 'Experience with SQL and Python', importance: 'preferred' }, { id: 'c', text: 'Experience with SQL and Python', importance: 'preferred' }]);
  assert.ok(counts.two_importances >= 1); assert.equal(counts.duplicate, 1);
});

const read = (d) => (extractJobFacts(d, { jobTitle: 'Role', company: 'Acme' }).statements || []);
const shownTexts = (d) => read(d).filter((s) => s.display).map((s) => s.text);

test('certain repairs: a glued heading word is trimmed, two whole sentences become two lines, copies are shown once', () => {
  const two = shownTexts('Requirements:\n- Lead the warehouse crew on second shift. Must have 3+ years of warehouse experience.\n- Forklift certification required.\n- Ability to lift 50 pounds.');
  assert.ok(two.some((t) => /^Lead the warehouse crew on second shift$/.test(t)), JSON.stringify(two));
  assert.ok(two.some((t) => /^3\+ years of warehouse experience$/.test(t)), JSON.stringify(two));
  const head = shownTexts('Requirements:\n- Qualifications Bachelor\'s degree in nursing.\n- Forklift certification required.\n- Ability to lift 50 pounds.');
  assert.ok(head.includes("Bachelor's degree in nursing"), JSON.stringify(head));
  const dup = shownTexts('Requirements:\n- 3+ years of SQL experience.\n- Forklift certification required.\nPreferred:\n- 3+ years of SQL experience.\n- Ability to lift 50 pounds.');
  assert.equal(dup.filter((t) => /^3\+ years of SQL experience$/.test(t)).length, 1, JSON.stringify(dup));
  // (a split that would leave a clipped half is not a repair: the line stays whole)
  assert.deepEqual(sentencePieces('Travel 2 - 4 times per year within Canada and the United States.'), ['Travel 2 - 4 times per year within Canada and the United States.']);
  assert.deepEqual(sentencePieces('Use tools, e.g. Excel and SQL. Must hold a CDL.'), ['Use tools, e.g. Excel and SQL.', 'Must hold a CDL.']);
});

test('nothing is hidden for failing a shape check: a line that cannot be repaired is displayed as it was', () => {
  const sts = read('Requirements:\n- 3+ years of warehouse experience.\n- Forklift certification required.\n- Ability to lift 50 pounds.\n- Work closely with the team on daily operations and Strong attention to detail.');
  assert.ok(!sts.some((s) => /^lint_|flat_unconfident/.test(String(s.hideReason || ''))), JSON.stringify(sts.map((s) => [s.text, s.hideReason])));
});

test('one block of text is a fact about the input: the note says so and the lines are not filtered for it', () => {
  assert.equal(postingStructure('Line one.\nLine two.\nLine three.\nLine four.'), 'structured');
  assert.equal(postingStructure(`Acme is hiring. ${'We need someone great. '.repeat(40)}`), 'flat');
  assert.equal(postingStructure(`Acme is hiring. Duties • Lead the team • Train staff • Count the safe ${'More words here. '.repeat(40)}`), 'structured');
  assert.ok(hasOwnCue('3+ years of experience', { dutyHead }) && hasOwnCue('Train new staff on the register', { dutyHead }) && !hasOwnCue('Great team culture and growth', { dutyHead }));
  assert.equal(POSTING_NOTE_FLAT, 'This posting arrived as one block of text, so some lines may be split oddly. Paste it with its line breaks for a cleaner read.');
  const flat = `Acme Logistics is hiring a Warehouse Lead in Dallas. You will lead a crew of 10 on second shift. Train new associates on safety. Must have 3+ years of warehouse experience. Forklift certification required. Ability to lift 50 pounds. We are a great team with a fun culture and lots of growth. ${'Our people are the heart of everything we do. '.repeat(12)}`;
  const o = runOptimizer({ resumeText: 'Jane Doe\nWarehouse Lead, Acme, 2019-2024\n- Led a crew of 8', jobTitle: 'Warehouse Lead', company: 'Acme Logistics', jobDescription: flat });
  assert.equal(o.structure, 'flat'); assert.equal(o.posting_note, POSTING_NOTE_FLAT);
  assert.ok(!o.statements.some((s) => /flat_unconfident/.test(String(s.hideReason || ''))));
  const headed = runOptimizer({ resumeText: 'Jane Doe', jobTitle: 'Lead', company: 'Acme', jobDescription: 'Requirements:\n- 3+ years of warehouse experience.\n- Forklift certification required.\n- Ability to lift 50 pounds.' });
  assert.equal(headed.structure, 'structured'); assert.equal(headed.posting_note, null);
});

test('linear time: the lint on 5,000 repetitions', () => {
  for (const u of ['and ', 'Qualifications ', '$1 - $2 ', 'needs Increase ', '(', 'e.g. ', 'a. B ']) { const t0 = Date.now(); lintText(u.repeat(5000)); sentencePieces(u.repeat(5000)); assert.ok(Date.now() - t0 < 2000, u); }
});

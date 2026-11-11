// R8: the label-free reader lint — each defect class is caught, and the reader's displayed lines stay under the ceiling on
// every fixture posting the repository carries (the corpus run is scripts/reader-lint.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lintText, lintReading, postingStructure, hasOwnCue } from './readerLint.js';
import { extractJobFacts } from './extractJobFacts.js';
import { runOptimizer } from './index.js';
import { dutyHead } from './statementGate.js';

const fx = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));

test('each defect class is caught on its own wording', () => {
  for (const t of ['Comply with applicable', 'Experience working with', 'Strong knowledge of (', 'and the ability to lead', 'Operating cadence']) assert.ok(lintText(t).includes('clipped'), t);
  for (const t of ['Qualifications Bachelor\'s degree in nursing', 'Meet with customers to discuss needs Increase sales of add-on products', 'Lead the team. Must have 5 years of experience with SQL', `${'word '.repeat(50)}end`]) assert.ok(lintText(t).includes('run_on'), t);
  for (const t of ['Salary range is $80,000 - $95,000 per year', 'We are an equal opportunity employer', 'Apply now at our careers page', 'Our mission is to make shipping simple', 'What is our tech stack?', 'Email jobs@acme.example with questions', 'Austin, TX', 'Req ID: 12345']) assert.ok(lintText(t).includes('junk'), t);
  for (const t of ['3+ years of warehouse experience', 'Experience with SQL', 'Valid driver\'s license', 'Apply engineering fundamentals to troubleshoot issues', 'Must be at least 18 years of age', 'Minimum 8+ years of hands-on experience developing compilers']) assert.deepEqual(lintText(t), [], t);
  const { counts } = lintReading([{ id: 'a', text: 'Experience with SQL and Python', importance: 'required' }, { id: 'b', text: 'Experience with SQL and Python', importance: 'preferred' }, { id: 'c', text: 'Experience with SQL and Python', importance: 'preferred' }]);
  assert.ok(counts.two_importances >= 1); assert.equal(counts.duplicate, 1);
});

test('the reader\'s displayed lines pass the lint on every fixture posting (ceiling 0.5 per 100)', () => {
  const posts = [...fx('./fixtures/paste-postings.json'), ...Object.values(fx('./fixtures/statement-postings.json')), ...fx('../fixtures/personas/postings-sample.json'), ...fx('./fixtures/headed-bulleted-postings.json')];
  let shown = 0, bad = 0; const ex = [];
  for (const p of posts) {
    const sts = extractJobFacts(p.description || p.text || '', { jobTitle: p.title, company: p.company }).statements || [];
    const { per, counts } = lintReading(sts);
    shown += counts.shown; bad += counts.defective;
    for (const s of sts) if (per.has(s.id) && ex.length < 5) ex.push(`${p.title}: ${s.text}`);
  }
  assert.ok(shown > 300);
  assert.ok(100 * bad / shown <= 0.5, `${bad}/${shown}: ${ex.join(' | ')}`);
});

test('one block of text is read with confidence only, says so, and shows nothing when fewer than three lines survive', () => {
  assert.equal(postingStructure('Line one.\nLine two.\nLine three.\nLine four.'), 'structured');
  assert.equal(postingStructure(`Acme is hiring. ${'We need someone great. '.repeat(40)}`), 'flat');
  assert.equal(postingStructure(`Acme is hiring. Duties • Lead the team • Train staff • Count the safe ${'More words here. '.repeat(40)}`), 'structured');
  assert.ok(hasOwnCue('3+ years of experience', { dutyHead }) && hasOwnCue('Train new staff on the register', { dutyHead }) && !hasOwnCue('Great team culture and growth', { dutyHead }));
  const flat = `Acme Logistics is hiring a Warehouse Lead in Dallas. You will lead a crew of 10 on second shift. Train new associates on safety. Must have 3+ years of warehouse experience. Forklift certification required. Ability to lift 50 pounds. We are a great team with a fun culture and lots of growth. ${'Our people are the heart of everything we do. '.repeat(12)}`;
  const o = runOptimizer({ resumeText: 'Jane Doe\nWarehouse Lead, Acme, 2019-2024\n- Led a crew of 8', jobTitle: 'Warehouse Lead', company: 'Acme Logistics', jobDescription: flat });
  assert.equal(o.structure, 'flat'); assert.match(o.posting_note, /one block of text/);
  assert.ok(o.statements.filter((s) => s.display).every((s) => hasOwnCue(s.text, { dutyHead })));
  const thin = runOptimizer({ resumeText: 'Jane Doe', jobTitle: 'Lead', company: 'Acme', jobDescription: `Acme is hiring. We are a great team. ${'Our people matter and our culture is fun. '.repeat(20)} Must have 2 years of experience.` });
  assert.equal(thin.statements.filter((s) => s.display).length, 0);
});

test('linear time: the lint on 5,000 repetitions', () => {
  for (const u of ['and ', 'Qualifications ', '$1 - $2 ', 'needs Increase ', '(']) { const t0 = Date.now(); lintText(u.repeat(5000)); assert.ok(Date.now() - t0 < 2000, u); }
});

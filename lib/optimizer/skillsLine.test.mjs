// A skill on a skills line is that skill, with or without its detail (coordinator, 2026-11-10 hidden set: "NetSuite,
// BlackLine, QuickBooks Online, Excel (advanced: pivot tables, INDEX/MATCH, Power Query), US GAAP" was told
// "Excel · required · not shown"). And a credential the résumé says is not yet held is never shown ("CPA Candidate",
// "CPA EXAM — REG in progress" was shown "✓ CPA").
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runOptimizer } from './index.js';
import { normalizeSkill } from './normalizeSkills.js';
import { rolesFromText } from './extractResumeFacts.js';
import { notYetHeld } from './lineProof.js';

const ACCT = `Jordan Lee
Chicago, IL | jordan@example.com

SUMMARY
Staff accountant, CPA Candidate, 3 years in corporate accounting.

EXPERIENCE
Staff Accountant — Lakeshore Foods, Chicago, IL    2022 – Present
• Prepare month-end journal entries and balance sheet reconciliations

CPA EXAM
FAR and AUD passed; REG in progress

SKILLS
NetSuite, BlackLine, QuickBooks Online, Excel (advanced: pivot tables, INDEX/MATCH, Power Query), US GAAP, month-end close

EDUCATION
B.S. Accounting — DePaul University, 2022
`;
const JOB = 'Senior Accountant\n\nRequirements:\n• CPA required\n• 3+ years of accounting experience\n• Advanced Excel skills\n• Experience with NetSuite\n';

test('hidden-set accountant: Excel with a detail list is Excel; a CPA candidate is not a CPA', () => {
  const out = runOptimizer({ resumeText: ACCT, jobTitle: 'Senior Accountant', company: 'X', jobDescription: JOB });
  const excel = [...out.matched_requirements, ...out.unsupported_requirements].find((m) => m.requirement === 'excel');
  assert.ok(excel && excel.matched, 'Excel (advanced: …) shows Excel');
  const cpa = out.statements.find((s) => /^CPA/.test(s.text));
  assert.equal(cpa.status, 'partly', JSON.stringify(cpa));
  assert.match(cpa.missing.join(' '), /CPA — you list CPA Candidate/);
  assert.ok(cpa.evidence.every((e) => e.line), 'the line that says "candidate" is the evidence');
});

test('notYetHeld: candidate / exam / in progress / pursuing / expected / (learning) / familiar with', () => {
  assert.equal(notYetHeld('Staff accountant, CPA Candidate, 3 years', 'CPA'), 'CPA Candidate');
  assert.ok(notYetHeld('CPA EXAM', 'CPA'));
  assert.ok(notYetHeld('Pursuing PMP certification', 'PMP'));
  assert.ok(notYetHeld('RN (expected May 2027)', 'RN'));
  assert.ok(notYetHeld('Spanish (learning), English', 'Spanish'));
  assert.ok(notYetHeld('Familiar with Tableau', 'Tableau'));
  assert.equal(notYetHeld('Licensed CPA (Illinois), 2021', 'CPA'), null);
  assert.equal(notYetHeld('CPA, CMA', 'CPA'), null);
});

// every skills-line item of every persona / calibration / matching résumé, plain and with a trailing level, is found
// when a posting names it (an item the posting reader does not read at all is not this test's business)
const DIRS = ['../fixtures/personas', '../fixtures/calibration', '../fixtures/matching'];
test('skills-line items are found with or without a trailing parenthetical', () => {
  const misses = [];
  for (const d of DIRS) {
    const dir = new URL(`${d}/`, import.meta.url);
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.txt') && !/-jd\.txt$/.test(x))) {
      const text = fs.readFileSync(new URL(f, dir), 'utf8');
      const lines = text.split('\n');
      const i = lines.findIndex((l) => /^\s*(?:technical\s+)?skills\b/i.test(l.trim()) && l.trim().length < 40);
      if (i < 0) continue;
      const body = [];
      for (let k = i + 1; k < lines.length && lines[k].trim() && !/^[A-Z][A-Z &]{3,}$/.test(lines[k].trim()); k++) body.push(lines[k]);
      const items = body.join(',').split(/[,;|•]/).map((x) => x.replace(/^[^:]{2,20}:\s*/, '').replace(/\([^)]*\)?/g, '').trim()).filter((x) => x && x.split(/\s+/).length <= 4 && normalizeSkill(x));
      const title = (rolesFromText(text)[0] || {}).title || 'Specialist';
      for (const item of items) {
        const job = `Requirements:\n• Experience with ${item}\n• Ability to work with a team\n• High school diploma\n`;
        const run = (resume) => [...runOptimizer({ resumeText: resume, jobTitle: title, company: 'X', jobDescription: job }).matched_requirements];
        const plain = run(text);
        const read = runOptimizer({ resumeText: text, jobTitle: title, company: 'X', jobDescription: job });
        if (![...read.matched_requirements, ...read.unsupported_requirements].length) continue;
        if (!plain.length) misses.push(`${f}: ${item}`);
        for (const v of [' (advanced)', ' (basic)', ': daily use']) if (!run(text.replace(item, item + v)).length) misses.push(`${f}: ${item}${v}`);
      }
    }
  }
  assert.deepEqual(misses, []);
});

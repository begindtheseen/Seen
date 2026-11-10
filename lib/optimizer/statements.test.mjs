// Requirement statements — the unit a person reads (director, 2026-11-10). Pins the three postings the director read
// (SpaceX Equipment Maintenance Technician, Flex Director of Sales Solutions Engineering, Allara Payer Operations
// Specialist; texts in fixtures/statement-postings.json) and invariants over every fixture posting.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { extractJobFacts } from './extractJobFacts.js';
import { runOptimizer } from './index.js';
import { compressStatement } from './statements.js';
import { tokenize } from './lemma.js';

const SP = JSON.parse(fs.readFileSync(new URL('./fixtures/statement-postings.json', import.meta.url), 'utf8'));
const PAID = JSON.parse(fs.readFileSync(new URL('./fixtures/paid-tool-postings.json', import.meta.url), 'utf8')).postings;
const SAMPLE = JSON.parse(fs.readFileSync(new URL('../fixtures/personas/postings-sample.json', import.meta.url), 'utf8'));
const RESUME = fs.readFileSync(new URL('../fixtures/personas/electrician.txt', import.meta.url), 'utf8');
const texts = (p) => extractJobFacts(p.description, { jobTitle: p.title, company: p.company }).statements.map((s) => s.text);

const CONNECTIVES = new Set(['and', 'similar', 'plus', 'or', 'including', 'with', 'in', 'of', 'a', 'the', 'at', 'least', 'e.g']);
/** The invariants every statement list must hold (also run over 60 corpus postings by scripts/_rr_statements.mjs). */
export function statementProblems(p) {
  const facts = extractJobFacts(p.description, { jobTitle: p.title, company: p.company });
  const sts = facts.statements;
  const problems = [];
  const sources = new Set();
  for (const s of sts) {
    const src = new Set(tokenize(s.source).map((t) => t.raw));
    const extra = tokenize(s.text).map((t) => t.raw).filter((w) => !src.has(w) && !CONNECTIVES.has(w));
    if (extra.length) problems.push(`${s.id} words not in its line: ${extra.join(', ')} — "${s.text}"`);
    if (s.text.split(/\s+/).length < 3 && s.source.split(/\s+/).length >= 3) problems.push(`${s.id} under 3 words: "${s.text}" ← "${s.source.slice(0, 80)}"`);
    if (/(?:\b(?:and|or|of|in|with|to|for|at|by|the|a|an|as|from)|,)$/i.test(s.text)) problems.push(`${s.id} ends on a joiner: "${s.text}"`);
    if (sources.has(s.source)) problems.push(`${s.id} shares a source line`);
    sources.add(s.source);
  }
  for (const f of facts) {
    // meta: the title's own level, or a fact read from the title
    if (f.factType === 'seniority' || f.kind === 'seniority' || /^Job title:/i.test(f.evidence || '')) continue;
    if (!f.statementId) problems.push(`fact "${f.label}" has no statement (evidence "${String(f.evidence || '').slice(0, 60)}")`);
  }
  return problems;
}

test('SpaceX: the diploma, the years and the OR degree are ONE statement, and the years keep their object', () => {
  const t = texts(SP['37']);
  const edu = t.find((x) => /^High school diploma/.test(x));
  assert.ok(edu, t.join('\n'));
  assert.match(edu, /plus 3\+ years in a hands-on manufacturing environment or bachelor's degree in an engineering, math or science discipline/);
  assert.ok(!t.includes("Bachelor's degree"), 'a degree that is one way to meet a requirement is never its own line');
  assert.ok(!t.some((x) => /^(?:Manufacturing|Training|Forklift)$/.test(x)), t.join('\n'));
  // the degree with its OR is not a gate on its own: either way meets it
  const c = runOptimizer({ resumeText: RESUME, jobTitle: SP['37'].title, company: SP['37'].company, jobDescription: SP['37'].description });
  assert.ok(!c.hard_gates.some((g) => /bachelor/i.test(g.label)), JSON.stringify(c.hard_gates));
});

test('Flex: "10+ years in pre-sales…" is the requirement — never "4+ years" alone, never "SE", "BD", "IC"', () => {
  const p = SP['398'];
  const t = texts(p);
  assert.ok(t.some((x) => /^10\+ years in pre-sales, solutions engineering, or technical sales/.test(x)), t.join('\n'));
  assert.ok(!t.some((x) => /^4\+ years/.test(x)));
  for (const junk of ['SE', 'BD', 'IC', 'Sales', 'Onboarding']) assert.ok(!t.includes(junk), junk);
  const years = extractJobFacts(p.description, { jobTitle: p.title, company: p.company }).find((f) => f.factType === 'constraint' && f.kind === 'years');
  assert.equal(years.value, 10);
  // the company pitch is not a requirement
  assert.ok(!t.some((x) => /tip of the spear|As we expand|founding hire/i.test(x)), t.join('\n'));
});

test('Allara: an acronym is evidence inside its line ("…processes and SOPs"), never a line of its own', () => {
  const t = texts(SP['211']);
  assert.ok(!t.includes('SOPs') && !t.includes('SLA'), t.join('\n'));
  assert.ok(t.some((x) => /processes and SOPs/.test(x)), t.join('\n'));
  assert.ok(!t.some((x) => /Health Savings|disability coverage|wellness stipend|Parental leave/i.test(x)), 'benefits are never statements');
});

test('compression: lead-ins go, the level goes, examples are trimmed, nothing ends mid-phrase', () => {
  assert.equal(compressStatement('Demonstrated experience building or documenting processes and SOPs'), 'Building or documenting processes and SOPs');
  assert.equal(compressStatement('Formal people management experience is a strong plus'), 'Formal people management experience');
  assert.equal(compressStatement('Must be able to lift up to 50 lbs.'), 'Lift up to 50 lbs');
  assert.equal(compressStatement('The ideal candidate is comfortable working in a fast-paced cleanroom setting, has a wide array of complementary skills'), 'Comfortable working in a fast-paced cleanroom setting');
  assert.match(compressStatement('Operate material handling equipment including scissor lifts, forklifts, hand trucks, electric dollies, and hoists'), /hand trucks and similar$/);
  assert.equal(compressStatement('Read and safely execute lockout tagout (LOTO) procedures'), 'Read and safely execute lockout tagout procedures');
});

test('verdict: every statement has a status, evidence lines are the résumé as written', () => {
  const o = runOptimizer({ resumeText: RESUME, jobTitle: SP['37'].title, company: SP['37'].company, jobDescription: SP['37'].description });
  assert.ok(o.statements.length >= 5);
  for (const s of o.statements) {
    assert.ok(['shown', 'partly', 'not_shown', 'cannot_tell'].includes(s.status), s.status);
    for (const e of s.evidence) if (e.line) assert.ok(RESUME.includes(e.line.replace(/^[•\-*\s]+/, '').slice(0, 30)), e.line);
    if (s.status === 'partly') assert.ok(s.missing.length, `${s.text}: partly names what is not shown`);
  }
});

test('invariants over every fixture posting', () => {
  const all = [...Object.values(SP), ...Object.values(PAID), ...SAMPLE].filter((p) => p && p.description);
  assert.ok(all.length >= 15);
  const problems = all.flatMap((p) => statementProblems(p).map((x) => `${p.title}: ${x}`));
  assert.deepEqual(problems, []);
});

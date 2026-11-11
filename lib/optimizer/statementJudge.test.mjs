// Every duty / skill / requirement statement is JUDGED against the résumé's lines (R2, director 2026-11-10).
// The director's cases are pinned on their real postings (lib/optimizer/fixtures/statement-postings.json) and the
// warehouse persona.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runOptimizer } from './index.js';
import { extractJobFacts } from './extractJobFacts.js';
import { requirementSentences } from './postingSections.js';
import { statementConcepts } from './judgeStatement.js';

const SP = JSON.parse(fs.readFileSync(new URL('./fixtures/statement-postings.json', import.meta.url), 'utf8'));
const WAREHOUSE = fs.readFileSync(new URL('../fixtures/personas/warehouse.txt', import.meta.url), 'utf8');
const run = (p, resume = WAREHOUSE) => runOptimizer({ resumeText: resume, jobTitle: p.title, company: p.company, jobDescription: p.description });
const find = (out, re) => { const s = out.statements.find((x) => re.test(x.text)); assert.ok(s, `no statement ${re}\n${out.statements.map((x) => x.text).join('\n')}`); return s; };

test('Integrity Staffing × warehouse: scan/label and warehouse equipment are judged on the résumé lines', () => {
  const out = run(SP['305']);
  const scan = find(out, /^Scan and label inventory items/);
  assert.equal(scan.status, 'partly');
  assert.ok(scan.evidence.some((e) => /RF scanner/.test(e.line)), JSON.stringify(scan));
  // (V round 2: `missing` is the action as a phrase with what it acts on, never a lone verb)
  assert.deepEqual(scan.missing, ['labeling inventory items']);
  const eq = find(out, /^Operate and maintain warehouse equipment/);
  assert.equal(eq.status, 'shown');
  assert.match(eq.evidence[0].line, /forklift, reach truck, and pallet jack/);
  // (V round 4: the reason is the line said back in its own words; the row's text says which requirement it answers)
  assert.match(eq.evidence[0].why, /^you operate sit-down and stand-up forklift/);
});

test('SpaceX maintenance tech × warehouse: maintenance duties are NOT shown (never "?"), training-only is partly', () => {
  const out = run(SP['37']);
  for (const re of [/^Perform preventative maintenance/, /^Use schematics, hand tools/, /^Support root cause analysis/]) assert.equal(find(out, re).status, 'not_shown', re);
  const tpm = find(out, /^Conduct training for production personnel/);
  // (V round 2, coordinator priority 1: a maintenance-technician posting is a known different field for the warehouse
  // résumé, and "training" is a word every field uses — training new hires on a scanner is not training production staff on
  // total productive maintenance. It was partly; it is now not shown.)
  assert.equal(tpm.status, 'not_shown', JSON.stringify(tpm));
});

test('cannot_tell is only what a résumé cannot show, and says what to ask', () => {
  const out = run(SP['305']);
  const ct = out.statements.filter((s) => s.status === 'cannot_tell');
  assert.ok(ct.length > 0);
  for (const s of ct) assert.ok(s.ask && ['physical', 'schedule', 'eligibility', 'trait', 'language'].includes(s.ask.kind), JSON.stringify(s));
  assert.equal(find(out, /^Lift up to 50 pounds/).ask.kind, 'physical');
  assert.equal(find(out, /^(?:Strong )?organizational and time management skills/i).ask.kind, 'trait');
  const duties = out.statements.filter((s) => s.kind === 'duty');
  assert.ok(duties.filter((s) => s.status === 'cannot_tell').length / duties.length < 0.2, 'duties are judged');
});

test('SpaceX: everything under the flat "PREFERRED SKILLS AND EXPERIENCE:" heading is preferred', () => {
  const sts = extractJobFacts(SP['37'].description, { jobTitle: SP['37'].title, company: SP['37'].company }).statements;
  // (R4 whole units: the lines keep "of direct experience", "experience")
  for (const re of [/^6\+ years (?:of direct experience )?in semiconductor photolithography/, /^6\+ years (?:experience )?in deposition/, /^6\+ years (?:experience )?with high plasma/, /programmable logic controllers/, /parallel linear robots/i]) {
    const s = sts.find((x) => re.test(x.text));
    assert.ok(s, re);
    assert.equal(s.importance, 'preferred', s.text);
  }
  assert.equal(sts.find((x) => /^High school diploma/.test(x.text)).importance, 'required');
});

test('flat preferred headings switch the following lines to preferred until the next heading', () => {
  const cases = [
    'Requirements:\n• 3+ years of welding\n\nNice to have\n• TIG certification\n• Pipe welding\n\nBenefits\n• Dental',
    'Requirements: 3+ years of welding. Bonus Points: TIG certification. Pipe welding experience.',
    'REQUIREMENTS\n3+ years of welding\nDESIRED SKILLS\nTIG certification\nPipe welding experience',
    'Qualifications\n- 3+ years of welding\nPreferred Qualifications:\n- TIG certification\n- Pipe welding experience',
    'What you need: 3+ years of welding. PREFERRED SKILLS AND EXPERIENCE: TIG certification Pipe welding experience',
  ];
  for (const t of cases) {
    const rows = requirementSentences(t);
    const tig = rows.find((r) => /TIG/.test(r.sentence));
    const weld = rows.find((r) => /3\+ years/.test(r.sentence));
    assert.equal(tig && tig.importance, 'preferred', t);
    assert.equal(weld && weld.importance, 'required', t);
  }
});

test('a waiver is a promise, never a requirement, and is linked when the posting contradicts it', () => {
  const facts = extractJobFacts(SP['305'].description, { jobTitle: SP['305'].title, company: SP['305'].company });
  const p = facts.statements.find((s) => /^No experience required/.test(s.text));
  assert.equal(p.kind, 'promise');
  const req = facts.statements.find((s) => /^Minimum of 1 year/.test(s.text));
  assert.deepEqual(p.contradictedBy, [req.id]);
  const out = run(SP['305']);
  assert.ok(!out.statements.some((s) => /^No experience required/.test(s.text)), 'never judged');
  assert.ok(out.promises.some((x) => /^No experience required/.test(x.text)));
});

test('evidence never carries line: null — the education line and the dated roles are the evidence', () => {
  const out = run(SP['305']);
  for (const s of out.statements) for (const e of s.evidence) assert.ok(!('line' in e) || typeof e.line === 'string', JSON.stringify(s));
  const edu = find(out, /^High school diploma or a GED/);
  assert.match(edu.evidence[0].line, /Diploma 2016/);
  const yrs = find(out, /^Minimum of 1 year/);
  assert.ok(yrs.evidence.some((e) => /2021 - Present/.test(e.line)), JSON.stringify(yrs));
});

test('missing names only what the statement asks, in its own words, once', () => {
  const out = run(SP['37']);
  for (const s of out.statements) {
    assert.ok(!s.missing.some((m) => /fishbone|microsoft office/i.test(m)) || /Fishbone|Office/i.test(s.text), `${s.text}: ${s.missing}`);
    const low = s.missing.map((m) => m.toLowerCase());
    assert.equal(new Set(low).size, low.length);
  }
});

test('a years figure from the whole career never proves a subject the résumé does not show', () => {
  const s = find(run(SP['37']), /^6\+ years (?:of direct experience )?in semiconductor photolithography/);
  assert.equal(s.status, 'not_shown');
  assert.equal(s.evidence.length, 0);
});

test('a posting that covers several roles is read for the role in its title', () => {
  const t = 'We hire for two roles.\n\nRequirements for Cashiers:\n• 1 year of cash handling\n• POS experience\n\nRequirements for Stockers:\n• Forklift certification\n• Lift 50 lbs\n';
  assert.deepEqual(requirementSentences(t, { jobTitle: 'Cashier' }).map((r) => r.sentence), ['1 year of cash handling', 'POS experience']);
  assert.deepEqual(requirementSentences(t, { jobTitle: 'Stocker' }).map((r) => r.sentence), ['Forklift certification', 'Lift 50 lbs']);
  const lemon = extractJobFacts(SP['681'].description, { jobTitle: SP['681'].title, company: SP['681'].company }).statements.map((s) => s.text);
  assert.ok(!lemon.some((x) => /^We're placing/.test(x)), lemon.join('\n'));
  assert.ok(lemon.some((x) => /^2\+ years (?:of experience )?with Kubernetes/.test(x)), lemon.join('\n'));
});

test('a flat posting: bullets split at an abstract noun / heading, no company lead-ins (Morgan & Morgan)', () => {
  const t = extractJobFacts(SP['9'].description, { jobTitle: SP['9'].title, company: SP['9'].company }).statements.map((s) => s.text);
  assert.ok(t.includes('Guide plaintiff clients through the case process'), t.join('\n'));
  assert.ok(t.some((x) => /^Interaction with expert witnesses/.test(x)));
  assert.ok(t.some((x) => /^Law degree/.test(x)));
  assert.ok(!t.some((x) => /^Attorneys at Morgan/.test(x)));
});

test('concepts: generic words never carry a match; an instance proves its class; examples are alternatives', () => {
  assert.deepEqual(statementConcepts('Operate and maintain warehouse equipment').concepts.map((c) => c.classIds), [['warehouse-equipment']]);
  assert.equal(statementConcepts('Organizational and time management skills').trait, true);
  assert.equal(statementConcepts('Work independently and as part of a team').trait, true);
  const ex = statementConcepts('Operate material handling equipment including scissor lifts, forklifts, hand trucks').concepts;
  assert.equal(ex.length, 1);
  assert.ok(ex[0].examples.some((e) => e.includes('forklift')));
  // "power tools" is never proved by a line about power problems
  const out = runOptimizer({ resumeText: 'Sam\n\nEXPERIENCE\nHelper — Co, Mesa AZ    2020 - 2023\n- Diagnosed lighting and power problems in homes\n', jobTitle: 'Technician', company: 'X', jobDescription: 'Requirements:\n• Use power tools and hand tools\n• 2 years of experience\n• Valid license' });
  const s = out.statements.find((x) => /power tools/.test(x.text));
  assert.equal(s.status, 'not_shown', JSON.stringify(s));
});

test('no ReDoS: a heading lead-in repeated 5,000 times compresses in under 50 ms (CodeQL js/redos)', async () => {
  const { compressStatement } = await import('./statements.js');
  for (const t of ['SKILLS' + '\t\tDuties'.repeat(5000) + '!', 'a, '.repeat(5000) + 'and b', 'Skills: '.repeat(5000)]) {
    const a = performance.now();
    compressStatement(t);
    assert.ok(performance.now() - a < 50, `${JSON.stringify(t.slice(0, 20))} took ${performance.now() - a} ms`);
  }
});

test('hidden-set and audit classes: "minimal supervision" is no management ask; "for technology transfer" is asked', async () => {
  const { extractConstraints } = await import('./postingSections.js');
  assert.deepEqual(extractConstraints('Requirements:\n• Must possess the ability to multi-task, prioritize, and manage workload with minimal supervision').filter((c) => c.kind === 'management'), []);
  assert.ok(extractConstraints('Requirements:\n• Must have supervisory experience').some((c) => c.kind === 'management'));
  const out = runOptimizer({ resumeText: 'Ana\n\nSUMMARY\nTeam leadership, scheduling, customer service\n\nEXPERIENCE\nTeam Lead — Target, Phoenix AZ    2018 - 2024\n- Led a team of 14\n', jobTitle: 'MSAT Engineer', company: 'X', jobDescription: 'Responsibilities\n• Provide technical leadership for technology transfer from internal teams\n• Draft cGMP documentation\nRequirements\n• Bachelor degree in engineering' });
  const s = out.statements.find((x) => /technology transfer/.test(x.text));
  assert.notEqual(s.status, 'shown', JSON.stringify(s));
});

test('one common word never makes a statement partly ("Laboratory skills (… cleaning …)" ← "clean record")', () => {
  const out = runOptimizer({ resumeText: 'Sam\n\nEXPERIENCE\nElectrician — Co, Mesa AZ    2018 - 2024\n- Valid AZ driver\'s license, clean record\n', jobTitle: 'Optical Engineer', company: 'X', jobDescription: 'Requirements\n• Laboratory skills (e.g. assembly, alignment, cleaning)\n• 5+ years designing optical systems\n• Zemax' });
  const s = out.statements.find((x) => /^Laboratory skills/.test(x.text));
  assert.equal(s.status, 'not_shown', JSON.stringify(s));
});

test('the verdict and the statements agree: a matched requirement never sits in a not-shown statement (every fixture pair)', () => {
  const SAMPLE = JSON.parse(fs.readFileSync(new URL('../fixtures/personas/postings-sample.json', import.meta.url), 'utf8'));
  const bad = [];
  for (const c of SAMPLE) {
    const resume = fs.readFileSync(new URL(`../fixtures/personas/${c.persona}.txt`, import.meta.url), 'utf8');
    const out = runOptimizer({ resumeText: resume, jobTitle: c.title, company: c.company, jobDescription: c.description });
    const byId = new Map(out.statements.map((s) => [s.id, s]));
    for (const m of out.matched_requirements) { const s = byId.get(m.statementId); if (s && s.status === 'not_shown') bad.push(`${c.id}: matched ${m.requirement} in not_shown "${s.text}"`); }
    // an all-matched line is shown unless a named part is missing
    for (const s of out.statements) if (s.status === 'not_shown' && s.evidence.length) bad.push(`${c.id}: not_shown with evidence "${s.text}"`);
  }
  assert.deepEqual(bad, []);
});

// The statement judge reads ACTION + OBJECT (engineer V, 2026-11-10). Every pin below is a real case from the Interview Prep
// read-aloud (director/reports/p2-compose.md "Six packs read aloud") or the verdict gold audit; the invariants run over every
// persona × sample posting.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runOptimizer } from './index.js';
import { statementConcepts, sharesSpecific, traitLed, coreEnd, settleItems } from './judgeStatement.js';
import { credentialLine, proofLines } from './lineProof.js';

const P = new URL('../server/fixtures/prep/', import.meta.url);
const F = new URL('../fixtures/personas/', import.meta.url);
const read = (base, f) => fs.readFileSync(new URL(f, base), 'utf8');
const run = (resume, posting) => runOptimizer({ resumeText: resume, jobDescription: posting });
const find = (out, re) => { const s = out.statements.find((x) => re.test(x.text)); assert.ok(s, `no statement ${re}\n${out.statements.map((x) => x.text).join('\n')}`); return s; };
const first = (s) => ((s.evidence || []).find((e) => e.line) || {}).line || '';

test('false gaps: the same action and object in other words are shown', () => {
  const grad = run(read(P, 'new-grad.txt'), read(P, 'analyst-posting.txt'));
  const present = find(grad, /^Present findings/);
  assert.equal(present.status, 'shown', JSON.stringify(present));
  assert.match(first(present), /Presented churn findings/);

  const rn = run(read(F, 'rn-home-health.txt'), read(P, 'rn-navigator-posting.txt'));
  const educate = find(rn, /^Educate patients and families/);
  assert.equal(educate.status, 'shown', JSON.stringify(educate));
  assert.match(first(educate), /patient teaching/);

  const wh = run(read(F, 'warehouse.txt'), read(P, 'warehouse-agency-posting.txt'));
  const clean = find(wh, /^Keep the warehouse clean/);
  assert.equal(clean.status, 'shown', JSON.stringify(clean));
  assert.match(first(clean), /Kept work area clean and followed 5S/);
  const records = find(wh, /^Maintain accurate inventory records/);
  assert.equal(records.status, 'shown', JSON.stringify(records));
  assert.match(first(records), /cycle counts/);

  const lead = run(read(P, 'support-lead.txt'), read(P, 'trainer-posting.txt'));
  const materials = find(lead, /^Create or improve training materials/);
  assert.notEqual(materials.status, 'not_shown', JSON.stringify(materials));
  assert.match(first(materials), /help center articles/);
  // what is still missing is the statement's own words, and never what the line shows
  assert.ok(materials.missing.every((m) => !/training materials/i.test(m)), JSON.stringify(materials.missing));
});

test('proof ranking: the line that does the thing, never a skills word, a teaching-others line or a degree', () => {
  const lead = run(read(P, 'support-lead.txt'), read(P, 'trainer-posting.txt'));
  const nh = find(lead, /^Deliver new-hire training/);
  assert.equal(nh.status, 'shown', JSON.stringify(nh));
  assert.match(first(nh), /Interview and onboard new agents/);
  const coach = find(lead, /^Coach agents/);
  assert.match(first(coach), /1:1s and monthly call reviews/);
  assert.doesNotMatch(first(coach), /^Zendesk/);

  const lead2 = run(read(P, 'support-lead-2.txt'), read(P, 'trainer-posting-2.txt'));
  const fb = find(lead2, /one-on-one performance feedback/);
  assert.equal(fb.status, 'shown', JSON.stringify(fb));
  assert.match(first(fb), /1:1s/);

  const rn = run(read(F, 'rn-home-health.txt'), read(P, 'rn-navigator-posting.txt'));
  assert.match(first(find(rn, /Arizona RN license/)), /Active RN license \(AZ, compact\)/);
});

test('the action alone is nothing: "Checked deliveries against invoices" does not check food quality', () => {
  const cook = run(read(P, 'line-cook.txt'), read(P, 'kitchen-lead-posting.txt'));
  const q = find(cook, /^Check food quality/);
  // (the cook plates dishes, so the same-field prior may call it partly — never on the deliveries line, never shown)
  assert.notEqual(q.status, 'shown', JSON.stringify(q));
  assert.ok(!(q.evidence || []).some((e) => /deliveries/.test(e.line || '')), JSON.stringify(q));
  // the missing part is the object, never the verb the résumé does with something else
  assert.ok(!q.missing.some((m) => /^check$/i.test(m)), JSON.stringify(q.missing));
  // "Train and coach new cooks" is one activity: "Train new line cooks" shows it
  assert.equal(find(cook, /^Train and coach new cooks/).status, 'shown');
});

test('a volunteer coach does not coach therapists; a PTA licence is not a PT licence', () => {
  const resume = 'Kevin Diaz\nStaunton, VA\n\nEXPERIENCE\nPhysical Therapist Assistant | Valley Ortho | 2021–present\n- Carry out treatment plans written by the supervising PT for 14-18 patients a day\n\nLICENSES\nVirginia Physical Therapist Assistant license (active)\n\nVOLUNTEER\nVolunteer coach, youth soccer\n';
  const out = run(resume, 'Responsibilities:\n• Mentor, coach, and support therapists and therapy assistants to enhance performance\n\nRequirements:\n• Active state license as a Physical Therapist (PT) or Occupational Therapist (OT)\n• Prior outpatient orthopedic experience\n');
  assert.equal(find(out, /^Mentor, coach/).status, 'not_shown');
  assert.notEqual(find(out, /^Active state license as a Physical Therapist/).status, 'shown');
});

test('structure: qualifiers, light verbs, coordinated verbs and the "keep it clean" shape', () => {
  const kinds = (t) => statementConcepts(t).concepts.map((c) => `${c.kind}:${c.surface}`);
  // who it is for and how are not asked
  assert.deepEqual(kinds('Present findings to operations and clinical leaders in plain language'), ['verb:present', 'object:findings']);
  // a light verb before an action noun adds nothing
  assert.deepEqual(kinds('Deliver new-hire training for classes of 10-15 customer service agents, from day one through nesting'), ['object:new-hire training']);
  // "Keep the warehouse clean" is the action clean on a place; the state words map to their verb
  assert.deepEqual(kinds('Keep the warehouse clean and organized'), ['verb:clean', 'object:warehouse']);
  assert.deepEqual(kinds('Keep shelves stocked and organized'), ['verb:stock', 'object:shelves']);
  // "Create or improve" is one action
  assert.equal(kinds('Create or improve training materials, job aids and e-learning modules')[0], 'verb:Create or improve');
  // the employer's own name is not something a résumé shows
  assert.ok(!kinds('Support and adhere to CSI’s cash/money handling and accountability processes').some((k) => /CSI/.test(k)));
});

test('trait-led statements are the person\'s to say; duties are judged', () => {
  for (const t of ['Detail-oriented and disciplined when executing long-duration testing', 'Time management and multitasking', 'You demonstrate a strong bias toward action and initiative', 'Comfortable pushing a fast but sustainable pace']) assert.equal(traitLed(t), true, t);
  for (const t of ['Troubleshoot test-system failures', 'Organize and store inventory in a safe and efficient manner', 'Collaborate with engineering teams to integrate models into business workflows']) assert.equal(traitLed(t), false, t);
});

test('the gist: a shown core carries the line; a missing core item keeps it partly', () => {
  assert.equal('Present findings to technical and nontechnical audiences, explain trade-offs, and recommend clear next steps'.slice(0, coreEnd('Present findings to technical and nontechnical audiences, explain trade-offs, and recommend clear next steps')), 'Present findings to technical and nontechnical audiences');
  const t = 'Maintain accurate records of shipments, permits, and delivery receipts';
  assert.equal(coreEnd(t), t.length);
  const items = [{ got: 2, display: 'present' }, { got: 2, display: 'findings' }, { got: 0, display: 'explain trade-offs' }, { got: 0, display: 'recommend clear next steps' }];
  assert.equal(settleItems('Present findings to leaders, explain trade-offs, and recommend clear next steps', items).length, 2);
  const core = [{ got: 2, display: 'shipments' }, { got: 0, display: 'permits' }, { got: 2, display: 'delivery receipts' }];
  assert.equal(settleItems(t, core).length, 3);
});

test('credential line: the licence itself, by state name or postal code, never the degree', () => {
  const r = read(F, 'rn-home-health.txt');
  assert.match(credentialLine(r, 'Arizona RN license'), /Active RN license \(AZ, compact\)/);
  assert.equal(credentialLine('Jo\n\nEDUCATION\nB.S. Nursing — Arizona State University, 2019\n', 'Arizona RN license'), null);
});

// ── invariants over every persona × sample posting ───────────────────────────────────────────────────────────
const personas = fs.readdirSync(F).filter((f) => f.endsWith('.txt') && !f.includes('-jd')).map((f) => [f, read(F, f)]);
const sample = JSON.parse(read(F, 'postings-sample.json'));
const all = [];
for (const [name, resume] of personas) for (const p of sample) all.push({ name, resume, out: runOptimizer({ resumeText: resume, jobDescription: p.description, jobTitle: p.title }), posting: p.id });
const gateWhy = (s) => (s.evidence || []).some((e) => /^[A-Z]/.test(e.why || ''));

test('invariant: no "shown" rests on generic words only', () => {
  const bad = [];
  for (const { name, posting, out } of all) for (const s of out.statements) {
    if (s.status !== 'shown' || gateWhy(s)) continue;
    const lines = (s.evidence || []).map((e) => e.line).filter(Boolean);
    const role = (l) => proofLines(all.find((x) => x.name === name).resume).some((x) => x.text === l && x.kind === 'role');
    if (lines.length && !lines.some((l) => sharesSpecific(s.text, l) || role(l))) bad.push(`${name}×${posting}: ${s.text} ← ${lines[0]}`);
  }
  assert.deepEqual(bad, []);
});

test('invariant: a duty is never proved by an education or certification line, and a header proves only its title', () => {
  const bad = [];
  for (const { name, resume, out, posting } of all) {
    const pl = proofLines(resume);
    for (const s of out.statements) {
      if (s.kind !== 'duty' || !['shown', 'partly'].includes(s.status) || gateWhy(s)) continue;
      const l = pl.find((x) => x.text === first(s));
      if (l && (l.kind === 'education' || l.kind === 'header')) bad.push(`${name}×${posting}: ${s.text} ← ${l.text}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('invariant: `missing` never names something the cited line shows in full', () => {
  const bad = [];
  const STOP = new Set('and or of to in on at by for with the a an your our their from as is are be'.split(' '));
  for (const { name, out, posting } of all) for (const s of out.statements) {
    if (s.status !== 'partly' || gateWhy(s)) continue;
    const line = (s.evidence || []).map((e) => e.line).filter(Boolean).join(' ').toLowerCase();
    for (const m of s.missing || []) {
      const ws = (String(m).toLowerCase().match(/[a-z0-9+#]+/g) || []).filter((w) => w.length > 2 && !STOP.has(w));
      if (ws.length && ws.every((w) => new RegExp(`\\b${w}\\b`).test(line))) bad.push(`${name}×${posting}: ${s.text} — missing "${m}" ← ${line.slice(0, 80)}`);
    }
  }
  assert.deepEqual(bad, []);
});

// ── round 2: a candidate is a question, never an assertion; `why` and `missing` are phrases ───────────────────────
test('candidate: the closest doing line is asked, never asserted — and never for a licence', () => {
  const r = read(F, 'rn-home-health.txt');
  const out = run(r, read(P, 'rn-navigator-posting.txt'));
  for (const s of out.statements) {
    if (!s.candidate) continue;
    assert.ok(['not_shown', 'partly'].includes(s.status), JSON.stringify(s));
    assert.ok(!(s.evidence || []).some((e) => e.line === s.candidate.line), 'a candidate is not a line already cited');
    assert.ok(!/licen[sc]e|certif/i.test(s.text), 'no candidate for a licence');
    const l = proofLines(r).find((x) => x.text === s.candidate.line);
    assert.ok(l && l.kind !== 'education' && l.kind !== 'skills' && l.kind !== 'role', `${s.text} ← ${s.candidate.line}`);
    assert.ok(s.candidate.why === '' || /^your line says you /.test(s.candidate.why), s.candidate.why);
  }
  // nothing close → no question (a line must really share the action or a specific thing)
  const cook = run(read(P, 'line-cook.txt'), read(P, 'kitchen-lead-posting.txt'));
  assert.equal(find(cook, /^Lead the line/).candidate, undefined);
});

test('why and missing are phrases a recruiter would say, never joined tokens', () => {
  const lead = run(read(P, 'support-lead.txt'), read(P, 'trainer-posting.txt'));
  // (round 4: the reason is the LINE said back in its own words)
  assert.equal(find(lead, /^Create or improve training materials/).evidence[0].why, "you wrote 40+ help center articles and the team's de-escalation playbook");
  const wh = run(read(F, 'warehouse.txt'), read(P, 'warehouse-agency-posting.txt'));
  assert.deepEqual(find(wh, /^Receive and put away inventory/).missing, ['receiving inventory', 'putting away inventory']);
  for (const { out } of all) for (const s of out.statements) for (const e of s.evidence || []) {
    if (!e.why || /^[A-Z]/.test(e.why)) continue;
    assert.doesNotMatch(e.why, /\b(\w+) and \1\b|\band and\b|\bshows (?:and|or)\b/, `${s.text}: ${e.why}`);
  }
});

// ── round 3: same-field people are credited; a tool shown in part keeps the core ───────────────────────────────
test('people management has people as its object; a tool listed as basic still counts toward the core', () => {
  const maria = read(F, 'maria.txt');
  const m = run(maria, 'Responsibilities:\n• Lead, train and develop associates; hold the team accountable to standards and goals\n• Run the register\n• Keep the floor stocked\n');
  assert.notEqual(find(m, /^Lead, train and develop associates/).status, 'not_shown');
  const tasha = read(F, 'tasha.txt');
  const t = run(tasha, `${read(F, 'tasha-topstep-jd.txt')}\n- Experience with Google Analytics and weekly reporting on campaign performance is required.`);
  assert.notEqual(find(t, /^Experience with Google Analytics and weekly reporting/).status, 'not_shown');
});

// ── round 4: the obvious fit is credited, and every reason is a clause a person would say ─────────────────────────
test('the worked example: a shift supervisor against a shift-lead posting', () => {
  const W = '/tmp/claude-0/-home-user-Seen/b30eccfc-31e3-5e58-94c8-e02565dad614/scratchpad/director/gold/worked/';
  if (!fs.existsSync(`${W}resume-shift-supervisor.txt`)) return;
  const out = runOptimizer({ resumeText: fs.readFileSync(`${W}resume-shift-supervisor.txt`, 'utf8'), jobDescription: fs.readFileSync(`${W}posting-shift-lead.txt`, 'utf8'), jobTitle: 'Shift Lead', company: 'Copper Kettle Kitchen' });
  for (const re of [/^Run the shift/, /^Train new team members/, /^Open or close the restaurant/, /^Resolve guest complaints/]) assert.equal(find(out, re).status, 'shown', re);
  for (const re of [/^Help with weekly inventory counts/, /^Follow county health code/, /^Operate the POS/]) assert.equal(find(out, re).status, 'partly', re);
  assert.match(find(out, /^Run the shift/).evidence[0].why, /^you run the afternoon shift/);
});

test('invariant: a shown or partly statement carries a résumé line; no reason or missing is a broken shape', () => {
  const bad = [];
  for (const { name, posting, out } of all) for (const s of out.statements) {
    if (['shown', 'partly'].includes(s.status) && !(s.evidence || []).some((e) => e.line)) bad.push(`${name}×${posting}: no line for ${s.status} "${s.text}"`);
    for (const t of [...(s.evidence || []).map((e) => e.why || ''), ...(s.missing || []), s.candidate ? s.candidate.why : ''])
      if (/\bit does \w+ on \w+$|\bit mentions \w+$|^shows [a-z]+$|\b\w+(?:tening|eding)\b/.test(t)) bad.push(`${name}×${posting}: "${t}"`);
  }
  assert.deepEqual(bad, []);
});

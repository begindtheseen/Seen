// judge2 — the clean-room statement judge, run through runOptimizer's `statementJudge` seam.
// Invariants every judge must keep (the same ones the product judge keeps), the reading rules, and a few real sentences.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runOptimizer } from '../index.js';
import { applyConfirmations } from '../confirmations.js';
import { statementVerdicts, THRESHOLDS } from './index.js';
import { readStatement } from './reading.js';
import { readResume } from './resume.js';
import { spanOf } from './phrase.js';
import { spec, hasIdf } from './idf.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const persona = (f) => fs.readFileSync(path.join(ROOT, 'lib/fixtures/personas', f), 'utf8');
const SAMPLE = JSON.parse(fs.readFileSync(path.join(ROOT, 'lib/fixtures/personas/postings-sample.json'), 'utf8'));
const POSTINGS = (Array.isArray(SAMPLE) ? SAMPLE : Object.values(SAMPLE)).filter((p) => p && p.description).slice(0, 8);
const RESUMES = ['maria.txt', 'tasha.txt', 'dev.txt', 'nurse.txt', 'warehouse.txt', 'electrician.txt', 'accountant.txt', 'admin.txt'].map((f) => [f, persona(f)]);
const J = { statementJudge: statementVerdicts };

const SHIFT_RESUME = `Daniela Ortiz
Mesa AZ | 480-555-0142 | dani.ortiz@example.com

EXPERIENCE
Shift Supervisor, Dutch Bros Coffee - Mesa, AZ 2022 - present
- Run the afternoon shift, 6 to 8 broistas, on a double drive thru doing 900+ cars on a busy day
- Count the drawers and do the nightly deposit, usually under $3 variance
- Train every new hire on bar, window and the POS (Toast)
- Weekly order for milk, cups and syrups, cut waste about 15% by changing pars
- handle customer complaints and remakes

EDUCATION
Dobson High School 2018

SKILLS
Toast POS, cash handling, scheduling (HotSchedules), inventory, Spanish (fluent), food handlers card (Maricopa County)`;
const SHIFT_POSTING = `Responsibilities:
• Run the shift: assign stations, call breaks and keep ticket times under 6 minutes
• Train new team members on each station and coach the crew during service
• Help with weekly inventory counts
• Resolve guest complaints on the spot and remake orders when we get it wrong
Requirements:
• Cash handling experience
• Comfortable with a POS system
• Able to work nights, weekends and holidays
• Able to stand for a full shift and lift 40 pounds`;

test('the seam: runOptimizer uses options.statementJudge, and the default is unchanged', () => {
  const input = { resumeText: SHIFT_RESUME, jobTitle: 'Shift Lead', company: 'Copper Kettle Kitchen', jobDescription: SHIFT_POSTING };
  let called = 0;
  const spy = (...a) => { called++; return statementVerdicts(...a); };
  runOptimizer(input, { statementJudge: spy });
  assert.equal(called, 1);
  const a = runOptimizer(input);
  const b = runOptimizer(input, { statementJudge: 'not a function' });
  assert.equal(JSON.stringify(a), JSON.stringify(b), 'a non-function judge is ignored');
});

test('every row has the shape the screens read', () => {
  const out = runOptimizer({ resumeText: SHIFT_RESUME, jobTitle: 'Shift Lead', company: 'Copper Kettle Kitchen', jobDescription: SHIFT_POSTING }, J);
  assert.ok(out.statements.length >= 6);
  for (const s of out.statements) {
    for (const k of ['id', 'text', 'status', 'evidence', 'missing', 'kind', 'importance', 'confidence', 'display']) assert.ok(k in s, `${k} on ${s.text}`);
    assert.ok(['shown', 'partly', 'not_shown', 'cannot_tell'].includes(s.status));
    assert.ok(Array.isArray(s.evidence) && Array.isArray(s.missing));
    if (s.status === 'cannot_tell') assert.ok(s.ask && s.ask.kind && s.ask.text, 'a question carries what to ask');
    if (s.candidate) assert.ok(s.candidate.line && s.candidate.why);
  }
  assert.equal(typeof out.fit_score, 'number');
});

test('the worked example: the line that does the thing is credited, a narrower one is partly, never shown from another object', () => {
  const out = runOptimizer({ resumeText: SHIFT_RESUME, jobTitle: 'Shift Lead', company: 'Copper Kettle Kitchen', jobDescription: SHIFT_POSTING }, J);
  const st = (re) => out.statements.find((s) => re.test(s.text));
  const run = st(/^Run the shift/);
  assert.ok(['shown', 'partly'].includes(run.status));
  assert.match(run.evidence[0].line, /^Run the afternoon shift/);
  assert.match(run.evidence[0].why, /^you run the afternoon shift/);
  const train = st(/^Train new team members/);
  assert.ok(['shown', 'partly'].includes(train.status));
  assert.match(train.evidence[0].line, /^Train every new hire/);
  // counting drawers is not counting inventory: at most partly
  assert.notEqual(st(/inventory counts/).status, 'shown');
  assert.equal(st(/^Resolve guest complaints/).status, 'shown');
  assert.equal(st(/nights, weekends/).status, 'cannot_tell');
  assert.equal(st(/lift 40 pounds/).status, 'cannot_tell');
});

test('a junior credential never shows the senior one; the credential itself does', () => {
  const resume = 'Kevin O\'Hara\nStaunton, VA | kevin@example.com\n\nPhysical Therapist Assistant | Valley Ortho, Staunton VA | 2021–present\n- Carry out treatment plans written by the supervising PT\n\nLICENSE\nVirginia Physical Therapist Assistant license #2309-118 (active)';
  const rows = statementVerdicts([
    { id: 'a', text: 'Active state license as a Physical Therapist (PT) or Occupational Therapist (OT)', kind: 'requirement', importance: 'required' },
    { id: 'b', text: 'Active Virginia Physical Therapist Assistant license', kind: 'requirement', importance: 'required' },
  ], [], [], [], { resumeText: resume, jobTitle: 'Physical Therapist' });
  assert.equal(rows[0].status, 'not_shown');
  assert.equal(rows[1].status, 'shown');
  assert.match(rows[1].evidence[0].line, /license #2309/);
});

test('invariants over persona × posting pairs: credit carries a résumé line; missing is whole words of the statement', () => {
  let rowsSeen = 0;
  for (const [, resume] of RESUMES) {
    const lines = new Set(readResume(resume).lines.map((l) => l.text));
    for (const p of POSTINGS) {
      const out = runOptimizer({ resumeText: resume, jobTitle: p.title, company: p.company, jobDescription: p.description }, J);
      for (const s of out.statements) {
        rowsSeen++;
        if (s.status === 'shown' || s.status === 'partly') {
          assert.ok(s.evidence.some((e) => e.line), `credit with no line: ${s.text}`);
          for (const e of s.evidence) if (e.line && !e.why.startsWith('You')) assert.ok(lines.has(e.line) || resume.includes(e.line), `a cited line is a line of the résumé: ${e.line}`);
          for (const e of s.evidence) assert.ok(String(e.why || '').trim(), `an empty why beside ${s.text}`);
        }
        const words = new Set((s.text.toLowerCase().match(/[a-z0-9+#]+/g) || []));
        for (const m of s.missing) {
          if (/ — you list | beyond /.test(m)) continue;
          const ws = String(m).toLowerCase().match(/[a-z0-9+#]+/g) || [];
          // (a gate's own label may word it its own way; the line judge's phrases are cut from the statement)
          const fromGate = out.constraints.some((c) => c.statementId === s.id);
          if (!fromGate) for (const w of ws) assert.ok(words.has(w), `"${m}" is not in "${s.text}"`);
        }
      }
    }
  }
  assert.ok(rowsSeen > 100);
});

test('the person\'s answers run after the judge, unchanged', () => {
  const input = { resumeText: SHIFT_RESUME, jobTitle: 'Shift Lead', company: 'Copper Kettle Kitchen', jobDescription: SHIFT_POSTING };
  const out = runOptimizer(input, J);
  const ask = out.statements.find((s) => s.status === 'cannot_tell');
  const r = applyConfirmations(out.statements, out.constraints, [{ statementId: ask.id, answer: 'yes' }], { resumeText: SHIFT_RESUME });
  const s = r.statements.find((x) => x.id === ask.id);
  assert.deepEqual([s.status, s.by], ['shown', 'you']);
  const r2 = runOptimizer({ ...input, confirmed: [{ statementId: ask.id, answer: 'yes' }] }, J);
  assert.equal(r2.statements.find((x) => x.id === ask.id).by, 'you');
});

test('reading: frames, light verbs, the head of a noun phrase, details, clauses', () => {
  const r = (t, kind = 'duty') => readStatement(t, { kind }).clauses;
  const run = r('Run the shift: assign stations, call breaks and keep ticket times under 6 minutes');
  assert.deepEqual([run[0].actions.map((u) => u.text), run[0].objects.filter((o) => o.head).map((o) => o.text)], [['run'], ['shift']]);
  assert.ok(run[0].details.some((d) => d.text === 'stations'), 'what comes after the colon is a detail');
  const cash = r('Cash handling experience', 'requirement');
  assert.deepEqual([cash[0].actions.map((u) => u.text), cash[0].objects.map((o) => o.text)], [['handling'], ['cash']]);
  const pos = r('Comfortable with a POS system', 'requirement');
  assert.deepEqual(pos[0].objects.filter((o) => o.head).map((o) => o.text), ['pos'], 'a generic head takes its meaning from the modifier');
  const conduct = r('Conduct comprehensive in-home assessments');
  assert.ok(!conduct[0].actions.some((a) => a.text === 'conduct'), 'a light verb is passed over');
  const two = r('Train new team members on each station and coach the crew during service');
  assert.equal(two.length, 2);
  assert.deepEqual(two[1].actions.map((u) => u.text), ['coach']);
  const keep = r('Keep the warehouse clean and organized');
  assert.ok(keep[0].actions.some((a) => a.text === 'clean'), 'the state word is the act');
  const owner = r('Support and adhere to CSI\'s cash/money handling and accountability processes');
  assert.ok(!owner[0].objects.some((o) => o.text === 'csi'), 'the employer in the possessive is not asked');
});

test('phrases: a missing span is whole words of the statement, never a slice across punctuation', () => {
  const t = 'Performs cashier duties, fills out settlement and deposit sheets correctly';
  assert.equal(spanOf(t, ['settlement', 'deposit', 'sheets']), 'settlement and deposit sheets');
  assert.equal(spanOf(t, ['cashier', 'settlement']), 'cashier');
  assert.equal(spanOf('Operates Spectralink/Zebra phone and iPad efficiently.', ['operates', 'phone'], { cross: true }), 'Operates Spectralink/Zebra phone');
  assert.equal(spanOf('Support and adhere to CSI’s cash handling', ['cash', 'handling']), 'cash handling');
});

test('the data and the thresholds: specificity reads generic words low and trade words high; thresholds are frozen numbers', () => {
  assert.ok(hasIdf());
  assert.ok(spec('experience') < 0.1 && spec('team') < 0.1 && spec('manage') < 0.15);
  assert.ok(spec('deposit') > 0.45 && spec('drawer') > 0.7);
  assert.ok(Object.isFrozen(THRESHOLDS));
  for (const v of Object.values(THRESHOLDS)) assert.ok(typeof v === 'number' && v > 0 && v < 1);
});

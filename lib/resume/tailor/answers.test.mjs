// Round 7 (director): "a question nobody can answer is a broken feature". For every question kind the paid package emits
// (detail, number in a line, tool, duty, knowledge, credential, dates), across real persona and calibration pairs, a
// table of 30+ plain human answers each ends in EITHER a composed line made only of the person's words plus the
// question's own stated frame, OR one sentence saying what it needs. Zero silent rejections.
// Run: node --test lib/resume/tailor/answers.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildPaidOptimize } from '../../server/optimizePackage.js';
import { composeAnswer, reasonToAsk } from './questions.js';
import { loadPairs } from '../../fixtures/calibration/load.mjs';
import { parseResume } from '../parse/index.js';
import { canonicalResumeText } from '../canonical.js';
import { KNOWN_VERBS } from '../health/verbs.js';
import { baseFromPast } from '../rewrite/inflect.js';
import { promptFor } from '../../../components/optimizer/applyChanges.js';

const dir = (d) => new URL(d, import.meta.url);
const RESUMES = [];
for (const d of ['../../fixtures/personas/', '../../fixtures/calibration/']) for (const f of fs.readdirSync(dir(d))) if (f.endsWith('.txt') && !/-jd\.txt$/.test(f)) RESUMES.push([f, fs.readFileSync(new URL(f, dir(d)), 'utf8')]);
const ALL_POSTINGS = JSON.parse(fs.readFileSync(dir('./fixtures/t3-postings.json'), 'utf8')).filter((p) => p && p.description);
const POSTINGS = ALL_POSTINGS.slice(0, 10);
// the director's worked pair carries the detail questions (ticket times, open/close, inventory counts)
const SHIFT = fs.readFileSync(dir('./paid.test.mjs'), 'utf8');
const SHIFT_RESUME = SHIFT.match(/const SHIFT_RESUME = `([\s\S]*?)`;/)[1];
const SHIFT_POSTING = SHIFT.match(/const SHIFT_POSTING = `([\s\S]*?)`;/)[1];

// plain answers a person types — numbers alone, with a period, shorthand, yes / no / both, schedules, sentences
const ANSWERS = [
  '40', 'about 40', 'about 40 a day', '40 a week', '40/week', '40 per shift', 'around 25 each week', '25 a wk', 'roughly 12 a month',
  'yes', 'yes, both', 'Yes, weekly', 'every Sunday', 'Mon–Fri', 'nights and weekends', 'under 4 minutes', 'about 3 min', '98%', '4.8/5', '$40K',
  'I usually do around 30 every week', 'we do about 25 cycle counts a week', 'Counted the walk-in and dry stock every Sunday',
  'Used it to schedule 12 people every week', 'for scheduling and payroll at the store', 'reconciled vendor accounts in it',
  'Trained 6 new hires on the register', 'I hold it, renewed in 2024', 'Jun 2021 – Mar 2023', '2019 - present',
  'not sure', 'no', 'kind of', 'sometimes, when the manager is out', 'DoorDash and our app',
];

let QS = null;
const RUNS = [];
function questions() {
  if (QS) return QS;
  QS = [];
  const add = (r) => { for (const q of (r && r.questions) || []) QS.push(q); };
  add(buildPaidOptimize({ resume: SHIFT_RESUME, jobDescription: SHIFT_POSTING, job: 'Shift Lead', company: 'Copper Kettle Kitchen' }));
  // the calibration set (70 labelled pairs, different-field controls included) — every kind the package emits
  for (const p of loadPairs()) {
    const r = buildPaidOptimize({ resume: p.resume, jobDescription: p.job.description, job: p.job.title, company: p.job.company });
    RUNS.push({ p, r });
    add(r);
  }
  // the warehouse × food-safety pair carries the fourth detail facet
  const byId = new Map(ALL_POSTINGS.map((x) => [x.id, x]));
  const w = (RESUMES.find(([n]) => n === 'warehouse.txt') || [])[1];
  const p35 = byId.get('t3-posting-035');
  if (w && p35) add(buildPaidOptimize({ resume: w, jobDescription: p35.description, job: p35.title, company: p35.company }));
  return QS;
}
const kindOf = (q) => (q.kind === 'detail' ? `detail:${q.facet}` : q.kind === 'metric' || q.unit === 'line' ? 'number' : q.kind === 'gap' ? `gap:${q.answerKind || q.answer_kind}` : q.kind);
const words = (t) => String(t || '').toLowerCase().split(/[^a-z0-9$%]+/).filter(Boolean);
// words a composer may add around the person's own: connectives and the fixed shapes the question states
const FRAME_WORDS = new Set(['a', 'an', 'the', 'and', 'or', 'of', 'for', 'in', 'on', 'at', 'to', 'with', 'per', 'under', 'around', 'about', 'minutes', 'seconds', 'used', 'handled', 'held', 'kept', 'keep', 'run', 'ran', 'count', 'counted', 'both', 'opening', 'closing', 'shifts', 'shift', 'inventory', 'cycle', 'counts', 'online', 'delivery', 'orders', 'food', 'safety', 'temperature', 'checks', 'handle']);
// a word of the person's in another form: "count" → "counted"/"counting", "train" → "trained"
const formOf = (w, pool) => pool.has(w) || [w.replace(/(?:ed|d|ing|s|es)$/, ''), w.replace(/ied$/, 'y'), w.replace(/(.)\1(?:ed|ing)$/, '$1')].some((b) => b.length >= 2 && (pool.has(b) || pool.has(`${b}e`) || [...pool].some((x) => x.replace(/(?:ed|d|ing|s|es)$/, '') === b)));

test('every question kind accepts a plain answer or says in one sentence what it needs — zero silent rejections', () => {
  const qs = questions();
  const byKind = new Map();
  for (const q of qs) { const k = kindOf(q); if (!byKind.has(k)) byKind.set(k, []); byKind.get(k).push(q); }
  for (const k of ['number', 'gap:tool', 'gap:activity', 'gap:knowledge', 'detail:inventory_count']) assert.ok(byKind.has(k), `no ${k} question in the sample`);
  assert.ok(byKind.size >= 6, `question kinds seen: ${[...byKind.keys()].join(', ')}`);
  let composed = 0, asked = 0;
  for (const [k, list] of byKind) {
    let perKind = 0;
    for (const q of list.slice(0, 4)) for (const a of ANSWERS) {
      perKind++;
      const r = composeAnswer(promptFor(q), a);
      assert.ok(r && (r.line || r.problem), `${k}: "${q.question}" + "${a}" → silent`);
      if (!r.line) { asked++; assert.ok(/[a-z]/i.test(r.problem) && r.problem.split(/(?<=[.?!])\s+/).length <= 2, `${k}: one sentence, got "${r.problem}"`); continue; }
      composed++;
      // a sentence with a verb (the person's or the frame's) — never a "Label: list" unless the person typed a colon
      const w0 = words(r.line)[0] || '';
      const verbLed = KNOWN_VERBS.has(w0) || !!baseFromPast(w0, KNOWN_VERBS) || /^(?:used|held|kept|ran|run|keep|count|counted|handle|handled|do|did)$/.test(w0) || q.kind === 'gap' && (q.answerKind || q.answer_kind) === 'credential';
      assert.ok(verbLed || q.unit === 'line', `${k}: "${r.line}" has no leading verb`);
      if (!/:/.test(a)) assert.ok(!/^[^:]{1,40}:\s/.test(r.line), `${k}: colon-glued "${r.line}"`);
      const pool = new Set([...words(a), ...words(q.template), ...words(q.line), ...words(q.before), ...words(q.nounWords), ...words(q.after), ...words(q.label), ...words(q.term), ...words(q.noun), ...FRAME_WORDS]);
      const extra = words(r.line).filter((w) => !formOf(w, pool) && !/^\d/.test(w));
      assert.deepEqual(extra, [], `${k}: "${q.question}" + "${a}" → "${r.line}"`);
    }
    assert.ok(perKind >= 30, `${k}: only ${perKind} answers tried`);
  }
  console.log(`kinds: ${[...byKind].map(([k, l]) => `${k}×${l.length}`).join(', ')} · composed ${composed} · asked ${asked}`);
  assert.ok(composed > 0 && asked > 0, `composed ${composed}, asked ${asked}`);
});

test('a two-blank number line takes one answer with its period, and asks for the period when it is missing', () => {
  const q = { kind: 'metric', unit: 'line', answerKind: 'number', line: 'Do cycle counts and help with receiving', slot: 'insert', before: 'Do', nounWords: 'cycle counts', after: 'and help with receiving', needsPeriod: true, template: 'Do [number] cycle counts [a shift / a week / a month] and help with receiving' };
  for (const a of ['25 a week', '25/week', '25 a wk', 'about 25 every week', 'we do 25 cycle counts a week', 'I usually do around 25 each week']) assert.match(composeAnswer(q, a).line, /^Do (?:about |around )?25 cycle counts a week and help with receiving\.$/, a);
  assert.match(composeAnswer(q, '25').problem, /how often/);
  assert.match(composeAnswer(q, 'yes').problem, /number/);
});

// round 8 (director): a gap question recovers what the résumé under-states — never work the person has never been near
test('every gap question has a reason to ask (a candidate line, a related role, or a doing line); different-field controls ask nothing', () => {
  questions();
  let gaps = 0, controls = 0;
  for (const { p, r } of RUNS) {
    const doc = parseResume({ text: canonicalResumeText(p.resume), source: 'text' });
    const gq = (r.questions || []).filter((q) => q.kind === 'gap' || q.kind === 'detail');
    if (p.label === 'different field') {
      controls++;
      assert.deepEqual(gq.map((q) => q.question), [], `${p.resume} × ${p.job.title}: a different-field control asked about duties`);
      assert.equal(r.charge.charge, false, `${p.resume} × ${p.job.title}: charged`);
      if (r.blocked && r.blocked.reason === 'different_field') assert.match(r.questions_note, /different line of work from your résumé — there is nothing to recover by rewording/);
      continue;
    }
    for (const q of gq.filter((x) => x.kind === 'gap')) {
      gaps++;
      const st = (r.statements || []).find((x) => x.id === q.statementId);
      assert.ok(st && reasonToAsk(st, doc, p.job.title), `${p.resume} × ${p.job.title}: "${q.question}" has no reason to ask`);
    }
  }
  assert.ok(controls >= 5 && gaps >= 10, `controls ${controls}, gap questions ${gaps}`);
});

test('an answer that does not answer makes no line: a bare list of names gets the one-sentence ask', () => {
  const duty = { kind: 'gap', answerKind: 'activity', label: 'scheduling', term: 'scheduling' };
  const r = composeAnswer(duty, 'DoorDash and our app');
  assert.equal(r.line, '');
  assert.match(r.problem, /^Say what you did with DoorDash and our app — for example what you set up or handled\.$/);
  assert.equal(composeAnswer(duty, 'I set the weekly driver schedule in HotSchedules').line, 'Set the weekly driver schedule in HotSchedules.');
  const tool = { kind: 'gap', answerKind: 'tool', label: 'CRM', term: 'CRM' };
  assert.equal(composeAnswer(tool, 'DoorDash and our app').line, '');
  assert.equal(composeAnswer(tool, 'for scheduling and payroll at the store').line, 'Used CRM for scheduling and payroll at the store.');
  // credential (no credential question appears in the calibration sample — the composer is pinned directly)
  const cred = { kind: 'gap', answerKind: 'credential', label: 'BLS certification', term: 'BLS certification' };
  assert.equal(composeAnswer(cred, 'yes').line, 'BLS certification');
  assert.ok(composeAnswer(cred, 'kind of').problem);
});

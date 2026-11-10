// Round 7 (director): "a question nobody can answer is a broken feature". For every question kind the paid package emits
// (detail, number in a line, tool, duty, knowledge, credential, dates), across real persona and calibration pairs, a
// table of 30+ plain human answers each ends in EITHER a composed line made only of the person's words plus the
// question's own stated frame, OR one sentence saying what it needs. Zero silent rejections.
// Run: node --test lib/resume/tailor/answers.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildPaidOptimize } from '../../server/optimizePackage.js';
import { composeAnswer } from './questions.js';
import { promptFor } from '../../../components/optimizer/applyChanges.js';

const dir = (d) => new URL(d, import.meta.url);
const RESUMES = [];
for (const d of ['../../fixtures/personas/', '../../fixtures/calibration/']) for (const f of fs.readdirSync(dir(d))) if (f.endsWith('.txt') && !/-jd\.txt$/.test(f)) RESUMES.push([f, fs.readFileSync(new URL(f, dir(d)), 'utf8')]);
const POSTINGS = JSON.parse(fs.readFileSync(dir('./fixtures/t3-postings.json'), 'utf8')).filter((p) => p && p.description).slice(0, 10);
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
function questions() {
  if (QS) return QS;
  QS = [];
  const add = (r) => { for (const q of (r && r.questions) || []) QS.push(q); };
  add(buildPaidOptimize({ resume: SHIFT_RESUME, jobDescription: SHIFT_POSTING, job: 'Shift Lead', company: 'Copper Kettle Kitchen' }));
  for (const [, resume] of RESUMES) for (const p of POSTINGS.slice(0, 4)) add(buildPaidOptimize({ resume, jobDescription: p.description, job: p.title, company: p.company }));
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
  assert.ok(byKind.size >= 4, `question kinds seen: ${[...byKind.keys()].join(', ')}`);
  let composed = 0, asked = 0;
  for (const [k, list] of byKind) {
    let perKind = 0;
    for (const q of list.slice(0, 4)) for (const a of ANSWERS) {
      perKind++;
      const r = composeAnswer(promptFor(q), a);
      assert.ok(r && (r.line || r.problem), `${k}: "${q.question}" + "${a}" → silent`);
      if (!r.line) { asked++; assert.ok(/[a-z]/i.test(r.problem) && r.problem.split(/(?<=[.?!])\s+/).length <= 2, `${k}: one sentence, got "${r.problem}"`); continue; }
      composed++;
      const pool = new Set([...words(a), ...words(q.template), ...words(q.line), ...words(q.before), ...words(q.nounWords), ...words(q.after), ...words(q.label), ...words(q.term), ...words(q.noun), ...FRAME_WORDS]);
      const extra = words(r.line).filter((w) => !formOf(w, pool) && !/^\d/.test(w));
      assert.deepEqual(extra, [], `${k}: "${q.question}" + "${a}" → "${r.line}"`);
    }
    assert.ok(perKind >= 30, `${k}: only ${perKind} answers tried`);
  }
  assert.ok(composed > 0 && asked > 0, `composed ${composed}, asked ${asked}`);
});

test('a two-blank number line takes one answer with its period, and asks for the period when it is missing', () => {
  const q = { kind: 'metric', unit: 'line', answerKind: 'number', line: 'Do cycle counts and help with receiving', slot: 'insert', before: 'Do', nounWords: 'cycle counts', after: 'and help with receiving', needsPeriod: true, template: 'Do [number] cycle counts [a shift / a week / a month] and help with receiving' };
  for (const a of ['25 a week', '25/week', '25 a wk', 'about 25 every week', 'we do 25 cycle counts a week', 'I usually do around 25 each week']) assert.match(composeAnswer(q, a).line, /^Do (?:about |around )?25 cycle counts a week and help with receiving\.$/, a);
  assert.match(composeAnswer(q, '25').problem, /how often/);
  assert.match(composeAnswer(q, 'yes').problem, /number/);
});

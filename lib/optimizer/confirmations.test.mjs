// The person's answers (lib/optimizer/confirmations.js): validation, every effect, the cache key, and runOptimizer
// byte-identical when no answers are sent. Real pair: the warehouse persona × Integrity Staffing's Warehouse Associate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { applyConfirmations, cleanConfirmations, confirmationsKey, MAX_CONFIRMATIONS } from './confirmations.js';
import { runOptimizer } from './index.js';
import { canonicalResumeText } from '../resume/canonical.js';
import { optimizeCacheKey } from '../server/optimizeCache.js';

const resume = fs.readFileSync(new URL('../fixtures/personas/warehouse.txt', import.meta.url), 'utf8');
const post = JSON.parse(fs.readFileSync(new URL('../fixtures/personas/postings-sample.json', import.meta.url), 'utf8')).find((p) => p.id === 'warehouse-associate-integrity');
const base = { resumeText: canonicalResumeText(resume), jobTitle: post.title, company: post.company, jobDescription: post.description };
const out = runOptimizer(base);
const shown = (out.statements || []).find((s) => s.status === 'shown');
const ask = (out.statements || []).find((s) => s.status === 'cannot_tell' && s.display !== false);
const cands = (out.statements || []).filter((s) => s.candidate && s.candidate.line && s.status !== 'shown');

test('the fixture has what the effects need: a shown line, a line only the person can answer, two candidate lines', () => {
  assert.ok(shown && ask && cands.length >= 2, JSON.stringify({ shown: !!shown, ask: !!ask, cands: cands.length }));
});

test('validation: wrong id, wrong line, another statement\'s candidate line, an answer that is not yes/no — all ignored and counted', () => {
  const bad = [
    { statementId: 's999', answer: 'yes' },
    { statementId: ask.id, answer: 'maybe' },
    { statementId: ask.id, answer: true },
    { statementId: cands[0].id, answer: 'yes', line: 'Managed a fleet of 40 delivery drones' },
    { statementId: cands[0].id, answer: 'yes', line: cands.find((c) => c.candidate.line !== cands[0].candidate.line)?.candidate.line || 'x' },
    { statementId: '<script>', answer: 'yes' },
    null, 'yes', 42,
  ];
  const r = applyConfirmations(out.statements, out.constraints, bad, { resumeText: base.resumeText });
  assert.equal(r.confirmations.applied, 0);
  assert.equal(r.confirmations.ignored, bad.length);
  assert.equal(r.statements, out.statements, 'nothing applied: the same arrays come back');
  assert.equal(r.constraints, out.constraints);
});

test('500 entries are bounded: at most MAX_CONFIRMATIONS kept, fast, the rest ignored', () => {
  const many = Array.from({ length: 500 }, (_, i) => ({ statementId: `s${i + 1}`, answer: i % 2 ? 'yes' : 'no' }));
  const t0 = Date.now();
  const r = applyConfirmations(out.statements, out.constraints, many, { resumeText: base.resumeText });
  assert.ok(Date.now() - t0 < 500);
  assert.ok(cleanConfirmations(many).length <= MAX_CONFIRMATIONS);
  assert.equal(r.confirmations.applied + r.confirmations.ignored, 500);
});

test('yes on a line only the person can answer → shown, by you, "You said yes."; its constraint is met', () => {
  const r = applyConfirmations(out.statements, out.constraints, [{ statementId: ask.id, answer: 'yes' }], { resumeText: base.resumeText });
  const s = r.statements.find((x) => x.id === ask.id);
  assert.deepEqual([s.status, s.by, s.evidence[0].why], ['shown', 'you', 'You said yes.']);
  const c = r.constraints.find((x) => x.statementId === ask.id);
  if (c) { assert.equal(c.status, 'met'); assert.equal(c.by, 'you'); assert.match(c.message, /^You said yes to /); }
});

test('no on a line only the person can answer → not shown, by you; its constraint is not met, in "You said …" words', () => {
  const r = applyConfirmations(out.statements, out.constraints, [{ statementId: ask.id, answer: 'no' }], { resumeText: base.resumeText });
  const s = r.statements.find((x) => x.id === ask.id);
  assert.deepEqual([s.status, s.by], ['not_shown', 'you']);
  assert.match(s.evidence[0].why, /^You said (?:you can't|no to)/);
  const c = r.constraints.find((x) => x.statementId === ask.id);
  if (c) { assert.equal(c.status, 'unmet'); assert.match(c.message, /^You said /); }
});

test('yes on a candidate → shown, by you, evidence = that résumé line; no → the candidate is removed and the status stays', () => {
  const [a, b] = cands;
  const r = applyConfirmations(out.statements, out.constraints, [{ statementId: a.id, answer: 'yes', line: `  ${a.candidate.line}  ` }, { statementId: b.id, answer: 'no', line: b.candidate.line }], { resumeText: base.resumeText });
  const sa = r.statements.find((x) => x.id === a.id), sb = r.statements.find((x) => x.id === b.id);
  assert.deepEqual([sa.status, sa.by, sa.evidence[0].why], ['shown', 'you', 'You said this line shows it.']);
  assert.ok(base.resumeText.split('\n').some((l) => l.replace(/\s+/g, ' ').trim() === sa.evidence[0].line), 'the evidence is a line of the résumé, as written');
  assert.equal(sa.candidate, undefined);
  assert.equal(sb.status, b.status); assert.equal(sb.candidate, undefined);
  assert.ok(!base.resumeText.includes('You said'), 'nothing is written into the résumé');
});

test('a statement the judge already shows is never changed by an answer', () => {
  const r = applyConfirmations(out.statements, out.constraints, [{ statementId: shown.id, answer: 'no' }], { resumeText: base.resumeText });
  assert.equal(r.confirmations.applied, 0);
  assert.deepEqual(r.statements.find((x) => x.id === shown.id), shown);
});

test('runOptimizer: no answers (absent or empty) → byte-identical verdict; answers → the counts, the gates and the sentence follow them', () => {
  assert.equal(JSON.stringify(runOptimizer({ ...base, confirmed: [] })), JSON.stringify(out));
  const confirmed = [{ statementId: ask.id, answer: 'yes' }, { statementId: cands[0].id, answer: 'yes', line: cands[0].candidate.line }];
  const r = runOptimizer({ ...base, confirmed });
  assert.deepEqual(r.confirmations, { applied: 2, ignored: 0 });
  assert.equal(r.requirement_count, out.requirement_count, 'answers change statuses, never what the posting lists');
  const shownN = (o) => o.statements.filter((s) => s.display !== false && s.status === 'shown').length;
  assert.equal(shownN(r), shownN(out) + 2);
  assert.ok(r.statements.filter((s) => s.by === 'you').length === 2);
});

test('the paid cache key carries the answers: a result built before an answer is never served after it', () => {
  const k = { uid: 'u', jobId: 'j', jobDescription: 'jd', resume: 'r' };
  assert.equal(optimizeCacheKey(k), optimizeCacheKey({ ...k, confirmed: [] }), 'no answers: the key results already stored use');
  const a = optimizeCacheKey({ ...k, confirmed: [{ statementId: 's2', answer: 'yes' }] });
  assert.notEqual(a, optimizeCacheKey(k));
  assert.notEqual(a, optimizeCacheKey({ ...k, confirmed: [{ statementId: 's2', answer: 'no' }] }));
  assert.equal(a, optimizeCacheKey({ ...k, confirmed: [{ statementId: 's2', answer: 'YES' }, { statementId: 's2', answer: 'yes' }] }), 'order and case do not matter');
  assert.equal(confirmationsKey([{ statementId: 's2', answer: 'maybe' }]), '', 'a malformed answer is no answer');
});

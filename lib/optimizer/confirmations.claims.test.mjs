// Claims (X, 2026-11-11): "I've done this" / "I hold this" on a line the reading calls not shown or partly. The reading can
// miss what a résumé says in other words or does not say at all; the person corrects it in one tap and every tool follows.
// Honesty invariants: a claimed row never carries a résumé line; no sentence says "your résumé shows / lists" for it; no
// answers → the reading is byte-identical; claims are validated and capped like every answer; the cache key carries them.
// Director's pair (worked example 1, a coffee-shop shift supervisor × a restaurant Shift Lead) is in lib/fixtures/crosstool.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { applyConfirmations, cleanConfirmations, confirmationsKey, MAX_CONFIRMATIONS, CLAIM_WHY, CLAIM_HOLD_WHY } from './confirmations.js';
import { runOptimizer } from './index.js';
import { optimizeCacheKey } from '../server/optimizeCache.js';
import { buildPaidOptimize } from '../server/optimizePackage.js';
import { localPack } from '../server/prepLocal.js';

const D = new URL('../fixtures/crosstool/gold-shift-lead/', import.meta.url);
const RESUME = fs.readFileSync(new URL('resume-shift-supervisor.txt', D), 'utf8');
const POSTING = fs.readFileSync(new URL('posting-shift-lead.txt', D), 'utf8');
const base = { resumeText: RESUME, jobTitle: 'Shift Lead', company: 'Copper Kettle Kitchen', jobDescription: POSTING };
const out = runOptimizer(base);
const shownRows = (o) => (o.statements || []).filter((s) => s.display !== false);
const find = (what, pred) => { const s = shownRows(out).find(pred); assert.ok(s, `no ${what} in fixture — the verdict no longer reads one for this pair; rebuild the fixture`); return s; };
const stationSt = () => find('"Step in on any station" line (not shown / partly)', (s) => /step in on any station/i.test(s.text) && ['not_shown', 'partly'].includes(s.status));
const servsafeSt = () => find('ServSafe Manager line (not shown / partly)', (s) => /servsafe manager/i.test(s.text) && ['not_shown', 'partly'].includes(s.status));

// hand-built: the claim rules alone
const R_U = 'Jo Doe\nEXPERIENCE\nClerk — Acme | 2020 – Present\n• Stocked shelves\nSKILLS\nInventory';
const ST_U = [
  { id: 's1', text: 'Operate a forklift', status: 'not_shown', kind: 'duty', importance: 'duty', display: true, evidence: [], missing: ['forklift'], candidate: { line: '• Stocked shelves', why: 'close' } },
  { id: 's2', text: 'ServSafe Manager certification', status: 'not_shown', kind: 'requirement', importance: 'preferred', display: true, evidence: [], missing: ['ServSafe Manager certification'] },
  { id: 's3', text: 'Process returns and exchanges', status: 'partly', kind: 'duty', importance: 'duty', display: true, evidence: [{ line: '• Stocked shelves', why: 'x' }], missing: ['returns'], candidate: { line: '• Stocked shelves', why: 'close' } },
  { id: 's4', text: '3+ years of retail experience', status: 'not_shown', kind: 'requirement', importance: 'required', display: true, evidence: [], missing: [] },
  { id: 's5', text: 'Stock shelves', status: 'shown', kind: 'duty', importance: 'duty', display: true, evidence: [{ line: '• Stocked shelves', why: 'x' }], missing: [] },
  { id: 's6', text: 'Lift 40 pounds', status: 'cannot_tell', kind: 'physical', importance: 'required', display: true, evidence: [], missing: [] },
  { id: 's7', text: 'Retail experience in a busy store', status: 'not_shown', kind: 'requirement', importance: 'required', display: true, evidence: [], missing: [] },
];
const CON_U = [
  { kind: 'certification', label: 'ServSafe Manager certification', importance: 'preferred', gate: false, statementId: 's2', status: 'unmet', message: 'Not on your résumé.' },
  { kind: 'years', label: '3+ years of retail experience', importance: 'required', gate: true, statementId: 's7', status: 'unmet', message: 'You show 1 year.' },
];
const claim = (statementId, answer = 'yes') => ({ statementId, answer, claim: true });

test('unit: a claimed duty → shown, by you, claimed, no résumé line, the candidate gone', () => {
  const r = applyConfirmations(ST_U, CON_U, [claim('s1')], { resumeText: R_U });
  const s = r.statements[0];
  assert.deepEqual([s.status, s.by, s.claimed, s.candidate], ['shown', 'you', true, undefined]);
  assert.deepEqual(s.evidence, [{ why: CLAIM_WHY }]);
  assert.ok(!s.evidence.some((e) => e.line), 'a claim never carries a résumé line');
});

test('unit: a claimed credential reads "You said you hold …", and its constraint is met by you in its own words', () => {
  const r = applyConfirmations(ST_U, CON_U, [claim('s2')], { resumeText: R_U });
  assert.deepEqual(r.statements[1].evidence, [{ why: CLAIM_HOLD_WHY }]);
  const c = r.constraints[0];
  assert.deepEqual([c.status, c.by, c.claimed], ['met', 'you', true]);
  assert.equal(c.message, 'You said you hold a ServSafe Manager certification — add it to your résumé.');
});

test('unit: "no" on a partly line keeps its status and settles it (no candidate, no longer asked)', () => {
  const r = applyConfirmations(ST_U, CON_U, [claim('s3', 'no')], { resumeText: R_U });
  const s = r.statements[2];
  assert.deepEqual([s.status, s.settled, s.candidate, s.by], ['partly', true, undefined, undefined]);
});

test('unit: years asks, a shown line, a cannot_tell line and an unknown id are not claimable — ignored and counted', () => {
  const bad = [claim('s4'), claim('s7'), claim('s5'), claim('s6'), claim('s99'), { statementId: 's1', answer: 'maybe', claim: true }];
  const r = applyConfirmations(ST_U, CON_U, bad, { resumeText: R_U });
  assert.deepEqual(r.confirmations, { applied: 0, ignored: bad.length });
  assert.equal(r.statements, ST_U); assert.equal(r.constraints, CON_U);
});

test('unit: claims are capped like every answer', () => {
  const many = Array.from({ length: 500 }, (_, i) => claim(`s${i + 1}`));
  assert.ok(cleanConfirmations(many).length <= MAX_CONFIRMATIONS);
  const r = applyConfirmations(ST_U, CON_U, many, { resumeText: R_U });
  assert.equal(r.confirmations.applied + r.confirmations.ignored, 500);
  assert.ok(r.confirmations.applied <= 3);
});

test('director\'s pair: claiming "Step in on any station" and ServSafe Manager — shown by you, no line; the sentence counts them apart from the résumé', () => {
  const a = stationSt(), b = servsafeSt();
  const after = runOptimizer({ ...base, confirmed: [claim(a.id), claim(b.id)] });
  assert.deepEqual(after.confirmations, { applied: 2, ignored: 0 });
  for (const id of [a.id, b.id]) {
    const s = after.statements.find((x) => x.id === id);
    assert.deepEqual([s.status, s.by, s.claimed], ['shown', 'you', true]);
    assert.ok(!s.evidence.some((e) => e.line), `${id}: no résumé line`);
  }
  // the résumé's own count is unchanged: "your résumé shows N" never takes the claims in
  const count = (o) => Number((String(o.verdict.sentence).match(/your résumé shows (\d+)/) || [])[1]);
  assert.equal(count(after), count(out), `${out.verdict.sentence}\n${after.verdict.sentence}`);
  // a claim is something the résumé does NOT say yet: the sentence counts it apart, says so, and never calls nothing missing
  assert.match(after.verdict.sentence, /you said you've done 2 more that aren't on your résumé yet — add them/);
  assert.doesNotMatch(after.verdict.sentence, /nothing they list is missing/);
  assert.equal(after.requirement_count, out.requirement_count);
});

test('honesty: no paid row or prep row says "your résumé shows / lists" for a claimed line, and none quotes a résumé line for it', () => {
  const a = stationSt(), b = servsafeSt();
  const confirmed = [claim(a.id), claim(b.id)];
  const paid = buildPaidOptimize({ resume: RESUME, original: RESUME, jobDescription: POSTING, job: 'Shift Lead', company: 'Copper Kettle Kitchen', fit: { confirmed } });
  for (const id of [a.id, b.id]) {
    const row = paid.statements.find((x) => x.id === id);
    const lines = row ? (Array.isArray(row.evidence) ? row.evidence.map((e) => e && e.line).filter(Boolean) : row.evidence ? [row.evidence] : []) : [];
    assert.ok(row && row.claimed === true && row.status === 'shown' && !lines.length, JSON.stringify(row));
    assert.doesNotMatch(String(row.why), /your résumé (?:shows|lists)/i);
  }
  const pack = localPack({ company: 'Copper Kettle Kitchen', role: 'Shift Lead', resumeText: RESUME, jobText: POSTING, stage: 'Interview', confirmed });
  const texts = new Set([a.text, b.text].map((t) => t.toLowerCase()));
  for (const m of (pack.job_match || []).filter((x) => texts.has(String(x.label || '').toLowerCase()))) {
    assert.doesNotMatch(`${m.say || ''} ${m.proof || ''}`, /your résumé (?:shows|lists)/i, JSON.stringify(m));
    assert.ok(!m.proof, `prep quotes a résumé line for a claimed row: ${JSON.stringify(m)}`);
  }
});

test('un-claiming: the reading with the answer removed is byte-identical to the unanswered reading', () => {
  const a = stationSt();
  runOptimizer({ ...base, confirmed: [claim(a.id)] });
  assert.equal(JSON.stringify(runOptimizer(base)), JSON.stringify(out));
  assert.equal(JSON.stringify(runOptimizer({ ...base, confirmed: [] })), JSON.stringify(out));
});

test('the cache key carries the claims: a claim, the same answer without a claim, and no answer are three keys', () => {
  const k = { uid: 'u', jobId: 'j', jobDescription: POSTING, resume: RESUME };
  const plain = optimizeCacheKey(k);
  const withClaim = optimizeCacheKey({ ...k, confirmed: [claim('s9')] });
  const sameNoClaim = optimizeCacheKey({ ...k, confirmed: [{ statementId: 's9', answer: 'yes' }] });
  assert.equal(new Set([plain, withClaim, sameNoClaim]).size, 3);
  assert.notEqual(confirmationsKey([claim('s9')]), confirmationsKey([claim('s9', 'no')]));
});

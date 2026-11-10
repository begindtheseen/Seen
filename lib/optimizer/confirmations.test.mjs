// The person's answers (lib/optimizer/confirmations.js): validation, every effect, the cache key, and runOptimizer
// byte-identical when no answers are sent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyConfirmations, cleanConfirmations, confirmationsKey, MAX_CONFIRMATIONS } from './confirmations.js';
import { runOptimizer } from './index.js';
import { canonicalResumeText } from '../resume/canonical.js';
import { optimizeCacheKey } from '../server/optimizeCache.js';

// Purpose-built pair (X, 2026-11-10): a duty the résumé only comes close to ("counted the drawer at close" for cycle counts),
// lines only the person can answer (lifting, weekends), and a requirement the résumé shows. The integration cases find,
// at test time, a statement carrying each property and fail loudly when the verdict stops offering one — the thing under
// test is the confirmation logic, never where the verdict's thresholds sit. Everything else runs on hand-built statements.
const resume = `Sam Rivera
Dayton, OH · sam.rivera@example.com · (937) 555-0142

EXPERIENCE
Stock Associate — Brightway Hardware, Dayton, OH | Mar 2021 – Present
• Unloaded the weekly truck and stocked aisles before opening
• Helped customers find plumbing and paint supplies
• Kept the stockroom clean and the aisles clear
• Walked new seasonal staff through the stockroom layout on their first day
• Set up the front-window holiday table each December

Cashier — Corner Market, Dayton, OH | Jun 2019 – Feb 2021
• Ran the register and counted the drawer at close
• Answered customer questions at the front counter

SKILLS
Cash handling · Inventory · Returns · Customer service`;
const jd = `Retail Associate
Responsibilities:
- Process customer returns and exchanges at the service desk
- Build seasonal displays and planograms
- Receive shipments and check them against packing slips
- Train new hires on store procedures
- Coordinate vendor deliveries with the store manager
- Maintain accurate cycle counts in the inventory system
- Assist customers on the sales floor
Requirements:
- 1+ year of retail experience
- Ability to lift 40 pounds
- Weekend availability`;
const base = { resumeText: canonicalResumeText(resume), jobTitle: 'Retail Associate', company: 'Brightway', jobDescription: jd };
const out = runOptimizer(base);
const need = (what, x) => { assert.ok(x, `no ${what} in fixture — the verdict no longer offers one for this pair; rebuild the fixture`); return x; };
const shownSt = () => need('shown statement', (out.statements || []).find((s) => s.status === 'shown'));
const askSt = () => need('cannot_tell statement', (out.statements || []).find((s) => s.status === 'cannot_tell' && s.display !== false));
const candSt = () => need('candidate', (out.statements || []).find((s) => s.candidate && s.candidate.line && s.status !== 'shown'));

// hand-built: the confirmation rules alone
const RESUME_U = 'Jo Doe\nEXPERIENCE\nClerk — Acme | 2020 – Present\n• Counted the drawer at close\n• Stocked shelves\nSKILLS\nInventory';
const ST_U = [
  { id: 's1', text: 'Maintain accurate cycle counts', status: 'not_shown', kind: 'duty', importance: 'duty', display: true, evidence: [], missing: ['cycle counts'], candidate: { line: '• Counted the drawer at close', why: 'close' } },
  { id: 's2', text: 'Lift 40 pounds', status: 'cannot_tell', kind: 'physical', importance: 'required', display: true, evidence: [], missing: [], ask: { kind: 'physical', text: 'lift 40 pounds' } },
  { id: 's3', text: 'Stock shelves', status: 'shown', kind: 'duty', importance: 'duty', display: true, evidence: [{ line: '• Stocked shelves', why: 'x' }], missing: [] },
  { id: 's4', text: 'Process returns', status: 'partly', kind: 'duty', importance: 'duty', display: true, evidence: [], missing: ['returns'], candidate: { line: '• Stocked shelves', why: 'close' } },
];
const CON_U = [{ kind: 'physical', label: 'lift 40 lbs', importance: 'required', gate: false, statementId: 's2', status: 'ask', message: 'Physical requirement: lift 40 lbs.' }];

test('unit: yes with its candidate line → shown by you with that résumé line; yes without a line → shown by you; no → not shown by you', () => {
  const r = applyConfirmations(ST_U, CON_U, [{ statementId: 's1', answer: 'yes', line: 'Counted the drawer at close' }, { statementId: 's2', answer: 'yes' }], { resumeText: RESUME_U });
  const [s1, s2] = r.statements;
  assert.deepEqual([s1.status, s1.by, s1.evidence[0].line, s1.evidence[0].why, s1.candidate], ['shown', 'you', '• Counted the drawer at close', 'You said this line shows it.', undefined]);
  assert.deepEqual([s2.status, s2.by, s2.evidence[0].why], ['shown', 'you', 'You said yes.']);
  assert.deepEqual([r.constraints[0].status, r.constraints[0].by], ['met', 'you']);
  assert.deepEqual(r.confirmations, { applied: 2, ignored: 0 });
  const n = applyConfirmations(ST_U, CON_U, [{ statementId: 's2', answer: 'no' }, { statementId: 's4', answer: 'no', line: '• Stocked shelves' }], { resumeText: RESUME_U });
  assert.deepEqual([n.statements[1].status, n.statements[1].by], ['not_shown', 'you']);
  assert.match(n.statements[1].evidence[0].why, /^You said you can't lift 40 pounds\.$/);
  assert.deepEqual([n.constraints[0].status, n.constraints[0].by], ['unmet', 'you']);
  assert.deepEqual([n.statements[3].status, n.statements[3].candidate], ['partly', undefined], 'no on a candidate: the candidate goes, the status stays');
});

test('unit: an id not in the reading, a line not on the résumé, another statement\'s candidate line, a bad answer, a shown line — ignored and counted', () => {
  const bad = [
    { statementId: 's99', answer: 'yes' },
    { statementId: 's1', answer: 'yes', line: 'Managed a fleet of 40 delivery drones' },
    { statementId: 's1', answer: 'yes', line: '• Stocked shelves' }, // s4's candidate and a résumé line, but not s1's candidate
    { statementId: 's2', answer: 'maybe' },
    { statementId: 's3', answer: 'no' }, // the judge already shows it
    { statementId: '<script>', answer: 'yes' }, null, 'yes', 42,
  ];
  const r = applyConfirmations(ST_U, CON_U, bad, { resumeText: RESUME_U });
  assert.deepEqual(r.confirmations, { applied: 0, ignored: bad.length });
  assert.equal(r.statements, ST_U, 'nothing applied: the same arrays come back');
  assert.equal(r.constraints, CON_U);
  assert.ok(!RESUME_U.includes('You said'), 'nothing is written into the résumé');
});

test('500 entries are bounded: at most MAX_CONFIRMATIONS kept, fast, the rest ignored', () => {
  const many = Array.from({ length: 500 }, (_, i) => ({ statementId: `s${i + 1}`, answer: i % 2 ? 'yes' : 'no' }));
  const t0 = Date.now();
  const r = applyConfirmations(out.statements, out.constraints, many, { resumeText: base.resumeText });
  assert.ok(Date.now() - t0 < 500);
  assert.ok(cleanConfirmations(many).length <= MAX_CONFIRMATIONS);
  assert.equal(r.confirmations.applied + r.confirmations.ignored, 500);
});

test('fixture: yes / no on a line only the person can answer, through the real verdict', () => {
  const ask = askSt();
  const y = applyConfirmations(out.statements, out.constraints, [{ statementId: ask.id, answer: 'yes' }], { resumeText: base.resumeText });
  assert.deepEqual(((s) => [s.status, s.by])(y.statements.find((x) => x.id === ask.id)), ['shown', 'you']);
  const n = applyConfirmations(out.statements, out.constraints, [{ statementId: ask.id, answer: 'no' }], { resumeText: base.resumeText });
  const sn = n.statements.find((x) => x.id === ask.id);
  assert.deepEqual([sn.status, sn.by], ['not_shown', 'you']);
  assert.match(sn.evidence[0].why, /^You said /);
});

test('fixture: yes on the verdict\'s own candidate line → shown by you with that line; a shown line is never changed', () => {
  const c = candSt();
  const r = applyConfirmations(out.statements, out.constraints, [{ statementId: c.id, answer: 'yes', line: `  ${c.candidate.line}  ` }], { resumeText: base.resumeText });
  const sc = r.statements.find((x) => x.id === c.id);
  assert.deepEqual([sc.status, sc.by, sc.evidence[0].why], ['shown', 'you', 'You said this line shows it.']);
  assert.ok(base.resumeText.split('\n').some((l) => l.replace(/\s+/g, ' ').trim() === sc.evidence[0].line), 'the evidence is a line of the résumé, as written');
  const sh = shownSt();
  const r2 = applyConfirmations(out.statements, out.constraints, [{ statementId: sh.id, answer: 'no' }], { resumeText: base.resumeText });
  assert.equal(r2.confirmations.applied, 0);
});

test('runOptimizer: no answers (absent or empty) → byte-identical verdict; answers → the counts, the gates and the sentence follow them', () => {
  assert.equal(JSON.stringify(runOptimizer({ ...base, confirmed: [] })), JSON.stringify(out));
  const ask = askSt(), cand = candSt();
  const confirmed = [{ statementId: ask.id, answer: 'yes' }, { statementId: cand.id, answer: 'yes', line: cand.candidate.line }];
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

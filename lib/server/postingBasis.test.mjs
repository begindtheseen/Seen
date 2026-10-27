// A summary-only listing gets a labelled basis instead of a paste box (owner 2026-10-27, Adzuna valet listing).
// Run: node --test lib/server/postingBasis.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPostingBasis, sharedRequirements, coreTitles, annotateBasis, basisNote, roleRequirements } from './postingBasis.js';

const SUMMARY = '*The Details Pay Rate: $23.00/hr tips Location: HOAG Hospital (Irvine or Newport Beach location) Hours: Part-time (20-30 hours/week) Schedule:10pm-6am, Variable throughout the week, weekends required. We are looking for a friendly valet attendant to greet patients and visitors and park and retrieve vehicles saf…';
const ROW = { id: 'adz-1', title: 'Overnight Healthcare Valet Attendant', company: 'LAZ Parking California', description: SUMMARY, source: 'Adzuna' };
const VALET = (n, extra = '') => ({ id: `gh-${n}`, title: n % 2 ? 'Valet Attendant' : 'Valet Attendant - Hotel', company: `Co ${n}`, source: 'Greenhouse',
  description: `ABOUT THE ROLE\nGreet guests and park and retrieve vehicles quickly and safely at our property, keeping the valet stand organized.\n${'Keep keys secured and tickets accurate during every shift. '.repeat(8)}\nREQUIREMENTS\nValid driver's license and a clean driving record required.\nMust be able to drive manual and automatic transmission vehicles.\nCustomer service experience preferred.\nAbility to stand and walk for long periods and run short distances.\n${extra}` });

function fakeDb(routes) {
  const calls = [];
  const db = async (path) => {
    calls.push(decodeURIComponent(path));
    for (const [re, rows] of routes) if (re.test(decodeURIComponent(path))) return { ok: true, async json() { return rows; } };
    return { ok: true, async json() { return []; } };
  };
  return { db, calls };
}

test('the role words of a title: shift, setting and numbers come off; a lone generic word is not a role', () => {
  assert.deepEqual(coreTitles('Overnight Healthcare Valet Attendant'), ['valet attendant']);
  assert.deepEqual(coreTitles('Cashier - Part Time'), ['cashier']);
  assert.deepEqual(coreTitles('Pharmacy Technician II'), ['pharmacy technician']);
  assert.deepEqual(coreTitles('Warehouse Associate | North Phoenix (Non-Contract)'), ['warehouse associate']);
});

test('requirements most similar postings share, as their own sentences', () => {
  const shared = sharedRequirements([VALET(1), VALET(2), VALET(3), VALET(4, 'Bilingual English/Spanish a plus.')], { jobTitle: 'Valet Attendant' });
  assert.equal(shared.used, 4);
  assert.ok(shared.sentences.some((s) => /driver's license/i.test(s)), shared.sentences.join(' | '));
  assert.ok(shared.sentences.some((s) => /Customer service/i.test(s)));
  assert.ok(!shared.sentences.some((s) => /Bilingual/i.test(s)), 'one posting alone does not make it a shared requirement');
  assert.ok(shared.sentences.every((s) => s.length <= 221));
});

test('the same job on the employer\'s own board is the posting', async () => {
  const twin = { id: 'gh-9', title: ROW.title, company: 'LAZ Parking', source: 'Greenhouse', description: VALET(9).description };
  const { db, calls } = fakeDb([[/company=ilike/, [twin]]]);
  const b = await buildPostingBasis({ row: ROW, db });
  assert.equal(b.kind, 'twin');
  assert.equal(b.description, twin.description);
  assert.match(basisNote(b), /same job's full posting from LAZ Parking/);
  assert.ok(calls[0].includes('source=neq.Adzuna'), 'never another Adzuna summary');
});

test('no twin: the summary plus what similar full postings require, counted and labelled', async () => {
  const { db, calls } = fakeDb([[/title=imatch\.\\mvalet attendant\\M/, [VALET(1), VALET(2), VALET(3), VALET(4), VALET(5)]]]);
  const b = await buildPostingBasis({ row: ROW, db });
  assert.equal(b.kind, 'similar');
  assert.equal(b.core, 'valet attendant');
  assert.equal(b.count, 5);
  assert.ok(b.description.startsWith(SUMMARY.slice(0, 40)), 'the summary leads');
  assert.ok(!/saf…$/.test(b.description.split('\n')[0]), 'the cut word and ellipsis are dropped');
  assert.match(b.description, /REQUIREMENTS\n/);
  assert.match(basisNote(b), /plus the requirements 5 other Valet Attendant postings state/);
  assert.ok(calls.some((c) => c.includes('order=created_at.desc')));
});

test('no similar postings: what the role family asks for, or nothing (then the paste box)', async () => {
  const { db } = fakeDb([]);
  const cashier = await buildPostingBasis({ row: { ...ROW, title: 'Cashier', description: 'Ring up guests at our store…' }, db });
  assert.equal(cashier.kind, 'role');
  assert.ok(cashier.added.length >= 3);
  assert.match(basisNote(cashier), /roles usually ask for/);
  const unknown = await buildPostingBasis({ row: { ...ROW, title: 'Zorbing Coordinator', description: 'Fun summer job…' }, db });
  assert.equal(unknown, null);
  assert.equal(roleRequirements('Zorbing Coordinator'), null);
});

test('borrowed requirements are marked and never called "the posting"', () => {
  const basis = { kind: 'similar', added: ["Valid driver's license and a clean driving record required."] };
  const out = annotateBasis({
    matched_requirements: [{ requirement: 'customer service', postingEvidence: 'Greet patients.' }],
    unsupported_requirements: [{ requirement: "driver's license", postingEvidence: "Valid driver's license and a clean driving record required." }],
    verdict: { sentence: '61 — you show customer service; the posting also asks for a driver\'s license, which your résumé doesn\'t show.' },
  }, basis);
  assert.equal(out.matched_requirements[0].from_similar, undefined);
  assert.equal(out.unsupported_requirements[0].from_similar, true);
  assert.match(out.verdict.sentence, /postings like this usually also ask for/);
  assert.equal(annotateBasis({ verdict: { sentence: 'x' } }, { kind: 'twin', added: [] }).verdict.sentence, 'x', 'a twin IS the posting');
  // one ask from the summary (nights), one borrowed (outdoors): the listing is never said to screen on the borrowed one
  const mixed = annotateBasis({ verdict: { sentence: '35 — it screens on availability (nights) and outdoor conditions — say so if true.' },
    constraints: [{ kind: 'availability', status: 'ask', evidence: 'Schedule:10pm-6am' }, { kind: 'physical', status: 'ask', evidence: 'Work outdoors in all weather.' }] },
  { kind: 'role', added: ['Work outdoors in all weather.'] });
  assert.match(mixed.verdict.sentence, /roles like this screen on availability/);
});

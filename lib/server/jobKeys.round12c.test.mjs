// Round 12c: THE BASIS OF A HEADLINE IS THE PERSON'S LATEST ROLE OVERALL — the current one, else the latest-ending —
// with no occupation logic. A later role worded so the tables cannot place it (an internal title, another language, a
// programme name) still makes the earlier role a past role: offered under its exact title, it never heads an email and
// is never an email item. Invented people.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildJobKeys, matchListing } from './jobKeys.js';
import { finalizeMatches } from './resumeMatches.js';

const NOW = new Date('2026-11-11T12:00:00Z');
const L = (s, reqs = []) => `${s} `.repeat(20) + (reqs.length ? `\nRequirements\n${reqs.map((r) => `• ${r}`).join('\n')}` : '');
const row = (job, keys) => { const m = matchListing(job, keys, { now: NOW }); return { m, r: { ...job, _reason: m.reason, _basis: m.basis, _checks: m.checks, _checked: m.checked, _headlineOk: m.headlineOk, _summaryOnly: m.summaryOnly } }; };

const PEOPLE = [
  ['an internal title', 'Gwen Hale\nSpokane, WA\nEXPERIENCE\nClinic Experience Champion — Banfield Pet Hospital | 2022 – Present\n- Run the front of a 6-doctor clinic and coach new hires\nVeterinary Technician — Banfield Pet Hospital | 2018 – 2022\n- Induced anesthesia and monitored surgical patients; ran in-house lab work',
    { id: 'v', title: 'Veterinary Technician', company: 'VCA Animal Hospitals', location: 'Spokane, WA', description: L('Induce anesthesia, monitor surgical patients and run in-house lab work.', ['Experience monitoring anesthesia']) }],
  ['a title in another language', 'Rafa Ortiz\nEl Paso, TX\nEXPERIENCE\nJefe de Cocina — Restaurante La Nogalera, Ciudad Juárez | 2021 – Present\n- Dirijo una cocina de 9 personas\nLine Cook — Applebee\'s, El Paso TX | 2016 – 2021\n- Worked the grill and fry stations on a 250-cover night',
    { id: 'c', title: 'Line Cook', company: 'Chili\'s', location: 'El Paso, TX', description: L('Work the grill and fry stations and keep tickets moving.', ['Grill and fry station experience']) }],
  ['a programme name', 'Noor Saleh\nColumbus, OH\nEXPERIENCE\nPathways Fellow — CVS Health | 2024 – Present\n- Rotating through pharmacy operations and store leadership\nPharmacy Technician — CVS Health | 2020 – 2024\n- Filled 300 prescriptions a day; handled insurance rejections',
    { id: 'p', title: 'Pharmacy Technician', company: 'Kroger', location: 'Columbus, OH', description: L('Fill prescriptions and resolve insurance rejections at the pharmacy counter.', ['Prescription filling experience']) }],
];
for (const [kind, resume, job] of PEOPLE) {
  test(`latest role overall (${kind}): the earlier role's exact title never heads an email and is never an email item`, () => {
    const keys = buildJobKeys({ resumeText: resume, now: NOW });
    const { m, r } = row(job, keys);
    if (m.ok) assert.equal(m.headlineOk, false, JSON.stringify(m));
    assert.equal(finalizeMatches([r], resume, { keys, now: NOW, limit: 6, strict: true }).rows.length, 0, 'not an email item');
  });
}
test('mirror: no current role, and the latest role matches — it still heads the email', () => {
  const resume = 'Ike Ward\nColumbus, OH\nEXPERIENCE\nPharmacy Technician — Walgreens | 2020 – 2025\n- Filled 300 prescriptions a day; handled insurance rejections\nCashier — Kroger | 2017 – 2020\n- Ran a register';
  const keys = buildJobKeys({ resumeText: resume, now: NOW });
  const { m } = row(PEOPLE[2][2], keys);
  assert.equal(m.ok, true, JSON.stringify(m));
  assert.match(m.reason, /^You were a Pharmacy Technician at Walgreens/);
  assert.equal(m.headlineOk, true);
});

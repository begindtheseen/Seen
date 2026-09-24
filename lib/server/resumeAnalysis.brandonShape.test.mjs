// REGRESSION SPEC — the owner's real resume shape, reconstructed from a mangled production export.
// Run: node --test lib/server/resumeAnalysis.brandonShape.test.mjs
//
// On 2026-08-13 the live "Optimized with Seen" PDF export of this resume rendered:
//   • an entry with company "EXPERIENCE" (the section header consumed as employer) and ZERO bullets
//     — the entry's real bullets were dropped from the document entirely;
//   • the next entry with company "Followed technical procedures and torque specifications
//     precisely." — a BULLET of the previous job consumed as the employer name;
//   • the Detailing business and FOUR older jobs never became entries at all — they were flattened
//     into the previous job's bullet list;
//   • education concatenated as "High School DiplomaGreat Oak High School – Temecula, CA".
//
// This file pins the CORRECT parse of that exact shape. The shape is common, not exotic:
//   – a self-directed / freelance entry whose heading is a title with no employer line
//   – "Title – Company" single-line entries (detailing business, and all four older jobs)
//   – a company line followed by "Title | Dates" on the next line
//   – EDUCATION as two adjacent lines (credential, then school – location)
//
// If a change makes any assertion here fail, it is regressing the exact production mangle that
// shipped a one-page resume missing most of its owner's experience.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildResumeDocument, runOptimize } from './resumeAnalysis.js';

const RESUME = `BRANDON BURNETT
951-216-5400 | Brandon.Burnett00123@icloud.com

SUMMARY
Hands-on automotive technician with 5+ years of self-directed mechanical experience working on personal vehicles, including engine, transmission, clutch, suspension, and drivetrain systems. Known for learning quickly, following technical procedures precisely, and solving mechanical problems under pressure with limited resources. Strong vehicle handling background and detailing experience. Seeking to grow long-term as a Tesla Refurbishment / Collision Repair Technician.

EXPERIENCE

Automotive Technician (Self-Directed)
2020 – Present
- Performed engine, transmission, clutch, suspension, and drivetrain repairs on personal vehicles.
- Diagnosed mechanical problems and completed repairs with limited tools and resources.
- Followed technical procedures and torque specifications precisely.

Towne Park
Valet Attendant | Oct 2022 – Jan 2025
- Safely operated and parked high volumes of vehicles, including luxury models.
- Worked overnight shifts independently with full responsibility for vehicle safety.
- Maintained a zero-incident vehicle handling record.
- Demonstrated focus, discipline, and situational awareness in high-pressure environments.

Automotive Detailing Business – Owner/Operator
Self-Employed | Part-Time
- Provided interior and exterior detailing services with emphasis on finish protection.
- Developed attention to paint condition, trim, interior materials, and quality control.
- Managed scheduling, supplies, and customer expectations independently.

Campaign Manager – Victoriam Management
Membership Specialist – UFC Gym
Team Member – Chipotle
Administrative Assistant – Biotheranostics

EDUCATION
High School Diploma
Great Oak High School – Temecula, CA
`;

const doc = () => buildResumeDocument({ resume: RESUME, job: 'Order Builder', company: 'Compass Group' });

test('no experience entry ever has a section header or a bullet as its company', () => {
  const d = doc();
  for (const e of d.experience) {
    assert.ok(!/^(experience|work experience|employment|education|skills|summary)$/i.test(e.company),
      `section header leaked into company: ${JSON.stringify(e)}`);
    assert.ok(!/torque specifications|finish protection|customer expectations/i.test(e.company),
      `a bullet leaked into company: ${JSON.stringify(e.company)}`);
    assert.ok(e.company.length <= 60, `company suspiciously long (bullet leak?): ${JSON.stringify(e.company)}`);
  }
});

test('the self-directed entry keeps its own bullets — content must not be dropped', () => {
  const d = doc();
  const selfDirected = d.experience.find(e => /self-directed/i.test(`${e.title} ${e.company}`));
  assert.ok(selfDirected, `self-directed entry missing entirely: ${JSON.stringify(d.experience.map(e => e.title))}`);
  assert.ok(selfDirected.bullets.length >= 3,
    `self-directed bullets dropped (got ${selfDirected.bullets.length}) — this is the "cut insanely short" bug`);
  assert.ok(selfDirected.bullets.some(b => /engine|transmission|drivetrain/i.test(b)),
    'the automotive bullets belong to the self-directed entry');
});

test('the detailing business is its own entry, not bullets of the previous job', () => {
  const d = doc();
  const towne = d.experience.find(e => /towne park/i.test(e.company));
  assert.ok(towne, 'Towne Park entry missing');
  assert.ok(!towne.bullets.some(b => /detailing business|owner\/operator|finish protection/i.test(b)),
    `another job's content flattened into Towne Park bullets: ${JSON.stringify(towne.bullets)}`);
  const detailing = d.experience.find(e => /detailing/i.test(`${e.title} ${e.company}`));
  assert.ok(detailing, 'Detailing business entry missing');
  assert.ok(detailing.bullets.some(b => /finish protection/i.test(b)), 'detailing bullets belong to the detailing entry');
});

test('single-line "Title – Company" jobs become entries, never bullets', () => {
  const d = doc();
  const all = JSON.stringify(d.experience);
  for (const co of ['Victoriam Management', 'UFC Gym', 'Chipotle', 'Biotheranostics']) {
    const entry = d.experience.find(e => e.company.includes(co));
    assert.ok(entry, `"${co}" did not become an entry: ${all}`);
  }
  // And none of them appear inside any OTHER entry's bullet list.
  for (const e of d.experience) {
    assert.ok(!e.bullets.some(b => /victoriam|ufc gym|chipotle|biotheranostics/i.test(b)),
      `older job flattened into "${e.company}" bullets: ${JSON.stringify(e.bullets)}`);
  }
});

test('education keeps credential and school as separate renderable lines', () => {
  const d = doc();
  assert.ok(d.education.length >= 2, `education collapsed: ${JSON.stringify(d.education)}`);
  assert.ok(d.education.some(l => /high school diploma/i.test(l)));
  assert.ok(d.education.some(l => /great oak/i.test(l)));
  // The concatenation bug rendered "High School DiplomaGreat Oak High School".
  assert.ok(!d.education.some(l => /diplomagreat/i.test(l.replace(/\s+/g, ''))) ||
    d.education.every(l => /diploma\s*$|^great oak/i.test(l) || !/diploma.*great oak/i.test(l)),
    `credential and school concatenated: ${JSON.stringify(d.education)}`);
});

// The production export showed all four older roles joined into ONE bullet with " | "
// separators, which means the source résumé listed them on a single line. A line packing
// four roles is long enough to read as prose, so it must be split into role headers
// BEFORE the prose check, or four real jobs collapse into one line of someone else's job.
test('several roles packed onto one pipe-separated line each become an entry', () => {
  const packed = `BRANDON BURNETT
951-216-5400 | Brandon.Burnett00123@icloud.com

EXPERIENCE
Towne Park
Valet Attendant | Oct 2022 – Jan 2025
- Safely operated and parked high volumes of vehicles, including luxury models.

Campaign Manager – Victoriam Management | Membership Specialist – UFC Gym | Team Member – Chipotle | Administrative Assistant – Biotheranostics

EDUCATION
High School Diploma`;
  const d = buildResumeDocument({ resume: packed, job: 'Order Builder', company: 'Compass Group' });
  for (const co of ['Victoriam Management', 'UFC Gym', 'Chipotle', 'Biotheranostics']) {
    assert.ok(d.experience.some(e => e.company.includes(co)),
      `"${co}" stayed buried in a pipe-joined line: ${JSON.stringify(d.experience)}`);
  }
  const towne = d.experience.find(e => /towne park/i.test(e.company));
  assert.ok(towne && towne.bullets.length === 1, `Towne Park absorbed the packed roles: ${JSON.stringify(towne)}`);
});

test('nothing from the original disappears: every source bullet survives somewhere', () => {
  const d = doc();
  const everywhere = JSON.stringify(d);
  for (const marker of [
    'drivetrain repairs', 'limited tools', 'torque specifications',
    'luxury models', 'zero-incident', 'situational awareness',
    'finish protection', 'quality control', 'customer expectations',
  ]) {
    assert.ok(everywhere.toLowerCase().includes(marker.toLowerCase()),
      `content dropped from the document: "${marker}"`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// The other half of the same report: "it still offers dumb keyword additions that
// apparently fix the whole resume." Run against the posting this résumé was optimised
// for, the engine surfaced "associates", "responsible", "repeatedly" and "eligible" as
// terms to add — all lifted from the benefits and grammar of the posting — labelled a
// bullet about engine repairs as addressing "pallet", and attached the identical advice
// "weave in pallet" to all six bullets, including one about torque specifications.
// ─────────────────────────────────────────────────────────────────────────────

const ORDER_BUILDER_JD = `Order Builder (Full Time) - Compass Group
The Order Builder is responsible for selecting and building customer orders in a high-volume
warehouse environment. Pull product from racking using a pallet jack, build pallets to order,
wrap and stage pallets for loading, verify order accuracy, maintain a clean and safe work area,
and follow all safety procedures. Ability to lift up to 50 lbs repeatedly. Prior warehouse or
forklift experience preferred. Must be able to work overnight shifts, weekends and holidays.
Benefits: Associates at Compass Group are offered medical, dental, vision, and a 401k. Full time
associates are eligible for paid time off. Applicants must apply online.`;

const opt = () => runOptimize({
  resume: RESUME, jobDescription: ORDER_BUILDER_JD,
  job: 'Order Builder (Full Time)', company: 'Compass Group', pro: false,
});

test('benefits and grammar boilerplate is never offered as a keyword to add', () => {
  const gaps = opt().keywords_added.map(k => k.toLowerCase());
  for (const junk of ['associates', 'associate', 'responsible', 'repeatedly', 'eligible',
    'medical', 'dental', 'vision', '401k', 'online', 'applicants', 'paid']) {
    assert.ok(!gaps.includes(junk), `posting boilerplate offered as a résumé keyword: "${junk}" in ${JSON.stringify(gaps)}`);
  }
  assert.ok(gaps.length > 0, 'real keyword gaps still surface');
  assert.ok(gaps.some(g => /pallet|warehouse|forklift|product|accuracy/.test(g)),
    `the real job content dropped out of the gap list: ${JSON.stringify(gaps)}`);
});

test('a bullet only claims to address a keyword it actually contains', () => {
  for (const b of opt().optimized_bullets) {
    if (!b.addresses) continue;                       // empty is honest; guessing is not
    const words = b.original.toLowerCase();
    assert.ok(words.includes(String(b.addresses).toLowerCase()),
      `bullet claims to address "${b.addresses}" but does not contain it: ${JSON.stringify(b.original)}`);
  }
});

test('keyword advice is never the same sentence stapled to every bullet', () => {
  const notes = opt().optimized_bullets.map(b => b.note || '').filter(n => /weave in/.test(n));
  assert.ok(new Set(notes).size === notes.length,
    `the same keyword suggestion was repeated across bullets: ${JSON.stringify(notes)}`);
  // And any keyword suggested must share subject matter with the bullet it is attached to.
  for (const b of opt().optimized_bullets) {
    const m = /weave in "([^"]+)"/.exec(b.note || '');
    if (!m) continue;
    const stem = w => w.slice(0, 5);
    const kwWords = m[1].toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 4);
    const bulletWords = b.original.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 4);
    assert.ok(kwWords.some(k => bulletWords.some(w => stem(w) === stem(k))),
      `"${m[1]}" was suggested for an unrelated bullet: ${JSON.stringify(b.original)}`);
  }
});

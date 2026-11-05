// Regression: an "optimized" download printed the whole work history as ONE paragraph inside
// SKILLS, with Seen's optimizer notes and a "&" glyph at the bottom (owner's export, 2026-11-01).
//   1. "RELEVANT AUTOMOTIVE AND EV EXPERIENCE" / "ADDITIONAL PROFESSIONAL EXPERIENCE" were not
//      read as experience headings, so the skills parser split every role and bullet on commas.
//   2. The fit score, "CONFIRM BEFORE USING" and "Add a bullet…" prompts were printed in the résumé.
//   3. "⚠" drawn in built-in Times printed as "&".
// The fixture keeps the owner's résumé SHAPE with every personal detail replaced.
// Run: node --test lib/resume/render/twoExperienceSections.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseResume } from '../parse/index.js';
import { parseSkills } from '../parse/skills.js';
import { classifyHeader } from '../parse/sections.js';
import { serializeToText, experienceGroups, normalizeDoc } from '../model.js';
import { renderPdf, sanitizeForStandardFont } from './pdf.js';
import { renderDocx } from './docx.js';
import { renderText, renderMarkdown } from './text.js';
import { toJsonResume, fromJsonResume } from './jsonResume.js';
import { extractResumeFile } from '../extract/index.js';

const RESUME = `Jordan Ellis
AUTOMOTIVE REPAIR | EV ASSEMBLY | SERVICE TECHNICIAN APPLICANT
Riverton, CA · 555-010-2244 · jordan.ellis@example.com · Valid CA Driver's License

SUMMARY
Hands-on automotive repair experience since 2018, including engine and transmission replacement, electrical diagnostics and suspension repairs. Former EV production assembler.

SKILLS
Diagnostics: OBD-II scanning, multimeter testing, wiring and sensor tracing, ECU compatibility, service manuals
Mechanical: Engine and transmission replacement, suspension, brakes, cooling, exhaust, fluid service, torque specs
Shop / production: Hand and power tools, soldering, component assembly, work instructions, quality inspection, clean workstations

RELEVANT AUTOMOTIVE AND EV EXPERIENCE
Independent Automotive Repair | Personal and friends' vehicles | Southern California | 2018–Present
• Completed a 2005 sedan engine swap, resolved ECU compatibility, and traced post-install electrical faults using a multimeter, wiring references and diagnostics.
• Diagnosed battery, charging, wiring, sensor and mechanical issues on four makes of vehicles using OBD-II, multimeter and factory specifications.

Solar Panel Assembly Technician (Temporary) | Solarline Motors | San Diego, CA | 2021–2022
• Soldered and assembled solar panel components for EV prototypes, following work instructions and build specifications.
• Inspected finished work before handoff and maintained an organized production workstation.

ADDITIONAL PROFESSIONAL EXPERIENCE
Valet Attendant | Harbor Hotel | Los Angeles | Aug–Sep 2026
• Operated manual and automatic vehicles in a high-volume setting, documented vehicle condition, and maintained secure key control.

Valet Lead / Vehicle Operations | ParkRight Valet | Orange | Oct 2022–Sep 2024
• Trained attendants on safe vehicle handling and inspection procedures, documented existing damage, and supported shift operations.

Package Handler | Parcel Ground | Rialto | Dec 2020–Feb 2021
• Scanned, sorted and loaded packages to meet route deadlines in a fast-paced distribution hub.

EDUCATION
Valley Oak High School — High School Diploma | Riverton, CA
`;

const BULLETS = [
  'Completed a 2005 sedan engine swap, resolved ECU compatibility, and traced post-install electrical faults using a multimeter, wiring references and diagnostics.',
  'Diagnosed battery, charging, wiring, sensor and mechanical issues on four makes of vehicles using OBD-II, multimeter and factory specifications.',
  'Soldered and assembled solar panel components for EV prototypes, following work instructions and build specifications.',
  'Inspected finished work before handoff and maintained an organized production workstation.',
  'Operated manual and automatic vehicles in a high-volume setting, documented vehicle condition, and maintained secure key control.',
  'Trained attendants on safe vehicle handling and inspection procedures, documented existing damage, and supported shift operations.',
  'Scanned, sorted and loaded packages to meet route deadlines in a fast-paced distribution hub.',
];
const RELEVANT = 'Relevant Automotive and EV Experience';
const ADDITIONAL = 'Additional Professional Experience';
const flat = (s) => String(s).replace(/\s+/g, ' ');

function checkDoc(d, label) {
  assert.deepEqual(d.skills.map((g) => g.label), ['Diagnostics', 'Mechanical', 'Shop / production'], `${label}: three skill groups, nothing swallowed`);
  assert.ok(d.skills.flatMap((g) => g.items).includes('Hand and power tools'), `${label}: "and" never splits a skill`);
  assert.deepEqual(d.experience.map((e) => [e.title, e.company]), [
    ['Independent Automotive Repair', "Personal and friends' vehicles"],
    ['Solar Panel Assembly Technician', 'Solarline Motors'],
    ['Valet Attendant', 'Harbor Hotel'],
    ['Valet Lead / Vehicle Operations', 'ParkRight Valet'],
    ['Package Handler', 'Parcel Ground'],
  ], label);
  assert.deepEqual(d.experience.map((e) => e.group), [RELEVANT, RELEVANT, ADDITIONAL, ADDITIONAL, ADDITIONAL], `${label}: each role keeps its heading`);
  assert.deepEqual(d.experience.flatMap((e) => e.bullets.map((b) => b.text)), BULLETS, `${label}: every bullet whole, commas intact`);
  // header pieces are never dropped: a bare place is the location, a shared-year range is a date
  assert.equal(d.experience[0].location, 'Southern California', label);
  assert.equal(d.experience[4].location, 'Rialto', label);
  assert.deepEqual([d.experience[2].start, d.experience[2].end], ['2026-08', '2026-09'], `${label}: "Aug–Sep 2026"`);
  assert.equal(d.education[0].school, 'Valley Oak High School', label);
}

test('qualified experience headings: two experience sections, skills never swallow roles', () => {
  const d = parseResume({ text: RESUME, source: 'text' });
  assert.deepEqual(d.sectionOrder, ['summary', 'skills', 'experience', 'education']);
  checkDoc(d, 'parse');
  assert.deepEqual(experienceGroups(d).map((g) => [g.title, g.roles.length]), [[RELEVANT, 2], [ADDITIONAL, 3]]);
  // canonical text round-trip keeps both headings (it is what profiles.resume_text stores)
  checkDoc(parseResume({ text: serializeToText(d), source: 'text' }), 'serialize → parse');
  checkDoc(fromJsonResume(JSON.parse(JSON.stringify(toJsonResume(d)))), 'json resume');
  for (const [fmt, out] of [['txt', renderText(d)], ['md', renderMarkdown(d)]]) {
    const up = out.toUpperCase();
    assert.ok(up.includes(RELEVANT.toUpperCase()) && up.includes(ADDITIONAL.toUpperCase()), fmt);
  }
});

test('classifyHeader: qualified experience headings, and what is NOT one', () => {
  const stats = { bodySize: 0 };
  const line = (text, extra = {}) => ({ text, bullet: false, ...extra });
  const kind = (text, opts = {}, extra = {}) => (classifyHeader(line(text, extra), stats, opts) || {}).kind || null;
  assert.equal(kind('RELEVANT AUTOMOTIVE AND EV EXPERIENCE'), 'experience');
  assert.equal(kind('ADDITIONAL PROFESSIONAL EXPERIENCE'), 'experience');
  assert.equal(kind('Other Work History'), 'experience');
  assert.equal(kind('RELATED RETAIL EMPLOYMENT'), 'experience');
  assert.equal(kind('Related Retail Experience', { currentKind: 'skills', nextLine: line('Cashier | Corner Market | 2019 – 2021') }), 'experience');
  // vocabulary headings keep their own kinds
  assert.equal(kind('VOLUNTEER EXPERIENCE'), 'volunteer');
  assert.equal(kind('PROJECT EXPERIENCE'), 'projects');
  // a department line above a role's dates, a skill item, a sentence: not sections
  assert.equal(kind('CUSTOMER EXPERIENCE', { nextLine: line('Acme Retail | 2020 – 2022') }), null);
  assert.equal(kind('Customer service experience', { currentKind: 'skills' }), null);
  assert.notEqual(kind('Skills and Experience'), 'experience');
});

test('an unrecognised heading still never folds a work history into SKILLS', () => {
  const text = RESUME.replace('RELEVANT AUTOMOTIVE AND EV EXPERIENCE', 'AUTOMOTIVE BACKGROUND').replace('ADDITIONAL PROFESSIONAL EXPERIENCE\n', '');
  const d = parseResume({ text, source: 'text' });
  assert.deepEqual(d.skills.map((g) => g.label), ['Diagnostics', 'Mechanical', 'Shop / production']);
  assert.equal(d.experience.length, 5);
  assert.deepEqual(d.experience.flatMap((e) => e.bullets.map((b) => b.text)), BULLETS);
});

test('skills splitter: a sentence stays whole, a list still splits', () => {
  const groups = parseSkills([
    { text: 'Python, Java, SQL, Docker', bullet: false },
    { text: 'Diagnosed battery, charging, wiring, sensor and mechanical issues on four makes of vehicles using OBD-II', bullet: true },
    { text: 'Operated manual and automatic vehicles in a high-volume setting', bullet: true },
    { text: 'Hand and power tools', bullet: false },
  ]);
  const items = groups.flatMap((g) => g.items);
  assert.deepEqual(items, ['Python', 'Java', 'SQL', 'Docker',
    'Diagnosed battery, charging, wiring, sensor and mechanical issues on four makes of vehicles using OBD-II',
    'Operated manual and automatic vehicles in a high-volume setting', 'Hand and power tools']);
});

test('the rendered PDF: both experience sections, every bullet, no optimizer notes, no stray glyphs', async () => {
  const d = parseResume({ text: RESUME, source: 'text' });
  // an `appendix` (the old "Optimized for …" package) is ignored by the renderer
  const appendix = { role: 'Production Associate', company: 'Acme', fitScore: 39, bullets: [], confirmItems: ['Add a bullet with a real detail for: microsoft office'], message: '' };
  for (const template of ['classic', 'engineering', 'modern']) {
    const r = await renderPdf(d, { template, pro: true, appendix });
    const ex = await extractResumeFile({ buffer: r.buffer, fileName: 'r.pdf' });
    const text = flat(ex.text);
    assert.ok(ex.text.includes(RELEVANT.toUpperCase()) && ex.text.includes(ADDITIONAL.toUpperCase()), template);
    for (const b of BULLETS) assert.ok(text.includes(b), `${template}: ${b}`);
    for (const s of ['OPTIMIZED FOR', 'SeenFit', 'CONFIRM BEFORE USING', 'could not verify', 'Add a bullet', '&']) assert.ok(!ex.text.includes(s), `${template}: ${s}`);
    // a skill group whose label is bold is measured in the body font: three lines, no blank line between
    const skillLines = ex.lines.filter((l) => /^(Diagnostics|Mechanical|Shop \/ production):/.test(l.text));
    assert.equal(skillLines.length, 3, template);
  }
  const docx = await renderDocx(d, { template: 'classic', pro: true });
  const exD = await extractResumeFile({ buffer: docx.buffer, fileName: 'r.docx' });
  assert.ok(exD.text.toUpperCase().includes(RELEVANT.toUpperCase()) && exD.text.toUpperCase().includes(ADDITIONAL.toUpperCase()), 'docx');
  for (const b of BULLETS) assert.ok(flat(exD.text).includes(b), `docx: ${b}`);
});

test('a glyph the built-in font lacks is mapped, never printed as another character', async () => {
  assert.equal(sanitizeForStandardFont('⚠ check · détail → done ☐'), '! check · détail -> done -');
  // the header's target line counts when choosing the font
  const CASHIER = ['Counted two cash drawers every shift and reconciled them against the register report.', 'Greeted customers, answered questions about weekly specials and restocked the front shelves.', 'Trained three new cashiers on the register, returns and the store loyalty program.'];
  const d = normalizeDoc({ basics: { name: 'Jordan Ellis' }, experience: [{ title: 'Cashier', company: 'Corner Market', start: '2020', end: '2021', bullets: CASHIER }] });
  const r = await renderPdf(d, { template: 'classic', pro: true, targetLine: 'Seeking ⚠ roles' });
  const ex = await extractResumeFile({ buffer: r.buffer, fileName: 'r.pdf' });
  assert.ok(!ex.text.includes('&'), ex.text);
  // the legacy Harvard builder (fallback when the résumé does not parse) sanitizes too
  const { buildResumePDF } = await import('../../../api/resume.js');
  const buf = await buildResumePDF({ name: 'Jordan Ellis', contact: { email: 'jordan.ellis@example.com', phone: '', location: '', linkedin: '' }, skills: [], education: [], summary: '⚠ Ready to start → now', experience: [{ title: 'Cashier', company: 'Corner Market', dates: '2020 – 2021', bullets: [`☐ ${CASHIER[0]}`, ...CASHIER.slice(1)] }] }, { pro: true });
  const exL = await extractResumeFile({ buffer: buf, fileName: 'r.pdf' });
  assert.ok(!exL.text.includes('&') && exL.text.includes('Ready to start -> now'), exL.text);
  assert.ok(!/S U M M A R Y/.test(exL.text), 'no letter-spaced headings in the legacy builder');
});

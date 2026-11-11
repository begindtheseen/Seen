// Tests: nothing a person wrote is ever lost (Studio judge 2026-11-10, defect class D1).
// Run: node --test lib/resume/parse/fidelity.test.mjs
//
// The real cases: an electrician's "LICENSES / CERTS" section vanished and the heading was printed under
// his name; an admin's career-break note vanished; a warehouse gap note became a job heading; a
// certification printed "(OSHA, renewed | 2024"; the ATS check said 100 / A on the damaged file.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { parseResume } from './index.js';
import { parseFidelity } from './fidelity.js';
import { recognizeHeading } from './headings.js';
import { classifyHeader } from './sections.js';
import { isCareerNote } from './experience.js';
import { serializeToText, normalizeDoc } from '../model.js';
import { extractResumeFile } from '../extract/index.js';
import { atsCheck } from '../render/atsCheck.js';
import { rewriteKeepsMeaning } from '../health/meaningGuard.js';
import { scoreResume } from '../health/score.js';

const root = new URL('../../../', import.meta.url);
const read = (rel) => fs.readFileSync(new URL(rel, root), 'utf8');
const parse = (text) => parseResume({ text, source: 'text' });
const allText = (d) => serializeToText(d);

// ── the heading recogniser ──────────────────────────────────────────────────────────────────────
const HEADINGS = [
  ['LICENSES / CERTS', 'certifications'], ['Licenses/Certs', 'certifications'], ['LICENSES & CERTIFICATIONS', 'certifications'],
  ['Licences & Certifications', 'certifications'], ['CERTS', 'certifications'], ['Certs', 'certifications'], ['CREDENTIALS', 'certifications'],
  ['PROFESSIONAL LICENSES', 'certifications'], ['Professional Licenses & Certifications', 'certifications'], ['LICENSURE', 'certifications'],
  ['Certificates', 'certifications'], ['CERTIFICATIONS / LICENSES', 'certifications'], ['Licenses and Certificates', 'certifications'],
  ['Certifications + Licenses', 'certifications'], ['NURSING LICENSES', 'certifications'], ['SAFETY CERTIFICATIONS', 'certifications'],
  ['Training & Certifications', 'certifications'], ['TRAINING / CERTIFICATIONS', 'certifications'], ['Courses', 'certifications'],
  ['PROFESSIONAL DEVELOPMENT', 'certifications'], ['Certifications & Training', 'certifications'], ['Credentials & Licenses', 'certifications'],
  ['TRAINING', 'education'], ['EDUCATION', 'education'], ['Education & Training', 'education'], ['ACADEMIC BACKGROUND', 'education'],
  ['Education / Certifications', 'education'],
  ['ADDITIONAL INFORMATION', 'custom'], ['Additional Info', 'custom'], ['CAREER BREAK', 'custom'], ['Career Break', 'custom'],
  ['EMPLOYMENT GAP', 'custom'], ['NOTES', 'custom'], ['Notes', 'custom'], ['MISCELLANEOUS', 'custom'], ['Other Information', 'custom'],
  ['VOLUNTEER', 'volunteer'], ['Volunteer Work', 'volunteer'], ['VOLUNTEERING & COMMUNITY', 'volunteer'], ['Community Service', 'volunteer'],
  ['AFFILIATIONS', 'affiliations'], ['Professional Affiliations', 'affiliations'], ['Memberships & Associations', 'affiliations'],
  ['LANGUAGES', 'languages'], ['Language Skills', 'languages'], ['Languages Spoken', 'languages'],
  ['PROJECTS', 'projects'], ['Selected Projects', 'projects'], ['Key Projects', 'projects'],
  ['SKILLS', 'skills'], ['Technical Skills', 'skills'], ['Skills & Abilities', 'skills'], ['Core Competencies', 'skills'],
  ['Tools / Technologies', 'skills'], ['Skills Summary', 'skills'], ['Key Skills & Strengths', 'skills'],
  ['SUMMARY', 'summary'], ['Professional Summary', 'summary'], ['Summary of Qualifications', 'summary'], ['PROFILE', 'summary'],
  ['EXPERIENCE', 'experience'], ['WORK HISTORY', 'experience'], ['Employment History', 'experience'], ['Professional Experience', 'experience'],
  ['AWARDS & HONORS', 'awards'], ['Honours', 'awards'], ['Achievements', 'awards'],
  ['Publications', 'publications'], ['Interests & Hobbies', 'interests'], ['HOBBIES', 'interests'], ['REFERENCES', 'references'],
];

test(`heading recogniser: ${HEADINGS.length} real-world headings read as their section`, () => {
  assert.ok(HEADINGS.length >= 60);
  const bad = [];
  for (const [text, kind] of HEADINGS) {
    const h = classifyHeader({ text, bullet: false, gapAbove: 1 }, { bodySize: 0 }, { allowCustom: true });
    if (!h || h.kind !== kind) bad.push(`${text} → ${h ? h.kind : 'none'} (want ${kind})`);
  }
  assert.deepEqual(bad, []);
});

test('heading recogniser: titles, employers, sentences and composites are not headings', () => {
  const NOT = ['Training Coordinator', 'TRAINING COORDINATOR', 'Volunteer Coordinator', 'Career Education Corp', 'Community Health Center',
    'Service Experts', 'Skills and Experience', 'Journeyman Electrician', 'Registered Nurse', 'Work Horse Studios',
    'Licensed to drive forklifts since 2019.', 'Valid AZ driver\'s license'];
  for (const t of NOT) assert.equal(recognizeHeading(t, { structural: true }), null, t);
  // a field word needs typography and no date line below it
  assert.equal(recognizeHeading('Safety Certifications', { structural: false }), null);
  assert.equal(recognizeHeading('SAFETY CERTIFICATIONS', { structural: true, nextHasDate: true }), null);
});

// ── the three persona cases ─────────────────────────────────────────────────────────────────────
test('electrician: LICENSES / CERTS keeps all four items, no headline, the title-led summary is kept', () => {
  const src = read('lib/fixtures/personas/electrician.txt');
  const d = parse(src);
  assert.equal(d.basics.headline, '', 'a heading is never a headline');
  assert.deepEqual(d.certifications.map((c) => c.name), ['Arizona Journeyman Electrician (Phoenix)', 'OSHA 30', 'NFPA 70E training', "Valid AZ driver's license, clean record"]);
  assert.match(d.basics.summary, /^Journeyman electrician with 8 years in the trade, commercial and some industrial\. Safe, reliable, own tools and truck\. Looking for steady commercial work or a foreman spot\.$/);
  assert.equal(d.education[0].school, 'IEC Arizona Apprenticeship Program');
  assert.match(allText(d), /IEC Arizona Apprenticeship Program \| Completed 2021/);
  assert.ok(!allText(d).split('\n').some((l) => l.trim() === '• completed'));
  const f = d.meta.fidelity;
  assert.equal(f.unplaced.length, 0); assert.equal(f.placed, f.total);
});

test('admin: the career-break note is kept word for word, never a role', () => {
  const d = parse(read('lib/fixtures/personas/admin.txt'));
  const note = '(2024 – present: caring for a family member; volunteer bookkeeper for St. Raphael Parish, 5 hrs/week, QuickBooks)';
  assert.deepEqual(d.experience.map((e) => e.title), ['Office Manager', 'Executive Assistant to the CFO', 'Receptionist']);
  const x = d.extra.find((s) => s.title === 'Additional Information');
  assert.ok(x, 'notes section');
  assert.deepEqual(x.items.map((i) => i.text), [note]);
  assert.ok(allText(d).includes(`• ${note}`));
  assert.ok(d.meta.warnings.some((w) => w.code === 'career_note'));
  // the stored text keeps it on every save
  assert.ok(allText(parse(allText(d))).includes(note));
});

test('warehouse: the layoff note is a note (not a job heading), the forklift certification keeps its parenthetical', () => {
  const d = parse(read('lib/fixtures/personas/warehouse.txt'));
  assert.deepEqual(d.experience.map((e) => [e.title, e.start, e.end]), [
    ['Warehouse Associate / Inventory Control', '2021', 'present'], ['Material Handler', '2019', '2020'], ['Crew Member', '2016', '2019']]);
  assert.ok(!d.meta.warnings.some((w) => w.code === 'role_no_company'));
  const x = d.extra.find((s) => s.title === 'Additional Information');
  assert.deepEqual(x.items.map((i) => i.text), ['Laid off 2020 (plant cutbacks); did DoorDash deliveries 2020 - 2021']);
  assert.equal(d.certifications.length, 1);
  assert.equal(d.certifications[0].name, 'Forklift certified (OSHA, renewed 2024)');
  assert.equal(d.certifications[0].date, '2024');
  assert.ok(allText(d).includes('• Forklift certified (OSHA, renewed 2024)\n'), 'printed once, parentheses intact');
  assert.ok(!/\(OSHA, renewed \|/.test(allText(d)));
});

test('certifications: lists, issuers in parentheses, "·" between two credentials', () => {
  const nurse = parse(read('lib/fixtures/personas/nurse.txt'));
  assert.ok(nurse.certifications.some((c) => c.name === 'BLS, ACLS (American Heart Association)' && !c.issuer));
  const rn = parse(read('lib/fixtures/personas/rn-home-health.txt'));
  assert.deepEqual(rn.certifications.map((c) => c.name), ['Active RN license (AZ, compact)', 'BLS']);
  const acc = parse(read('lib/fixtures/personas/accountant.txt'));
  assert.deepEqual([acc.certifications[0].name, acc.certifications[0].date], ['Certified Public Accountant (Illinois)', '2022']);
  // "Expected" is never printed as a plain (past) date
  assert.match(allText(nurse), /Grand Canyon University \| Expected 2027/);
  // an honour after the year is a detail; the year stays the degree's date
  assert.match(allText(acc), /B\.S\., Accountancy — DePaul University \| 2020\n• cum laude/);
});

test('career notes: gap lines in their usual shapes; real roles are not notes', () => {
  for (const t of ['2020–2021: Career break — caregiving', 'Laid off 2020, took classes until 2021', 'Career Break | 2019 – 2021',
    '(2018 – 2020: stay-at-home parent)', 'Parental leave, Mar 2022 – Jan 2023']) assert.equal(isCareerNote(t), true, t);
  for (const t of ['Caregiver — Home Instead Senior Care | 2019 – 2021', 'Registered Nurse — Banner Health | 2019 – 2021',
    '(Promoted to lead in 2021)', 'Retained through 2020 layoffs']) assert.equal(isCareerNote(t), false, t);
  const d = parse('Sam Rivera\nsam@example.com\n\nEXPERIENCE\nCook — Diner Co | 2021 – Present\n• Line cook\n\n2020–2021: Career break — caregiving\n\nDishwasher — Grill House | 2018 – 2020\n• Washed dishes\n');
  assert.deepEqual(d.experience.map((e) => e.title), ['Cook', 'Dishwasher']);
  assert.ok(allText(d).includes('• 2020–2021: Career break — caregiving'));
});

test('an unheaded title-led summary is a summary', () => {
  const d = parse('Jordan Lee\nPhoenix, AZ | jordan@example.com | (602) 555-0142\n\nRegistered nurse with 6 years in med-surg and telemetry. Calm under pressure and careful with charting.\n\nEXPERIENCE\nRegistered Nurse — Banner Health | 2019 – Present\n• Cared for 5 patients per shift\n');
  assert.match(d.basics.summary, /^Registered nurse with 6 years in med-surg and telemetry\./);
  assert.equal(d.basics.headline, '');
});

test('the parser never drops a line silently: anything unclassified is kept and named', () => {
  // a line the parser has no home for sits in the header block between two role-shaped lines
  const src = 'Alex Kim\nalex@example.com\n\nKEY FACTS ABOUT ME\nI hold 2 patents\n\nEXPERIENCE\nAnalyst — Acme Corp | 2020 – Present\n• Built reports\n';
  const d = parse(src);
  const f = parseFidelity(src, d);
  assert.equal(f.unplaced.length, 0, JSON.stringify(f.unplaced));
  assert.ok(allText(d).includes('I hold 2 patents'));
});

// ── property: every fixture, every source line placed, order kept, round trip stable ─────────────
const TEXT_FIXTURES = [
  ...fs.readdirSync(new URL('lib/fixtures/personas/', root)).filter((f) => f.endsWith('.txt') && !f.includes('-jd')).map((f) => `lib/fixtures/personas/${f}`),
  ...fs.readdirSync(new URL('lib/resume/fixtures/text/', root)).filter((f) => f.endsWith('.txt')).map((f) => `lib/resume/fixtures/text/${f}`),
];
const PDF_FIXTURES = ['lib/fixtures/personas/dev.pdf', 'lib/fixtures/personas/maria.pdf', 'lib/fixtures/personas/tasha.pdf', 'lib/resume/fixtures/word.pdf', 'lib/resume/fixtures/twocol.pdf', 'lib/resume/fixtures/twopage.pdf'];

function checkOrder(name, src, d) {
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const S = norm(src);
  const runs = [...d.experience.map((e) => e.bullets.map((b) => b.text)), ...d.extra.map((x) => x.items.map((i) => i.text)), ...d.projects.map((p) => p.bullets.map((b) => b.text))];
  for (const run of runs) {
    let last = -1;
    for (const t of run) {
      const at = S.indexOf(norm(t).slice(0, 40));
      if (at < 0) continue; // a wrapped / rejoined line: placement is checked by the accounting above
      assert.ok(at > last, `${name}: "${t.slice(0, 50)}" out of source order`);
      last = at;
    }
  }
}

test(`property: ${TEXT_FIXTURES.length} text fixtures — no source line lost, order kept, round trip stable`, () => {
  for (const f of TEXT_FIXTURES) {
    const src = read(f);
    const d = parse(src);
    const fid = parseFidelity(src, d);
    assert.deepEqual(fid.unplaced.map((u) => u.line), [], `${f}: unplaced`);
    assert.equal(d.meta.fidelity.unplaced.length, 0, `${f}: meta.fidelity`);
    checkOrder(f, src, d);
    const once = serializeToText(d);
    assert.equal(serializeToText(parse(once)), once, `${f}: parse(serialize(doc)) is stable`);
    // a stored résumé (the canonical text) reads back with every line placed
    assert.equal(parseFidelity(once, parse(once)).unplaced.length, 0, `${f}: stored text`);
  }
});

test('property: PDF fixtures through the real extractor — no source line lost, round trip stable', async () => {
  for (const f of PDF_FIXTURES) {
    const ex = await extractResumeFile({ buffer: fs.readFileSync(new URL(f, root)), fileName: path.basename(f) });
    assert.equal(ex.ok, true, f);
    const d = parseResume({ text: ex.text, lines: ex.lines, source: ex.fileType, layout: ex.layout });
    assert.deepEqual(parseFidelity(ex.text, d).unplaced.map((u) => u.line), [], `${f}: unplaced`);
    const once = serializeToText(d);
    assert.equal(serializeToText(parse(once)), once, `${f}: stable`);
  }
});

test('meta.fidelity survives normalizeDoc', () => {
  const d = parse(read('lib/fixtures/personas/admin.txt'));
  const n = normalizeDoc(JSON.parse(JSON.stringify(d)));
  assert.deepEqual([n.meta.fidelity.placed, n.meta.fidelity.total], [d.meta.fidelity.placed, d.meta.fidelity.total]);
});

// ── the ATS check tells the truth ────────────────────────────────────────────────────────────────
test('ATS check: against the source, a removed line cannot score 100 / A and is named', async () => {
  const src = read('lib/fixtures/personas/electrician.txt');
  const d = parse(src);
  const clean = await atsCheck(d, { format: 'txt', source: src });
  assert.equal(clean.score, 100);
  assert.equal(clean.source.unplaced.length, 0);
  // the old damage: the licences section is gone from the document
  const damaged = JSON.parse(JSON.stringify(d));
  damaged.certifications = damaged.certifications.filter((c) => c.name !== 'OSHA 30');
  const r = await atsCheck(damaged, { format: 'txt', source: src });
  assert.ok(r.score < 95 && r.grade !== 'A', `score ${r.score} ${r.grade}`);
  assert.ok(r.failed.includes('source_lines'));
  assert.match(r.checks.find((c) => c.code === 'source_lines').detail, /OSHA 30/);
});

// ── Health never offers a fix that changes a word's meaning ──────────────────────────────────────
test('meaning guard: "Wound care" is never "Wind care"; participles after a comma stay', () => {
  assert.equal(rewriteKeepsMeaning('Wound care for 20+ patients a day across 2 units.', 'Wind care for 20+ patients a day across 2 units.').ok, false);
  assert.equal(rewriteKeepsMeaning('Wound vac placement and dressing changes', 'Wind vac placement and dressing changes').ok, false);
  assert.equal(rewriteKeepsMeaning('Completed medication reconciliation, documented in HCHB', 'Complete medication reconciliation, document in HCHB').ok, false);
  assert.equal(rewriteKeepsMeaning('Found 3 billing errors a week', 'Find 3 billing errors a week').ok, true);
  assert.equal(rewriteKeepsMeaning('Responsible for month-end close for 3 entities', 'Ran month-end close for 3 entities').ok, true);
  assert.equal(rewriteKeepsMeaning('Increased sales by 50 percent', 'Increased sales by 50%').ok, true);
  const d = parse('Pat Doe\npat@example.com\n\nEXPERIENCE\nWound Care Nurse — Banner Health | 2021 – Present\n• Wound care for 20+ patients a day across 2 units\n• Wound vac placement and dressing changes for post-op patients\n');
  const fixes = JSON.stringify(scoreResume(d));
  assert.ok(!/Wind (?:care|vac)/.test(fixes), 'no Health fix offers "Wind"');
});

// ── Round 2 (coordinator, 2026-11-10): lines filed by what they say, never a heading as an employer ──
test('Dana: "Tickets and training" lines are a certification and education, never jobs; no-comma places', () => {
  const src = ['Dana Whitfield', 'dana.whitfield@example.com | 602 555 0144 | Mesa AZ', '', "What I've done",
    '2019 - now     Shift Supervisor, Copper State Logistics, Phoenix AZ',
    'Run a 14 person second shift in a 300k sq ft cross-dock. Cut mis-ships from 2.1% to 0.6% in a year by adding a scan check at the dock door.',
    'Trained 30+ new hires on RF scanners and the WMS (Manhattan).', '2015 - 2019    Forklift Operator, Copper State Logistics',
    'Sit-down, reach truck and cherry picker. Zero recordable incidents in four years.', "2013-2015 Stocker - Bashas' (Tempe)", '',
    'Took 2012 off to care for a parent.', '', 'Tickets and training', 'OSHA forklift cert (renewed 2025); First aid / CPR',
    'Rio Salado College - some coursework, business, 2011', '', 'What I know',
    'Manhattan WMS, RF scanning, cycle counts, Excel (pivot tables), Spanish (conversational)'].join('\n');
  const d = parse(src);
  assert.deepEqual(d.experience.map((e) => [e.title, e.company, e.location]), [
    ['Shift Supervisor', 'Copper State Logistics', 'Phoenix AZ'], ['Forklift Operator', 'Copper State Logistics', 'Phoenix AZ'], ['Stocker', "Bashas'", 'Tempe']]); // a second role at one employer takes its place (round 4)
  assert.equal(d.basics.location, 'Mesa AZ'); assert.equal(d.basics.headline, '');
  assert.deepEqual(d.certifications.map((c) => c.name), ['OSHA forklift cert (renewed 2025)', 'First aid / CPR']);
  assert.equal(d.education[0].school, 'Rio Salado College');
  // one form per section: both roles' glyph-less lines are items of the same kind
  assert.equal(d.experience[1].bullets.length, 1); assert.equal(d.experience[1].summary, '');
  assert.ok(d.meta.fidelity.uncertain.some((u) => /Rio Salado/.test(u.line) && u.placedIn === 'education'));
  assert.equal(d.meta.fidelity.unplaced.length, 0);
});

test('a no-comma "City ST" is a location, never part of the employer', () => {
  const e = parse(read('lib/fixtures/personas/electrician.txt'));
  assert.deepEqual(e.experience.map((r) => [r.company, r.location]), [['Sunbelt Electric Contractors', 'Phoenix AZ'], ['Valley Wide Electric', 'Tempe AZ'], ['Home Depot DC', 'Tolleson AZ']]);
});

const H = {
  experience: ['EXPERIENCE', 'Work History', "What I've done", "Where I've worked", 'Jobs', 'Background', 'EMPLOYMENT', 'Career History', 'Professional Experience', 'WORK', 'Jobs Held', 'Relevant Experience'],
  certs: ['Tickets and training', 'LICENSES / CERTS', 'Certs', 'Credentials', 'Tickets', 'Licences & Tickets', 'Training', 'Professional Licenses', 'CERTIFICATIONS', 'Stuff I hold', 'Permits and cards', 'Safety Training'],
  education: ['EDUCATION', 'Schooling', 'Quals', 'Training & Education', 'Academic Background', 'Where I studied', 'School', 'EDUCATION / TRAINING', 'Studies', 'Learning', 'Education and Courses', 'Coursework'],
  skills: ['SKILLS', 'What I know', "Things I'm good at", 'Toolbox', 'Strengths', 'Core Skills', 'Abilities', 'Tools', 'Know-how', 'Expertise', 'Skill Set', 'Competencies'],
};
const CERT_LINES = ['OSHA 10 card (2023)', 'Forklift certified (renewed 2024)', 'First Aid / CPR', 'Arizona Fingerprint Clearance Card', 'ServSafe Food Handler, 2022'];
const SCHOOL_LINES = ['Mesa Community College - some coursework, 2012', 'Desert Vista High School, Diploma, 2010', 'GED, 2011'];

test('property: 144 generated résumés — no credential or school line is ever a job, no heading is ever a title or employer', () => {
  let n = 0;
  for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) {
    const eh = H.experience[i], ch = H.certs[j], dh = H.education[(i + j) % 12], sh = H.skills[(i * 5 + j) % 12];
    const mixed = (i + j) % 3 === 0; // a heading holding both credentials and schooling
    const certs = [CERT_LINES[j % 5], CERT_LINES[(j + 2) % 5]], schools = [SCHOOL_LINES[i % 3]];
    const lines = ['Jamie Cruz', 'jamie.cruz@example.com | (480) 555-0100 | Mesa AZ', '', eh,
      'Lead Stocker — Fry\'s Food Stores, Mesa AZ | 2019 – Present', '• Run the overnight freight crew of 6', '• Cut backstock 30% in a year',
      'Cashier — Walgreens | 2016 – 2019', '• Handled 150+ transactions a shift', ''];
    if (mixed) lines.push(ch, ...certs, ...schools, '');
    else lines.push(ch, ...certs, '', dh, ...schools, '');
    lines.push(sh, 'Forklift, RF scanners, cycle counts, Spanish');
    const src = lines.join('\n');
    const d = parse(src);
    const where = `[${eh} / ${ch} / ${mixed ? 'mixed' : dh}]`;
    const jobText = d.experience.map((e) => [e.title, e.company, ...e.bullets.map((b) => b.text)].join(' | ')).join(' || ');
    for (const l of [...certs, ...schools]) assert.ok(!jobText.includes(l.split(/[,(]/)[0].trim()), `${where} "${l}" filed as a job: ${jobText}`);
    for (const h of [eh, ch, dh, sh]) assert.ok(!d.experience.some((e) => e.title === h || e.company === h), `${where} heading "${h}" became a title/employer`);
    assert.equal(d.experience.length, 2, `${where} roles: ${jobText}`);
    for (const l of certs) assert.ok(d.certifications.some((c) => c.text.includes(l.split(' (')[0].split(',')[0])), `${where} cert "${l}" missing`);
    for (const l of schools) assert.ok(d.education.some((e) => `${e.school} ${e.degree} ${e.field}`.includes(l.split(/\s[-,]/)[0].split(',')[0])), `${where} school "${l}" missing from education`);
    assert.equal(parseFidelity(src, d).unplaced.length, 0, `${where} unplaced`);
    n++;
  }
  assert.equal(n, 144);
});

test('round 2 layouts: one-line header, prose roles, stay-at-home gap, sentence summary, qualified cert dates', () => {
  const cook = parse('Marco Rossi — Line Cook — marco.rossi@example.com — 773-555-0177 — Chicago IL\n\nKitchen jobs\nLine Cook, Avec, Chicago IL, 2021-present: saute and wood oven, 180 covers a night, trained 2 new cooks\nPrep Cook, Lou Malnati\'s, Chicago IL, 2018-2021: prepped dough, sauces and proteins for 3 locations\n\nTickets\nServSafe Manager (2024), Allergen Awareness (2024)\n');
  assert.equal(cook.basics.name, 'Marco Rossi'); assert.equal(cook.basics.headline, 'Line Cook'); assert.equal(cook.basics.location, 'Chicago IL');
  assert.deepEqual(cook.experience.map((e) => [e.title, e.company, e.location, e.start]), [['Line Cook', 'Avec', 'Chicago IL', '2021'], ['Prep Cook', "Lou Malnati's", 'Chicago IL', '2018']]);
  assert.deepEqual(cook.certifications.map((c) => [c.name, c.date]), [['ServSafe Manager', '2024'], ['Allergen Awareness', '2024']]);
  assert.equal(cook.meta.fidelity.unplaced.length, 0);
  const lpn = parse('Grace Okafor, LPN\nHouston TX · 713-555-0172 · grace@example.com\n\nBackground\nLPN at Bayou Rehab Center, Houston TX, 2021 to present. Pass meds for 24 residents, wound care, G-tube feeds, and family updates.\n\nMedical Assistant at Memorial Family Clinic, 2018 to 2021. Roomed patients, vitals, injections and EKGs.\n');
  const body = (e) => [e.summary, ...e.bullets.map((b) => b.text)].filter(Boolean).join(' ').slice(0, 12);
  assert.deepEqual(lpn.experience.map((e) => [e.title, e.company, body(e)]), [['LPN', 'Bayou Rehab Center', 'Pass meds fo'], ['Medical Assistant', 'Memorial Family Clinic', 'Roomed patie']]);
  assert.equal(new Set(lpn.experience.map((e) => (e.bullets.length ? 'bullets' : 'paragraph'))).size, 1, 'one form for both roles');
  assert.ok(!/,\s*\./.test(allText(lpn)), 'no ", ." left where a date was cut out');
  const gap = parse('Hannah Lee\nhannah@example.com\n\nExperience\nFront Desk Receptionist, Northside Family Medicine, Minneapolis MN — 2014 to 2019\n- Checked in 60+ patients a day\n\n2019 - 2024: Stayed home to raise two children. PTA treasurer 2021–2023.\n');
  assert.equal(gap.experience.length, 1); assert.ok(gap.meta.warnings.some((w) => w.code === 'career_note'));
  const hvac = parse('Luis Herrera\nPhoenix AZ · 602-555-0157 · luis@example.com\n\nHVAC service tech, 6 years residential and light commercial. EPA 608 Universal.\n\nDesert Air Heating & Cooling, Phoenix AZ — Service Technician, 2020 – present\nRun 5–7 service calls a day; diagnose compressors, capacitors and refrigerant leaks\n\nEPA 608 Universal certification\nNATE Core (2021)\n');
  assert.equal(hvac.basics.headline, ''); assert.match(hvac.basics.summary, /^HVAC service tech, 6 years/);
  assert.equal(hvac.experience[0].bullets.length, 1);
  assert.ok(hvac.certifications.some((c) => c.name === 'EPA 608 Universal certification'));
  const w = parse('Ray K\nray@example.com\n\nTickets\nASME Section IX 6G pipe, renewed 2024\nBLS for Healthcare Providers - AHA - exp 06/2026\n');
  assert.ok(allText(w).includes('ASME Section IX 6G pipe, renewed 2024')); assert.ok(allText(w).includes('exp 06/2026'));
});

// ── Round 2b: the coordinator's hidden-set classes, each in several wordings, as text AND as a file ──
import PDFDocument from 'pdfkit';
import { companyLabel, displayCase } from '../model.js';

function pdfFromLines(lines, { sidebar = null } = {}) {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 50 });
    const bufs = []; doc.on('data', (b) => bufs.push(b)); doc.on('end', () => resolve(Buffer.concat(bufs)));
    const mainX = sidebar ? 230 : 50, mainW = sidebar ? 330 : 510;
    if (sidebar) { let sy = 50; for (const l of sidebar) { if (!l) { sy += 8; continue; } const h = /^[A-Z &/]{4,}$/.test(l); doc.font(h ? 'Helvetica-Bold' : 'Helvetica').fontSize(h ? 11 : 9.5).text(l, 50, sy, { width: 150 }); sy = doc.y + (h ? 4 : 2); } }
    let y = 50;
    for (const raw of lines) {
      if (!raw.trim()) { y += 8; continue; }
      const heading = /^[A-Z][A-Z &/']{3,}$/.test(raw.trim()) && raw.trim().split(/\s+/).length <= 3;
      const bullet = /^[-•]\s/.test(raw);
      // a date flushed right after a wide gap, as a word processor lays it out; other gaps stay in the line
      const m0 = raw.match(/^(.*\S)\s{3,}(\S.{0,24})$/);
      const m = m0 && /(?:19|20)\d{2}|present/i.test(m0[2]) ? m0 : null;
      doc.font(heading ? 'Helvetica-Bold' : 'Helvetica').fontSize(heading ? 12 : 10);
      if (m && !bullet) { doc.text(m[1], mainX, y, { width: mainW - 130, lineBreak: false }); doc.text(m[2], mainX + mainW - 130, y, { width: 130, align: 'right', lineBreak: false }); y += 14; }
      else { doc.text(bullet ? `•  ${raw.replace(/^[-•]\s/, '')}` : raw, bullet ? mainX + 10 : mainX, y, { width: bullet ? mainW - 10 : mainW }); y = doc.y + 2; }
      if (heading) y += 3;
    }
    doc.end();
  });
}
async function parsePdf(lines, opts) {
  const ex = await extractResumeFile({ buffer: await pdfFromLines(lines, opts), fileName: 'x.pdf' });
  return parseResume({ text: ex.text, lines: ex.lines, source: 'pdf', layout: ex.layout });
}
const roleRows = (d) => d.experience.map((e) => [e.title, e.company, e.start, e.end, e.bullets.length]);
const HEAD = (name) => [name, `${name.toLowerCase().replace(/\s+/g, '.')}@example.com | 602-555-0100 | Phoenix, AZ`, ''];

const CLASS_CASES = {
  // 1. an employer line above its roles (with a descriptor, a location, a site line)
  employerBlock: [
    [...HEAD('Jordan Blake'), 'EXPERIENCE', 'Acme Freight (logistics software, Series C) | Denver, CO', 'Account Executive, Mid-Market   2023 – Present', '- Closed $1.4M new ARR in 2024', 'Sales Development Rep   2021 – 2023', '- Booked 25 meetings a month', '', 'Summit Bank | Boulder, CO', 'Teller   2019 – 2021', '- Balanced a $40K drawer daily'],
    [...HEAD('Priya Nair'), 'WORK HISTORY', '', 'TARGET', 'Southpark location', 'Guest Advocate (Team Lead)   Jun 2022 – Present', '• Lead 6 cashiers on the evening shift', 'Cashier   Aug 2020 – Jun 2022', '• Rang up 300+ guests a shift', '', 'Starbucks — Dallas, TX', 'Barista   2018 – 2020', '• Opened the store 4 days a week'],
    [...HEAD('Chris Moreno'), 'Experience', '', 'Banner Health, Phoenix AZ', 'Charge Nurse, Med-Surg — 2022 to present', '- Lead a team of 6 RNs on nights', 'Staff RN, Med-Surg — 2019 to 2022', '- Cared for 5-6 patients a shift', '', 'HonorHealth', 'Patient Care Tech — 2017 to 2019', '- Turned and repositioned patients every 2 hours'],
  ],
  // 3. two adjacent jobs with stacked headers and glyph-less duties
  adjacentJobs: [
    [...HEAD('Leah Kim'), 'EXPERIENCE', 'Medical Assistant', 'Peachtree Pediatrics, Atlanta, GA', 'March 2022 – Present', 'Room patients, vitals, vaccines for 30+ kids a day', 'Prior authorizations and refill requests in athenahealth', 'Medical Assistant', 'Midtown Family Clinic, Atlanta, GA', 'June 2019 – February 2022', 'Drew blood and ran point-of-care tests', 'Scheduled 80+ appointments a day at the front desk'],
    [...HEAD('Maya Ford'), 'EXPERIENCE', 'Dental Assistant', 'Bright Smiles Dental', '2021 – Present', 'Took and developed X-rays for 20 patients a day', 'Sterilized instruments and set up operatories', 'Dental Assistant', 'Desert Family Dentistry', '2018 – 2021', 'Charted perio exams for the hygienists', 'Handled insurance verification at the front desk'],
    [...HEAD('Ana Lopez'), 'EXPERIENCE', 'Pharmacy Technician', 'Walgreens, Tempe AZ', '2020 – Present', 'Filled 250+ prescriptions a shift', 'Ran insurance claims and resolved rejections', 'Pharmacy Technician', 'CVS Pharmacy, Mesa AZ', '2017 – 2020', 'Counted and labeled medications', 'Managed the drive-thru window'],
  ],
};

test('classes 1 and 3 (employer above roles, adjacent jobs): right roles in text AND in the generated PDF', async () => {
  const want = {
    employerBlock: [
      [['Account Executive, Mid-Market', 'Acme Freight'], ['Sales Development Rep', 'Acme Freight'], ['Teller', 'Summit Bank']],
      [['Guest Advocate (Team Lead)', 'TARGET'], ['Cashier', 'TARGET'], ['Barista', 'Starbucks']],
      [['Charge Nurse, Med-Surg', 'Banner Health'], ['Staff RN, Med-Surg', 'Banner Health'], ['Patient Care Tech', 'HonorHealth']],
    ],
    adjacentJobs: [
      [['Medical Assistant', 'Peachtree Pediatrics'], ['Medical Assistant', 'Midtown Family Clinic']],
      [['Dental Assistant', 'Bright Smiles Dental'], ['Dental Assistant', 'Desert Family Dentistry']],
      [['Pharmacy Technician', 'Walgreens'], ['Pharmacy Technician', 'CVS Pharmacy']],
    ],
  };
  for (const [cls, cases] of Object.entries(CLASS_CASES)) {
    for (let i = 0; i < cases.length; i++) {
      const t = parse(cases[i].join('\n'));
      assert.deepEqual(t.experience.map((e) => [e.title, e.company]), want[cls][i], `${cls}[${i}] text`);
      assert.equal(t.meta.fidelity.unplaced.length, 0, `${cls}[${i}] text unplaced`);
      const p = await parsePdf(cases[i]);
      assert.deepEqual(roleRows(p), roleRows(t), `${cls}[${i}]: the PDF and the text give the same roles`);
    }
  }
  assert.equal(parse(CLASS_CASES.employerBlock[0].join('\n')).experience[0].companyNote, '(logistics software, Series C)');
  assert.equal(parse(CLASS_CASES.employerBlock[1].join('\n')).experience[0].location, 'Southpark location');
});

test('class 2: a descriptor beside the employer is its companyNote; no field ever holds an unbalanced bracket', () => {
  const docs = [
    [...HEAD('Sam Rivera'), 'EXPERIENCE', 'Lantern Digital (agency, 12 people) — Portland, OR', 'Senior Designer | 2021 – Present', '- Led rebrands for 9 clients', 'BrightPay Software, payroll SaaS (Series A) — Remote', 'Product Designer | 2018 – 2021', '- Designed onboarding for 40k employers'],
    [...HEAD('Ana Ortiz'), 'Experience', 'Marketing Manager — Fieldnote Co. (B2B SaaS, ~80 employees), Chicago, IL | 2022 – Present', '• Grew inbound pipeline 60%', 'Marketing Coordinator — Hearth & Home (home goods retailer) | 2019 – 2022', '• Ran the email program'],
    [...HEAD('Lee Park'), 'EXPERIENCE', 'Analyst, Northwind (fintech, acquired 2023) | 2020 – 2023', '- Built the risk dashboard'],
  ].map((l) => parse(l.join('\n')));
  assert.deepEqual(docs[0].experience.map((e) => [e.company, e.companyNote]), [['Lantern Digital', '(agency, 12 people)'], ['BrightPay Software', 'payroll SaaS (Series A)']]);
  assert.deepEqual(docs[1].experience.map((e) => [e.company, e.companyNote]), [['Fieldnote Co.', '(B2B SaaS, ~80 employees)'], ['Hearth & Home', '(home goods retailer)']]);
  assert.equal(companyLabel(docs[0].experience[1]), 'BrightPay Software, payroll SaaS (Series A)');
  const bal = (v) => { let n = 0; for (const c of String(v)) { if (c === '(') n++; if (c === ')') n--; if (n < 0) return false; } return n === 0; };
  for (const d of docs) for (const e of d.experience) for (const k of ['title', 'company', 'companyNote', 'location', 'employmentType']) assert.ok(bal(e[k]), `${k}: "${e[k]}"`);
  for (const d of docs) { const once = allText(d); assert.equal(allText(parse(once)), once, 'stable'); assert.equal(d.meta.fidelity.unplaced.length, 0); }
});

test('class 4: volunteer, teaching, committees and preceptor lines are never jobs', () => {
  const d = parse(['Angela Ruiz, RN', 'Mesa, AZ | angela@example.com | 480-555-0193', '', 'EXPERIENCE', 'Registered Nurse, Telemetry — Mountain Vista Medical Center | Aug 2022 – Present', '• Care for 4-5 telemetry patients per shift', 'Unit Practice Council member, 2023 – Present', 'Preceptor for new graduate nurses, 2024 – Present', 'Registered Nurse, Med-Surg — Desert Springs Hospital | Jun 2020 – Jun 2022', '• Cared for patients on a 36-bed unit', '', 'VOLUNTEER', 'Mesa Food Bank — sort donations | 2021 – Present', '', 'TEACHING', 'BLS instructor, Banner Training Center, 2023 – Present', '', 'AWARDS', 'DAISY Award nominee, 2023'].join('\n'));
  assert.deepEqual(d.experience.map((e) => e.company), ['Mountain Vista Medical Center', 'Desert Springs Hospital']);
  assert.ok(d.experience[0].bullets.some((b) => /Unit Practice Council/.test(b.text)));
  assert.ok(d.extra.some((x) => x.kind === 'volunteer' && x.items.some((i) => /Mesa Food Bank/.test(i.text))));
  assert.ok(d.extra.some((x) => /teaching/i.test(x.title) && x.items.some((i) => /BLS instructor/.test(i.text))));
  assert.ok(d.meta.fidelity.uncertain.some((u) => /Preceptor/.test(u.line)));
});

test('class 5: a two-column PDF (sidebar: contact, skills, education) reads each column on its own', async () => {
  const sidebar = ['Dana Cruz', 'dana.cruz@example.com', '602-555-0140', 'Phoenix, AZ', '', 'SKILLS', 'Epic', 'Phlebotomy', 'Patient intake', 'Scheduling', 'Spanish', 'Insurance verification', '', 'EDUCATION', 'Phoenix College', 'Medical Assisting Certificate, 2018', '', 'CERTIFICATIONS', 'CCMA (NHA), 2018', 'BLS (AHA), 2024'];
  const main = ['EXPERIENCE', 'Lead Medical Assistant   2021 – Present', 'Desert Valley Pediatrics, Phoenix AZ', '- Train 4 new MAs on rooming and vitals', '- Room 35+ patients a day and give vaccines', '- Manage prior authorizations in Epic', '', 'Medical Assistant   2018 – 2021', 'Banner Urgent Care, Mesa AZ', '- Drew blood and ran point-of-care tests', '- Checked in 60 patients a day at the front desk'];
  const d = await parsePdf(main, { sidebar });
  assert.equal(d.basics.name, 'Dana Cruz');
  assert.deepEqual(roleRows(d), [['Lead Medical Assistant', 'Desert Valley Pediatrics', '2021', 'present', 3], ['Medical Assistant', 'Banner Urgent Care', '2018', '2021', 2]]);
  assert.deepEqual(d.skills.flatMap((g) => g.items), ['Epic', 'Phlebotomy', 'Patient intake', 'Scheduling', 'Spanish', 'Insurance verification']);
  assert.equal(d.education[0].school, 'Phoenix College');
});

test('class 6: ALL-CAPS titles keep their styling in the document and expose normal casing for sentences', () => {
  const d = parse(['MARCUS LEE', 'CHICAGO, IL | MARCUS.LEE@EXAMPLE.COM | 312-555-0140', '', 'EXPERIENCE', 'KITCHEN MANAGER — GIRL & THE GOAT | 2021 – PRESENT', '• RAN A 14-PERSON LINE', 'HVAC TECHNICIAN — COOL AIR LLC | 2015 – 2018', 'CNA — SUNRISE SENIOR LIVING | 2012 – 2015'].join('\n'));
  assert.equal(d.experience[0].title, 'KITCHEN MANAGER');
  assert.deepEqual(d.experience.map((e) => [e.displayTitle, e.displayCompany]), [['Kitchen Manager', 'Girl & the Goat'], ['HVAC Technician', 'Cool Air LLC'], ['CNA', 'Sunrise Senior Living']]);
  assert.equal(displayCase('Registered Nurse, ICU'), 'Registered Nurse, ICU');
});

test('class 7: no field ends in a dangling separator; a qualified date stays with its word', () => {
  const d = parse(['Ray K', 'ray@example.com', '', 'CERTIFICATIONS', 'Forklift certified (sit-down, reach) — renewed 2024', 'OSHA 30 — 2022 —', 'CPR / First Aid |', 'Hazmat endorsement, renewed 2023 |'].join('\n'));
  for (const c of d.certifications) for (const v of [c.name, c.issuer]) assert.ok(!/[|—–,;:]\s*$/.test(v), `"${v}"`);
  assert.ok(allText(d).includes('renewed 2024'));
  assert.deepEqual(d.certifications.find((c) => c.name === 'OSHA 30').date, '2022');
});

test('class 8: the current job is current — tabbed / right-aligned dates, an internship below it', () => {
  const variants = [
    'Senior Staff Accountant\tLakeshore Foods Group, Chicago, IL\tApr 2021\tPresent\n• Month-end close\nAccounting Intern (summer)\tBaird Kessler LLP\t2019\n• Tested controls',
    'Senior Staff Accountant — Lakeshore Foods Group          Apr 2021 – Present\n• Month-end close\nAccounting Intern (summer) — Baird Kessler LLP          Summer 2019\n• Tested controls',
    'Lakeshore Foods Group\nSenior Staff Accountant\nApril 2021 - present\n• Month-end close\nBaird Kessler LLP\nAccounting Intern (summer)\n2019\n• Tested controls',
  ];
  for (const v of variants) {
    const d = parse(`Priya Shah, CPA\npriya@example.com\n\nEXPERIENCE\n${v}\n`);
    assert.deepEqual(d.experience.map((e) => [e.title, e.end === 'present']), [['Senior Staff Accountant', true], ['Accounting Intern (summer)', false]], v.slice(0, 40));
    assert.equal(d.experience[0].start, '2021-04');
  }
});

test('invariant: over every generated and fixture résumé, no heading, skill or sentence is a title or employer, and no field has an unbalanced bracket', () => {
  const HEADINGS = new Set([...Object.values(H).flat(), 'EXPERIENCE', 'Experience', 'WORK HISTORY', 'VOLUNTEER', 'TEACHING', 'AWARDS', 'SKILLS', 'EDUCATION', 'CERTIFICATIONS'].map((h) => h.toLowerCase()));
  const all = [...Object.values(CLASS_CASES).flat().map((l) => l.join('\n')), ...TEXT_FIXTURES.map((f) => read(f))];
  const bal = (v) => { let n = 0; for (const c of String(v)) { if (c === '(') n++; if (c === ')') n--; if (n < 0) return false; } return n === 0; };
  for (const src of all) {
    const d = parse(src);
    const skills = new Set(d.skills.flatMap((g) => g.items.map((i) => i.toLowerCase())));
    for (const e of d.experience) {
      for (const v of [e.title, e.company]) {
        assert.ok(!HEADINGS.has(String(v).toLowerCase()), `heading as a field: "${v}"`);
        assert.ok(!v || !skills.has(v.toLowerCase()) || d.meta.fidelity.uncertain.some((u) => u.line.includes(v)), `skill as a field, unflagged: "${v}"`);
        assert.ok(bal(v), `unbalanced: "${v}"`);
      }
      assert.ok(!(e.company.split(/\s+/).length > 8 && /[.!?]$/.test(e.company)) || d.meta.fidelity.uncertain.length, `sentence as employer: "${e.company}"`);
    }
  }
});

// ── Round 3 ──
test('invariant: every résumé we hold as text AND as a file gives the same roles', async () => {
  for (const name of ['dev', 'maria', 'tasha']) {
    const t = parse(read(`lib/fixtures/personas/${name}.txt`));
    const ex = await extractResumeFile({ buffer: fs.readFileSync(new URL(`lib/fixtures/personas/${name}.pdf`, root)), fileName: `${name}.pdf` });
    const p = parseResume({ text: ex.text, lines: ex.lines, source: 'pdf', layout: ex.layout });
    const rows = (d) => d.experience.map((e) => [e.title, e.company, e.companyNote, e.location, e.start, e.end, e.bullets.length]);
    assert.deepEqual(rows(p), rows(t), name);
  }
});

test('round 3: date-first comma lines, a long role header with a wide gap, combined non-job headings, seasons', () => {
  const a1 = parse(['Mia Torres', 'mia@example.com', '', 'EXPERIENCE', '2022 – Present   Senior Analyst, Harbor Line Logistics (freight, ~$90M revenue), Tacoma, WA', '- Built the lane-profitability model', '2019 – 2022   Analyst, Cascade Foods (grocery distributor, 400 staff), Kent, WA', '- Automated the weekly fill-rate report', 'Summer 2018   Finance Intern, Rainier Bank, Seattle', '- Reconciled 40 GL accounts'].join('\n'));
  assert.deepEqual(a1.experience.map((e) => [e.title, e.company, e.companyNote, e.location, e.start, e.end]), [
    ['Senior Analyst', 'Harbor Line Logistics', '(freight, ~$90M revenue)', 'Tacoma, WA', '2022', 'present'],
    ['Analyst', 'Cascade Foods', '(grocery distributor, 400 staff)', 'Kent, WA', '2019', '2022'],
    ['Finance Intern', 'Rainier Bank', '', 'Seattle', '2018-06', '2018-08']]);
  assert.match(allText(a1), /Finance Intern — Rainier Bank \| Seattle \| Summer 2018/, 'the person\'s own date wording is printed');
  for (const sep of ['                 ', '\t', '     ']) {
    const a2 = parse(`Rosa Diaz\nrosa@example.com\n\nEXPERIENCE\nLead Dental Assistant — Poudre Valley Family Dentistry, Fort Collins, CO          Apr 2022 – Present\n• Assist 3 dentists\n• Take 20+ X-rays a day\n\nFront Office Coordinator (part-time, evenings) – University of Colorado Health Anschutz Outpatient Pavilion Orthopedics Clinic, Aurora, CO${sep}07/2019 - 03/2020\n• Checked in 40 patients a day\n• Scheduled follow-ups in Epic\n• Handled referrals\n`);
    assert.deepEqual(a2.experience.map((e) => [e.title, e.start, e.bullets.length]), [['Lead Dental Assistant', '2022-04', 2], ['Front Office Coordinator', '2019-07', 3]], JSON.stringify(sep));
  }
  const intern = parse('Sam Lee\nsam@example.com\n\nEXPERIENCE\nStaff Accountant — Baird LLP | 2021 – Present\n• Close\nAccounting Intern (summer 2020) — Baird LLP\n• Tested controls\n');
  assert.deepEqual(intern.experience.map((e) => [e.title, e.start, e.end]), [['Staff Accountant', '2021', 'present'], ['Accounting Intern', '2020-06', '2020-08']]);
  for (const h of ['Committees & Teaching', 'Committees and Teaching', 'Leadership & Service', 'Activities & Leadership', 'Service', 'Involvement']) {
    const d = parse(`Angela Ruiz\nangela@example.com\n\nEXPERIENCE\nRegistered Nurse — Mountain Vista Medical Center | Aug 2022 – Present\n• Care for 4-5 patients\n\n${h}\nSafety Council, 2022 – present\nPreceptor, 2020 – present\nTaught the hospital's quarterly "IV Basics" class (2 hours, about 15 nurses each session), 2023 – present\n`);
    assert.deepEqual(d.experience.map((e) => e.company), ['Mountain Vista Medical Center'], h);
    assert.ok(allText(d).includes('Taught the hospital\'s quarterly "IV Basics" class'), h);
  }
  // independent of headings: a sentence or a committee with no employer is never a job, and is asked
  const nj = parse('Kim Lo\nkim@example.com\n\nEXPERIENCE\nTaught the hospital\'s quarterly "IV Basics" class (2 hours, about 15 nurses each session), 2023 – present\nSafety Council, 2022 – present\n');
  assert.equal(nj.experience.length, 0);
  assert.equal(nj.meta.fidelity.uncertain.length, 2);
});

test('round 3 parity: role lines ending in dates, date-first lines and duty lines read the same as text and as PDF', async () => {
  const cases = [
    ['DESHAWN PRICE, LPN', 'Memphis, TN | 901-555-0139 | deshawn@example.com', '', 'EXPERIENCE', 'Licensed Practical Nurse — Graceland Rehab & Nursing — Memphis, TN — 2020–Present', 'Medication pass for 28 residents; wound care; admissions paperwork', 'Floated to the memory care unit 2 nights a week', '', 'CNA — Graceland Rehab & Nursing — 2017–2020', 'ADLs, vitals, turning schedules'],
    ['Kevin Ngata', 'kevin@example.com | 206-555-0177', '', 'EXPERIENCE', '2021 – present   Senior Accountant, Puget Timber Co. (forest products, $400M revenue), Tacoma, WA', '• Own month-end close for 4 entities', '2018 – 2021   Staff Accountant, Rainier Credit Union, Seattle, WA', '• Reconciled 60 GL accounts a month', 'Summer 2017   Audit Intern, Clark Nuber PS, Bellevue, WA'],
    ['Luis Herrera', 'Phoenix AZ · 602-555-0157 · luis@example.com', '', 'HVAC service tech, 6 years residential and light commercial. EPA 608 Universal.', '', 'Desert Air Heating & Cooling, Phoenix AZ — Service Technician, 2020 – present', 'Run 5–7 service calls a day; diagnose compressors, capacitors and refrigerant leaks', 'Top seller of maintenance plans 2023', '', 'Cool Breeze HVAC, Mesa AZ — Installer, 2018 – 2020', 'Installed split systems and package units'],
  ];
  const rows = (d) => d.experience.map((e) => [e.title, e.company, e.start, e.end, e.bullets.length + (e.summary ? e.summary.split('\n').length : 0)]);
  for (const c of cases) {
    const t = parse(c.join('\n'));
    assert.ok(t.experience.length >= 2 && t.experience.every((e) => e.title && e.company && e.start), JSON.stringify(rows(t)));
    assert.deepEqual(rows(await parsePdf(c)), rows(t), c[0]);
  }
});

test('round 3: a dated "Title, Specialty" line with its employer on the line below', async () => {
  const c = ['Brianna Walsh, BSN, RN', 'Denver, CO | bw@example.com | 720-555-0144', '', 'CLINICAL EXPERIENCE', 'Registered Nurse, Cardiovascular ICU                                    June 2019 – Present', 'UCHealth University of Colorado Hospital, Aurora, CO', '• 1:1–1:2 care for post-CABG, valve and LVAD patients', '• Charge nurse 2–3 shifts a month', '', 'Registered Nurse, Medical ICU                                           Aug 2017 – June 2019', 'Denver Health Medical Center, Denver, CO', '• Sepsis, DKA and respiratory failure patients on ventilators', '', 'COMMITTEES & PRECEPTING', 'Unit Practice Council, co-chair (2021 – present)', 'Preceptor for 9 new graduate RNs'];
  const t = parse(c.join('\n'));
  assert.deepEqual(t.experience.map((e) => [e.title, e.company, e.location, e.bullets.length]), [['Registered Nurse, Cardiovascular ICU', 'UCHealth University of Colorado Hospital', 'Aurora, CO', 2], ['Registered Nurse, Medical ICU', 'Denver Health Medical Center', 'Denver, CO', 1]]);
  assert.ok(t.extra.some((x) => /committees/i.test(x.title) && x.items.length === 2));
  const p = await parsePdf(c);
  assert.deepEqual(p.experience.map((e) => [e.title, e.company, e.bullets.length]), t.experience.map((e) => [e.title, e.company, e.bullets.length]));
});

// ── Round 4 ──
import { canonicalResumeText } from '../canonical.js';

test('round 4: a dated title line, then an indented employer line with a site — one role, whatever the separator', async () => {
  const shapes = [
    ['2022 - Present    HEAD BAKER', '                  Blue Door Bakery Group — Midtown location, Raleigh NC', '- Run a 6-person overnight bake team', '2019 - 2022       ASSISTANT BAKER', '                  Blue Door Bakery Group — Midtown location, Raleigh NC', '- Laminated dough for 400 croissants a day', '2016 - 2019       COUNTER STAFF', '                  Sunrise Bagels, Cary NC', '- Opened the shop'],
    ['Jan 2021 - Present    Shift Manager', '                      Kroger | Store #114, Columbus OH', '- Ran front end for 30 cashiers', '2018 - 2020           Cashier', '                      Kroger (Downtown)', '- Rang 250 customers a shift', '2016 - 2018           Assembler', '                      Honda of America - Plant 2, Marysville OH', '- Installed door panels'],
    ['2020 – Present   Line Lead', '   Acme Foods – Unit 4B, Dayton OH', '- Lead 9 on second shift', '2017 – 2020   Packer', '   Acme Foods, Dayton OH', '- Packed 600 cases a shift'],
  ];
  const want = [
    [['HEAD BAKER', 'Blue Door Bakery Group', 'Midtown location, Raleigh NC'], ['ASSISTANT BAKER', 'Blue Door Bakery Group', 'Midtown location, Raleigh NC'], ['COUNTER STAFF', 'Sunrise Bagels', 'Cary NC']],
    [['Shift Manager', 'Kroger', 'Store #114, Columbus OH'], ['Cashier', 'Kroger', 'Downtown'], ['Assembler', 'Honda of America', 'Plant 2, Marysville OH']],
    [['Line Lead', 'Acme Foods', 'Unit 4B, Dayton OH'], ['Packer', 'Acme Foods', 'Dayton OH']],
  ];
  for (let i = 0; i < shapes.length; i++) {
    const src = ['Lena Cho', 'lena@example.com | 919-555-0133', '', 'EXPERIENCE', ...shapes[i]].join('\n');
    const d = parse(src);
    assert.deepEqual(d.experience.map((e) => [e.title, e.company, e.location]), want[i], `shape ${i}`);
    assert.ok(d.experience.every((e) => e.start && e.bullets.length), `shape ${i}: dates and bullets stay with their role`);
    assert.equal(allText(parse(allText(d))), allText(d), `shape ${i}: stable`);
    const p = await parsePdf(src.split('\n'));
    assert.deepEqual(p.experience.map((e) => [e.title, e.company, e.start, e.end]), d.experience.map((e) => [e.title, e.company, e.start, e.end]), `shape ${i}: PDF = text`);
  }
  assert.equal(parse(['L', 'l@example.com', '', 'EXPERIENCE', ...shapes[0]].join('\n')).experience[0].displayTitle, 'Head Baker');
});

test('round 4: "Summers 2014 - 2016", a single year, and a second role at one employer', () => {
  const d = parse('Jo Park\njo@example.com\n\nEXPERIENCE\nProgram Coordinator | City Science Center (CSC) | Philadelphia, PA | 2019 - Present\n- Ran 40 field trips a year\nSummer Camp Counselor | City Science Center (CSC) | Summers 2014 - 2016\n- Led groups of 12 campers\nAccounting Intern (summer) | Baird LLP | 2013\n- Tested controls\n');
  const [, camp, intern] = d.experience;
  assert.deepEqual([camp.start, camp.end, camp.dateText], ['2014', '2016', 'Summers 2014 - 2016']);
  assert.notEqual(camp.location, 'Summers');
  assert.equal(camp.location, 'Philadelphia, PA', 'the employer\'s place');
  assert.match(allText(d), /Summers 2014 - 2016/);
  assert.deepEqual([intern.start, intern.end], ['2013', '2013']);
});

test('round 4: "Education & Certifications" — credential lines are certifications in text and in the PDF', async () => {
  const lines = ['Grace Kim', 'grace.kim@example.com | 559-555-0119 | Fresno, CA', '', 'EXPERIENCE', 'Medical Assistant | Valley Family Clinic | Fresno, CA | 2021 - Present', '- Room 30 patients a day', '', 'EDUCATION & CERTIFICATIONS', 'Fresno City College — Medical Assisting Certificate, 2021', 'Certified Clinical Medical Assistant (CCMA) — NHA, active through 2027', 'Phlebotomy Technician (CPT-1), California — active', 'BLS for Healthcare Providers — American Heart Association, exp. 08/2027'];
  for (const d of [parse(lines.join('\n')), await parsePdf(lines)]) {
    assert.deepEqual(d.education.map((e) => e.school), ['Fresno City College']);
    assert.deepEqual(d.certifications.map((c) => c.name), ['Certified Clinical Medical Assistant (CCMA)', 'Phlebotomy Technician (CPT-1)', 'BLS for Healthcare Providers']);
    assert.equal(d.extra.length, 0);
  }
});

test('property: canonical text is idempotent — canonical(canonical(x)) === canonical(x)', () => {
  const cal = fs.readdirSync(new URL('lib/fixtures/calibration/', root)).filter((f) => f.endsWith('.txt')).map((f) => read(`lib/fixtures/calibration/${f}`));
  const all = [...cal, ...TEXT_FIXTURES.map((f) => read(f)), ...Object.values(CLASS_CASES).flat().map((l) => l.join('\n'))];
  for (const src of all) { const a = canonicalResumeText(src); assert.equal(canonicalResumeText(a), a, a.split('\n')[0]); }
  const cashier = canonicalResumeText(read('lib/fixtures/calibration/cashier.txt'));
  assert.match(cashier, /\nAVAILABILITY\n• Evenings and weekends/);
});

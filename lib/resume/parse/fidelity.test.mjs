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
    ['Shift Supervisor', 'Copper State Logistics', 'Phoenix AZ'], ['Forklift Operator', 'Copper State Logistics', ''], ['Stocker', "Bashas'", 'Tempe']]);
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

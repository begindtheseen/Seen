// Tests: structured résumé parser (lib/resume/parse) over every fixture layout.
// Run: node --test lib/resume/parse/parse.test.mjs
//
// Fixtures: PDFs built by lib/resume/fixtures/makePdfFixtures.mjs (Word-like single column with
// subset fonts; two-column sidebar; two-page classic), a hand-built .docx, and text résumés in
// lib/resume/fixtures/text/ covering: the 2026-08-13 production mangle shape (PR #283 spec),
// "Title at Company", company-first stacked headers, UK style, no section headers at all,
// projects + certifications + grouped skills.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';

import { parseResume } from './index.js';
import { extractResumeFile } from '../extract/index.js';
import { serializeToText, normalizeDoc, docToLegacyEmployment } from '../model.js';
import { findDateRange, parseDateToken, formatRange } from './dates.js';

const fx = (name) => fs.readFileSync(new URL(`../fixtures/${name}`, import.meta.url));
const txt = (name) => fs.readFileSync(new URL(`../fixtures/text/${name}`, import.meta.url), 'utf8');
async function parseFile(name) {
  const ex = await extractResumeFile({ buffer: fx(name), fileName: name });
  assert.equal(ex.ok, true, `extract ${name}`);
  return parseResume({ text: ex.text, lines: ex.lines, source: ex.fileType, layout: ex.layout });
}
const roles = (d) => d.experience.map((e) => [e.title, e.company]);

// ── Dates ──
test('date grammar covers the common résumé formats', () => {
  assert.deepEqual([findDateRange('Jan 2020 – Present').start, findDateRange('Jan 2020 – Present').end], ['2020-01', 'present']);
  assert.equal(findDateRange('January 2020 - December 2021').end, '2021-12');
  assert.equal(findDateRange('01/2020 to 03/2022').end, '2022-03');
  assert.equal(findDateRange('2019–2021').start, '2019');
  assert.equal(findDateRange('Q1 2020 - Q4 2021').end, '2021-10');
  assert.equal(findDateRange("Mar '19 - Jun '21").start, '2019-03');
  assert.equal(findDateRange('Summer 2021 – Fall 2022').start, '2021-06');
  assert.equal(findDateRange('Since 2018').end, 'present');
  assert.equal(findDateRange('2 - 2020'), null, 'a count dash year is not a range');
  assert.equal(findDateRange('Oct 2022 – Jan 2025').end, '2025-01');
  assert.equal(parseDateToken('Sept 2020').m, 9);
  assert.equal(formatRange('2021-01', 'present'), 'Jan 2021 – Present');
});

// ── PDF fixtures ──
test('Word-like PDF: contact, summary, two roles with location + dates, education, certs, skills', async () => {
  const d = await parseFile('word.pdf');
  assert.equal(d.basics.name, 'Maria Gonzalez');
  assert.equal(d.basics.email, 'maria.gonzalez@example.com');
  assert.equal(d.basics.phone, '(480) 555-0177');
  assert.equal(d.basics.location, 'Phoenix, AZ');
  assert.equal(d.basics.links[0].kind, 'linkedin');
  assert.match(d.basics.summary, /^Registered Nurse with 6 years/);
  assert.deepEqual(roles(d), [['Registered Nurse, Telemetry', 'Banner Health'], ['Staff Nurse, Med-Surg', 'HonorHealth']]);
  assert.equal(d.experience[0].location, 'Phoenix, AZ');
  assert.equal(d.experience[0].start, '2021-03'); assert.equal(d.experience[0].end, 'present');
  assert.equal(d.experience[0].bullets.length, 3, 'wrapped bullet lines merged back into 3 bullets');
  assert.match(d.experience[0].bullets[2].text, /30% through a barcode double-check habit\.$/);
  assert.equal(d.experience[1].end, '2021-02');
  assert.equal(d.education[0].degree, 'Bachelor of Science');
  assert.equal(d.education[0].field, 'Nursing');
  assert.equal(d.education[0].school, 'Arizona State University');
  assert.equal(d.education[0].end, '2018');
  assert.equal(d.certifications[0].name, 'Registered Nurse (RN)');
  assert.equal(d.certifications[0].issuer, 'Arizona Board of Nursing');
  assert.equal(d.certifications[1].date, '2024');
  assert.deepEqual(d.skills[0].items, ['Epic EHR', 'Telemetry monitoring', 'IV therapy', 'Patient education', 'Triage', 'Spanish (fluent)']);
  assert.deepEqual(d.sectionOrder, ['summary', 'experience', 'education', 'certifications', 'skills']);
  assert.equal(d.meta.warnings.length, 0);
});

test('two-column PDF: sidebar contact/skills/education and main-column roles, conventional order', async () => {
  const d = await parseFile('twocol.pdf');
  assert.equal(d.basics.name, 'Devon Park');
  assert.equal(d.basics.headline, 'Warehouse Operations Lead');
  assert.equal(d.basics.location, 'Dallas, TX');
  assert.deepEqual(roles(d), [['Warehouse Operations Lead', 'Amazon Fulfillment'], ['Picker / Packer', 'Target Distribution Center']]);
  assert.equal(d.experience[0].bullets.length, 3);
  assert.equal(d.experience[1].start, '2016'); assert.equal(d.experience[1].end, '2019');
  assert.equal(d.education[0].degree, 'High School Diploma');
  assert.equal(d.education[0].school, 'Skyline High School');
  assert.equal(d.education[0].end, '2014');
  const items = d.skills.flatMap((g) => g.items);
  // a certification among the sidebar skills is a certification (round 3: Ray's OSHA forklift line vanished)
  assert.ok(d.certifications.some((c) => c.name === 'Forklift certified (sit-down, reach)'), `the forklift certification is kept: ${JSON.stringify(d.certifications)}`);
  assert.ok(items.includes('Team scheduling'));
  assert.equal(d.sectionOrder[0], 'experience', 'multi-column layouts render in conventional order');
  assert.ok(d.meta.warnings.some((w) => w.code === 'multi_column'));
});

test('two-page PDF: six stacked roles across the page break, two degrees, grouped skills', async () => {
  const d = await parseFile('twopage.pdf');
  assert.equal(d.basics.name, 'Samuel Okafor');
  assert.equal(d.basics.links[0].kind, 'github');
  assert.equal(d.experience.length, 6);
  assert.deepEqual(roles(d)[0], ['Senior Data Analyst', 'Northwind Traders']);
  assert.deepEqual(roles(d)[5], ['Operations Intern', 'Wide World Importers']);
  assert.ok(d.experience.every((e) => e.bullets.length === 4), 'every role keeps its 4 bullets');
  assert.equal(d.experience[4].start, '2016-05');
  assert.equal(d.education.length, 2);
  assert.equal(d.education[1].degree, 'B.A.');
  assert.equal(d.education[1].school, 'DePaul University');
  assert.deepEqual(d.skills.map((g) => g.label), ['Languages', 'Tools', 'Methods']);
});

// ── DOCX ──
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n >>> 0); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
function zipOne(name, content) {
  const nameB = Buffer.from(name); const xml = Buffer.from(content);
  const comp = zlib.deflateRawSync(xml); const crc = zlib.crc32(xml) >>> 0;
  const local = Buffer.concat([u32(0x04034b50), u16(20), u16(0), u16(8), u16(0), u16(0), u32(crc), u32(comp.length), u32(xml.length), u16(nameB.length), u16(0), nameB]);
  const central = Buffer.concat([u32(0x02014b50), u16(20), u16(20), u16(0), u16(8), u16(0), u16(0), u32(crc), u32(comp.length), u32(xml.length), u16(nameB.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(0), nameB]);
  const eocd = Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(1), u16(1), u32(central.length), u32(local.length + comp.length), u16(0)]);
  return Buffer.concat([local, comp, central, eocd]);
}
const para = (t, { style, bullet, bold, sz, tab } = {}) =>
  '<w:p>' + (style || bullet || bold || sz ? '<w:pPr>' + (style ? `<w:pStyle w:val="${style}"/>` : '') +
  (bullet ? '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>' : '') +
  (bold || sz ? '<w:rPr>' + (bold ? '<w:b/>' : '') + (sz ? `<w:sz w:val="${sz * 2}"/>` : '') + '</w:rPr>' : '') + '</w:pPr>' : '') +
  `<w:r><w:t xml:space="preserve">${t}</w:t></w:r>` + (tab ? `<w:r><w:tab/><w:t>${tab}</w:t></w:r>` : '') + '</w:p>';

test('docx: Title/Heading styles, numPr bullets, tab-separated dates and a 2-cell table parse into a doc', async () => {
  const docx = zipOne('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="x"><w:body>' +
    para('Jordan Lee', { style: 'Title', sz: 20 }) + para('jordan@example.com | 555-010-0100 | Denver, CO') +
    para('Experience', { style: 'Heading1' }) +
    para('Barista', { bold: true, tab: 'Jun 2021 – Present' }) + para('Blue Bottle Coffee, Denver, CO') +
    para('Serve 200+ customers per shift &amp; keep the bar stocked.', { bullet: true }) + para('Trained 6 new baristas on espresso calibration.', { bullet: true }) +
    '<w:tbl><w:tr><w:tc>' + para('Skills', { bold: true }) + para('Latte art') + para('POS (Square)') + '</w:tc><w:tc>' + para('Education', { bold: true }) + para('A.A. Liberal Arts, Front Range CC, 2020') + '</w:tc></w:tr></w:tbl>' +
    '</w:body></w:document>');
  const ex = await extractResumeFile({ buffer: docx, fileName: 'jordan.docx' });
  const d = parseResume({ text: ex.text, lines: ex.lines, source: 'word', layout: ex.layout });
  assert.equal(d.basics.name, 'Jordan Lee');
  assert.equal(d.basics.email, 'jordan@example.com');
  assert.deepEqual(roles(d), [['Barista', 'Blue Bottle Coffee']]);
  assert.equal(d.experience[0].location, 'Denver, CO');
  assert.equal(d.experience[0].start, '2021-06');
  assert.equal(d.experience[0].bullets.length, 2);
  assert.match(d.experience[0].bullets[0].text, /& keep the bar stocked/);
  assert.deepEqual(d.skills[0].items, ['Latte art', 'POS (Square)']);
  assert.equal(d.education[0].degree, 'A.A.');
  assert.equal(d.education[0].school, 'Front Range CC');
  assert.ok(d.meta.warnings.some((w) => w.code === 'tables'));
});

// ── Text fixtures ──
test('the 2026-08-13 production mangle shape (PR #283 spec): eight roles in, eight roles out', () => {
  const d = parseResume({ text: txt('brandon_shape.txt') });
  assert.equal(d.basics.name, 'Brandon Burnett');
  assert.equal(d.basics.phone, '951-216-5400');
  assert.match(d.basics.summary, /^Hands-on automotive technician/);
  const r = roles(d);
  assert.equal(d.experience.length, 7, JSON.stringify(r));
  // no section header or bullet ever becomes a company
  for (const e of d.experience) {
    assert.ok(!/^(experience|summary|education)$/i.test(e.company), `section header leaked: ${e.company}`);
    assert.ok(!/torque specifications|finish protection|customer expectations/i.test(e.company), `bullet leaked: ${e.company}`);
  }
  const self = d.experience.find((e) => /self-directed/i.test(e.title));
  assert.ok(self && self.bullets.length === 3 && self.start === '2020' && self.end === 'present', 'self-directed role keeps its 3 bullets and dates');
  const towne = d.experience.find((e) => e.company === 'Towne Park');
  assert.equal(towne.title, 'Valet Attendant'); assert.equal(towne.start, '2022-10'); assert.equal(towne.bullets.length, 4);
  const detailing = d.experience.find((e) => /detailing/i.test(e.company));
  assert.equal(detailing.title, 'Owner/Operator'); assert.equal(detailing.bullets.length, 3);
  assert.match(detailing.employmentType, /Self-Employed/); assert.match(detailing.employmentType, /Part-Time/);
  for (const co of ['Victoriam Management', 'UFC Gym', 'Chipotle', 'Biotheranostics']) assert.ok(d.experience.some((e) => e.company === co), `${co} is its own role`);
  assert.deepEqual(roles(d).slice(3), [['Campaign Manager', 'Victoriam Management'], ['Membership Specialist', 'UFC Gym'], ['Team Member', 'Chipotle'], ['Administrative Assistant', 'Biotheranostics']]);
  assert.equal(d.education[0].degree, 'High School Diploma');
  assert.equal(d.education[0].school, 'Great Oak High School');
  assert.equal(d.education[0].location, 'Temecula, CA');
  // nothing from the original disappears
  const all = JSON.stringify(d).toLowerCase();
  for (const marker of ['drivetrain repairs', 'limited tools', 'torque specifications', 'luxury models', 'zero-incident', 'situational awareness', 'finish protection', 'quality control', 'customer expectations']) assert.ok(all.includes(marker), `dropped: ${marker}`);
});

test('pipe-packed roles on one line each become a role', () => {
  const d = parseResume({ text: `BRANDON BURNETT\n951-216-5400 | Brandon.Burnett00123@icloud.com\n\nEXPERIENCE\nTowne Park\nValet Attendant | Oct 2022 – Jan 2025\n- Safely operated and parked high volumes of vehicles, including luxury models.\n\nCampaign Manager – Victoriam Management | Membership Specialist – UFC Gym | Team Member – Chipotle | Administrative Assistant – Biotheranostics\n\nEDUCATION\nHigh School Diploma` });
  assert.equal(d.experience.length, 5);
  assert.equal(d.experience[0].bullets.length, 1);
  assert.deepEqual(roles(d)[4], ['Administrative Assistant', 'Biotheranostics']);
});

test('"Company - Title    dates" (legacy John Doe shape) with an inline SKILLS: line', () => {
  const d = parseResume({ text: txt('john_doe_legacy.txt') });
  assert.equal(d.basics.name, 'John Doe');
  assert.equal(d.basics.headline, 'Senior Software Engineer');
  assert.deepEqual(roles(d), [['Senior Software Engineer', 'Acme Corp'], ['Software Engineer', 'Globex Inc']]);
  assert.equal(d.experience[0].start, '2020-01'); assert.equal(d.experience[1].end, '2019-12');
  assert.equal(d.experience[0].bullets.length, 3);
  assert.deepEqual(d.skills[0].items, ['Python', 'JavaScript', 'React', 'AWS', 'Docker', 'SQL']);
  assert.deepEqual(docToLegacyEmployment(d)[0], { company: 'Acme Corp', title: 'Senior Software Engineer', start_date: 'Jan 2020', end_date: 'Present' });
});

test('"Title at Company (Remote) — dates", mixed contact/headline line, grouped skills, awards', () => {
  const d = parseResume({ text: txt('title_at_company.txt') });
  assert.equal(d.basics.name, 'Priya Natarajan');
  assert.equal(d.basics.headline, 'Product Designer');
  assert.equal(d.basics.location, 'Chicago, IL');
  assert.equal(d.basics.links[0].url, 'priyadesign.me');
  assert.match(d.basics.summary, /^Product designer with 7 years/);
  assert.deepEqual(roles(d), [['Senior Product Designer', 'Loopwell'], ['Product Designer', 'Brightline Health'], ['UX Intern', 'Fieldstone Labs']]);
  assert.equal(d.experience[0].location, 'Remote'); assert.equal(d.experience[0].start, '2021-04');
  assert.equal(d.experience[1].location, 'Chicago, IL'); assert.equal(d.experience[1].start, '2018'); assert.equal(d.experience[1].end, '2021');
  assert.equal(d.experience[2].start, '2017-06');
  assert.equal(d.education[0].degree, 'B.F.A.'); assert.equal(d.education[0].field, 'Graphic Design');
  assert.equal(d.education[0].school, 'School of the Art Institute of Chicago');
  assert.equal(d.education[0].gpa, '3.7'); assert.equal(d.education[0].end, '2017');
  assert.deepEqual(d.skills.map((g) => g.label), ['Design', 'Research', 'Languages']);
  assert.equal(d.extra[0].kind, 'awards'); assert.equal(d.extra[0].items.length, 1);
});

test('company-first stacked headers with numeric dates, Education & Training, licenses', () => {
  const d = parseResume({ text: txt('company_first_stacked.txt') });
  assert.equal(d.basics.name, 'Marcus Webb');
  assert.match(d.basics.location, /^Houston, TX/);
  assert.deepEqual(roles(d), [['Journeyman Electrician', 'Gulf Coast Electrical Contractors'], ['Apprentice Electrician', 'Lone Star Industrial Services']]);
  assert.equal(d.experience[0].location, 'Houston, TX'); assert.equal(d.experience[0].start, '2019-03'); assert.equal(d.experience[0].end, 'present');
  assert.equal(d.experience[1].start, '2015-06'); assert.equal(d.experience[1].end, '2019-02');
  assert.equal(d.experience[0].bullets.length, 3);
  assert.equal(d.education.length, 2);
  assert.equal(d.education[0].school, 'Houston Community College'); assert.equal(d.education[0].end, '2015');
  assert.equal(d.certifications.length, 3);
  assert.equal(d.certifications[0].issuer, 'TDLR');
  assert.equal(d.certifications[2].date, '2021');
  assert.ok(d.skills[0].items.includes('Lockout/tagout'));
});

test('UK style "Company, City — Title (dates)" headers, BSc (Hons), interests', () => {
  const d = parseResume({ text: txt('uk_style.txt') });
  assert.equal(d.basics.phone, '+44 7700 900123');
  assert.equal(d.basics.location, 'Manchester, UK');
  assert.deepEqual(roles(d), [['Audit Senior', 'KPMG LLP'], ['Audit Associate', 'Grant Thornton']]);
  assert.equal(d.experience[0].location, 'Manchester'); assert.equal(d.experience[1].location, 'Leeds');
  assert.equal(d.experience[0].start, '2020-09');
  assert.equal(d.education[0].degree, 'BSc (Hons)'); assert.equal(d.education[0].field, 'Accounting and Finance');
  assert.equal(d.education[0].school, 'University of Leeds'); assert.equal(d.education[0].start, '2014'); assert.equal(d.education[0].end, '2017');
  assert.equal(d.extra[0].kind, 'interests');
});

test('no section headers at all: roles still segment, the degree line becomes education', () => {
  const d = parseResume({ text: txt('no_headers.txt') });
  assert.equal(d.basics.name, 'Rosa Delgado');
  assert.deepEqual(roles(d), [['Shift Supervisor', 'Starbucks'], ['Barista', 'Starbucks']]);
  assert.equal(d.experience[0].bullets.length, 2);
  assert.equal(d.education[0].degree, 'Associate of Arts'); assert.equal(d.education[0].school, 'Miami Dade College'); assert.equal(d.education[0].end, '2020');
  assert.deepEqual(d.sectionOrder, ['experience', 'education']);
  assert.ok(d.meta.warnings.some((w) => w.code === 'implicit_experience'));
});

test('projects with urls and dates, certifications with issuers, two degrees at one school', () => {
  const d = parseResume({ text: txt('projects_and_certs.txt') });
  assert.equal(d.basics.phone, '206-555-0133');
  assert.deepEqual(d.basics.links.map((l) => l.kind), ['github', 'portfolio']);
  assert.equal(d.experience[0].location, 'Seattle, WA'); assert.equal(d.experience[1].location, 'Remote');
  assert.equal(d.projects.length, 2);
  assert.match(d.projects[0].name, /^Latencyscope/);
  assert.equal(d.projects[0].url, 'github.com/kenjiw/latencyscope');
  assert.equal(d.projects[0].start, '2023'); assert.equal(d.projects[0].end, 'present');
  assert.equal(d.projects[0].bullets.length, 1);
  assert.equal(d.projects[1].name, 'Homelab Kubernetes cluster'); assert.equal(d.projects[1].bullets.length, 1);
  assert.equal(d.education[1].degree, 'B.S.'); assert.equal(d.education[1].school, 'University of Washington'); assert.equal(d.education[1].end, '2017');
  assert.equal(d.education[1].details[0].text, 'Magna Cum Laude');
  assert.equal(d.certifications[0].name, 'Certified Kubernetes Administrator (CKA)'); assert.equal(d.certifications[0].issuer, 'CNCF'); assert.equal(d.certifications[0].date, '2023-03');
  assert.equal(d.certifications[1].date, '2022');
  assert.deepEqual(d.skills.map((g) => g.label), ['Languages', 'Infrastructure']);
  assert.equal(d.languages.length, 0, 'a "Languages:" skill group is not a spoken-languages section');
});

// ── Canonical round-trip ──
test('parse(serializeToText(doc)) reproduces the document (lossless canonical text)', () => {
  const doc = normalizeDoc({
    basics: { name: 'Jane Q. Doe', headline: 'Senior Engineer', email: 'jane@example.com', phone: '(619) 555-0142', location: 'San Diego, CA', links: [{ url: 'linkedin.com/in/janedoe' }, { url: 'github.com/janedoe' }], summary: 'Backend engineer with 8 years of experience.\nShips reliable systems.' },
    experience: [
      { title: 'Senior Software Engineer', company: 'Acme Corp', location: 'San Diego, CA', employmentType: 'Full-time', start: '2021-01', end: 'present', bullets: ['Led a team of 5 engineers to ship a platform used by 40,000 users.', 'Reduced p95 latency by 38%.'] },
      { title: 'Software Engineer', company: 'Globex', location: 'Remote', start: '2018-06', end: '2020-12', bullets: ['Built REST APIs in Node.js and PostgreSQL.'] },
      { title: 'Owner/Operator', company: 'Detailing Business', employmentType: 'Self-Employed, Part-Time', bullets: ['Managed scheduling, supplies, and customer expectations.'] },
    ],
    education: [{ degree: 'B.S.', field: 'Computer Science', school: 'UC San Diego', location: 'La Jolla, CA', end: '2018', gpa: '3.8', details: ['Dean\'s List'] }],
    skills: [{ label: '', items: ['JavaScript', 'TypeScript', 'React'] }, { label: 'Cloud', items: ['AWS', 'Docker'] }],
    certifications: [{ name: 'AWS Certified Solutions Architect', issuer: 'Amazon', date: '2022-05' }],
    projects: [{ name: 'Latencyscope', role: 'maintainer', url: 'github.com/janedoe/latencyscope', start: '2023', end: 'present', bullets: ['1,400 stars.'] }],
    languages: [{ name: 'Spanish', level: 'Fluent' }],
    extra: [{ kind: 'awards', items: ['Hackathon winner 2022'] }],
  });
  const text = serializeToText(doc);
  const back = parseResume({ text });
  const strip = (d) => JSON.parse(JSON.stringify(d, (k, v) => (k === 'id' || k === 'meta' || k === 'dateText' ? undefined : v)));
  const a = strip(doc), b = strip(back);
  assert.deepEqual(b.basics, a.basics);
  assert.deepEqual(b.experience, a.experience);
  assert.deepEqual(b.education, a.education);
  assert.deepEqual(b.skills, a.skills);
  assert.deepEqual(b.certifications.map((c) => [c.name, c.issuer, c.date]), a.certifications.map((c) => [c.name, c.issuer, c.date]));
  assert.deepEqual(b.projects.map((p) => [p.name, p.role, p.url, p.start, p.end, p.bullets]), a.projects.map((p) => [p.name, p.role, p.url, p.start, p.end, p.bullets]));
  assert.deepEqual(b.languages, a.languages);
  assert.deepEqual(b.extra.map((x) => [x.kind, x.title, x.items]), a.extra.map((x) => [x.kind, x.title, x.items]));
  assert.deepEqual(b.sectionOrder.map((k) => k.replace(/^extra:.*/, 'extra')), a.sectionOrder.map((k) => k.replace(/^extra:.*/, 'extra')));
  // and serializing the re-parse is byte-identical (a fixed point)
  assert.equal(serializeToText(back), text);
});

test('determinism: the same input yields the same document (ids aside)', () => {
  const strip = (d) => JSON.stringify(d, (k, v) => (k === 'id' || k === 'parsedAt' ? undefined : v));
  assert.equal(strip(parseResume({ text: txt('company_first_stacked.txt') })), strip(parseResume({ text: txt('company_first_stacked.txt') })));
});

test('garbage in: an empty or structureless text yields an empty doc with warnings, never a throw', () => {
  const d = parseResume({ text: '' });
  assert.equal(d.experience.length, 0);
  assert.ok(d.meta.warnings.some((w) => w.code === 'no_experience'));
  const d2 = parseResume({ text: 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore' });
  assert.equal(d2.experience.length, 0);
});

test('education: "Coursework toward A.A.S. Business Management" is coursework toward a degree, not a degree called Coursework', () => {
  const doc = parseResume({ text: 'Maria Lopez\nPhoenix, AZ\nEDUCATION\nPhoenix College — Coursework toward A.A.S. Business Management (2014–2016)\nCarl Hayden High School, Phoenix, AZ — Diploma, 2010' });
  const e = doc.education[0];
  assert.equal(e.school, 'Phoenix College');
  assert.equal(e.degree, 'Coursework toward A.A.S.');
  assert.equal(e.field, 'Business Management');
});

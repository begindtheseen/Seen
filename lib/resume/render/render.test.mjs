// Renderer tests: text/markdown conventions, JSON Resume round trip, PDF + DOCX structure through
// the real extractor, the free/Pro watermark rule, Unicode font fallback, and the ATS round-trip
// check on every fixture × template × format. Run: node --test lib/resume/render/render.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseResume } from '../parse/index.js';
import { serializeToText, normalizeDoc } from '../model.js';
import { extractResumeFile } from '../extract/index.js';
import { renderText, renderMarkdown } from './text.js';
import { toJsonResume, fromJsonResume } from './jsonResume.js';
import { renderPdf, sanitizeForStandardFont } from './pdf.js';
import { renderDocx } from './docx.js';
import { renderResume, fileNameFor, listFormats } from './index.js';
import { listTemplates, safeAccent, resolveTemplate } from './templates.js';
import { atsCheck } from './atsCheck.js';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'text');
const fixture = (name) => parseResume({ text: fs.readFileSync(path.join(FIX, `${name}.txt`), 'utf8'), source: 'text' });
const FIXTURES = fs.readdirSync(FIX).filter((f) => f.endsWith('.txt')).map((f) => f.replace('.txt', ''));

test('templates: three one-column templates, tolerant resolution, accent safety', () => {
  const list = listTemplates();
  assert.deepEqual(list.map((t) => t.id), ['classic', 'engineering', 'modern']);
  assert.equal(resolveTemplate('MODERN').id, 'modern');
  assert.equal(resolveTemplate('nope').id, 'classic');
  assert.equal(safeAccent('#1f5fbf', '#000000'), '#1f5fbf');
  assert.equal(safeAccent('#ffff00', '#000000'), '#000000', 'too light to print');
  assert.equal(safeAccent('red', '#000000'), '#000000');
  assert.equal(listFormats().map((f) => f.id).join(','), 'pdf,docx,txt,md,json');
});

test('text: ATS plain-text conventions and a lossless re-parse of roles', () => {
  const doc = fixture('projects_and_certs');
  const txt = renderText(doc);
  assert.match(txt, /^KENJI WATANABE\n/);
  assert.match(txt, /\nEXPERIENCE\n/);
  assert.match(txt, /\nSoftware Engineer II \| Rainier Cloud \| Seattle, WA \| Jan 2022 - Present\n- Own the ingestion/);
  assert.ok(!/[–—•\t]/.test(txt), 'ASCII only: no en/em dashes, no bullet glyphs, no tabs');
  const back = parseResume({ text: txt, source: 'text' });
  assert.deepEqual(back.experience.map((e) => [e.title, e.company, e.start, e.end, e.bullets.length]), doc.experience.map((e) => [e.title, e.company, e.start, e.end, e.bullets.length]));
  assert.equal(back.skills.flatMap((g) => g.items).join('|'), doc.skills.flatMap((g) => g.items).join('|'));
  assert.equal(back.certifications.length, doc.certifications.length);
});

test('markdown: headings, bold titles, links, bullets', () => {
  const md = renderMarkdown(fixture('projects_and_certs'));
  assert.match(md, /^# Kenji Watanabe\n/);
  assert.match(md, /\[kenji\.w@example\.com\]\(mailto:kenji\.w@example\.com\)/);
  assert.match(md, /\n## Experience\n/);
  assert.match(md, /\*\*Software Engineer II\*\* — Rainier Cloud/);
  assert.match(md, /\n- Own the ingestion service/);
  assert.match(md, /\[github\.com\/kenjiw\/latencyscope\]\(https:\/\/github\.com\/kenjiw\/latencyscope\)/);
});

test('json resume: lossless round trip on every fixture, foreign documents import', () => {
  for (const f of FIXTURES) {
    const doc = fixture(f);
    const j = toJsonResume(doc);
    assert.equal(j.basics.name, doc.basics.name);
    const back = fromJsonResume(JSON.parse(JSON.stringify(j)));
    assert.equal(serializeToText(back), serializeToText(doc), `round trip ${f}`);
  }
  const foreign = fromJsonResume({ basics: { name: 'Ada Lovelace', email: 'ada@example.com', location: { city: 'London', countryCode: 'GB' }, profiles: [{ network: 'GitHub', url: 'https://github.com/ada' }] }, work: [{ name: 'Analytical Engines', position: 'Programmer', startDate: '1842-01-01', highlights: ['Wrote the first algorithm.'] }], skills: [{ name: 'Mathematics', keywords: ['Calculus', 'Bernoulli numbers'] }], awards: [{ title: 'Countess', date: '1838' }] });
  assert.equal(foreign.experience[0].company, 'Analytical Engines');
  assert.equal(foreign.experience[0].end, 'present', 'no endDate on a foreign entry = ongoing');
  assert.equal(foreign.basics.links[0].kind, 'github');
  assert.equal(foreign.extra[0].kind, 'awards');
  assert.ok(foreign.sectionOrder.includes('experience') && foreign.sectionOrder.some((k) => k.startsWith('extra:')));
});

test('pdf: every template renders one column, whole headings, bullets on their lines, dates beside titles', async () => {
  const doc = fixture('projects_and_certs');
  for (const template of ['classic', 'engineering', 'modern']) {
    const r = await renderPdf(doc, { template, pro: true });
    assert.ok(r.buffer.length > 2000 && r.buffer.slice(0, 5).toString() === '%PDF-');
    assert.equal(r.pages, 1);
    const ex = await extractResumeFile({ buffer: r.buffer, fileName: 'r.pdf' });
    assert.ok(ex.ok, ex.error);
    assert.equal(ex.layout.columns, 1, template);
    for (const h of ['SUMMARY', 'EXPERIENCE', 'PROJECTS', 'EDUCATION', 'CERTIFICATIONS', 'SKILLS']) assert.ok(ex.text.includes(`\n${h}\n`), `${template}: heading ${h} intact`);
    assert.ok(!/\b(?:[A-Z] ){3,}[A-Z]\b/.test(ex.text), `${template}: no letter-spaced text`);
    assert.equal(ex.lines.filter((l) => l.bullet).length, 6, `${template}: six bullets`);
    const roleLine = ex.lines.find((l) => /Software Engineer II|Rainier Cloud/.test(l.text) && /Jan 2022 – Present|Seattle, WA/.test(l.text));
    assert.ok(roleLine, `${template}: role header and its right-aligned slug share one line`);
    assert.ok(!ex.text.includes('Optimized with Seen'), 'Pro export is unbranded');
  }
  const free = await renderPdf(doc, { template: 'classic', pro: false });
  const exFree = await extractResumeFile({ buffer: free.buffer, fileName: 'r.pdf' });
  assert.ok(exFree.text.includes('Optimized with Seen'), 'free export carries the brand line');
  assert.equal(exFree.lines.filter((l) => l.bullet).length, 6);
});

test('pdf: metadata, page numbers on 2+ pages, appendix, letter vs a4', async () => {
  const doc = fixture('projects_and_certs');
  const big = normalizeDoc({ ...doc, experience: [...doc.experience, ...doc.experience, ...doc.experience, ...doc.experience].map((e, i) => ({ ...e, id: `x${i}`, bullets: e.bullets.map((b, j) => ({ ...b, id: `b${i}_${j}` })) })) });
  const r = await renderPdf(big, { template: 'engineering', pro: true });
  assert.ok(r.pages >= 2);
  const ex = await extractResumeFile({ buffer: r.buffer, fileName: 'r.pdf' });
  assert.ok(ex.text.includes(`Page 1 of ${r.pages}`));
  assert.ok(r.buffer.toString('latin1').includes('/Title'));
  const a4 = await renderPdf(doc, { template: 'classic', paper: 'a4', pro: true });
  assert.ok(a4.buffer.toString('latin1').includes('595.28') || a4.buffer.toString('latin1').includes('595'), 'A4 width');
  const withAppendix = await renderPdf(doc, { template: 'classic', pro: true, appendix: { role: 'SRE', company: 'Acme', fitScore: 82, bullets: ['Tailored bullet one.'], confirmItems: ['Confirm the 99.99% figure.'], message: 'Hello Acme.' } });
  const exA = await extractResumeFile({ buffer: withAppendix.buffer, fileName: 'r.pdf' });
  assert.ok(exA.text.includes('OPTIMIZED FOR SRE AT ACME') && exA.text.includes('Tailored bullet one.') && exA.text.includes('CONFIRM BEFORE USING') && exA.text.includes('Hello Acme.'));
});

test('pdf: text outside WinAnsi switches to the embedded font instead of garbling', async () => {
  const uni = parseResume({ text: 'Zoë Núñez-Ødegård Жуков\nzoe@example.com | 555-010-9999\n\nEXPERIENCE\nAnalyst — Σ Labs | 2020 – Present\n• Did Ωmega analysis for 3 teams.\n• Ran σ-tests weekly for 2 products.\n\nSKILLS\nExcel, SQL', source: 'text' });
  const r = await renderPdf(uni, { template: 'classic', pro: true });
  assert.equal(r.font, 'Liberation Sans');
  assert.ok(r.warnings.includes('font_fallback_unicode'));
  const ex = await extractResumeFile({ buffer: r.buffer, fileName: 'r.pdf' });
  assert.ok(ex.text.includes('Zoë Núñez-Ødegård Жуков') && ex.text.includes('Ωmega'));
  assert.equal(sanitizeForStandardFont('A → B ★ Ş'), 'A -> B * S');
});

test('docx: heading styles, numbered bullets, right-tab dates, hyperlinks, watermark rule', async () => {
  const doc = fixture('projects_and_certs');
  for (const template of ['classic', 'engineering', 'modern']) {
    const r = await renderDocx(doc, { template, pro: true });
    assert.ok(r.buffer.length > 4000 && r.buffer[0] === 0x50 && r.buffer[1] === 0x4b, 'zip container');
    const ex = await extractResumeFile({ buffer: r.buffer, fileName: 'r.docx' });
    assert.ok(ex.ok, ex.error);
    assert.deepEqual(ex.lines.filter((l) => l.heading).map((l) => l.text), ['SUMMARY', 'EXPERIENCE', 'PROJECTS', 'EDUCATION', 'CERTIFICATIONS', 'SKILLS'], template);
    assert.equal(ex.lines.filter((l) => l.bullet).length, 6);
    assert.ok(ex.lines.some((l) => /Software Engineer II|Rainier Cloud/.test(l.text) && /Jan 2022 – Present|Seattle, WA/.test(l.text)), 'dates on the role line');
    assert.ok(!ex.text.includes('Optimized with Seen'));
    assert.ok(ex.text.includes('Languages: Go, Python, SQL'), 'label keeps its trailing space');
  }
  const free = await renderDocx(doc, { template: 'classic', pro: false });
  const exFree = await extractResumeFile({ buffer: free.buffer, fileName: 'r.docx' });
  assert.ok(exFree.text.includes('Optimized with Seen'));
  const xml = (await import('../../server/resumeUpload.js')).readZipEntry;
  const body = (await xml(free.buffer, 'word/document.xml')).toString('utf8');
  assert.ok(body.includes('w:numPr') && body.includes('w:hyperlink') && body.includes('w:tab/'));
});

test('renderResume: every format, content types, file names', async () => {
  const doc = fixture('uk_style');
  const seen = {};
  for (const format of ['pdf', 'docx', 'txt', 'md', 'json']) {
    const r = await renderResume(doc, { format, template: 'modern', pro: true, role: 'Audit Manager' });
    seen[format] = r;
    assert.ok(r.buffer.length > 100, format);
    assert.equal(r.fileName, `Amelia Hart — Audit Manager Resume.${r.extension}`);
  }
  assert.equal(seen.pdf.contentType, 'application/pdf');
  assert.equal(seen.docx.contentType, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.equal(JSON.parse(seen.json.buffer.toString('utf8')).basics.name, 'Amelia Hart');
  assert.equal(seen.txt.template, null);
  assert.equal(fileNameFor({ basics: { name: 'A/B <Name>' } }, { format: 'docx' }), 'AB Name — Resume.docx');
  assert.equal(fileNameFor({}, {}), 'Seen Resume.pdf');
  const tailored = normalizeDoc({ ...doc, meta: { ...doc.meta, tailoredFor: { role: 'Audit Senior', company: 'Deloitte' } } });
  assert.equal(fileNameFor(tailored, { format: 'pdf' }), 'Amelia Hart — Audit Senior Resume.pdf');
});

test('ats check: every fixture scores 100 in every format and template; a two-column fake is caught', async () => {
  for (const f of FIXTURES) {
    const doc = fixture(f);
    for (const [format, template] of [['pdf', 'classic'], ['pdf', 'engineering'], ['pdf', 'modern'], ['docx', 'classic'], ['docx', 'modern'], ['txt', null]]) {
      const r = await atsCheck(doc, { format, template });
      assert.equal(r.score, 100, `${f} ${format} ${template}: ${r.checks.filter((c) => !c.ok).map((c) => `${c.code} ${c.detail}`).join(' | ')}`);
      assert.equal(r.grade, 'A');
      assert.ok(r.checks.length >= 8 && r.recovered && r.recovered.roles.length === doc.experience.length);
    }
  }
  // a document whose roles cannot be matched back is reported honestly
  const r = await atsCheck(normalizeDoc({ basics: { name: 'X', email: 'x@y.z' }, experience: [{ title: 'A', company: 'B', bullets: ['c'] }] }), { format: 'txt' });
  assert.ok(r.score < 100 || r.checks.some((c) => c.code === 'roles'));
});

// Tests: layout-aware extraction (PDF geometry → columns/lines; DOCX structure; text).
// Run: node --test lib/resume/extract/extract.test.mjs
// Fixture PDFs are built by lib/resume/fixtures/makePdfFixtures.mjs (pdfkit; Liberation Sans
// subset TrueType for the Word-like one, Base-14 Times for the two-page one).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';

import { extractPdfLayout } from './pdf.js';
import { extractDocxLayout } from './docx.js';
import { extractResumeFile, detectFileType } from './index.js';
import { textToLines, linesToText, undecorate } from './lines.js';

const fx = (name) => fs.readFileSync(new URL(`../fixtures/${name}`, import.meta.url));

test('single-column Word-like PDF: name is the largest line, headers are bold, title/date split into segments', async () => {
  const r = await extractPdfLayout(fx('word.pdf'));
  assert.equal(r.ok, true);
  assert.equal(r.layout.method, 'pdfjs');
  assert.equal(r.layout.columns, 1);
  const biggest = [...r.lines].sort((a, b) => b.size - a.size)[0];
  assert.equal(biggest.text, 'MARIA GONZALEZ');
  const exp = r.lines.find((l) => l.text === 'EXPERIENCE');
  assert.ok(exp && exp.bold, 'section header should be detected bold via the subset font name');
  const role = r.lines.find((l) => /Registered Nurse, Telemetry/.test(l.text));
  assert.ok(role.segments && role.segments.length === 2, `title and right-aligned date are separate segments: ${JSON.stringify(role.segments)}`);
  assert.equal(role.segments[1], 'Mar 2021 – Present');
  // Bullet lines (drawn glyphs, no text) are still identifiable by their indent.
  const bullet = r.lines.find((l) => /Care for 5–6 patients/.test(l.text));
  assert.ok(bullet.indent > 10, 'bullet text is indented relative to the column');
  assert.ok(/Precept new graduate nurses/.test(r.text), 'joined text keeps every bullet');
});

test('two-column PDF: sidebar and main column never interleave; full-width name comes first', async () => {
  const r = await extractPdfLayout(fx('twocol.pdf'));
  assert.equal(r.ok, true);
  assert.equal(r.layout.columns, 2);
  assert.equal(r.lines[0].text, 'DEVON PARK');
  const idx = (t) => r.lines.findIndex((l) => l.text.startsWith(t));
  // All sidebar lines precede all main-column lines within the band.
  assert.ok(idx('CONTACT') < idx('SKILLS') && idx('SKILLS') < idx('EDUCATION'), 'sidebar order kept');
  assert.ok(idx('EDUCATION') < idx('EXPERIENCE'), 'left column fully before right column');
  assert.ok(idx('Supervised 12 associates') > idx('Warehouse Operations Lead'), 'bullets follow their role');
  const text = r.text;
  // The old flat extractor interleaved these; the joined text must keep the sidebar contiguous.
  assert.ok(text.indexOf('Inventory control') < text.indexOf('EXPERIENCE'));
  assert.ok(/Amazon Fulfillment \| Mar 2019 – Present/.test(text));
});

test('two-page PDF: both pages read, in order, stacked role headers preserved line by line', async () => {
  const r = await extractPdfLayout(fx('twopage.pdf'));
  assert.equal(r.ok, true);
  assert.equal(r.layout.pages, 2);
  assert.ok(r.lines.some((l) => l.page === 2), 'page 2 lines present');
  const i1 = r.lines.findIndex((l) => l.text === 'Northwind Traders');
  assert.equal(r.lines[i1 + 1].text, 'Senior Data Analyst');
  assert.equal(r.lines[i1 + 2].text, 'Jan 2022 – Present');
  assert.ok(r.lines[i1 + 1].italic, 'italic title detected');
  assert.ok(/Wide World Importers/.test(r.text) && /B\.A\. Economics/.test(r.text));
});

test('a non-PDF buffer falls back to the legacy extractor instead of throwing', async () => {
  const r = await extractPdfLayout(Buffer.from('%PDF-1.4 this is not really a pdf', 'latin1'));
  assert.equal(r.layout.method, 'legacy');
  assert.ok(r.warnings.some((w) => /pdfjs_(failed|no_text)/.test(w)));
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
const DOCX = zipOne('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="x"><w:body>' +
  para('Jordan Lee', { style: 'Title', sz: 20 }) + para('jordan@example.com | 555-0100 | Denver, CO') +
  para('Experience', { style: 'Heading1' }) +
  para('Barista', { bold: true, tab: 'Jun 2021 – Present' }) + para('Blue Bottle Coffee, Denver, CO') +
  para('Serve 200+ customers per shift &amp; keep the bar stocked.', { bullet: true }) + para('Trained 6 new baristas on espresso calibration.', { bullet: true }) +
  '<w:tbl><w:tr><w:tc>' + para('Skills', { bold: true }) + para('Latte art') + '</w:tc><w:tc>' + para('Education', { bold: true }) + para('A.A. Liberal Arts, Front Range CC, 2020') + '</w:tc></w:tr></w:tbl>' +
  '</w:body></w:document>');

test('docx: headings, bullets (numPr), bold paragraphs, tab-separated dates and table columns survive', async () => {
  const r = await extractDocxLayout(DOCX);
  assert.equal(r.ok, true);
  assert.equal(r.layout.tables, 1);
  assert.equal(r.layout.columns, 2);
  const by = (t) => r.lines.find((l) => l.text.startsWith(t));
  assert.ok(by('Jordan Lee').heading && by('Jordan Lee').size === 20);
  assert.ok(by('Experience').heading);
  assert.ok(by('Barista').bold && by('Barista').segments && by('Barista').segments[1] === 'Jun 2021 – Present');
  assert.ok(by('Serve 200+').bullet && /& keep/.test(by('Serve 200+').text), 'entities decoded, bullet flagged');
  assert.equal(by('Skills').column, 0);
  assert.equal(by('Education').column, 1);
  assert.ok(/• Trained 6 new baristas/.test(r.text));
});

test('extractResumeFile routes by type and keeps the upload contract (wordCount, fileType, lines)', async () => {
  const pdf = await extractResumeFile({ buffer: fx('word.pdf'), fileName: 'maria.pdf', mimeType: 'application/pdf' });
  assert.equal(pdf.ok, true); assert.equal(pdf.fileType, 'pdf'); assert.ok(pdf.wordCount > 100); assert.ok(pdf.lines.length > 15);
  const docx = await extractResumeFile({ buffer: DOCX, fileName: 'jordan.docx', mimeType: '' });
  assert.equal(docx.ok, true); assert.equal(docx.fileType, 'word');
  const txt = await extractResumeFile({ buffer: Buffer.from('Short'), fileName: 'r.txt' });
  assert.equal(txt.ok, false); assert.equal(txt.status, 422);
  const bad = await extractResumeFile({ buffer: Buffer.from('x'.repeat(100)), fileName: 'r.exe' });
  assert.equal(bad.ok, false); assert.equal(bad.status, 400);
  assert.equal(detectFileType({ fileName: 'a.PDF' }), 'pdf');
  assert.equal(detectFileType({ fileName: 'a', mimeType: 'text/plain' }), 'text');
});

test('text lines: bullets, wide-gap segments and paragraph gaps round-trip', () => {
  const lines = textToLines('Jane\n\nEXPERIENCE\nAcme — Engineer    Jan 2020 – Present\n• Built it\n- Shipped it\n');
  assert.equal(lines[1].gapAbove, 2);
  assert.deepEqual(lines[2].segments, ['Acme — Engineer', 'Jan 2020 – Present']);
  assert.ok(lines[3].bullet && lines[4].bullet && lines[4].bulletChar === '-');
  assert.equal(undecorate('=== SKILLS ==='), 'SKILLS');
  assert.ok(/• Built it/.test(linesToText(lines)));
});

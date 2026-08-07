// Tests: résumé upload text extraction — the .txt / .md parse path (COMMIT 4).
// Run: node --test lib/server/resumeUpload.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';

import { extractUploadText } from './resumeUpload.js';

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

// Build a minimal .docx (a ZIP holding word/document.xml). dataDescriptor:true reproduces how
// Microsoft Word writes entries — the streaming flag is set and the local header leaves the sizes
// at 0, with the real sizes only in the data descriptor + central directory. That layout is what
// broke the old local-header-only reader (it sliced 0 bytes and extracted nothing).
function buildDocx(text, { dataDescriptor = false } = {}) {
  const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n >>> 0); return b; };
  const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
  const name = Buffer.from('word/document.xml');
  const xml = Buffer.from(
    `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>` +
    text.split('\n').map((line) => `<w:p><w:r><w:t>${line}</w:t></w:r></w:p>`).join('') +
    `</w:body></w:document>`,
  );
  const comp = zlib.deflateRawSync(xml);
  const crc = zlib.crc32 ? zlib.crc32(xml) >>> 0 : 0;
  const flags = dataDescriptor ? 0x0008 : 0x0000;
  const local = Buffer.concat([
    u32(0x04034b50), u16(20), u16(flags), u16(8), u16(0), u16(0),
    u32(dataDescriptor ? 0 : crc), u32(dataDescriptor ? 0 : comp.length), u32(dataDescriptor ? 0 : xml.length),
    u16(name.length), u16(0), name,
  ]);
  const dd = dataDescriptor ? Buffer.concat([u32(0x08074b50), u32(crc), u32(comp.length), u32(xml.length)]) : Buffer.alloc(0);
  const central = Buffer.concat([
    u32(0x02014b50), u16(20), u16(20), u16(flags), u16(8), u16(0), u16(0),
    u32(crc), u32(comp.length), u32(xml.length), u16(name.length), u16(0), u16(0),
    u16(0), u16(0), u32(0), u32(0), name,
  ]);
  const cdOffset = local.length + comp.length + dd.length;
  const eocd = Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(1), u16(1), u32(central.length), u32(cdOffset), u16(0)]);
  return Buffer.concat([local, comp, dd, central, eocd]).toString('base64');
}

const DOCX_RESUME = [
  'Jane Applicant', 'Senior Software Engineer', 'EXPERIENCE',
  'Staff Engineer, Acme Corp (2020-2025)',
  '- Led a team of 6 building the payments platform',
  '- Cut checkout latency 38% and processed 2M+ transactions per day',
  'SKILLS', 'TypeScript, React, Node.js, Postgres, AWS, distributed systems',
].join('\n');
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const RESUME_TXT = `Jane Doe
Retail Associate — Acme Store

EXPERIENCE
Acme Store — Sales Associate (2020–2023)
- Provided customer service on a busy sales floor.
- Handled cash handling and register reconciliation.

SKILLS
Customer service, cash handling, inventory management.`;

test('.txt résumé parses to text with fileType "text"', async () => {
  const r = await extractUploadText({ base64: b64(RESUME_TXT), fileName: 'resume.txt', mimeType: 'text/plain' });
  assert.equal(r.ok, true);
  assert.equal(r.fileType, 'text');
  assert.ok(r.wordCount > 10);
  assert.ok(r.text.includes('customer service'));
});

test('.md résumé is accepted', async () => {
  const r = await extractUploadText({ base64: b64(RESUME_TXT), fileName: 'resume.md', mimeType: '' });
  assert.equal(r.ok, true);
  assert.equal(r.fileType, 'text');
});

test('text/plain mimeType with no extension is accepted', async () => {
  const r = await extractUploadText({ base64: b64(RESUME_TXT), fileName: 'resume', mimeType: 'text/plain' });
  assert.equal(r.ok, true);
  assert.equal(r.fileType, 'text');
});

test('too-short .txt is rejected 422', async () => {
  const r = await extractUploadText({ base64: b64('too short'), fileName: 'r.txt', mimeType: 'text/plain' });
  assert.equal(r.ok, false);
  assert.equal(r.status, 422);
});

test('long-but-wordless extraction is rejected at upload (would-be RESUME_CORRUPTED)', async () => {
  // >100 chars but almost no real words (e.g. a phone PDF that extracts as spaced-out glyphs).
  // The upload gate must reject it so it is never stored and then fails later at optimize.
  const garbled = 'a b c d e f g h i j k l m n o p q r s t u v w x y z '.repeat(4); // ~200 chars, 0 words of 3+ letters
  const r = await extractUploadText({ base64: b64(garbled), fileName: 'resume.txt', mimeType: 'text/plain' });
  assert.equal(r.ok, false);
  assert.equal(r.status, 422);
  assert.match(r.error, /read this|paste|scrambled|real words/i);
});

test('unknown file type is rejected 400', async () => {
  const r = await extractUploadText({ base64: b64(RESUME_TXT), fileName: 'resume.rtf', mimeType: 'application/rtf' });
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
});

test('NUL bytes are stripped from .txt', async () => {
  const withNul = RESUME_TXT.slice(0, 40) + '\x00\x00' + RESUME_TXT.slice(40);
  const r = await extractUploadText({ base64: b64(withNul), fileName: 'r.txt', mimeType: 'text/plain' });
  assert.equal(r.ok, true);
  assert.ok(!r.text.includes('\x00'), 'NUL byte survived into parsed text');
});

test('binary renamed to .txt is rejected as garbled 422', async () => {
  const binary = Buffer.from('\x03\x11\x07\x19\x02\x1a'.repeat(40), 'binary').toString('base64');
  const r = await extractUploadText({ base64: binary, fileName: 'resume.txt', mimeType: 'text/plain' });
  assert.equal(r.ok, false);
  assert.equal(r.status, 422);
});

test('empty payload is rejected 400', async () => {
  const r = await extractUploadText({ base64: '', fileName: 'r.txt', mimeType: 'text/plain' });
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
});

test('.docx (standard ZIP) parses to text with fileType "word"', async () => {
  const r = await extractUploadText({ base64: buildDocx(DOCX_RESUME), fileName: 'resume.docx', mimeType: DOCX_MIME });
  assert.equal(r.ok, true, r.ok ? '' : `${r.status}: ${r.error}`);
  assert.equal(r.fileType, 'word');
  assert.ok(r.text.includes('payments platform'));
});

test('.docx written with a DATA DESCRIPTOR (Microsoft Word style) parses — regression', async () => {
  // Word leaves the compressed size at 0 in the local header (streaming flag), with the real size
  // only in the central directory. The old local-header-only reader sliced 0 bytes and failed with
  // a "couldn't read this résumé" 422 — a real user hit this repeatedly. The central-directory
  // reader must handle it.
  const r = await extractUploadText({ base64: buildDocx(DOCX_RESUME, { dataDescriptor: true }), fileName: 'resume.docx', mimeType: DOCX_MIME });
  assert.equal(r.ok, true, r.ok ? '' : `${r.status}: ${r.error}`);
  assert.equal(r.fileType, 'word');
  assert.ok(r.text.includes('payments platform'));
});

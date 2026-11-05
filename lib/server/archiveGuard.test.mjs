// Decompression-bomb guard for DOCX uploads. Every malicious file is built in memory.
// Run: node --test lib/server/archiveGuard.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { format } from 'node:util';
import { openZip, createBudget, ArchiveRejected, ARCHIVE_LIMITS, inflateCounted } from './archiveGuard.js';
import { crc32 } from './zip.js';
import { extractDocxLayout } from '../resume/extract/docx.js';
import { extractResumeFile } from '../resume/extract/index.js';
import { readZipEntry } from './resumeUpload.js';

const MiB = 1024 * 1024;
const TOO_LARGE = 'This file is too large to read once unpacked — save it again or upload a PDF.';
const DAMAGED = 'This Word file looks damaged, so we couldn’t open it safely — save it again or upload a PDF.';
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n >>> 0); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };

/**
 * Build a zip. Each entry: { name, data, method=8, flags=0, madeBy=20, extAttr=0,
 *   declaredSize, crc, compressed } — the overrides forge headers.
 */
function zip(entries) {
  const locals = [], centrals = [];
  let off = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name);
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data || '');
    const method = e.method ?? 8;
    const body = e.compressed || (method === 0 ? data : zlib.deflateRawSync(data, { level: 9 }));
    const crc = e.crc ?? crc32(data);
    const size = e.declaredSize ?? data.length;
    const flags = e.flags || 0;
    const local = Buffer.concat([u32(0x04034b50), u16(20), u16(flags), u16(method), u16(0), u16(0),
      u32(crc), u32(body.length), u32(size), u16(name.length), u16(0), name]);
    centrals.push(Buffer.concat([u32(0x02014b50), u16(e.madeBy ?? 20), u16(20), u16(flags), u16(method), u16(0), u16(0),
      u32(crc), u32(body.length), u32(size), u16(name.length), u16(0), u16(0), u16(0), u16(0),
      u32(e.extAttr || 0), u32(off), name]));
    locals.push(local, body);
    off += local.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(cd.length), u32(off), u16(0)]);
  return Buffer.concat([...locals, cd, eocd]);
}

const para = (t) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`;
const docXml = (body) => `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>${body}</w:body></w:document>`;
const RESUME = docXml(['Jordan Lee', 'jordan@example.com | 555-0100 | Denver, CO', 'Experience',
  'Barista, Blue Bottle Coffee, Denver, CO, Jun 2021 – Present',
  'Served 200+ customers per shift and trained 6 new baristas on espresso calibration.',
  'Education', 'A.A. Liberal Arts, Front Range Community College, 2020', 'Skills', 'Latte art, inventory, cash handling'].map(para).join(''));
// 11 MB of real XML (whitespace padding) — ~11 KB compressed.
const BOMB_XML = docXml(para('Jordan Lee') + ' '.repeat(11 * MiB));

async function rejected(promiseOrFn) {
  try { await (typeof promiseOrFn === 'function' ? promiseOrFn() : promiseOrFn); }
  catch (e) { if (e instanceof ArchiveRejected) return e; throw e; }
  assert.fail('expected ArchiveRejected');
}

test('a normal .docx still reads, through one guarded zip', async () => {
  const buf = zip([{ name: '[Content_Types].xml', data: '<Types/>' }, { name: 'word/document.xml', data: RESUME }]);
  const r = await extractResumeFile({ buffer: buf, fileName: 'jordan.docx' });
  assert.equal(r.ok, true, r.error);
  assert.match(r.text, /Blue Bottle Coffee/);
  assert.equal(String(await readZipEntry(buf, 'word/document.xml')), RESUME);
  assert.equal(await readZipEntry(buf, 'word/missing.xml'), null);
  assert.equal(await readZipEntry(Buffer.from('not a zip at all'), 'word/document.xml'), null);
});

test('11 MB of compressed XML is refused with the honest message (honest header)', async () => {
  const buf = zip([{ name: 'word/document.xml', data: BOMB_XML }]);
  assert.ok(buf.length < 64 * 1024, `tiny upload (${buf.length} B)`);
  const r = await extractResumeFile({ buffer: buf, fileName: 'resume.docx' });
  assert.equal(r.ok, false);
  assert.equal(r.status, 422);
  assert.equal(r.error, TOO_LARGE);
  assert.ok(['compression_ratio_exceeded', 'uncompressed_size_exceeded'].includes(r.code), r.code);
});

test('a header that lies about the size is caught by counting the real output', async () => {
  // Claims 1,000 bytes; zlib is capped at the remaining budget and stops at 10 MB, not 11.
  const buf = zip([{ name: 'word/document.xml', data: BOMB_XML, declaredSize: 1000 }]);
  const e = await rejected(() => openZip(buf).read('word/document.xml'));
  assert.equal(e.code, 'uncompressed_size_exceeded');
  // A small lie (actual ≠ declared, within budget) is damage, not a size problem.
  const small = zip([{ name: 'word/document.xml', data: RESUME, declaredSize: 50 }]);
  assert.equal((await rejected(() => openZip(small).read('word/document.xml'))).code, 'header_mismatch');
});

test('one budget per upload: parts that each fit still fail together', async () => {
  const part = docXml(para('x'.repeat(50 * 1024)));
  const buf = zip([{ name: 'word/document.xml', data: part }, { name: 'word/header1.xml', data: part }]);
  const budget = createBudget({ maxBytes: 80 * 1024 });
  const z = openZip(buf, { budget });
  assert.ok(z.read('word/document.xml'));
  assert.equal((await rejected(() => z.read('word/header1.xml'))).code, 'uncompressed_size_exceeded');
  // The DOCX extractor shares one budget across document.xml and the header parts.
  const e = await rejected(extractDocxLayout(buf, { budget: createBudget({ maxBytes: 80 * 1024 }) }));
  assert.equal(e.code, 'uncompressed_size_exceeded');
});

test('a zip hidden inside a DOCX part is never opened', async () => {
  const inner = zip([{ name: 'word/document.xml', data: RESUME }]);
  const buf = zip([{ name: 'word/document.xml', data: inner }]);
  const r = await extractResumeFile({ buffer: buf, fileName: 'resume.docx' });
  assert.equal(r.code, 'nested_archive');
  assert.equal(r.error, TOO_LARGE);
});

test('entry count, encryption, compression method, names, symlinks, duplicates, CRC', async () => {
  const doc = { name: 'word/document.xml', data: RESUME };
  const many = zip([doc, ...Array.from({ length: ARCHIVE_LIMITS.maxEntries }, (_, i) => ({ name: `e${i}`, data: '', method: 0 }))]);
  const cases = [
    [many, 'too_many_entries', TOO_LARGE],
    [zip([{ ...doc, flags: 0x1 }]), 'encrypted', /password-protected/],
    [zip([{ ...doc, method: 12, compressed: Buffer.from('BZh9') }]), 'unsupported_compression', DAMAGED],
    [zip([doc, { name: '../../evil.sh', data: 'x' }]), 'path_traversal', DAMAGED],
    [zip([doc, { name: '/etc/passwd', data: 'x' }]), 'absolute_path', DAMAGED],
    [zip([doc, { name: 'word/a\nb.xml', data: 'x' }]), 'unsafe_path', DAMAGED],
    [zip([doc, { name: 'link', data: '/etc/passwd', madeBy: (3 << 8) | 20, extAttr: (0o120777 << 16) >>> 0 }]), 'symlink', DAMAGED],
    [zip([doc, { name: 'Word/Document.xml', data: RESUME }]), 'duplicate_name', DAMAGED],
    [zip([{ ...doc, crc: 12345 }]), 'corrupt', DAMAGED],
    [zip([{ name: 'word/document.xml', data: Buffer.alloc(2 * MiB) }]), 'compression_ratio_exceeded', TOO_LARGE],
  ];
  for (const [buf, code, msg] of cases) {
    const r = await extractResumeFile({ buffer: buf, fileName: 'resume.docx' });
    assert.equal(r.ok, false, code);
    assert.equal(r.code, code);
    assert.equal(r.status, 422);
    if (msg instanceof RegExp) assert.match(r.error, msg); else assert.equal(r.error, msg);
  }
});

test('the deadline is checked before and between entries', async () => {
  const buf = zip([{ name: 'word/document.xml', data: RESUME }, { name: 'word/header1.xml', data: RESUME }]);
  let t = 0;
  const budget = createBudget({ maxMs: 5000, now: () => (t += 2000) });
  const z = openZip(buf, { budget });            // t=4000 after setup + open
  assert.equal((await rejected(() => z.read('word/document.xml'))).code, 'time_exceeded');
});

test('an old .doc / password-protected Word file (OLE container) gets its own honest message', async () => {
  const ole = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(600)]);
  const r = await extractResumeFile({ buffer: ole, fileName: 'resume.doc' });
  assert.equal(r.code, 'ole_container');
  assert.match(r.error, /save it as a \.docx/);
});

test('a non-zip renamed .docx keeps the old "could not extract" answer', async () => {
  const r = await extractResumeFile({ buffer: Buffer.from('%PDF-1.4 '.repeat(20)), fileName: 'resume.docx' });
  assert.equal(r.ok, false);
  assert.equal(r.status, 422);
  assert.equal(r.code, undefined);
});

test('malformed structure is "damaged", never a thrown 500', async () => {
  const good = zip([{ name: 'word/document.xml', data: RESUME }]);
  const truncated = Buffer.concat([good.subarray(0, 40), good.subarray(good.length - 22)]);
  const r = await extractResumeFile({ buffer: truncated, fileName: 'resume.docx' });
  assert.equal(r.ok, false);
  assert.equal(r.error, DAMAGED);
});

test('inflateCounted stops zlib at the budget (a 1 GiB bomb costs ~10 MB of work)', () => {
  const bomb = zlib.deflateRawSync(Buffer.alloc(256 * MiB));
  const t0 = Date.now();
  assert.throws(() => inflateCounted(bomb, createBudget()), (e) => e instanceof ArchiveRejected && e.code === 'uncompressed_size_exceeded');
  assert.ok(Date.now() - t0 < 1000, 'stopped early');
});

test('every rejection is logged once, without contents, with a sanitized name', async () => {
  const lines = [];
  const orig = console.warn;
  console.warn = (...a) => lines.push(format(...a));
  try {
    await extractResumeFile({ buffer: zip([{ name: 'word/document.xml', data: BOMB_XML }]), fileName: 'evil\n\u2028name.docx' });
  } finally { console.warn = orig; }
  assert.equal(lines.length, 1);
  const line = lines[0];
  assert.match(line, /^\[archive-guard\] /);
  const rec = JSON.parse(line.replace(/^\[archive-guard\] /, ''));
  assert.equal(rec.event, 'upload_rejected');
  assert.equal(rec.file_type, 'word');
  assert.equal(rec.file_ext, '.docx');
  assert.match(rec.sha256, /^[0-9a-f]{16}$/);
  assert.ok(!/Jordan|evil|\n/.test(line), 'no contents, no raw name, single line');
});

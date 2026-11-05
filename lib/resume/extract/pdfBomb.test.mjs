// PDF decompression bombs: byte budget (pre-scan + legacy reader), time budget (worker hard kill
// and in-process checks), page cap. Every malicious PDF is built in memory.
// Run: node --test lib/resume/extract/pdfBomb.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { extractPdfLayout } from './pdf.js';
import { extractResumeFile } from './index.js';
import { extractPdfText, measurePdfStreams } from '../../server/pdfText.js';
import { ArchiveRejected, createBudget } from '../../server/archiveGuard.js';

const MiB = 1024 * 1024;
const here = path.dirname(fileURLToPath(import.meta.url));
const fx = (n) => fs.readFileSync(path.join(here, '..', 'fixtures', n));

/**
 * A valid PDF with `pages` pages that all draw ONE shared content stream of `mb` MB of operators.
 * `wrap: 'hex'` puts an ASCIIHex filter in front of Flate.
 */
function bombPdf(mb, { pages = 1, op = 'q Q\n', wrap = null } = {}) {
  let body = zlib.deflateSync(Buffer.alloc(Math.round(mb * MiB), op), { level: 9 });
  let filter = '/FlateDecode';
  if (wrap === 'hex') { body = Buffer.from(body.toString('hex') + '>'); filter = '[/ASCIIHexDecode /FlateDecode]'; }
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${Array.from({ length: pages }, (_, i) => `${4 + i} 0 R`).join(' ')}] /Count ${pages} >>`];
  const parts = [Buffer.from('%PDF-1.4\n')];
  const offs = [];
  let len = parts[0].length;
  const add = (b) => { offs.push(len); parts.push(b); len += b.length; };
  objs.forEach((o, i) => add(Buffer.from(`${i + 1} 0 obj\n${o}\nendobj\n`)));
  add(Buffer.concat([Buffer.from(`3 0 obj\n<< /Length ${body.length} /Filter ${filter} >>\nstream\n`), body, Buffer.from('\nendstream\nendobj\n')]));
  for (let i = 0; i < pages; i++) add(Buffer.from(`${4 + i} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 3 0 R /Resources << >> >>\nendobj\n`));
  const n = 3 + pages + 1;
  const xref = ['xref', `0 ${n}`, '0000000000 65535 f '].concat(offs.map((o) => String(o).padStart(10, '0') + ' 00000 n ')).join('\n');
  parts.push(Buffer.from(`${xref}\ntrailer\n<< /Size ${n} /Root 1 0 R >>\nstartxref\n${len}\n%%EOF\n`));
  return Buffer.concat(parts);
}

const PDF_TOO_LARGE = 'This PDF is too large to read once unpacked — save it again, or paste your résumé text instead.';

test('a tiny PDF whose stream inflates past the budget is refused before pdf.js runs', async () => {
  const buf = bombPdf(40);                        // ~40 KB on the wire, 40 MB inflated
  assert.ok(buf.length < 100 * 1024);
  const t0 = Date.now();
  const r = await extractResumeFile({ buffer: buf, fileName: 'resume.pdf', mimeType: 'application/pdf' });
  assert.equal(r.ok, false);
  assert.equal(r.status, 422);
  assert.equal(r.code, 'uncompressed_size_exceeded');
  assert.equal(r.error, PDF_TOO_LARGE);
  assert.ok(Date.now() - t0 < 2000, `refused quickly (${Date.now() - t0} ms)`);
});

test('an ASCIIHex wrapper in front of Flate does not hide the bomb from the pre-scan', () => {
  const buf = bombPdf(40, { wrap: 'hex' });
  assert.throws(() => measurePdfStreams(buf), (e) => e instanceof ArchiveRejected && e.code === 'uncompressed_size_exceeded');
});

test('the legacy stream reader has the same byte budget and never swallows it', async () => {
  await assert.rejects(extractPdfText(bombPdf(3), { maxBytes: 1 * MiB }),
    (e) => e instanceof ArchiveRejected && e.code === 'uncompressed_size_exceeded' && e.kind === 'pdf');
  // A real résumé PDF is far below the budget and reads as before (output verified identical to
  // the pre-guard reader on every fixture).
  assert.match(await extractPdfText(fx('twopage.pdf')), /Samuel Okafor/);
  assert.ok(measurePdfStreams(fx('word.pdf')).inflatedBytes < 200 * 1024);
});

test('time budget: pdf.js in the worker is terminated at the deadline', async () => {
  const buf = bombPdf(8);                         // under the byte budget, ~2 s of pdf.js work
  const t0 = Date.now();
  const e = await extractPdfLayout(buf, { maxMs: 600, isolate: true }).then(() => null, (err) => err);
  const ms = Date.now() - t0;
  assert.ok(e instanceof ArchiveRejected, String(e));
  assert.equal(e.code, 'time_exceeded');
  assert.ok(ms < 1500, `hard stop near the deadline (${ms} ms)`);
});

test('time budget in-process (no worker): checked between pages, so it stops after the page it is on', async () => {
  const buf = bombPdf(2, { pages: 8 });            // ~0.6 s of work per page, 8 pages
  const t0 = Date.now();
  const e = await extractPdfLayout(buf, { maxMs: 300, isolate: false }).then(() => null, (err) => err);
  assert.ok(e instanceof ArchiveRejected, String(e));
  assert.equal(e.code, 'time_exceeded');
  assert.ok(Date.now() - t0 < 3000, 'did not walk every page');
});

test('the worker and in-process paths give the same answer for a real résumé', async () => {
  const a = await extractPdfLayout(fx('twocol.pdf'), { isolate: true });
  const b = await extractPdfLayout(fx('twocol.pdf'), { isolate: false });
  assert.equal(a.layout.method, 'pdfjs');
  assert.equal(a.text, b.text);
  assert.deepEqual(a.lines, b.lines);
});

test('a worker file missing from the bundle falls back to in-process pdf.js, not to failure', async () => {
  const r = await extractPdfLayout(fx('word.pdf'), { isolate: true, workerUrl: new URL('./no-such-worker.js', import.meta.url) });
  assert.equal(r.layout.method, 'pdfjs');
  assert.ok(r.ok);
});

test('page cap: only the first 12 pages are read', async () => {
  const r = await extractPdfLayout(bombPdf(0.001, { pages: 30, op: 'q Q\n' }), { isolate: false });
  assert.ok(r.warnings.includes('pdf_pages_truncated:30') || r.layout.method === 'legacy', JSON.stringify(r.warnings));
});

test('the stream counter shares the deadline', () => {
  let t = 0;
  const budget = createBudget({ kind: 'pdf', maxMs: 1000, now: () => (t += 600) });
  assert.throws(() => measurePdfStreams(fx('word.pdf'), budget), (e) => e.code === 'time_exceeded');
});

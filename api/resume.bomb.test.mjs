// /api/resume action:'parse' refuses decompression bombs with an honest 422 + machine code.
// Run: node --test api/resume.bomb.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';

process.env.SUPABASE_URL = 'https://db.example';
process.env.SUPABASE_SERVICE_KEY = 'service-key';
globalThis.fetch = async () => new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
const { default: handler } = await import('./resume.js');
const { crc32 } = await import('../lib/server/zip.js');

function mockRes() {
  return { code: 200, headers: {}, body: null, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(o) { this.body = o; return this; }, send(b) { this.body = b; return this; }, end(b) { this.body = b; return this; } };
}
const call = async (body) => { const res = mockRes(); await handler({ method: 'POST', headers: { origin: 'https://seenjobs.io' }, socket: { remoteAddress: '10.0.0.9' }, body }, res); return res; };
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };

function oneEntryZip(name, data) {
  const n = Buffer.from(name), comp = zlib.deflateRawSync(data, { level: 9 }), crc = crc32(data);
  const local = Buffer.concat([u32(0x04034b50), u16(20), u16(0), u16(8), u16(0), u16(0), u32(crc), u32(comp.length), u32(data.length), u16(n.length), u16(0), n]);
  const cd = Buffer.concat([u32(0x02014b50), u16(20), u16(20), u16(0), u16(8), u16(0), u16(0), u32(crc), u32(comp.length), u32(data.length), u16(n.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(0), n]);
  return Buffer.concat([local, comp, cd, u32(0x06054b50), u16(0), u16(0), u16(1), u16(1), u32(cd.length), u32(local.length + comp.length), u16(0)]);
}

test('a DOCX that unpacks to 11 MB → 422, friendly message, code', async () => {
  const xml = Buffer.from('<?xml version="1.0"?><w:document xmlns:w="x"><w:body>' + ' '.repeat(11 * 1024 * 1024) + '</w:body></w:document>');
  const res = await call({ action: 'parse', base64: oneEntryZip('word/document.xml', xml).toString('base64'), fileName: 'resume.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  assert.equal(res.code, 422, JSON.stringify(res.body));
  assert.equal(res.body.error, 'This file is too large to read once unpacked — save it again or upload a PDF.');
  assert.ok(['compression_ratio_exceeded', 'uncompressed_size_exceeded'].includes(res.body.code), res.body.code);
});

test('a 40 KB PDF whose stream inflates to 40 MB → 422 before pdf.js runs', async () => {
  const body = zlib.deflateSync(Buffer.alloc(40 * 1024 * 1024, 'q Q\n'));
  const pdf = Buffer.concat([Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Length ${body.length} /Filter /FlateDecode >>\nstream\n`), body, Buffer.from('\nendstream\nendobj\n%%EOF\n')]);
  const t0 = Date.now();
  const res = await call({ action: 'parse', base64: pdf.toString('base64'), fileName: 'resume.pdf', mimeType: 'application/pdf' });
  assert.equal(res.code, 422, JSON.stringify(res.body));
  assert.equal(res.body.code, 'uncompressed_size_exceeded');
  assert.match(res.body.error, /too large to read once unpacked/);
  assert.ok(Date.now() - t0 < 2000);
});

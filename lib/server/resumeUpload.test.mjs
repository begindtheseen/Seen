// Tests: résumé upload text extraction — the .txt / .md parse path (COMMIT 4).
// Run: node --test lib/server/resumeUpload.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { extractUploadText } from './resumeUpload.js';

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

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

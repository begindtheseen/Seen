// Tests for the Legal Audit evidence PACKAGE (ZIP of PDF + source JSON + manifest).
// Run: node --test lib/server/companyAuditPackage.test.mjs
//
// The whole point of the package is a self-verifying hash chain: the PDF, the source JSON, and the
// manifest all come from ONE bundle, so sha256(json) must equal the manifest's source hash AND the
// SHA-256 printed inside the PDF, and sha256(pdf) must equal the manifest's pdf hash.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';

import { buildAuditPackage } from './companyAuditPackage.js';
import { buildCompanyAuditBundle, auditBundleHash } from '../../api/_utils/companyAuditBundle.js';

const sha256hex = (buf) => createHash('sha256').update(buf).digest('hex');

// ── Read our own ZIP: parse the central directory, inflate each entry. ──
function readZip(buf) {
  const eocd = buf.length - 22;
  assert.equal(buf.readUInt32LE(eocd), 0x06054b50, 'EOCD present');
  const count = buf.readUInt16LE(eocd + 10);
  let cd = buf.readUInt32LE(eocd + 16);
  const out = {};
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(cd + 10);
    const compSize = buf.readUInt32LE(cd + 20);
    const nameLen = buf.readUInt16LE(cd + 28);
    const extraLen = buf.readUInt16LE(cd + 32);
    const commentLen = buf.readUInt16LE(cd + 34);
    const lho = buf.readUInt32LE(cd + 42);
    const name = buf.slice(cd + 46, cd + 46 + nameLen).toString('utf8');
    const lNameLen = buf.readUInt16LE(lho + 26);
    const lExtraLen = buf.readUInt16LE(lho + 28);
    const dataStart = lho + 30 + lNameLen + lExtraLen;
    const comp = buf.slice(dataStart, dataStart + compSize);
    out[name] = method === 8 ? zlib.inflateRawSync(comp) : Buffer.from(comp);
    cd += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

// Extract readable text from a pdfkit buffer (literal + hex-kerned runs). Same as the PDF test.
function pdfText(buf) {
  const STREAM = Buffer.from('stream'), END = Buffer.from('endstream');
  let out = '';
  let i = 0;
  while (true) {
    const s = buf.indexOf(STREAM, i);
    if (s < 0) break;
    if (s >= 3 && buf.slice(s - 3, s).toString('latin1') === 'end') { i = s + 6; continue; }
    let start = s + 6;
    if (buf[start] === 0x0d) start++;
    if (buf[start] === 0x0a) start++;
    const e = buf.indexOf(END, start);
    if (e < 0) break;
    let end = e;
    while (end > start && (buf[end - 1] === 0x0a || buf[end - 1] === 0x0d)) end--;
    const data = buf.subarray(start, end);
    let text = null;
    for (const fn of [zlib.inflateSync, zlib.inflateRawSync]) { try { text = fn(data).toString('latin1'); break; } catch { /* next */ } }
    if (text == null) text = data.toString('latin1');
    let m;
    const lit = /\((?:[^()\\]|\\.)*\)/g;
    while ((m = lit.exec(text))) out += m[0].slice(1, -1).replace(/\\([()\\])/g, '$1');
    const hex = /<([0-9a-fA-F\s]+)>/g;
    while ((m = hex.exec(text))) {
      const h = m[1].replace(/\s+/g, '');
      if (h.length % 2) continue;
      for (let k = 0; k < h.length; k += 2) out += String.fromCharCode(parseInt(h.substr(k, 2), 16));
    }
    out += ' ';
    i = e + 9;
  }
  return out;
}

// Mock db with a report carrying a user_id → produces a pseudonymized submitter token in the JSON.
function mockDb() {
  return (path) => {
    let rows = [];
    if (path.startsWith('companies?name=ilike')) rows = [{ id: 'co-0', name: 'FedEx', logo_letter: 'F', created_at: '2020-01-01T00:00:00Z' }];
    else if (path.startsWith('company_scores?')) rows = [{ id: 'score-1', company_name: 'fedex', overall_score: 58, data_quality: 'medium', created_at: '2026-07-01T00:00:00Z', expires_at: '2027-07-01T00:00:00Z' }];
    else if (path.startsWith('reports?')) rows = [
      { id: 'r1', company_name: 'fedex', company_id: 'co-0', location_id: 'loc-1', role: 'Courier', platform: 'direct', source: 'seen_intel', outcome: 'responded', rounds: 2, wait_days: 10, needs_review: false, outcome_weight: 1, trust_reason: 'direct_submission', user_id: 'user-abc', created_at: '2026-05-01T00:00:00Z' },
    ];
    else if (path.startsWith('company_aliases?')) rows = [{ alias: 'fedex corp', canonical: 'fedex' }];
    else if (path.startsWith('company_locations?')) rows = [{ id: 'loc-1', city: 'Memphis' }];
    return Promise.resolve({ ok: true, json: async () => rows });
  };
}

async function makeBundle() {
  return buildCompanyAuditBundle({ db: mockDb(), serviceKey: 'test-secret', adminId: 'admin-7', adminRole: 'super_admin', company: 'FedEx' });
}

test('package is a valid ZIP with exactly the three expected files', async () => {
  const { zip } = await buildAuditPackage(await makeBundle(), { codeVersion: 'abc123' });
  assert.equal(zip.subarray(0, 4).toString('latin1'), 'PK\x03\x04');
  const files = readZip(zip);
  assert.deepEqual(Object.keys(files).sort(), ['company-audit-source.json', 'company-audit.pdf', 'manifest.json']);
});

test('hash chain is self-consistent: JSON ↔ manifest ↔ PDF', async () => {
  const bundle = await makeBundle();
  const { zip, sourceHash, pdfSha } = await buildAuditPackage(bundle, { codeVersion: 'abc123' });
  const files = readZip(zip);
  const manifest = JSON.parse(files['manifest.json'].toString('utf8'));

  // sha256 of the JSON entry equals the manifest source hash AND what buildAuditPackage returned.
  const jsonHash = sha256hex(files['company-audit-source.json']);
  assert.equal(jsonHash, sourceHash, 'json entry hash == returned sourceHash');
  assert.equal(jsonHash, manifest.source_json_sha256, 'json entry hash == manifest.source_json_sha256');
  // …and that hash is the exact bytes auditBundleHash produced (not a pretty-printed copy).
  assert.equal(jsonHash, auditBundleHash(bundle).hash, 'json entry is the canonical hashed bytes');

  // The PDF prints that same source hash on its cover/appendix.
  const text = pdfText(files['company-audit.pdf']);
  assert.ok(text.includes(sourceHash), 'PDF prints the source JSON SHA-256');

  // sha256 of the PDF entry equals the manifest pdf hash.
  assert.equal(sha256hex(files['company-audit.pdf']), manifest.pdf_sha256, 'pdf entry hash == manifest.pdf_sha256');
  assert.equal(pdfSha, manifest.pdf_sha256, 'returned pdfSha == manifest.pdf_sha256');
});

test('manifest carries every required provenance field', async () => {
  const bundle = await makeBundle();
  const { zip } = await buildAuditPackage(bundle, { codeVersion: 'deadbeef' });
  const manifest = JSON.parse(readZip(zip)['manifest.json'].toString('utf8'));
  assert.equal(manifest.company_query, bundle.query);
  assert.equal(manifest.generated_at, bundle.generated_at);
  assert.equal(manifest.schema_version, bundle.schema_version);
  assert.equal(manifest.code_version, 'deadbeef');
  assert.deepEqual(manifest.generated_by, bundle.generated_by);
  assert.equal(typeof manifest.source_json_sha256, 'string');
  assert.equal(typeof manifest.pdf_sha256, 'string');
  assert.equal(manifest.report_counts.total_reports, bundle.totals.total_reports);
  assert.ok(Array.isArray(manifest.files) && manifest.files.length === 3);
  assert.ok(Array.isArray(manifest.verification) && manifest.verification.length >= 2);
});

test('privacy: PDF entry prints NO submitter token or secrets; JSON entry carries the pseudonym (by design)', async () => {
  const { zip } = await buildAuditPackage(await makeBundle(), {});
  const files = readZip(zip);
  const pdfStr = pdfText(files['company-audit.pdf']);
  const jsonStr = files['company-audit-source.json'].toString('utf8');

  // The JSON source legitimately contains the pseudonymized (keyed one-way) token…
  assert.match(jsonStr, /sub_[0-9a-f]{16}/, 'JSON source carries the pseudonym token by design');
  assert.ok(!jsonStr.includes('user-abc'), 'raw user_id never appears even in the JSON');

  // …but the PDF must print NO submitter identity and no secret-shaped material.
  assert.doesNotMatch(pdfStr, /sub_[0-9a-f]{8}/, 'PDF prints no submitter token');
  assert.doesNotMatch(pdfStr, /service_role|SUPABASE_SERVICE_KEY|BEGIN [A-Z ]*PRIVATE KEY|sk_live_|eyJ[A-Za-z0-9_-]{20}/, 'PDF prints no secrets');
  // The service secret used to derive the token must never appear anywhere in the package.
  assert.ok(!jsonStr.includes('test-secret') && !pdfStr.includes('test-secret'), 'hashing secret never leaks');
});

test('manifest legal wording is disclaimer-safe (no guilt/finding assertions)', async () => {
  const { zip } = await buildAuditPackage(await makeBundle(), {});
  const manifest = readZip(zip)['manifest.json'].toString('utf8');
  assert.match(manifest, /not a legal finding|not legal advice/i, 'manifest disavows being a legal finding');
  assert.match(manifest, /counsel|authorized legal representative|regulator/i, 'manifest uses requester-side legal language');
  // Never accusatory. "guilty" may appear ONLY inside an explicit negation ("not ... guilty of").
  assert.doesNotMatch(manifest, /\bprosecut|\bcriminal\b|\bverdict\b/i, 'no criminal/prosecutorial language');
  for (const m of manifest.matchAll(/guilty/gi)) {
    const before = manifest.slice(Math.max(0, m.index - 40), m.index);
    assert.match(before, /\bnot\b/i, 'every "guilty" mention is negated');
  }
});

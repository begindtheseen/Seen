// Tests for the Company Score Audit & Methodology Report (legal PDF).
// Run: node --test lib/server/companyAuditPdf.test.mjs
//
// Verifies the PDF renders from a sample audit bundle, carries the required legal/identity
// fields (company, source hash, confidence), raises the low-sample + low-confidence warnings,
// and — critically — never prints submitter identity or server secrets. Also exercises the
// shared bundle builder (raw JSON export) and the endpoint content type.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';

import { renderCompanyAuditPdf, LOW_SAMPLE_THRESHOLD } from './companyAuditPdf.js';
import { buildCompanyAuditBundle, auditBundleHash } from '../../api/_utils/companyAuditBundle.js';
import { explainListingScore, SCORE_RANGE, WASTE_RANGE } from './jobScore.js';

// ── Extract readable text from a pdfkit buffer. pdfkit FlateDecode-compresses content streams
//    and shows text two ways: literal (...) strings AND hex <...> runs inside kerned TJ arrays
//    (e.g. [<436f6d70616e79>] TJ = "Company"). We inflate each stream and decode BOTH forms. ──
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
    for (const fn of [zlib.inflateSync, zlib.inflateRawSync]) { try { text = fn(data).toString('latin1'); break; } catch { /* try next */ } }
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

// ── A realistic sample audit bundle (shape from api/_utils/companyAuditBundle.js) ──
function sampleBundle(over = {}) {
  const includedN = over.includedN ?? 12;
  const conf = over.confidence_label ?? 'high';
  const reports = [];
  for (let k = 0; k < includedN; k++) {
    reports.push({
      id: `rep-${k}-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee`,
      submitter: 'sub_deadbeefcafe1234',            // pseudonymized token — must NOT appear in the PDF
      created_at: '2026-05-01T12:00:00.000Z',
      company_name: 'fedex', company_id: `co-${k}`, city: 'Memphis', role: 'Courier',
      platform: 'direct', stored_source: 'seen_intel', source_type: 'direct', source_trust_weight: 1,
      outcome: k % 3 === 0 ? 'ghosted' : 'responded', ghost_stage: null, rounds: 2, wait_days: 14,
      unpaid_work: null, experience_level: 'mid', outcome_weight: 1, needs_review: false,
      included_in_score: true, trust_reason: 'direct_submission',
    });
  }
  reports.push({
    id: 'rep-held-99999999', submitter: null, created_at: '2026-05-02T09:00:00.000Z',
    company_name: 'fedex', company_id: 'co-h', city: null, role: 'Handler', platform: 'reddit',
    stored_source: 'reddit', source_type: 'reddit', source_trust_weight: 0.3, outcome: 'ghosted',
    ghost_stage: 'after_apply', rounds: null, wait_days: null, unpaid_work: null,
    experience_level: null, outcome_weight: 1, needs_review: true, included_in_score: false,
    trust_reason: 'velocity_capped',
  });
  return {
    export_type: 'company_audit_bundle', schema_version: 1,
    generated_at: '2026-07-02T22:00:00.000Z',
    generated_by: { admin_id: 'admin-7', role: 'super_admin' },
    query: 'FedEx',
    privacy_note: 'Submitter identities are pseudonymized via a keyed one-way hash.',
    company: { matched_records: [{ id: 'co-0', name: 'FedEx', logo_letter: 'F', created_at: '2020-01-01T00:00:00Z' }], aliases: ['fedex corp'] },
    cached_company_score: { id: 'score-1', company_name: 'fedex', overall_score: 58, data_quality: conf, created_at: '2026-07-01T00:00:00Z', expires_at: '2027-07-01T00:00:00Z' },
    computed_score: {
      overall_score: 58, base_score: 55, tenure_adjustment: 3, ghost_rate: 0.33, response_rate: 0.67,
      avg_wait_days: 14, avg_rounds: 2, unpaid_rate: 0, waste_score: 22, report_count: includedN,
      confidence: conf === 'low' ? 0.2 : 0.8, confidence_label: conf, sufficient: conf !== 'low',
      risk_level: 'warn', empirical: { resolved: includedN, eff_n: includedN }, sources_used: ['direct', 'reddit'],
    },
    source_breakdown: [{ source_type: 'direct', trust_weight: 1, report_count: includedN, resolved: includedN, ghosted: 4, responded: 8, weighted_resolved: includedN }],
    totals: { total_reports: includedN + 1, included_in_score: includedN, excluded_needs_review: 1, distinct_submitters: 1 },
    methodology: {
      description: 'Company grade = trust-weighted fusion of applicant-reported outcomes.',
      source_trust_weights: { direct: 1, seen_intel: 1, ingest: 0.55, reddit: 0.3 },
      prior_strength: 8,
      outcome_taxonomy: { ghost: ['ghosted'], response: ['responded', 'rejected'], non_terminal_excluded_from_rates: ['in_process'] },
    },
    reports,
    listing_methodology: {
      description: 'Each listing carries a transparency score computed only from signals present in the posting itself.',
      transparency_range: [SCORE_RANGE.min, SCORE_RANGE.max], transparency_baseline: SCORE_RANGE.baseline,
      waste_range: [WASTE_RANGE.min, WASTE_RANGE.max], waste_baseline: WASTE_RANGE.baseline,
      distinct_from_company_grade: 'The listing transparency score is independent of the company grade.',
    },
    listing_scores: [{
      id: 'job-1', title: 'Courier', location: 'Memphis, TN', source: 'Greenhouse', salary: '$45k', type: 'Full-time',
      posted_at: '2026-06-01T00:00:00Z', apply_url: 'https://ex/1', description_length: 640, score_mismatch: false,
      ...explainListingScore({ title: 'Courier', company: 'FedEx', source: 'Greenhouse', salary: '$45k', salary_min: 45000, type: 'Full-time',
        description: 'Deliver packages. interview process: 2 rounds. 401k pto. '.repeat(12), score: 71, waste_score: 14 }),
    }],
    ...over.bundle,
  };
}

test('renders a valid PDF from a sample audit bundle', async () => {
  const pdf = await renderCompanyAuditPdf(sampleBundle(), { sourceHash: 'a'.repeat(64) });
  assert.ok(Buffer.isBuffer(pdf), 'returns a Buffer');
  assert.equal(pdf.subarray(0, 5).toString('latin1'), '%PDF-', 'has the PDF magic header (content type application/pdf)');
  assert.ok(pdf.length > 3000, 'is a non-trivial document');
});

test('PDF contains the company name', async () => {
  const txt = pdfText(await renderCompanyAuditPdf(sampleBundle(), { sourceHash: 'b'.repeat(64) }));
  assert.match(txt, /FedEx/, 'company name is present');
});

test('PDF contains the source JSON SHA-256', async () => {
  const hash = 'c'.repeat(64);
  const txt = pdfText(await renderCompanyAuditPdf(sampleBundle(), { sourceHash: hash }));
  assert.ok(txt.includes(hash), 'full source hash printed');
});

test('PDF contains the confidence label prominently', async () => {
  const txt = pdfText(await renderCompanyAuditPdf(sampleBundle({ confidence_label: 'high' }), { sourceHash: 'd'.repeat(64) }));
  assert.match(txt, /Confidence label/i);
  assert.match(txt, /High/);
});

test('low-confidence warning appears only when confidence_label is low', async () => {
  const low = pdfText(await renderCompanyAuditPdf(sampleBundle({ confidence_label: 'low' }), { sourceHash: 'e'.repeat(64) }));
  assert.match(low, /Low confidence/i, 'low-confidence warning present');
  const high = pdfText(await renderCompanyAuditPdf(sampleBundle({ confidence_label: 'high', includedN: 20 }), { sourceHash: 'f'.repeat(64) }));
  assert.doesNotMatch(high, /Low confidence/i, 'no low-confidence warning on a high-confidence score');
});

test('low-sample warning appears when included_in_score is below threshold', async () => {
  const few = pdfText(await renderCompanyAuditPdf(sampleBundle({ includedN: LOW_SAMPLE_THRESHOLD - 1, confidence_label: 'high' }), { sourceHash: '1'.repeat(64) }));
  assert.match(few, /Low sample size/i, 'low-sample warning present below threshold');
  const many = pdfText(await renderCompanyAuditPdf(sampleBundle({ includedN: LOW_SAMPLE_THRESHOLD + 5, confidence_label: 'high' }), { sourceHash: '2'.repeat(64) }));
  assert.doesNotMatch(many, /Low sample size/i, 'no low-sample warning at/above threshold');
});

test('PDF never prints submitter identity (pseudonymized token or null)', async () => {
  const txt = pdfText(await renderCompanyAuditPdf(sampleBundle(), { sourceHash: '3'.repeat(64) }));
  // The document may (and should) DISCUSS submitter privacy and report a distinct-submitter
  // count. What it must NEVER render is a submitter identity — the pseudonym token itself. The
  // evidence cards deliberately omit the `submitter` field, so no token in any form can appear.
  assert.ok(!txt.includes('sub_deadbeefcafe1234'), 'pseudonymized submitter token must not leak');
  assert.doesNotMatch(txt, /sub_[0-9a-f]{8}/, 'no submitter tokens of any kind');
});

test('PDF prints each listing score next to its factor reasons (legal explainability)', async () => {
  const txt = pdfText(await renderCompanyAuditPdf(sampleBundle(), { sourceHash: '7'.repeat(64) }));
  assert.match(txt, /Listing transparency scores/i, 'listing scores section heading present');
  assert.match(txt, /Listing #1: Courier/, 'the listing is named');
  assert.match(txt, /Why this transparency score/i, 'the score is shown with its reasons');
  // A concrete factor reason (from the Greenhouse ATS signal) is rendered in the document.
  assert.match(txt, /applicant tracking system|first-party/i, 'a specific factor reason is printed');
});

test('PDF does not include server secrets', async () => {
  const txt = pdfText(await renderCompanyAuditPdf(sampleBundle(), { sourceHash: '4'.repeat(64) }));
  assert.doesNotMatch(txt, /service_role|SUPABASE_SERVICE_KEY|BEGIN [A-Z ]*PRIVATE KEY|sk_live_|eyJ[A-Za-z0-9_-]{20}/, 'no secret-shaped material');
});

test('includes attorney-review + custodian placeholder + dispute protocol + limitations', async () => {
  const txt = pdfText(await renderCompanyAuditPdf(sampleBundle(), { sourceHash: '5'.repeat(64) }));
  assert.match(txt, /not legal advice/i, 'legal-positioning disclaimer present');
  assert.match(txt, /placeholder/i, 'custodian placeholder present');
  assert.match(txt, /sworn declaration/i, 'attorney-review-before-sworn-use warning present');
  assert.match(txt, /Custodian name/i, 'custodian signature fields present');
  assert.match(txt, /dispute|correction/i, 'dispute/correction protocol present');
  assert.match(txt, /not.*guilty|guilty of anything/i, 'explicitly not a finding of guilt');
});

// ── Raw JSON export (shared bundle builder) still works from a mocked db ──
function mockDb() {
  return (path) => {
    let rows = [];
    if (path.startsWith('companies?name=ilike')) rows = [{ id: 'co-0', name: 'FedEx', logo_letter: 'F', created_at: '2020-01-01T00:00:00Z' }];
    else if (path.startsWith('company_scores?')) rows = [{ id: 'score-1', company_name: 'fedex', overall_score: 58, data_quality: 'medium', created_at: '2026-07-01T00:00:00Z', expires_at: '2027-07-01T00:00:00Z' }];
    else if (path.startsWith('reports?')) rows = [
      { id: 'r1', company_name: 'fedex', company_id: 'co-0', location_id: 'loc-1', role: 'Courier', platform: 'direct', source: 'seen_intel', outcome: 'responded', ghost_stage: null, rounds: 2, wait_days: 10, unpaid_work: null, experience_level: 'mid', needs_review: false, outcome_weight: 1, trust_reason: 'direct_submission', user_id: 'user-abc', created_at: '2026-05-01T00:00:00Z' },
      { id: 'r2', company_name: 'fedex', company_id: 'co-0', location_id: null, role: 'Handler', platform: 'reddit', source: 'reddit', outcome: 'ghosted', ghost_stage: 'after_apply', rounds: null, wait_days: null, unpaid_work: null, experience_level: null, needs_review: true, outcome_weight: 1, trust_reason: 'velocity_capped', user_id: null, created_at: '2026-05-02T00:00:00Z' },
    ];
    else if (path.startsWith('company_aliases?')) rows = [{ alias: 'fedex corp', canonical: 'fedex' }];
    else if (path.startsWith('company_locations?')) rows = [{ id: 'loc-1', city: 'Memphis' }];
    else if (path.startsWith('jobs?')) rows = [
      { id: 'job-1', title: 'Courier', company: 'FedEx', location: 'Memphis, TN', salary: '$45k', source: 'Greenhouse', type: 'Full-time',
        description: 'Deliver packages. interview process: 2 rounds. 401k pto. '.repeat(12), score: 71, waste_score: 14, created_at: '2026-06-01T00:00:00Z', apply_url: 'https://ex/1' },
    ];
    return Promise.resolve({ ok: true, json: async () => rows });
  };
}

test('raw JSON export: buildCompanyAuditBundle assembles the bundle + pseudonymizes submitters', async () => {
  const bundle = await buildCompanyAuditBundle({ db: mockDb(), serviceKey: 'test-secret', adminId: 'admin-7', adminRole: 'super_admin', company: 'FedEx' });
  assert.equal(bundle.export_type, 'company_audit_bundle');
  assert.equal(bundle.company.matched_records[0].name, 'FedEx');
  assert.equal(bundle.totals.total_reports, 2);
  assert.equal(bundle.totals.included_in_score, 1);
  assert.equal(bundle.totals.excluded_needs_review, 1);
  assert.ok(bundle.computed_score && typeof bundle.computed_score.overall_score === 'number');
  // Submitter pseudonymized (keyed hash), never the raw user_id.
  const withUser = bundle.reports.find(r => r.id === 'r1');
  assert.match(withUser.submitter, /^sub_[0-9a-f]{16}$/, 'submitter is a keyed hash token');
  assert.ok(!JSON.stringify(bundle).includes('user-abc'), 'raw user_id never in the bundle');
  const anon = bundle.reports.find(r => r.id === 'r2');
  assert.equal(anon.submitter, null, 'anonymous rows have null submitter');
  // Serializes cleanly and hashes stably.
  const { json, hash } = auditBundleHash(bundle);
  assert.equal(hash, createHash('sha256').update(json).digest('hex'));
  assert.equal(hash.length, 64);
});

test('bundle documents every listing score next to its factor logic (legal explainability)', async () => {
  const bundle = await buildCompanyAuditBundle({ db: mockDb(), serviceKey: 'test-secret', adminId: 'admin-7', adminRole: 'super_admin', company: 'FedEx' });
  assert.equal(bundle.totals.total_listings, 1);
  assert.ok(Array.isArray(bundle.listing_scores) && bundle.listing_scores.length === 1);
  const l = bundle.listing_scores[0];
  assert.equal(l.id, 'job-1');
  // Every listing score is reconstructable from its stated factors — deltas sum to the raw.
  assert.ok(Array.isArray(l.score_factors) && l.score_factors.length > 0);
  assert.equal(l.score_factors.reduce((a, f) => a + f.points, 0), l.transparency_raw);
  assert.equal(l.waste_factors.reduce((a, f) => a + f.points, 0), l.waste_raw);
  // Each factor names a reason — no number without an explanation.
  for (const f of l.score_factors) assert.ok(f.reason && f.reason.length >= 10);
  // Methodology block is present and states the ranges.
  assert.ok(bundle.listing_methodology && Array.isArray(bundle.listing_methodology.transparency_range));
});

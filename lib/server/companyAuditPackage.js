// Company Score Audit — evidence PACKAGE assembler.
//
// The standalone JSON export and standalone PDF export each rebuild the bundle with a fresh
// `generated_at`, so their hashes can never match: a recipient who downloads both cannot prove the
// PDF's printed SHA-256 corresponds to the JSON they hold. This package fixes that — the PDF, the
// source JSON, and a manifest are all derived from ONE bundle object, in one call, so the chain is
// self-verifying:
//
//   company-audit-source.json  →  sha256  →  matches BOTH manifest.source_json_sha256
//                                            AND the SHA-256 printed inside company-audit.pdf
//   company-audit.pdf          →  sha256  →  matches manifest.pdf_sha256
//
// Critical: the JSON written here is the EXACT bytes that were hashed (auditBundleHash().json,
// compact) — never a re-stringified / pretty copy, which would not match the printed hash.
//
// Privacy asymmetry (documented in the manifest): the source JSON carries pseudonymized submitter
// tokens (`sub_…`, a keyed one-way hash — raw user_id is never present, not reversible without the
// server secret); the PDF prints NO submitter identity at all. No external AI. pdfkit only.

import { createHash } from 'crypto';
import { auditBundleHash } from '../../api/_utils/companyAuditBundle.js';
import { renderCompanyAuditPdf } from './companyAuditPdf.js';
import { createZip } from './zip.js';

const sha256hex = (buf) => createHash('sha256').update(buf).digest('hex');

/**
 * Assemble the evidence package from one bundle.
 * @param {object} bundle  a company_audit_bundle (from buildCompanyAuditBundle)
 * @param {{codeVersion?: string|null, engineVersion?: string|null, termsVersion?: string|null}} [opts]
 * @returns {Promise<{ zip: Buffer, sourceHash: string, pdfSha: string, manifest: object }>}
 */
export async function buildAuditPackage(bundle, opts = {}) {
  const { codeVersion = null, engineVersion = null, termsVersion = null } = opts;

  // The exact JSON bytes that were hashed — this IS company-audit-source.json.
  const { json, hash: sourceHash } = auditBundleHash(bundle);
  const sourceJsonBuf = Buffer.from(json, 'utf8');

  // Render the PDF from the SAME bundle, embedding the same source hash.
  const pdf = await renderCompanyAuditPdf(bundle, { sourceHash, codeVersion, engineVersion, termsVersion });
  const pdfSha = sha256hex(pdf);

  const totals = bundle.totals || {};
  const manifest = {
    package_format: 'seen_company_audit_package_v1',
    export_type: bundle.export_type,
    schema_version: bundle.schema_version,
    company_query: bundle.query,
    generated_at: bundle.generated_at,
    generated_by: bundle.generated_by || null,
    files: [
      { name: 'company-audit.pdf', type: 'application/pdf', sha256: pdfSha, description: 'The Company Score Audit & Methodology Report. Prints the source-JSON SHA-256 on its cover and appendix. Contains NO submitter identity.' },
      { name: 'company-audit-source.json', type: 'application/json', sha256: sourceHash, description: 'The exact audit bundle the PDF was rendered from — the bytes this hash is computed over.' },
      { name: 'manifest.json', type: 'application/json', description: 'This file — hashes, provenance, and verification instructions.' },
    ],
    source_json_sha256: sourceHash,
    pdf_sha256: pdfSha,
    code_version: codeVersion,
    scoring_engine_version: engineVersion,
    terms_privacy_version: termsVersion,
    report_counts: {
      total_reports: totals.total_reports ?? null,
      included_in_score: totals.included_in_score ?? null,
      excluded_needs_review: totals.excluded_needs_review ?? null,
      distinct_submitters: totals.distinct_submitters ?? null,
    },
    verification: [
      'Recompute sha256(company-audit-source.json) — it must equal source_json_sha256 in this manifest AND the "Source JSON SHA-256" printed on the PDF cover/appendix.',
      'Recompute sha256(company-audit.pdf) — it must equal pdf_sha256 in this manifest.',
      'If all three agree, the PDF, the source data, and this manifest are the one point-in-time export they claim to be.',
    ],
    privacy_note:
      'The source JSON pseudonymizes submitter identity as a keyed one-way hash token (sub_...); it is not reversible to an account without the server secret, which is not included. The PDF prints no submitter identity at all. Neither file contains raw user ids, emails, IP addresses, payment identifiers, auth tokens, or server secrets.',
    legal_positioning:
      'This package is a methodology and evidence disclosure prepared for a company, its counsel, an authorized legal representative, a regulator, or another legitimate legal requester. It is not legal advice, not a legal finding, and not a statement that the company is guilty of anything.',
  };
  const manifestBuf = Buffer.from(JSON.stringify(manifest, null, 2), 'utf8');

  // Deterministic archive time — the authoritative timestamp lives in the manifest/PDF, and a
  // fixed mtime keeps the ZIP bytes reproducible for the same bundle.
  const zip = createZip([
    { name: 'company-audit.pdf', data: pdf },
    { name: 'company-audit-source.json', data: sourceJsonBuf },
    { name: 'manifest.json', data: manifestBuf },
  ], new Date(0));

  return { zip, sourceHash, pdfSha, manifest };
}

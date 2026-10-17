// Honest report counts — the ONE place that turns a company_scores row (or a score payload built
// from one) into "how many applicant reports are actually behind this".
//
// company_scores.report_count is a FUSED number: real resolved report rows PLUS the LLM
// web-research pipeline's *claimed* mention count (observed live: Robert Half 3,085 and
// McDonald's 12,775 with zero report rows behind either). Migration 063 split it into
// first_party_report_count (real rows) and web_report_count (the web claim — never applicant
// reports). Any surface that SAYS "reports" / "applicant reports" / "Based on N reports", or gates
// a "reported" percentage on having reports, must use firstPartyReportCount() — never report_count.
// report_count stays the fused total for scoring math / ordering / back-compat.
//
// Legacy rows (pre-063, split columns null) infer from data_source: only 'reports'-derived scores
// were computed from real rows; anything else ('web_search'/'web_research'/'fused'/null) is a web
// claim and yields 0 first-party. This deliberately errs toward NOT claiming first-party.
//
// Pure (no I/O; its only import is the pure outcome taxonomy) — safe to import from server
// components, client components, and the api/*.js serverless handlers alike.

import { NONTERMINAL_OUTCOMES } from '../../api/_utils/companyIntel.js';

const toCount = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

const hasValue = (v) => v !== null && v !== undefined && v !== '';

/**
 * Real applicant-report rows behind a score. 0 for web-research-only rows.
 * @param {{first_party_report_count?: number|null, data_source?: string|null, report_count?: number|null}|null|undefined} row
 * @returns {number}
 */
export function firstPartyReportCount(row) {
  if (!row || typeof row !== 'object') return 0;
  if (hasValue(row.first_party_report_count)) return toCount(row.first_party_report_count);
  return row.data_source === 'reports' ? toCount(row.report_count) : 0;
}

/**
 * The web-research pipeline's claimed mention count — an estimate input, NEVER applicant reports.
 * @param {{web_report_count?: number|null, data_source?: string|null, report_count?: number|null}|null|undefined} row
 * @returns {number}
 */
export function webClaimCount(row) {
  if (!row || typeof row !== 'object') return 0;
  if (hasValue(row.web_report_count)) return toCount(row.web_report_count);
  return row.data_source === 'reports' ? 0 : toCount(row.report_count);
}

/**
 * The honest split as fields to spread onto an API/score payload, so clients that only receive
 * the payload never need data_source to label correctly.
 * @param {object|null|undefined} row
 * @returns {{first_party_report_count: number, web_report_count: number}}
 */
export function honestCountFields(row) {
  return { first_party_report_count: firstPartyReportCount(row), web_report_count: webClaimCount(row) };
}

/**
 * Of a company's first-party reports, how many came from attributed public discussion (Reddit
 * threads imported by the pipeline — platform "Reddit r/<sub>", trust-weighted 0.3). Clamped to the
 * first-party total so a count read at a different moment than the score's last recompute can never
 * display "30 of 12 from public discussion". Returns null when the split is unknown (fetch failed)
 * so callers show NO split rather than a wrong one.
 * @param {number|null|undefined} publicDiscussionRows
 * @param {number} firstParty
 * @returns {number|null}
 */
export function publicDiscussionShare(publicDiscussionRows, firstParty) {
  if (publicDiscussionRows === null || publicDiscussionRows === undefined) return null;
  const n = Number(publicDiscussionRows);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(Math.floor(n), toCount(firstParty));
}

/**
 * PostgREST path (relative to /rest/v1/) that counts a company's first-party report rows sourced
 * from public discussion — the SAME corpus the score fusion counts (api/reports.js
 * _fuseWithReports + api/_utils/reportWrite.js recompute): company_name ilike the stored name,
 * needs_review not true, a resolved (terminal) outcome — narrowed to platforms the fusion
 * classifies as reddit (classifyPlatform: /reddit/i). Use with `Prefer: count=exact` and read the
 * total from `content-range` (parseExactCount). Returns null for an empty name.
 * @param {string} companyName stored (lowercase) company_scores.company_name
 * @returns {string|null}
 */
export function publicDiscussionCountPath(companyName) {
  const name = String(companyName ?? '').toLowerCase().trim();
  if (!name) return null;
  const nonterminal = [...NONTERMINAL_OUTCOMES].map((o) => `"${o}"`).join(',');
  return `reports?select=id&company_name=ilike.${encodeURIComponent(name)}`
    + '&needs_review=not.is.true'
    + '&platform=ilike.*reddit*'
    + `&outcome=not.in.(${encodeURIComponent(nonterminal)})`
    + '&limit=1';
}

/**
 * Total from a PostgREST `content-range` header ("0-0/42" → 42, "*\/0" → 0). null when the total
 * is absent or unknown ("0-0/*", missing header) — callers must then show no number at all.
 * @param {string|null|undefined} contentRange
 * @returns {number|null}
 */
export function parseExactCount(contentRange) {
  const m = /\/(\d+)\s*$/.exec(String(contentRange ?? ''));
  return m ? parseInt(m[1], 10) : null;
}

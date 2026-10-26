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
 * Real applicant-account rows behind a score. 0 for web-research-only rows.
 *
 * NAMING (site-quality pass 2026-10-26): the stored field is `first_party_report_count`, but these rows
 * are NOT all reports filed with Seen — most are first-hand accounts compiled from public posts
 * (Reddit threads, public review pages), plus the reports Seen users submitted. Display copy says
 * "applicant accounts" and, where it is known, names the split ("47 from public posts · 1 from a
 * Seen user" — lib/glossary.js accountSources; seen_user_report_count below). The field name stays
 * for API/DB compatibility.
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
 * Of a company's first-party reports, how many came from attributed PUBLIC THIRD-PARTY sources —
 * Reddit threads imported by the pipeline (platform "Reddit r/<sub>") and first-hand accounts found
 * on public review sites by web search (platform "Public review · <host>"), both trust-weighted 0.3.
 * Display copy must name both ("public discussion threads and review sites"). Clamped to the
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
 * from public third-party sources — the SAME corpus the score fusion counts (api/reports.js
 * _fuseWithReports + api/_utils/reportWrite.js recompute): company_name ilike the stored name,
 * needs_review not true, a resolved (terminal) outcome — narrowed to platforms the fusion
 * classifies as reddit (classifyPlatform: /reddit/i) OR public_web (/^public review ·/i). Use with
 * `Prefer: count=exact` and read the total from `content-range` (parseExactCount). Returns null for
 * an empty name.
 * @param {string} companyName stored (lowercase) company_scores.company_name
 * @returns {string|null}
 */
export function publicDiscussionCountPath(companyName) {
  const name = String(companyName ?? '').toLowerCase().trim();
  if (!name) return null;
  const nonterminal = [...NONTERMINAL_OUTCOMES].map((o) => `"${o}"`).join(',');
  return `reports?select=id&company_name=ilike.${encodeURIComponent(name)}`
    + '&needs_review=not.is.true'
    + `&or=(${encodeURIComponent('platform.ilike.*reddit*,platform.ilike.public review ·*')})`
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

// ── Seen-user reports (the part of the evidence that was filed WITH Seen) ───────────────────────────
/** trust_reason values written by Seen's own submission paths (lib/reportSource.ts FIRST_PARTY_TRUST_REASONS). */
export const SEEN_USER_TRUST_REASONS = ['direct_submission', 'anonymous_unverified', 'duplicate_user_company'];

/**
 * PostgREST path listing the company name of every live, resolved report a Seen user submitted
 * (not a public post, not an import). One small read for a whole leaderboard; count it with
 * countSeenUserReports. Seen-user reports are few (prod 2026-10: dozens), so a 10,000 cap is ample.
 */
export function seenUserReportsPath() {
  const nonterminal = [...NONTERMINAL_OUTCOMES].map((o) => `"${o}"`).join(',');
  return `reports?select=company_name&trust_reason=in.(${SEEN_USER_TRUST_REASONS.join(',')})`
    + '&needs_review=not.is.true'
    + `&outcome=not.in.(${encodeURIComponent(nonterminal)})`
    + '&limit=10000';
}

/**
 * Seen-user report counts keyed by lowercased company name.
 * @param {Array<{company_name?: string|null}>|null|undefined} rows
 * @returns {Map<string, number>}
 */
export function countSeenUserReports(rows) {
  const m = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    const k = String(r?.company_name ?? '').toLowerCase().trim();
    if (k) m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
}

/**
 * The Seen-user share of a company's applicant accounts, clamped to the total; null when unknown
 * (the read failed) so a surface shows NO split rather than a wrong one.
 * @param {Map<string, number>|null} counts @param {string} companyName @param {number} total
 * @returns {number|null}
 */
export function seenUserShare(counts, companyName, total) {
  if (!counts) return null;
  const n = counts.get(String(companyName ?? '').toLowerCase().trim()) || 0;
  return Math.min(n, toCount(total));
}

// ── Grade gate (owner decision 2026-10-17) ──────────────────────────────────────────────────────
// A letter grade / overall score / ghost-rate / response-rate is a public verdict about a named
// employer. It is shown ONLY when at least MIN_REPORTS_FOR_GRADE real report rows stand behind it
// (first_party_report_count: Seen submissions + attributed public-review / Reddit rows). A web-research
// *claim* never counts toward it, so "Starbucks: B" from 2 reviews (or from an estimate alone) can
// not happen. Below the bar the company still shows its reports, counts and summary — just no verdict.
export const MIN_REPORTS_FOR_GRADE = 5;

/**
 * "What people are saying" mentions behind a score (company_scores.mention_count): quoted online
 * accounts that state a hiring outcome. They count toward the grade bar (owner request 2026-10-18)
 * at low weight in the rates, but a grade still needs at least MIN_REAL_REPORTS_FOR_GRADE real report
 * — mentions come from web research and never grade a company on their own.
 */
export const MIN_REAL_REPORTS_FOR_GRADE = 1;
/** Owner decision 2026-10-18: a mention counts exactly half of a report — in the rates and toward the bar. */
export const MENTION_WEIGHT = 0.5;
export function mentionCount(row) {
  if (!row || typeof row !== 'object') return 0;
  return hasValue(row.mention_count) ? toCount(row.mention_count) : 0;
}
/** Reports + half of each mention — the number shown as "N of 5" (may be a half, e.g. 3.5). */
export function gradeEvidenceCount(row) {
  return firstPartyReportCount(row) + MENTION_WEIGHT * mentionCount(row);
}

/** Is a score row / payload backed by enough evidence to show a grade? */
export function isGradeable(row) {
  return firstPartyReportCount(row) >= MIN_REAL_REPORTS_FOR_GRADE && gradeEvidenceCount(row) >= MIN_REPORTS_FOR_GRADE;
}

/** How many more reports/mentions a company needs before it can be graded (0 when gradeable). */
export function reportsNeededForGrade(row) {
  if (isGradeable(row)) return 0;
  return Math.max(1, MIN_REPORTS_FOR_GRADE - gradeEvidenceCount(row));
}

// Every verdict-like field a score payload can carry. Counts, reviews, industry and summary are
// factual and stay; these are derived judgements and are nulled below the bar.
export const GRADE_FIELDS = [
  'overall_score', 'process_score', 'base_score', 'tenure_adjustment', 'ghost_rate', 'response_rate',
  'avg_wait_days', 'avg_rounds', 'waste', 'waste_score', 'unpaid_rate', 'risk_level',
];

/**
 * The serving-layer gate: returns a copy of a score payload with `gradeable` and
 * `min_reports_for_grade` set, and every GRADE_FIELDS value nulled when the company is below the bar
 * (`sufficient` is forced false too). Pass-through for null / non-objects.
 * @template T
 * @param {T} score
 * @returns {T}
 */
export function gateScore(score) {
  if (!score || typeof score !== 'object') return score;
  const gradeable = isGradeable(score);
  const out = { ...score, gradeable, min_reports_for_grade: MIN_REPORTS_FOR_GRADE };
  if (!gradeable) {
    for (const f of GRADE_FIELDS) if (f in out) out[f] = null;
    if ('sufficient' in out) out.sufficient = false;
  }
  return out;
}

// ── Which reports count toward a score (owner decision 2026-10-17) ─────────────────────────────
// A company score uses EVERY report we hold — first-hand Seen submissions, attributed public
// reviews, Reddit threads, and imported Indeed / Glassdoor / LinkedIn / Blind reviews — each at its
// trust weight (api/_utils/companyIntel.js SOURCE_TRUST: direct 1.0, imports 0.55, public/Reddit 0.3).
// The ONLY rows held out are the anti-gaming guards, which wait for an admin: anonymous unverified
// submits and a signed-in user's duplicate / velocity-capped submits (assessSubmitTrust). Imported
// reviews are written needs_review:true so an admin can spot-check them, but they always count —
// before this, all 300 (SpaceX 100, Tesla 200) were silently dropped from every score.
//
// EMPLOYEE REVIEWS ARE NOT HIRING OUTCOMES. Of the 300 imports, 270 are Indeed employee reviews
// ("what it's like to work here") that the importer wrote with outcome 'human' — counted, they claimed
// SpaceX/Tesla answer 98% of applicants (score 99) when they say nothing about applicants. They stay
// on the company page, labeled "Employee review", and are excluded here; only the imported HIRING
// accounts (Glassdoor interview reports, Reddit) count. The import text marks them "employee review";
// the ingest writes new ones with trust_reason 'external_employee_review' (also never scored).
//
// ADMIN REVIEW (lib/server/reportReview.js) can take a row out of hold, so two trust reasons are
// excluded REGARDLESS of needs_review: an approved employee review keeps 'external_employee_review'
// (published, never a hiring outcome), and a rejected row is 'admin_rejected' (kept, never counted).
// `trust_reason.is.null` is explicit because SQL `<>` drops NULLs, and most first-party rows have none.
export const SCORE_COUNTED_TRUST_REASONS = ['external_import'];
export const EMPLOYEE_REVIEW_TRUST_REASON = 'external_employee_review';
export const REJECTED_TRUST_REASON = 'admin_rejected';
// A second stored copy of an account we already hold (lib/server/reportDupes.js) — kept, never counted.
export const DUPLICATE_TRUST_REASON = 'duplicate_import';
export const NEVER_SCORED_TRUST_REASONS = [EMPLOYEE_REVIEW_TRUST_REASON, REJECTED_TRUST_REASON, DUPLICATE_TRUST_REASON];
// "Reddit firsthand employee discussion" rows are the same thing (workplace accounts, not hiring outcomes).
export const EMPLOYEE_REVIEW_RE = /\bemployee (?:review|discussion)\b/i;
/** PostgREST filter (append with &) selecting the reports that count toward a score. */
export const SCORABLE_REPORTS_FILTER = `and=(or(trust_reason.is.null,trust_reason.not.in.(${NEVER_SCORED_TRUST_REASONS.join(',')})),`
  + 'or(needs_review.not.is.true,and(trust_reason.eq.external_import,report_text.not.ilike.*employee%20review*,report_text.not.ilike.*employee%20discussion*)))';
/** Same rule for a row already in memory. */
export function isScorableReport(row) {
  if (!row) return false;
  if (NEVER_SCORED_TRUST_REASONS.includes(row.trust_reason)) return false;
  if (row.needs_review !== true) return true;
  return SCORE_COUNTED_TRUST_REASONS.includes(row.trust_reason) && !EMPLOYEE_REVIEW_RE.test(String(row.report_text || ''));
}

/**
 * PostgREST path counting the reports a company's stored score SHOULD be built from: the scorable
 * corpus (SCORABLE_REPORTS_FILTER) with a resolved outcome — exactly what fuseCompanyIntel counts
 * as first_party_report_count. Use with `Prefer: count=exact` + parseExactCount. When this differs
 * from the stored count, the stored score is stale (new reports, or rows that were never counted)
 * and gets recomputed (api/reports.js score cache path). null for an empty name.
 * @param {string} companyName
 * @returns {string|null}
 */
export function scorableResolvedCountPath(companyName) {
  const name = String(companyName ?? '').toLowerCase().trim();
  if (!name) return null;
  const nonterminal = [...NONTERMINAL_OUTCOMES].map((o) => `"${o}"`).join(',');
  return `reports?select=id&company_name=ilike.${encodeURIComponent(name)}`
    + `&${SCORABLE_REPORTS_FILTER}`
    + `&outcome=not.in.(${encodeURIComponent(nonterminal)})`
    + '&limit=1';
}

// ── When a stored score was last (re)computed ──────────────────────────────────────────────────
// company_scores has no updated_at column (verified on prod 2026-10-23: id, company_name, …,
// created_at, expires_at, …) and PostgREST merge-duplicates leaves created_at at the FIRST write.
// Every writer (api/reports.js populate / reports-first / web-research paths and
// api/_utils/reportWrite.js recomputeCompanyScoreFromReports) sets expires_at = now + SCORE_TTL_MS,
// so the last write time is expires_at − SCORE_TTL_MS. That is the "Last updated" every grade shows.
export const SCORE_TTL_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * ISO timestamp of the row's last score write, or null when it cannot be known. Falls back to
 * created_at when expires_at is missing or implies a write in the future (a different TTL), and
 * never answers a time before the row was created.
 * @param {{expires_at?: string|null, created_at?: string|null}|null|undefined} row
 * @param {number} [now]
 * @returns {string|null}
 */
export function scoreUpdatedAt(row, now = Date.now()) {
  if (!row || typeof row !== 'object') return null;
  const created = row.created_at ? Date.parse(row.created_at) : NaN;
  const expires = row.expires_at ? Date.parse(row.expires_at) : NaN;
  let t = Number.isFinite(expires) ? expires - SCORE_TTL_MS : NaN;
  if (!Number.isFinite(t) || t > now + 60_000) t = created;
  if (Number.isFinite(created) && Number.isFinite(t) && t < created) t = created;
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

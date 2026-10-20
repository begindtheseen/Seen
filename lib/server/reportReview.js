// Held-report review queue — the pure rules behind Admin → Community → "Reports awaiting review".
//
// A held report (needs_review = true) is a CLAIM waiting for a human: imported review-site rows, the
// company-intel importer's applicant outcomes, and the anti-gaming holds (anonymous / duplicate /
// velocity). The owner reviews them here; these rules decide what each decision WRITES, so approving
// can never make the data less honest than it was:
//   • APPROVE a hiring account → it becomes public (needs_review=false). Its trust weight and source
//     are NOT touched — an imported 0.55 or a public 0.3 stays exactly that (the old approve_report
//     forced outcome_weight 1.0, promoting imports to first-party weight).
//   • APPROVE an employee review ("what it's like to work here") → public, but trust_reason becomes
//     'external_employee_review', which SCORABLE_REPORTS_FILTER excludes forever. Un-holding it
//     without that would have counted it as a hiring outcome (the 98%-response / score-99 distortion).
//   • REJECT → the row is KEPT (provenance survives) but stays hidden and out of every score:
//     needs_review stays true, trust_reason becomes 'admin_rejected', outcome_weight 0. The prior
//     values go to admin_audit_log so a rejection can be reversed by hand.
// The sort puts everything that is NOT a clear positive outcome first, so the owner reads those.

import { EMPLOYEE_REVIEW_RE, REJECTED_TRUST_REASON, EMPLOYEE_REVIEW_TRUST_REASON } from './reportCounts.js';

// Clear positives: the company engaged and moved the applicant forward. Everything else — ghosted,
// rejected, autoreject, assessment, unknown — is "needs your eyes".
export const POSITIVE_OUTCOMES = new Set([
  'hired', 'offer', 'offer_received', 'interview', 'interview_received', 'interview_completed',
  'responded', 'response_received', 'human', 'screening',
]);
// Anti-gaming holds (api/reports.js assessSubmitTrust): suspicious by construction, so always eyes.
export const ANTI_GAMING_TRUST = new Set(['anonymous_unverified', 'duplicate_user_company', 'velocity_capped']);

const URL_RE = /https?:\/\/[^\s\])"']+/i;

export function isEmployeeReviewRow(r) {
  return r?.trust_reason === EMPLOYEE_REVIEW_TRUST_REASON || EMPLOYEE_REVIEW_RE.test(String(r?.report_text || ''));
}

// One held row → what the reviewer needs to know about it.
export function classifyHeldReport(r) {
  const employee = isEmployeeReviewRow(r);
  const antiGaming = ANTI_GAMING_TRUST.has(String(r?.trust_reason || ''));
  const outcome = String(r?.outcome || '').toLowerCase();
  const positive = !employee && POSITIVE_OUTCOMES.has(outcome);
  const sourceUrl = (URL_RE.exec(String(r?.report_text || '')) || [])[0] || null;
  const flags = [];
  if (!sourceUrl && !antiGaming && !/^Seen\b/.test(String(r?.platform || ''))) flags.push('no_source_link');
  if (employee) flags.push('not_a_hiring_outcome');
  if (antiGaming) flags.push('anti_gaming_hold');
  const group = employee ? 'employee_review' : (positive && !antiGaming ? 'positive' : 'needs_eyes');
  return { kind: employee ? 'employee_review' : antiGaming ? 'anti_gaming' : 'hiring', positive, group, sourceUrl, flags };
}

const GROUP_ORDER = { needs_eyes: 0, positive: 1, employee_review: 2 };
const NEGATIVE_FIRST = ['ghosted', 'ghost', 'no_response', 'autoreject', 'rejected', 'rejection', 'assessment'];
const outcomeRank = (o) => { const i = NEGATIVE_FIRST.indexOf(String(o || '').toLowerCase()); return i < 0 ? NEGATIVE_FIRST.length : i; };
const ts = (r) => Date.parse(r.created_at) || 0;

// Same company + outcome + text in the held set is almost always one review imported twice. Flag
// every copy after the oldest so the reviewer can reject the extras (nothing is merged automatically).
export function markDuplicates(rows) {
  const seenKeys = new Set();
  for (const r of [...rows].sort((a, b) => ts(a) - ts(b))) {
    const key = `${String(r.company_name || '').toLowerCase().trim()}\n${String(r.outcome || '').toLowerCase()}\n${String(r.report_text || '').replace(/\s+/g, ' ').trim().toLowerCase()}`;
    r.review = r.review || classifyHeldReport(r);
    if (seenKeys.has(key) && String(r.report_text || '').trim()) r.review.flags.push('possible_duplicate');
    seenKeys.add(key);
  }
  return rows;
}

export const SORTS = ['needs_eyes', 'newest', 'oldest', 'company', 'outcome'];
export function sortHeldReports(rows, sort = 'needs_eyes') {
  const list = markDuplicates(rows.map((r) => ({ ...r, review: r.review || classifyHeldReport(r) })));
  const by = {
    needs_eyes: (a, b) => GROUP_ORDER[a.review.group] - GROUP_ORDER[b.review.group] || outcomeRank(a.outcome) - outcomeRank(b.outcome) || ts(b) - ts(a),
    newest: (a, b) => ts(b) - ts(a),
    oldest: (a, b) => ts(a) - ts(b),
    company: (a, b) => String(a.company_name || '').localeCompare(String(b.company_name || '')) || ts(b) - ts(a),
    outcome: (a, b) => outcomeRank(a.outcome) - outcomeRank(b.outcome) || String(a.outcome || '').localeCompare(String(b.outcome || '')) || ts(b) - ts(a),
  }[SORTS.includes(sort) ? sort : 'needs_eyes'];
  return list.sort(by);
}

export function groupCounts(rows) {
  const c = { total: rows.length, needs_eyes: 0, positive: 0, employee_review: 0 };
  for (const r of rows) c[(r.review || classifyHeldReport(r)).group]++;
  return c;
}

// The exact column changes a decision makes. Weight and source are never raised by an approval.
export function decisionPatch(row, decision) {
  if (decision === 'approve') {
    return isEmployeeReviewRow(row)
      ? { needs_review: false, trust_reason: EMPLOYEE_REVIEW_TRUST_REASON }
      : { needs_review: false };
  }
  if (decision === 'reject') return { needs_review: true, trust_reason: REJECTED_TRUST_REASON, outcome_weight: 0 };
  throw new Error('decision must be approve or reject');
}

// Group rows that get an identical patch so the writer issues one PATCH per patch shape.
export function planDecision(rows, decision) {
  const groups = new Map();
  for (const r of rows) {
    const patch = decisionPatch(r, decision);
    const key = JSON.stringify(patch);
    if (!groups.has(key)) groups.set(key, { patch, ids: [] });
    groups.get(key).ids.push(r.id);
  }
  return [...groups.values()];
}

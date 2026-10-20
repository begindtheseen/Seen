// One report's moderation — the rules behind the ✓ / ? / ✕ buttons on Admin → "Recent hiring reports".
//
// Why this exists (owner, 2026-10-20: "Approving these does nothing"): the old buttons wrote fields the
// grade never reads. ✓ only touches HELD rows, so on a live row it answered "ok, 0 changed"; ✕ set
// outcome_weight 0, but fusion tiers reports by platform and ignores that weight, so a "denied" report
// kept counting; ? put a row back in the queue, but held imports still count (SCORE_COUNTED_TRUST_REASONS).
// Now every decision writes what the grade and the page actually read, the same way the review queue does
// (lib/server/reportReview.js decisionPatch), and every answer says what happened:
//   approve  held → public (employee reviews → external_employee_review, never scored)
//   reject   any row → kept but hidden and never scored (needs_review true, trust_reason admin_rejected, w 0)
//   hold     live → back into the review queue (needs_review true)
//   restore  rejected → the values it had before it was rejected, read from admin_audit_log
// Tests: lib/server/reportModeration.test.mjs.

import { decisionPatch } from './reportReview.js';
import { isScorableReport, REJECTED_TRUST_REASON, DUPLICATE_TRUST_REASON, EMPLOYEE_REVIEW_TRUST_REASON } from './reportCounts.js';
import { classifyApplicantAccount } from '../reports/applicantRules.js';

export const DECISIONS = ['approve', 'reject', 'hold', 'restore'];

/** live | held | rejected | duplicate, plus whether it counts toward the company's grade right now. */
export function reportState(r) {
  const tr = String(r?.trust_reason || '');
  const state = tr === REJECTED_TRUST_REASON ? 'rejected' : tr === DUPLICATE_TRUST_REASON ? 'duplicate' : r?.needs_review === true ? 'held' : 'live';
  return { state, counted: isScorableReport(r), employeeReview: tr === EMPLOYEE_REVIEW_TRUST_REASON };
}

const IMPORTED = /^(?:external_import|auto_enrich_reddit|reddit_rule_match|web_rule_match|web_search_public_review)$/;
/**
 * Would Seen's strict first-hand rules accept this imported account today? 'passes' | 'fails' | null (not
 * an imported public account, or no text). The stored text of a post starts with its title, so it is read
 * both as a comment and as the post itself; either passing is a pass. A flag for the owner, never a decision.
 */
export function rulesCheck(r) {
  const tr = String(r?.trust_reason || '');
  const platform = String(r?.platform || '');
  if (!IMPORTED.test(tr) && !/^(?:reddit|public review)/i.test(platform)) return null;
  if (/^glassdoor$/i.test(platform)) return null; // a structured interview summary, not a quote
  const text = String(r?.report_text || '').replace(/\s*\[Source:[^\]]*\]\s*$/, '').trim();
  if (text.length < 30) return null;
  const names = [String(r?.company_name || '')];
  const title = text.split(/(?<=[.!?])\s+/)[0];
  const ok = [{}, { title, isOp: true }].some((o) => classifyApplicantAccount(text, { names, ...o }).kind === 'applicant_outcome');
  return ok ? 'passes' : 'fails';
}

/**
 * What a decision does to this row: { patch, filter, message } — patch null = nothing to change (the message
 * says why). `filter` is repeated in the PATCH so a second click or a second admin cannot re-decide it.
 * `prior` (restore only) = the values the last rejection recorded.
 */
export function moderationPlan(r, decision, prior = null) {
  if (!DECISIONS.includes(decision)) throw new Error('decision must be approve, reject, hold or restore');
  const { state } = reportState(r);
  const notRejected = `or=(trust_reason.is.null,trust_reason.not.in.(${REJECTED_TRUST_REASON},${DUPLICATE_TRUST_REASON}))`;
  if (decision === 'approve') {
    if (state === 'held') return { patch: decisionPatch(r, 'approve'), filter: `needs_review=is.true&${notRejected}`, message: 'Approved — it is public now.' };
    if (state === 'live') return { patch: null, message: 'Already live — nothing to approve.' };
    if (state === 'rejected') return { patch: null, message: 'This one is rejected — use Restore to bring it back.' };
    return { patch: null, message: 'A duplicate copy — it stays hidden (the original counts).' };
  }
  if (decision === 'reject') {
    if (state === 'rejected') return { patch: null, message: 'Already rejected.' };
    return { patch: decisionPatch(r, 'reject'), filter: notRejected, message: 'Rejected — hidden from the company page and out of its grade.' };
  }
  if (decision === 'hold') {
    if (state === 'held') return { patch: null, message: 'Already waiting in the review queue.' };
    if (state !== 'live') return { patch: null, message: state === 'rejected' ? 'Rejected rows cannot be held — use Restore first.' : 'A duplicate copy cannot be held.' };
    return { patch: { needs_review: true }, filter: `needs_review=is.false&${notRejected}`, message: 'Moved back to the review queue (Reports awaiting review).' };
  }
  // restore
  if (state !== 'rejected') return { patch: null, message: 'Only a rejected report can be restored.' };
  if (!prior || typeof prior !== 'object' || !('needs_review' in prior)) return { patch: null, message: 'No record of what it was before the rejection — restore it by hand.' };
  const back = { needs_review: prior.needs_review === true, trust_reason: prior.trust_reason ?? null, outcome_weight: Number.isFinite(Number(prior.outcome_weight)) ? Number(prior.outcome_weight) : 0.3 };
  return { patch: back, filter: `trust_reason=eq.${REJECTED_TRUST_REASON}`, message: back.needs_review ? 'Restored — back in the review queue, as it was.' : 'Restored — public again, as it was.' };
}

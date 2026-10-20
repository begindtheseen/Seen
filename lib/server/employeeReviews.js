// Employee reviews in the company grade (owner request 2026-10-20: "make sure they all have an impact
// on the math"). Tests: lib/server/employeeReviews.test.mjs.
//
// An employee review ("what it's like to work here") is NOT a hiring outcome: it says nothing about
// whether the company answered an applicant, so it never enters the response / ghost rates (counted
// as 'human' responses they claimed SpaceX and Tesla answer 98% of applicants). What it DOES carry is
// the employee's own letter grade — every imported Indeed review is stored as "<title> [B+]. …". That
// grade moves the score as a bounded workplace adjustment (api/_utils/companyScore.js
// employeeReviewAdjustment), the same shape as the résumé-tenure adjustment: a workplace signal that
// nudges the hiring grade without ever outweighing applicant evidence.
//
// Pure: no I/O. The PostgREST filter selects the same rows isEmployeeReview() accepts.

import { EMPLOYEE_REVIEW_RE, EMPLOYEE_REVIEW_TRUST_REASON } from './reportCounts.js';

// Standard 4-point scale. C (2.0) is the neutral midpoint: an average review neither helps nor hurts.
export const GRADE_POINTS = {
  'A+': 4.0, A: 4.0, 'A-': 3.7, 'B+': 3.3, B: 3.0, 'B-': 2.7, 'C+': 2.3, C: 2.0, 'C-': 1.7,
  'D+': 1.3, D: 1.0, 'D-': 0.7, F: 0,
};
const GRADE_RE = /\[([A-DF][+-]?)\]/;

/** The employee's letter grade in a review text ("Great team [A-]. …") as points, or null. */
export function employeeReviewGrade(text) {
  const m = GRADE_RE.exec(String(text || ''));
  if (!m) return null;
  const g = GRADE_POINTS[m[1]];
  return g === undefined ? null : g;
}

/** Is this report row an employee review (approved, or still held from an import)? */
export function isEmployeeReview(row) {
  if (!row) return false;
  if (row.trust_reason === EMPLOYEE_REVIEW_TRUST_REASON) return true;
  return row.needs_review === true && row.trust_reason === 'external_import' && EMPLOYEE_REVIEW_RE.test(String(row.report_text || ''));
}

/**
 * PostgREST filter (append with &) for a company's employee reviews: approved ones carry
 * trust_reason external_employee_review; ones still held from an import are external_import with
 * "employee review/discussion" in the text. Rejected rows and duplicate copies have other trust
 * reasons, so they are never selected.
 */
export const EMPLOYEE_REVIEWS_FILTER = `or=(trust_reason.eq.${EMPLOYEE_REVIEW_TRUST_REASON},`
  + 'and(needs_review.is.true,trust_reason.eq.external_import,or(report_text.ilike.*employee%20review*,report_text.ilike.*employee%20discussion*)))';

/** Rows → { count, grades } (grades = the parseable letter grades, as points). */
export function employeeReviewSignal(rows) {
  const list = (Array.isArray(rows) ? rows : []).filter(isEmployeeReview);
  const grades = [];
  for (const r of list) { const g = employeeReviewGrade(r.report_text); if (g != null) grades.push(g); }
  return { count: list.length, grades };
}

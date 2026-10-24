// Every number the public methods page (/methods) prints, read from the code that uses it, so the page
// cannot drift from the math. Where the scoring code keeps a number inline (the base formula in
// api/_utils/companyScore.js calcOverallScore, the response-verdict thresholds in
// lib/companyPageSummary.ts responseVerdict, the anti-gaming holds in api/_utils/reportWrite.js
// assessSubmitTrust) the number is written here once and lib/methodsFacts.test.mjs runs the real
// function against it: change one without the other and the suite fails.
//
// Pure; relative imports only so `node --test lib/methodsFacts.test.mjs` runs it as is.

import { SOURCE_TRUST, PRIOR_STRENGTH } from '../api/_utils/companyIntel.js';
import {
  VOLUME_BONUS_MAX, MIN_TENURE_SAMPLE, FULL_TENURE_SAMPLE, EMPLOYEE_REVIEW_POINTS_MAX, MIN_EMPLOYEE_REVIEWS,
  FULL_EMPLOYEE_REVIEWS, STALE_LISTING_POINTS, STALE_LISTING_PENALTY_MAX,
} from '../api/_utils/companyScore.js';
import { MIN_REPORTS_FOR_GRADE, MIN_REAL_REPORTS_FOR_GRADE, MENTION_WEIGHT } from './server/reportCounts.js';
import { GRADE_BANDS } from './gradeScale.js';

/** calcOverallScore: 50 + 40·response − 30·ghost − 15·min(wait/60, 1) + min(10, 5·ln(n+1)), clamped 0–100. */
export const BASE_FORMULA = {
  start: 50,
  responsePoints: 40,
  ghostPoints: 30,
  waitPoints: 15,
  waitCapDays: 60,
  volumePerLn: 5,
  volumeMax: VOLUME_BONUS_MAX,
};

/** responseVerdict: at or above `most` → "Most applicants hear back"; at or above `half` → about half. */
export const VERDICT_THRESHOLDS = { most: 0.75, half: 0.5 };

/** assessSubmitTrust: a second report on the same company within `dupDays`, or `dailyCap`+ in a day, is held. */
export const SUBMIT_HOLDS = { dupDays: 30, dailyCap: 15, heldWeight: 0.3 };

/** Tenure adjustment bounds (companyScore.js tenureAdjustment: ±8 at most). */
export const TENURE_POINTS_MAX = 8;

export const TRUST = SOURCE_TRUST;
export {
  PRIOR_STRENGTH, MIN_TENURE_SAMPLE, FULL_TENURE_SAMPLE, EMPLOYEE_REVIEW_POINTS_MAX, MIN_EMPLOYEE_REVIEWS,
  FULL_EMPLOYEE_REVIEWS, STALE_LISTING_POINTS, STALE_LISTING_PENALTY_MAX, MIN_REPORTS_FOR_GRADE,
  MIN_REAL_REPORTS_FOR_GRADE, MENTION_WEIGHT, GRADE_BANDS,
};

/** "1", "0.55", "0.3": a weight as the page prints it. */
export function weightLabel(w) {
  return String(Number(w));
}

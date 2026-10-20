// "Listing signals" — a company-level rating built ONLY from the company's own open job posts on Seen.
// Owner decision 2026-10-20: every company with listings gets one, labelled separately; the applicant
// grade (company_scores, report-backed) stays report-only and is never touched by this.
//
// Same principle as lib/server/jobScore.js (owner directive 2026-07-03): no number without a stated
// reason. The score IS the weighted sum of its factors, each computed from fields the posts carry:
//   pay      30% — share of posts that state pay (an Adzuna salary ESTIMATE is not stored as pay:
//                  lib/server/jobSources.js adzunaPay);
//   quality  30% — the posts' average transparency score (jobScore.js, 18–95) rescaled to 0–1;
//   direct   25% — share you apply to with the employer itself (its ATS board, its career site, posted
//                  on Seen by the employer) rather than through an aggregator redirect;
//   fresh    15% — share NOT still open after 30 days on Seen (a post re-seen for a month+ is a common
//                  ghost-job / evergreen sign; Seen sweeps posts that disappear, so age here means open).
// Fewer than MIN_LISTINGS posts → no rating (too little to say). Tests: lib/server/listingSignals.test.mjs.

import { SCORE_RANGE } from './jobScore.js';

export const MIN_LISTINGS = 3;
export const WEIGHTS = { pay: 0.30, quality: 0.30, direct: 0.25, fresh: 0.15 };
const DAY = 86_400_000;
const LONG_OPEN_DAYS = 30;
const DIRECT_TYPES = new Set(['EMPLOYER_DIRECT', 'ATS_DIRECT', 'EMPLOYER_SITE']);
const ATS_SOURCE = /greenhouse|lever|ashby|workday|smartrecruiters|workable|recruitee|rippling|bamboo|career site|company site/i;

export const hasPay = (r) => (Number(r?.salary_min) > 0) || /\$\s?\d|\d+\s?k\b|per hour|\/hr|an hour/i.test(String(r?.salary || ''));
export const isDirect = (r) => DIRECT_TYPES.has(String(r?.source_type || '').toUpperCase()) || !!r?.ats_provider || r?.is_employer_posted === true || ATS_SOURCE.test(String(r?.source || ''));
const pct = (x) => Math.round(x * 100);

export function listingSignals(rows, { now = Date.now() } = {}) {
  const list = (Array.isArray(rows) ? rows : []).filter(Boolean);
  const n = list.length;
  if (n < MIN_LISTINGS) return { rated: false, listings: n, reason: n ? `only ${n} open job post${n === 1 ? '' : 's'} — a rating needs ${MIN_LISTINGS}` : 'no open job posts on Seen' };
  const pay = list.filter(hasPay).length / n;
  const scores = list.map((r) => Number(r.score)).filter(Number.isFinite);
  const avgScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  const quality = avgScore == null ? null : Math.min(1, Math.max(0, (avgScore - SCORE_RANGE.min) / (SCORE_RANGE.max - SCORE_RANGE.min)));
  const direct = list.filter(isDirect).length / n;
  const dated = list.map((r) => Date.parse(r.created_at)).filter(Number.isFinite);
  const longOpen = dated.length ? dated.filter((t) => now - t > LONG_OPEN_DAYS * DAY).length / dated.length : null;
  const fresh = longOpen == null ? null : 1 - longOpen;

  // Missing parts drop out and the remaining weights are rescaled, never guessed.
  const parts = { pay, quality, direct, fresh };
  const used = Object.entries(parts).filter(([, v]) => v != null);
  const wsum = used.reduce((a, [k]) => a + WEIGHTS[k], 0);
  const score = Math.round(100 * used.reduce((a, [k, v]) => a + WEIGHTS[k] * v, 0) / wsum);
  const payCount = list.filter(hasPay).length; const directCount = list.filter(isDirect).length;
  const factors = [
    { key: 'pay', label: 'Pay shown', value: pct(pay), weight: WEIGHTS.pay, detail: `${payCount} of ${n} posts state pay` },
    quality == null ? null : { key: 'quality', label: 'Posting quality', value: pct(quality), weight: WEIGHTS.quality, detail: `average transparency score ${Math.round(avgScore)} (posts score ${SCORE_RANGE.min}–${SCORE_RANGE.max})` },
    { key: 'direct', label: 'Apply with the employer', value: pct(direct), weight: WEIGHTS.direct, detail: `${directCount} of ${n} go straight to the employer’s own board or site` },
    fresh == null ? null : { key: 'fresh', label: 'Not open for months', value: pct(fresh), weight: WEIGHTS.fresh, detail: `${Math.round(longOpen * dated.length)} of ${dated.length} have been open on Seen 30+ days` },
  ].filter(Boolean);
  const band = score >= 70 ? 'clear' : score >= 50 ? 'mixed' : 'thin';
  return {
    rated: true, listings: n, score, band,
    label: { clear: 'Clear postings', mixed: 'Mixed postings', thin: 'Thin postings' }[band],
    factors,
    basis: `From ${n.toLocaleString('en-US')} open job post${n === 1 ? '' : 's'} on Seen — the posts themselves, not applicant reports. It is not the company’s grade.`,
  };
}

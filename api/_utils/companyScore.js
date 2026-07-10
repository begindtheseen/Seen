// Company scoring engine — the single source of truth for how a company score is
// computed from fused signals, with confidence gating. See SCORING.md.
//
// Design goals:
//  - PARITY: the base formula matches the historical _calcScore/_calcWaste exactly,
//    so existing scores don't shift when no new signal is present.
//  - TENURE: average employee tenure (from résumés) folds in as a BOUNDED, GATED
//    adjustment — it only moves the score when there's a sufficient sample.
//  - CONFIDENCE: every score carries a 0–1 confidence from sample sizes + freshness,
//    so thin data is shown as a weak signal instead of a falsely precise number.
//
// Pure and side-effect free → fully unit-testable.

const clamp100 = (n) => Math.max(0, Math.min(100, Math.round(n)));

// Volume bonus cap. Sample size is a *reliability* signal, not a quality one, so it
// should give a bounded nudge — never swamp the outcome terms. Uncapped, ln(cnt+1)*5
// reached ~+40 for high-volume companies (e.g. 3000+ reports), which buried the −30
// ghost-rate penalty: Robert Half scored 98/100 despite a 42% ghost rate. Capped at
// +10, the bonus saturates around ~7 reports and ghost rate dominates the score.
export const VOLUME_BONUS_MAX = 10;

// Diminishing-returns bonus for having more reports, bounded by VOLUME_BONUS_MAX.
export function volumeBonus(cnt) {
  return Math.min(VOLUME_BONUS_MAX, Math.log((cnt || 0) + 1) * 5);
}

// Base hiring score. Same shape as the original _calcScore (response/ghost/wait terms
// unchanged) but with the report-count term capped so it can't dominate outcome quality.
// rr = response rate (0–1), gr = ghost rate (0–1), wait = avg wait days, cnt = report count.
export function calcOverallScore(rr, gr, wait, cnt) {
  return clamp100(
    50 + (rr * 40) + (gr * -30) + (Math.min(wait / 60, 1) * -15) + volumeBonus(cnt)
  );
}

// Waste / time-cost score — PARITY with the original _calcWaste.
export function calcWaste(ghostRate, avgRounds, unpaidRate) {
  return clamp100(ghostRate * 60 + unpaidRate * 25 + (avgRounds > 4 ? 15 : 0));
}

export function riskLevel(score) {
  return score >= 70 ? 'safe' : score >= 40 ? 'warn' : 'danger';
}

// ── Stale-listing penalty (owner decision 2026-07-10) ─────────────────────────
// Companies that leave dead listings up waste applicant time — the core harm this
// platform exists to expose. The signal is EARNED and anti-gameable: it counts only
// listings a user reported AND an admin confirmed dead (suppressed_listings, written
// exclusively by the admin delete flow) — never raw unreviewed reports, so brigading
// a company can't move its score. Bounded like every other adjustment (−4 per
// confirmed dead listing, capped at −20) so it signals without swamping outcomes.
export const STALE_LISTING_POINTS = 4;
export const STALE_LISTING_PENALTY_MAX = 20;
export function staleListingPenalty(confirmedStaleCount) {
  const n = Math.floor(Number(confirmedStaleCount));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return -Math.min(STALE_LISTING_PENALTY_MAX, n * STALE_LISTING_POINTS);
}

// Minimum résumé samples before tenure is allowed to move the score at all.
export const MIN_TENURE_SAMPLE = 4;
// Sample size at which the tenure signal reaches full strength.
export const FULL_TENURE_SAMPLE = 10;

// Tenure adjustment in score points. Long average tenure = people stay = healthier
// company (bonus); very short average tenure = churn red flag (penalty). Bounded to
// ±8 and scaled by how much tenure data we have, so it never dominates and never
// applies on thin data.
export function tenureAdjustment(avgTenureMonths, tenureSample) {
  if (!avgTenureMonths || !tenureSample || tenureSample < MIN_TENURE_SAMPLE) return 0;
  const years = avgTenureMonths / 12;
  let adj;
  if (years >= 4) adj = 8;
  else if (years >= 3) adj = 5;
  else if (years >= 2) adj = 2;
  else if (years >= 1.5) adj = 0;
  else if (years >= 1) adj = -4;
  else adj = -8; // < 1 year average tenure — strong churn signal
  const strength = Math.min(1, tenureSample / FULL_TENURE_SAMPLE);
  return Math.round(adj * strength);
}

// Confidence 0–1 from how much data backs the score and how fresh it is.
// Reports carry most of the weight (0.7), tenure adds up to 0.3; stale data decays.
export function scoreConfidence({ reportCount = 0, tenureSample = 0, dataAgeDays = 0 } = {}) {
  const rep = Math.min(1, reportCount / 10) * 0.7;
  const ten = Math.min(1, tenureSample / FULL_TENURE_SAMPLE) * 0.3;
  let c = rep + ten;
  if (dataAgeDays > 180) c -= Math.min(0.2, ((dataAgeDays - 180) / 360) * 0.2);
  return Math.max(0, Math.min(1, Number(c.toFixed(2))));
}

export function confidenceLabel(c) {
  return c >= 0.66 ? 'high' : c >= 0.33 ? 'medium' : 'low';
}

// Fuse all signals into a final score object. When no tenure data is present the
// result equals the base formula exactly (no regression). `sufficient` tells the UI
// whether to present a firm score or an "early signal / needs more data" treatment.
export function fuseScore(input = {}) {
  const {
    responseRate = 0, ghostRate = 0, avgWaitDays = 0, avgRounds = 0, unpaidRate = 0,
    reportCount = 0, avgTenureMonths = null, tenureSample = 0, dataAgeDays = 0,
    baseScore = null, // optional: use a precomputed (e.g. web-research) base instead of the formula
  } = input;

  const base = baseScore != null ? clamp100(baseScore) : calcOverallScore(responseRate, ghostRate, avgWaitDays, reportCount);
  const tAdj = tenureAdjustment(avgTenureMonths, tenureSample);
  const overall = clamp100(base + tAdj);
  const waste = calcWaste(ghostRate, avgRounds, unpaidRate);
  const confidence = scoreConfidence({ reportCount, tenureSample, dataAgeDays });

  return {
    overall_score: overall,
    base_score: base,
    tenure_adjustment: tAdj,
    waste_score: waste,
    risk_level: riskLevel(overall),
    confidence,
    confidence_label: confidenceLabel(confidence),
    sufficient: confidence >= 0.33,
    signals: {
      report_count: reportCount,
      tenure_sample: tenureSample,
      avg_tenure_months: avgTenureMonths || null,
      tenure_applied: tAdj !== 0,
    },
  };
}

// Best-effort parse of a free-form résumé date ("2020", "Jan 2020", "03/2019",
// "2021-06") to a month index (year*12 + month). Returns null if unparseable or
// if it denotes the present.
const _MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
export function parseMonthIndex(s) {
  if (!s) return null;
  const str = String(s).toLowerCase().trim();
  if (/present|current|now|ongoing/.test(str)) return null;
  const y = str.match(/(19|20)\d{2}/);
  if (!y) return null;
  const year = parseInt(y[0], 10);
  let mo = 0;
  const mName = Object.keys(_MONTHS).find((m) => str.includes(m));
  if (mName) mo = _MONTHS[mName];
  else {
    const mNum = str.match(/\b(\d{1,2})[/\-.]/); // "03/2019", "6-2021"
    if (mNum) mo = Math.max(0, Math.min(11, parseInt(mNum[1], 10) - 1));
  }
  return year * 12 + mo;
}

// Aggregate average tenure (months) per company from employment rows
// [{ company, start_date, end_date }]. `normalize` maps a raw company name to its
// canonical key. Rows with an open ("Present") end use `now`. Returns
// { [canonical]: { avg_tenure_months, sample } }.
export function aggregateTenure(rows, normalize, { now = Date.now() } = {}) {
  const nd = new Date(now);
  const nowIdx = nd.getFullYear() * 12 + nd.getMonth();
  const acc = {};
  for (const r of rows || []) {
    const co = normalize ? normalize(r.company) : r.company;
    if (!co) continue;
    const startIdx = parseMonthIndex(r.start_date);
    if (startIdx == null) continue;
    const present = !r.end_date || /present|current|now|ongoing/i.test(String(r.end_date));
    let endIdx = parseMonthIndex(r.end_date);
    if (endIdx == null) endIdx = present ? nowIdx : null;
    if (endIdx == null) continue;
    const months = endIdx - startIdx;
    if (months < 0 || months > 600) continue; // sanity: 0–50 years
    (acc[co] ||= { sum: 0, n: 0 });
    acc[co].sum += months;
    acc[co].n += 1;
  }
  const out = {};
  for (const [co, v] of Object.entries(acc)) {
    out[co] = { avg_tenure_months: Math.round(v.sum / v.n), sample: v.n };
  }
  return out;
}

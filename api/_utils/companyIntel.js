import { gradeRisk } from '../../lib/gradeScale.js';
// Company intel fusion — turns ALL the signals we collect about a company into one
// confidence-gated score, instead of trusting a single web-research estimate. See
// SCORING.md (§2 sources) and OPPORTUNITY_ENGINE.md (data acquisition).
//
// The problem this solves: handleCompanyScore/populate computed the score purely from
// Claude's web-research guess and ignored the real outcome data we already have
// (direct user reports, Reddit imports, survey answers). This engine fuses them:
//
//   - The web-research estimate is a PRIOR (a reasonable starting guess).
//   - Real reported outcomes are EVIDENCE, weighted by source trust (SCORING.md §2).
//   - We shrink the prior toward the evidence as the (trust-weighted) sample grows
//     — so 2 reports barely move a well-researched prior, but 200 real reports
//     dominate it. This is standard Bayesian shrinkage toward a prior.
//
// Pure and side-effect free → fully unit-testable. Delegates the final formula to
// companyScore.js so there is still one source of truth for the math.

import {
  calcOverallScore, calcWaste, tenureAdjustment, scoreConfidence, confidenceLabel,
  staleListingPenalty, employeeReviewAdjustment,
} from './companyScore.js';
import { wilsonInterval } from '../../lib/server/wilson.js';

const clamp01 = (n) => (n == null ? null : Math.max(0, Math.min(1, n)));
const clamp100 = (n) => Math.max(0, Math.min(100, Math.round(n)));
const round1 = (n) => (n == null ? null : Math.round(n * 10) / 10);
const num = (n) => (n == null || n === '' || Number.isNaN(Number(n)) ? null : Number(n));

// Trust weight per source — mirrors SCORING.md §2 (outcome_weight). Higher = more
// influence on the fused rates per resolved report.
export const SOURCE_TRUST = {
  direct: 1.0,      // /api/reports submit / quick_submit
  seen_intel: 1.0,  // survey / Opportunity-Engine answers
  ingest: 0.55,     // Glassdoor / Blind / Indeed / LinkedIn (n8n)
  reddit: 0.3,      // Reddit pipeline
  public_web: 0.3,  // first-hand accounts found on public review sites / forums via web search
                    // (platform "Public review · <host>") — third-party, attributed, same tier as reddit
  web: 0.5,         // generic web research (used as the prior, not pooled here)
  mentions: 0.5,    // "what people are saying": quoted online accounts (company_scores.web_reviews) that
                    // state an outcome. Owner decision 2026-10-18: a mention counts EXACTLY HALF of a
                    // report (direct 1.0). NOT report rows — counted separately as mention_count.
};

// ── "What people are saying" → outcomes (owner request 2026-10-18) ─────────────────────────────
// Deterministic (no LLM). A snippet counts only when it states a hiring outcome; ghosting is checked
// FIRST because one account often says both ("no response after my interview" is a ghost).
// Everything else — process descriptions with no outcome, workplace chatter — is ignored.
const MENTION_GHOST_RE = /\bghost|never (?:heard|got) back|no (?:response|reply|word|callback|follow.?up)|did(?:n'?t| not) (?:even )?(?:respond|reply|hear|get back)|radio silen|heard nothing|nothing back|never (?:responded|contacted|called)|left (?:me |us |candidates )?hanging/i;
const MENTION_RESPONSE_RE = /\boffer|\bhired\b|got the job|accepted|interview|recruiter (?:called|reached|contacted|emailed)|phone screen|reject|turned (?:me )?down|\bdeclined\b|heard back|called (?:me|back)|got back to|responded|quick (?:response|reply)/i;
// An automated "thank you for your interest" rejection is an outcome, but neither a ghost nor a
// human response — scored like a report's 'autoreject'.
const MENTION_AUTOREJECT_RE = /thank(?:s| you) for (?:your )?interest|automated (?:rejection|email|reply)|form (?:email|letter)|auto.?reject/i;
/** 'ghosted' | 'responded' | 'autoreject' | null for one quoted online account. */
export function classifyMention(text) {
  const t = String(text || '');
  if (!t.trim()) return null;
  if (MENTION_GHOST_RE.test(t)) return 'ghosted';
  if (MENTION_AUTOREJECT_RE.test(t)) return 'autoreject';
  if (MENTION_RESPONSE_RE.test(t)) return 'responded';
  return null;
}
/**
 * How many "what people are saying" accounts a company has — EVERY quoted account counts toward the
 * grade bar at half a report (owner rule 2026-10-18: "2 reports + 6 what people are saying meets the
 * 5 threshold"). Only the ones that state an outcome (mentionOutcomes) move the rates.
 */
export function mentionTotal(webReviews) {
  let list = webReviews;
  if (typeof list === 'string') { try { list = JSON.parse(list); } catch { list = []; } }
  if (!Array.isArray(list)) return 0;
  return list.filter((r) => r && r.kind !== 'employee_review' && String(r.text || r.quote || r.summary || '').trim()).length;
}
/** company_scores.web_reviews (array or JSON string) → fusion outcomes for the 'mentions' source. */
export function mentionOutcomes(webReviews) {
  let list = webReviews;
  if (typeof list === 'string') { try { list = JSON.parse(list); } catch { list = []; } }
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const r of list) {
    if (r?.kind === 'employee_review') continue;
    const c = classifyMention(r && (r.text || r.quote || r.summary));
    if (c) out.push({ outcome: c });
  }
  return out;
}

// Outcome taxonomy. A "ghost" = no human ever responded; a "response" = the company
// engaged in any way (including a rejection — that's still a response). Non-terminal
// outcomes don't count toward the rate denominators.
export const GHOST_OUTCOMES = new Set(['ghosted', 'ghost', 'no_response', 'no response']);
export const RESPONSE_OUTCOMES = new Set([
  'hired', 'offer', 'offer_received', 'interview', 'interview_received', 'interview_completed',
  'human', 'rejected', 'rejection', 'assessment', 'assessment_received', 'screening',
  'response_received', 'responded',
]);
// Non-terminal: the application is still open, so it tells us nothing about ghosting yet.
// (Note: `autoreject` is intentionally NOT here and NOT a response — an automated rejection
// is a resolved outcome that is neither a ghost nor a *human* response, so it counts toward
// the denominator but neither rate bucket.)
export const NONTERMINAL_OUTCOMES = new Set(['unknown', 'pending', 'active', 'applied', 'withdrawn', 'submitted', 'waiting', '']);

// Platform marker for first-hand accounts collected from public review sites / forums by web
// search (scripts/credit/web-reports.mjs). THE contract for those rows:
//   platform 'Public review · <hostname>', source 'web_public', outcome_weight 0.3,
//   trust_reason 'web_search_public_review'.
// Checked BEFORE the ingest/reddit tests: "Public review · glassdoor.com" must never be scored as
// ingest (0.55) and an unknown forum host must never fall through to 'direct' (1.0, first-party).
// Mirrored by lib/reportSource.ts (display label) and lib/server/reportCounts.js (count path).
export const PUBLIC_REVIEW_PLATFORM_PREFIX = 'Public review · ';
export const PUBLIC_REVIEW_PLATFORM_RE = /^public review ·/i;
export const publicReviewPlatform = (host) => `${PUBLIC_REVIEW_PLATFORM_PREFIX}${String(host || '').trim().toLowerCase()}`;

// How a report a PERSON submitted to Seen is marked (report form, tracker, apply flow, anonymous form).
// On those rows `platform` is where the person APPLIED ("LinkedIn", "Indeed"), not where the account
// came from. Mirrored by lib/reportSource.ts FIRST_PARTY_TRUST_REASONS (display).
export const FIRST_PARTY_TRUST_REASONS = new Set(['direct_submission', 'anonymous_unverified', 'duplicate_user_company']);

// Map a report to a fusion source type / trust tier, from its free-form `platform` and — so a Seen
// user's report that names the job board they applied on is not weighed like an imported review —
// its `trust_reason`. Callers that score rows must select trust_reason and pass it.
export function classifyPlatform(platform, trustReason = null) {
  const raw = String(platform || '');
  if (PUBLIC_REVIEW_PLATFORM_RE.test(raw)) return 'public_web';
  const p = raw.toLowerCase();
  if (/reddit/.test(p)) return 'reddit';
  if (/glassdoor|blind|indeed|linkedin/.test(p)) return FIRST_PARTY_TRUST_REASONS.has(String(trustReason || '')) ? 'direct' : 'ingest';
  if (/seen[_ -]?intel|survey/.test(p)) return 'seen_intel';
  return 'direct';
}

// Reduce a list of { outcome } rows into resolved ghost/response counts.
export function aggregateOutcomes(rows) {
  let ghost = 0, response = 0, resolved = 0, total = 0;
  for (const r of rows || []) {
    total += 1;
    const oc = String(r.outcome || '').toLowerCase().trim();
    if (NONTERMINAL_OUTCOMES.has(oc)) continue;
    resolved += 1;
    if (GHOST_OUTCOMES.has(oc)) ghost += 1;
    else if (RESPONSE_OUTCOMES.has(oc)) response += 1;
    // unrecognized terminal outcomes count toward `resolved` but neither bucket.
  }
  return { ghost, response, resolved, total };
}

// Shrinkage constant: empirical rates reach a 50/50 blend with the prior at this many
// (trust-weighted) resolved reports, and dominate beyond it.
export const PRIOR_STRENGTH = 8;

// OWNER DECISION 2026-10-25: a company with little evidence leans toward a TYPICAL company until its
// own reports add up (2 glowing Reddit posts used to make a 100; 1 bad one an F). When there is no
// web-research prior, rates blend with these population rates at PRIOR_STRENGTH effective reports.
// Pooled from production on 2026-10-25: 4,467 scorable reports over 1,133 graded companies
// (response 0.700, ghost 0.297; the 64 companies with 10+ reports pool to 0.722 / 0.267).
export const POPULATION_PRIOR = { response_rate: 0.7, ghost_rate: 0.3 };
// How many effective reports the typical-company anchor is worth. At 8 (the web-prior strength)
// almost every company read as a C — most evidence is public posts at 0.3 trust — so the anchor is
// lighter: 2 public posts (0.6 effective) still sit near typical, 2 Seen reports move half-way, and
// 30 Seen reports are ~94% the company's own data. Measured on production 2026-10-25: A 5, B 146,
// C 621, D 336, F 25 of 1,133 graded companies (was A 617 / F 120 on the old bands, no anchor).
export const POPULATION_PRIOR_STRENGTH = 2;

// Blend a prior with empirical evidence via sample-weighted shrinkage.
//   weightEmpirical = effN / (effN + PRIOR_STRENGTH)
// No evidence → prior; no prior → evidence.
export function blendRate(prior, empiricalRate, effN, strength = PRIOR_STRENGTH) {
  if (empiricalRate == null || !effN) return prior ?? null;
  if (prior == null) return empiricalRate;
  const w = effN / (effN + strength);
  return w * empiricalRate + (1 - w) * prior;
}

// Fuse a web-research prior with trust-weighted empirical sources + tenure into a
// single confidence-gated score object.
//
// input = {
//   web:    { ghost_rate, response_rate, avg_wait_days, avg_rounds, unpaid_rate, report_count },
//   sources:[ { type:'direct'|'reddit'|'public_web'|'ingest'|'seen_intel', outcomes:[{outcome}], avgWaitDays?, avgRounds? } ],
//   avgTenureMonths, tenureSample, dataAgeDays,
//   confirmedStaleListings, // admin-confirmed dead listings (suppressed_listings) — bounded penalty
// }
// Upper bound on the LLM web-research *claimed* mention count. The model returns an unbounded
// self-reported number (observed: 12,775 for one company vs 147 rows in our entire reports
// table) — the cap keeps a claim from dominating volume-driven score math. Display surfaces
// must label it as a web-research estimate, never as "reports".
export const WEB_CLAIM_CAP = 500;

export function fuseCompanyIntel(input = {}) {
  const { web = {}, sources = [], avgTenureMonths = null, tenureSample = 0, dataAgeDays = 0, confirmedStaleListings = 0, employeeReviews = null } = input;

  // Pool empirical evidence across sources, each weighted by its trust.
  let wGhost = 0, wResp = 0, wResolved = 0, effN = 0, rawResolved = 0, rawGhost = 0, mentionResolved = 0;
  let waitNum = 0, waitDen = 0, roundsNum = 0, roundsDen = 0;
  const usedTypes = [];
  for (const s of sources || []) {
    const trust = SOURCE_TRUST[s.type] ?? 0.5;
    const agg = aggregateOutcomes(s.outcomes);
    if (agg.resolved <= 0) continue;
    usedTypes.push(s.type);
    wGhost += trust * agg.ghost;
    wResp += trust * agg.response;
    wResolved += trust * agg.resolved;
    effN += trust * agg.resolved;
    // Mentions shape the rates (at their low trust) but are not report rows.
    if (s.type === 'mentions') { mentionResolved += agg.resolved; continue; }
    rawResolved += agg.resolved;
    rawGhost += agg.ghost;
    if (num(s.avgWaitDays) != null) { waitNum += trust * num(s.avgWaitDays) * agg.resolved; waitDen += trust * agg.resolved; }
    if (num(s.avgRounds) != null) { roundsNum += trust * num(s.avgRounds) * agg.resolved; roundsDen += trust * agg.resolved; }
  }

  const empGhost = wResolved > 0 ? wGhost / wResolved : null;
  const empResp = wResolved > 0 ? wResp / wResolved : null;
  const empWait = waitDen > 0 ? waitNum / waitDen : null;
  const empRounds = roundsDen > 0 ? roundsNum / roundsDen : null;

  // (No evidence at all keeps the old contract: no prior → the neutral 50 baseline, never graded.)
  const popPrior = effN > 0 ? POPULATION_PRIOR : {};
  const webGhost = num(web.ghost_rate);
  const webResp = num(web.response_rate);
  const ghost_rate = clamp01(webGhost != null ? blendRate(webGhost, empGhost, effN) : blendRate(popPrior.ghost_rate ?? null, empGhost, effN, POPULATION_PRIOR_STRENGTH));
  const response_rate = clamp01(webResp != null ? blendRate(webResp, empResp, effN) : blendRate(popPrior.response_rate ?? null, empResp, effN, POPULATION_PRIOR_STRENGTH));
  const avg_wait_days = round1(blendRate(num(web.avg_wait_days), empWait, effN));
  const avg_rounds = round1(blendRate(num(web.avg_rounds), empRounds, effN));
  const unpaid_rate = clamp01(num(web.unpaid_rate) ?? 0) ?? 0;

  // Split the sample honestly: first-party = resolved report rows we actually hold;
  // web = the LLM research's *claimed* mention count — clamped (it arrives unbounded, e.g.
  // "12,775") and NEVER counted as first-party. The fused report_count remains their sum for
  // scoring math/back-compat, but confidence can no longer be minted from the claim alone.
  const first_party_report_count = Math.max(0, Math.round(rawResolved || 0));
  const web_report_count = Math.max(0, Math.min(WEB_CLAIM_CAP, Math.round(num(web.report_count) || 0)));
  const report_count = first_party_report_count + web_report_count;
  const mention_count = Math.max(0, Math.round(mentionResolved || 0));

  // Volume bonus and confidence come from the trust-WEIGHTED sample (effN), not the raw row count:
  // 8 Reddit/review-site rows at 0.3 are 2.4 reports' worth of evidence, not a "moderate confidence" 8.
  const effCount = Math.round(effN);
  const base = calcOverallScore(response_rate ?? 0, ghost_rate ?? 0, avg_wait_days ?? 0, effCount);
  const tAdj = tenureAdjustment(avgTenureMonths, tenureSample);
  const stalePen = staleListingPenalty(confirmedStaleListings);
  // Employee reviews: their letter grades (never their 'human' outcome label) — bounded workplace
  // adjustment. employeeReviews = { count, grades } from lib/server/employeeReviews.js.
  const empGrades = Array.isArray(employeeReviews?.grades) ? employeeReviews.grades : [];
  const empAdj = employeeReviewAdjustment(empGrades);
  const overall_score = clamp100(base + tAdj + stalePen + empAdj);
  const waste_score = calcWaste(ghost_rate ?? 0, avg_rounds ?? 0, unpaid_rate);
  const confidence = scoreConfidence({
    reportCount: effCount, tenureSample, dataAgeDays,
    webClaimedCount: web_report_count,
  });

  return {
    overall_score,
    base_score: base,
    tenure_adjustment: tAdj,
    stale_listing_penalty: stalePen,
    employee_review_adjustment: empAdj,
    employee_review_count: Math.max(0, Math.floor(Number(employeeReviews?.count)) || 0),
    employee_review_avg_grade: empGrades.length ? round1(empGrades.reduce((a, b) => a + b, 0) / empGrades.length) : null,
    confirmed_stale_listings: Math.max(0, Math.floor(Number(confirmedStaleListings)) || 0),
    ghost_rate,
    response_rate,
    avg_wait_days,
    avg_rounds,
    unpaid_rate,
    waste_score,
    report_count,
    first_party_report_count,
    web_report_count,
    mention_count,
    confidence,
    confidence_label: confidenceLabel(confidence),
    sufficient: confidence >= 0.33,
    risk_level: gradeRisk(overall_score) || 'danger',
    empirical: {
      resolved: rawResolved,
      eff_n: round1(effN),
      ghost_rate: empGhost == null ? null : round1(empGhost),
      response_rate: empResp == null ? null : round1(empResp),
    },
    // Grounded, sample-size-aware bound on the FIRST-PARTY ghost rate (Wilson 95% interval over RAW
    // counts, never the blended rate). The lower bound is a confidence-discounted rate — gaming-
    // resistant on small n (2/2 ghosts can't manufacture a confident 100%) — and the width is an
    // honest "how sure are we" signal. Additive: scores, rates, and `confidence` are unchanged.
    // Null when we hold no first-party resolved reports (nothing real to bound).
    ghost_rate_ci: rawResolved > 0
      ? (() => { const iv = wilsonInterval(rawGhost, rawResolved); return { lower: round1(iv.lower), upper: round1(iv.upper), n: iv.n }; })()
      : null,
    sources_used: usedTypes,
  };
}

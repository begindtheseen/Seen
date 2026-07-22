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
  staleListingPenalty,
} from './companyScore.js';

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
  web: 0.5,         // generic web research (used as the prior, not pooled here)
};

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

// Map a free-form `reports.platform` string to a fusion source type / trust tier.
export function classifyPlatform(platform) {
  const p = String(platform || '').toLowerCase();
  if (/reddit/.test(p)) return 'reddit';
  if (/glassdoor|blind|indeed|linkedin/.test(p)) return 'ingest';
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

// Blend a prior with empirical evidence via sample-weighted shrinkage.
//   weightEmpirical = effN / (effN + PRIOR_STRENGTH)
// No evidence → prior; no prior → evidence.
export function blendRate(prior, empiricalRate, effN) {
  if (empiricalRate == null || !effN) return prior ?? null;
  if (prior == null) return empiricalRate;
  const w = effN / (effN + PRIOR_STRENGTH);
  return w * empiricalRate + (1 - w) * prior;
}

// Fuse a web-research prior with trust-weighted empirical sources + tenure into a
// single confidence-gated score object.
//
// input = {
//   web:    { ghost_rate, response_rate, avg_wait_days, avg_rounds, unpaid_rate, report_count },
//   sources:[ { type:'direct'|'reddit'|'ingest'|'seen_intel', outcomes:[{outcome}], avgWaitDays?, avgRounds? } ],
//   avgTenureMonths, tenureSample, dataAgeDays,
//   confirmedStaleListings, // admin-confirmed dead listings (suppressed_listings) — bounded penalty
// }
// Upper bound on the LLM web-research *claimed* mention count. The model returns an unbounded
// self-reported number (observed: 12,775 for one company vs 147 rows in our entire reports
// table) — the cap keeps a claim from dominating volume-driven score math. Display surfaces
// must label it as a web-research estimate, never as "reports".
export const WEB_CLAIM_CAP = 500;

export function fuseCompanyIntel(input = {}) {
  const { web = {}, sources = [], avgTenureMonths = null, tenureSample = 0, dataAgeDays = 0, confirmedStaleListings = 0 } = input;

  // Pool empirical evidence across sources, each weighted by its trust.
  let wGhost = 0, wResp = 0, wResolved = 0, effN = 0, rawResolved = 0;
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
    rawResolved += agg.resolved;
    if (num(s.avgWaitDays) != null) { waitNum += trust * num(s.avgWaitDays) * agg.resolved; waitDen += trust * agg.resolved; }
    if (num(s.avgRounds) != null) { roundsNum += trust * num(s.avgRounds) * agg.resolved; roundsDen += trust * agg.resolved; }
  }

  const empGhost = wResolved > 0 ? wGhost / wResolved : null;
  const empResp = wResolved > 0 ? wResp / wResolved : null;
  const empWait = waitDen > 0 ? waitNum / waitDen : null;
  const empRounds = roundsDen > 0 ? roundsNum / roundsDen : null;

  const ghost_rate = clamp01(blendRate(num(web.ghost_rate), empGhost, effN));
  const response_rate = clamp01(blendRate(num(web.response_rate), empResp, effN));
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

  const base = calcOverallScore(response_rate ?? 0, ghost_rate ?? 0, avg_wait_days ?? 0, report_count);
  const tAdj = tenureAdjustment(avgTenureMonths, tenureSample);
  const stalePen = staleListingPenalty(confirmedStaleListings);
  const overall_score = clamp100(base + tAdj + stalePen);
  const waste_score = calcWaste(ghost_rate ?? 0, avg_rounds ?? 0, unpaid_rate);
  const confidence = scoreConfidence({
    reportCount: first_party_report_count, tenureSample, dataAgeDays,
    webClaimedCount: web_report_count,
  });

  return {
    overall_score,
    base_score: base,
    tenure_adjustment: tAdj,
    stale_listing_penalty: stalePen,
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
    confidence,
    confidence_label: confidenceLabel(confidence),
    sufficient: confidence >= 0.33,
    risk_level: overall_score >= 70 ? 'safe' : overall_score >= 40 ? 'warn' : 'danger',
    empirical: {
      resolved: rawResolved,
      eff_n: round1(effN),
      ghost_rate: empGhost == null ? null : round1(empGhost),
      response_rate: empResp == null ? null : round1(empResp),
    },
    sources_used: usedTypes,
  };
}

// The context a fit score uses besides the résumé and the posting — computed ONE way, on the
// server, for every path that prints a fit score: the free check (api/optimizer.js), the paid
// Optimize and the Studio tailor (api/resume.js).
//
// Tasha saw 46 on the Fit tab, 45 in the paid package and 43 in the Studio for one résumé and one
// posting (2026-10-25): the free check alone read the company's process grade (10% of the score)
// and took "remote" from whatever the client sent; the others scored neither. Now:
//   • companyProcessScore / Confidence — the graded company's process score (null below the
//     grade bar, so the factor is not scored at all — lib/optimizer/explainScore scoredFactors);
//   • remoteOk — the POSTING says remote (the client's own guess is not used);
//   • location fields — not used: no path knows where the person wants to work, so the location
//     factor is "not measured" everywhere rather than measured on one screen.
import { scoreConfidence } from '../../api/_utils/companyScore.js';
import { firstPartyReportCount, webClaimCount, isGradeable } from './reportCounts.js';
import { mentionSel } from './scoreColumns.js';

const cache = new Map(); // company (lower) → { ts, score, confidence }

/** The graded company's process score, or { score: null, confidence: null }. */
export async function companyProcessFor(company, { fetchImpl = globalThis.fetch } = {}) {
  const name = String(company || '').trim();
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!name || !SUPABASE_URL || !SERVICE_KEY || typeof fetchImpl !== 'function') return { score: null, confidence: null };
  const key = name.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < 5 * 60_000) return { score: hit.score, confidence: hit.confidence };
  let out = { score: null, confidence: null };
  try {
    const r = await fetchImpl(`${SUPABASE_URL}/rest/v1/company_scores?company_name=ilike.${encodeURIComponent(name)}&select=overall_score,report_count,first_party_report_count${await mentionSel()},web_report_count,data_source&order=report_count.desc&limit=1`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });
    if (r && r.ok) {
      const rows = await r.json();
      const row = Array.isArray(rows) ? rows[0] : null;
      if (row) {
        const score = row.overall_score == null || !isGradeable(row) ? null : Number(row.overall_score);
        const confidence = scoreConfidence({ reportCount: firstPartyReportCount(row), webClaimedCount: webClaimCount(row) });
        out = { score, confidence: score == null ? null : confidence };
      }
    }
  } catch { /* unknown → not scored */ }
  cache.set(key, { ts: Date.now(), ...out });
  return out;
}

/** Does the posting say the job is remote? */
export function postingSaysRemote(jobDescription) {
  return /\bremote\b/i.test(String(jobDescription || ''));
}

/** The runOptimizer input fields every scoring path shares. */
export async function fitContext({ company, jobDescription } = {}, opts = {}) {
  const proc = await companyProcessFor(company, opts);
  return {
    companyProcessScore: proc.score,
    companyProcessConfidence: proc.confidence,
    remoteOk: postingSaysRemote(jobDescription),
    jobLocation: null,
    desiredLocation: null,
  };
}

/** Test hook. */
export function _resetFitContextCache() { cache.clear(); }

// SeenFit Engine — shared types.
//
// The SeenFit Engine is a DETERMINISTIC résumé/application optimizer. It uses NO
// external AI APIs (no Anthropic/OpenAI/Gemini/HuggingFace). Everything is computed
// from skill taxonomies, deterministic text extraction, reusable templates, and the
// data already in Supabase (company_scores, job corpus). See lib/optimizer/*.ts.
//
// engineVersion is stamped on every optimizer_runs row so the scoring can improve
// over time without breaking the interpretation of historical runs.
export const ENGINE_VERSION = 'seenfit-2.3.0'; // 2026-11-10 package R: boilerplate never a requirement, field aliases + title proof, line proof, state licence gates, requirement kind, one years figure // 2.2.1: 2026-11-10: a posting term's identity is its own words ("chf", not "term:CHF"); outputs cached since 2026-11-09 printed the key and are never served // 2.2.0 2026-11-08: requirements in the posting's own words (postingTerms.js) — a posting outside the vocabulary is read, not refused // 2.1.1 2026-11-03: requirement rows print words not stems (round 3/4) — older cached Optimize packages are never served // 2.1: relevant-only years, degree/licence synonyms, résumé-cased message
/**
 * What an engine key looks like ("term:…", "terms:3", "constraint:years:5", "seniority:mid", "anyof:…").
 * No output a person can see may contain one (lib/optimizer/noEngineKeysOnScreen.test.mjs); a stored output
 * that does (built 2026-11-09, before the fix) is rebuilt on read, never served (api/interview-prep.js).
 */
export const ENGINE_KEY_RE = /\bterm:|\bterms:\d|\bconstraint:|\bseniority:|\banyof:/i;
/** Does any string anywhere in this value look like an engine key? */
export function hasEngineKey(value) {
    if (value == null) return false;
    if (typeof value === 'string') return ENGINE_KEY_RE.test(value);
    if (Array.isArray(value)) return value.some(hasEngineKey);
    if (typeof value === 'object') return Object.values(value).some(hasEngineKey);
    return false;
}
// Weights for the SeenFit Score. MUST sum to 1.0. See spec.
export const SEENFIT_WEIGHTS = {
    required_match: 0.30,
    preferred_match: 0.15,
    evidence_strength: 0.15,
    seniority_alignment: 0.10,
    company_process_score: 0.10,
    ats_coverage: 0.10,
    location_pay_alignment: 0.05,
    risk_penalty: 0.05,
};

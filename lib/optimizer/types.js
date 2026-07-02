// SeenFit Engine — shared types.
//
// The SeenFit Engine is a DETERMINISTIC résumé/application optimizer. It uses NO
// external AI APIs (no Anthropic/OpenAI/Gemini/HuggingFace). Everything is computed
// from skill taxonomies, deterministic text extraction, reusable templates, and the
// data already in Supabase (company_scores, job corpus). See lib/optimizer/*.ts.
//
// engineVersion is stamped on every optimizer_runs row so the scoring can improve
// over time without breaking the interpretation of historical runs.
export const ENGINE_VERSION = 'seenfit-1.0.0';
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

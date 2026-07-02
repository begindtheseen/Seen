// HumanProof — shared types.
//
// HumanProof is a DETERMINISTIC, KEYLESS humanizer that runs AFTER the SeenFit
// optimizer. It removes generic AI-style résumé writing and replaces it with truthful,
// specific, human work context drawn ONLY from facts the user already has (résumé
// facts, job facts, SeenFit optimizer output, SeenJobs company/outcome data).
//
// It uses NO external AI APIs (no Anthropic / OpenAI / Gemini / Hugging Face / any
// hosted model). Everything is computed from local dictionaries (phraseRisk),
// deterministic scoring rules, and templates over real facts. A unit test asserts this
// (static host scan + runtime fetch trap), mirroring the SeenFit engine test.
//
// FRAMING: HumanProof never claims to bypass, beat, trick, or evade AI detectors, ATS,
// or employers. It only removes generic AI-style writing and adds truthful, specific,
// human work context that is easy to defend in an interview.
//
// engineVersion is stamped on every humanizer_runs row so scoring can improve over time
// without breaking the interpretation of historical runs.
export const HUMANPROOF_ENGINE_VERSION = 'humanproof_v1';
// Weights for the HumanProof Score. MUST sum to 1.0. See spec.
export const HUMANPROOF_WEIGHTS = {
    specificity: 0.20,
    natural_rhythm: 0.15,
    evidence_grounding: 0.15,
    buzzword_control: 0.15,
    voice_consistency: 0.10,
    interview_defensibility: 0.10,
    role_believability: 0.10,
    formatting_naturalness: 0.05,
};

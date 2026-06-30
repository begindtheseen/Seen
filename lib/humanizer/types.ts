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

// Reuse the SeenFit fact types directly — HumanProof consumes optimizer output and the
// same résumé/job fact shapes. We import the types so the two engines stay aligned.
import type { ResumeFact, JobFact, OptimizerOutput } from '../optimizer/types.ts';
export type { ResumeFact, JobFact, OptimizerOutput };

export type AiSlopRisk = 'low' | 'medium' | 'high';

export type FlagSeverity = 'low' | 'medium' | 'high';

// Categories of generic / AI-style writing we detect. These map to phrase_risk_rules
// categories and to the detector modules.
export type FlagType =
  | 'ai_slop'          // generic AI-style filler phrasing
  | 'buzzword'         // corporate buzzword with no work context
  | 'repetition'       // repeated bullet rhythm / sentence opener
  | 'vague_claim'      // a claim with no concrete work context
  | 'unsupported_metric'   // a number not grounded in résumé facts
  | 'unsupported_tool'     // a named tool not present in résumé facts
  | 'unsupported_seniority'// seniority language above what the résumé supports
  | 'overpolished'     // summary language that reads machine-generated
  | 'interview_risk';  // a claim that would be hard to defend in an interview

// A single detected issue in the original text.
export interface HumanProofFlag {
  flagType: FlagType;
  severity: FlagSeverity;
  originalPhrase: string;     // the exact surface span that triggered the flag
  explanation: string;        // plain-English why this reads as generic / risky
  suggestedFix: string | null;// a plain replacement hint, when we have one
}

// A rewritten bullet that is fully grounded in the user's real facts. `safe` bullets
// never contain invented numbers/tools/claims — those go to `confirmBeforeUsing`.
export interface SafeBullet {
  text: string;
  evidenceUsed: string[]; // résumé/job evidence spans this bullet draws from
  replaced: string | null;// the original generic bullet this came from, if any
}

// A suggestion the user MUST confirm before using — typically a number or tool that
// would strengthen the bullet but isn't verified in the source. NEVER shown as fact.
export interface ConfirmBeforeUsing {
  text: string;
  reason: string;     // why this needs confirmation (e.g. "add the real number")
  placeholder: string;// the token the user must replace, e.g. "[X]"
}

// A warning that a claim, as written, may be hard to defend in an interview.
export interface InterviewRiskWarning {
  phrase: string;
  warning: string;
}

// A human-readable record of one change the humanizer made.
export interface ChangeMade {
  from: string;
  to: string;
  reason: string;
}

// Self-explaining score contribution — mirrors SeenFit's ScoreContribution shape.
export interface HumanProofContribution {
  factor: string;
  weight: number; // 0–1 share of the HumanProof Score
  raw: number;    // the 0–1 sub-score
  points: number; // weight * raw * 100 contribution to the final score
  reason: string; // plain-English explanation
}

// The full HumanProof output object persisted on humanizer_runs.output and returned to
// the UI.
export interface HumanProofOutput {
  engine_version: string;
  humanproof_score: number;     // 0–100
  ai_slop_risk: AiSlopRisk;
  before_score: number;         // 0–100 — original text's humanproof score
  after_score: number;          // 0–100 — humanized text's humanproof score
  flags: HumanProofFlag[];
  humanized_text: string;
  safe_bullets: SafeBullet[];
  confirm_before_using: ConfirmBeforeUsing[];
  interview_risk_warnings: InterviewRiskWarning[];
  changes_made: ChangeMade[];
  explanation: {
    summary: string;
    contributions: HumanProofContribution[];
    notes: string[];
  };
}

// Inputs the humanizer needs to run. `optimizerOutput` is the SeenFit result (when the
// user just optimized); we reuse its matched requirements + facts as supported context.
export interface HumanProofInput {
  // The text to humanize: a résumé section, a set of bullets, or an application message.
  text: string;
  // Treat the text as résumé bullets ('resume') or an application message ('message').
  mode?: 'resume' | 'message';
  // Optional role family hint; if absent we infer it from facts/text.
  roleFamily?: RoleFamily | null;
  jobTitle?: string;
  company?: string;
  // Pre-extracted résumé facts (preferred) — else we extract from `resumeText`.
  resumeFacts?: ResumeFact[];
  resumeText?: string;
  jobFacts?: JobFact[];
  // SeenFit optimizer output, when HumanProof runs right after an optimization.
  optimizerOutput?: OptimizerOutput | null;
}

// Role families we have human-detail mappings for (see humanizeBullet.ts).
export type RoleFamily =
  | 'restaurant_service'
  | 'delivery_logistics'
  | 'intake_support'
  | 'valet'
  | 'general';

// A loaded phrase-risk rule (built-in or from the DB phrase_risk_rules table).
export interface PhraseRiskRule {
  phrase: string;
  category: FlagType;
  severity: FlagSeverity;
  replacementHint: string | null;
}

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
} as const;

export type HumanProofFactor = keyof typeof HUMANPROOF_WEIGHTS;

// The 0–1 sub-scores that feed the weighted HumanProof Score.
export interface HumanSignalBreakdown {
  specificity: number;
  natural_rhythm: number;
  evidence_grounding: number;
  buzzword_control: number;
  voice_consistency: number;
  interview_defensibility: number;
  role_believability: number;
  formatting_naturalness: number;
}

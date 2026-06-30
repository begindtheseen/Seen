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

export type FactType =
  | 'skill'
  | 'tool'
  | 'title'
  | 'seniority'
  | 'industry'
  | 'responsibility'
  | 'metric'
  | 'education'
  | 'certification'
  | 'location';

export type FactImportance = 'required' | 'preferred' | 'nice_to_have';

// A normalized atom of evidence pulled from a résumé. `label` is the surface form
// found in the text; `normalizedLabel` is the canonical skill/term after taxonomy
// normalization. `evidenceText` is the exact source span — used to prove that a
// generated bullet is backed by real résumé content (anti-hallucination).
export interface ResumeFact {
  factType: FactType;
  label: string;
  normalizedLabel: string;
  evidenceText: string;
  confidence: number; // 0–1
}

// A requirement / preference extracted from a job description.
export interface JobFact {
  factType: FactType;
  label: string;
  normalizedLabel: string;
  importance: FactImportance;
  weight: number; // 0–1 — relative importance within its bucket
  confidence: number; // 0–1
}

// Result of matching one job requirement against the résumé evidence.
export interface RequirementMatch {
  requirement: string; // normalized label
  surface: string; // job's surface form
  importance: FactImportance;
  matched: boolean;
  via: 'exact' | 'alias' | 'related' | 'none';
  evidence: string | null; // résumé evidence text that supports it, if matched
  weight: number;
}

export interface RiskFlag {
  code: string;
  severity: 'low' | 'medium' | 'high';
  message: string;
}

// A generated résumé bullet. `safe` bullets are fully backed by existing résumé
// evidence (no invented numbers/tools). `confirmBeforeUsing` bullets suggest adding
// a real metric the user must confirm — they are NEVER presented as facts.
export interface GeneratedBullet {
  text: string;
  evidenceUsed: string[]; // the résumé evidence spans this bullet draws from
  template: string; // which template produced it
}

export interface ConfirmBeforeUsing {
  text: string;
  reason: string; // why this needs user confirmation (e.g. "add the real number")
  placeholder: string; // the token the user must replace, e.g. "[X]"
}

// Sub-score breakdown — every number here is explained in `explanation`.
export interface ScoreBreakdown {
  required_match: number; // 0–1
  preferred_match: number; // 0–1
  ats_coverage: number; // 0–1
  evidence_strength: number; // 0–1
  seniority_alignment: number; // 0–1
  company_process_score: number; // 0–100 (from company_scores) — null-safe to 50
  location_pay_alignment: number; // 0–1
  risk_penalty: number; // 0–1 (1 = no penalty, lower = more risk)
}

export interface ScoreContribution {
  factor: string;
  weight: number; // 0–1 share of the SeenFit score
  raw: number; // the 0–1 sub-score
  points: number; // weight * raw * 100 contribution to the final score
  reason: string; // human-readable explanation
}

// The full output object persisted on optimizer_runs.output and returned to the UI.
export interface OptimizerOutput {
  engine_version: string;
  fit_score: number; // 0–100 — the SeenFit Score
  confidence: number; // 0–1 — how much evidence backs the score
  confidence_label: 'low' | 'medium' | 'high';

  required_match: number; // 0–1
  preferred_match: number; // 0–1
  ats_coverage: number; // 0–1
  evidence_strength: number; // 0–1
  seniority_alignment: number; // 0–1
  company_process_score: number; // 0–100

  risk_flags: RiskFlag[];
  missing_keywords: string[];
  matched_requirements: RequirementMatch[];
  unsupported_requirements: RequirementMatch[];

  safe_bullets: GeneratedBullet[];
  confirm_before_using: ConfirmBeforeUsing[];
  application_message: string;

  explanation: {
    summary: string;
    contributions: ScoreContribution[];
    notes: string[];
  };

  breakdown: ScoreBreakdown;
}

// Inputs the engine needs to run. `companyProcessScore` comes from the existing
// company_scores table (looked up by company name) — 0–100, or null when unknown.
export interface OptimizeInput {
  resumeText: string;
  jobId?: string | null;
  jobTitle?: string;
  company?: string;
  jobDescription?: string;
  // Pre-extracted/cached job facts (skips re-extraction for repeat runs).
  jobFacts?: JobFact[];
  // From company_scores (0–100) — null when we have no data on the company.
  companyProcessScore?: number | null;
  companyProcessConfidence?: number | null; // 0–1
  // Optional location/pay context for the 5% location/pay term.
  desiredLocation?: string | null;
  jobLocation?: string | null;
  remoteOk?: boolean;
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
} as const;

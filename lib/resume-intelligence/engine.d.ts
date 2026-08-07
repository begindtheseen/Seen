// Type surface for the canonical Resume Intelligence Engine (JS modules, JSDoc-typed at runtime).
// Gives the TS UI real types for the one analysis object it consumes.

export type RequirementLevel = 'REQUIRED' | 'STRONGLY_PREFERRED' | 'PREFERRED' | 'CONTEXTUAL';
export type MatchType =
  | 'EXACT_MATCH' | 'ALIAS_MATCH' | 'TAXONOMY_MATCH' | 'TRANSFERABLE_MATCH'
  | 'SEMANTIC_MATCH' | 'PARTIAL_MATCH' | 'WEAK_EVIDENCE' | 'MISSING';
export type MissSeverity = 'fatal' | 'risky' | 'recoverable' | null;

export interface Match {
  requirement: string;
  canonicalConcept: string | null;
  category: string;
  requirementLevel: RequirementLevel;
  matchType: MatchType;
  confidence: number;
  evidence: string[];
  explanation: string;
  missSeverity: MissSeverity;
  mustNotInvent: boolean;
  matchedIndicators?: string[];
}

export interface ScoreContribution {
  dimension: string;
  weight: number;
  value: number;
  points: number;
  reason: string;
}

export interface Recommendation {
  type: 'name_transferable_skill' | 'surface_buried_skill' | 'align_terminology' | 'add_metric' | 'real_gap';
  priority: 'high' | 'medium' | 'low';
  title: string;
  detail: string;
  requirement?: string;
  evidence?: string[];
  missSeverity?: MissSeverity;
}

export interface MatchAnalysis {
  engine_version: string;
  semantic_backend: 'neural' | 'deterministic';
  overallScore: number;
  criticalRequirementCoverage: number;
  requirementCoverage: number;
  skillAlignment: number;
  experienceRelevance: number;
  evidenceStrength: number;
  terminologyAlignment: number;
  atsParseability: number;
  strongMatches: Match[];
  transferableMatches: Match[];
  partialMatches: Match[];
  weakEvidence: Match[];
  missingRequirements: Match[];
  missingRecoverable: Match[];
  recommendations: Recommendation[];
  scoreBreakdown: ScoreContribution[];
  disclaimer: string;
  job: {
    title: string | null;
    roleFamily: string;
    roleFamilyLabel: string;
    roleFamilyConfidence: number;
    seniority: 'entry' | 'mid' | 'senior';
    requirementCount: number;
    responsibilities: string[];
    educationRequirements: string[];
    certificationRequirements: string[];
    scheduleRequirements: string[];
    physicalRequirements: string[];
    screeningRequirements: string[];
  };
  resume: {
    overallFamily: string;
    roleCount: number;
    skillCount: number;
    metricCount: number;
    explicitConcepts: string[];
  };
  _debug?: Record<string, unknown>;
}

export const ENGINE_VERSION: string;

export function analyzeApplication(input: {
  resumeText?: string;
  jobDescription?: string;
  jobTitle?: string;
  company?: string;
  debug?: boolean;
}): MatchAnalysis;

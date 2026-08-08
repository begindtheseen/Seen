// Resume Intelligence Engine — ORCHESTRATOR → canonical MatchAnalysis.
//
// The ONE entry point. Consumes a raw résumé + job description and returns a single structured
// MatchAnalysis built from the canonical JobProfile + ResumeProfile — replacing the three competing
// keyword interpretations with one source of truth. Every result is traceable to résumé evidence,
// no qualification is invented, the score is explainable, and it runs with NO paid AI. A `debug`
// flag returns the full explainability dump (role family, accepted/rejected concepts + reasons,
// match tiers, evidence, score contributions). Pure + deterministic.

import { buildJobProfile } from './jobProfile.js';
import { buildResumeProfile } from './resumeProfile.js';
import { matchAll } from './match.js';
import { scoreMatch } from './score.js';
import { recommend } from './recommend.js';
import { semanticBackendAvailable } from './semantic.js';

export const ENGINE_VERSION = 'resume_intelligence_v1';

const round = (v) => Math.round((v || 0) * 100);
function pubMatch(m) {
  return {
    requirement: m.requirement, canonicalConcept: m.canonicalConcept, category: m.category,
    requirementLevel: m.requirementLevel, matchType: m.matchType, confidence: m.confidence,
    evidence: m.evidence, explanation: m.explanation, missSeverity: m.missSeverity || null,
    mustNotInvent: !!m.mustNotInvent,
  };
}

export function analyzeApplication({ resumeText = '', jobDescription = '', jobTitle = '', company = '', debug = false } = {}) {
  const jobProfile = buildJobProfile(jobDescription, { jobTitle, company });
  const resume = buildResumeProfile(resumeText);
  const matchResult = matchAll(jobProfile, resume);
  const score = scoreMatch({ jobProfile, resume, matchResult });
  const recommendations = recommend({ jobProfile, resume, matchResult });

  // missingRequirements already includes the fatal (critical) ones — don't concat or they double.
  const missing = matchResult.missingRequirements;

  const analysis = {
    engine_version: ENGINE_VERSION,
    semantic_backend: semanticBackendAvailable() ? 'neural' : 'deterministic',

    // Headline explainable score + dimensions (0–100).
    overallScore: score.overallScore,
    criticalRequirementCoverage: round(score.dimensions.critical_coverage),
    requirementCoverage: round(score.dimensions.requirement_coverage),
    skillAlignment: round(score.dimensions.skill_alignment),
    experienceRelevance: round(score.dimensions.experience_relevance),
    evidenceStrength: round(score.dimensions.evidence_strength),
    terminologyAlignment: round(score.dimensions.terminology_alignment),
    atsParseability: round(score.dimensions.ats_parseability),

    // Match views — every entry carries its résumé evidence + a plain-English explanation.
    strongMatches: matchResult.strongMatches.map(pubMatch),
    transferableMatches: matchResult.transferableMatches.map(pubMatch),
    partialMatches: matchResult.partialMatches.map(pubMatch),
    weakEvidence: matchResult.weakEvidence.map(pubMatch),
    missingRequirements: missing.map(pubMatch),
    missingRecoverable: matchResult.missingRecoverable.map(pubMatch),

    recommendations,
    scoreBreakdown: score.contributions,
    disclaimer: score.disclaimer,

    job: {
      title: jobProfile.title,
      roleFamily: jobProfile.roleFamily,
      roleFamilyLabel: jobProfile.roleFamilyLabel,
      roleFamilyConfidence: jobProfile.roleFamilyConfidence,
      seniority: jobProfile.seniority,
      requirementCount: jobProfile.requirements.filter((r) => r.requirementLevel !== 'CONTEXTUAL').length,
      responsibilities: jobProfile.responsibilities.slice(0, 8),
      educationRequirements: jobProfile.educationRequirements,
      certificationRequirements: jobProfile.certificationRequirements,
      scheduleRequirements: jobProfile.scheduleRequirements,
      physicalRequirements: jobProfile.physicalRequirements,
      screeningRequirements: jobProfile.screeningRequirements,
    },
    resume: {
      overallFamily: resume.overallFamily,
      roleCount: resume.experiences.length,
      skillCount: resume.skills.length,
      metricCount: resume.metricCount,
      explicitConcepts: Object.keys(resume.concepts),
    },
  };

  if (debug) {
    analysis._debug = {
      roleFamily: jobProfile.roleFamily,
      roleFamilyConfidence: jobProfile.roleFamilyConfidence,
      sanitizer_removed: jobProfile._debug.removed,
      job_sections: jobProfile._debug.sections,
      rejected_concepts: jobProfile._debug.rejectedConcepts, // ambiguous tokens gated off, with reason
      accepted_requirements: jobProfile.requirements.map((r) => ({
        concept: r.canonicalConcept, display: r.displayName, category: r.category,
        level: r.requirementLevel, importance: r.importance, section: r.sourceSection,
        aliases: (r.aliases || []).slice(0, 4), related: (r.relatedConcepts || []).slice(0, 4),
      })),
      resume_explicit_concepts: resume._debug.explicitConcepts,
      resume_roles: resume.experiences.map((e) => ({ title: e.title, company: e.company, family: e.family, bullets: e.bullets.length })),
      match_detail: matchResult.matches.map((m) => ({
        requirement: m.requirement, matchType: m.matchType, confidence: m.confidence,
        quality: m.quality, matchedIndicators: m.matchedIndicators || null,
        evidence: m.evidence, contributes: m.importance,
      })),
      score_contributions: score.contributions,
    };
  }

  return analysis;
}

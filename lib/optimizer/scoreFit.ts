// Requirement matching + required/preferred fit sub-scores. NO external AI.
//
// Matches every job requirement against the résumé's normalized skills using the
// taxonomy graph (exact > alias > related). Produces the required_match and
// preferred_match sub-scores plus the per-requirement breakdown the UI shows under
// "Why you match" and "Missing keywords".

import type { JobFact, ResumeFact, RequirementMatch } from './types.ts';
import { bestMatch, type SkillTaxonomy, BUILTIN_TAXONOMY } from './normalizeSkills.ts';
import { resumeSkillLabels } from './extractResumeFacts.ts';

// A related (non-exact) match counts partially toward "matched" — strong enough to
// claim transferable experience, but flagged so we don't overstate it.
const RELATED_CREDIT = 0.6;

export interface FitResult {
  required_match: number; // 0–1
  preferred_match: number; // 0–1
  matches: RequirementMatch[];
  matched_requirements: RequirementMatch[];
  unsupported_requirements: RequirementMatch[];
  missing_required: string[];
}

export function scoreFit(
  jobFacts: JobFact[],
  resumeFacts: ResumeFact[],
  taxonomy: SkillTaxonomy = BUILTIN_TAXONOMY
): FitResult {
  const resumeSkills = resumeSkillLabels(resumeFacts);
  const skillReqs = jobFacts.filter((f) => f.factType === 'skill');

  const matches: RequirementMatch[] = [];
  for (const req of skillReqs) {
    const bm = bestMatch(req.normalizedLabel, resumeSkills, taxonomy);
    const matched = bm.kind === 'exact' || (bm.kind === 'related' && bm.strength >= 0.5);
    const evidence = matched && bm.via
      ? resumeFacts.find((f) => f.normalizedLabel === bm.via)?.evidenceText || null
      : null;
    matches.push({
      requirement: req.normalizedLabel,
      surface: req.label,
      importance: req.importance,
      matched,
      via: bm.kind === 'none' ? 'none' : bm.kind === 'exact' ? (bm.strength >= 0.99 ? 'exact' : 'alias') : 'related',
      evidence,
      weight: req.weight,
    });
  }

  const required = matches.filter((m) => m.importance === 'required');
  const preferred = matches.filter((m) => m.importance === 'preferred' || m.importance === 'nice_to_have');

  const required_match = weightedCoverage(required, matches, 'required');
  const preferred_match = weightedCoverage(preferred, matches, 'preferred');

  const matched_requirements = matches.filter((m) => m.matched);
  const unsupported_requirements = matches.filter((m) => !m.matched);
  const missing_required = required.filter((m) => !m.matched).map((m) => m.surface);

  return {
    required_match,
    preferred_match,
    matches,
    matched_requirements,
    unsupported_requirements,
    missing_required,
  };
}

// Weighted coverage: each requirement contributes its weight; a related-only match
// contributes RELATED_CREDIT of full credit. Returns 1 when there are no
// requirements in the bucket (a job with no preferred skills isn't "failing").
function weightedCoverage(
  bucket: RequirementMatch[],
  allMatches: RequirementMatch[],
  which: 'required' | 'preferred'
): number {
  void allMatches;
  void which;
  if (bucket.length === 0) return 1;
  let total = 0;
  let got = 0;
  for (const m of bucket) {
    total += m.weight;
    if (m.matched) {
      got += m.weight * (m.via === 'related' ? RELATED_CREDIT : 1);
    }
  }
  return total === 0 ? 1 : Math.max(0, Math.min(1, got / total));
}

// Seniority alignment 0–1. Perfect when ranks match; degrades with distance.
// Being one level under the role is a bigger miss than being one level over.
export function seniorityAlignment(jobRank: number, resumeRank: number): number {
  if (!jobRank || !resumeRank) return 0.6; // unknown on either side → neutral-ish
  const diff = resumeRank - jobRank;
  if (diff === 0) return 1;
  if (diff > 0) return Math.max(0.5, 1 - diff * 0.15); // overqualified, mild penalty
  return Math.max(0, 1 + diff * 0.25); // underqualified, steeper penalty
}

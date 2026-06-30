// Detect buzzword-heavy / corporate self-description phrasing. NO external AI.
//
// Flags phrases like "results-driven", "proven track record", "dynamic professional",
// "fast-paced environment" — corporate buzzwords that add no real work context. Driven
// by the local phrase-risk dictionary.

import type { HumanProofFlag, PhraseRiskRule } from './types.ts';
import { findPhraseMatches } from './phraseRisk.ts';

export function detectBuzzwords(text: string, rules: PhraseRiskRule[]): HumanProofFlag[] {
  const buzzRules = rules.filter((r) => r.category === 'buzzword');
  const matches = findPhraseMatches(text, buzzRules);
  return matches.map((m) => ({
    flagType: 'buzzword' as const,
    severity: m.rule.severity,
    originalPhrase: m.matched,
    explanation: 'Corporate buzzword with no work context — replace with something specific you actually did.',
    suggestedFix: m.rule.replacementHint,
  }));
}

// Count of distinct buzzword hits — used by scoring's buzzword_control factor.
export function countBuzzwords(text: string, rules: PhraseRiskRule[]): number {
  return detectBuzzwords(text, rules).length;
}

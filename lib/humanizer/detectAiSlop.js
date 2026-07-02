// Detect generic AI-style "slop" phrasing. NO external AI.
//
// Flags filler verbs and generic generator phrases (leveraged, utilized, demonstrated
// excellence, …) plus vague claims with no concrete work context. Driven by the local
// phrase-risk dictionary, so it is fully deterministic and explainable.
import { findPhraseMatches } from './phraseRisk.js';
// Categories the phrase dictionary uses that count as "AI slop" / generic writing here.
const SLOP_CATEGORIES = new Set(['ai_slop', 'vague_claim']);
const EXPLAIN = {
    ai_slop: 'Reads like AI/résumé-generator filler — plainer wording is more believable.',
    vague_claim: 'A vague claim with no concrete work context — say what you actually did.',
};
export function detectAiSlop(text, rules) {
    const slopRules = rules.filter((r) => SLOP_CATEGORIES.has(r.category));
    const matches = findPhraseMatches(text, slopRules);
    return matches.map((m) => ({
        flagType: m.rule.category,
        severity: m.rule.severity,
        originalPhrase: m.matched,
        explanation: EXPLAIN[m.rule.category] || EXPLAIN.ai_slop,
        suggestedFix: m.rule.replacementHint,
    }));
}

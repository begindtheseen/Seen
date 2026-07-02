// Compute the 8 human-signal sub-scores for a piece of text. NO external AI.
//
// Each sub-score is 0–1. The weighted sum (explainHumanProof.ts) is the HumanProof
// Score (0–100). All measures are deterministic functions of the text + the user's real
// facts + the detector outputs — no model, no randomness.
//
//   specificity            20% — concrete nouns/duties vs. vague filler
//   natural_rhythm         15% — varied bullet openers/lengths (from detectRepetition)
//   evidence_grounding     15% — claims backed by résumé facts (no unsupported metric/tool)
//   buzzword_control       15% — absence of buzzwords/AI slop
//   voice_consistency      10% — consistent person/tense, not a patchwork
//   interview_defensibility 10% — claims easy to defend (from detectInterviewRisk)
//   role_believability     10% — language matches the role family / level
//   formatting_naturalness  5% — human formatting, not templated uniformity
import { detectAiSlop } from './detectAiSlop.js';
import { detectBuzzwords } from './detectBuzzwords.js';
import { detectRepetition, splitBullets } from './detectRepetition.js';
import { detectOverclaiming } from './detectOverclaiming.js';
import { detectInterviewRisk } from './detectInterviewRisk.js';
// Concrete-noun markers that signal real work context (not exhaustive — a heuristic).
const CONCRETE_MARKERS = /\b(customer|guest|order|route|shift|phone|call|record|appointment|document|package|vehicle|key|team|register|pos|inventory|schedule|delivery|ticket|account|invoice|report|kitchen|floor|drawer|cash|traffic|safety)\b/gi;
const VAGUE_MARKERS = /\b(various|effectively|successfully|excellence|dynamic|passionate|motivated|results-?driven|proven|synerg|leverag|utiliz|spearhead)\w*/gi;
function clamp01(n) {
    return Math.max(0, Math.min(1, Number(n.toFixed(4))));
}
function specificity(text) {
    const words = (text.match(/[A-Za-z][A-Za-z'-]*/g) || []).length || 1;
    const concrete = (text.match(CONCRETE_MARKERS) || []).length;
    const vague = (text.match(VAGUE_MARKERS) || []).length;
    // Density of concrete markers, penalized by vague markers.
    const base = Math.min(1, (concrete / Math.max(6, words / 8)));
    const penalty = Math.min(0.6, vague * 0.15);
    return clamp01(base - penalty + (concrete > 0 ? 0.1 : 0));
}
function buzzwordControl(text, rules) {
    const hits = detectAiSlop(text, rules).length + detectBuzzwords(text, rules).length;
    const sentences = Math.max(1, (text.match(/[.!?]+/g) || []).length);
    return clamp01(1 - hits / (sentences + 1));
}
function evidenceGrounding(text, facts) {
    // No facts to check against → neutral-positive (we can't penalize what we can't verify).
    if (!facts.length)
        return 0.7;
    const over = detectOverclaiming(text, facts);
    const unsupported = over.unsupportedMetrics.length + over.unsupportedTools.length;
    // Reward supported skills actually appearing; penalize unsupported claims.
    const supportedSkills = facts.filter((f) => f.factType === 'skill' || f.factType === 'tool');
    const lower = text.toLowerCase();
    const present = supportedSkills.filter((f) => lower.includes(f.normalizedLabel) || lower.includes(f.label.toLowerCase())).length;
    const groundedBoost = supportedSkills.length ? Math.min(0.4, present / supportedSkills.length * 0.4) : 0.2;
    return clamp01(0.6 + groundedBoost - unsupported * 0.2);
}
function voiceConsistency(text) {
    const bullets = splitBullets(text);
    if (bullets.length < 2)
        return 0.9;
    // Penalize mixing first-person ("I led") with bare verb bullets ("Led …") within the
    // same set — a tell of stitched-together generator output.
    const firstPerson = bullets.filter((b) => /^\s*i\b/i.test(b)).length;
    const bareVerb = bullets.filter((b) => /^\s*[A-Z][a-z]+ed\b/.test(b)).length;
    const total = bullets.length;
    const mixed = firstPerson > 0 && bareVerb > 0;
    const dominant = Math.max(firstPerson, bareVerb, total - firstPerson - bareVerb) / total;
    return clamp01((mixed ? 0.6 : 0.85) + dominant * 0.15);
}
function roleBelievability(text, ctx) {
    // Believable when the language matches the role family and doesn't overclaim seniority.
    const over = detectOverclaiming(text, ctx.resumeFacts);
    const seniorityRisk = over.flags.some((f) => f.flagType === 'unsupported_seniority');
    const overpolished = over.flags.some((f) => f.flagType === 'overpolished');
    let s = 0.85;
    if (ctx.roleFamily !== 'general')
        s += 0.1; // a recognized family → grounded context available
    if (seniorityRisk)
        s -= 0.3;
    if (overpolished)
        s -= 0.2;
    return clamp01(s);
}
function formattingNaturalness(text) {
    const bullets = splitBullets(text);
    if (bullets.length < 2)
        return 0.85;
    // Penalize ALL-CAPS shouting and perfectly uniform end punctuation/length (templated).
    const allCaps = bullets.filter((b) => b.length > 12 && b === b.toUpperCase()).length;
    const endsWithPeriod = bullets.filter((b) => /[.]$/.test(b)).length;
    const uniformEnd = endsWithPeriod === bullets.length || endsWithPeriod === 0;
    let s = 0.9;
    if (allCaps > 0)
        s -= 0.3;
    if (uniformEnd && bullets.length > 4)
        s -= 0.05;
    return clamp01(s);
}
export function scoreHumanSignal(text, ctx) {
    const rep = detectRepetition(text);
    const ir = detectInterviewRisk(text, ctx.resumeFacts);
    return {
        specificity: specificity(text),
        natural_rhythm: clamp01(rep.naturalRhythm),
        evidence_grounding: evidenceGrounding(text, ctx.resumeFacts),
        buzzword_control: buzzwordControl(text, ctx.rules),
        voice_consistency: voiceConsistency(text),
        interview_defensibility: clamp01(ir.defensibility),
        role_believability: roleBelievability(text, ctx),
        formatting_naturalness: formattingNaturalness(text),
    };
}

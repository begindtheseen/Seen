// Detect claims that would be hard to defend in an interview. NO external AI.
//
// A claim is "interview-risky" when it is grandiose, vague, or unsupported — the kind of
// line an interviewer can poke at ("you say you 'spearheaded' this — walk me through
// exactly what you did"). We surface these as warnings so the user can make the claim
// concrete and defensible BEFORE they submit. We do NOT frame this as fooling anyone —
// the goal is that every line is true and easy to explain out loud.
import { detectOverclaiming } from './detectOverclaiming.js';
// Phrases that invite a hard follow-up question if there's no concrete backing.
const RISKY_PATTERNS = [
    { re: /\bspearheaded\b/i, warning: '"Spearheaded" invites "what exactly did you lead?" — describe the concrete part you owned.' },
    { re: /\bsingle-?handedly\b/i, warning: '"Single-handedly" is hard to defend — be specific about your part vs. the team\'s.' },
    { re: /\bproven track record\b/i, warning: '"Proven track record" sounds like a claim with no proof — give one concrete example instead.' },
    { re: /\bexpert\b/i, warning: 'Calling yourself an "expert" invites deep questioning — describe what you can actually do.' },
    { re: /\bvarious (tasks|duties|responsibilities)\b/i, warning: '"Various tasks" is vague — name the specific duties you can speak to in detail.' },
    { re: /\bincreased\b[^.]*\bby\b/i, warning: 'A percentage improvement needs a number you can back up — confirm the real figure or soften the claim.' },
    { re: /\bdemonstrated excellence\b/i, warning: '"Demonstrated excellence" is unverifiable — replace with a specific thing you did well.' },
];
export function detectInterviewRisk(text, resumeFacts) {
    const src = String(text || '');
    const warnings = [];
    const flags = [];
    for (const { re, warning } of RISKY_PATTERNS) {
        const m = re.exec(src);
        if (m) {
            warnings.push({ phrase: m[0], warning });
            flags.push({
                flagType: 'interview_risk',
                severity: 'medium',
                originalPhrase: m[0],
                explanation: warning,
                suggestedFix: null,
            });
        }
    }
    // Unsupported metrics/tools are also interview risks — an interviewer will probe a
    // number or tool you can't actually speak to. Fold those into the defensibility score.
    const over = detectOverclaiming(src, resumeFacts);
    for (const m of over.unsupportedMetrics) {
        warnings.push({ phrase: m, warning: `"${m}" isn't backed by your résumé — be ready to prove it or take it out.` });
    }
    for (const t of over.unsupportedTools) {
        warnings.push({ phrase: t, warning: `You'd be asked to demonstrate "${t}" — only keep it if you've genuinely used it.` });
    }
    // Defensibility: start at 1, subtract for each risky claim, floor at 0.
    const riskCount = warnings.length;
    const sentenceCount = Math.max(1, (src.match(/[.!?]+/g) || []).length);
    const defensibility = Number(Math.max(0, Math.min(1, 1 - riskCount / (sentenceCount + 2))).toFixed(3));
    return { warnings, flags, defensibility };
}

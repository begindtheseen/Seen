// ATS keyword coverage — what fraction of the job's important keywords literally
// appear in the résumé text. Deterministic; NO external AI.
//
// ATS systems do crude keyword matching, so this is intentionally LITERAL (does the
// exact keyword string appear?) rather than taxonomy-aware. The taxonomy-aware view is
// scoreFit; this is the "will the bots see it" view. Missing keywords here become the
// "Missing keywords" list the UI surfaces.
import { canonicalText } from './normalizeSkills.js';
export function scoreAts(jobFacts, resumeText) {
    const haystack = canonicalText(resumeText);
    // Important keywords = all skill requirements, required ones weighted more heavily.
    const keywords = jobFacts
        .filter((f) => f.factType === 'skill')
        .map((f) => ({ kw: f.normalizedLabel, surface: f.label, weight: f.importance === 'required' ? 1 : 0.5 }));
    if (keywords.length === 0) {
        return { ats_coverage: 1, present_keywords: [], missing_keywords: [] };
    }
    let total = 0;
    let got = 0;
    const present = [];
    const missing = [];
    for (const { kw, surface, weight } of keywords) {
        total += weight;
        if (literalPresent(haystack, canonicalText(kw)) || literalPresent(haystack, canonicalText(surface))) {
            got += weight;
            present.push(surface);
        }
        else {
            missing.push(surface);
        }
    }
    return {
        ats_coverage: total === 0 ? 1 : Math.max(0, Math.min(1, got / total)),
        present_keywords: present,
        missing_keywords: missing,
    };
}
function literalPresent(haystack, needle) {
    if (!needle)
        return false;
    let from = 0;
    while (true) {
        const idx = haystack.indexOf(needle, from);
        if (idx === -1)
            return false;
        const before = idx === 0 ? ' ' : haystack[idx - 1];
        const after = idx + needle.length >= haystack.length ? ' ' : haystack[idx + needle.length];
        const bb = !/[a-z0-9]/.test(before) || !/[a-z0-9]/.test(needle[0]);
        const ba = !/[a-z0-9]/.test(after) || !/[a-z0-9]/.test(needle[needle.length - 1]);
        if (bb && ba)
            return true;
        from = idx + 1;
    }
}

// Requirement matching + required/preferred fit sub-scores. NO external AI.
//
// Matches every job requirement against the résumé's normalized skills using the
// taxonomy graph (exact > alias > related). Produces the required_match and
// preferred_match sub-scores plus the per-requirement breakdown the UI shows under
// "Why you match" and "Missing keywords".
import { bestMatch, BUILTIN_TAXONOMY } from './normalizeSkills.js';
import { resumeSkillLabels } from './extractResumeFacts.js';
// A related (non-exact) match counts partially toward "matched" — strong enough to claim
// transferable experience, but flagged so we don't overstate it. Credit follows the edge
// strength within [0.6, 0.75]: "cash handling ~ point of sale" (0.7) earns more than a 0.5 hop.
const RELATED_MIN = 0.6;
const RELATED_MAX = 0.75;
function relatedCredit(strength) {
    return Math.max(RELATED_MIN, Math.min(RELATED_MAX, Number(strength) || 0));
}
export function scoreFit(jobFacts, resumeFacts, taxonomy = BUILTIN_TAXONOMY) {
    const resumeSkills = resumeSkillLabels(resumeFacts);
    const skillReqs = jobFacts.filter((f) => f.factType === 'skill');
    const matches = [];
    for (const req of skillReqs) {
        const bm = bestMatch(req.normalizedLabel, resumeSkills, taxonomy);
        const matched = bm.kind === 'exact' || (bm.kind === 'related' && bm.strength >= 0.5);
        const evidence = matched && bm.via
            ? resumeFacts.find((f) => f.normalizedLabel === bm.via)?.evidenceText || null
            : null;
        const evFact = matched && bm.via ? resumeFacts.find((f) => f.normalizedLabel === bm.via) : null;
        matches.push({
            requirement: req.normalizedLabel,
            surface: req.label,
            postingPhrases: req.postingPhrases || [req.label],
            importance: req.importance,
            hard: req.hard !== undefined ? !!req.hard : req.importance === 'required',
            soft: !!req.soft,
            matched,
            via: bm.kind === 'none' ? 'none' : bm.kind === 'exact' ? (bm.strength >= 0.99 ? 'exact' : 'alias') : 'related',
            strength: Number((bm.strength || 0).toFixed(2)),
            relatedTo: bm.kind === 'related' ? bm.via : null,
            evidence,
            evidenceKind: evFact ? evFact.evidenceKind || null : null,
            postingEvidence: req.evidence || null,
            weight: req.weight,
        });
    }
    const required = matches.filter((m) => m.importance === 'required');
    const preferred = matches.filter((m) => m.importance === 'preferred' || m.importance === 'nice_to_have');
    const required_match = weightedCoverage(required, matches, 'required');
    const preferred_match = weightedCoverage(preferred, matches, 'preferred');
    const matched_requirements = matches.filter((m) => m.matched);
    const unsupported_requirements = matches.filter((m) => !m.matched);
    // Only HARD requirements (a stated requirement, not a duty or a soft skill) count as
    // "missing required" — the risk penalty and the risk flag read this list.
    const missing_required = required.filter((m) => !m.matched && m.hard).map((m) => m.surface);
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
function weightedCoverage(bucket, allMatches, which) {
    void allMatches;
    void which;
    if (bucket.length === 0)
        return 1;
    let total = 0;
    let got = 0;
    for (const m of bucket) {
        total += m.weight;
        if (m.matched) {
            // a soft skill is never stated literally; shown through a related hard skill it is
            // as proven as a soft skill gets (RELATED_MAX)
            got += m.weight * (m.via === 'related' ? (m.soft ? RELATED_MAX : relatedCredit(m.strength)) : 1);
        }
    }
    return total === 0 ? 1 : Math.max(0, Math.min(1, got / total));
}
// Seniority alignment 0–1. Perfect when ranks match; degrades with distance.
// Being one level under the role is a bigger miss than being one level over.
export function seniorityAlignment(jobRank, resumeRank) {
    if (!jobRank || !resumeRank)
        return 0.6; // unknown on either side → neutral-ish
    const diff = resumeRank - jobRank;
    if (diff === 0)
        return 1;
    if (diff > 0)
        return Math.max(0.5, 1 - diff * 0.15); // overqualified, mild penalty
    return Math.max(0, 1 + diff * 0.25); // underqualified, steeper penalty
}

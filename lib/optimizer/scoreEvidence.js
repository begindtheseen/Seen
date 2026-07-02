// Evidence strength — how well-substantiated the résumé is. Deterministic; NO AI.
//
// A résumé that lists skills with no surrounding context, no metrics, and no titles is
// weaker evidence than one where matched skills appear inside accomplishment lines
// with real numbers. This sub-score rewards: (a) matched requirements that have a real
// evidence span, (b) presence of quantified metrics, (c) presence of concrete titles.
//
// It also drives `confidence` for the whole run — thin résumés produce low-confidence
// scores instead of falsely precise ones.
export function scoreEvidence(resumeFacts, matches) {
    const metrics = resumeFacts.filter((f) => f.factType === 'metric');
    const titles = resumeFacts.filter((f) => f.factType === 'title');
    const matched = matches.filter((m) => m.matched);
    const matchedWithEvidence = matched.filter((m) => m.evidence && m.evidence.length > 0);
    // Coverage of matches that carry a real evidence span (vs bare keyword presence).
    const evidenceCoverage = matched.length ? matchedWithEvidence.length / matched.length : 0;
    // Quantification bonus — capped; a few real metrics is plenty.
    const metricBonus = Math.min(1, metrics.length / 4);
    // Concreteness — having real titles signals a structured, substantiated résumé.
    const titleBonus = titles.length > 0 ? 1 : 0.4;
    const evidence_strength = clamp01(evidenceCoverage * 0.55 + metricBonus * 0.3 + titleBonus * 0.15);
    // Overall run confidence: more matched requirements + more résumé facts = more
    // confident. A résumé with almost no extractable facts yields low confidence.
    const factVolume = Math.min(1, resumeFacts.length / 18);
    const matchVolume = Math.min(1, matched.length / 6);
    const confidence = clamp01(factVolume * 0.5 + matchVolume * 0.3 + evidenceCoverage * 0.2);
    return {
        evidence_strength,
        metric_count: metrics.length,
        matched_with_evidence: matchedWithEvidence.length,
        confidence: Number(confidence.toFixed(2)),
    };
}
export function confidenceLabel(c) {
    return c >= 0.66 ? 'high' : c >= 0.33 ? 'medium' : 'low';
}
function clamp01(n) {
    return Math.max(0, Math.min(1, n));
}

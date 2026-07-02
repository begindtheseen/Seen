// Score explanation — every SeenFit Score explains itself (no black box).
//
// Given the weighted sub-scores, this produces the per-factor contribution breakdown
// (weight, raw sub-score, points contributed, and a plain-English reason) plus a
// one-line summary. The UI's "Why your score is X" panel renders this directly.
import { SEENFIT_WEIGHTS } from './types.js';
const REASONS = {
    required_match: (r) => `You match ${pct(r)} of the role's required skills (weighted by importance).`,
    preferred_match: (r) => `You match ${pct(r)} of the role's preferred / nice-to-have skills.`,
    evidence_strength: (r) => `Your résumé backs its claims at ${pct(r)} strength — matched skills appearing inside real accomplishment lines and metrics score higher.`,
    seniority_alignment: (r) => `Your seniority aligns with the role at ${pct(r)} (gaps in level reduce this).`,
    company_process_score: (_r, b) => `The company's hiring process scores ${Math.round(b.company_process_score)}/100 from real applicant outcomes (response/ghost rates).`,
    ats_coverage: (r) => `${pct(r)} of the job's keywords literally appear in your résumé — important for ATS keyword filters.`,
    location_pay_alignment: (r) => `Location / pay alignment is ${pct(r)}.`,
    risk_penalty: (r) => r >= 0.99
        ? `No risk penalty applied.`
        : `A risk penalty reduced the score to ${pct(r)} of full credit (see risk flags).`,
};
function pct(n) {
    return `${Math.round(n * 100)}%`;
}
// Each factor's raw 0–1 value. company_process_score is 0–100, so normalize to 0–1
// for the points math while reporting the 0–100 figure in the reason.
function rawValues(b) {
    return {
        required_match: b.required_match,
        preferred_match: b.preferred_match,
        evidence_strength: b.evidence_strength,
        seniority_alignment: b.seniority_alignment,
        company_process_score: (b.company_process_score ?? 50) / 100,
        ats_coverage: b.ats_coverage,
        location_pay_alignment: b.location_pay_alignment,
        risk_penalty: b.risk_penalty,
    };
}
export function computeFitScore(b) {
    const raw = rawValues(b);
    let score = 0;
    for (const k of Object.keys(SEENFIT_WEIGHTS)) {
        score += SEENFIT_WEIGHTS[k] * raw[k];
    }
    return Math.max(0, Math.min(100, Math.round(score * 100)));
}
export function explainScore(b) {
    const raw = rawValues(b);
    const contributions = Object.keys(SEENFIT_WEIGHTS).map((k) => {
        const weight = SEENFIT_WEIGHTS[k];
        const r = raw[k];
        return {
            factor: k,
            weight,
            raw: Number(r.toFixed(3)),
            points: Number((weight * r * 100).toFixed(1)),
            reason: REASONS[k](r, b),
        };
    });
    const fit_score = Math.max(0, Math.min(100, Math.round(contributions.reduce((s, c) => s + c.points, 0))));
    // Sort by points to lead with the biggest drivers.
    const sorted = [...contributions].sort((a, c) => c.points - a.points);
    const topDriver = sorted[0];
    const biggestGap = [...contributions].sort((a, c) => a.points / a.weight - c.points / c.weight)[0];
    const summary = `SeenFit Score ${fit_score}/100. Biggest driver: ${labelOf(topDriver.factor)} (${topDriver.points} pts). ` +
        `Biggest opportunity: improve ${labelOf(biggestGap.factor)}.`;
    const notes = [];
    if (b.required_match < 0.5)
        notes.push('You are missing several required skills — see "Missing keywords".');
    if (b.ats_coverage < 0.5)
        notes.push('Many job keywords are absent from your résumé text — add the real ones you have.');
    if ((b.company_process_score ?? 50) < 40)
        notes.push('This company has a poor hiring-process track record (ghosting/no response).');
    if (b.risk_penalty < 0.99)
        notes.push('A risk penalty was applied — review the risk flags before relying on this score.');
    return { fit_score, summary, contributions, notes };
}
function labelOf(factor) {
    return {
        required_match: 'required-skill match',
        preferred_match: 'preferred-skill match',
        evidence_strength: 'evidence strength',
        seniority_alignment: 'seniority alignment',
        company_process_score: 'company hiring process',
        ats_coverage: 'ATS keyword coverage',
        location_pay_alignment: 'location/pay alignment',
        risk_penalty: 'risk adjustment',
    }[factor] || factor;
}

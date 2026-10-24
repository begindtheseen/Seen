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
    company_process_score: (_r, b) => b.company_process_known === false
        ? `This company isn't graded yet (not enough applicant reports), so this factor is scored neutral (${Math.round(b.company_process_score)}/100).`
        : `The company's hiring process scores ${Math.round(b.company_process_score)}/100 from real applicant outcomes (response/ghost rates).`,
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
// A factor we could not measure is NOT scored (2026-10-24 audits: a neutral 50 for an ungraded
// company and a 0.7 for an unknown location quietly cost every applicant ~8.5 points). The
// measured factors' weights are re-scaled to sum to 1; the unmeasured ones are listed with
// `scored: false` and 0 points so the explanation stays complete.
function scoredFactors(b) {
    return Object.keys(SEENFIT_WEIGHTS).filter((k) => !(k === 'company_process_score' && b.company_process_known === false)
        && !(k === 'location_pay_alignment' && b.location_pay_known === false)
        // a posting with no preferred list has nothing to measure there (it used to score 100%)
        && !(k === 'preferred_match' && b.preferred_known === false));
}
export function computeFitScore(b) {
    const raw = rawValues(b);
    const keys = scoredFactors(b);
    const total = keys.reduce((t, k) => t + SEENFIT_WEIGHTS[k], 0) || 1;
    let score = 0;
    for (const k of keys) score += (SEENFIT_WEIGHTS[k] / total) * raw[k];
    return Math.max(0, Math.min(100, Math.round(score * 100)));
}
export function explainScore(b) {
    const raw = rawValues(b);
    const keys = new Set(scoredFactors(b));
    const total = [...keys].reduce((t, k) => t + SEENFIT_WEIGHTS[k], 0) || 1;
    const contributions = Object.keys(SEENFIT_WEIGHTS).map((k) => {
        const scored = keys.has(k);
        const weight = scored ? Number((SEENFIT_WEIGHTS[k] / total).toFixed(3)) : 0;
        const r = raw[k];
        return {
            factor: k,
            weight,
            raw: Number(r.toFixed(3)),
            points: scored ? Number(((SEENFIT_WEIGHTS[k] / total) * r * 100).toFixed(1)) : 0,
            scored,
            reason: scored ? REASONS[k](r, b) : (k === 'location_pay_alignment' ? 'No location to compare — not scored.' : k === 'preferred_match' ? 'The posting lists no preferred skills — not scored.' : REASONS[k](r, b).replace(/, so this factor is scored neutral \(\d+\/100\)\./, ' — not scored.')),
        };
    });
    const fit_score = Math.max(0, Math.min(100, Math.round(contributions.reduce((s, c) => s + c.points, 0))));
    // Sort by points to lead with the biggest drivers.
    const sorted = [...contributions].sort((a, c) => c.points - a.points);
    const topDriver = sorted[0];
    const biggestGap = [...contributions].filter((c) => c.scored).sort((a, c) => a.points / a.weight - c.points / c.weight)[0] || topDriver;
    const summary = `SeenFit Score ${fit_score}/100. Biggest driver: ${labelOf(topDriver.factor)} (${topDriver.points} pts). ` +
        `Biggest opportunity: improve ${labelOf(biggestGap.factor)}.`;
    const notes = [];
    if (b.required_match < 0.5)
        notes.push('You are missing several required skills — see "Missing keywords".');
    if (b.ats_coverage < 0.5)
        notes.push('Many job keywords are absent from your résumé text — add the real ones you have.');
    if (b.company_process_known !== false && (b.company_process_score ?? 50) < 40)
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

// ── ONE verdict (2026-10-24 audits, D4) ─────────────────────────────────────────────────────
// Every surface shows the same thing: a score (or none), a band, and ONE sentence of why that
// names what the résumé shows and what the posting screens on that it does not. An unmet hard
// gate is the first words of the sentence.
// Display spelling of a canonical skill: proper nouns capitalised ("bilingual Spanish", "Excel").
const PROPER = { spanish: 'Spanish', english: 'English', excel: 'Excel', salesforce: 'Salesforce', quickbooks: 'QuickBooks', 'microsoft office': 'Microsoft Office', 'microsoft word': 'Microsoft Word', 'microsoft powerpoint': 'Microsoft PowerPoint', 'google workspace': 'Google Workspace', crm: 'CRM', sql: 'SQL', aws: 'AWS', 'rf scanner': 'RF scanner', 'point of sale': 'point of sale (POS)' };
export function displaySkill(label) {
    const l = String(label || '');
    if (PROPER[l]) return PROPER[l];
    return l.replace(/\b(spanish|english|excel|salesforce)\b/g, (w) => PROPER[w] || w);
}
export function fitBand(score) {
    if (score == null) return null;
    return score >= 80 ? 'Strong fit' : score >= 65 ? 'Good fit' : score >= 45 ? 'Partial fit' : 'Weak fit';
}
function joinWords(items) {
    if (items.length <= 1) return items.join('');
    if (items.length === 2) return `${items[0]} and ${items[1]}`;
    return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
export function buildVerdict({ score, withheld, gates = [], constraints = [], matches = [], requirementCount = 0 }) {
    const band = fitBand(score);
    const gate = gates.length ? gates[0].message : null;
    const imp = (m) => (m.importance === 'required' ? 1 : 0);
    const have = [...new Set(matches.filter((m) => m.matched && m.via !== 'related' && !m.soft).sort((a, b) => (imp(b) - imp(a)) || (b.weight - a.weight)).map((m) => displaySkill(m.surface)))].slice(0, 3);
    const lack = [...new Set(matches.filter((m) => !m.matched && m.importance === 'required').sort((a, b) => (b.hard - a.hard) || (b.weight - a.weight)).map((m) => displaySkill(m.surface)))].slice(0, 2);
    const conflict = constraints.find((c) => c.conflict);
    const askLabel = (c) => c.kind === 'schedule' ? `availability (${c.label})` : c.kind === 'physical' ? c.label.split(', ')[0].replace(/^lift /, 'lifting ').replace(/^stand /, 'standing ') : c.label;
    const askRows = constraints.filter((c) => c.status === 'ask' && !c.conflict && ['schedule', 'physical', 'certification', 'age'].includes(c.kind))
        .sort((a, b) => ({ age: 0, certification: 1, schedule: 2, physical: 3 }[a.kind] - { age: 0, certification: 1, schedule: 2, physical: 3 }[b.kind]));
    // every schedule ask is ONE availability item ("availability (weekends, holiday blackout …)")
    const sched = [...new Set(askRows.filter((c) => c.kind === 'schedule').flatMap((c) => c.items && c.items.length ? c.items : [c.label]))].filter((i) => !/^(?:part|full)-time$/.test(i));
    const asks = [
        ...askRows.filter((c) => c.kind === 'age' || c.kind === 'certification').map(askLabel),
        ...(sched.length ? [`availability (${sched.slice(0, 3).join(', ')})`] : []),
        ...askRows.filter((c) => c.kind === 'physical').map(askLabel),
    ].filter((v, i, arr) => arr.indexOf(v) === i).slice(0, 2);
    let sentence;
    if (withheld) {
        sentence = requirementCount === 0
            ? 'No score: this listing does not state its requirements, so there is nothing to measure your résumé against.'
            : `No score: only ${requirementCount} requirement${requirementCount === 1 ? '' : 's'} could be read from this listing — too few to measure a fit.`;
    } else {
        const parts = [];
        if (gate) parts.push(gate.replace(/\.$/, ''));
        if (have.length) parts.push(`${gate ? 'you do show' : 'you show'} ${joinWords(have)}`);
        if (conflict) parts.push(conflict.short || 'this job is part-time and your résumé asks for full-time work');
        if (lack.length) parts.push(`the posting also asks for ${joinWords(lack)}, which your résumé doesn't show`);
        if (asks.length) parts.push(`it screens on ${joinWords(asks)} — say so if true`);
        const body = parts.length ? parts.join('; ') : 'your résumé lines up with what this posting asks for';
        sentence = `${score} — ${body}.`;
    }
    return { score: score ?? null, band, sentence, gate, withheld: withheld || null, requirement_count: requirementCount, display: score == null ? 'none' : 'number' };
}

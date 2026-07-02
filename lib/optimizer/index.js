// SeenFit Engine orchestrator — runs the full deterministic optimization.
//
// Pure function: given résumé text + job facts (+ optional company process score), it
// returns the complete OptimizerOutput. NO external AI APIs are called anywhere in
// this module or its dependencies — the whole engine is taxonomy + templates + math.
// This is the single entry point used by api/optimizer.js.
import { ENGINE_VERSION, } from './types.js';
import { mergeTaxonomy } from './normalizeSkills.js';
import { extractResumeFacts, resumeSeniorityRank } from './extractResumeFacts.js';
import { extractJobFacts, jobSeniorityRank } from './extractJobFacts.js';
import { scoreFit, seniorityAlignment } from './scoreFit.js';
import { scoreAts } from './scoreAts.js';
import { scoreEvidence, confidenceLabel } from './scoreEvidence.js';
import { generateSafeBullets } from './generateSafeBullets.js';
import { generateApplicationMessage } from './generateApplicationMessage.js';
import { explainScore } from './explainScore.js';
export * from './types.js';
// Location/pay alignment (5%). Deterministic and conservative: remote-friendly or a
// matching location scores high; an explicit mismatch scores low; unknown is neutral.
function locationPayAlignment(input) {
    if (input.remoteOk)
        return 1;
    const want = (input.desiredLocation || '').toLowerCase().trim();
    const have = (input.jobLocation || '').toLowerCase().trim();
    if (!want || !have)
        return 0.7; // unknown → neutral-positive
    if (have.includes('remote') || want.includes('remote'))
        return 1;
    if (have.includes(want) || want.includes(have))
        return 1;
    // same city token overlap
    const wantTokens = new Set(want.split(/[\s,]+/).filter(Boolean));
    const overlap = have.split(/[\s,]+/).some((t) => wantTokens.has(t));
    return overlap ? 0.85 : 0.3;
}
// Risk flags + the risk-penalty multiplier (1 = no penalty, lower = riskier).
function computeRisk(input, requiredMatch, missingRequired) {
    const flags = [];
    let penalty = 1;
    if (missingRequired.length > 0) {
        const sev = missingRequired.length >= 3 ? 'high' : missingRequired.length >= 2 ? 'medium' : 'low';
        flags.push({
            code: 'missing_required_skills',
            severity: sev,
            message: `Missing ${missingRequired.length} required skill(s): ${missingRequired.slice(0, 5).join(', ')}.`,
        });
        penalty -= Math.min(0.5, missingRequired.length * 0.12);
    }
    if (requiredMatch < 0.34) {
        flags.push({
            code: 'low_required_coverage',
            severity: 'high',
            message: 'You match less than a third of the required skills — this may be a reach role.',
        });
        penalty -= 0.15;
    }
    const cps = input.companyProcessScore;
    if (cps != null && cps < 40) {
        flags.push({
            code: 'company_process_risk',
            severity: cps < 25 ? 'high' : 'medium',
            message: `${input.company || 'This company'} has a weak hiring-process record (${Math.round(cps)}/100) — high ghosting/no-response risk.`,
        });
        penalty -= 0.1;
    }
    if (input.companyProcessConfidence != null && input.companyProcessConfidence < 0.33 && cps != null) {
        flags.push({
            code: 'low_company_confidence',
            severity: 'low',
            message: 'Company process data is thin — treat the company sub-score as a weak signal.',
        });
    }
    return { flags, penalty: Math.max(0.4, Number(penalty.toFixed(3))) };
}
export function runOptimizer(input, options = {}) {
    const taxonomy = mergeTaxonomy(options.taxonomy);
    // 1. Facts.
    const resumeFacts = extractResumeFacts(input.resumeText || '', taxonomy);
    const jobFacts = input.jobFacts && input.jobFacts.length
        ? input.jobFacts
        : extractJobFacts(input.jobDescription || '', { jobTitle: input.jobTitle, taxonomy });
    // 2. Sub-scores.
    const fit = scoreFit(jobFacts, resumeFacts, taxonomy);
    const ats = scoreAts(jobFacts, input.resumeText || '');
    const evidence = scoreEvidence(resumeFacts, fit.matches);
    const seniority = seniorityAlignment(jobSeniorityRank(jobFacts), resumeSeniorityRank(resumeFacts));
    const locPay = locationPayAlignment(input);
    const companyProcess = input.companyProcessScore == null ? 50 : Math.max(0, Math.min(100, input.companyProcessScore));
    const risk = computeRisk(input, fit.required_match, fit.missing_required);
    const breakdown = {
        required_match: fit.required_match,
        preferred_match: fit.preferred_match,
        ats_coverage: ats.ats_coverage,
        evidence_strength: evidence.evidence_strength,
        seniority_alignment: seniority,
        company_process_score: companyProcess,
        location_pay_alignment: locPay,
        risk_penalty: risk.penalty,
    };
    // 3. Explanation (also computes the final fit score from the weighted breakdown).
    const explanation = explainScore(breakdown);
    // 4. Generated content (anti-hallucination enforced inside the generators).
    const bullets = generateSafeBullets(resumeFacts, fit.matches);
    const applicationMessage = generateApplicationMessage({
        jobTitle: input.jobTitle,
        company: input.company,
        matches: fit.matches,
    });
    // 5. Confidence — fold company-process confidence into the run confidence.
    let confidence = evidence.confidence;
    if (input.companyProcessConfidence != null) {
        confidence = Number((confidence * 0.85 + input.companyProcessConfidence * 0.15).toFixed(2));
    }
    return {
        engine_version: ENGINE_VERSION,
        fit_score: explanation.fit_score,
        confidence,
        confidence_label: confidenceLabel(confidence),
        required_match: Number(fit.required_match.toFixed(3)),
        preferred_match: Number(fit.preferred_match.toFixed(3)),
        ats_coverage: Number(ats.ats_coverage.toFixed(3)),
        evidence_strength: Number(evidence.evidence_strength.toFixed(3)),
        seniority_alignment: Number(seniority.toFixed(3)),
        company_process_score: companyProcess,
        risk_flags: risk.flags,
        missing_keywords: ats.missing_keywords,
        matched_requirements: fit.matched_requirements,
        unsupported_requirements: fit.unsupported_requirements,
        safe_bullets: bullets.safe_bullets,
        confirm_before_using: bullets.confirm_before_using,
        application_message: applicationMessage,
        explanation: {
            summary: explanation.summary,
            contributions: explanation.contributions,
            notes: explanation.notes,
        },
        breakdown,
    };
}

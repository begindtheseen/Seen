// SeenFit Engine orchestrator — runs the full deterministic optimization.
//
// Pure function: given résumé text + job facts (+ optional company process score), it
// returns the complete OptimizerOutput. NO external AI APIs are called anywhere in
// this module or its dependencies — the whole engine is taxonomy + templates + math.
// This is the single entry point used by api/optimizer.js.
import { detectRoleFamily } from '../application-intelligence/roleOntology.js';
import { ENGINE_VERSION, } from './types.js';
import { mergeTaxonomy } from './normalizeSkills.js';
import { extractResumeFacts, resumeSeniorityRank } from './extractResumeFacts.js';
import { extractJobFacts, jobSeniorityRank, postingReadingRows } from './extractJobFacts.js';
import { buildStatements, statementVerdicts, displayedRequirementCount } from './statements.js';
import { scoreFit, seniorityAlignment } from './scoreFit.js';
import { scoreAts } from './scoreAts.js';
import { scoreEvidence, confidenceLabel } from './scoreEvidence.js';
import { generateSafeBullets } from './generateSafeBullets.js';
import { generateApplicationMessage } from './generateApplicationMessage.js';
import { explainScore, buildVerdict, fitBand, calibratedFit } from './explainScore.js';
import { evaluateConstraints, failedGates, constraintEffect } from './constraints.js';
import { fieldMatch } from './fieldMatch.js';
import { inferJobTitle } from './postingSections.js';
import { careerYears } from '../resume/years.js';
export * from './types.js';
// Location/pay alignment (5%). Deterministic and conservative: remote-friendly or a
// matching location scores high; an explicit mismatch scores low; unknown is neutral.
function locationPayAlignment(input) {
    if (input.remoteOk)
        return 1;
    const want = (input.desiredLocation || '').toLowerCase().trim();
    const have = (input.jobLocation || '').toLowerCase().trim();
    if (!want || !have)
        return 0.7; // unknown → not scored (location_pay_known: false)
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
function computeRisk(input, requiredMatch, missingRequired, gates = [], scheduleConflict = null) {
    const flags = [];
    let penalty = 1;
    for (const g of gates) {
        flags.push({ code: 'hard_gate', severity: 'high', message: g.message });
    }
    // The résumé asks for full-time work and the job is part-time/seasonal: the first thing a
    // store manager screens on (2026-10-24 recruiter audit, R1/R9).
    if (scheduleConflict) {
        flags.push({ code: 'schedule_conflict', severity: 'medium', message: scheduleConflict.message });
        penalty -= 0.1;
    }
    if (missingRequired.length > 0) {
        const sev = missingRequired.length >= 3 ? 'high' : missingRequired.length >= 2 ? 'medium' : 'low';
        flags.push({
            code: 'missing_required_skills',
            severity: sev,
            message: `Missing ${missingRequired.length} required skill(s): ${missingRequired.slice(0, 5).join(', ')}.`,
        });
        penalty -= Math.min(0.5, missingRequired.length * 0.12);
    }
    if (requiredMatch < 0.34 && !gates.length) {
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
        : extractJobFacts(input.jobDescription || '', { jobTitle: input.jobTitle, company: input.company, taxonomy });
    // 2. Hard gates first (degree / GPA, years, management, seniority, licence) — then sub-scores.
    // the family the posting itself names when no title is given (the same rule extractJobFacts uses)
    const familyTitle = input.jobTitle ? String(input.jobTitle) : inferJobTitle(input.jobDescription || '');
    const jobFamily = familyTitle ? detectRoleFamily(familyTitle, '').family : null;
    // facts from the job_facts cache carry no statements: re-read the lines and link the cached facts to them
    if (!jobFacts.statements && input.jobDescription) jobFacts.statements = buildStatements(postingReadingRows(input.jobDescription, familyTitle), jobFacts, { company: input.company || '' });
    const now = input.now ? new Date(input.now) : new Date();
    const constraints = evaluateConstraints(jobFacts, resumeFacts, input.resumeText || '', { jobFamily, jobTitle: familyTitle, jobText: input.jobDescription || '', now });
    const gates = failedGates(constraints);
    const fit = scoreFit(jobFacts, resumeFacts, taxonomy, input.resumeText || '');
    const ats = scoreAts(jobFacts, input.resumeText || '');
    const evidence = scoreEvidence(resumeFacts, fit.matches);
    const seniority = seniorityAlignment(jobSeniorityRank(jobFacts), resumeSeniorityRank(resumeFacts));
    const locPay = locationPayAlignment(input);
    const companyProcess = input.companyProcessScore == null ? 50 : Math.max(0, Math.min(100, input.companyProcessScore));
    const risk = computeRisk(input, fit.required_match, fit.missing_required, gates, constraints.find((c) => c.conflict));
    // A number is a claim of precision: with fewer than 3 requirements read from the posting
    // (an Adzuna teaser, a pay disclaimer) there is nothing to measure, so no score is given.
    const scorableConstraints = constraints.filter((c) => ['degree', 'years', 'management', 'seniority', 'certification', 'language'].includes(c.kind));
    const factCount = fit.matches.length + scorableConstraints.length;
    // the requirement LINES a person reads, each judged from its facts (statements.js) — the unit every tool prints.
    // R3 display gate: `display:false` statements (malformed, pitch, inferred from a flat run) still feed matching and
    // the score above; "N requirements read" and the too-few refusal count only the DISPLAYED requirement lines
    // (required, preferred, duty — statements.js displayedRequirementCount, the single source),
    // so a refusal never says "only 2" above a list of 9 and a count never includes a line nobody is shown.
    // the field verdict (same / adjacent / different) is computed ONCE, before the statement verdicts, so the judge and
    // the calibrated score read the same answer instead of each classifying the field its own way
    const field = fieldMatch({ resumeText: input.resumeText || '', jobTitle: familyTitle, jobText: input.jobDescription || '', matches: fit.matches, now });
    const statements = statementVerdicts(jobFacts.statements || [], fit.matches, constraints, jobFacts, { resumeText: input.resumeText || '', jobTitle: familyTitle, field });
    const displayedReqs = displayedRequirementCount(statements);
    // a reading with no statements at all (cached facts with no posting text) keeps the fact count
    const requirementCount = jobFacts.statements && jobFacts.statements.length ? displayedReqs : factCount;
    const breakdown = {
        required_match: fit.required_match,
        preferred_match: fit.preferred_match,
        preferred_known: fit.matches.some((m) => m.importance === 'preferred' || m.importance === 'nice_to_have'),
        ats_coverage: ats.ats_coverage,
        evidence_strength: evidence.evidence_strength,
        seniority_alignment: seniority,
        company_process_score: companyProcess,
        // false → no gradeable company score (below the report bar): companyProcess is a neutral 50,
        // not a measurement. Not in SEENFIT_WEIGHTS, so it never changes the math.
        company_process_known: input.companyProcessScore != null,
        location_pay_alignment: locPay,
        // false → no desired/job location (and not remote): not a measurement, not scored.
        location_pay_known: !!input.remoteOk || !!((input.desiredLocation || '').trim() && (input.jobLocation || '').trim()),
        risk_penalty: risk.penalty,
    };
    // 3. Explanation (also computes the final fit score from the weighted breakdown), then the
    //    hard-gate cap and the too-few-requirements rule.
    const explanation = explainScore(breakdown);
    // the calibrated score (explainScore.js calibratedFit): field, done-this-job, years, core requirements; graded gates
    const calib = calibratedFit({ matches: fit.matches, breakdown, constraints, field, effect: constraintEffect(constraints), scheduleConflict: !!constraints.find((c) => c.conflict), statements, promises: (jobFacts.statements || []).filter((s) => s.kind === 'promise').map((s) => ({ text: s.text, source: s.source, contradicted_by: s.contradictedBy || null })) });
    let fitScore = calib.score;
    const withheld = requirementCount < 3 ? 'too_few_requirements' : null;
    if (withheld) fitScore = null;
    const verdict = buildVerdict({ score: fitScore, withheld, gates, constraints, matches: fit.matches, requirementCount, field, drivers: calib.drivers, components: calib.components, statements });
    explanation.fit_score = fitScore;
    explanation.summary = verdict.sentence;
    // 4. Generated content (anti-hallucination enforced inside the generators).
    const bullets = generateSafeBullets(resumeFacts, fit.matches, { resumeText: input.resumeText || '', jobDescription: input.jobDescription || '' });
    const applicationMessage = generateApplicationMessage({
        jobTitle: input.jobTitle,
        company: input.company,
        matches: fit.matches,
        resumeText: input.resumeText || '',
    });
    // 5. Confidence — fold company-process confidence into the run confidence.
    let confidence = evidence.confidence;
    if (input.companyProcessConfidence != null) {
        confidence = Number((confidence * 0.85 + input.companyProcessConfidence * 0.15).toFixed(2));
    }
    return {
        engine_version: ENGINE_VERSION,
        fit_score: fitScore,
        fit_band: fitScore == null ? null : fitBand(fitScore, field),
        // ONE verdict for every surface: score (or null), band, one sentence of why, the gate line.
        verdict,
        field_match: field,
        requirement_count: requirementCount,
        // ONE years figure for the person (lib/resume/years.js careerYears): `dated` is what the fit check prints; every
        // tool should print the same. `years_note` is set once when the résumé's own stated years disagree with its dates.
        career_years: (() => { const cy = careerYears(input.resumeText || '', { now }); return { dated: cy.dated, whole: cy.whole, stated: cy.stated, display: field.yearsDisplay && Math.abs((field.fieldYears || 0) - cy.dated) >= 1 ? field.yearsDisplay : cy.display, total_display: cy.display, in_field: field.fieldYears, field: field.postingField, display_field: field.yearsDisplay }; })(),
        years_note: careerYears(input.resumeText || '').note,
        // Structured constraints judged against the résumé (met / unmet / ask) and the unmet gates.
        constraints,
        hard_gates: gates,
        confidence,
        confidence_label: confidenceLabel(confidence),
        required_match: Number(fit.required_match.toFixed(3)),
        preferred_match: Number(fit.preferred_match.toFixed(3)),
        ats_coverage: Number(ats.ats_coverage.toFixed(3)),
        evidence_strength: Number(evidence.evidence_strength.toFixed(3)),
        seniority_alignment: Number(seniority.toFixed(3)),
        company_process_score: companyProcess,
        company_process_known: input.companyProcessScore != null,
        risk_flags: risk.flags,
        missing_keywords: ats.missing_keywords,
        // the requirement LINES a person reads, each judged from its facts (statements.js) — the unit every tool prints;
        // each carries `confidence` ('high'|'medium'|'low') and `display` (show it, or only under "Also mentioned")
        statements,
        displayed_count: statements.filter((s) => s.display).length,
        hidden_count: statements.filter((s) => !s.display).length,
        // the requirement facts read (matches + scorable constraints): the old count, kept for reference
        requirement_fact_count: factCount,
        // what the posting promises or waives ("No experience required!"): never judged against the résumé
        promises: (jobFacts.statements || []).filter((s) => s.kind === 'promise').map((s) => ({ id: s.id, text: s.text, source: s.source, ...(s.contradictedBy ? { contradicted_by: s.contradictedBy } : {}) })),
        matched_requirements: fit.matched_requirements,
        unsupported_requirements: fit.unsupported_requirements,
        safe_bullets: bullets.safe_bullets,
        confirm_before_using: bullets.confirm_before_using,
        // Posting words the résumé states differently ("POS" vs "cashier") — a note, never an edit.
        wording_gaps: bullets.wording_gaps,
        application_message: applicationMessage,
        explanation: {
            summary: explanation.summary,
            contributions: explanation.contributions,
            notes: explanation.notes,
        },
        breakdown,
    };
}

// HumanProof orchestrator — runs the full deterministic humanization. NO external AI.
//
// Pure function: given text + the user's real facts (résumé facts, job facts, and the
// SeenFit optimizer output when available), it returns the complete HumanProofOutput.
// NO external AI APIs are called anywhere in this module or its dependencies — the whole
// engine is local dictionaries + detectors + templates + math. This is the single entry
// point used by the api endpoint.
//
// FRAMING: HumanProof removes generic AI-style writing and adds truthful, specific,
// human work context. It never claims to bypass detectors, ATS, or employers.
import { HUMANPROOF_ENGINE_VERSION, } from './types.js';
import { mergeRules, BUILTIN_PHRASE_RULES } from './phraseRisk.js';
import { detectAiSlop } from './detectAiSlop.js';
import { detectBuzzwords } from './detectBuzzwords.js';
import { detectRepetition, splitBullets } from './detectRepetition.js';
import { detectOverclaiming } from './detectOverclaiming.js';
import { detectInterviewRisk } from './detectInterviewRisk.js';
import { humanizeBullet, stripUnsupportedClaims } from './humanizeBullet.js';
import { humanizeSummary } from './humanizeSummary.js';
import { humanizeApplicationMessage } from './humanizeApplicationMessage.js';
import { inferRoleFamily } from './roleDetails.js';
import { scoreHumanSignal } from './scoreHumanSignal.js';
import { explainHumanProof } from './explainHumanProof.js';
import { extractResumeFacts } from '../optimizer/extractResumeFacts.js';
import { segmentResume, rewritable } from './resumeLines.js';
import { numbersIntact } from './protect.js';
export * from './types.js';
export { runHumanProof };
// Resolve the supported résumé facts from the richest source available:
//   explicit resumeFacts → optimizer output (re-extract isn't needed, but we accept
//   facts if passed) → extract from resumeText. With none, facts is [] and the engine
//   stays conservative (no false "unsupported" flags).
function resolveResumeFacts(input) {
    if (input.resumeFacts && input.resumeFacts.length)
        return input.resumeFacts;
    if (input.resumeText && input.resumeText.trim())
        return extractResumeFacts(input.resumeText);
    return [];
}
function dedupeFlags(flags) {
    const seen = new Set();
    const out = [];
    for (const f of flags) {
        const key = `${f.flagType}:${f.originalPhrase.toLowerCase()}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        out.push(f);
    }
    return out;
}
function runHumanProof(input, options = {}) {
    const text = String(input.text || '');
    const rules = mergeRules(options.extraRules);
    const resumeFacts = resolveResumeFacts(input);
    const roleFamily = inferRoleFamily({
        roleFamily: input.roleFamily,
        jobTitle: input.jobTitle,
        resumeFacts,
        jobFacts: input.jobFacts,
        text,
    });
    const mode = input.mode || 'resume';
    const scoreCtx = { resumeFacts, jobFacts: input.jobFacts, roleFamily, rules, evidenceText: String(input.resumeText || '') };
    // ── 1. Detect (on the ORIGINAL text) ──
    const slopFlags = detectAiSlop(text, rules);
    const buzzFlags = detectBuzzwords(text, rules);
    const rep = detectRepetition(text);
    // The user's own résumé text grounds numbers and tools: anything written in it is theirs.
    const evidenceText = scoreCtx.evidenceText;
    const over = detectOverclaiming(text, resumeFacts, { evidenceText });
    const ir = detectInterviewRisk(text, resumeFacts, evidenceText);
    const flags = dedupeFlags([
        ...slopFlags,
        ...buzzFlags,
        ...rep.flags,
        ...over.flags,
        ...ir.flags,
    ]);
    // ── 2. Score the original (before) ──
    const beforeBreakdown = scoreHumanSignal(text, scoreCtx);
    const beforeExplained = explainHumanProof(beforeBreakdown);
    // ── 3. Humanize ──
    const changes = [];
    const safeBullets = [];
    let humanizedText;
    // Unsupported claims must never survive into the deliverable — strip them everywhere
    // and surface them under confirm_before_using instead. (Computed once on the input.)
    const unsupported = { metrics: over.unsupportedMetrics, tools: over.unsupportedTools };
    const hasUnsupported = unsupported.metrics.length > 0 || unsupported.tools.length > 0;
    if (mode === 'message') {
        const r = humanizeApplicationMessage(text, { rules, roleFamily, resumeFacts });
        let t = r.text;
        for (const c of r.changes)
            changes.push(c);
        if (hasUnsupported) {
            const stripped = stripUnsupportedClaims(t, unsupported);
            t = stripped.text;
            for (const c of stripped.changes)
                changes.push(c);
        }
        humanizedText = t;
    }
    else {
        // Résumé mode. A whole résumé is read into its structure first (resumeLines.js): only
        // experience bullets (joined across their wrapped lines) and the summary paragraph are
        // rewritten; the name, contact lines, headings, role/date lines, skills, education and
        // certifications are returned verbatim, line for line.
        const seg = segmentResume(text);
        const bullets = splitBullets(text);
        const humanizeUnit = (body, asSummary) => {
            const r = asSummary
                ? humanizeSummary(body, { rules, roleFamily, resumeFacts })
                : humanizeBullet(body, { rules, roleFamily, resumeFacts, jobFacts: input.jobFacts });
            let t = r.text;
            const unitChanges = [...r.changes];
            if (hasUnsupported) {
                const stripped = stripUnsupportedClaims(t, unsupported);
                t = stripped.text;
                unitChanges.push(...stripped.changes);
            }
            return { text: t, changes: t !== body ? unitChanges : [], evidenceUsed: r.evidenceUsed || [] };
        };
        if (seg.structured) {
            const outLines = [];
            for (const u of seg.units) {
                if (!rewritable(u)) {
                    outLines.push(...u.lines);
                    continue;
                }
                const r = humanizeUnit(u.body, u.kind === 'prose');
                changes.push(...r.changes);
                if (r.text === u.body) outLines.push(...u.lines);
                else outLines.push(`${u.prefix || ''}${r.text}`);
                safeBullets.push({ text: r.text, evidenceUsed: r.evidenceUsed, replaced: r.text !== u.body ? u.body : null });
            }
            humanizedText = outLines.join('\n');
        }
        else if (bullets.length <= 1) {
            // Treat as a summary paragraph if it's one block.
            const r = humanizeUnit(text, true);
            changes.push(...r.changes);
            humanizedText = r.text;
            if (r.text.trim())
                safeBullets.push({ text: r.text, evidenceUsed: [], replaced: r.text !== text ? text : null });
        }
        else {
            const outLines = [];
            for (const b of bullets) {
                const r = humanizeUnit(b, false);
                changes.push(...r.changes);
                outLines.push(r.text);
                safeBullets.push({ text: r.text, evidenceUsed: r.evidenceUsed, replaced: r.text !== b ? b : null });
            }
            humanizedText = outLines.join('\n');
        }
    }
    // ── 4. Confirm-before-using: every unsupported metric/tool becomes a confirm item.
    //     These are NEVER inserted into humanized_text — only surfaced for the user. ──
    const confirmBeforeUsing = [];
    for (const m of over.unsupportedMetrics) {
        confirmBeforeUsing.push({
            text: `The figure "${m}" — add the real number from your experience, or leave it out.`,
            reason: 'This number is not backed by your résumé. We will not invent it.',
            placeholder: m,
        });
    }
    for (const t of over.unsupportedTools) {
        confirmBeforeUsing.push({
            text: `The tool "${t}" — keep it only if you've genuinely used it.`,
            reason: 'This tool is not in your résumé facts. Only claim tools you can demonstrate.',
            placeholder: t,
        });
    }
    // ── 5. Integrity — what the "grounded" badge may claim. Every number the user wrote is kept
    //     exactly (only numbers the résumé does not back may be removed, and those are listed
    //     under confirm_before_using). The UI shows the badge only when both hold. ──
    const removedClaims = changes.filter((c) => c.to === '(moved to confirm-before-using)').map((c) => c.from);
    const integrity = {
        numbers_preserved: numbersIntact(text, humanizedText, removedClaims),
        unsupported_claims: over.unsupportedMetrics.length + over.unsupportedTools.length,
        grounded: false,
    };
    integrity.grounded = integrity.numbers_preserved && integrity.unsupported_claims === 0;
    // ── 6. Score the humanized text (after) ──
    const afterBreakdown = scoreHumanSignal(humanizedText, scoreCtx);
    const afterExplained = explainHumanProof(afterBreakdown);
    // The headline HumanProof Score reflects the humanized output (the deliverable).
    return {
        engine_version: HUMANPROOF_ENGINE_VERSION,
        humanproof_score: afterExplained.humanproof_score,
        ai_slop_risk: beforeExplained.ai_slop_risk, // risk describes the input you started with
        before_score: beforeExplained.humanproof_score,
        after_score: afterExplained.humanproof_score,
        flags,
        humanized_text: humanizedText,
        safe_bullets: safeBullets,
        confirm_before_using: confirmBeforeUsing,
        interview_risk_warnings: ir.warnings,
        changes_made: changes,
        integrity,
        explanation: {
            summary: afterExplained.summary,
            contributions: afterExplained.contributions,
            notes: afterExplained.notes,
        },
    };
}
export { BUILTIN_PHRASE_RULES, HUMANPROOF_ENGINE_VERSION };

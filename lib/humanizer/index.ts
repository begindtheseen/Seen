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

import {
  HUMANPROOF_ENGINE_VERSION,
  type HumanProofInput,
  type HumanProofOutput,
  type HumanProofFlag,
  type SafeBullet,
  type ConfirmBeforeUsing,
  type ChangeMade,
  type ResumeFact,
  type PhraseRiskRule,
} from './types.ts';
import { mergeRules, BUILTIN_PHRASE_RULES } from './phraseRisk.ts';
import { detectAiSlop } from './detectAiSlop.ts';
import { detectBuzzwords } from './detectBuzzwords.ts';
import { detectRepetition, splitBullets } from './detectRepetition.ts';
import { detectOverclaiming } from './detectOverclaiming.ts';
import { detectInterviewRisk } from './detectInterviewRisk.ts';
import { humanizeBullet, stripUnsupportedClaims } from './humanizeBullet.ts';
import { humanizeSummary } from './humanizeSummary.ts';
import { humanizeApplicationMessage } from './humanizeApplicationMessage.ts';
import { inferRoleFamily } from './roleDetails.ts';
import { scoreHumanSignal, type ScoreContext } from './scoreHumanSignal.ts';
import { explainHumanProof } from './explainHumanProof.ts';
import { extractResumeFacts } from '../optimizer/extractResumeFacts.ts';

export * from './types.ts';
export { runHumanProof };

export interface RunHumanProofOptions {
  // DB-loaded phrase_risk_rules merged over the built-ins (optional).
  extraRules?: PhraseRiskRule[] | null;
}

// Resolve the supported résumé facts from the richest source available:
//   explicit resumeFacts → optimizer output (re-extract isn't needed, but we accept
//   facts if passed) → extract from resumeText. With none, facts is [] and the engine
//   stays conservative (no false "unsupported" flags).
function resolveResumeFacts(input: HumanProofInput): ResumeFact[] {
  if (input.resumeFacts && input.resumeFacts.length) return input.resumeFacts;
  if (input.resumeText && input.resumeText.trim()) return extractResumeFacts(input.resumeText);
  return [];
}

function dedupeFlags(flags: HumanProofFlag[]): HumanProofFlag[] {
  const seen = new Set<string>();
  const out: HumanProofFlag[] = [];
  for (const f of flags) {
    const key = `${f.flagType}:${f.originalPhrase.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

function runHumanProof(input: HumanProofInput, options: RunHumanProofOptions = {}): HumanProofOutput {
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

  const scoreCtx: ScoreContext = { resumeFacts, jobFacts: input.jobFacts, roleFamily, rules };

  // ── 1. Detect (on the ORIGINAL text) ──
  const slopFlags = detectAiSlop(text, rules);
  const buzzFlags = detectBuzzwords(text, rules);
  const rep = detectRepetition(text);
  const over = detectOverclaiming(text, resumeFacts);
  const ir = detectInterviewRisk(text, resumeFacts);

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
  const changes: ChangeMade[] = [];
  const safeBullets: SafeBullet[] = [];
  let humanizedText: string;

  // Unsupported claims must never survive into the deliverable — strip them everywhere
  // and surface them under confirm_before_using instead. (Computed once on the input.)
  const unsupported = { metrics: over.unsupportedMetrics, tools: over.unsupportedTools };
  const hasUnsupported = unsupported.metrics.length > 0 || unsupported.tools.length > 0;

  if (mode === 'message') {
    const r = humanizeApplicationMessage(text, { rules, roleFamily, resumeFacts });
    let t = r.text;
    for (const c of r.changes) changes.push(c);
    if (hasUnsupported) {
      const stripped = stripUnsupportedClaims(t, unsupported);
      t = stripped.text;
      for (const c of stripped.changes) changes.push(c);
    }
    humanizedText = t;
  } else {
    // Résumé mode: humanize each bullet/line, keep them as safe bullets.
    const bullets = splitBullets(text);
    if (bullets.length <= 1) {
      // Treat as a summary paragraph if it's one block.
      const r = humanizeSummary(text, { rules, roleFamily, resumeFacts });
      let t = r.text;
      for (const c of r.changes) changes.push(c);
      if (hasUnsupported) {
        const stripped = stripUnsupportedClaims(t, unsupported);
        t = stripped.text;
        for (const c of stripped.changes) changes.push(c);
      }
      humanizedText = t;
      if (t.trim()) safeBullets.push({ text: t, evidenceUsed: [], replaced: r.changed || hasUnsupported ? text : null });
    } else {
      const outLines: string[] = [];
      for (const b of bullets) {
        const r = humanizeBullet(b, { rules, roleFamily, resumeFacts, jobFacts: input.jobFacts });
        let t = r.text;
        for (const c of r.changes) changes.push(c);
        if (hasUnsupported) {
          const stripped = stripUnsupportedClaims(t, unsupported);
          t = stripped.text;
          for (const c of stripped.changes) changes.push(c);
        }
        outLines.push(t);
        safeBullets.push({ text: t, evidenceUsed: r.evidenceUsed, replaced: r.changed || hasUnsupported ? b : null });
      }
      humanizedText = outLines.join('\n');
    }
  }

  // ── 4. Confirm-before-using: every unsupported metric/tool becomes a confirm item.
  //     These are NEVER inserted into humanized_text — only surfaced for the user. ──
  const confirmBeforeUsing: ConfirmBeforeUsing[] = [];
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

  // ── 5. Score the humanized text (after) ──
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
    explanation: {
      summary: afterExplained.summary,
      contributions: afterExplained.contributions,
      notes: afterExplained.notes,
    },
  };
}

export { BUILTIN_PHRASE_RULES, HUMANPROOF_ENGINE_VERSION };

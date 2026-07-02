// SeenFit → HumanProof chaining (pure, deterministic, keyless).
//
// Given an OPTIMIZED PACKAGE from SeenFit — a list of optimized bullets, an optional
// application message, and any warnings SeenFit already raised — this runs each item through
// the HumanProof engine and returns a humanized package with per-item human-signal scores.
//
// TRUTH CONTRACT:
//   • Operates on the OPTIMIZED text (not the raw résumé).
//   • Preserves truthfulness: HumanProof strips unsupported numbers/tools from the deliverable
//     and surfaces them under confirm_before_using — never silently kept, never invented.
//   • CARRIES THROUGH + RE-FLAGS unsupported-claim warnings: the caller's warnings are merged
//     with the warnings the engine re-detects; neither source is ever laundered away.
//   • Adds no specifics that aren't in evidence (guaranteed by the engine's humanizeBullet).
//
// This module makes NO external AI calls — it only calls lib/humanizer (local dictionaries +
// detectors + templates). api/optimizer.js wraps it with auth, feature flags, and persistence.

import { runHumanProof, HUMANPROOF_ENGINE_VERSION } from '../humanizer/index.ts';

// A bullet may arrive as a plain string or a SeenFit bullet object
// ({optimized}|{text}|{original}|{humanized}). Normalize to non-empty strings.
export function normalizeBulletList(bullets) {
  if (!Array.isArray(bullets)) return [];
  const out = [];
  for (const b of bullets) {
    let s = '';
    if (typeof b === 'string') s = b;
    else if (b && typeof b === 'object') s = b.optimized || b.humanized || b.text || b.original || '';
    s = String(s || '').trim();
    if (s) out.push(s);
  }
  return out;
}

// Normalize caller-supplied warnings to a stable { phrase, warning } shape. Preserved
// VERBATIM downstream — we never drop a caller warning.
export function normalizeWarnings(warnings) {
  if (!Array.isArray(warnings)) return [];
  const out = [];
  for (const w of warnings) {
    if (typeof w === 'string') { out.push({ phrase: '', warning: w }); continue; }
    if (w && typeof w === 'object') {
      out.push({
        phrase: String(w.phrase || w.placeholder || w.originalPhrase || '').trim(),
        warning: String(w.warning || w.reason || w.text || w.explanation || '').trim(),
      });
    }
  }
  return out.filter((w) => w.warning || w.phrase);
}

// Union the caller's carried warnings with the warnings the engine re-detected in the
// optimized text (unsupported metrics/tools surfaced as confirm_before_using). Deduped by
// phrase+warning — neither source is ever silently laundered away.
export function mergeCarriedWarnings(carried, engineConfirms) {
  const seen = new Set();
  const out = [];
  const push = (phrase, warning) => {
    const key = `${String(phrase || '').toLowerCase()}::${String(warning || '').toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ phrase: phrase || '', warning: warning || '' });
  };
  for (const w of carried || []) push(w.phrase, w.warning);
  for (const c of engineConfirms || []) push(c.placeholder || '', c.reason || c.text || '');
  return out;
}

// Dedupe HumanProof flags by type + original phrase (they aggregate across many bullets).
export function dedupeHpFlags(flags) {
  const seen = new Set();
  const out = [];
  for (const f of flags || []) {
    if (!f) continue;
    const key = `${f.flagType}:${String(f.originalPhrase || '').toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

function avg(nums) {
  const xs = (nums || []).filter((n) => typeof n === 'number' && !Number.isNaN(n));
  if (!xs.length) return 0;
  return Math.round(xs.reduce((s, n) => s + n, 0) / xs.length);
}

// Worst (highest) risk across items — the package is only as safe as its riskiest bullet.
function worstRisk(risks) {
  const order = { low: 0, medium: 1, high: 2 };
  let worst = 'low';
  for (const r of risks || []) {
    if ((order[r] ?? 0) > order[worst]) worst = r;
  }
  return worst;
}

function humanizeItem(text, mode, hpBase, options) {
  const out = runHumanProof({ ...hpBase, text: String(text), mode }, options);
  return {
    original: String(text),
    humanized_text: out.humanized_text,
    human_signal: out.humanproof_score, // per-item HumanProof (human-signal) score
    before_score: out.before_score,
    after_score: out.after_score,
    ai_slop_risk: out.ai_slop_risk,
    flags: out.flags,
    // Unsupported claims the humanizer re-detected in THIS item — never laundered away;
    // stripped from humanized_text and surfaced here for the user to confirm.
    confirm_before_using: out.confirm_before_using,
    interview_risk_warnings: out.interview_risk_warnings,
    changes_made: out.changes_made,
  };
}

// Build the humanized package. `input` carries the optimized package plus shared HumanProof
// context (roleFamily/jobTitle/company/resumeText/jobFacts/optimizerOutput). `options.extraRules`
// are DB-loaded phrase rules. Returns the package + aggregates + persistence helpers.
export function buildHumanProofPackage(input, options = {}) {
  const {
    bullets = [],
    applicationMessage = null,
    warnings = null,
    ...hpBaseRaw
  } = input || {};

  const hpBase = {
    roleFamily: hpBaseRaw.roleFamily || null,
    jobTitle: hpBaseRaw.jobTitle,
    company: hpBaseRaw.company,
    resumeText: hpBaseRaw.resumeText || '',
    jobFacts: hpBaseRaw.jobFacts || undefined,
    optimizerOutput: hpBaseRaw.optimizerOutput || null,
  };

  const bulletList = normalizeBulletList(bullets);
  const items = bulletList.map((b) => humanizeItem(b, 'resume', hpBase, options));

  let messageOut = null;
  if (typeof applicationMessage === 'string' && applicationMessage.trim()) {
    messageOut = humanizeItem(applicationMessage, 'message', hpBase, options);
  }

  const allOutputs = [...items, ...(messageOut ? [messageOut] : [])];
  const allFlags = dedupeHpFlags(allOutputs.flatMap((i) => i.flags || []));
  const engineConfirms = allOutputs.flatMap((i) => i.confirm_before_using || []);
  const carriedForward = mergeCarriedWarnings(normalizeWarnings(warnings), engineConfirms);
  const scores = allOutputs.map((i) => i.human_signal);

  const pkg = {
    bullets: items,
    application_message: messageOut,
    carried_warnings: carriedForward,
    flags: allFlags,
  };

  return {
    package: pkg,
    humanproof_score: avg(scores),
    before_score: avg(allOutputs.map((i) => i.before_score)),
    after_score: avg(allOutputs.map((i) => i.after_score)),
    ai_slop_risk: worstRisk(allOutputs.map((i) => i.ai_slop_risk)),
    flags: allFlags,
    engine_version: HUMANPROOF_ENGINE_VERSION,
    // For aggregate persistence by the caller.
    _originalJoined: allOutputs.map((i) => i.original).join('\n').slice(0, 20000),
    _humanizedJoined: allOutputs.map((i) => i.humanized_text).join('\n'),
  };
}

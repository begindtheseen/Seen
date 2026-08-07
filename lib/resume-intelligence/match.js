// Resume Intelligence Engine — PROGRESSIVE MATCHER + EVIDENCE + FABRICATION FIREWALL (Phases 7–9).
//
// For each JobProfile requirement, run the cheapest-first ladder and STOP at the first tier that
// fires, so every judgment is explainable and fast:
//   1. EXACT_MATCH       — the exact canonical concept is in the résumé (proven span)
//   2. ALIAS_MATCH       — present under a different alias (same concept)
//   3. TAXONOMY_MATCH    — a related concept (broader/narrower/associated) is present
//   4. TRANSFERABLE_MATCH— indicator verbs/nouns in résumé evidence imply the concept
//   5. SEMANTIC_MATCH    — lexical/embedding similarity of the requirement to an evidence sentence
//   6. PARTIAL_MATCH     — present but under-met (fewer years than required)
//   7. WEAK_EVIDENCE     — the token appears but isn't demonstrated
//   8. MISSING           — no evidence
//
// FABRICATION FIREWALL (the most important rule): a CREDENTIAL, LICENSE, DEGREE, or hard eligibility
// GATE can ONLY be satisfied by an EXACT/ALIAS match. Taxonomy/transferable/semantic evidence is
// REFUSED for those — warehouse work never "implies" a forklift certification; similar duties never
// imply a CDL. Missing ones stay MISSING and are marked mustNotInvent so nothing downstream can
// present them as held. Pure + deterministic (the semantic tier is deterministic unless a neural
// backend is registered). NO AI required.

import { relatedConcepts, getConcept, resolveConcept, normSurface } from './taxonomy.js';
import { evidenceForConcept, lexicalSimilarity } from './semantic.js';

export const MATCH = {
  EXACT: 'EXACT_MATCH', ALIAS: 'ALIAS_MATCH', TAXONOMY: 'TAXONOMY_MATCH',
  TRANSFERABLE: 'TRANSFERABLE_MATCH', SEMANTIC: 'SEMANTIC_MATCH', PARTIAL: 'PARTIAL_MATCH',
  WEAK: 'WEAK_EVIDENCE', MISSING: 'MISSING',
};
const QUALITY = { EXACT_MATCH: 1, ALIAS_MATCH: 0.95, TAXONOMY_MATCH: 0.7, TRANSFERABLE_MATCH: 0.6, SEMANTIC_MATCH: 0.5, PARTIAL_MATCH: 0.5, WEAK_EVIDENCE: 0.25, MISSING: 0 };

// Categories that must be PROVEN by name, never inferred. The fabrication firewall.
const HARD_PROOF_ONLY = new Set(['credential', 'education']);
const SEMANTIC_THRESHOLD = 0.34;

// Largest "N years" figure anywhere in the résumé (for years-based partial matching).
function resumeMaxYears(text) {
  let best = 0, m;
  const re = /(\d{1,2})\s*\+?\s*(?:years?|yrs?)\b/gi;
  while ((m = re.exec(text)) !== null) { const n = parseInt(m[1], 10); if (n >= 1 && n <= 40 && n > best) best = n; }
  return best;
}

function finalize(req, matchType, confidence, evidence, explanation, extra = {}) {
  return {
    requirementId: req.id,
    requirement: req.displayName,
    canonicalConcept: req.canonicalConcept || null,
    category: req.category,
    requirementLevel: req.requirementLevel,
    importance: req.importance,
    matchType,
    quality: QUALITY[matchType] ?? 0,
    confidence: Number(confidence.toFixed(2)),
    evidence: (Array.isArray(evidence) ? evidence : [evidence]).filter((e) => e && typeof e === 'string' && e.length > 0).map((e) => e.slice(0, 200)),
    explanation,
    ...extra,
  };
}

// Does the résumé explicitly contain concept `id` (exact/alias)? Returns the proving span or null.
function explicitSpan(id, resume) {
  const c = resume.concepts?.[id];
  return c ? (c.evidence?.[0] || null) : null;
}

// Match ONE requirement against the résumé, cheapest tier first.
export function matchRequirement(req, resume) {
  const concept = req.canonicalConcept;
  const hardProof = HARD_PROOF_ONLY.has(req.category);
  const evText = resume.evidenceText || '';

  // 1/2. EXACT / ALIAS — the concept (or its open-vocab label) is explicitly present.
  if (concept && resume.concepts?.[concept]) {
    const span = explicitSpan(concept, resume);
    return finalize(req, MATCH.EXACT, 0.95, [span], `Your résumé directly shows "${req.displayName}".`);
  }
  // open-vocab requirement (no canonical concept): verbatim presence in evidence or skills.
  if (!concept) {
    const norm = normSurface(req.displayName);
    if (norm.length >= 3) {
      const boundary = new RegExp('\\b' + norm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');
      const hit = resume.evidenceSentences?.find((s) => boundary.test(normSurface(s)))
        || (resume.skills || []).map((s) => s.surface).find((s) => boundary.test(normSurface(s)));
      if (hit) return finalize(req, MATCH.EXACT, 0.9, [hit], `Your résumé names "${req.displayName}".`);
    }
  }

  // ── FABRICATION FIREWALL ──────────────────────────────────────────────────
  // Beyond this point only inference tiers remain. A credential/degree cannot be inferred. But a
  // BASIC GATE (18+/21+, HS diploma, work authorization) is near-universal and usually just
  // unstated — flag it recoverable (add it if true), never fatal, and never fabricated. A genuine
  // professional credential (CDL, forklift cert, RN license, clearance) missing IS fatal.
  if (hardProof) {
    const basicGate = /\b18\+|\b21\+|high school|\bged\b|diploma|work authorization|authorized to work|eligible to work/i.test(req.displayName);
    const sev = basicGate ? 'recoverable' : (req.requirementLevel === 'REQUIRED' ? 'fatal' : 'risky');
    return finalize(req, MATCH.MISSING, 0, [], `"${req.displayName}" must be proven explicitly — it can’t be inferred from similar work.`, { missSeverity: sev, mustNotInvent: true });
  }

  // 3. TAXONOMY — a related concept is explicitly present.
  if (concept) {
    let best = null;
    for (const rel of relatedConcepts(concept)) {
      if (resume.concepts?.[rel.to]) {
        if (!best || rel.weight > best.weight) best = { ...rel, span: explicitSpan(rel.to, resume), display: getConcept(rel.to)?.display || rel.to };
      }
    }
    if (best && best.weight >= 0.5) {
      const conf = Math.min(0.85, 0.5 + best.weight * 0.35);
      return finalize(req, MATCH.TAXONOMY, conf, [best.span], `Your "${best.display}" is ${best.kind === 'associated' ? 'closely related to' : best.kind + ' than'} "${req.displayName}".`);
    }
  }

  // 4. TRANSFERABLE — indicator verbs/nouns in the résumé imply the concept (no model needed).
  if (concept) {
    const ev = evidenceForConcept(concept, evText);
    if (ev.score > 0) {
      const sentence = resume.evidenceSentences?.find((s) => ev.matched.some((t) => s.toLowerCase().includes(t.split(' ')[0]))) || evText.slice(0, 120);
      return finalize(req, MATCH.TRANSFERABLE, Math.min(0.9, 0.4 + ev.score * 0.5), [sentence], `Your experience shows evidence of "${req.displayName}" (matched on: ${ev.matched.slice(0, 4).join(', ')}).`, { matchedIndicators: ev.matched });
    }
  }

  // 5. SEMANTIC — best lexical/embedding similarity of the requirement to any evidence sentence.
  {
    const target = req.displayName;
    let bestSim = 0, bestSent = null;
    for (const s of resume.evidenceSentences || []) {
      const sim = lexicalSimilarity(target, s);
      if (sim > bestSim) { bestSim = sim; bestSent = s; }
    }
    if (bestSim >= SEMANTIC_THRESHOLD && bestSent) {
      return finalize(req, MATCH.SEMANTIC, Math.min(0.75, 0.4 + bestSim * 0.4), [bestSent], `Your résumé describes work similar to "${req.displayName}".`);
    }
  }

  // 6. PARTIAL — years-based under-match.
  if (req.category === 'experience' && req.requiredYears) {
    const have = resumeMaxYears(evText);
    if (have > 0 && have < req.requiredYears) {
      return finalize(req, MATCH.PARTIAL, 0.5, [`${have}+ years shown`], `You show ${have}+ years; this asks for ${req.requiredYears}+. Real, but under the stated bar — never inflate it.`, { missSeverity: 'recoverable' });
    }
    if (have >= req.requiredYears) return finalize(req, MATCH.EXACT, 0.85, [`${have}+ years shown`], `You meet the ${req.requiredYears}+ years requirement.`);
  }

  // 7. WEAK — the concept token appears somewhere but isn't demonstrated.
  if (concept) {
    const c = getConcept(concept);
    const surfaces = [c?.display, ...(c?.aliases || [])].filter(Boolean).map(normSurface);
    if (surfaces.some((s) => s && evText.includes(s))) {
      return finalize(req, MATCH.WEAK, 0.3, [], `"${req.displayName}" is mentioned but not clearly demonstrated with detail.`, { missSeverity: 'recoverable' });
    }
  }

  // 8. MISSING.
  const sev = req.requirementLevel === 'REQUIRED' ? (req.category === 'credential' ? 'fatal' : 'risky') : 'recoverable';
  return finalize(req, MATCH.MISSING, 0, [], `No résumé evidence found for "${req.displayName}".`, { missSeverity: sev });
}

// Match every requirement; bucket the results. Responsibilities are context, never a gap.
export function matchAll(jobProfile, resumeProfile) {
  const matches = (jobProfile.requirements || [])
    .filter((r) => r.requirementLevel !== 'CONTEXTUAL' || r.canonicalConcept) // keep concept context for "why you match"
    .map((r) => matchRequirement(r, resumeProfile));

  const isMatched = (m) => ['EXACT_MATCH', 'ALIAS_MATCH', 'TAXONOMY_MATCH'].includes(m.matchType);
  const isTransferable = (m) => ['TRANSFERABLE_MATCH', 'SEMANTIC_MATCH'].includes(m.matchType);
  const isGap = (m) => m.matchType === 'MISSING' && m.requirementLevel !== 'CONTEXTUAL';

  return {
    matches,
    strongMatches: matches.filter(isMatched),
    transferableMatches: matches.filter(isTransferable),
    partialMatches: matches.filter((m) => m.matchType === 'PARTIAL_MATCH'),
    weakEvidence: matches.filter((m) => m.matchType === 'WEAK_EVIDENCE'),
    missingRequirements: matches.filter((m) => isGap(m) && m.missSeverity !== 'recoverable'),
    missingRecoverable: matches.filter((m) => isGap(m) && m.missSeverity === 'recoverable'),
    criticalMissing: matches.filter((m) => isGap(m) && m.missSeverity === 'fatal'),
  };
}

export { QUALITY };

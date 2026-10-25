// SeenFit compatibility adapters.
//
// The SeenFit Engine (lib/optimizer/*) is the CANONICAL, deterministic, keyless résumé
// optimizer. These adapters run that one pipeline and reshape its output into the LEGACY
// response shapes that /api/resume's `scanner` and `optimize` tools have always returned, so
// the existing UI (app/resume/page.tsx scanner view, components/ApplyOptimizeModal) keeps
// working with no client change.
//
// HONESTY CONTRACT (mirrors generateSafeBullets' anti-hallucination guarantee):
//   • Every rewritten/optimized bullet's `original` is a REAL résumé evidence span — the
//     `improved`/`optimized` text is a safe bullet grounded in that span. We never invent a
//     skill, number, tool, or claim. Where the old shape wanted a field SeenFit doesn't
//     produce, we derive it deterministically or return an honest empty — never fabricate.

import { runOptimizer } from '../optimizer/index.js';
import { keywordKey, uniqueKeywords, withoutKeywords, isSubstantiveRewrite, rewriteIsGrounded } from '../optimizer/rewriteGuard.js';

// Clamp a 0–100 score to the believable, non-zero display band the old UI expects.
function clampScore(n) {
  return Math.max(8, Math.min(98, Math.round(Number(n) || 0)));
}

// All job skill requirements (matched + unsupported), highest-weight first, deduped by
// surface. This is the JD's priority list the old `optimize` tool surfaced.
function jobPriorities(out, limit = 6) {
  const reqs = [...(out.matched_requirements || []), ...(out.unsupported_requirements || [])];
  reqs.sort((a, b) => (b.weight || 0) - (a.weight || 0));
  return uniqueKeywords(reqs.map((m) => (m.surface || '').trim())).slice(0, limit);
}

// The requirement surface a safe bullet addresses. Safe bullets carry the résumé evidence
// span they draw from; we pair back to the matched requirement that shares that evidence
// (deterministic), falling back to positional order, then the priority list.
function addressFor(bullet, out, orderedMatches, idx, fallbackList) {
  const ev = (bullet.evidenceUsed || [])[0];
  if (ev) {
    const m = (out.matched_requirements || []).find((r) => r.evidence === ev);
    if (m && m.surface) return m.surface;
  }
  if (orderedMatches[idx] && orderedMatches[idx].surface) return orderedMatches[idx].surface;
  return fallbackList[idx % (fallbackList.length || 1)] || fallbackList[0] || 'the core requirement';
}

// Strong (present) keywords = the JD skill requirements the résumé actually matches.
function strongKeywords(out, limit = 12) {
  return uniqueKeywords((out.matched_requirements || []).map((m) => (m.surface || '').trim())).slice(0, limit);
}

// Missing keywords the person can act on: the posting's words the résumé does not state. A
// requirement the résumé states directly or by alias ("cashier" via "POS") is NEVER also
// "missing" — matched ∩ missing = ∅ by construction; case/plural variants are one keyword
// (keywordKey). A related-only match ("communication" inferred from customer service) is a
// transferable claim, not the résumé's words, so it stays listed as "add only if true". The
// literal-wording side of a direct match is reported separately as `wording_notes`.
function missingKeywords(out, limit) {
  const matched = (out.matched_requirements || []).filter((m) => m.via !== 'related').map((m) => m.surface || '');
  return uniqueKeywords(withoutKeywords(out.missing_keywords || [], matched)).slice(0, limit);
}

// One plain sentence per wording gap, deduped by keyword.
function wordingNotes(out) {
  const seen = new Set();
  const notes = [];
  for (const g of out.wording_gaps || []) {
    const key = keywordKey(g.keyword);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    notes.push(`Your résumé says “${g.resumeSays}”; the posting says “${g.keyword}”. An ATS word search may not connect them — use the posting's word only if it is true for you.`);
  }
  return notes;
}

// Deterministic ghost-risk advice line. Uses the company-intel note when we have data on the
// company (only Seen has it); otherwise a safe generic timing tip. Mirrors the old scanner.
function ghostRiskNote(intelNote) {
  return intelNote
    ? `${intelNote} To avoid being ghosted here, apply in the first 48 hours and secure a referral or a direct note to the hiring manager — referred candidates skip the cold pile this company tends to ghost.`
    : 'Apply within the first 48 hours, then follow up once after 7 days. If you have no response by day 14, treat it as a likely ghost and prioritise other applications rather than waiting.';
}

// Run the canonical SeenFit pipeline once. Keyless: no jobId/DB/taxonomy overrides here — the
// engine falls back to the built-in taxonomy and a neutral (null) company process score.
function runSeenFit({ resume, jobDescription, job, company, taxonomy = null, fit = null }) {
  return runOptimizer({
    ...(fit || {}),
    resumeText: String(resume || ''),
    jobTitle: job || undefined,
    company: company || undefined,
    jobDescription: jobDescription || '',
  }, { taxonomy: taxonomy || undefined });
}

// ── scanner (legacy shape) ← SeenFit ─────────────────────────────────────────────────────
// Old shape: { match_score, score_summary, missing_keywords[], strong_keywords[],
//             specific_fixes[{current, improved, note?, unchanged?}], ghost_risk_note }
export function scannerFromSeenFit({ resume, jobDescription, job, company, intelNote }) {
  const out = runSeenFit({ resume, jobDescription, job, company });

  const missing_keywords = missingKeywords(out, 12);
  const strong_keywords = strongKeywords(out);
  const priorities = jobPriorities(out);

  // specific_fixes: each SeenFit safe bullet becomes a before→after fix. `current` is a REAL
  // résumé line (the evidence span); `improved` is the safe, grounded bullet.
  const specific_fixes = [];
  const confirm = out.confirm_before_using || [];
  const seenFix = new Set();
  for (const b of out.safe_bullets || []) {
    const current = (b.evidenceUsed || [])[0] || '';
    if (!current) continue;
    const key = `${current.trim().toLowerCase()}→${String(b.text || '').trim().toLowerCase()}`;
    if (seenFix.has(key)) continue;
    seenFix.add(key);
    specific_fixes.push({ current, improved: b.text });
  }
  // When the résumé has no measurable numbers, surface ONE confirm-before-using suggestion as
  // guidance (clearly a recommendation — never a fabricated rewrite).
  if (confirm.length) {
    specific_fixes.push({
      current: '(Make one bullet measurable)',
      improved: confirm[0].text,
      note: confirm[0].reason,
    });
  }
  // No rewritable evidence but keywords are missing → additive guidance (mirrors the old
  // fallback). Honest: clearly a "write a new bullet" recommendation, not a fake rewrite.
  if (specific_fixes.length === 0 && missing_keywords.length) {
    specific_fixes.push({
      current: '(No bullet directly demonstrates the role’s core requirements.)',
      improved: '(No safe automatic rewrite — add a new bullet below.)',
      note: `Add a bullet describing real work that maps to "${missing_keywords[0]}", and attach a number (%, $, count, or timeframe) to it. Only include the term if it reflects something you actually did.`,
    });
  }

  return {
    // null when too few requirements were read to measure anything (the verdict says why)
    match_score: out.fit_score == null ? null : clampScore(out.fit_score),
    score_summary: (out.explanation && out.explanation.summary) || '',
    missing_keywords,
    strong_keywords,
    specific_fixes,
    ghost_risk_note: ghostRiskNote(intelNote),
    // Additive, non-breaking: expose the canonical engine + fit score for callers that want it.
    _engine: out.engine_version,
    _seenfit_score: out.fit_score,
    verdict: out.verdict,
  };
}

// ── optimize (legacy shape) ← SeenFit ────────────────────────────────────────────────────
// Old shape: { job_priorities[], optimized_bullets[{original, optimized, addresses}],
//             keywords_added[], stealth? }
export function optimizeFromSeenFit({ resume, jobDescription, job, company, pro, taxonomy = null, fit = null }) {
  const out = runSeenFit({ resume, jobDescription, job, company, taxonomy, fit });

  const job_priorities = jobPriorities(out);
  const keywords_added = missingKeywords(out, 8);
  const wording_notes = wordingNotes(out);

  // optimized_bullets from safe bullets. `original` is the REAL résumé evidence span; the
  // subset-of-résumé invariant is preserved (see optimizedBulletsAreGrounded).
  const orderedMatches = (out.matched_requirements || []).filter((m) => m.evidence);
  const optimized_bullets = [];
  const safe = out.safe_bullets || [];
  // One rewrite per source bullet and never the same rewrite twice: a before/after pair whose
  // `original` or `optimized` was already emitted is dropped (the live defect showed the same
  // "before" line twice with two templated "after"s).
  const seenOriginal = new Set();
  const seenOptimized = new Set();
  for (let i = 0; i < safe.length; i++) {
    const b = safe[i];
    const original = (b.evidenceUsed || [])[0] || '';
    if (!original) continue;
    const okey = original.trim().toLowerCase();
    const akey = String(b.text || '').trim().toLowerCase();
    if (!akey || seenOriginal.has(okey) || seenOptimized.has(akey)) continue;
    // Belt and braces at the API boundary: the generator already enforces both, but no rewrite
    // leaves this layer unless it changes words AND adds only words the résumé/posting contain.
    if (!isSubstantiveRewrite(original, b.text) || !rewriteIsGrounded(original, b.text, [resume, jobDescription])) continue;
    seenOriginal.add(okey);
    seenOptimized.add(akey);
    optimized_bullets.push({
      original,
      optimized: b.text,
      addresses: addressFor(b, out, orderedMatches, i, job_priorities),
    });
  }

  // No rewritable evidence → additive guidance, one per requirement the résumé does NOT meet
  // (asking for a new "sales" bullet when the résumé already proves sales was the old behaviour).
  if (optimized_bullets.length === 0) {
    const unmet = uniqueKeywords((out.unsupported_requirements || []).map((m) => (m.surface || '').trim()));
    for (const p of unmet.slice(0, 4)) {
      optimized_bullets.push({
        original: '(Add a bullet for this requirement.)',
        optimized: '(No existing bullet to rewrite — write a new one below.)',
        addresses: p,
      });
    }
  }

  // "keywords added" means a REAL rewritten bullet now carries the word — never the posting's
  // missing words (Maria's package claimed "merchandising, compliance" were added while every
  // bullet was a placeholder, 2026-10-25). The words still missing stay in keywords_missing.
  const real = optimized_bullets.filter((b) => !/^\(/.test(b.original) && !/^\(/.test(b.optimized));
  const has = (t, k) => new RegExp(`(?<![a-z0-9])${String(k).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9])`, 'i').test(String(t || ''));
  const keywordsCarried = keywords_added.filter((k) => real.some((b) => has(b.optimized, k) && !has(b.original, k)));
  const result = { job_priorities, optimized_bullets, keywords_added: keywordsCarried, keywords_missing: keywords_added, wording_notes };
  // Pro users get "Human Voice" baked in — same call, no extra credit. The API field keeps its
  // `stealth` name; the UI renders it as "Human Voice".
  if (pro) result.stealth = true;
  result._engine = out.engine_version;
  // The ONE score + its one-sentence why (lib/optimizer/explainScore buildVerdict). Never clamped:
  // the number on screen is the number in the sentence.
  result._seenfit_score = out.fit_score;
  result.verdict = out.verdict;
  return result;
}

// Test invariant: every optimized/rewritten bullet's `original` (excluding the clearly-marked
// additive "(…)" guidance templates) must be a literal substring of the résumé text. This
// carries generateSafeBullets' anti-hallucination guarantee through the compat wrapper.
export function optimizedBulletsAreGrounded(bullets, resumeText) {
  const hay = String(resumeText || '');
  for (const b of bullets || []) {
    const orig = String(b.original || '').trim();
    if (!orig || /^\(/.test(orig)) continue; // additive guidance template — not a claim
    if (!hay.includes(orig)) return false;
  }
  return true;
}

// Test invariant (the "nothing invented" guarantee, checked rather than promised): every real
// rewrite changes words and adds only tokens the résumé or the posting already contain.
export function optimizedRewritesAreGrounded(bullets, resumeText, jobDescription = '') {
  for (const b of bullets || []) {
    const orig = String(b.original || '').trim();
    if (!orig || /^\(/.test(orig)) continue;
    if (!isSubstantiveRewrite(orig, b.optimized)) return false;
    if (!rewriteIsGrounded(orig, b.optimized, [resumeText, jobDescription])) return false;
  }
  return true;
}

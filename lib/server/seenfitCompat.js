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

// Clamp a 0–100 score to the believable, non-zero display band the old UI expects.
function clampScore(n) {
  return Math.max(8, Math.min(98, Math.round(Number(n) || 0)));
}

// All job skill requirements (matched + unsupported), highest-weight first, deduped by
// surface. This is the JD's priority list the old `optimize` tool surfaced.
function jobPriorities(out, limit = 6) {
  const reqs = [...(out.matched_requirements || []), ...(out.unsupported_requirements || [])];
  reqs.sort((a, b) => (b.weight || 0) - (a.weight || 0));
  const seen = new Set();
  const list = [];
  for (const m of reqs) {
    const s = (m.surface || '').trim();
    if (!s || seen.has(s.toLowerCase())) continue;
    seen.add(s.toLowerCase());
    list.push(s);
  }
  return list.slice(0, limit);
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
  const seen = new Set();
  const list = [];
  for (const m of out.matched_requirements || []) {
    const s = (m.surface || '').trim();
    if (!s || seen.has(s.toLowerCase())) continue;
    seen.add(s.toLowerCase());
    list.push(s);
  }
  return list.slice(0, limit);
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
function runSeenFit({ resume, jobDescription, job, company }) {
  return runOptimizer({
    resumeText: String(resume || ''),
    jobTitle: job || undefined,
    company: company || undefined,
    jobDescription: jobDescription || '',
  });
}

// ── scanner (legacy shape) ← SeenFit ─────────────────────────────────────────────────────
// Old shape: { match_score, score_summary, missing_keywords[], strong_keywords[],
//             specific_fixes[{current, improved, note?, unchanged?}], ghost_risk_note }
export function scannerFromSeenFit({ resume, jobDescription, job, company, intelNote }) {
  const out = runSeenFit({ resume, jobDescription, job, company });

  const missing_keywords = (out.missing_keywords || []).slice(0, 12);
  const strong_keywords = strongKeywords(out);
  const priorities = jobPriorities(out);

  // specific_fixes: each SeenFit safe bullet becomes a before→after fix. `current` is a REAL
  // résumé line (the evidence span); `improved` is the safe, grounded bullet.
  const specific_fixes = [];
  const confirm = out.confirm_before_using || [];
  for (const b of out.safe_bullets || []) {
    const current = (b.evidenceUsed || [])[0] || '';
    if (!current) continue;
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
    match_score: clampScore(out.fit_score),
    score_summary: (out.explanation && out.explanation.summary) || '',
    missing_keywords,
    strong_keywords,
    specific_fixes,
    ghost_risk_note: ghostRiskNote(intelNote),
    // Additive, non-breaking: expose the canonical engine + fit score for callers that want it.
    _engine: out.engine_version,
    _seenfit_score: out.fit_score,
  };
}

// ── optimize (legacy shape) ← SeenFit ────────────────────────────────────────────────────
// Old shape: { job_priorities[], optimized_bullets[{original, optimized, addresses}],
//             keywords_added[], stealth? }
export function optimizeFromSeenFit({ resume, jobDescription, job, company, pro }) {
  const out = runSeenFit({ resume, jobDescription, job, company });

  const job_priorities = jobPriorities(out);
  const keywords_added = (out.missing_keywords || []).slice(0, 8);

  // optimized_bullets from safe bullets. `original` is the REAL résumé evidence span; the
  // subset-of-résumé invariant is preserved (see optimizedBulletsAreGrounded).
  const orderedMatches = (out.matched_requirements || []).filter((m) => m.evidence);
  const optimized_bullets = [];
  const safe = out.safe_bullets || [];
  for (let i = 0; i < safe.length; i++) {
    const b = safe[i];
    const original = (b.evidenceUsed || [])[0] || '';
    if (!original) continue;
    optimized_bullets.push({
      original,
      optimized: b.text,
      addresses: addressFor(b, out, orderedMatches, i, job_priorities),
    });
  }

  // No rewritable évidence → additive per-priority templates (mirrors the old fallback).
  if (optimized_bullets.length === 0) {
    for (const p of job_priorities.slice(0, 4)) {
      optimized_bullets.push({
        original: '(Add a bullet for this requirement.)',
        optimized: '(No existing bullet to rewrite — write a new one below.)',
        addresses: p,
      });
    }
  }

  const result = { job_priorities, optimized_bullets, keywords_added };
  // Pro users get "Human Voice" baked in — same call, no extra credit. The API field keeps its
  // `stealth` name; the UI renders it as "Human Voice".
  if (pro) result.stealth = true;
  result._engine = out.engine_version;
  result._seenfit_score = out.fit_score;
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

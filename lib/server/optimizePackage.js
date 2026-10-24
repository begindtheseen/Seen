// What the credit buys vs what is free (2026-10-24 résumé audit, C3: "the credit buys a
// deterministic rule engine that the same site gives away free, even to anonymous visitors").
//
//   FREE  (api/optimizer.js action:optimize, signed-out OK) — the diagnosis:
//         the ONE verdict (score or none, band, one sentence, the hard-gate line), the matched and
//         missing requirements with their evidence, the constraints checklist, the factor
//         breakdown. Nothing to copy into a résumé.
//   PAID  (api/resume.js tool:optimize, 1 credit, cached 7 days) — the work, a strict SUPERSET of
//         the free diagnosis: the rewrite plan (wording proposals from the Studio's own plan),
//         reorder proposals (which bullet should lead each role for THIS posting), answer-driven
//         bullets (the role-specific number questions, written up with bulletFromAnswer once the
//         person answers), the availability line built from the posting's schedule (R1), the
//         targeted summary, safe bullet improvements, wording notes and the application message.
//
// Every piece is grounded: rewrite proposals pass rewriteIsGrounded against the résumé + posting,
// the summary is the Studio's firewalled summary, the availability line and answer bullets are
// marked `needs_confirmation` because they become true only when the person says so. The plan is
// the same Tailor plan the Studio applies (ONE apply path) — nothing here post-processes a variant.
import { runOptimizer } from '../optimizer/index.js';
import { optimizeFromSeenFit } from './seenfitCompat.js';
import { rewriteIsGrounded, isSubstantiveRewrite } from '../optimizer/rewriteGuard.js';
import { parseResume } from '../resume/parse/index.js';
import { tailorResume, bulletFromAnswer } from '../resume/tailor/tailor.js';
import { buildApplicationPackage } from '../application-intelligence/index.js';

/** Fields that exist only in the PAID response. The free response must carry none of them. */
export const PAID_FIELDS = [
  'safe_bullets', 'confirm_before_using', 'wording_gaps', 'application_message',
  'application_intelligence', 'resume_intelligence',
  'optimized_bullets', 'keywords_added', 'wording_notes', 'rewrite_plan', 'reorder', 'questions',
  'availability', 'summary', 'paid',
];

/** The free diagnosis: the SeenFit output with every paid field removed. */
export function freeDiagnostic(out) {
  const free = {};
  for (const [k, v] of Object.entries(out || {})) if (!PAID_FIELDS.includes(k)) free[k] = v;
  free.tier = 'free';
  return free;
}

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// R1: one line under the header, built from the POSTING's schedule — the person confirms it.
function availabilityLine(constraints) {
  const sched = (constraints || []).filter((c) => c.kind === 'schedule');
  if (!sched.length) return null;
  const items = [...new Set(sched.flatMap((c) => (c.items && c.items.length ? c.items : [c.label])))];
  if (!items.length) return null;
  const kinds = items.filter((i) => /^(?:part|full)-time$|^seasonal$|^temporary$/.test(i));
  const rest = items.filter((i) => !kinds.includes(i));
  const text = `Availability: ${[...kinds.map(cap), ...rest].join(', ')}`.replace(/,\s*$/, '');
  const conflict = sched.find((c) => c.conflict) || null;
  return {
    text,
    items,
    needs_confirmation: true,
    why: 'Store managers screen on availability first. Add this under your header only if every part is true for you — edit it to match what you can actually work.',
    conflict: conflict ? conflict.message : null,
  };
}

// Which bullet should lead each kept role for this posting: the plan's own ranked order vs the
// résumé's order. A proposal to MOVE an existing bullet — no words change.
function reorderProposals(doc, plan) {
  const out = [];
  for (const d of plan.decisions || []) {
    if (d.decision !== 'keep' && d.decision !== 'trim') continue;
    const e = doc.experience.find((x) => x.id === d.itemId);
    if (!e || e.bullets.length < 2) continue;
    const first = (d.keptBullets || [])[0];
    if (!first || first === e.bullets[0].id) continue;
    const b = e.bullets.find((x) => x.id === first);
    if (!b) continue;
    out.push({
      itemId: e.id, role: e.title, company: e.company, bulletId: b.id, text: b.text, from: e.bullets.indexOf(b) + 1, to: 1,
      why: `For this posting, "${b.text.slice(0, 60)}${b.text.length > 60 ? '…' : ''}" is your strongest line at ${e.company || e.title} — move it to the top of that role.`,
    });
  }
  return out;
}

// The role-specific number questions (V2's questions_to_improve whose unit has an answer template),
// each pointed at the role it would strengthen; the client writes the bullet with bulletFromAnswer.
function numberQuestions(v2, doc) {
  const roles = doc.experience.map((e) => ({ itemId: e.id, title: e.title, company: e.company }));
  const qs = [];
  for (const q of (v2 && v2.questions_to_improve) || []) {
    if (!q.unit) continue;
    const sample = bulletFromAnswer({ unit: q.unit }, 'N');
    if (!sample || /^Delivered N\.$/.test(sample)) continue; // no template for this unit
    qs.push({ id: q.id, question: q.question, unit: q.unit, roles, template: sample.replace(/\bN\b/, '[your number]'), needs_confirmation: true });
  }
  return qs.slice(0, 4);
}

/**
 * The paid optimize package. Pure; no I/O.
 * @param {{ resume: string, jobDescription: string, job?: string, company?: string, pro?: boolean, jobId?: string }} input
 */
export function buildPaidOptimize({ resume, jobDescription, job, company, pro, jobId } = {}) {
  const legacy = optimizeFromSeenFit({ resume, jobDescription, job, company, pro });
  const out = runOptimizer({ resumeText: String(resume || ''), jobTitle: job || undefined, company: company || undefined, jobDescription: jobDescription || '' });
  const vocab = [String(resume || ''), String(jobDescription || '')];

  let doc = null;
  let plan = null;
  try {
    doc = parseResume({ text: String(resume || ''), source: 'text' });
    plan = tailorResume(doc, { jobTitle: job || '', company: company || '', jobDescription: jobDescription || '', jobId: jobId || '' }).plan;
  } catch { doc = null; plan = null; }
  let v2 = null;
  try { v2 = buildApplicationPackage({ resumeText: String(resume || ''), jobDescription: jobDescription || '', jobTitle: job || '', company: company || '' }); } catch { v2 = null; }

  // Wording proposals from the Studio plan — shown as before → after, never applied here.
  const rewrite_plan = ((plan && plan.rewrites) || [])
    .filter((r) => isSubstantiveRewrite(r.from, r.to) && rewriteIsGrounded(r.from, r.to, vocab))
    .map((r) => ({ bulletId: r.bulletId, from: r.from, to: r.to, rules: r.rules, accepted: false }));

  const summary = plan && plan.summary && plan.summary.text
    ? { text: plan.summary.text, replaces: plan.summary.replaced || '', needs_confirmation: false, why: 'Built only from your own titles, employers and bullets — every word is in your résumé.' }
    : null;

  return {
    ...legacy,
    tier: 'paid',
    // the free diagnosis, so the paid result is a strict superset of it
    fit_score: out.fit_score,
    fit_band: out.fit_band,
    verdict: out.verdict,
    hard_gates: out.hard_gates,
    constraints: out.constraints,
    matched_requirements: out.matched_requirements,
    unsupported_requirements: out.unsupported_requirements,
    requirement_count: out.requirement_count,
    // the work
    rewrite_plan,
    reorder: doc && plan ? reorderProposals(doc, plan) : [],
    questions: doc ? numberQuestions(v2, doc) : [],
    availability: availabilityLine(out.constraints),
    summary,
    application_message: out.application_message,
  };
}

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
  'optimized_bullets', 'keywords_added', 'keywords_missing', 'wording_notes', 'rewrite_plan', 'reorder', 'questions',
  'availability', 'summary', 'paid',
];

/**
 * Is there anything to optimize against? The paid optimizer measures a résumé against the
 * requirements a posting states; when the free diagnosis withholds a score (fewer than 3
 * requirements read — the verdict says "No score: this listing does not state its requirements")
 * there is nothing to optimize, so the credit must not be spent. A listing like that used to be
 * charged anyway (willingness-to-pay test, 2026-10-25). Pure; decided BEFORE gateAI.
 * @returns {null | { requirement_count: number, message: string }}
 */
export function unoptimizableListing({ resume, jobDescription, job, company, taxonomy = null } = {}) {
  const out = runOptimizer({ resumeText: String(resume || ''), jobTitle: job || undefined, company: company || undefined, jobDescription: jobDescription || '' }, { taxonomy: taxonomy || undefined });
  if (!out.verdict || !out.verdict.withheld) return null;
  const n = out.requirement_count || 0;
  return {
    requirement_count: n,
    message: n === 0
      ? "This listing doesn't list its requirements, so there's nothing to optimize against — no credit used."
      : `This listing states only ${n} requirement${n === 1 ? '' : 's'}, too few to optimize against — no credit used.`,
  };
}

/** The free diagnosis: the SeenFit output with every paid field removed. */
export function freeDiagnostic(out) {
  const free = {};
  for (const [k, v] of Object.entries(out || {})) if (!PAID_FIELDS.includes(k)) free[k] = v;
  free.tier = 'free';
  return free;
}


// R1: one line under the header, built from the POSTING's schedule — the person confirms it.
function availabilityLine(constraints) {
  const sched = (constraints || []).filter((c) => c.kind === 'schedule');
  if (!sched.length) return null;
  // an on-call rotation or travel is not the shift availability a store manager screens on (round 7, Dev: "Available:
  // on-call" offered to a backend engineer whose résumé already owned on-call)
  const items = [...new Set(sched.flatMap((c) => (c.items && c.items.length ? c.items : [c.label])))].filter((i) => !/\bon[- ]call\b|\btravel\b|\brotation\b/i.test(i));
  if (!items.length) return null;
  const kinds = items.filter((i) => /^(?:part|full)-time$|^seasonal$|^temporary$/.test(i));
  // "holidays" is implied by a holiday blackout window; say the window, not both
  const rest = items.filter((i) => !kinds.includes(i) && !(i === 'holidays' && items.some((x) => /blackout/.test(x))));
  if (!rest.length && !kinds.length) return null;
  const text = `Available: ${rest.join(', ') || 'flexible'}${kinds.length ? ` · open to ${kinds.join(' / ')} work` : ''}`;
  const conflict = sched.find((c) => c.conflict) || null;
  return {
    text,
    items,
    needs_confirmation: true,
    why: 'Store managers screen on availability first. Add this under your header only if every part is true for you — edit it to match what you can actually work.',
    conflict: conflict ? conflict.message : null,
  };
}

// A quote cut at a word, never inside a parenthesis ("…carrier webhooks (40+ ca…" read as broken).
function shortQuote(text, max = 70) {
  const t = String(text || '').replace(/[.;,]+$/, '');
  if (t.length <= max) return t;
  let cut = t.slice(0, max).replace(/\s+\S*$/, '');
  const open = cut.lastIndexOf('(');
  if (open > cut.lastIndexOf(')')) cut = cut.slice(0, open).trimEnd();
  return `${cut.replace(/[,;:\s]+$/, '')}…`;
}

// Which bullet should lead each kept role for this posting: the plan's own ranked order vs the
// résumé's order. A proposal to MOVE an existing bullet — no words change.
function reorderProposals(doc, plan) {
  const out = [];
  for (const d of plan.decisions || []) {
    if (d.decision !== 'keep' && d.decision !== 'trim') continue;
    // a role this posting does not need is not worth reordering (Tasha's barista role got the same
    // "move to the top" for a social-media and a CRM posting)
    if (d.tier !== 'core' && d.tier !== 'supporting') continue;
    const e = doc.experience.find((x) => x.id === d.itemId);
    if (!e || e.bullets.length < 2) continue;
    const first = (d.keptBullets || [])[0];
    if (!first || first === e.bullets[0].id) continue;
    const b = e.bullets.find((x) => x.id === first);
    if (!b) continue;
    // Only a CLEAR win is worth a move: the proposed bullet must use the posting's own words and
    // beat the current first line by a margin — a near-tie is not "your strongest line".
    const rankOf = (id) => (d.ranked || []).find((r) => r.bulletId === id) || null;
    const top = rankOf(b.id), cur = rankOf(e.bullets[0].id);
    if (!top || !(top.postingTerms || []).length) continue;
    if (cur && top.score - cur.score < 0.05) continue;
    out.push({
      itemId: e.id, role: e.title, company: e.company, bulletId: b.id, text: b.text, from: e.bullets.indexOf(b) + 1, to: 1,
      why: `For this posting, "${shortQuote(b.text)}" is your strongest line at ${e.company || e.title} — move it to the top of that role.`,
    });
  }
  return out;
}

// The role-specific number questions (V2's questions_to_improve whose unit has an answer template),
// each pointed at the role it would strengthen; the client writes the bullet with bulletFromAnswer.
// A question the résumé already answers is not asked: Maria was asked "How many transactions did
// you ring up per shift?" with "200+ transactions per shift" on her résumé (2026-10-25). The unit's
// first noun ("transactions") with a number within three words before it is an answer.
function alreadyAnswered(unit, resumeText) {
  const text = String(resumeText || '');
  const esc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // every noun of the unit ("customers or calls per shift" → customers, calls), not just the first
  const nouns = String(unit || '').toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 3 && !/^(?:per|and|the|for|with|from|each|every|your|day|days|week|weeks|month|months|year|years|shift|shifts|hour|hours)$/.test(w));
  const stems = nouns.map((w) => w.replace(/(?:es|s)$/, ''));
  if (stems.some((stem) => new RegExp(`\\d[\\d,.]*\\+?%?\\s+(?:[A-Za-z-]+\\s+){0,3}${esc(stem)}`, 'i').test(text))) return true;
  // a rate the résumé already states in the same measure ("200+ transactions per shift" answers "customers or
  // calls per shift"; "250+ pallets per shift" answers "orders per shift" — round 6, Maria and Ray)
  const per = String(unit || '').match(/\bper\s+(shift|day|week|month|hour|year|call|visit)\b/i);
  if (per && new RegExp(`\\d[\\d,.]*\\+?\\s+(?:[A-Za-z-]+\\s+){0,3}(?:per|a|an|each)\\s+${esc(per[1])}`, 'i').test(text)) return true;
  // a quality score the résumé already gives ("4.6/5", "78% to 91%", "99.6% accuracy")
  if (/\b(?:score|rating|satisfaction|accuracy|quality|csat|nps)\b/i.test(String(unit || '')) && /\b\d(?:\.\d)?\s*\/\s*5\b|\b\d{2,3}(?:\.\d)?%/.test(text)) return true;
  return false;
}

function numberQuestions(v2, doc, resumeText = '') {
  const roles = doc.experience.map((e) => ({ itemId: e.id, title: e.title, company: e.company }));
  const qs = [];
  for (const q of (v2 && v2.questions_to_improve) || []) {
    if (!q.unit) continue;
    if (alreadyAnswered(q.unit, resumeText)) continue;
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
export function buildPaidOptimize({ resume, jobDescription, job, company, pro, jobId, taxonomy = null, fit = null } = {}) {
  // `fit` = lib/server/fitContext.js — the same company/remote context the free check scores with
  const legacy = optimizeFromSeenFit({ resume, jobDescription, job, company, pro, taxonomy, fit });
  const out = runOptimizer({ ...(fit || {}), resumeText: String(resume || ''), jobTitle: job || undefined, company: company || undefined, jobDescription: jobDescription || '' }, { taxonomy: taxonomy || undefined });
  const vocab = [String(resume || ''), String(jobDescription || '')];

  let doc = null;
  let plan = null;
  try {
    doc = parseResume({ text: String(resume || ''), source: 'text' });
    plan = tailorResume(doc, { jobTitle: job || '', company: company || '', jobDescription: jobDescription || '', jobId: jobId || '', taxonomy, fit }).plan;
  } catch { doc = null; plan = null; }
  let v2 = null;
  try { v2 = buildApplicationPackage({ resumeText: String(resume || ''), jobDescription: jobDescription || '', jobTitle: job || '', company: company || '' }); } catch { v2 = null; }

  // Wording proposals from the Studio plan — shown as before → after, never applied here.
  const rewrite_plan = ((plan && plan.rewrites) || [])
    .filter((r) => isSubstantiveRewrite(r.from, r.to) && rewriteIsGrounded(r.from, r.to, vocab))
    .map((r) => ({ bulletId: r.bulletId, from: r.from, to: r.to, rules: r.rules, accepted: false }));

  // The person's own summary stays when it scores higher against this posting than a rewrite would
  // (lib/resume/tailor/tailor.js, round 5: a rewrite cost Maria a point) — said so, never a blank section.
  const ownSummary = doc && doc.basics && doc.basics.summary ? String(doc.basics.summary) : '';
  const summary = plan && plan.summary && plan.summary.text
    ? { text: plan.summary.text, replaces: plan.summary.replaced || '', needs_confirmation: false, why: 'Built only from your own titles, employers and bullets — every word is in your résumé.' }
    : plan && plan.summaryKept && ownSummary
      ? { text: ownSummary, replaces: '', needs_confirmation: false, kept: true, why: 'Your own summary scored higher against this posting than a rewritten one, so it stays as it is.' }
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
    questions: doc ? numberQuestions(v2, doc, resume) : [],
    availability: availabilityLine(out.constraints),
    summary,
    application_message: out.application_message,
  };
}

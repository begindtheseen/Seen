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
import { escapeRegExp } from '../text/escapeRegExp.js';
import { runOptimizer } from '../optimizer/index.js';
import { optimizeFromSeenFit } from './seenfitCompat.js';
import { rewriteIsGrounded, isSubstantiveRewrite } from '../optimizer/rewriteGuard.js';
import { parseResume } from '../resume/parse/index.js';
import { tailorResume, bulletFromAnswer } from '../resume/tailor/tailor.js';
import { renderText } from '../resume/render/text.js';
import { stemsCovered } from '../resume/tailor/verdict.js';
import { canonicalResumeText } from '../resume/canonical.js';
import { buildApplicationPackage } from '../application-intelligence/index.js';
import { buildTailored, screenStatements } from '../resume/tailor/paid.js';
import { composeApplicationMessage } from '../optimizer/generateApplicationMessage.js';
import { employerDisplayName } from '../text/employerName.js';
import { KNOWN_VERBS } from '../resume/health/verbs.js';
import { detectRoleFamily } from '../application-intelligence/roleOntology.js';

/** Fields that exist only in the PAID response. The free response must carry none of them. */
export const PAID_FIELDS = [
  'safe_bullets', 'confirm_before_using', 'wording_gaps', 'application_message',
  'application_intelligence', 'resume_intelligence',
  'optimized_bullets', 'keywords_added', 'keywords_missing', 'wording_notes', 'rewrite_plan', 'reorder', 'questions',
  'availability', 'summary', 'paid', 'tailored',
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
  // one count everywhere: the rows the screen lists (a refusal said "only 2 requirements" above a list of 1)
  const n = listedRequirements(out).length;
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
// an availability line is an hourly / shift-work convention: offered only when the posting is hourly or shift work and
// states a schedule it requires — never to a salaried professional for "occasional … weekend assignments" (round 2)
const HOURLY_FAMILIES = new Set(['retail', 'customer_service', 'food_service', 'hospitality', 'valet_parking', 'warehouse', 'delivery_logistics', 'security', 'healthcare_support', 'manufacturing']);
function availabilityLine(constraints, { jobTitle = '', employer = '', family = '' } = {}) {
  const titleFam = detectRoleFamily(String(jobTitle || '').replace(/\s*\([^)]*\)/g, '').replace(/\s+[-–—|,]\s.*$/, '')).family;
  const hourlyTitle = /\b(?:associate|cashier|crew|team member|server|cook|barista|driver|picker|packer|handler|clerk|attendant|technician|aide|caregiver|cna|shift|host|housekeep\w*|dishwasher|stocker|warehouse|line)\b/i.test(String(jobTitle || ''));
  if (!(HOURLY_FAMILIES.has(family) || HOURLY_FAMILIES.has(titleFam) || hourlyTitle)) return null;
  const sched = (constraints || []).filter((c) => c.kind === 'schedule' && c.importance !== 'preferred' && !/\b(?:occasional(?:ly)?|as needed|may be required|sometimes|from time to time)\b/i.test(String(c.posting_quote || c.evidence || '')));
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
    why: (() => {
      // the posting's own schedule line when it reads as a sentence; else what it asks for, by name
      const q = sched.map((c) => String(c.posting_quote || c.evidence || '').replace(/\s+/g, ' ').trim()).find((x) => /^[A-Za-z]/.test(x) && x.split(' ').length >= 4 && x.length <= 140);
      const job = jobTitle ? ` this ${String(jobTitle).replace(/\s*\([^)]*\)/g, '').replace(/\s*[-–—|,]\s.*$/, '').trim()} job` : ' this job';
      return `${employer || 'The employer'} ${q ? `says "${q.replace(/[.;:,]+$/, '')}" for${job}` : `asks for ${items.join(', ')} on${job}`}. Put "${text}" under your header only if every part of it is true for you.`;
    })(),
    conflict: conflict ? conflict.message : null,
  };
}

// Which line now leads each role, from the plan's own change list (the document already carries it).
function reorderFromChanges(changes) {
  const out = [];
  for (const c of changes || []) {
    if (c.type !== 'reorder') continue;
    const [role, company = ''] = String(c.where).split(' · ');
    for (const m of c.moved || []) if (m.to < m.from) out.push({ itemId: c.id.replace(/^reorder:/, ''), role, company, text: m.text, from: m.from, to: m.to, requirement: m.requirement, why: c.why, applied: true });
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
  const esc = (w) => escapeRegExp(w);
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

/** The posting's requirement rows as the screen lists them (one count everywhere). */
export function listedRequirements(out) {
  const seen = new Set();
  const rows = [];
  for (const m of [...((out && out.matched_requirements) || []), ...((out && out.unsupported_requirements) || [])]) {
    const k = String(m.surface || m.requirement || '').replace(/^term:/, '').toLowerCase().trim();
    if (!k || seen.has(k)) continue;
    seen.add(k); rows.push(m);
  }
  return rows;
}
/** ats_coverage over the SAME requirements the list shows: the share the résumé shows (a related or inferred match is
 * not shown). Replaces the keyword-set figure that printed "100% of keywords" above missing items. */
export function listedCoverage(out) {
  const rows = listedRequirements(out).filter((m) => !m.soft);
  if (!rows.length) return null;
  return Number((rows.filter((m) => m.matched && !m.inferred && m.via !== 'related').length / rows.length).toFixed(3));
}
/** Change counts for the probe: what the credit would buy, before it is spent. */
export function changeCounts(pkg) {
  const ch = (pkg && pkg.tailored && pkg.tailored.changes) || [];
  const applied = ch.filter((c) => c.default === 'applied');
  return {
    reorder: applied.filter((c) => c.type === 'reorder').reduce((n, c) => n + (c.moved || []).filter((m) => m.to < m.from).length, 0),
    summary: applied.some((c) => c.type === 'summary' && c.substantive) ? 1 : 0,
    skills: applied.filter((c) => c.type === 'skills').reduce((n, c) => n + ((c.added || []).length || 0), 0),
    rewrites: applied.filter((c) => c.type === 'rewrite').length,
    proposals: ch.filter((c) => c.default === 'needs_ok').length,
    questions: ((pkg && pkg.questions) || []).length,
    availability: pkg && pkg.availability ? 1 : 0,
    formatting: ch.some((c) => c.type === 'format') ? 1 : 0,
  };
}

/**
 * The paid optimize package. Pure; no I/O.
 * @param {{ resume: string, original?: string, jobDescription: string, job?: string, company?: string, pro?: boolean, jobId?: string, posting?: object }} input
 *   original — the text the person uploaded (before canonicalisation): every difference from it is listed in `changes`
 *   posting  — what was read: { title, company, source: 'listing'|'fetched'|'link'|'pasted', host }
 */
const safe = (fn, fallback) => { try { return fn(); } catch { return fallback; } };
/**
 * Un-crashable (round 3: a real RN résumé × RN posting threw inside the format diff): any failure degrades to "your
 * document kept as written", free, with the free diagnosis (the verdict) still returned.
 */
export function buildPaidOptimize(input = {}) {
  try { return buildPaidOptimizeUnsafe(input); } catch (err) {
    const resume = input.resumeIsCanonical ? String(input.resume || '') : safe(() => canonicalResumeText(String(input.resume || '')), String(input.resume || ''));
    const out = safe(() => runOptimizer({ ...(input.fit || {}), resumeText: resume, jobTitle: input.job || undefined, company: input.company || undefined, jobDescription: String(input.jobDescription || '') }, { taxonomy: input.taxonomy || undefined }), {});
    const sentence = 'Something in this résumé could not be tailored safely, so it is kept exactly as you wrote it and no credit is used.';
    const charge = { charge: false, reason: 'kept_as_written', sentence, will_charge: false, reason_sentence: sentence };
    return { ...freeDiagnostic(out), tier: 'paid', statements: safe(() => screenStatements(out), []), requirements_listed: safe(() => listedRequirements(out).length, 0), ats_coverage: safe(() => listedCoverage(out), null), posting: postingInfo(input.posting, { job: input.job, company: input.company }), field_match: null, blocked: null, charge, change_counts: null, rewrite_plan: [], reorder: [], questions: [], availability: null, summary: null, keywords_missing: [], application_message: '', tailored: { doc: null, text: String(input.original || input.resume || ''), untouched: true, pages: 1, score_before: out.fit_score ?? null, score_after: out.fit_score ?? null, changes: [], kept_as_is: sentence, visibility: { of: 0, before: 0, after: 0, labels_before: [], labels_after: [] }, charge, field_match: null, error: String((err && err.message) || err).slice(0, 120) } };
  }
}
function buildPaidOptimizeUnsafe({ resume: rawResume, original = '', jobDescription, job, company, pro, jobId, taxonomy = null, fit = null, posting = null, resumeIsCanonical = false } = {}) {
  // ONE text for every score in the package: the canonical text (api/resume.js already sends it). The parsed and
  // re-serialised document the tailor scores IS that text, so fit_score === tailored.score_before always.
  // canonicalised exactly ONCE: the API handler already did it (resumeIsCanonical) — the text is not re-run through
  // canonicalResumeText, which is not idempotent and once moved the paid score off the free one
  const resume = resumeIsCanonical ? String(rawResume || '') : canonicalResumeText(String(rawResume || ''));
  const jd = String(jobDescription || '');
  // `fit` = lib/server/fitContext.js — the same company/remote context the free check scores with
  const legacy = optimizeFromSeenFit({ resume, jobDescription, job, company, pro, taxonomy, fit });
  const out = runOptimizer({ ...(fit || {}), resumeText: String(resume || ''), jobTitle: job || undefined, company: company || undefined, jobDescription: jd }, { taxonomy: taxonomy || undefined });
  const employer = employerDisplayName({ company: company || '', postingText: jd });
  // + the closed list of neutral verbs a proposal may add (lib/resume/tailor/rewrites.js NEUTRAL_VERBS)
  const vocab = [String(resume || ''), jd, 'perform performed handle handled provide provided complete completed serve served as in'];

  let doc = null, plan = null, variant = null;
  try {
    doc = parseResume({ text: String(resume || ''), source: 'text' });
    const t = tailorResume(doc, { jobTitle: job || '', company: company || '', jobDescription: jd, jobId: jobId || '', taxonomy, fit });
    plan = t.plan; variant = t.variant;
  } catch { doc = null; plan = null; variant = null; }
  let v2 = null;
  try { v2 = buildApplicationPackage({ resumeText: String(resume || ''), jobDescription: jd, jobTitle: job || '', company: company || '' }); } catch { v2 = null; }

  // ── blocked? (a failed hard gate, or a posting in a different line of work) — and THE tailored result ──
  const jobTitle = (plan && plan.job && plan.job.title) || job || '';
  const built = doc && plan && variant ? buildTailored({ base: doc, plan, variant, out, original: String(original || rawResume || ''), jobTitle, employer, renderText }) : null;
  const fm = built ? built.field_match : null;
  const blocked = built ? built.blocked : null;
  const different = !!blocked; // any block (a different field or a failed hard gate): no tailored version at all

  // Wording proposals from the Studio plan, before → after; `accepted` says whether the finished résumé carries it.
  const rewrite_plan = different ? [] : ((plan && plan.rewrites) || [])
    .filter((r) => isSubstantiveRewrite(r.from, r.to) && rewriteIsGrounded(r.from, r.to, vocab))
    .map((r) => ({ bulletId: r.bulletId, from: r.from, to: r.to, rules: r.rules, requirement: r.requirement || null, why: r.why || '', default: r.default === 'applied' ? 'applied' : 'needs_ok', accepted: r.default === 'applied', ...(r.added ? { added: r.added } : {}) }));

  // The summary the finished résumé carries, decided once from the verdict (lib/resume/tailor/summary.js).
  const ownSummary = doc && doc.basics && doc.basics.summary ? String(doc.basics.summary) : '';
  const sd = plan && plan.summaryDecision;
  const summary = !plan ? null
    : different ? (ownSummary ? { text: ownSummary, replaces: '', needs_confirmation: false, kept: true, why: blocked.sentence } : null)
    : sd && ['replace', 'add'].includes(sd.mode) && plan.summary ? { text: plan.summary.text, replaces: plan.summary.replaced || '', needs_confirmation: false, why: sd.why }
      : sd && sd.mode === 'trim' && plan.summary ? { text: plan.summary.text, replaces: ownSummary, trimmed: true, kept: true, needs_confirmation: false, why: sd.why }
        : ownSummary ? { text: ownSummary, replaces: '', needs_confirmation: false, kept: true, why: (sd && sd.why) || 'Your own summary stays as you wrote it.' } : null;

  // THE finished résumé (director's decision F): the plan applied, every default-applied change in it — and EVERY
  // difference from the person's own document listed (the re-typesetting as one "Formatting made consistent" item).
  const tailored = built ? built.tailored : null;
  // Questions whose answers become lines: at most three real gaps, then the role's own measure. None when blocked.
  const questions = blocked ? [] : plan ? (plan.prompts || []).filter((p) => p.kind !== 'dates').slice(0, 5).map((p) => ({
    id: p.id, kind: p.kind, heading: p.kind === 'gap' ? `What ${employer || 'this employer'} asks for that your résumé doesn't show` : 'Add a number — only one you can defend',
    question: p.question, unit: p.unit, requirement: p.requirement || null, statement: p.statement || null, answer_kind: p.answerKind || (p.kind === 'dates' ? 'dates' : p.kind === 'metric' ? 'number' : null),
    itemId: p.itemId, role: p.roleTitle, company: p.company,
    roles: doc ? doc.experience.map((e) => ({ itemId: e.id, title: e.title, company: e.company })) : [],
    template: p.template || '', why: p.why || '', needs_confirmation: true,
    // one consistent kind for the screen: 'tool'|'activity'|'knowledge'|'credential' (gap) · 'number' (metric) · 'dates'
    answerKind: p.answerKind || (p.kind === 'dates' ? 'dates' : p.kind === 'metric' ? 'number' : null), term: p.term || p.requirement || null, label: p.label || p.term || p.requirement || null,
    ...(p.unit === 'line' ? { line: p.line, bulletId: p.bulletId, slot: p.slot, before: p.before, nounWords: p.nounWords, after: p.after, needsPeriod: !!p.needsPeriod } : {}),
  })) : (doc ? numberQuestions(v2, doc, resume) : []);
  // never "missing" what the same package lists as matched, or what a résumé line plainly says
  const matchedLabels = (out.matched_requirements || []).map((m) => String(m.surface || m.requirement || '').replace(/^term:/, ''));
  const resumeLines = String(resume || '').split('\n');
  const keywordsMissing = (legacy.keywords_missing || []).filter((k) => { const t = typeof k === 'string' ? k : (k && (k.term || k.keyword || k.label)) || ''; return t && !matchedLabels.some((m) => stemsCovered(t, m) || stemsCovered(m, t)) && !resumeLines.some((l) => stemsCovered(t, l)); });
  const application_message = doc ? safe(() => composeApplicationMessage({ out, doc, jobTitle, employer, blocked, family: plan && plan.job ? plan.job.family : '', self: { identity: (sd && sd.identity) || '', years: (sd && sd.years) || null }, verbs: KNOWN_VERBS }), '') : '';
  const listed = listedRequirements(out);

  const pkg = {
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
    // the requirement list the result screen renders: the reader's statements (id, text, status, evidence, missing, …)
    statements: screenStatements(out),
    requirement_count: out.requirement_count,
    requirements_listed: listed.length,
    ats_coverage: listedCoverage(out),
    posting: postingInfo(posting, { job: jobTitle, company: employer || company }),
    field_match: fm,
    blocked,
    charge: tailored ? tailored.charge : { charge: false, will_charge: false, reason: 'no_document', sentence: 'Your résumé could not be read into sections, so nothing was tailored and no credit is used.', reason_sentence: 'Your résumé could not be read into sections, so nothing was tailored and no credit is used.' },
    change_counts: null,
    // the work
    rewrite_plan,
    reorder: tailored ? reorderFromChanges(tailored.changes) : [],
    questions,
    availability: blocked ? null : safe(() => availabilityLine(out.constraints, { jobTitle, employer, family: plan && plan.job ? plan.job.family : '' }), null),
    summary,
    keywords_missing: keywordsMissing,
    tailored,
    application_message,
  };
  pkg.change_counts = changeCounts(pkg);
  return pkg;
}

/** What Seen read, for the screen's "Seen read: …" row. A pasted link's own title / employer win over sent ones. */
export function postingInfo(posting, { job = '', company = '' } = {}) {
  const p = posting || {};
  return { title: p.title || job || null, company: p.company || company || null, source: p.source || null, host: p.host || null };
}

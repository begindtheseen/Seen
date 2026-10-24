// Tailoring engine — a job-targeted VARIANT of a résumé, built only from what the résumé already
// proves.
//
// Given a ResumeDoc and a job (title, company, description), it produces a TailorPlan:
//   • relevance — every bullet scored against the posting's keywords (which requirement it
//     evidences, how important that requirement is), roles ranked, the strongest bullets flagged;
//   • reorder — bullets re-sorted inside each role so the relevant ones lead (nothing deleted);
//   • skills — the posting's matched skills first, evidenced-but-unlisted skills added to the Skills
//     section (the Resume Intelligence engine's "surface buried skill" recommendation, each with the
//     résumé span that proves it), terminology mirrored to the posting's exact phrase where the
//     résumé uses an alias;
//   • summary — a 2–3 line professional summary composed ONLY from facts in the document (current
//     title, years, the top matched strengths, one real result), never from the posting;
//   • gaps — the honest list of requirements the résumé does not evidence, with the fabrication
//     flags (credentials/degrees are never implied);
//   • before/after match scores from the canonical Resume Intelligence engine.
// The variant is a new ResumeDoc (kind: 'variant', meta.tailoredFor, provenance per change). The
// base document is never mutated. Pure + deterministic; the optional LLM polish lives in polish.js.

import { analyzeApplication } from '../../resume-intelligence/engine.js';
import { buildJobProfile } from '../../resume-intelligence/jobProfile.js';
import { getConcept, normSurface, resolveConcept } from '../../resume-intelligence/taxonomy.js';
import { serializeToText, normalizeDoc, experienceSpanYears } from '../model.js';
import { findMetrics, analyzeBullet } from '../health/bullet.js';
import { passesFirewall } from '../rewrite/rules.js';
import { extractJobKeywords, keywordIn, keywordCoverage, scoreBulletKeywords } from './keywords.js';
import { buildPlan, applyPlan, bulletFromAnswer, OPTIMIZER_VERSION } from './optimizer.js';

export const TAILOR_VERSION = 'tailor_v2';
export { applyPlan, bulletFromAnswer };

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const phraseRe = (p) => new RegExp(`(?<![a-z0-9])${esc(normSurface(p)).replace(/ /g, '\\s+')}(?![a-z0-9])`, 'i');
const wordRe = (p) => new RegExp(`(?<![A-Za-z0-9])${esc(p).replace(/ /g, '\\s+')}(?![A-Za-z0-9])`, 'i');

/** Score one bullet against the job's keywords (lives in keywords.js; re-exported for callers/tests). */
export function scoreBulletRelevance(text, keywords) {
  const r = scoreBulletKeywords(text, keywords);
  // A real metric (not any digit) makes a relevant bullet stronger evidence.
  const metricBonus = r.hits.length && findMetrics(text).length ? 0.15 : 0;
  const digitBonus = r.hits.length && /\d/.test(text) ? 0.15 : 0;
  return { score: Number((r.score - digitBonus + metricBonus).toFixed(3)), hits: r.hits };
}

function titleOverlap(a, b) {
  const tok = (s) => new Set(normSurface(s).split(' ').filter((w) => w.length > 2 && !/^(and|the|for|with|of|senior|junior|lead|sr|jr|ii|iii)$/.test(w)));
  const A = tok(a), B = tok(b);
  if (!A.size || !B.size) return 0;
  let n = 0; for (const w of A) if (B.has(w)) n++;
  return n / Math.max(A.size, B.size);
}

// Mid-sentence casing for a term the candidate wrote at a line start or in a Title Case list:
// "Blueprint reading" → "blueprint reading", but "OSHA 30", "NEC code", "480V three-phase" keep
// their letters.
export function sentenceCase(term) {
  return String(term).split(/(\s+)/).map((w, i) => (i === 0 && /^[A-Z][a-z]+$/.test(w) ? w.toLowerCase() : w)).join('');
}
const lowerFirst = (s) => (/^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const upperFirst = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const listJoin = (items) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

// The strongest real result in the document, as a clause: a percentage / dollar / multiplier beats
// a bare count, and a bullet that is "X; passed 100% of inspections" contributes just that clause.
export function pickProofClause(doc) {
  let best = null;
  for (const e of doc.experience) for (const bl of e.bullets) {
    const a = analyzeBullet(bl.text);
    if (!a.metrics.length) continue;
    if (!(a.lead.kind === 'strong' || a.lead.kind === 'verb' || a.lead.kind === 'recognition' || a.lead.kind === 'generic')) continue;
    const kind = a.metrics.some((m) => /[%$]|\bx\b|×/i.test(m)) ? 3 : a.metrics.some((m) => /\d/.test(m)) ? 1 : 0;
    const clauses = bl.text.split(/;\s+/).map((c) => c.trim()).filter(Boolean);
    const clause = (clauses.length > 1 ? clauses.find((c) => a.metrics.some((m) => c.includes(m))) : clauses[0]) || bl.text;
    const words = clause.split(/\s+/).length;
    const score = kind * 10 - Math.abs(words - 10) * 0.2; // prefer a strong, compact clause
    if (!best || score > best.score) best = { score, clause: clause.replace(/[.;,]+$/, ''), bulletId: bl.id };
  }
  return best;
}

// Compose a summary from facts in the doc only. Returns { text, draft, firewall, sources }.
export function composeSummary(doc, analysis) {
  const b = doc.basics;
  const recent = doc.experience[0];
  const years = experienceSpanYears(doc);
  const title = recent && recent.title ? recent.title : (b.headline || '');
  const resumeText = serializeToText(doc);
  const matched = [...analysis.strongMatches, ...analysis.transferableMatches]
    .filter((m) => m.category !== 'credential' && m.category !== 'education' && m.category !== 'experience')
    .map((m) => resumeSurfaceFor(m, resumeText))
    .filter(Boolean)
    .map(sentenceCase)
    .filter((r, i, arr) => arr.findIndex((x) => x.toLowerCase() === r.toLowerCase()) === i)
    .slice(0, 3);
  const proof = pickProofClause(doc);
  const companies = doc.experience.map((e) => e.company).filter(Boolean).slice(0, 2);
  const parts = [];
  // A summary needs a subject: a title (or headline) or a span of experience. "Proven in Excel." alone
  // is not a summary.
  if (!title && !(years != null && years >= 1)) return { text: '', draft: '', firewall: { ok: false, reason: 'nothing_to_say' }, sources: { title, years, companies, strengths: matched, proofBulletId: proof ? proof.bulletId : null } };
  if (title) parts.push(`${title}${years != null && years >= 1 ? ` with ${years}+ years of experience` : ''}${companies.length ? ` at ${companies.join(' and ')}` : ''}.`);
  else if (years != null && years >= 1) parts.push(`${years}+ years of experience${companies.length ? ` at ${companies.join(' and ')}` : ''}.`);
  if (matched.length) parts.push(`Proven in ${listJoin(matched)}${proof ? `; ${lowerFirst(proof.clause)}` : ''}.`);
  else if (proof) parts.push(`${upperFirst(proof.clause)}.`);
  const text = parts.join(' ').replace(/\.\./g, '.').trim();
  // Firewall against the posting: the summary may only use words from the résumé itself (plus the
  // connective words of the template).
  const firewall = text ? passesFirewall(resumeText, text, [String(years), 'proven', 'years', 'experience', 'with', 'at', 'and', 'in', 'of']) : { ok: false, reason: 'nothing_to_say' };
  return { text: firewall.ok ? text : '', draft: text, firewall, sources: { title, years, companies, strengths: matched, proofBulletId: proof ? proof.bulletId : null } };
}

// The résumé's OWN wording for a matched concept ("OSHA 30", "forklift") — never the taxonomy's
// display name, which the candidate never wrote.
export function resumeSurfaceFor(match, resumeText) {
  const c = match.canonicalConcept ? getConcept(match.canonicalConcept) : null;
  const surfaces = [match.requirement, ...(c ? [c.display, ...(c.aliases || [])] : [])].map(normSurface).filter((x) => x && x.length >= 3).sort((a, b) => b.length - a.length);
  const hay = resumeText;
  for (const sfc of surfaces) {
    // the match may end inside a hyphenated compound ("480V three" of "480V three-phase"): return the
    // whole compound, which is what the candidate actually wrote
    const m = hay.match(new RegExp(`(?<![A-Za-z0-9])(${esc(sfc).replace(/ /g, '\\s+')}(?:-[A-Za-z0-9]+)*)(?![A-Za-z0-9])`, 'i'));
    if (m) return m[1].replace(/\s+/g, ' ');
  }
  return null;
}

/**
 * Skills edits as plan DATA (applied by the optimizer's applySkillEdits, server and browser alike):
 *   • reorders — inside each group the posting's matched skills lead (nothing removed);
 *   • additions — only the résumé's OWN wording for a term the bullets/summary already carry but the
 *     Skills section does not ("OSHA 30" written in the summary, missing from Skills). Never the
 *     posting's phrase, never a taxonomy label the candidate did not write. Deduped by containment
 *     ("OSHA 30" covers "OSHA"), in the list's casing, each citing the line that proves it.
 */
export function planSkillEdits(base, coverage, analysis) {
  const allItems = base.skills.flatMap((g) => g.items);
  const matchedReqs = [...(analysis.strongMatches || []), ...(analysis.transferableMatches || [])];
  const isMatchedSkill = (item) => matchedReqs.some((m) => phraseRe(m.requirement).test(normSurface(item)) || (m.canonicalConcept && resolveConcept(item)?.id === m.canonicalConcept))
    || coverage.matched.some((kw) => kw.weight >= 0.5 && keywordIn(item, kw));
  const reorders = [];
  for (const g of base.skills) {
    const sorted = [...g.items].map((it, i) => ({ it, i, m: isMatchedSkill(it) ? 0 : 1 })).sort((a, b2) => (a.m - b2.m) || (a.i - b2.i));
    if (sorted.some((x, i) => x.i !== i)) reorders.push({ kind: 'reorder_skills', groupId: g.id, from: [...g.items], to: sorted.map((x) => x.it) });
  }
  const skillsText = normSurface(allItems.join(' | '));
  const bodyText = serializeToText({ ...base, skills: [] });
  const candidates = [];
  for (const kw of coverage.matched) {
    if (kw.weight < 0.5) continue;
    const span = keywordIn(bodyText, kw);
    if (!span) continue; // present only in Skills already
    if (keywordIn(skillsText, kw)) continue; // already listed
    const own = bodyText.match(new RegExp(`(?<![A-Za-z0-9])(${esc(span).replace(/ /g, '\\s+')})(?![A-Za-z0-9])`, 'i'));
    const term = (own ? own[1] : span).replace(/\s+/g, ' ');
    if (term.length < 3 || /^\d/.test(term)) continue;
    const evidenceLine = bodyText.split('\n').find((l) => l.toLowerCase().includes(term.toLowerCase())) || '';
    candidates.push({ term, weight: kw.weight, evidence: evidenceLine.replace(/^[•\-\s]+/, '').slice(0, 160), why: `Your résumé already says "${term}" — listing it under Skills makes keyword scans find it.` });
  }
  const target = base.skills.find((g) => !g.label) || base.skills[0] || null;
  const titleCase = !!target && target.items.length >= 2 && target.items.filter((it) => /^[A-Z]/.test(it)).length >= target.items.length / 2;
  const additions = [];
  candidates.sort((a, b2) => b2.term.length - a.term.length || b2.weight - a.weight);
  for (const c of candidates) {
    if (additions.some((a) => wordRe(c.term).test(a.term))) continue;
    if (allItems.some((it) => wordRe(c.term).test(it))) continue;
    additions.push({ groupId: target ? target.id : null, term: c.term, listed: titleCase && /^[a-z]/.test(c.term) ? upperFirst(c.term) : c.term, evidence: c.evidence, why: c.why });
  }
  return { reorders, additions };
}

/**
 * @param {object} doc ResumeDoc (base)
 * @param {{ jobTitle?: string, company?: string, jobDescription?: string, jobId?: string, location?: string, applyTerminology?: boolean, replaceSummary?: boolean }} job
 * @returns {{ plan: object, variant: object }}
 */
export function tailorResume(doc, job = {}) {
  const base = normalizeDoc(doc);
  const jobTitle = String(job.jobTitle || '').trim();
  const company = String(job.company || '').trim();
  const jd = String(job.jobDescription || '').trim();
  const baseText = serializeToText(base);
  const before = analyzeApplication({ resumeText: baseText, jobDescription: jd, jobTitle, company });
  const profile = buildJobProfile(jd, { jobTitle, company });
  const keywords = extractJobKeywords(jd, { jobTitle, company, location: String(job.location || '') });
  const coverage = keywordCoverage(baseText, keywords);

  // ── The optimizer: what the job IS → per-role relevance → decisions (keep / trim / condense /
  //    drop) → bullet selection in a page budget → transferable fill + prompts → targeted summary,
  //    searched against an objective. Everything below works on the variant it returns. ──
  // Skills edits and the v1 summary fallback are computed from the BASE document as plan DATA, so
  // applyPlan applies them on the server and in the browser alike — one apply path, one result.
  const skillEdits = planSkillEdits(base, coverage, before);
  const fallback = composeSummary(base, before);
  const opt = buildPlan(base, { jobTitle, company, jobId: String(job.jobId || ''), jobDescription: jd, keywords, requirements: profile.requirements, now: job.now, pages: job.pages, skillEdits, summaryFallback: fallback.text, replaceSummary: job.replaceSummary !== false });
  let variant = opt.variant;
  variant.meta.tailoredFor = { company, role: jobTitle, jobId: String(job.jobId || '') };
  // per-role keyword view (compatibility shape) with the optimizer's relevance
  const roles = opt.roles.map((r) => {
    const e = base.experience.find((x) => x.id === r.itemId);
    const bullets = (e ? e.bullets : []).map((bl) => ({ bulletId: bl.id, text: bl.text, ...scoreBulletRelevance(bl.text, keywords) }));
    return { itemId: r.itemId, title: r.title, company: r.company, index: r.index, titleOverlap: Number(titleOverlap(r.title, jobTitle).toFixed(2)), relevance: r.relevance, tier: (opt.decisions.find((d) => d.itemId === r.itemId) || {}).tier, family: r.family, familyLabel: r.familyLabel, bullets };
  });

  // ── Terminology: where a bullet uses an alias of a requirement, mirror the posting's exact phrase.
  const terminology = [];
  for (const m of before.strongMatches) {
    if (m.matchType !== 'ALIAS_MATCH' && m.matchType !== 'EXACT_MATCH') continue;
    const target = normSurface(m.requirement);
    if (!m.canonicalConcept || target.length < 4) continue;
    const c = getConcept(m.canonicalConcept);
    const aliases = (c ? [c.display, ...(c.aliases || [])] : []).map(normSurface).filter((a) => a && a !== target && a.length >= 3);
    for (const e of opt.variant.experience) for (const bl of e.bullets) {
      const hay = normSurface(bl.text);
      if (phraseRe(target).test(hay)) continue;
      const alias = aliases.find((a) => phraseRe(a).test(hay));
      if (!alias) continue;
      const replaced = bl.text.replace(wordRe(alias), m.requirement);
      if (replaced === bl.text) continue;
      terminology.push({ bulletId: bl.id, itemId: e.id, from: bl.text, to: replaced, alias, term: m.requirement });
      break;
    }
  }
  // Terminology swaps are proposals (applied only when the caller asks — they change wording).
  if (job.applyTerminology && terminology.length) {
    variant = applyPlan(base, { decisions: opt.decisions, roles: opt.roles, skills: opt.skills, strategy: opt.strategy, ctx: opt.ctx, rewrites: opt.rewrites, applyRewrites: false, terminology, applyTerminology: true }, { transferable: true });
    variant.meta.tailoredFor = { company, role: jobTitle, jobId: String(job.jobId || '') };
  }
  const provenance = variant.meta.provenance;

  // ── Summary: composed inside applyPlan — targeted (titles, employers, implied strengths of the kept
  //    roles) → the v1 fact composer as fallback → sentences of the old summary that alone carried a
  //    posting keyword are kept verbatim. opt.summary is what the variant actually has. ──
  const summary = opt.summary ? { text: opt.summary.text, sources: opt.summary.sources } : { text: '', sources: null };

  variant.meta.provenance = provenance;
  const variantText = serializeToText(variant);
  const after = analyzeApplication({ resumeText: variantText, jobDescription: jd, jobTitle, company });
  const coverageAfter = keywordCoverage(variantText, keywords);

  // Honest gaps — but a requirement the engine missed while the résumé plainly carries the term
  // (a certification entry naming "OSHA 30" against an "OSHA certification" gate, "forklifts" in a
  // bullet against "Forklift Operation") is "likely covered", not a gap. Downgraded, never hidden.
  const certText = normSurface([...base.certifications.map((c) => c.text || c.name), ...base.skills.flatMap((g) => g.items), base.basics.summary].join(' | '));
  const coveredByCert = (req) => {
    const toks = normSurface(req).split(' ').filter((w) => w.length >= 4 && !/^(certification|certificate|license|licensed|required|preferred|ability|experience|knowledge|years)$/.test(w));
    return toks.find((w) => certText.includes(w)) || null;
  };
  const coveredByKeyword = (req) => {
    const n = normSurface(req);
    const kw = coverage.matched.find((k) => normSurface(k.display) === n || k.surfaces.includes(n));
    return kw ? kw.span : null;
  };
  const gaps = [...before.missingRequirements, ...before.missingRecoverable].map((m) => {
    const kwSpan = coveredByKeyword(m.requirement);
    const cov = kwSpan || coveredByCert(m.requirement);
    const likelyCovered = !!cov;
    return {
      requirement: m.requirement, level: m.requirementLevel, category: m.category,
      severity: likelyCovered ? 'likely_covered' : m.missSeverity, mustNotInvent: !!m.mustNotInvent && !likelyCovered,
      explanation: likelyCovered ? `Your résumé says "${cov}" — spell out "${m.requirement}" exactly where it is true.` : m.explanation,
      evidence: cov || null,
    };
  });
  // Posting keywords the résumé never mentions anywhere (only add if genuinely true).
  const missingKeywords = coverage.missing.filter((k) => k.weight >= 0.4).map((k) => ({ term: k.display, weight: k.weight, source: k.source }));
  const plan = {
    version: TAILOR_VERSION,
    optimizer: OPTIMIZER_VERSION,
    job: { title: jobTitle, company, jobId: String(job.jobId || ''), roleFamily: profile.roleFamilyLabel, family: opt.job.family, familyLabel: opt.job.familyLabel, requirementCount: keywords.length },
    // With no requirements extracted there is nothing to be "100% backed by" — the coverage is
    // null and the Studio says so instead of printing a vacuous 100%.
    score: { before: before.overallScore, after: after.overallScore, criticalCoverage: keywords.length ? after.criticalRequirementCoverage : null, keywordCoverage: { before: coverage.ratio, after: coverageAfter.ratio } },
    objective: opt.objective,
    strategy: opt.strategy,
    decisions: opt.decisions,
    prompts: opt.prompts,
    added: opt.added,
    rewrites: opt.rewrites,
    applyRewrites: false,
    ctx: opt.ctx,
    roles: roles.sort((a, b2) => b2.relevance - a.relevance).map((r) => ({ ...r, bullets: r.bullets.map((b) => ({ bulletId: b.bulletId, score: b.score, hits: b.hits.map((h) => h.requirement) })) })),
    summary: summary.text ? { text: summary.text, replaced: base.basics.summary || '', sources: summary.sources } : null,
    skills: { reordered: skillEdits.reorders.length > 0, reorders: skillEdits.reorders, additions: skillEdits.additions, added: skillEdits.additions.map((a) => ({ term: a.term, evidence: a.evidence, why: a.why })) },
    terminology,
    applyTerminology: !!job.applyTerminology,
    gaps,
    keywords: { matched: coverage.matched.map((k) => ({ term: k.display, weight: k.weight, span: k.span })), missing: missingKeywords, coverage: coverage.ratio },
    strengths: before.strongMatches.slice(0, 8).map((m) => ({ requirement: m.requirement, evidence: (m.evidence || [])[0] || '' })),
    transferable: before.transferableMatches.slice(0, 6).map((m) => ({ requirement: m.requirement, evidence: (m.evidence || [])[0] || '', explanation: m.explanation })),
    provenance,
    analysis: after,
  };
  return { plan, variant };
}

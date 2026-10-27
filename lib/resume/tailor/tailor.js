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
// base document is never mutated. Pure + deterministic; no model is called.

import { runOptimizer } from '../../optimizer/index.js';
import { analyzeApplication } from '../../resume-intelligence/engine.js';
import { buildJobProfile } from '../../resume-intelligence/jobProfile.js';
import { getConcept, normSurface, resolveConcept } from '../../resume-intelligence/taxonomy.js';
import { serializeToText, normalizeDoc } from '../model.js';
import { supportedYears } from '../years.js';
import { findMetrics, analyzeBullet } from '../health/bullet.js';
import { passesFirewall } from '../rewrite/rules.js';
import { credentialHeld } from '../../optimizer/credentials.js';
import { extractJobKeywords, keywordIn, keywordCoverage, scoreBulletKeywords, GENERIC } from './keywords.js';

// Words a posting ranks that are outcomes or objects, not skills a Skills section lists.
// an industry is where the work happens, not a skill to list ("Retail", "Hospitality")
const INDUSTRY_WORD = new Set(['retail', 'hospitality', 'healthcare', 'health care', 'manufacturing', 'logistics', 'finance', 'banking', 'insurance', 'construction', 'education', 'technology', 'communications', 'telecommunications', 'government', 'nonprofit', 'automotive', 'restaurant', 'restaurants', 'grocery', 'ecommerce', 'e-commerce', 'saas', 'fintech']);
const NOT_A_SKILL = new Set(['operator', 'associate', 'clerk', 'lead', 'supervisor', 'manager', 'technician', 'specialist', 'coordinator', 'representative', 'warehouse', 'driver', 'cashier', 'barista', 'intern', 'accuracy', 'dashboards', 'dashboard', 'reports', 'report', 'shifts', 'orders', 'customers', 'guests', 'tasks', 'issues', 'needs', 'requests', 'records', 'files', 'emails', 'calls', 'meetings', 'events', 'stores', 'store', 'sales floor', 'floor', 'team', 'teams', 'staff', 'clients', 'patients', 'students']);
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
  const sy = supportedYears(doc);
  const years = sy ? sy.years : null;
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
  // A skill the résumé "already says" is said in the summary or in a bullet — the work. An employer,
  // a title or a school is not a skill: "Communications" was offered from "Cox Communications" and
  // "Retail" from a title line (round 5, Maria; the industry word is not a skill either).
  const bodyText = [base.basics.summary || '', ...base.experience.flatMap((e) => [e.summary || '', ...e.bullets.map((b) => b.text)]), ...base.projects.flatMap((p) => p.bullets.map((b) => b.text))].filter(Boolean).join('\n');
  const candidates = [];
  for (const kw of coverage.matched) {
    if (kw.weight < 0.5) continue;
    const span = keywordIn(bodyText, kw);
    if (!span) continue; // present only in Skills already
    if (keywordIn(skillsText, kw)) continue; // already listed
    const own = bodyText.match(new RegExp(`(?<![A-Za-z0-9])(${esc(span).replace(/ /g, '\\s+')})(?![A-Za-z0-9])`, 'i'));
    const term = (own ? own[1] : span).replace(/\s+/g, ' ');
    if (term.length < 3 || /^\d/.test(term)) continue;
    // a Skills entry is a skill, not a verb or an ordinary word from a bullet: "scheduled",
    // "accuracy" and "dashboards" were offered as skills (harness 2026-10-25)
    if (!/\s/.test(term) && (/(?:ed|ly)$/i.test(term) || GENERIC.has(term.toLowerCase()) || NOT_A_SKILL.has(term.toLowerCase()) || INDUSTRY_WORD.has(term.toLowerCase()))) continue;
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
    additions.push({ groupId: target ? target.id : null, term: c.term, listed: (titleCase || !target) && /^[a-z]/.test(c.term) ? upperFirst(c.term) : c.term, evidence: c.evidence, why: c.why });
  }
  return { reorders, additions };
}

/**
 * @param {object} doc ResumeDoc (base)
 * @param {{ jobTitle?: string, company?: string, jobDescription?: string, jobId?: string, location?: string, applyTerminology?: boolean, replaceSummary?: boolean }} job
 * @returns {{ plan: object, variant: object }}
 */
export function tailorResume(doc, job = {}) {
  // The targeted summary is a rewrite, and a rewrite can lose a word the posting counts ("hitting sales
  // and service goals" — round 5, Maria: 83 → 82 on her own résumé). When the version with the rewritten
  // summary scores below the version that keeps the person's summary, the person's summary stays.
  if (job.replaceSummary !== false && !job._pass) {
    const targeted = tailorResume(doc, { ...job, _pass: true });
    const sc = targeted.plan.score;
    if (sc.before != null && sc.after != null && sc.after < sc.before) {
      const kept = tailorResume(doc, { ...job, replaceSummary: false, _pass: true });
      if (kept.plan.score.after != null && kept.plan.score.after >= sc.after) { kept.plan.summaryKept = true; return kept; }
    }
    return targeted;
  }
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
  // The match score is the SAME SeenFit verdict the Optimize modal and /resume show (D4: the
  // Studio's "89 → 89" was a third scale for the same résumé and posting). It is null — with the
  // sentence saying why — when the posting states fewer than three requirements.
  const fitOpts = { taxonomy: job.taxonomy || undefined };
  const fitCtx = job.fit || {};
  const fitBefore = runOptimizer({ ...fitCtx, resumeText: baseText, jobTitle, company, jobDescription: jd }, fitOpts);
  const fitAfter = runOptimizer({ ...fitCtx, resumeText: variantText, jobTitle, company, jobDescription: jd }, fitOpts);
  const coverageAfter = keywordCoverage(variantText, keywords);

  // Honest gaps — but a requirement the engine missed while the résumé plainly carries the term
  // (a certification entry naming "OSHA 30" against an "OSHA certification" gate, "forklifts" in a
  // bullet against "Forklift Operation") is "likely covered", not a gap. Downgraded, never hidden.
  const certText = normSurface([...base.certifications.map((c) => c.text || c.name), ...base.skills.flatMap((g) => g.items), base.basics.summary].join(' | '));
  const coveredByCert = (req) => {
    // short credential names count (RN, EPA, 608, CPA, CDL — the old 4-letter minimum dropped them)
    const toks = normSurface(req).split(' ').filter((w) => w.length >= 2 && !/^(certification|certificate|license|licensed|required|preferred|ability|experience|knowledge|years|or|and|of|the|in|a|an)$/.test(w));
    return toks.find((w) => new RegExp(`(?<![a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9])`).test(certText)) || null;
  };
  const coveredByKeyword = (req) => {
    const n = normSurface(req);
    const kw = coverage.matched.find((k) => normSurface(k.display) === n || k.surfaces.includes(n));
    return kw ? kw.span : null;
  };
  // A credential the résumé holds is not a gap at all (credentialHeld: "BSN, RN" holds "RN
  // license", "EPA Section 608 Universal" holds "EPA 608"); a soft skill ("Teamwork · REQUIRED"
  // for an engineer who mentors and runs an interview loop) is never a provable gap — it is
  // shown in how bullets read, not listed as missing (2026-10-25).
  // The gaps are the SAME reader's unmet requirements as the match score above (lib/optimizer): a named skill the
  // posting asks for that no line shows, plus an unmet hard constraint. The old list came from a sentence
  // splitter and read "collaborate cross · REQUIRED", "among other factors · PREFERRED", "Operations ·
  // REQUIRED", and "Safety · REQUIRED — no résumé evidence" beside a role the same screen marked "safety ✓"
  // (round 6, Tasha and Ray). A soft skill is never a provable gap — it shows in how bullets read.
  const unmet = (fitAfter.unsupported_requirements || []).filter((m) => !m.soft && !m.matched);
  // a requirement counts as "likely covered" only when the résumé carries the WHOLE thing: "google" from
  // Google Analytics does not cover Google Slides (round 7, Tasha: 'spell out "google slides" exactly where it is true')
  const wholeCert = (req) => {
    const toks = normSurface(req).split(' ').filter((w) => w.length >= 2 && !/^(certification|certificate|license|licensed|required|preferred|ability|experience|knowledge|years|or|and|of|the|in|a|an|one)$/.test(w));
    return toks.length > 0 && toks.every((w) => new RegExp(`(?<![a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9])`).test(certText)) ? req : null;
  };
  const gaps = unmet.map((m) => {
    // "one of crm, marketing operations" reads as a choice
    const label = String(m.surface || m.requirement || '').trim().replace(/^one of\s+(.+)$/i, (_, rest) => rest.split(/,\s*/).join(' or '));
    const kwSpan = coveredByKeyword(label) || coveredByKeyword(m.requirement);
    const cov = kwSpan || wholeCert(label);
    const likelyCovered = !!cov;
    const required = m.importance === 'required';
    return {
      requirement: label, level: required ? 'required' : 'preferred', category: 'skill',
      severity: likelyCovered ? 'likely_covered' : required && m.hard ? 'high' : 'medium', mustNotInvent: false,
      explanation: likelyCovered ? `Your résumé says "${cov}" — spell out "${label}" exactly where it is true.` : `The posting ${required ? 'asks for' : 'would like'} ${label}; no line on your résumé shows it. Add it only where it is true.`,
      evidence: cov || null,
    };
  });
  for (const c of fitAfter.constraints || []) {
    if (c.status !== 'unmet' || !c.label) continue;
    const credential = c.kind === 'credential' || c.kind === 'license' || c.kind === 'education';
    if (credential && credentialHeld(baseText, c.label)) continue;
    const short = String(c.label).split(/[,;(]| or /)[0].trim().slice(0, 70);
    if (gaps.some((g) => normSurface(g.requirement) === normSurface(short))) continue;
    gaps.push({ requirement: short, level: 'required', category: c.kind || 'constraint', severity: credential ? 'fatal' : 'high', mustNotInvent: credential, explanation: c.message || `The posting requires ${c.label}; your résumé does not show it.`, evidence: null });
  }
  // a credential or licence the posting names and the résumé does not hold stays a fatal gap, never to be
  // invented (the credential reader, lib/optimizer/credentials.js, is the authority on "held")
  for (const m of [...before.missingRequirements, ...before.missingRecoverable]) {
    const cat = String(m.category || '').toLowerCase();
    if (!(['credential', 'certification', 'license'].includes(cat) || m.mustNotInvent)) continue;
    if (credentialHeld(baseText, m.requirement)) continue;
    if (gaps.some((g) => normSurface(g.requirement) === normSurface(m.requirement))) continue;
    const cov = coveredByKeyword(m.requirement) || coveredByCert(m.requirement);
    gaps.push({ requirement: m.requirement, level: m.requirementLevel, category: m.category, severity: cov ? 'likely_covered' : m.missSeverity || 'fatal', mustNotInvent: !cov, explanation: cov ? `Your résumé says "${cov}" — spell out "${m.requirement}" exactly where it is true.` : m.explanation, evidence: cov || null });
  }
  const provenStrength = (m) => (m.matchType === 'EXACT_MATCH' || m.matchType === 'ALIAS_MATCH') && !!(m.evidence || [])[0] && (/years shown$/.test((m.evidence || [])[0]) || m.category === 'education' || !!resumeSurfaceFor(m, baseText));
  // Posting keywords the résumé never mentions anywhere (only add if genuinely true).
  const missingKeywords = coverage.missing.filter((k) => k.weight >= 0.4).map((k) => ({ term: k.display, weight: k.weight, source: k.source }));
  const plan = {
    version: TAILOR_VERSION,
    optimizer: OPTIMIZER_VERSION,
    job: { title: jobTitle, company, jobId: String(job.jobId || ''), roleFamily: profile.roleFamilyLabel, family: opt.job.family, familyLabel: opt.job.familyLabel, requirementCount: keywords.length },
    // With no requirements extracted there is nothing to be "100% backed by" — the coverage is
    // null and the Studio says so instead of printing a vacuous 100%.
    score: { before: fitBefore.fit_score, after: fitAfter.fit_score, verdict: fitAfter.verdict, verdictBefore: fitBefore.verdict, requirementCount: fitAfter.requirement_count, criticalCoverage: keywords.length ? after.criticalRequirementCoverage : null, keywordCoverage: { before: coverage.ratio, after: coverageAfter.ratio } },
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
    skills: { reordered: skillEdits.reorders.length > 0, reorders: skillEdits.reorders, additions: skillEdits.additions, added: skillEdits.additions.map((a) => ({ term: a.listed || a.term, evidence: a.evidence, why: a.why })) },
    terminology,
    applyTerminology: !!job.applyTerminology,
    gaps,
    keywords: { matched: coverage.matched.map((k) => ({ term: k.display, weight: k.weight, span: k.span })), missing: missingKeywords, coverage: coverage.ratio },
    // "Your strongest evidence" lists only lines that NAME the requirement (or its alias): "✓ Machine
    // Learning — Wrote Python (FastAPI)…" was a taxonomy neighbour shown as proof (2026-10-25). A
    // related-concept match is transferable, and says so.
    strengths: before.strongMatches.filter((m) => provenStrength(m)).slice(0, 8).map((m) => ({ requirement: m.requirement, evidence: (m.evidence || [])[0] || '' })),
    transferable: [...before.strongMatches.filter((m) => !provenStrength(m)), ...before.transferableMatches].slice(0, 6).map((m) => ({ requirement: m.requirement, evidence: (m.evidence || [])[0] || '', explanation: m.explanation })),
    provenance,
    analysis: after,
  };
  return { plan, variant };
}

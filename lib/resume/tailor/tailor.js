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
import { inferJobTitle } from '../../optimizer/postingSections.js';
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
import { readVerdict, stemsCovered } from './verdict.js';
import { composeVerdictSummary, namedRequirements } from './summary.js';
import { askableGap } from './questions.js';

// The general years figure the verdict states ("You show 5.6 years of experience…"): a summary never says more.
function verdictYears(out) {
  for (const c of (out && out.constraints) || []) {
    const m = String(c.message || '').match(/You show (\d+(?:\.\d+)?) years? of experience\b/);
    if (m) return Number(m[1]);
  }
  return null;
}

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
 * Skills edits from the VERDICT (v6, director's decision E). Plan data, applied by applySkillEdits:
 *   • reorders — inside each group the skills the posting's matched requirements name lead, heaviest first;
 *     every other item keeps the person's order; a qualified item ("TypeScript (working)", "Workiva (some)")
 *     never moves ahead of an unqualified one;
 *   • additions — only a real skill or tool the résumé's own bullets state for a matched requirement, in
 *     the résumé's words, when the Skills list lacks it: a known taxonomy concept or a product name — never
 *     a gerund ("Building"), a title or field word ("Backend"), an industry word, a diagnosis ("CHF") or a
 *     soft trait. Nothing is added when the résumé has no Skills section.
 */
const QUALIFIED_RE = /\((?:working|basic|some|familiar|familiarity|learning|beginner|exposure|novice|limited|intermediate)\b[^)]*\)/i;
const DIAGNOSIS = new Set(['chf', 'copd', 'diabetes', 'stroke', 'sepsis', 'pneumonia', 'dementia', 'hypertension', 'cancer', 'covid', 'asthma', 'mi', 'cva', 'dvt', 'uti', 'ckd', 'esrd', 'afib', 'tbi', 'adhd', 'autism']);
const FIELD_WORD = /^(?:backend|frontend|front-end|back-end|full-stack|fullstack|software|platform|infrastructure|engineering|development|nursing|clinical|warehouse|retail|accounting|administrative|admin|marketing|sales|operations|management|leadership|building|electrical|commercial|industrial|residential|customer|service|services)$/i;
export function planVerdictSkillEdits(base, verdict) {
  const allItems = base.skills.flatMap((g) => g.items);
  const weightOf = (item) => {
    let w = 0;
    const it = String(item).replace(QUALIFIED_RE, '').trim();
    for (const r of verdict.matched) {
      if (r.soft || !r.label) continue;
      if (stemsCovered(r.label, it) || (it.split(/\s+/).length <= 3 && stemsCovered(it, r.label))) w = Math.max(w, r.weight);
    }
    return w;
  };
  const reorders = [];
  for (const g of base.skills) {
    const rows = g.items.map((it, i) => ({ it, i, w: weightOf(it), q: QUALIFIED_RE.test(it) }));
    // the person's lead skill stays first (Go for a Go engineer, Canva for a designer): it is how they see themselves
    const lead = rows[0] && !rows[0].q ? rows[0] : null;
    const plain = rows.filter((r) => !r.q && r !== lead).sort((a, b) => (b.w > 0) - (a.w > 0) || b.w - a.w || a.i - b.i);
    if (lead) plain.unshift(lead);
    const qualified = rows.filter((r) => r.q).sort((a, b) => a.i - b.i);
    // a qualified item keeps its place relative to everything that was ahead of it
    const out = [...plain];
    for (const q of qualified) { const at = Math.min(out.length, Math.max(q.i, out.findIndex((r) => r.i > q.i) < 0 ? out.length : out.findIndex((r) => r.i > q.i))); out.splice(at, 0, q); }
    if (out.some((r, i) => r.i !== i)) reorders.push({ kind: 'reorder_skills', groupId: g.id, from: [...g.items], to: out.map((r) => r.it), requirements: out.filter((r) => r.w > 0).map((r) => r.it) });
  }
  const additions = [];
  const target = base.skills.find((g) => !g.label) || base.skills[0] || null;
  if (target) {
    const body = base.experience.flatMap((e) => e.bullets.map((b) => b.text)).join('\n');
    const titleWords = new Set(base.experience.flatMap((e) => String(e.title || '').toLowerCase().split(/[^a-z]+/)).filter(Boolean));
    const titleCase = target.items.length >= 2 && target.items.filter((it) => /^[A-Z]/.test(it)).length >= target.items.length / 2;
    for (const r of [...verdict.matched].sort((a, b) => b.weight - a.weight)) {
      if (additions.length >= 4) break;
      if (r.soft || r.inferred || r.via === 'related' || (r.where !== 'bullet' && !r.surfaced)) continue;
      if (allItems.some((it) => stemsCovered(r.label, it) || stemsCovered(it.replace(QUALIFIED_RE, ''), r.label))) continue;
      const m = body.match(new RegExp(`(?<![A-Za-z0-9])(${esc(r.label).replace(/\\? /g, '[\\s-]+')})(?![A-Za-z0-9])`, 'i'));
      if (!m) continue;
      let term = m[1].replace(/\s+/g, ' ');
      // the capital of a line's first word is not the term's own ("Wound care, ostomy care…" → "wound care")
      if (/^[A-Z][a-z]+(?:[\s-][a-z0-9]+)*$/.test(term) && !new RegExp(`[^\\n\\s][ \\t]+${esc(term)}(?![A-Za-z0-9])`).test(body)) term = term.charAt(0).toLowerCase() + term.slice(1);
      const words = term.toLowerCase().split(/\s+/);
      if (words.length > 4 || term.length < 2) continue;
      if (words.length === 1 && (/ing$|ed$|ly$/.test(words[0]) || FIELD_WORD.test(words[0]) || DIAGNOSIS.has(words[0]) || INDUSTRY_WORD.has(words[0]) || NOT_A_SKILL.has(words[0]) || GENERIC.has(words[0]) || titleWords.has(words[0]))) continue;
      if (words.every((w) => FIELD_WORD.test(w) || titleWords.has(w))) continue;
      // people are not skills ("External auditors", "key clients")
      if (/^(?:auditors?|clients?|customers?|patients?|vendors?|staff|employees?|managers?|stakeholders?|executives?|members?|guests?|students?|teams?|partners?|users?|residents?|families|leadership)$/.test(words[words.length - 1])) continue;
      const concept = resolveConcept(term);
      const product = /^[A-Z][A-Za-z0-9+#.]*(?:\s+[A-Z0-9][A-Za-z0-9+#.]*)*$/.test(term) && !/^[A-Z][a-z]+$/.test(term) || /^[A-Z]{2,}[0-9]*$/.test(term);
      if (!concept && !product && words.length < 2) continue;
      const evidenceLine = body.split('\n').find((l) => l.toLowerCase().includes(term.toLowerCase())) || '';
      if (additions.some((a) => stemsCovered(a.term, term) || stemsCovered(term, a.term))) continue;
      additions.push({ groupId: target.id, term, listed: titleCase && /^[a-z]/.test(term) ? upperFirst(term) : term, requirement: r.label, evidence: evidenceLine.replace(/^[•\-\s]+/, '').slice(0, 160), why: `They ask for ${r.label.toLowerCase() === term.toLowerCase() ? term : r.label}; your line "${shortLine(evidenceLine)}" shows it, but your Skills list did not say it — a recruiter's keyword search reads that list first.` });
    }
  }
  return { reorders, additions };
}
const shortLine = (t) => { const s = String(t || '').replace(/^[•\-\s]+/, '').replace(/[.;,]+$/, ''); return s.length > 70 ? `${s.slice(0, 70).replace(/\s+\S*$/, '')}…` : s; };

const SUBSTANTIVE = new Set(['summary', 'rewrite', 'move', 'skills_add', 'reorder_lead']);
/**
 * Every change between the base and the tailored document, as the person sees it: before → after, the posting
 * requirement it serves, why, and whether it is already in the document ('applied') or waits for an OK.
 */
export function buildChanges(base, plan, variant) {
  const changes = [];
  const roleWhere = (e) => [e.title, e.company].filter(Boolean).join(' · ');
  const moved = new Set((plan.moves || []).map((m) => m.bulletId));
  for (const m of plan.moves || []) {
    const e = base.experience.find((x) => x.id === m.itemId);
    if (!e) continue;
    const ve = variant.experience.find((x) => x.id === m.itemId);
    if (!ve || !ve.bullets.some((b) => b.id === m.bulletId)) continue;
    changes.push({ id: `move:${m.bulletId}`, type: 'move', where: roleWhere(e), before: `${m.text} (line ${m.from})`, after: `${m.text} (line ${m.to})`, requirement: m.requirement, why: `They ask for ${m.requirement}; your résumé said it only in your ${m.where === 'skills' ? 'skills list' : m.where === 'summary' ? 'summary' : 'job title'}. "${shortLine(m.text)}" is the proof, so it moves up to line ${m.to} of your ${e.company || e.title} role.`, default: 'applied', substantive: true });
  }
  for (const e of base.experience) {
    const ve = variant.experience.find((x) => x.id === e.id);
    if (!ve) continue;
    const baseFirst = e.bullets[0];
    const newFirst = ve.bullets[0];
    if (baseFirst && newFirst && baseFirst.id !== newFirst.id && !moved.has(newFirst.id)) {
      const proves = (plan.decisions.find((d) => d.itemId === e.id)?.ranked || []).find((r) => r.bulletId === newFirst.id)?.proves || [];
      const orig = e.bullets.find((b) => b.id === newFirst.id);
      changes.push({ id: `reorder:${e.id}`, type: 'reorder', where: roleWhere(e), before: `${baseFirst.text} (line 1)`, after: `${orig ? orig.text : newFirst.text} (line 1, was line ${e.bullets.findIndex((b) => b.id === newFirst.id) + 1})`, requirement: proves[0] || null, why: proves.length ? `They ask for ${proves.slice(0, 2).join(' and ')}; "${shortLine(orig ? orig.text : newFirst.text)}" shows it, so it now opens your ${e.company || e.title} role instead of "${shortLine(baseFirst.text)}". Same words, new order.` : `Lines that prove what they ask for now open your ${e.company || e.title} role.`, default: 'applied', substantive: proves.length > 0, kind: 'reorder_lead' });
    }
  }
  const sm = plan.summaryDecision;
  if (sm && ['replace', 'add', 'trim'].includes(sm.mode) && (variant.basics.summary || '') !== (base.basics.summary || '')) changes.push({ id: 'summary', type: 'summary', where: 'Summary', before: base.basics.summary || '', after: variant.basics.summary || '', requirement: (sm.named || []).slice(0, 4).join(', ') || null, why: sm.why, default: 'applied', substantive: sm.mode !== 'trim' });
  // one added keyword is not worth a credit on its own; two or more is real work on the document
  const adds = ((plan.skills && plan.skills.additions) || []).filter((a) => variant.skills.some((g) => g.items.includes(a.listed || a.term)));
  for (const a of adds) changes.push({ id: `skill:${a.term}`, type: 'skills', where: 'Skills', before: '', after: a.listed || a.term, requirement: a.requirement || null, why: a.why, default: 'applied', substantive: adds.length >= 2, kind: 'skills_add' });
  for (const r of (plan.skills && plan.skills.reorders) || []) changes.push({ id: `skills_order:${r.groupId}`, type: 'skills', where: 'Skills', before: r.from.join(', '), after: r.to.join(', '), requirement: (r.requirements || [])[0] || null, why: `${(r.requirements || []).slice(0, 3).join(', ')} — what they ask for — now come${(r.requirements || []).length === 1 ? 's' : ''} first in your skills; nothing added or removed.`, default: 'applied', substantive: false });
  for (const r of plan.rewrites || []) {
    const e = base.experience.find((x) => x.id === r.itemId);
    const ve = variant.experience.find((x) => x.id === r.itemId);
    if (!e || !ve || !ve.bullets.some((b) => b.id === r.bulletId)) continue;
    changes.push({ id: `rewrite:${r.bulletId}`, type: 'rewrite', where: roleWhere(e), before: r.from, after: r.to, requirement: r.requirement || null, why: r.why || '', default: r.default === 'applied' ? 'applied' : 'needs_ok', substantive: r.default === 'applied' });
  }
  for (const c of plan.cuts || []) {
    const e = base.experience.find((x) => x.id === c.itemId);
    changes.push({ id: `cut:${c.bulletId}`, type: 'cut', where: e ? roleWhere(e) : '', before: c.text, after: '', requirement: null, why: `Left off to keep the résumé on ${plan.strategy && plan.strategy.pages > 1 ? `${plan.strategy.pages} pages` : 'one page'}: of your ${e ? (e.company || e.title) : ''} lines, it says the least about what they ask for. It stays in your base résumé.`, default: 'applied', substantive: false });
  }
  return changes;
}

/**
 * @param {object} doc ResumeDoc (base)
 * @param {{ jobTitle?: string, company?: string, jobDescription?: string, jobId?: string, location?: string, applyTerminology?: boolean, replaceSummary?: boolean }} job
 * @returns {{ plan: object, variant: object }}
 */
export function tailorResume(doc, job = {}) {
  const base = normalizeDoc(doc);
  const jd = String(job.jobDescription || '').trim();
  // No title typed → the posting's own (lib/optimizer/postingSections.js inferJobTitle); a blank title made the
  // Stripe JD an "Operations posting" with H-E-B ranked first (Dev, round 4).
  const jobTitle = String(job.jobTitle || '').trim() || inferJobTitle(jd);
  const company = String(job.company || '').trim();
  const baseText = serializeToText(base);
  const fitOpts = { taxonomy: job.taxonomy || undefined };
  const fitCtx = job.fit || {};
  const score = (text) => runOptimizer({ ...fitCtx, resumeText: text, jobTitle, company, jobDescription: jd }, fitOpts);
  // ONE reading of the posting, ONE verdict about the résumé — everything below follows it
  const fitBefore = score(baseText);
  const verdict = readVerdict(base, fitBefore);
  const before = analyzeApplication({ resumeText: baseText, jobDescription: jd, jobTitle, company });
  const profile = buildJobProfile(jd, { jobTitle, company });
  const keywords = extractJobKeywords(jd, { jobTitle, company, location: String(job.location || '') });
  const coverage = keywordCoverage(baseText, keywords);
  const skillEdits = planVerdictSkillEdits(base, verdict);
  const summaryDecision = job.replaceSummary === false
    ? { mode: 'keep', text: base.basics.summary || '', before: base.basics.summary || '', named: namedRequirements(base.basics.summary, verdict), namedBefore: namedRequirements(base.basics.summary, verdict), why: 'You asked to keep your own summary.', sources: null }
    : composeVerdictSummary(base, verdict, { now: job.now instanceof Date ? job.now : undefined, yearsCeiling: verdictYears(fitBefore), postingText: `${jobTitle}\n${jd}` });
  const opt = buildPlan(base, { jobTitle, company, jobId: String(job.jobId || ''), jobDescription: jd, keywords, requirements: profile.requirements, now: job.now, pages: job.pages, skillEdits, summaryDecision, replaceSummary: job.replaceSummary !== false, verdict });
  // ── the tailored document never scores below the base: undo, in order, whatever cost the point ──
  const planData = { decisions: opt.decisions, roles: opt.roles, skills: opt.skills, strategy: opt.strategy, ctx: opt.ctx, rewrites: opt.rewrites, applyRewrites: false };
  let variant = opt.variant;
  let fitAfter = score(serializeToText(variant));
  const reverted = [];
  const ladder = [
    ['summary', () => { planData.ctx = { ...planData.ctx, summaryMode: 'keep', summaryText: '' }; summaryDecision.mode = 'keep'; summaryDecision.why = 'Your own summary stays: the rewritten one scored lower against this posting.'; }],
    ['rewrites', () => { planData.rewrites = planData.rewrites.map((r) => ({ ...r, default: 'needs_ok' })); opt.rewrites = planData.rewrites; }],
    ['skills', () => { planData.skills = { reorders: [], additions: [] }; opt.skills = planData.skills; }],
    ['cuts', () => { for (const d of planData.decisions) { const e = base.experience.find((x) => x.id === d.itemId); if (e) d.keptBullets = [...d.keptBullets, ...e.bullets.map((b) => b.id).filter((id) => !d.keptBullets.includes(id))]; } opt.cuts = []; }],
  ];
  for (const [what, undo] of ladder) {
    if (fitBefore.fit_score == null || fitAfter.fit_score == null || fitAfter.fit_score >= fitBefore.fit_score) break;
    undo(); reverted.push(what);
    variant = applyPlan(base, planData, { transferable: true });
    fitAfter = score(serializeToText(variant));
  }
  opt.ctx = planData.ctx; opt.decisions = planData.decisions;
  variant.meta.tailoredFor = { company, role: jobTitle, jobId: String(job.jobId || '') };
  // per-role keyword view (compatibility shape) with the optimizer's relevance
  const roles = opt.roles.map((r) => {
    const e = base.experience.find((x) => x.id === r.itemId);
    const bullets = (e ? e.bullets : []).map((bl) => ({ bulletId: bl.id, text: bl.text, ...scoreBulletRelevance(bl.text, keywords) }));
    return { itemId: r.itemId, title: r.title, company: r.company, index: r.index, titleOverlap: Number(titleOverlap(r.title, jobTitle).toFixed(2)), relevance: r.relevance, tier: (opt.decisions.find((d) => d.itemId === r.itemId) || {}).tier, family: r.family, familyLabel: r.familyLabel, bullets };
  });

  // ── Terminology: where a bullet uses an alias of a requirement, mirror the posting's exact phrase (proposals).
  const terminology = [];
  for (const m of before.strongMatches) {
    if (m.matchType !== 'ALIAS_MATCH' && m.matchType !== 'EXACT_MATCH') continue;
    const target = normSurface(m.requirement);
    if (!m.canonicalConcept || target.length < 4) continue;
    const c = getConcept(m.canonicalConcept);
    const aliases = (c ? [c.display, ...(c.aliases || [])] : []).map(normSurface).filter((a) => a && a !== target && a.length >= 3);
    for (const e of variant.experience) for (const bl of e.bullets) {
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
  if (job.applyTerminology && terminology.length) {
    variant = applyPlan(base, { ...planData, terminology, applyTerminology: true }, { transferable: true });
    variant.meta.tailoredFor = { company, role: jobTitle, jobId: String(job.jobId || '') };
  }
  const provenance = variant.meta.provenance;
  const variantText = serializeToText(variant);
  const after = analyzeApplication({ resumeText: variantText, jobDescription: jd, jobTitle, company });
  const coverageAfter = keywordCoverage(variantText, keywords);

  // ── Gaps: the verdict's unmet requirements a person can honestly act on (askableGap: never a soft trait, a
  //    reader fragment, an initialism that is no known term, or something a résumé line already shows), plus
  //    the unmet hard constraints and credentials the résumé does not hold. ──
  const resumeLines = [base.basics.summary || '', ...base.experience.flatMap((e) => [e.title, e.company, ...e.bullets.map((b) => b.text)]), ...base.skills.flatMap((g) => g.items), ...base.certifications.map((c) => c.text || c.name || '')].join('\n');
  const gaps = [];
  for (const r of verdict.unmet) {
    if (!askableGap(r, resumeLines)) continue;
    const label = r.label;
    if (gaps.some((g) => normSurface(g.requirement) === normSurface(label))) continue;
    const required = r.importance === 'required';
    gaps.push({ requirement: label, level: required ? 'required' : 'preferred', category: 'skill', severity: required && r.hard ? 'high' : 'medium', mustNotInvent: false, explanation: `The posting ${required ? 'asks for' : 'would like'} ${label}; no line on your résumé shows it. Add it only where it is true.`, evidence: null });
  }
  for (const c of fitAfter.constraints || []) {
    if (c.status !== 'unmet' || !c.label) continue;
    if (!['degree', 'education', 'years', 'certification', 'license', 'credential', 'management', 'seniority', 'language'].includes(c.kind)) continue;
    const credential = c.kind === 'credential' || c.kind === 'license' || c.kind === 'education' || c.kind === 'certification';
    if (credential && credentialHeld(baseText, c.label)) continue;
    const short = String(c.label).split(/[,;(]| or /)[0].trim().slice(0, 70);
    if (gaps.some((g) => normSurface(g.requirement) === normSurface(short))) continue;
    gaps.push({ requirement: short, level: 'required', category: c.kind || 'constraint', severity: credential ? 'fatal' : 'high', mustNotInvent: credential, explanation: c.message || `The posting requires ${c.label}; your résumé does not show it.`, evidence: null });
  }
  const changes = buildChanges(base, { ...opt, summaryDecision, rewrites: opt.rewrites, skills: opt.skills }, variant);
  const substantive = changes.some((c) => c.default === 'applied' && c.substantive);
  const pending = changes.filter((c) => c.default === 'needs_ok').length;
  const small = changes.filter((c) => c.default === 'applied' && !c.substantive);
  const smallSaid = [...new Set(small.map((c) => (c.type === 'summary' ? 'one job-hunting sentence left out of your summary' : c.type === 'skills' ? (c.before ? 'your skills reordered so theirs come first' : `"${c.after}" added to your skills`) : c.type === 'reorder' ? 'a line moved up' : c.type === 'cut' ? 'a line left off for space' : '')).filter(Boolean))];
  const keptAsIs = substantive ? null : `Your résumé already fits this ${company ? `${company} ` : ''}posting as written${smallSaid.length ? ` — the only edits are small (${smallSaid.join('; ')})` : ' — nothing was changed'}${pending ? `. ${pending} optional wording suggestion${pending === 1 ? ' is' : 's are'} there if you want ${pending === 1 ? 'it' : 'them'}` : ''}.`;
  const provenStrength = (m) => (m.matchType === 'EXACT_MATCH' || m.matchType === 'ALIAS_MATCH') && !!(m.evidence || [])[0] && (/years shown$/.test((m.evidence || [])[0]) || m.category === 'education' || !!resumeSurfaceFor(m, baseText));
  // Posting keywords the résumé never mentions anywhere (only add if genuinely true).
  const missingKeywords = coverage.missing.filter((k) => k.weight >= 0.4).map((k) => ({ term: k.display, weight: k.weight, source: k.source }));
  const plan = {
    version: TAILOR_VERSION,
    verdictDriven: true,
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
    summary: ['replace', 'add', 'trim'].includes(summaryDecision.mode) && variant.basics.summary ? { text: variant.basics.summary, replaced: base.basics.summary || '', sources: summaryDecision.sources, mode: summaryDecision.mode } : null,
    summaryKept: !['replace', 'add'].includes(summaryDecision.mode),
    summaryDecision: { mode: summaryDecision.mode, why: summaryDecision.why, named: summaryDecision.named || [], namedBefore: summaryDecision.namedBefore || [] },
    moves: opt.moves || [],
    cuts: opt.cuts || [],
    reverted,
    changes,
    substantive,
    keptAsIs,
    skills: { reordered: (opt.skills?.reorders || []).length > 0, reorders: opt.skills?.reorders || [], additions: opt.skills?.additions || [], added: (opt.skills?.additions || []).map((a) => ({ term: a.listed || a.term, evidence: a.evidence, why: a.why })) },
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

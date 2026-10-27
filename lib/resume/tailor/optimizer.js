// The optimizer — decides, autonomously and explainably, what the tailored résumé for ONE
// application should contain:
//
//   1. score every role for this posting (relevance.js: what the job IS, implied by its title
//      and employer, plus what its bullets prove);
//   2. assign each role a decision — keep (full bullet budget), trim (the few bullets that
//      matter), condense (one line under "Additional Experience"), drop — under hard constraints
//      (never drop a current role, never open a timeline gap, always keep enough to be a résumé);
//   3. select bullets per role by competency alignment + posting keywords + impact, without
//      redundancy, inside a page budget (one page for most people, two with 10+ years);
//   4. fill a thin but relevant role with a bullet written from the duties its title inherently
//      involves (flagged: "confirm this is true"), and ask the one or two questions whose answers
//      would make it strong (family-specific metric prompts);
//   5. compose the summary and skills for the target;
//   6. search: evaluate the whole variant with an objective (match score, keyword coverage,
//      health, relevance density, length fit, completeness, penalties) and hill-climb over the
//      decisions until nothing improves. Deterministic. Every decision carries its reasons.
//
// applyPlan(base, plan, overrides) is pure, so the Studio can re-apply a plan with the user's
// overrides (keep this role anyway, drop the transferable bullet, answer a prompt) instantly
// and without spending another credit.

import { scoreRoles } from './relevance.js';
import { keywordCoverage, scoreBulletKeywords, keywordIn } from './keywords.js';
import { termCompetencies, coverage, competencyGroup } from './competencies.js';
import { analyzeApplication } from '../../resume-intelligence/engine.js';
import { ROLE_FAMILIES, GENERAL_FAMILY } from '../../application-intelligence/roleOntology.js';
import { scoreResume } from '../health/score.js';
import { serializeToText, normalizeDoc, newId, experienceSpanYears } from '../model.js';
import { supportedYears } from '../years.js';
import { hasStemmed } from '../../optimizer/lemma.js';
import { postingTermWeights, termOverlap, titleStems } from './postingTerms.js';
import { findMetrics, analyzeBullet } from '../health/bullet.js';
import { rewriteBullet, passesFirewall } from '../rewrite/rules.js';
import { formatRange, fromToken, findDateRange, parseDateToken, toToken } from '../parse/dates.js';

export const OPTIMIZER_VERSION = 'optimizer_v4';

// bullet budget by decision × tier: a current-but-irrelevant role kept for continuity gets one line
const BUDGET = { keep: 6, trim: 3, condense: 0, drop: 0 };
const BUDGET_BY_TIER = { keep: { core: 6, supporting: 3, context: 2, omit: 1 }, trim: { core: 3, supporting: 2, context: 1, omit: 1 }, condense: { core: 0, supporting: 0, context: 0, omit: 0 }, drop: { core: 0, supporting: 0, context: 0, omit: 0 } };
const budgetFor = (decision, tier) => (BUDGET_BY_TIER[decision] || {})[tier] ?? BUDGET[decision];
// generic competencies are weaker reasons to add a line than specific ones
const GENERIC_GROUPS = new Set(['core']);
const SPECIFIC_OVER = { 'membership sales': 'sales', 'vehicle handling': 'driving', 'guest relations': 'hospitality' };
const STEP_UP = { drop: 'condense', condense: 'trim', trim: 'keep', keep: 'keep' };
const STEP_DOWN = { keep: 'trim', trim: 'condense', condense: 'drop', drop: 'drop' };
const LINES_PER_PAGE = 46;
const clone = (v) => JSON.parse(JSON.stringify(v));
const words = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).length;
const tokens = (s) => new Set(String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w.length >= 4));
const jaccard = (a, b) => { if (!a.size || !b.size) return 0; let n = 0; for (const x of a) if (b.has(x)) n++; return n / (a.size + b.size - n); };
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const monthIndex = (tok, fallback) => { const d = fromToken(tok); return !d || d === 'present' ? fallback : d.y * 12 + (d.m || 6); };

// ── bullets written from what a title inherently involves (flagged for confirmation) ──
const TRANSFER = {
  sales: (r) => `Handled sales conversations with prospective ${r.noun}, matching products and plans to their needs`,
  'membership sales': () => 'Sold and renewed memberships through consultative conversations with prospective and current members',
  'customer service': (r) => `Provided front-line customer service to ${r.noun} throughout every shift`,
  hospitality: () => 'Delivered attentive, professional guest service from arrival to departure',
  'point of sale': () => 'Processed point-of-sale transactions accurately, including cash and card payments',
  'cash handling': () => 'Handled cash, card and drawer reconciliation accurately at the end of each shift',
  'inventory management': () => 'Restocked and organized inventory and kept the floor and backroom accurate',
  merchandising: () => 'Maintained product displays and merchandising standards on the sales floor',
  'food safety': () => 'Followed food-safety, sanitation and allergen procedures on every order',
  teamwork: () => 'Worked as part of a shift team to keep service moving during peak periods',
  'time management': () => 'Prioritized competing tasks under time pressure to keep service on schedule',
  safety: () => 'Followed safety procedures consistently and kept the work area hazard-free',
  'goal attainment': () => 'Worked toward daily and monthly targets and tracked progress against them',
  'product knowledge': () => 'Learned the product range to answer questions and make recommendations',
  scheduling: () => 'Coordinated schedules and appointments and kept the calendar accurate',
  documentation: () => 'Kept records complete and accurate for every transaction and request',
  'data entry': () => 'Entered and verified records accurately in the office systems',
  administration: () => 'Ran day-to-day office administration: phones, scheduling, records and correspondence',
  'campaign management': () => 'Coordinated campaign outreach, volunteers and events against a field plan',
  marketing: () => 'Supported marketing campaigns and outreach across in-person and online channels',
  driving: () => 'Operated vehicles safely across a full shift with no incidents',
  'vehicle handling': () => 'Handled customer vehicles with care and accountability from arrival to return',
  'small business operations': () => 'Ran the business end to end: scheduling, supplies, customer communication and quality',
  'client relationships': () => 'Built repeat relationships with clients through follow-up and consistent service',
  leadership: () => 'Coordinated the work of teammates during shifts and covered for gaps',
  training: () => 'Trained new teammates on procedures and standards',
  'problem solving': () => 'Resolved day-to-day problems on the spot and escalated only when needed',
  communication: () => 'Communicated clearly with customers and teammates across every shift',
  'mechanical repair': () => 'Performed hands-on mechanical repairs and inspections to specification',
  troubleshooting: () => 'Troubleshot faults methodically to root cause before repairing',
  installation: () => 'Completed installations to code and manufacturer specification',
  'patient care': () => 'Supported patient care with attentive, respectful service and accurate records',
  education: () => 'Taught and supported learners with clear explanations and structured sessions',
};
const NOUN = { retail: 'shoppers', sales: 'customers', hospitality: 'guests', valet_parking: 'guests', food_service: 'guests', customer_service: 'customers', healthcare_support: 'patients', education: 'students', general: 'customers' };

// ── prompts: the questions whose answers make a thin, relevant role strong ──
const ANSWER_TEMPLATES = {
  'customers per shift': (a) => `Served ${a} customers per shift`,
  'satisfaction rating': (a) => `Held a ${a} customer satisfaction rating`,
  'transactions per shift': (a) => `Rang up ${a} transactions per shift`,
  'sales total': (a) => `Reached ${a} in sales`,
  'quota attainment': (a) => `Reached ${a} quota attainment`,
  revenue: (a) => `Generated ${a} in revenue`,
  'vehicles per shift': (a) => `Handled ${a} vehicles during a busy shift`,
  'wait time': (a) => `Kept guest wait times to ${a} during rushes`,
  'orders per shift': (a) => `Picked and packed ${a} orders per shift`,
  'scan accuracy': (a) => `Maintained ${a} scan accuracy`,
  'stops per shift': (a) => `Completed ${a} stops per shift`,
  'on-time rate': (a) => `Delivered with a ${a} on-time rate`,
  'safety record': (a) => `Maintained ${a}`,
  'jobs/units completed': (a) => `Completed ${a}`,
  'volume/outcome': (a) => `Delivered ${a}`,
};
export function bulletFromAnswer(prompt, answer) {
  const a = String(answer || '').trim().replace(/[.]+$/, '');
  if (!a) return '';
  const tpl = ANSWER_TEMPLATES[prompt.unit];
  const text = tpl ? tpl(a) : `${cap(prompt.action || 'Delivered')} ${a}`;
  return `${text}.`;
}

// ── line estimate for the page budget ──
export function estimateLines(doc) {
  const b = doc.basics;
  let n = 2 + (b.headline ? 1 : 0);
  if (b.summary) n += 1.5 + Math.ceil(words(b.summary) / 15);
  for (const e of doc.experience) { n += 2.6; for (const bl of e.bullets) n += Math.ceil(words(bl.text) / 14); if (e.summary) n += Math.ceil(words(e.summary) / 15); }
  if (doc.experience.length) n += 1.5;
  for (const e of doc.education) n += 2 + e.details.length;
  if (doc.education.length) n += 1.5;
  if (doc.skills.length) n += 1.5 + doc.skills.reduce((s, g) => s + Math.ceil((g.items.join(', ').length + (g.label || '').length) / 95), 0);
  if (doc.certifications.length) n += 1.5 + doc.certifications.length;
  for (const p of doc.projects) n += 2 + p.bullets.length;
  if (doc.projects.length) n += 1.5;
  if (doc.languages.length) n += 2.5;
  for (const x of doc.extra) n += 1.5 + x.items.length;
  return Math.round(n);
}

// A one-page résumé stays one page: the budget is the résumé's own length (10+ years of experience used
// to buy a second page, and a 46-line résumé read "46 of 92 lines (2 pages)" — round 5, Maria).
function pageBudget(doc) {
  return Math.max(1, Math.min(2, Math.ceil(estimateLines(doc) / LINES_PER_PAGE)));
}

// ── bullet ranking inside a role ──
// A bullet ranks by what it shares with THIS posting: its competencies, the taxonomy keywords and
// the posting's own words (postingTerms.js). Without the last one the hourly competency lexicon
// decided alone, and "Trained 4 new partners on drink standards" led Tasha's barista role for a
// social-media AND a CRM posting (2026-10-25).
function rankBullets(role, jobVec, keywords, termWeights = null, termExclude = null) {
  return role.bullets.map((b) => {
    const { vector } = termCompetencies(b.text);
    const cov = coverage(jobVec, vector);
    const kw = scoreBulletKeywords(b.text, keywords);
    const terms = termOverlap(b.text, termWeights, 6, termExclude);
    const a = analyzeBullet(b.text);
    const impact = (findMetrics(b.text).length ? 0.6 : 0) + (a.lead.kind === 'strong' || a.lead.kind === 'verb' ? 0.4 : a.lead.kind === 'generic' ? 0.2 : 0);
    const score = 0.35 * cov.score + 0.2 * Math.min(1, kw.score / 1.2) + 0.3 * terms.score + 0.15 * impact;
    return { bulletId: b.id, text: b.text, score: Number(score.toFixed(3)), competencies: cov.shared.slice(0, 3).map((s) => s.competency), keywords: kw.hits.map((h) => h.requirement), postingTerms: terms.hits, impact: Number(impact.toFixed(2)) };
  }).sort((x, y) => y.score - x.score);
}
function selectBullets(ranked, budget) {
  const out = [];
  const seen = [];
  for (const r of ranked) {
    if (out.length >= budget) break;
    const t = tokens(r.text);
    if (seen.some((s) => jaccard(s, t) > 0.6)) continue; // says the same thing
    out.push(r.bulletId); seen.push(t);
  }
  return out;
}

// ── decisions ──
// Tiers are RELATIVE to the best role (a career-changer's best role may only cover 30% of the
// posting) with absolute floors so a résumé with nothing relevant does not invent a "core".
function tierOf(role, rank, best) {
  const rel = best > 0 ? role.relevance / best : 0;
  // A role within 10% of the best is core whatever its rank: Dev's senior payments role sat at
  // 92% of the best and was "Supporting" only because it ranked third (2026-10-25).
  if ((rank < 2 && role.relevance >= 0.15 && rel >= 0.75) || (role.relevance >= 0.15 && rel >= 0.9) || role.relevance >= 0.45) return 'core';
  if (role.relevance >= 0.12 && rel >= 0.5) return 'supporting';
  if (role.relevance >= 0.08 && rel >= 0.3) return 'context';
  return 'omit';
}
function defaultDecision(tier, role) {
  const recent = role.current || role.recency >= 0.8;
  if (tier === 'core') return 'keep';
  if (tier === 'supporting') return role.bullets > 3 ? 'trim' : 'keep';
  if (tier === 'context') return recent ? 'trim' : 'condense';
  return role.current ? 'trim' : recent ? 'condense' : 'drop';
}
// Dropping a role must not open a hole in the recent timeline.
function opensGap(doc, keptIds, now) {
  const nowM = now.getUTCFullYear() * 12 + now.getUTCMonth() + 1;
  const spans = doc.experience.filter((e) => keptIds.has(e.id) && e.start).map((e) => [monthIndex(e.start, nowM), e.end === 'present' ? nowM : monthIndex(e.end, nowM)]).sort((a, b) => a[0] - b[0]);
  const allSpans = doc.experience.filter((e) => e.start).map((e) => [monthIndex(e.start, nowM), e.end === 'present' ? nowM : monthIndex(e.end, nowM)]).sort((a, b) => a[0] - b[0]);
  const gaps = (sp) => { let g = 0, cur = null; for (const [s, e] of sp) { if (cur != null && s - cur > 6 && cur >= nowM - 60) g++; cur = Math.max(cur ?? e, e); } return g; };
  return gaps(spans) > gaps(allSpans);
}

// ── objective ──
function evaluate(variant, ctx) {
  const text = serializeToText(variant);
  const match = analyzeApplication({ resumeText: text, jobDescription: ctx.jd, jobTitle: ctx.jobTitle, company: ctx.company }).overallScore / 100;
  const kw = keywordCoverage(text, ctx.keywords).ratio;
  const health = scoreResume(variant).score / 100;
  const lines = estimateLines(variant);
  const budget = ctx.pages * LINES_PER_PAGE;
  const lengthFit = lines <= budget ? 1 : Math.max(0, 1 - (lines - budget) / 20);
  let dens = 0, mass = 0;
  for (const e of variant.experience) { const rel = ctx.relevanceById.get(e.id) || 0; for (const bl of e.bullets) { const w = Math.max(1, Math.ceil(words(bl.text) / 14)); dens += w * rel; mass += w; } }
  const relevanceDensity = mass ? dens / mass : 0;
  const kept = variant.experience.length;
  const completeness = Math.min(1, kept / Math.min(3, Math.max(1, ctx.totalRoles))) * (variant.basics.summary ? 1 : 0.85);
  let penalty = 0;
  if (!kept) penalty += 1;
  const onPage = new Set([...variant.experience.map((e) => e.id), ...variant.meta.provenance.filter((p) => p.kind === 'condense_role').map((p) => p.itemId)]);
  for (const r of ctx.roles) if (r.current && !onPage.has(r.itemId)) penalty += 0.3;
  const total = 0.4 * match + 0.15 * kw + 0.15 * health + 0.15 * relevanceDensity + 0.1 * lengthFit + 0.05 * completeness - penalty;
  return { total: Number(total.toFixed(4)), match: Number(match.toFixed(3)), keywordCoverage: Number(kw.toFixed(3)), health: Number(health.toFixed(3)), relevanceDensity: Number(relevanceDensity.toFixed(3)), lengthFit: Number(lengthFit.toFixed(3)), completeness: Number(completeness.toFixed(3)), lines, penalty };
}

// ── summary for the target (facts only: titles, employers, competencies the kept roles imply/evidence, one result) ──
const CLUSTER_PHRASE = { retail: 'Customer-facing', sales: 'Sales-focused', customer_service: 'Customer-facing', hospitality: 'Guest-focused', food_service: 'Customer-facing', valet_parking: 'Guest-focused', warehouse: 'Hands-on', delivery_logistics: 'Reliable', skilled_trades: 'Hands-on', operations: 'Operations-minded', administrative: 'Organized', healthcare_support: 'Patient-focused', security: 'Safety-focused', education: 'Student-focused', general: 'Dependable' };
export function composeTargetedSummary(base, plan, ctx) {
  let kept = plan.decisions.filter((d) => d.decision === 'keep' || d.decision === 'trim');
  // An hourly résumé in date order leads its summary with the current relevant job too, the way
  // the page reads (D6) — not with an older job that matched the title.
  const layout = (plan.strategy && plan.strategy.layout) || 'chronological';
  if (CHRONOLOGICAL_FAMILIES.has(ctx.jobFamily) && layout !== 'relevance') {
    const lead = kept.find((d) => d.current && ['core', 'supporting'].includes(d.tier));
    if (lead) kept = [lead, ...kept.filter((d) => d !== lead)];
  }
  const top = kept.slice(0, 2);
  // Years: only the roles this posting finds relevant, each calendar month once, never more than
  // the résumé states itself, and none when under a year (lib/resume/years.js).
  const relevantIds = kept.filter((d) => d.tier === 'core' || d.tier === 'supporting').map((d) => d.itemId);
  const sy = supportedYears(base, { relevantIds, now: ctx.now instanceof Date ? ctx.now : undefined });
  const yearsCheck = sy ? sy.years : null;
  if (!kept.length && !(yearsCheck != null && yearsCheck >= 1)) return { text: '', draft: '', firewall: { ok: false, reason: 'nothing_to_say' }, sources: null };
  const label = (ctx.jobFamilyLabel && ctx.jobFamilyLabel !== 'General') ? ctx.jobFamilyLabel.toLowerCase().replace(/ \/ .*/, '') : '';
  const cluster = CLUSTER_PHRASE[ctx.jobFamily] || 'Dependable';
  // "Customer-facing customer service candidate" says it twice — when the cluster phrase and the
  // family label share a word, the label alone leads.
  const redundant = label && cluster.toLowerCase().split(/[\s-]+/).some((w) => label.split(' ').includes(w));
  const years = yearsCheck;
  // The roles the summary names are the RELEVANT ones (Tasha's "including … and Barista at
  // Starbucks" for a CRM posting); an unrelated role is never offered as the experience.
  const relevantTop = top.filter((d) => d.tier === 'core' || d.tier === 'supporting');
  // The person's own title leads ("Backend Engineer with 6+ years…"), never an adjective Seen chose
  // ("Dependable software engineering candidate" — round 3, shown under "every word is in your résumé").
  const ownTitle = (relevantTop[0] || top[0])?.title ? String((relevantTop[0] || top[0]).title).replace(/\s*[,(–—].*$/, '').replace(/^(?:Senior|Sr\.?|Lead|Junior|Jr\.?)\s+/i, '').trim() : '';
  const lead = ownTitle ? cap(ownTitle) : (redundant ? `${cap(label)} candidate` : `${cluster} ${label ? `${label} ` : ''}candidate`);
  const named = (relevantTop.length ? relevantTop : top.slice(0, 1));
  // with a title leading, the experience line names the employers (the title would repeat itself)
  const exp = (ownTitle ? named.map((d) => (d.title && d.title.replace(/\s*[,(–—].*$/, '').replace(/^(?:Senior|Sr\.?|Lead|Junior|Jr\.?)\s+/i, '').trim().toLowerCase() === ownTitle.toLowerCase() ? d.company : `${d.title}${d.company ? ` at ${d.company}` : ''}`)) : named.map((d) => `${d.title}${d.company ? ` at ${d.company}` : ''}`)).filter(Boolean);
  // Strengths are competencies the posting actually DEMANDS (its competency vector), never a
  // knowledge area a kept role happens to imply ("nutrition knowledge" on a yoga-apparel summary).
  const demand = ctx.jobVec || null;
  const wanted = (c) => !demand || (demand[c] || 0) >= (competencyGroup(c) === 'knowledge' ? 0.6 : 0.3);
  const strengths = [];
  // A strength is a word the résumé itself uses for its own work: "Strengths in hospitality" for a
  // retail lead who never worked in hospitality, "scheduling" for a new grad the same screen says
  // lacks scheduling, "customer service and design" for a backend engineer (2026-10-25) — all
  // competencies a TITLE implied. Now: shown in a bullet AND written in the résumé.
  // (the bullets and the skills list — never the summary's "looking for a sales role")
  const baseText = [...base.experience.flatMap((e) => [e.title, ...e.bullets.map((b) => b.text)]), ...base.skills.flatMap((g) => g.items)].join('\n');
  for (const d of kept.filter((x) => x.tier === 'core' || x.tier === 'supporting')) for (const s of d.shared || []) if (!strengths.includes(s.competency) && competencyGroup(s.competency) !== 'other' && wanted(s.competency) && s.evidenced && hasStemmed(baseText, s.competency)) strengths.push(s.competency);
  const str = strengths.slice(0, 3);
  // Proof: the lead role's best-ranked bullet that carries a number (keptBullets arrive in rank
  // order), so a CSR posting quotes "1,200+ members with a 94% satisfaction score", not the valet
  // line from a lower role.
  // The pick is the strongest NUMBER in rank order: a rate/percent/money/ranking ("94%
  // satisfaction", "top 3 of 12", "40+ memberships per month") beats a small count ("Trained 4
  // new hires"), and among equals the bullet the posting ranks higher wins (recruiter audit N3).
  let proof = '';
  for (const d of kept) {
    const e = base.experience.find((x) => x.id === d.itemId); if (!e) continue;
    const metricBullets = d.keptBullets.map((id) => e.bullets.find((x) => x.id === id)).filter((b) => b && findMetrics(b.text).length);
    const strength = (b) => (/[%$]|\btop\s+\d+\s+of\s+\d+|\bper\s+(?:shift|day|week|month)\b/i.test(b.text) ? 2 : /\b\d{2,}[\d,]*\+?/.test(b.text) ? 1 : 0);
    const pick = metricBullets.reduce((best, b) => (!best || strength(b) > strength(best) ? b : best), null);
    if (pick) { proof = pick.text.replace(/[.;,]+$/, ''); break; }
  }
  const parts = [];
  // "Membership Specialist with 5+ years of experience, most recently at UFC Gym, previously Sales Associate at GNC."
  const [first, ...earlier] = exp;
  const titled = ownTitle && first ? `, most recently at ${first}${earlier.length ? `, previously ${earlier.join(' and ')}` : ''}` : '';
  if (years != null && years >= 1) parts.push(`${lead} with ${years}+ years of experience${exp.length ? (ownTitle ? titled : `, including ${exp.join(' and ')}`) : ''}.`);
  else parts.push(`${lead}${exp.length ? (ownTitle ? titled : ` with experience as ${exp.join(' and as ')}`) : ''}.`);
  if (str.length) parts.push(`Strengths in ${str.length === 1 ? str[0] : `${str.slice(0, -1).join(', ')} and ${str[str.length - 1]}`}.`);
  if (proof) parts.push(`${cap(proof.charAt(0).toLowerCase() + proof.slice(1))}.`);
  const text = parts.join(' ').replace(/\.\./g, '.');
  // Firewall against invention: only words from the résumé, the competency labels the kept roles
  // imply, the family label, and the template connectives.
  const leadWords = (CLUSTER_PHRASE[ctx.jobFamily] || 'Dependable').toLowerCase().split(/[\s-]+/);
  const allowed = [...str.flatMap((s) => s.split(' ')), ...label.split(' '), ...(ownTitle ? [] : leadWords), ...(ownTitle ? [] : [(CLUSTER_PHRASE[ctx.jobFamily] || 'Dependable').toLowerCase()]), 'candidate', 'strengths', 'years', 'experience', 'including', 'most', 'recently', 'previously', 'with', 'as', 'and', 'at', 'in', 'of', String(years)];
  const fw = passesFirewall(serializeToText(base), text, allowed);
  return { text: fw.ok ? text : '', draft: text, firewall: fw, sources: { lead, experience: exp, strengths: str, basis: 'titles + implied competencies of the kept roles', proof: proof || null } };
}

/**
 * Build the optimization plan (decisions + selections + prompts + objective) for a base doc and job.
 * @param {object} base ResumeDoc
 * @param {{ jobTitle, company, jobDescription, keywords, requirements, now?, pages? }} ctx
 */
export function buildPlan(base, ctx) {
  const now = ctx.now || new Date();
  const scored = scoreRoles(base, { jobTitle: ctx.jobTitle, company: ctx.company, jobDescription: ctx.jobDescription, requirements: ctx.requirements, keywords: ctx.keywords, now });
  const jobVec = scored.job.vector;
  const relevanceById = new Map(scored.roles.map((r) => [r.itemId, r.relevance]));
  const pages = ctx.pages || pageBudget(base);
  const evalCtx = { jd: ctx.jobDescription, jobTitle: ctx.jobTitle, company: ctx.company, keywords: ctx.keywords, pages, relevanceById, totalRoles: base.experience.length, roles: scored.roles };
  // Everything applyPlan needs beyond the decisions travels on the plan (serialisable), so the
  // browser re-applies the plan with overrides and gets the SAME variant the server built:
  //   skills   — reorders/additions computed by the caller from the base document (data, not code);
  //   summary  — whether to replace the candidate's own summary, the v1 fact-composed fallback when
  //              the targeted summary has nothing to say, and the posting keywords the old summary
  //              carried (so replacing it never loses one).
  const summaryKeywords = base.basics.summary ? (ctx.keywords || []).filter((kw) => keywordIn(base.basics.summary, kw)).map((kw) => ({ term: kw.term, display: kw.display, weight: kw.weight, surfaces: kw.surfaces || [] })) : [];
  const planCtx = { jobTitle: ctx.jobTitle || '', company: ctx.company || '', jobId: ctx.jobId || '', pages, jobFamily: scored.job.family, jobFamilyLabel: scored.job.familyLabel, jobVec, summary: ctx.replaceSummary !== false, summaryFallback: typeof ctx.summaryFallback === 'string' ? ctx.summaryFallback : '', summaryKeywords };
  const skills = ctx.skillEdits || null;

  // ranked bullets per role (computed once)
  const termWeights = postingTermWeights(ctx.jobDescription || '', { jobTitle: ctx.jobTitle || '', company: ctx.company || '' });
  const termExclude = titleStems(ctx.jobTitle || '');
  const rankedById = new Map(base.experience.map((e) => [e.id, rankBullets(e, jobVec, ctx.keywords, termWeights, termExclude)]));

  // initial decisions
  const bestRel = scored.roles.reduce((m, r) => Math.max(m, r.relevance), 0);
  let decisions = scored.roles.map((r, rank) => {
    const tier = tierOf(r, rank, bestRel);
    const decision = defaultDecision(tier, r);
    return { itemId: r.itemId, title: r.title, company: r.company, tier, decision, relevance: r.relevance, recency: r.recency, tenure: r.tenure, current: r.current, dateless: r.dateless, bullets: r.bullets, family: r.family, familyLabel: r.familyLabel, shared: r.shared, implied: r.implied || [], reasons: [...r.reasons] };
  });
  // constraints: keep at least two roles (or all when fewer); a drop may not open a recent gap
  const enforce = (ds) => {
    const kept = () => new Set(ds.filter((d) => d.decision !== 'drop').map((d) => d.itemId));
    for (const d of ds) if (d.decision === 'drop' && opensGap(base, kept(), now)) { d.decision = 'condense'; d.reasons.push('Kept as a line so the timeline shows no gap.'); }
    const minKeep = Math.min(2, ds.length);
    while (ds.filter((d) => d.decision === 'keep' || d.decision === 'trim').length < minKeep) {
      const next = ds.find((d) => d.decision === 'condense' || d.decision === 'drop');
      if (!next) break;
      next.decision = next.bullets > 3 ? 'trim' : 'keep'; next.reasons.push('Kept so the résumé still has enough experience to read.');
    }
    return ds;
  };
  decisions = enforce(decisions);

  const build = (ds, budgets) => applyPlan(base, { decisions: ds.map((d) => ({ ...d, keptBullets: selectBullets(rankedById.get(d.itemId) || [], Math.min(budgets[d.itemId] ?? budgetFor(d.decision, d.tier), budgetFor(d.decision, d.tier))) })), rankedById, jobVec, roles: scored.roles, skills, ctx: planCtx }, { transferable: true });

  const before = evaluate(base, evalCtx);
  // two seeds: the tiered defaults, and "keep everything" (bullets ranked, summary targeted) — the
  // search starts from whichever scores higher, so trimming is only ever chosen when it wins
  const seedA = { decisions: clone(decisions), budgets: {} };
  const seedB = { decisions: enforce(clone(decisions).map((d) => ({ ...d, decision: 'keep' }))), budgets: {} };
  const scoreA = evaluate(build(seedA.decisions, seedA.budgets), evalCtx), scoreB = evaluate(build(seedB.decisions, seedB.budgets), evalCtx);
  const best = scoreA.total >= scoreB.total ? seedA : seedB;
  let bestScore = scoreA.total >= scoreB.total ? scoreA : scoreB;
  let evaluations = 3;
  // page-budget pass: trim from the least relevant roles until it fits
  for (let guard = 0; guard < 12 && bestScore.lines > pages * LINES_PER_PAGE; guard++) {
    // trim from the role that matters least for this posting: the END of the ranked order (which
    // carries the near-tie recency rule), never the role that leads the page
    const order = new Map(scored.roles.map((r, i) => [r.itemId, i]));
    const cands = best.decisions.filter((d) => d.decision === 'keep' || d.decision === 'trim').sort((a, b) => (order.get(b.itemId) ?? 0) - (order.get(a.itemId) ?? 0));
    // a budget above the role's real bullet count trims nothing — count what the role has
    const eff = (d) => best.budgets[d.itemId] ?? Math.min(budgetFor(d.decision, d.tier), d.bullets || 0);
    const victim = cands.find((d) => eff(d) > 1) || cands[0];
    if (!victim) break;
    const cur = eff(victim);
    if (cur > 1) best.budgets[victim.itemId] = cur - 1; else victim.decision = STEP_DOWN[victim.decision];
    enforce(best.decisions);
    bestScore = evaluate(build(best.decisions, best.budgets), evalCtx); evaluations++;
  }
  // hill-climb over decisions (promote / demote one role at a time), up to two sweeps
  for (let sweep = 0; sweep < 2; sweep++) {
    let improved = false;
    for (let i = 0; i < best.decisions.length; i++) {
      for (const dir of ['up', 'down']) {
        const trial = clone(best.decisions);
        const d = trial[i];
        const next = dir === 'up' ? STEP_UP[d.decision] : STEP_DOWN[d.decision];
        if (next === d.decision) continue;
        if (dir === 'down' && d.current && next === 'drop') continue;
        d.decision = next;
        enforce(trial);
        const s = evaluate(build(trial, best.budgets), evalCtx); evaluations++;
        if (s.total > bestScore.total + 0.003) { best.decisions = trial; bestScore = s; improved = true; d.reasons.push(dir === 'up' ? 'Promoted: the whole résumé scored higher with more of this role.' : 'Reduced: the whole résumé scored higher with less of this role.'); }
        if (evaluations >= 60) break;
      }
      if (evaluations >= 60) break;
    }
    if (!improved || evaluations >= 60) break;
  }
  // final decisions with selections
  const decisionsOut = best.decisions.map((d) => {
    const ranked = rankedById.get(d.itemId) || [];
    const budget = Math.min(best.budgets[d.itemId] ?? budgetFor(d.decision, d.tier), budgetFor(d.decision, d.tier));
    const keptBullets = selectBullets(ranked, budget);
    const dropped = ranked.filter((r) => !keptBullets.includes(r.bulletId)).map((r) => r.bulletId);
    const why = [...d.reasons];
    // The reason says what the page does: "Kept in full" only when every bullet is kept, and never
    // "relevant" for a role the posting does not need (Tasha's barista role read "Not relevant ·
    // 15% fit" and "Kept in full — relevant supporting experience", 2026-10-25).
    const total = (base.experience.find((e) => e.id === d.itemId) || { bullets: [] }).bullets.length;
    const full = keptBullets.length >= total;
    const what = d.tier === 'core' ? 'this is your most relevant experience for this posting'
      : d.tier === 'supporting' ? 'relevant supporting experience'
      : d.current ? 'it is your current job, so it stays on the page — it is not what this posting asks about'
      : 'it keeps your timeline complete — it is not what this posting asks about';
    if (d.decision === 'keep') why.unshift(full ? `Kept in full — ${what}.` : `Kept with ${keptBullets.length} of ${total} bullets (the strongest for this posting, inside the page budget) — ${what}.`);
    if (d.decision === 'trim') why.unshift(`Trimmed to the ${keptBullets.length} bullet${keptBullets.length === 1 ? '' : 's'} that speak to this posting.`);
    if (d.decision === 'condense') why.unshift('Kept as one line under Additional Experience — it shows continuity without taking space from relevant roles.');
    if (d.decision === 'drop') why.unshift('Left off this version — it does not help this application and the timeline stays intact.');
    return { ...d, keptBullets, droppedBullets: dropped, ranked: ranked.map((r) => ({ bulletId: r.bulletId, score: r.score, competencies: r.competencies, keywords: r.keywords, postingTerms: r.postingTerms })), reasons: why, overridable: true };
  });
  const layout = decideLayout(base, decisionsOut, scored.job.family);
  // Under the relevance layout every kept role outside core/supporting is shown as a line, so
  // label it that way: the decision table must say what the page does.
  if (layout === 'relevance') for (const d of decisionsOut) if (!['core', 'supporting'].includes(d.tier) && (d.decision === 'keep' || d.decision === 'trim')) { d.decision = 'condense'; d.keptBullets = []; d.reasons.unshift('Shown as one line under Additional Experience — the relevant roles lead this version.'); }
  const rewrites = planRewrites(base, decisionsOut);
  const plan = { decisions: decisionsOut, rankedById, jobVec, roles: scored.roles, skills, strategy: { layout }, ctx: planCtx, rewrites, applyRewrites: false };
  const finalVariant = applyPlan(base, plan, { transferable: true });
  const after = evaluate(finalVariant, evalCtx);
  const order = finalVariant.experience.map((e) => e.id);
  return {
    version: OPTIMIZER_VERSION,
    job: scored.job,
    roles: scored.roles,
    ctx: planCtx,
    skills,
    decisions: decisionsOut.map((d) => { const { ranked, ...rest } = d; return { ...rest, ranked }; }),
    strategy: { layout, pages, estimatedLines: after.lines, linesBudget: pages * LINES_PER_PAGE, order, summaryMode: 'targeted' },
    // suggestions the person may add (none is in the variant until they do)
    added: finalVariant.meta.provenance.filter((p) => p.kind === 'transferable_bullet' || p.kind === 'transferable_suggestion'),
    rewrites,
    prompts: buildPrompts(base, decisionsOut, scored),
    summary: finalVariant.meta.provenance.find((p) => p.kind === 'summary') ? { text: finalVariant.basics.summary, replaced: base.basics.summary || '', sources: finalVariant.meta.provenance.find((p) => p.kind === 'summary').sources, targeted: finalVariant.meta.provenance.find((p) => p.kind === 'summary').targeted !== false } : null,
    objective: { before, after, evaluations },
    variant: finalVariant,
  };
}

// Hourly / store-level families read a résumé top-down by date: a recruiter for a cashier or a
// warehouse posting wants the current job first and reads "Relevant Experience" over an older
// role as a gap (the 2026-10-24 audit's Tailor put GNC 2020–22 above the current job and then
// warned about the 22-month hole it had created). These families stay chronological by default;
// the Studio toggle still offers the relevance layout and says when it reorders dates.
export const CHRONOLOGICAL_FAMILIES = new Set(['retail', 'customer_service', 'food_service', 'hospitality', 'valet_parking', 'warehouse', 'delivery_logistics', 'security', 'general']);
// Wording proposals for the kept bullets: the rewrite engine's tense/lead/filler changes, each a
// before → after the person accepts or rejects in the Studio (default: rejected). The 2026-10-24
// audits found the Tailor applying them unconditionally and exporting "Sell and renewed 40+
// memberships" and "Bill questions, freezes and cancellations" under the current role.
// A bullet that reports a completed result: a year, a from→to change, a period ("in 7 months",
// "over 18 months") or any measured outcome.
const RATE_PHRASE = /\bper\s+[a-z]+|\b(?:a|each|every)\s+(?:day|week|shift|month|quarter|year)\b|\b(?:daily|weekly|monthly|nightly|hourly)\b/i;
export function completedResult(text) {
  const t = String(text || '');
  // an ongoing rate ("40+ memberships per month") is the current job and takes the present tense
  return /\b(?:19|20)\d{2}\b/.test(t) || /\bfrom\s+\S+\s+to\s+\S+/i.test(t) || /\b(?:in|over|within)\s+\d+\s+(?:days?|weeks?|months?|quarters?|years?)\b/i.test(t)
    || (/^\s*(?:grew|raised|cut|reduced|increased|improved|boosted|lifted|lowered|launched|won|achieved|saved|completed|delivered|passed|doubled|tripled|exceeded|beat|opened|closed|migrated|introduced|built|led|shipped|rolled)\b/i.test(t) && findMetrics(t).length > 0)
    // a counted past event with no rate ("Precepted 7 new graduate nurses through orientation")
    || (/^\s*[A-Z][a-z]+ed\b/.test(t) && /\d/.test(t) && !RATE_PHRASE.test(t));
}

export function planRewrites(base, decisions) {
  const out = [];
  for (const d of decisions) {
    if (d.decision !== 'keep' && d.decision !== 'trim') continue;
    const e = base.experience.find((x) => x.id === d.itemId);
    if (!e) continue;
    const roleTense = e.end === 'present' ? 'present' : 'past';
    for (const id of d.keptBullets || []) {
      const b = e.bullets.find((x) => x.id === id);
      if (!b) continue;
      // A finished, measured result stays in the past tense even in a current role: "Grew store
      // sales 9% … in 2023" → "Grow store sales 9% … in 2023" (harness 2026-10-25).
      const tense = roleTense === 'present' && completedResult(b.text) ? 'past' : roleTense;
      const rw = rewriteBullet(b.text, { tense });
      if (rw.unchanged || !rw.changes.some((c) => c.rule !== 'hygiene') || (rw.firewall && rw.firewall.ok === false)) continue;
      out.push({ bulletId: b.id, itemId: e.id, from: b.text, to: rw.text, rules: [...new Set(rw.changes.map((c) => c.rule))], tense });
    }
  }
  return out;
}

function decideLayout(base, decisions, jobFamily = '') {
  const kept = decisions.filter((d) => d.decision === 'keep' || d.decision === 'trim');
  if (kept.length < 2) return 'chronological';
  const dated = kept.filter((d) => !d.dateless);
  const byDate = [...dated].sort((a, b) => { const ea = base.experience.find((e) => e.id === a.itemId), eb = base.experience.find((e) => e.id === b.itemId); return monthIndex(eb.end === 'present' ? '9999-12' : eb.end, 0) - monthIndex(ea.end === 'present' ? '9999-12' : ea.end, 0); });
  const top = kept[0];
  const pos = byDate.findIndex((d) => d.itemId === top.itemId);
  // dateless roles land after every dated one in a chronological list, so a dateless top role
  // behind two or more dated roles also wants the relevance layout
  const effective = pos >= 0 ? pos : byDate.length;
  if (effective < 2) return 'chronological';
  // Hourly families: reorder dates only to get past a role from a DIFFERENT field (tier omit /
  // context) sitting above the lead role — never to put an older same-cluster job over the
  // current one.
  if (CHRONOLOGICAL_FAMILIES.has(jobFamily)) {
    const above = byDate.slice(0, pos >= 0 ? pos : byDate.length);
    if (!above.some((d) => d.tier === 'omit' || d.tier === 'context')) return 'chronological';
  }
  return 'relevance';
}

function buildPrompts(base, decisions, scored) {
  const prompts = [];
  for (const d of decisions) {
    if (d.decision !== 'keep' && d.decision !== 'trim') continue;
    const role = scored.roles.find((r) => r.itemId === d.itemId);
    const e = base.experience.find((x) => x.id === d.itemId);
    if (!role || !e) continue;
    const hasMetric = e.bullets.some((b) => findMetrics(b.text).length);
    if (e.bullets.length >= 2 && hasMetric) continue;
    const fam = role.family === 'general' ? GENERAL_FAMILY : (ROLE_FAMILIES[role.family] || GENERAL_FAMILY);
    if (!e.start && !e.end && !e.dateText) prompts.push({ id: `p_${d.itemId}_dates`, itemId: d.itemId, roleTitle: e.title, company: e.company, kind: 'dates', question: 'When did you work here? (e.g. "Jun 2021 – Mar 2023")', unit: 'dates', why: 'Dates let a recruiter place this role — without them the most relevant job on the page looks unverified.' });
    (fam.metrics || []).slice(0, 2).forEach((m, i) => prompts.push({ id: `p_${d.itemId}_${i}`, itemId: d.itemId, roleTitle: e.title, company: e.company, kind: 'metric', question: m.q, unit: m.unit, why: e.bullets.length ? 'A real number here makes this role your strongest evidence.' : 'This role matters for this posting but has no bullets yet — one true number makes it count.' }));
    if (prompts.length >= 6) break;
  }
  return prompts.slice(0, 8);
}

/**
 * Apply a plan to the base doc → variant. Pure.
 * overrides: { decisions?: {[itemId]: 'keep'|'trim'|'condense'|'drop'}, bullets?: {[itemId]: string[]}, summary?: boolean,
 *              transferable?: boolean, excludeAdded?: ['itemId:competency'], layout?: 'chronological'|'relevance',
 *              answers?: {[promptId]: string}, prompts?: [] }
 */
export function applyPlan(base, plan, overrides = {}) {
  const now = new Date();
  const v = normalizeDoc(clone(base));
  v.id = newId('doc'); v.kind = 'variant'; v.meta.baseDocId = base.id; v.meta.source = 'tailor'; v.meta.provenance = [];
  const decs = plan.decisions.map((d) => ({ ...d, decision: (overrides.decisions && overrides.decisions[d.itemId]) || d.decision }));
  const ctx = plan.ctx || {};
  const acceptAll = overrides.rewrites === true || (overrides.rewrites === undefined && plan.applyRewrites === true);
  const acceptIds = new Set(Array.isArray(overrides.rewrites) ? overrides.rewrites : []);
  const acceptedRewrites = new Map((plan.rewrites || []).filter((r) => acceptAll || acceptIds.has(r.bulletId)).map((r) => [r.bulletId, r]));
  const keptRoles = [];
  const condensed = [];
  for (const d of decs) {
    const e = v.experience.find((x) => x.id === d.itemId);
    if (!e) continue;
    if (d.decision === 'drop') { v.meta.provenance.push({ kind: 'drop_role', itemId: e.id, title: e.title, company: e.company, reason: (d.reasons || [])[0] || '' }); continue; }
    if (d.decision === 'condense') { condensed.push(e); v.meta.provenance.push({ kind: 'condense_role', itemId: e.id, title: e.title, company: e.company, reason: (d.reasons || [])[0] || '' }); continue; }
    const ranked = (plan.rankedById && plan.rankedById.get(e.id)) || (d.ranked || []).map((r) => ({ ...r, text: (e.bullets.find((b) => b.id === r.bulletId) || {}).text || '' }));
    const budget = budgetFor(d.decision, d.tier);
    const chosen = (overrides.bullets && overrides.bullets[e.id]) || (d.keptBullets && d.keptBullets.length && (overrides.decisions || {})[e.id] == null ? d.keptBullets : selectBullets(ranked, budget));
    const before = e.bullets.map((b) => b.id);
    const kept = chosen.map((id) => e.bullets.find((b) => b.id === id)).filter(Boolean);
    const dropped = e.bullets.filter((b) => !chosen.includes(b.id));
    // Wording proposals (plan.rewrites) apply ONLY when accepted: overrides.rewrites is `true` (all),
    // an array of accepted bulletIds, or absent → plan.applyRewrites (false by default).
    e.bullets = kept.map((b) => { const rw = acceptedRewrites.get(b.id); if (rw && rw.from === b.text) { v.meta.provenance.push({ kind: 'rewrite', bulletId: b.id, from: b.text, to: rw.to, rules: rw.rules || [], accepted: true }); return { ...b, text: rw.to }; } return b; });
    if (dropped.length) v.meta.provenance.push({ kind: 'trim_bullets', itemId: e.id, removed: dropped.map((b) => ({ bulletId: b.id, text: b.text })), reason: 'Not about this posting — kept in your base résumé.' });
    if (before.join() !== e.bullets.map((b) => b.id).join() && e.bullets.length > 1) v.meta.provenance.push({ kind: 'reorder_bullets', itemId: e.id, from: before, to: e.bullets.map((b) => b.id), reason: 'Bullets that speak to this posting lead the role.' });
    // transferable fill for thin relevant roles
    if (overrides.transferable !== false && (d.tier === 'core' || d.tier === 'supporting') && e.bullets.length < 2) {
      const have = new Set(e.bullets.flatMap((b) => Object.keys(termCompetencies(b.text).vector)));
      const role = (plan.roles || []).find((r) => r.itemId === e.id) || d;
      const noun = /membership|gym|fitness|club/i.test(`${e.title} ${e.company}`) ? 'members' : (NOUN[d.family] || 'customers');
      // candidates: the job's demanded competencies this role covers, specific ones before generic
      // ones, and a role's own specific competency ("membership sales") standing in for the generic
      // one it implies ("sales")
      const implied = new Set(d.implied || role.implied || []);
      const cands = [...(d.shared || [])].map((s) => ({ ...s, generic: GENERIC_GROUPS.has(competencyGroup(s.competency)) }));
      for (const [specific, generic] of Object.entries(SPECIFIC_OVER)) if (implied.has(specific) && cands.some((c) => c.competency === generic) && !cands.some((c) => c.competency === specific)) cands.unshift({ competency: specific, demand: 1, have: 1, generic: false, standsFor: generic });
      cands.sort((a, b) => (a.generic - b.generic) || (b.demand * b.have - a.demand * a.have));
      // These lines are written from what a title implies, not from anything the person wrote.
      // They are SUGGESTIONS: a line enters the variant (and so the export and the polish) only
      // when the person adds it (overrides.includeAdded "itemId:competency"). The harness and the
      // test users found "Resolved day-to-day problems on the spot…" and "Provided front-line
      // customer service to shoppers throughout every shift." shipped in exported PDFs (2026-10-25).
      let suggested = 0;
      const included = new Set(overrides.includeAdded || []);
      const excluded = new Set(overrides.excludeAdded || []);
      let slots = Math.max(0, 2 - e.bullets.length);
      for (const s of cands) {
        if (suggested >= 2 || slots <= 0) break;
        if (have.has(s.competency) || !TRANSFER[s.competency]) continue;
        if (s.standsFor && have.has(s.standsFor)) continue;
        const key = `${e.id}:${s.competency}`;
        if (excluded.has(key)) continue;
        const text = `${TRANSFER[s.competency]({ noun, title: e.title })}.`;
        have.add(s.competency); if (s.standsFor) have.add(s.standsFor); if (SPECIFIC_OVER[s.competency]) have.add(SPECIFIC_OVER[s.competency]); suggested++;
        const meta = { itemId: e.id, key, text, competency: s.competency, basis: `${role.familyLabel || d.familyLabel} work — ${e.title}`, confirm: true, reason: `Written from what a ${e.title || 'role like this'} inherently involves. Add it only if it is true.` };
        if (included.has(key)) {
          const nb = { id: newId('b'), text };
          e.bullets.push(nb); slots--;
          v.meta.provenance.push({ kind: 'transferable_bullet', bulletId: nb.id, confirmed: true, ...meta });
        } else {
          v.meta.provenance.push({ kind: 'transferable_suggestion', bulletId: null, confirmed: false, ...meta });
        }
      }
    }
    // answered prompts become dates or bullets
    for (const p of overrides.prompts || []) {
      if (p.itemId !== e.id) continue;
      const ans = overrides.answers && overrides.answers[p.id];
      if (!ans) continue;
      if (p.kind === 'dates') {
        const r = findDateRange(String(ans)) || { start: '', end: '' };
        const single = !r.start ? parseDateToken(String(ans).trim()) : null;
        e.start = r.start || (single && single !== 'present' ? toToken(single) : ''); e.end = r.end || ''; e.dateText = String(ans).trim();
        v.meta.provenance.push({ kind: 'answered_dates', itemId: e.id, text: e.dateText, promptId: p.id, reason: 'Dates from your answer.' });
        continue;
      }
      const text = bulletFromAnswer(p, ans);
      if (!text) continue;
      const nb = { id: newId('b'), text };
      e.bullets.unshift(nb);
      v.meta.provenance.push({ kind: 'answered_bullet', itemId: e.id, bulletId: nb.id, text, promptId: p.id, reason: 'From your answer — a number you gave us, in your words.' });
    }
    keptRoles.push(e);
  }
  // order: reverse-chronological among dated kept roles, dateless by relevance after; relevance layout puts core first
  const relOf = (e) => (decs.find((d) => d.itemId === e.id) || {}).relevance || 0;
  const nowM = now.getUTCFullYear() * 12 + now.getUTCMonth() + 1;
  const endM = (e) => (e.end === 'present' ? nowM + 1 : e.end ? monthIndex(e.end, 0) : e.start ? monthIndex(e.start, 0) : -1);
  const layout = overrides.layout || (plan.strategy && plan.strategy.layout) || decideLayout(base, decs, ctx.jobFamily);
  if (layout === 'relevance') {
    // "Relevant Experience" holds the core/supporting roles in relevance order; every other kept
    // role becomes a one-line entry under "Additional Experience" so continuity stays visible
    // without burying the relevant roles under a reverse-chronological irrelevant one.
    const tierOfId = new Map(decs.map((d) => [d.itemId, d.tier]));
    const relevant = keptRoles.filter((e) => ['core', 'supporting'].includes(tierOfId.get(e.id)));
    const others = keptRoles.filter((e) => !['core', 'supporting'].includes(tierOfId.get(e.id)));
    if (relevant.length >= 1 && others.length) {
      for (const e of others) { condensed.push(e); v.meta.provenance.push({ kind: 'condense_role', itemId: e.id, title: e.title, company: e.company, reason: 'Relevance layout: shown as a line under Additional Experience so the relevant roles lead.' }); }
      keptRoles.length = 0; keptRoles.push(...relevant);
    }
    keptRoles.sort((a, b) => relOf(b) - relOf(a) || endM(b) - endM(a));
    v.meta.sectionTitles = { ...(v.meta.sectionTitles || {}), experience: 'Relevant Experience' };
  } else keptRoles.sort((a, b) => { const da = endM(a), db = endM(b); if (da < 0 && db < 0) return relOf(b) - relOf(a); if (da < 0) return 1; if (db < 0) return -1; return db - da; });
  v.experience = keptRoles;
  if (condensed.length) {
    condensed.sort((a, b) => endM(b) - endM(a));
    const items = condensed.map((e) => ({ id: newId('b'), text: `${[e.title, e.company].filter(Boolean).join(' — ')}${[formatRange(e.start, e.end) || e.dateText, e.employmentType].filter(Boolean).length ? ` (${[formatRange(e.start, e.end) || e.dateText, e.employmentType].filter(Boolean).join(', ')})` : ''}` }));
    const existing = v.extra.find((x) => x.title === 'Additional Experience');
    if (existing) existing.items.push(...items); else { const x = { id: newId('z'), kind: 'custom', title: 'Additional Experience', style: 'lines', items }; v.extra.push(x); const idx = v.sectionOrder.indexOf('experience'); v.sectionOrder.splice(idx >= 0 ? idx + 1 : v.sectionOrder.length, 0, `extra:${x.id}`); }
  }
  if (!v.experience.length) v.sectionOrder = v.sectionOrder.filter((k) => k !== 'experience');
  v.meta.provenance.push({ kind: 'layout', layout, pages: ctx.pages || pageBudget(base), reason: layout === 'relevance' ? 'Most relevant roles first — your strongest match is not your most recent job.' : 'Reverse-chronological, with less relevant roles condensed.' });
  // skills: the posting's matched skills first, evidenced-but-unlisted skills added (plan data)
  if (overrides.skills !== false) applySkillEdits(v, plan.skills);
  // terminology: mirror the posting's exact phrase where a bullet uses an alias — only when asked
  if (overrides.terminology ?? plan.applyTerminology) applyTerminology(v, plan.terminology);
  // summary
  if (overrides.summary ?? ctx.summary !== false) {
    const s = composeTargetedSummary(base, { decisions: decs.map((d) => ({ ...d, keptBullets: (v.experience.find((e) => e.id === d.itemId) || { bullets: [] }).bullets.map((b) => b.id) })) }, ctx);
    const targeted = !!s.text;
    let text = s.text || ctx.summaryFallback || '';
    const sources = targeted ? s.sources : (text ? { basis: 'current title, years, matched strengths and a real result from the résumé' } : null);
    if (text && base.basics.summary) {
      // Replacing the candidate's own summary must never lose a posting keyword that only it
      // carried: keep those sentences (their words, verbatim) after the composed lines.
      const probe = serializeToText({ ...v, basics: { ...v.basics, summary: text } });
      const kept = [];
      for (const kw of ctx.summaryKeywords || []) {
        if (keywordIn(probe, kw)) continue;
        const sentence = base.basics.summary.split(/(?<=[.!?])\s+/).find((sn) => keywordIn(sn, kw));
        if (sentence && !kept.includes(sentence)) kept.push(sentence);
      }
      // …nor a FACT only it states: a licence or exam ("Passed FAR and AUD sections of the CPA
      // exam"), a language ("Bilingual English/Spanish"), or a number ("teams of up to 18") the
      // composed lines do not carry (harness #19 and Maria, 2026-10-25).
      const FACT_RE = /\b(?:licen[cs]e[ds]?|certif\w*|exam|cpa|rn|cdl|bilingual|fluent|spanish|french|mandarin|portuguese|vietnamese|tagalog|arabic|korean)\b/i;
      const nums = (t) => (String(t).match(/\d[\d,.]*\+?/g) || []).map((n) => n.replace(/[,+]/g, ''));
      for (const sentence of base.basics.summary.split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean)) {
        if (kept.includes(sentence) || text.includes(sentence)) continue;
        const newNumber = nums(sentence).some((n) => !nums(`${text} ${kept.join(' ')}`).includes(n));
        const newFact = FACT_RE.test(sentence) && !(sentence.match(FACT_RE) || []).every((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(`${text} ${kept.join(' ')}`));
        if (newNumber || newFact) kept.push(sentence);
      }
      // at most ONE sentence of the old summary rides along: when every sentence carries a number, keeping them all
      // pasted the person's whole summary after the composed one (round 7, Dev: "…Strengths in design. Backend
      // engineer with 6 years building payment and ledger systems… Owned services processing $1.2B/year…")
      const keep = kept.slice(0, 1);
      if (keep.length) { text = `${text} ${keep.join(' ')}`; sources.keptSentences = keep; }
    }
    if (text) {
      v.meta.provenance.push({ kind: 'summary', from: base.basics.summary, to: text, sources, targeted, reason: targeted ? 'Composed for this posting from your titles, employers and the strengths your roles imply — nothing from the posting.' : 'Composed from your own titles, years, matched strengths and a real result.' });
      v.basics.summary = text;
      if (!v.sectionOrder.includes('summary')) v.sectionOrder.unshift('summary');
    }
  }
  v.meta.tailoredFor = { company: ctx.company || '', role: ctx.jobTitle || '', jobId: ctx.jobId || '' };
  return v;
}

/**
 * Skills edits are DATA on the plan (computed by the caller from the base document, see
 * tailor.js planSkillEdits): { reorders: [{ groupId, from, to }], additions: [{ groupId|null, term,
 * evidence, why }] }. Applied identically on the server and in the browser.
 */
export function applySkillEdits(v, edits) {
  if (!edits) return;
  for (const r of edits.reorders || []) {
    const g = v.skills.find((x) => x.id === r.groupId);
    if (!g || !Array.isArray(r.to) || r.to.length !== g.items.length || !r.to.every((it) => g.items.includes(it))) continue;
    g.items = [...r.to];
  }
  let target = null;
  for (const a of edits.additions || []) {
    if (!a || !a.term) continue;
    if (!target) {
      target = (a.groupId && v.skills.find((x) => x.id === a.groupId)) || v.skills.find((g) => !g.label) || v.skills[0] || null;
      if (!target) { target = { id: newId('s'), label: '', items: [] }; v.skills.push(target); if (!v.sectionOrder.includes('skills')) v.sectionOrder.push('skills'); }
    }
    const item = a.listed || a.term; // the list's casing ("Forklifts" in a Title Case list)
    if (target.items.some((it) => it.toLowerCase() === item.toLowerCase())) continue;
    target.items.push(item);
    v.meta.provenance.push({ kind: 'add_skill', groupId: target.id, term: item, evidence: a.evidence || '', reason: a.why || '' });
  }
}

const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordRe = (p) => new RegExp(`(?<![A-Za-z0-9])${escRe(p).replace(/ /g, '\\s+')}(?![A-Za-z0-9])`, 'i');

/** Terminology swaps [{ bulletId, itemId, alias, term }] — proposals on the plan, applied only when asked. */
export function applyTerminology(v, swaps) {
  for (const t of swaps || []) {
    const e = v.experience.find((x) => x.id === t.itemId);
    const bl = e && e.bullets.find((x) => x.id === t.bulletId);
    if (!bl) continue;
    const replaced = bl.text.replace(wordRe(t.alias), t.term);
    if (replaced === bl.text) continue;
    v.meta.provenance.push({ kind: 'terminology', bulletId: bl.id, from: bl.text, to: replaced, reason: `The posting says "${t.term}".` });
    bl.text = replaced;
  }
}

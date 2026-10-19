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
import { findMetrics, analyzeBullet } from '../health/bullet.js';
import { rewriteBullet, passesFirewall } from '../rewrite/rules.js';
import { formatRange, fromToken, findDateRange, parseDateToken, toToken } from '../parse/dates.js';

export const OPTIMIZER_VERSION = 'optimizer_v1';

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

function pageBudget(doc) {
  const years = experienceSpanYears(doc);
  return years != null && years >= 10 ? 2 : 1;
}

// ── bullet ranking inside a role ──
function rankBullets(role, jobVec, keywords) {
  return role.bullets.map((b) => {
    const { vector } = termCompetencies(b.text);
    const cov = coverage(jobVec, vector);
    const kw = scoreBulletKeywords(b.text, keywords);
    const a = analyzeBullet(b.text);
    const impact = (findMetrics(b.text).length ? 0.6 : 0) + (a.lead.kind === 'strong' || a.lead.kind === 'verb' ? 0.4 : a.lead.kind === 'generic' ? 0.2 : 0);
    const score = 0.5 * cov.score + 0.3 * Math.min(1, kw.score / 1.2) + 0.2 * impact;
    return { bulletId: b.id, text: b.text, score: Number(score.toFixed(3)), competencies: cov.shared.slice(0, 3).map((s) => s.competency), keywords: kw.hits.map((h) => h.requirement), impact: Number(impact.toFixed(2)) };
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
  if ((rank < 2 && role.relevance >= 0.15 && rel >= 0.75) || role.relevance >= 0.45) return 'core';
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
  const kept = plan.decisions.filter((d) => d.decision === 'keep' || d.decision === 'trim');
  const top = kept.slice(0, 2);
  const yearsCheck = experienceSpanYears(base);
  if (!kept.length && !(yearsCheck != null && yearsCheck >= 1)) return { text: '', draft: '', firewall: { ok: false, reason: 'nothing_to_say' }, sources: null };
  const label = (ctx.jobFamilyLabel && ctx.jobFamilyLabel !== 'General') ? ctx.jobFamilyLabel.toLowerCase().replace(/ \/ .*/, '') : '';
  const lead = `${CLUSTER_PHRASE[ctx.jobFamily] || 'Dependable'} ${label ? `${label} ` : ''}candidate`;
  const years = experienceSpanYears(base);
  const exp = top.map((d) => `${d.title}${d.company ? ` at ${d.company}` : ''}`).filter(Boolean);
  const strengths = [];
  for (const d of kept) for (const s of d.shared || []) if (!strengths.includes(s.competency) && competencyGroup(s.competency) !== 'other') strengths.push(s.competency);
  const str = strengths.slice(0, 3);
  let proof = '';
  for (const d of kept) { const e = base.experience.find((x) => x.id === d.itemId); if (!e) continue; for (const b of e.bullets) if (d.keptBullets.includes(b.id) && findMetrics(b.text).length) { proof = b.text.replace(/[.;,]+$/, ''); break; } if (proof) break; }
  const parts = [];
  parts.push(`${lead}${years != null && years >= 1 ? ` with ${years}+ years of experience` : ''}${exp.length ? `, including ${exp.join(' and ')}` : ''}.`);
  if (str.length) parts.push(`Strengths in ${str.length === 1 ? str[0] : `${str.slice(0, -1).join(', ')} and ${str[str.length - 1]}`}.`);
  if (proof) parts.push(`${cap(proof.charAt(0).toLowerCase() + proof.slice(1))}.`);
  const text = parts.join(' ').replace(/\.\./g, '.');
  // Firewall against invention: only words from the résumé, the competency labels the kept roles
  // imply, the family label, and the template connectives.
  const leadWords = (CLUSTER_PHRASE[ctx.jobFamily] || 'Dependable').toLowerCase().split(/[\s-]+/);
  const allowed = [...str.flatMap((s) => s.split(' ')), ...label.split(' '), ...leadWords, (CLUSTER_PHRASE[ctx.jobFamily] || 'Dependable').toLowerCase(), 'candidate', 'strengths', 'years', 'experience', 'including', 'with', 'and', 'at', 'in', 'of', String(years)];
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
  const scored = scoreRoles(base, { jobTitle: ctx.jobTitle, jobDescription: ctx.jobDescription, requirements: ctx.requirements, keywords: ctx.keywords, now });
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
  const planCtx = { jobTitle: ctx.jobTitle || '', company: ctx.company || '', jobId: ctx.jobId || '', pages, jobFamily: scored.job.family, jobFamilyLabel: scored.job.familyLabel, summary: ctx.replaceSummary !== false, summaryFallback: typeof ctx.summaryFallback === 'string' ? ctx.summaryFallback : '', summaryKeywords };
  const skills = ctx.skillEdits || null;

  // ranked bullets per role (computed once)
  const rankedById = new Map(base.experience.map((e) => [e.id, rankBullets(e, jobVec, ctx.keywords)]));

  // initial decisions
  const bestRel = scored.roles.length ? scored.roles[0].relevance : 0;
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
  let variantA = build(seedA.decisions, seedA.budgets), variantB = build(seedB.decisions, seedB.budgets);
  let scoreA = evaluate(variantA, evalCtx), scoreB = evaluate(variantB, evalCtx);
  let best = scoreA.total >= scoreB.total ? seedA : seedB;
  let variant = scoreA.total >= scoreB.total ? variantA : variantB;
  let bestScore = scoreA.total >= scoreB.total ? scoreA : scoreB;
  let evaluations = 3;
  // page-budget pass: trim from the least relevant roles until it fits
  for (let guard = 0; guard < 12 && bestScore.lines > pages * LINES_PER_PAGE; guard++) {
    const cands = best.decisions.filter((d) => d.decision === 'keep' || d.decision === 'trim').sort((a, b) => a.relevance - b.relevance);
    const victim = cands.find((d) => (best.budgets[d.itemId] ?? budgetFor(d.decision, d.tier)) > 1) || cands[0];
    if (!victim) break;
    const cur = best.budgets[victim.itemId] ?? budgetFor(victim.decision, victim.tier);
    if (cur > 1) best.budgets[victim.itemId] = cur - 1; else victim.decision = STEP_DOWN[victim.decision];
    enforce(best.decisions);
    variant = build(best.decisions, best.budgets); bestScore = evaluate(variant, evalCtx); evaluations++;
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
        const v = build(trial, best.budgets);
        const s = evaluate(v, evalCtx); evaluations++;
        if (s.total > bestScore.total + 0.003) { best.decisions = trial; bestScore = s; variant = v; improved = true; d.reasons.push(dir === 'up' ? 'Promoted: the whole résumé scored higher with more of this role.' : 'Reduced: the whole résumé scored higher with less of this role.'); }
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
    if (d.decision === 'keep') why.unshift(`Kept in full — ${d.tier === 'core' ? 'this is your most relevant experience for this posting' : 'relevant supporting experience'}.`);
    if (d.decision === 'trim') why.unshift(`Trimmed to the ${keptBullets.length} bullet${keptBullets.length === 1 ? '' : 's'} that speak to this posting.`);
    if (d.decision === 'condense') why.unshift('Kept as one line under Additional Experience — it shows continuity without taking space from relevant roles.');
    if (d.decision === 'drop') why.unshift('Left off this version — it does not help this application and the timeline stays intact.');
    return { ...d, keptBullets, droppedBullets: dropped, ranked: ranked.map((r) => ({ bulletId: r.bulletId, score: r.score, competencies: r.competencies, keywords: r.keywords })), reasons: why, overridable: true };
  });
  const layout = decideLayout(base, decisionsOut);
  // Under the relevance layout every kept role outside core/supporting is shown as a line, so
  // label it that way: the decision table must say what the page does.
  if (layout === 'relevance') for (const d of decisionsOut) if (!['core', 'supporting'].includes(d.tier) && (d.decision === 'keep' || d.decision === 'trim')) { d.decision = 'condense'; d.keptBullets = []; d.reasons.unshift('Shown as one line under Additional Experience — the relevant roles lead this version.'); }
  const plan = { decisions: decisionsOut, rankedById, jobVec, roles: scored.roles, skills, strategy: { layout }, ctx: planCtx };
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
    added: finalVariant.meta.provenance.filter((p) => p.kind === 'transferable_bullet'),
    prompts: buildPrompts(base, decisionsOut, scored),
    summary: finalVariant.meta.provenance.find((p) => p.kind === 'summary') ? { text: finalVariant.basics.summary, replaced: base.basics.summary || '', sources: finalVariant.meta.provenance.find((p) => p.kind === 'summary').sources, targeted: finalVariant.meta.provenance.find((p) => p.kind === 'summary').targeted !== false } : null,
    objective: { before, after, evaluations },
    variant: finalVariant,
  };
}

function decideLayout(base, decisions) {
  const kept = decisions.filter((d) => d.decision === 'keep' || d.decision === 'trim');
  if (kept.length < 2) return 'chronological';
  const dated = kept.filter((d) => !d.dateless);
  const byDate = [...dated].sort((a, b) => { const ea = base.experience.find((e) => e.id === a.itemId), eb = base.experience.find((e) => e.id === b.itemId); return monthIndex(eb.end === 'present' ? '9999-12' : eb.end, 0) - monthIndex(ea.end === 'present' ? '9999-12' : ea.end, 0); });
  const top = kept[0];
  const pos = byDate.findIndex((d) => d.itemId === top.itemId);
  // dateless roles land after every dated one in a chronological list, so a dateless top role
  // behind two or more dated roles also wants the relevance layout
  const effective = pos >= 0 ? pos : byDate.length;
  return effective >= 2 ? 'relevance' : 'chronological';
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
    e.bullets = kept.map((b) => { const rw = rewriteBullet(b.text, { tense: e.end === 'present' ? 'present' : 'past' }); if (!rw.unchanged && rw.changes.some((c) => c.rule !== 'hygiene') && rw.firewall && rw.firewall.ok !== false) { v.meta.provenance.push({ kind: 'rewrite', bulletId: b.id, from: b.text, to: rw.text, rules: rw.changes.map((c) => c.rule) }); return { ...b, text: rw.text }; } return b; });
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
      let added = 0;
      const excluded = new Set(overrides.excludeAdded || []); // "itemId:competency" the user removed
      for (const s of cands) {
        if (added >= 2 || e.bullets.length >= 2) break;
        if (have.has(s.competency) || !TRANSFER[s.competency]) continue;
        if (s.standsFor && have.has(s.standsFor)) continue;
        if (excluded.has(`${e.id}:${s.competency}`)) continue;
        const text = `${TRANSFER[s.competency]({ noun, title: e.title })}.`;
        const nb = { id: newId('b'), text };
        e.bullets.push(nb); have.add(s.competency); if (s.standsFor) have.add(s.standsFor); if (SPECIFIC_OVER[s.competency]) have.add(SPECIFIC_OVER[s.competency]); added++;
        v.meta.provenance.push({ kind: 'transferable_bullet', itemId: e.id, bulletId: nb.id, text, competency: s.competency, basis: `${role.familyLabel || d.familyLabel} work — ${e.title}`, confirm: true, reason: `Written from what a ${e.title || 'role like this'} inherently involves. Keep it only if it is true.` });
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
  const layout = overrides.layout || (plan.strategy && plan.strategy.layout) || decideLayout(base, decs);
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
      if (kept.length) { text = `${text} ${kept.join(' ')}`; sources.keptSentences = kept; }
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

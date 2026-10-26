// Role relevance — how much each résumé role matters for THIS posting, explained.
//
//   relevance = 0.60·coverage (job's demanded competencies the role covers: implied by its
//               title/employer/family + evidenced by its bullets)
//             + 0.25·family alignment (same field 1 · same cluster .6 · unrelated .15)
//             + 0.15·keyword relevance (the posting's own terms found in the role's bullets)
// Recency (ended within a year 1 → ten years ago 0) and tenure (two years and up 1) are
// reported alongside: the optimizer uses them to decide whether a role may LEAVE the page,
// never to rank relevance. Dateless roles get neutral recency (0.5) rather than zero: an
// undated packed role is not "old", it is undated. Every role carries its evidence (WHY).

import { impliedCompetencies, jobCompetencies, termCompetencies, coverage, familyAlignment, competencyGroup } from './competencies.js';
import { scoreBulletKeywords } from './keywords.js';
import { fromToken, monthsBetween } from '../parse/dates.js';
import { postingTermWeights, termOverlap } from './postingTerms.js';

export const RELEVANCE_VERSION = 'relevance_v1';
// Store-level / hourly job families (same set as optimizer.js CHRONOLOGICAL_FAMILIES, minus the
// catch-all 'general').
export const HOURLY_FAMILIES = new Set(['retail', 'customer_service', 'food_service', 'hospitality', 'valet_parking', 'warehouse', 'delivery_logistics', 'security']);

const yearsAgo = (endTok, now) => {
  if (!endTok) return null;
  if (endTok === 'present') return 0;
  const d = fromToken(endTok);
  if (!d || d === 'present') return null;
  return Math.max(0, (now.getUTCFullYear() * 12 + now.getUTCMonth() + 1 - (d.y * 12 + (d.m || 6))) / 12);
};

/**
 * @param {object} doc ResumeDoc
 * @param {{ jobTitle?: string, jobDescription?: string, requirements?: any[], keywords?: any[], now?: Date }} job
 */
export function scoreRoles(doc, job = {}) {
  const now = job.now || new Date();
  const jc = jobCompetencies({ jobTitle: job.jobTitle || '', jobDescription: job.jobDescription || '', requirements: job.requirements || [] });
  const keywords = job.keywords || [];
  // the posting's own words (any field): how much of its vocabulary each role's title + bullets use
  const termWeights = postingTermWeights(job.jobDescription || '', { jobTitle: job.jobTitle || '', company: job.company || '' });
  const roles = doc.experience.map((e, index) => {
    const bulletsText = e.bullets.map((b) => b.text).join(' ');
    const implied = impliedCompetencies(e.title, e.company, bulletsText);
    const evidenced = {};
    const evidenceBy = {};
    for (const b of e.bullets) {
      const { vector, hits } = termCompetencies(b.text);
      for (const [c, w] of Object.entries(vector)) { if (w > (evidenced[c] || 0)) evidenced[c] = w; (evidenceBy[c] = evidenceBy[c] || []).push({ bulletId: b.id, terms: hits[c] || [] }); }
    }
    if (e.summary) { const { vector } = termCompetencies(e.summary); for (const [c, w] of Object.entries(vector)) if (w > (evidenced[c] || 0)) evidenced[c] = w; }
    // implied competencies are discounted: a title says what the job involved, a bullet shows it
    const vec = {};
    for (const [c, w] of Object.entries(implied.vector)) vec[c] = w * 0.8;
    for (const [c, w] of Object.entries(evidenced)) vec[c] = Math.max(vec[c] || 0, w);
    const cov = coverage(jc.vector, vec);
    const align = familyAlignment(jc.family, implied.family);
    const kw = e.bullets.length ? e.bullets.reduce((s, b) => s + scoreBulletKeywords(b.text, keywords).score, 0) / e.bullets.length : 0;
    // The taxonomy keywords average over bullets; the posting-term overlap counts the role's
    // distinct posting words (title + every bullet). Either can carry the keyword term: the
    // averaged keywords alone left Dev's 5-bullet payments role below his 2- and 3-bullet ones.
    const terms = termOverlap([e.title, ...e.bullets.map((b) => b.text)].join(' '), termWeights, 9);
    const kwNorm = Math.max(Math.min(1, kw / 1.5), terms.score);
    const ago = yearsAgo(e.end, now);
    const recency = ago == null ? 0.5 : Math.max(0, 1 - ago / 10);
    const months = e.start ? (monthsBetween(e.start, e.end || 'present', now) || 0) : null;
    const tenure = months == null ? 0.5 : Math.min(1, months / 24);
    // Relevance is JOB FIT only (what the role is + what its bullets prove + the posting's own
    // words). Recency and tenure are reported separately: they decide whether a role may leave
    // the page, never whether it is relevant.
    const relevance = Number((0.6 * cov.score + 0.25 * align + 0.15 * kwNorm).toFixed(3));
    const top = cov.shared.slice(0, 4);
    const reasons = [];
    if (top.length) reasons.push(`${implied.familyLabel} work covers ${top.map((s) => s.competency).join(', ')} — ${top.filter((s) => evidenced[s.competency]).length ? 'shown in your bullets' : 'implied by the title'}.`);
    if (align >= 1) reasons.push('Same field as the posting.'); else if (align >= 0.6) reasons.push('Customer-facing / same cluster as the posting.'); else if (align <= 0.15) reasons.push('A different field from the posting.');
    if (!e.bullets.length) reasons.push('No bullets — the title is doing all the work here.');
    if (ago != null && ago >= 6) reasons.push(`Ended about ${Math.round(ago)} years ago.`);
    if (e.end === 'present') reasons.push('Current role.');
    return {
      itemId: e.id, index, title: e.title, company: e.company, start: e.start, end: e.end, dateless: !e.start && !e.end,
      current: e.end === 'present', bullets: e.bullets.length, metricBullets: e.bullets.filter((b) => /\d/.test(b.text)).length,
      family: implied.family, familyLabel: implied.familyLabel, familyConfidence: implied.familyConfidence, companyHint: implied.companyHint,
      coverage: Number(cov.score.toFixed(3)), alignment: align, keyword: Number(kwNorm.toFixed(3)), recency: Number(recency.toFixed(2)), tenure: Number(tenure.toFixed(2)),
      relevance,
      shared: top.map((s) => ({ competency: s.competency, group: competencyGroup(s.competency), demand: Number(s.demand.toFixed(2)), have: Number(s.have.toFixed(2)), evidenced: !!evidenced[s.competency], bulletIds: (evidenceBy[s.competency] || []).map((x) => x.bulletId) })),
      implied: Object.entries(implied.vector).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([c]) => c),
      reasons,
    };
  });
  // Near-ties (within 0.03 — the audit's 0.273 / 0.271 / 0.259) go to the current role, then to
  // the role with more metric-backed bullets, so the page leads with the strongest live evidence
  // rather than whichever older job happens to score a hair higher.
  // A transitive sort key: relevance, plus a small edge for a RELEVANT current role (≥ 0.15) and
  // for metric-backed bullets — enough to settle a near-tie, never enough to lift an unrelated job.
  // Hourly / store-level postings (2026-10-24 recruiter audit, D6): a store manager reads the
  // CURRENT job first and trusts numbers over title matches — "Sales Associate at GNC (2020–22)"
  // out-ranked the current Membership Specialist role with "top 3 of 12" and "1,200+ members"
  // purely on title overlap. There, a clearly relevant current role (≥ 0.25) with metric-backed
  // bullets gets an edge worth more than the family-alignment term (≤ 0.12): never enough to lift
  // an unrelated job, which stays below 0.25.
  const hourly = HOURLY_FAMILIES.has(jc.family);
  // Professional postings: among roles in the posting's field (alignment ≥ .6), the more recent
  // one leads a near-tie — a recruiter reads the latest same-field job first. Worth at most 0.08,
  // never enough to lift an unrelated role over a related one.
  const key = (r) => r.relevance
    + (!hourly && r.alignment >= 0.6 ? 0.08 * r.recency : 0)
    + (r.current && r.relevance >= 0.15 ? 0.02 : 0) + Math.min(0.01, r.metricBullets * 0.003)
    + (hourly && r.current && r.relevance >= 0.25 && r.metricBullets ? Math.min(0.12, 0.06 + 0.02 * r.metricBullets) : 0);
  let sorted = roles.sort((a, b) => key(b) - key(a) || a.index - b.index);
  // Near-ties are ties. On a professional posting, same-field roles whose scores sit within 0.06 of
  // the leader of their group are ordered most recent first (greedy groups from the top, so the
  // order is well defined): Dev's 2022–2026 senior payments role, 0.05 behind a 2020–22 role on
  // word overlap alone, now leads the way a recruiter reads it.
  if (!hourly) {
    const out = [];
    let i = 0;
    while (i < sorted.length) {
      const lead = key(sorted[i]);
      let j = i + 1;
      while (j < sorted.length && lead - key(sorted[j]) <= 0.06 && sorted[j].alignment >= 0.6 && sorted[i].alignment >= 0.6) j++;
      const group = sorted.slice(i, j).sort((a, b) => (b.recency - a.recency) || (a.index - b.index));
      out.push(...group);
      i = j;
    }
    sorted = out;
  }
  return { roles: sorted, job: { family: jc.family, familyLabel: jc.familyLabel, vector: jc.vector }, version: RELEVANCE_VERSION };
}

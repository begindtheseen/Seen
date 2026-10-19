// Résumé health score — job-independent, explainable, anchored to the document.
//
// Six weighted dimensions (100 points): Impact 35 · Language 15 · Structure 15 · Timeline 10 ·
// Length 10 · ATS parseability 15. Each dimension reports its own 0–100 score, the weight, and
// FINDINGS: { code, severity: 'error'|'warn'|'info', message, anchor: { section, itemId, bulletId },
// fix?: { kind, text } } so the UI can highlight the exact bullet and offer the one-click fix the
// rewrite engine produced. Weighted, not averaged: a perfect résumé scores 100, and the most
// recent roles count more. Deterministic. Labelled a QUALITY score, never an "ATS score" — no real
// applicant system emits one.

import { analyzeBullet } from './bullet.js';
import { rewriteBullet, suggestVerbs } from '../rewrite/rules.js';
import { fromToken, monthsBetween, cmpTokens } from '../parse/dates.js';
import { experienceSpanYears, docStats } from '../model.js';

export const HEALTH_VERSION = 'health_v1';
export const WEIGHTS = { impact: 35, language: 15, structure: 15, timeline: 10, length: 10, ats: 15 };

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const pct = (x) => Math.round(clamp01(x) * 100);
const recencyWeight = (i) => [1, 0.85, 0.7][i] ?? 0.6;

function roleTense(e) { return e.end === 'present' ? 'present' : (e.start || e.end) ? 'past' : null; }

export function scoreResume(doc, opts = {}) {
  const now = opts.now ? new Date(opts.now) : new Date();
  const findings = [];
  const add = (dim, f) => { findings.push({ dimension: dim, ...f }); };
  const years = experienceSpanYears(doc, now);
  const stats = docStats(doc);

  // ── A. Impact (per-bullet analysis, recency-weighted) ──
  const bulletRows = [];
  doc.experience.forEach((e, ri) => {
    const tense = roleTense(e);
    e.bullets.forEach((b) => bulletRows.push({ section: 'experience', item: e, bullet: b, a: analyzeBullet(b.text, { roleTense: tense }), w: recencyWeight(ri), tense }));
  });
  doc.projects.forEach((p) => p.bullets.forEach((b) => bulletRows.push({ section: 'projects', item: p, bullet: b, a: analyzeBullet(b.text, { roleTense: null }), w: 0.6, tense: 'keep' })));

  let impact = 0;
  if (bulletRows.length) {
    const totalW = bulletRows.reduce((s, r) => s + r.w, 0);
    const leadAvg = bulletRows.reduce((s, r) => s + r.w * (r.a.lead.kind === 'strong' || r.a.lead.kind === 'recognition' ? 1 : r.a.lead.kind === 'verb' ? 0.8 : r.a.lead.kind === 'generic' ? 0.5 : 0), 0) / totalW;
    const quantShare = bulletRows.reduce((s, r) => s + r.w * (r.a.metrics.length ? 1 : 0), 0) / totalW;
    const quantTarget = years != null && years < 2 ? 0.4 : 0.6;
    const quant = clamp01(quantShare / quantTarget);
    const lenAvg = bulletRows.reduce((s, r) => s + r.w * (r.a.length === 'ok' && r.a.words >= 12 ? 1 : r.a.length === 'ok' || r.a.length === 'longish' ? 0.5 : 0), 0) / totalW;
    const buzzHits = bulletRows.reduce((s, r) => s + r.a.buzzwords.length + r.a.fillers.length + r.a.vague.length, 0);
    const specificity = buzzHits >= 3 ? 0 : buzzHits === 2 ? 0.4 : buzzHits === 1 ? 0.7 : 1;
    const outcomeShare = bulletRows.reduce((s, r) => s + r.w * (r.a.outcome ? 1 : 0), 0) / totalW;
    impact = (leadAvg * 10 + quant * 14 + lenAvg * 5 + specificity * 4 + outcomeShare * 2) / 35;
    for (const r of bulletRows) {
      const anchor = { section: r.section, itemId: r.item.id, bulletId: r.bullet.id };
      for (const issue of r.a.issues) {
        if (['weak_lead', 'pronoun_lead', 'no_verb_lead', 'generic_lead', 'passive', 'filler', 'tense', 'pronoun'].includes(issue.code)) {
          const rw = rewriteBullet(r.bullet.text, { tense: r.tense === 'keep' ? 'keep' : r.tense });
          const realChange = !rw.unchanged && rw.changes.some((c) => c.rule !== 'hygiene');
          const fix = realChange ? { kind: 'rewrite', text: rw.text, rules: rw.changes.map((c) => c.rule) }
            : issue.code === 'generic_lead' ? { kind: 'verbs', options: suggestVerbs(r.a.lead.lemma, r.bullet.text) } : null;
          add(['passive', 'filler', 'tense', 'pronoun'].includes(issue.code) ? 'language' : 'impact', { ...issue, anchor, fix });
        } else if (issue.code === 'no_metric') {
          add('impact', { ...issue, anchor, fix: { kind: 'prompt', text: metricPrompt(r.bullet.text) } });
        } else if (issue.code === 'buzzword') {
          add('impact', { ...issue, anchor });
        } else if (['too_short', 'too_long', 'adverb_lead'].includes(issue.code)) {
          add('impact', { ...issue, anchor });
        }
      }
    }
  } else {
    add('impact', { code: 'no_bullets', severity: 'error', message: 'No accomplishment bullets found under any role.', anchor: { section: 'experience' } });
  }

  // ── B. Language ──
  let language = 1;
  if (bulletRows.length) {
    const pastRoles = bulletRows.filter((r) => r.tense === 'past');
    const tenseBad = pastRoles.filter((r) => r.a.lead.tense === 'present' || r.a.lead.tense === 'gerund').length;
    const currentRows = bulletRows.filter((r) => r.tense === 'present');
    const curPast = currentRows.filter((r) => r.a.lead.tense === 'past').length, curPres = currentRows.filter((r) => r.a.lead.tense === 'present').length;
    const mixedCurrent = curPast > 0 && curPres > 0;
    const tenseScore = clamp01(1 - (tenseBad / Math.max(1, pastRoles.length)) - (mixedCurrent ? 0.25 : 0));
    const pronounHits = bulletRows.reduce((s, r) => s + r.a.pronouns.length, 0);
    const pronounScore = pronounHits === 0 ? 1 : pronounHits === 1 ? 0.5 : 0;
    const passiveHits = bulletRows.reduce((s, r) => s + r.a.passive.length, 0);
    const passiveScore = clamp01(1 - passiveHits / 3);
    const leadCounts = new Map();
    for (const r of bulletRows) if (r.a.lead.lemma) leadCounts.set(r.a.lead.lemma, (leadCounts.get(r.a.lead.lemma) || 0) + 1);
    const repeats = [...leadCounts.entries()].filter(([, n]) => n >= 3);
    const repScore = clamp01(1 - repeats.length / 3);
    for (const [lemma, n] of repeats) add('language', { code: 'verb_repeat', severity: 'info', message: `"${lemma}" opens ${n} bullets — vary the verb so each line shows a different strength.`, anchor: { section: 'experience' } });
    if (mixedCurrent) add('language', { code: 'tense_mixed', severity: 'warn', message: 'Your current role mixes past and present tense — pick one.', anchor: { section: 'experience', itemId: currentRows[0].item.id } });
    const wordy = bulletRows.reduce((s, r) => s + r.a.fillers.length, 0);
    const wordyScore = clamp01(1 - wordy * 0.15);
    language = (tenseScore * 4 + pronounScore * 3 + passiveScore * 3 + repScore * 3 + wordyScore * 2) / 15;
  }

  // ── C. Structure ──
  const b = doc.basics;
  const contactScore = b.email && b.phone ? 1 : b.email || b.phone ? 0.5 : 0;
  if (!b.email) add('structure', { code: 'no_email', severity: 'error', message: 'Add an email address — recruiters cannot reply without one.', anchor: { section: 'basics' } });
  if (!b.phone) add('structure', { code: 'no_phone', severity: 'warn', message: 'Add a phone number.', anchor: { section: 'basics' } });
  if (!b.name) add('structure', { code: 'no_name', severity: 'error', message: 'Your name should be the first line.', anchor: { section: 'basics' } });
  if (!b.location) add('structure', { code: 'no_location', severity: 'info', message: 'Add a city and state (or "Remote") — many screens filter by location.', anchor: { section: 'basics' } });
  if (!b.links.some((l) => l.kind === 'linkedin')) add('structure', { code: 'no_linkedin', severity: 'info', message: 'A LinkedIn URL is expected on most résumés.', anchor: { section: 'basics' } });
  if (b.email && /@(?:aol|hotmail|yahoo)\./i.test(b.email)) add('structure', { code: 'email_domain', severity: 'info', message: 'Consider a current email domain (Gmail, Outlook, or your own).', anchor: { section: 'basics' } });
  const summaryNeeded = years == null || years >= 2;
  let sections = 0;
  if (doc.experience.length) sections += 3; else add('structure', { code: 'no_experience', severity: 'error', message: 'No work experience section was found.', anchor: { section: 'experience' } });
  if (doc.education.length) sections += 2; else add('structure', { code: 'no_education', severity: 'warn', message: 'Add an Education section (even a high school diploma or in-progress degree).', anchor: { section: 'education' } });
  if (doc.skills.length) sections += 2; else add('structure', { code: 'no_skills', severity: 'warn', message: 'Add a Skills section — it is where keyword scans look first.', anchor: { section: 'skills' } });
  if (b.summary || b.headline) sections += 1; else if (summaryNeeded) add('structure', { code: 'no_summary', severity: 'info', message: 'A 2–3 line summary at the top tells a screener who you are in five seconds.', anchor: { section: 'summary' } });
  else sections += 1;
  const sectionScore = sections / 8;
  let orderScore = 1;
  const order = doc.sectionOrder;
  if (years != null && years >= 2 && order.indexOf('education') !== -1 && order.indexOf('experience') !== -1 && order.indexOf('education') < order.indexOf('experience')) {
    orderScore -= 0.5; add('structure', { code: 'education_first', severity: 'info', message: 'With 2+ years of experience, list Experience before Education.', anchor: { section: 'education' } });
  }
  const skillItems = doc.skills.reduce((s, g) => s + g.items.length, 0);
  if (skillItems > 25) { orderScore -= 0.25; add('structure', { code: 'skills_overflow', severity: 'info', message: `${skillItems} skills listed — keep the 10–15 that matter and group them.`, anchor: { section: 'skills' } }); }
  for (const e of doc.experience) {
    if (!e.title) add('structure', { code: 'role_no_title', severity: 'warn', message: `Add the job title for ${e.company || 'this role'}.`, anchor: { section: 'experience', itemId: e.id } });
    if (!e.company) add('structure', { code: 'role_no_company', severity: 'warn', message: `Add the employer for "${e.title || 'this role'}".`, anchor: { section: 'experience', itemId: e.id } });
  }
  const roleFieldsScore = doc.experience.length ? doc.experience.filter((e) => e.title && e.company).length / doc.experience.length : 1;
  const structure = (contactScore * 4 + sectionScore * 8 + clamp01(orderScore) * 2 + roleFieldsScore * 1) / 15;

  // ── D. Timeline ──
  let timeline = 1;
  if (doc.experience.length) {
    const precision = (tok) => (!tok ? 0 : tok === 'present' ? 1 : /^\d{4}-\d{2}$/.test(tok) ? 1 : 0.5);
    let dated = 0;
    const formats = [];
    for (const e of doc.experience) {
      const ps = precision(e.start), pe = precision(e.end);
      dated += Math.min(ps, pe);
      if (e.start) formats.push(/^\d{4}-\d{2}$/.test(e.start) ? 'month' : 'year');
      if (!e.start) add('timeline', { code: 'role_no_dates', severity: 'warn', message: `"${e.title || e.company}" has no dates.`, anchor: { section: 'experience', itemId: e.id } });
      else if (ps < 1 || (e.end && pe < 1)) add('timeline', { code: 'year_only', severity: 'info', message: `"${e.title || e.company}" shows years only — add months (e.g. Mar 2021 – Jan 2024).`, anchor: { section: 'experience', itemId: e.id } });
      if (e.start && !e.end) add('timeline', { code: 'no_end_date', severity: 'warn', message: `"${e.title || e.company}" has a start but no end date — add one or "Present".`, anchor: { section: 'experience', itemId: e.id } });
    }
    const datedScore = dated / doc.experience.length;
    const modal = formats.length ? (formats.filter((f) => f === 'month').length >= formats.length / 2 ? 'month' : 'year') : 'month';
    const consistent = formats.length ? formats.filter((f) => f === modal).length / formats.length : 1;
    if (consistent < 1) add('timeline', { code: 'date_formats', severity: 'info', message: 'Use one date format on every role.', anchor: { section: 'experience' } });
    // gaps & overlaps (sorted by start, most recent first in the doc → sort ascending here)
    const dated_roles = doc.experience.filter((e) => e.start).map((e) => ({ e, s: e.start, en: e.end === 'present' ? 'present' : e.end || e.start }));
    dated_roles.sort((a, b2) => cmpTokens(a.s, b2.s));
    let gapScore = 1, overlapScore = 1, sanity = 1;
    for (let i = 1; i < dated_roles.length; i++) {
      const prev = dated_roles[i - 1], cur = dated_roles[i];
      const gap = monthsBetween(prev.en === 'present' ? cur.s : prev.en, cur.s, now);
      if (gap != null && gap >= 6 && prev.en !== 'present') { gapScore -= 0.5; add('timeline', { code: 'gap', severity: 'warn', message: `About ${Math.round(gap)} months between ${prev.e.company || prev.e.title} and ${cur.e.company || cur.e.title} — add what you did (study, caregiving, freelance) or let the dates speak and prepare an answer.`, anchor: { section: 'experience', itemId: cur.e.id } }); }
      else if (gap != null && gap >= 3 && prev.en !== 'present') add('timeline', { code: 'gap_small', severity: 'info', message: `${Math.round(gap)}-month gap before ${cur.e.company || cur.e.title}.`, anchor: { section: 'experience', itemId: cur.e.id } });
      const concurrent = /part[-\s]?time|contract|freelance|volunteer|self[-\s]?employed|consult|per[-\s]?diem|side/i.test(`${prev.e.employmentType} ${cur.e.employmentType} ${prev.e.title} ${cur.e.title}`);
      const overlap = prev.en === 'present' ? true : cmpTokens(cur.s, prev.en) < 0;
      if (overlap && !concurrent && prev.en !== 'present') { overlapScore = 0; add('timeline', { code: 'overlap', severity: 'warn', message: `${prev.e.company || prev.e.title} and ${cur.e.company || cur.e.title} overlap — label one part-time/contract or check the dates.`, anchor: { section: 'experience', itemId: cur.e.id } }); }
    }
    const presents = doc.experience.filter((e) => e.end === 'present');
    if (presents.length > 1 && !presents.every((e) => /part[-\s]?time|contract|freelance|volunteer|self[-\s]?employed|consult/i.test(`${e.employmentType} ${e.title}`))) { sanity = 0.5; add('timeline', { code: 'multiple_present', severity: 'warn', message: `${presents.length} roles are marked "Present" — label the side roles part-time/contract or close them.`, anchor: { section: 'experience', itemId: presents[1].id } }); }
    for (const e of doc.experience) {
      if (e.start && e.end && e.end !== 'present' && cmpTokens(e.end, e.start) < 0) { sanity = 0; add('timeline', { code: 'end_before_start', severity: 'error', message: `"${e.title || e.company}" ends before it starts.`, anchor: { section: 'experience', itemId: e.id } }); }
      const en = fromToken(e.end);
      if (en && en !== 'present' && en.y * 12 + (en.m || 1) > now.getUTCFullYear() * 12 + now.getUTCMonth() + 2) { sanity = 0; add('timeline', { code: 'future_date', severity: 'error', message: `"${e.title || e.company}" ends in the future.`, anchor: { section: 'experience', itemId: e.id } }); }
    }
    timeline = (datedScore * 4 + consistent * 2 + clamp01(gapScore) * 2 + overlapScore * 1 + sanity * 1) / 10;
  }

  // ── E. Length & density ──
  const words = stats.words;
  const pages = opts.pages || (doc.meta && doc.meta.layout && doc.meta.layout.pages) || Math.max(1, Math.ceil(words / 550));
  const maxPages = years != null && years <= 5 ? 1 : 2;
  const pageScore = pages <= maxPages ? 1 : pages === maxPages + 1 ? 0.5 : 0;
  if (pages > maxPages) add('length', { code: 'too_many_pages', severity: pages > maxPages + 1 ? 'warn' : 'info', message: `${pages} pages — ${maxPages === 1 ? 'one page' : 'two pages'} is the norm for ${years != null ? years + ' years' : 'this much'} of experience.`, anchor: { section: 'document' } });
  const wordScore = words >= 400 && words <= 1600 ? 1 : words < 400 ? clamp01(words / 400) : clamp01(1 - (words - 1600) / 1600);
  if (words < 400 && doc.experience.length) add('length', { code: 'too_short', severity: 'info', message: `${words} words — most strong résumés run 400–800. Add a result to each role.`, anchor: { section: 'document' } });
  if (words > 1600) add('length', { code: 'too_long', severity: 'warn', message: `${words} words — cut older roles to 1–2 bullets.`, anchor: { section: 'document' } });
  let bulletsScore = 1;
  doc.experience.slice(0, 2).forEach((e) => {
    const n = e.bullets.length;
    if (n < 3) { bulletsScore -= 0.4; add('length', { code: 'few_bullets', severity: n === 0 ? 'warn' : 'info', message: `${e.company || e.title}: ${n} bullet${n === 1 ? '' : 's'} — recent roles deserve 3–6.`, anchor: { section: 'experience', itemId: e.id } }); }
    else if (n > 7) { bulletsScore -= 0.2; add('length', { code: 'many_bullets', severity: 'info', message: `${e.company || e.title}: ${n} bullets — keep the 5–6 strongest.`, anchor: { section: 'experience', itemId: e.id } }); }
  });
  doc.experience.slice(2).forEach((e) => { if (!e.bullets.length && !e.summary) add('length', { code: 'empty_role', severity: 'info', message: `${e.company || e.title} has no bullets — one line about what you did is enough.`, anchor: { section: 'experience', itemId: e.id } }); });
  let summaryScore = 1;
  if (b.summary) {
    const sw = b.summary.split(/\s+/).length;
    summaryScore = sw >= 30 && sw <= 90 ? 1 : sw >= 15 && sw <= 130 ? 0.5 : 0;
    if (sw > 90) add('length', { code: 'summary_long', severity: 'info', message: `Summary is ${sw} words — aim for 2–4 lines (30–80 words).`, anchor: { section: 'summary' } });
    if (sw < 15) add('length', { code: 'summary_short', severity: 'info', message: 'Summary is one line — say the role you want, your years, and one proof point.', anchor: { section: 'summary' } });
  }
  const length = (pageScore * 4 + wordScore * 3 + clamp01(bulletsScore) * 2 + summaryScore * 1) / 10;

  // ── F. ATS parseability ──
  const layout = (doc.meta && doc.meta.layout) || opts.layout || null;
  let textLayer = 1, singleCol = 1, contactBody = 1, fonts = 1, file = 1, roundTrip = 1;
  if (layout && layout.method === 'legacy' && Array.isArray(doc.meta.warnings) && doc.meta.warnings.some((w) => /pdfjs_no_text/.test(w.code || w))) { textLayer = 0; add('ats', { code: 'no_text_layer', severity: 'error', message: 'This PDF has no readable text layer — export it from Word/Docs again or paste the text.', anchor: { section: 'document' } }); }
  if (layout && (layout.columns > 1 || layout.tables)) { singleCol = 0; add('ats', { code: 'multi_column', severity: 'warn', message: layout.tables ? 'Tables are used for layout — many applicant systems skip table cells. Use a single column.' : 'Two-column layout — some applicant systems read the columns out of order. Export a single-column version for applications.', anchor: { section: 'document' } }); }
  if (!(b.email || b.phone)) contactBody = 0;
  if (Array.isArray(doc.meta && doc.meta.warnings) && doc.meta.warnings.some((w) => /docx_header_part/.test(w.code || w))) { contactBody = 0.5; add('ats', { code: 'contact_in_header', severity: 'warn', message: 'Contact details sit in the page header — some parsers never read headers. Move them into the body.', anchor: { section: 'basics' } }); }
  if (layout && layout.bodySize && (layout.bodySize < 8.5 || layout.bodySize > 12)) { fonts = 0.5; add('ats', { code: 'font_size', severity: 'info', message: `Body text is ${layout.bodySize}pt — 10–11pt reads best on screen and in print.`, anchor: { section: 'document' } }); }
  const unrecognized = doc.meta && doc.meta.warnings ? doc.meta.warnings.some((w) => (w.code || w) === 'no_sections') : false;
  if (unrecognized) { singleCol = Math.min(singleCol, 0.5); add('ats', { code: 'no_headings', severity: 'warn', message: 'No standard section headings found — use "Experience", "Education" and "Skills".', anchor: { section: 'document' } }); }
  if (opts.roundTrip != null) roundTrip = clamp01(opts.roundTrip);
  const ats = (textLayer * 4 + singleCol * 3 + contactBody * 3 + fonts * 2 + file * 1 + roundTrip * 2) / 15;

  const dims = {
    impact: { label: 'Impact', score: pct(impact), weight: WEIGHTS.impact },
    language: { label: 'Language', score: pct(language), weight: WEIGHTS.language },
    structure: { label: 'Structure', score: pct(structure), weight: WEIGHTS.structure },
    timeline: { label: 'Timeline', score: pct(timeline), weight: WEIGHTS.timeline },
    length: { label: 'Length & density', score: pct(length), weight: WEIGHTS.length },
    ats: { label: 'Parseability', score: pct(ats), weight: WEIGHTS.ats },
  };
  for (const k of Object.keys(dims)) dims[k].findings = findings.filter((f) => f.dimension === k);
  const total = Math.round(Object.values(dims).reduce((s, d) => s + (d.score / 100) * d.weight, 0));
  const grade = total >= 85 ? 'A' : total >= 70 ? 'B' : total >= 50 ? 'C' : 'D';
  const band = total >= 85 ? 'strong' : total >= 70 ? 'solid' : total >= 50 ? 'needs work' : 'rebuild';
  // Top fixes: the findings with the biggest expected lift, one per bullet.
  const sevRank = { error: 3, warn: 2, info: 1 };
  const seen = new Set();
  const topFixes = [...findings]
    .sort((x, y) => (sevRank[y.severity] - sevRank[x.severity]) || (WEIGHTS[y.dimension] - WEIGHTS[x.dimension]))
    .filter((f) => { const k = `${f.anchor && f.anchor.bulletId || f.anchor && f.anchor.itemId || f.code}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, 8);
  return {
    version: HEALTH_VERSION, score: total, grade, band, years: years, words,
    dimensions: dims, findings, topFixes,
    bullets: bulletRows.map((r) => ({ bulletId: r.bullet.id, itemId: r.item.id, section: r.section, impact: r.a.impact, lead: r.a.lead, metrics: r.a.metrics, issues: r.a.issues.map((i) => i.code) })),
    summary: summaryLine(total, dims, bulletRows),
  };
}

function metricPrompt(text) {
  const t = text.toLowerCase();
  if (/\b(customers?|clients?|guests?|patients?)\b/.test(t)) return 'How many per shift or week? What satisfaction score or rating?';
  if (/\b(team|staff|crew|associates|employees|hires)\b/.test(t)) return 'How many people? Over what period?';
  if (/\b(sales?|revenue|deals?|quota)\b/.test(t)) return 'How much, in dollars or percent of quota?';
  if (/\b(cost|budget|spend|expenses?)\b/.test(t)) return 'How much money, and by what percent?';
  if (/\b(time|hours?|faster|speed|latency|turnaround)\b/.test(t)) return 'How much time saved — hours per week, or percent faster?';
  if (/\b(orders?|units?|packages?|pallets?|shipments?|tickets?|calls?|reports?)\b/.test(t)) return 'How many per hour, day or week — and at what accuracy?';
  if (/\b(errors?|defects?|incidents?|accidents?|returns?|complaints?)\b/.test(t)) return 'By what percent did it drop, from what to what?';
  if (/\b(train|onboard|mentor|taught)/.test(t)) return 'How many people did you train, and what happened to them?';
  return 'Add one number: how many, how much, how often, or how much better.';
}

function summaryLine(total, dims, rows) {
  const weakest = Object.entries(dims).sort((a, b2) => a[1].score - b2[1].score)[0];
  const quant = rows.length ? Math.round(100 * rows.filter((r) => r.a.metrics.length).length / rows.length) : 0;
  if (total >= 85) return `Strong résumé. ${quant}% of your bullets carry a number; keep every new bullet to that standard.`;
  if (total >= 70) return `Solid base. The fastest lift is ${weakest[1].label.toLowerCase()} — ${weakest[1].findings[0] ? weakest[1].findings[0].message.replace(/\.+$/, '') : 'see the fixes below'}.`;
  if (total >= 50) return `Needs work: ${weakest[1].label.toLowerCase()} is the weak spot. ${quant}% of bullets have a number — aim for 60%.`;
  return `Rebuild the bullets first: lead each with a strong verb and a number. Only ${quant}% carry one today.`;
}

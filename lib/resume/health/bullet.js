// Per-bullet analysis: the lead verb (strength, category, tense), quantification, length,
// pronouns, passive voice, buzzwords, fillers, vagueness, outcome cues. Pure and deterministic.
// Every finding here is a CLAIM the health score can show with evidence (the matched text).

import { STRONG_VERBS, GENERIC_VERBS, KNOWN_VERBS, WEAK_LEAD_RE, RECOGNITION_LEADS, BUZZWORD_RE, FILLERS, VAGUE_RE } from './verbs.js';
import { baseFromPast, baseFromGerund } from '../rewrite/inflect.js';

export const METRIC_RE = /(?:[$€£]\s?\d[\d,]*(?:\.\d+)?\s?(?:k|m|b|mm|million|billion)?\b|\b\d+(?:\.\d+)?\s?%|\b\d+(?:\.\d+)?\s?(?:k|m|b|mm)\b|\b\d{1,3}(?:,\d{3})+\b|\b\d+(?:\.\d+)?\s?x\b|\b(?:\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|dozens?|hundreds?|thousands?)\+?\s+(?:[a-z-]+\s+){0,2}(?:people|engineers|associates|employees|staff|clients|customers|guests|patients|students|users|stores|sites|locations|teams?|members|reps|agents|nurses|hires|vehicles|units|orders|tickets|calls|cases|accounts|reports|projects|products|skus|items|packages|pallets|loads|deliveries|routes|shifts|hours|days|weeks|months|years|rooms|tables|covers|transactions|applications|invoices|contracts|deals|leads|events|classes|sessions|servers|systems|apps|endpoints|features|releases|bugs|incidents|pages|articles|posts|videos|campaigns)\b|\b\d+(?:,\d{3})*\+?\s+(?:[a-z-]+\s+){0,2}[a-z]{3,}s\b|\b\d+-(?:person|member|man|woman|seat|bed|unit|store|site|room|hour|day|week|month|year|acre|mile|point|step|figure|digit|tier|level|star|line|page|item|vehicle|truck|door|bay|lane|shift)\b|#\s?\d+|\btop\s\d+%?|\b\d+(?:\.\d+)?\s?(?:hrs?|hours|minutes|mins?|days?|weeks?|months?)\b|\b\d+(?:\.\d+)?\s?(?:lbs?|kg|tons?|sq\.?\s?ft|miles?|km)\b|\b(?:\d+(?:\.\d+)?)\s?(?:-|–|to)\s?\d+(?:\.\d+)?\b)/gi;
// Numbers that are NOT metrics: years, versions/product numbers, phone-shaped runs, ordinal ranks like "Level 2".
const NON_METRIC_CONTEXT_RE = /\b(?:19|20)\d{2}\b|\b(?:python|java|php|angular|react|vue|node|windows|ios|android|office|excel|word|iso|version|v\.?|sap|tier|level|class|grade|unit|room|suite|zone|route|highway|interstate|iphone|series|type|phase|stage|step|chapter|section|form|schedule|w-?\d|cdl|osha|nfpa|epa|erp|crm)\s?\d+[\w.]*/gi;
const OUTCOME_RE = /\b(?:resulting in|resulted in|which (?:led|reduced|increased|saved|cut|improved|grew)|leading to|led to|enabling|allowing|saving|saved|reduc(?:ed|ing)|increas(?:ed|ing)|improv(?:ed|ing)|cut|grew|boost(?:ed|ing)|achiev(?:ed|ing)|exceed(?:ed|ing)|generat(?:ed|ing)|earn(?:ed|ing)|won|drove|driving|lift(?:ed|ing)|rais(?:ed|ing)|lower(?:ed|ing)|from\s+\S+\s+to\s+\S+|by\s+\d|to\s+\d|\d+\s?%|ahead of schedule|under budget|on time|zero\s+(?:incidents|defects|errors|accidents)|first\s+(?:place|time)|record)\b/i;
const PRONOUN_RE = /\b(?:I|me|my|mine|myself|we|our|ours|us)\b/g;
const PASSIVE_RE = /\b(?:was|were|is|are|been|being|be|has been|have been|had been)\s+(?:\w+ly\s+)?(\w+(?:ed|en|t))\b/gi;
const ADVERB_LEAD_RE = /^(?:\w+ly)\s+/i;

const wordsOf = (t) => String(t || '').trim().split(/\s+/).filter(Boolean);

/** Analyse the lead token of a bullet. */
export function analyzeLead(text) {
  let t = String(text || '').trim();
  const out = { token: '', lemma: '', kind: 'none', category: null, tense: 'unknown', adverb: '', weakPhrase: '' };
  const weak = t.match(WEAK_LEAD_RE);
  if (weak && weak[0].trim()) { out.kind = 'weak'; out.weakPhrase = weak[0].trim(); out.token = weak[0].trim(); return out; }
  const adv = t.match(ADVERB_LEAD_RE);
  if (adv && !/^(?:only|early|daily|weekly|monthly|yearly|supply|apply|rally|rely|fly|family|assembly)\b/i.test(adv[0])) { out.adverb = adv[0].trim(); t = t.slice(adv[0].length); }
  const first = (wordsOf(t)[0] || '').replace(/[^A-Za-z'-]/g, '');
  const lower = first.toLowerCase();
  if (!lower) return out;
  out.token = first;
  if (PRONOUN_RE.test(first) && /^(?:I|we|my|our)$/i.test(first)) { out.kind = 'pronoun'; PRONOUN_RE.lastIndex = 0; return out; }
  PRONOUN_RE.lastIndex = 0;
  if (RECOGNITION_LEADS.has(lower)) { out.kind = 'recognition'; out.lemma = lower; out.tense = 'past'; return out; }
  // base form?
  if (KNOWN_VERBS.has(lower)) { out.lemma = lower; out.tense = 'present'; }
  else {
    const fromPast = baseFromPast(lower, KNOWN_VERBS);
    if (fromPast) { out.lemma = fromPast; out.tense = 'past'; }
    else {
      const fromGer = baseFromGerund(lower, KNOWN_VERBS);
      if (fromGer) { out.lemma = fromGer; out.tense = 'gerund'; }
    }
  }
  if (!out.lemma) {
    // Unknown word: an -ed ending still reads as a past-tense verb to a human; mark it generic.
    if (/ed$/.test(lower) && lower.length > 4) { out.lemma = baseFromPast(lower) || lower; out.tense = 'past'; out.kind = 'generic'; return out; }
    out.kind = 'noun';
    return out;
  }
  if (STRONG_VERBS.has(out.lemma)) { out.kind = 'strong'; out.category = STRONG_VERBS.get(out.lemma); }
  else if (GENERIC_VERBS.has(out.lemma)) out.kind = 'generic';
  else out.kind = 'verb';
  // "manage" is strong only when it is not the résumé's default verb (handled at the doc level).
  if (out.lemma === 'manage') out.kind = 'strong';
  return out;
}

export function findMetrics(text) {
  const t = String(text || '');
  const masked = t.replace(NON_METRIC_CONTEXT_RE, (m) => ' '.repeat(m.length));
  const out = [];
  let m;
  METRIC_RE.lastIndex = 0;
  while ((m = METRIC_RE.exec(masked)) !== null) {
    const raw = t.slice(m.index, m.index + m[0].length).trim();
    if (!raw) continue;
    // A bare 4-digit year survived masking inside a range ("2019-2021") — skip.
    if (/^(?:19|20)\d{2}\s?[-–]\s?(?:19|20)\d{2}$/.test(raw)) continue;
    out.push(raw);
  }
  return out;
}

function passiveHits(text) {
  const hits = [];
  let m;
  const re = new RegExp(PASSIVE_RE.source, 'gi');
  while ((m = re.exec(text)) !== null) {
    const participle = m[1].toLowerCase();
    if (RECOGNITION_LEADS.has(participle)) continue;
    // "was responsible" / "were able" are weak-lead cases, not passives; adjectives in -ed that are
    // states ("was excited") are rare in bullets — accept the false positive risk only for verbs we know.
    const base = baseFromPast(participle, KNOWN_VERBS);
    if (!base) continue;
    hits.push(m[0]);
  }
  return hits;
}

/**
 * @param {string} text bullet text (no glyph)
 * @param {{ roleTense?: 'past'|'present'|null }} ctx
 */
export function analyzeBullet(text, ctx = {}) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  const words = wordsOf(t);
  const lead = analyzeLead(t);
  const metrics = findMetrics(t);
  const pronouns = (t.match(PRONOUN_RE) || []).filter((p) => p === 'I' || /^(?:me|my|mine|myself|we|our|ours|us)$/i.test(p));
  const passive = passiveHits(t);
  const buzzwords = (t.match(BUZZWORD_RE) || []).map((b) => b.toLowerCase());
  const fillers = [];
  for (const [phrase] of FILLERS) {
    const p = phrase.trim();
    if (!p || p.length < 3) continue;
    const re = new RegExp(`(?:^|\\b)${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\b|$)`, 'i');
    if (re.test(t)) fillers.push(p);
  }
  const vague = metrics.length ? [] : (t.match(VAGUE_RE) || []).map((v) => v.toLowerCase());
  const outcome = OUTCOME_RE.test(t) || metrics.length > 0;
  const n = words.length;
  const length = n < 8 ? 'short' : n <= 25 ? 'ok' : n <= 30 ? 'longish' : 'long';
  const lengthScore = n >= 12 && n <= 25 ? 1 : (n >= 8 && n <= 11) || (n >= 26 && n <= 30) ? 0.5 : 0;
  const leadScore = lead.kind === 'strong' || lead.kind === 'recognition' ? 1 : lead.kind === 'verb' ? 0.8 : lead.kind === 'generic' ? 0.5 : 0;
  const issues = [];
  if (lead.kind === 'weak') issues.push({ code: 'weak_lead', severity: 'warn', message: `Starts with "${lead.weakPhrase}" — lead with what you did.` });
  else if (lead.kind === 'pronoun') issues.push({ code: 'pronoun_lead', severity: 'warn', message: `Starts with "${lead.token}" — résumé bullets drop the pronoun.` });
  else if (lead.kind === 'noun' || lead.kind === 'none') issues.push({ code: 'no_verb_lead', severity: 'warn', message: 'Does not start with an action verb.' });
  else if (lead.kind === 'generic') issues.push({ code: 'generic_lead', severity: 'info', message: `"${lead.token}" is a generic verb — a more specific verb shows what you actually did.` });
  if (lead.adverb) issues.push({ code: 'adverb_lead', severity: 'info', message: `"${lead.adverb}" adds nothing a result would not show better.` });
  if (!metrics.length) issues.push({ code: 'no_metric', severity: vague.length ? 'warn' : 'info', message: vague.length ? `"${vague[0]}" hides a number — how many, how much, how often?` : 'No number: add scale, frequency, money, time or a before/after.' });
  if (pronouns.length) issues.push({ code: 'pronoun', severity: 'warn', message: `Uses "${pronouns[0]}" — write in implied first person (no I/me/my/we/our).` });
  if (passive.length) issues.push({ code: 'passive', severity: 'info', message: `Passive voice ("${passive[0]}") — say who did it: you.` });
  if (buzzwords.length) issues.push({ code: 'buzzword', severity: 'info', message: `"${buzzwords[0]}" is a label, not evidence — show it with a result.` });
  if (fillers.length) issues.push({ code: 'filler', severity: 'info', message: `Wordy: "${fillers[0]}".` });
  if (length === 'short') issues.push({ code: 'too_short', severity: 'info', message: `${n} words — add the how and the result.` });
  if (length === 'long') issues.push({ code: 'too_long', severity: 'warn', message: `${n} words — split it or cut to one or two lines.` });
  if (ctx.roleTense === 'past' && lead.tense === 'present') issues.push({ code: 'tense', severity: 'warn', message: 'Past role written in present tense.' });
  if (ctx.roleTense === 'past' && lead.tense === 'gerund') issues.push({ code: 'tense', severity: 'warn', message: 'Starts with an -ing word — use the past tense verb.' });
  // Impact 0..1 (the rubric's A-dimension for one bullet; the doc scorer weights by recency).
  const impact = leadScore * 0.30 + (metrics.length ? 0.40 : 0) + lengthScore * 0.14 + (buzzwords.length || fillers.length || vague.length ? 0 : 0.10) + (outcome ? 0.06 : 0);
  return {
    text: t, words: n, length, lead, metrics, pronouns, passive, buzzwords, fillers, vague, outcome,
    impact: Number(impact.toFixed(3)), issues,
  };
}

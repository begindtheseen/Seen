// Job keyword layer for tailoring: the posting's vocabulary beyond the taxonomy.
//
// The Resume Intelligence engine knows canonical concepts (taxonomy); a posting also carries its
// own open-vocabulary terms ("480V three-phase", "lockout/tagout", "Epic", "pallet jack") that
// decide keyword scans. This module merges three sources into one weighted keyword list:
//   1. taxonomy requirements from buildJobProfile (weight = importance, 0.3–1.0) — ONE entry per
//      concept, carrying every alias as a matchable surface;
//   2. explicitly LISTED skills after a cue like "experience with: a, b, c" (0.6);
//   3. salient ranked terms — multi-word phrases and repeated content words from the sanitized
//      posting, minus the company/title/location and job-ad boilerplate (0.25–0.55 by frequency).
// Matching is phrase-level and word-boundary safe; single tokens also match on a 5+ letter stem so
// "troubleshooting" finds "troubleshoot". Deterministic, no I/O.
//
// Keyword shape: { term, display, weight, source: 'taxonomy'|'listed'|'ranked', concept, surfaces[] }
// — `term` is the primary surface, `surfaces` every surface that counts as the same keyword.

import { buildJobProfile } from '../../resume-intelligence/jobProfile.js';
import { sanitizeJobText } from '../../resume-intelligence/sanitize.js';
import { extractListedSkills } from '../../resume-intelligence/concepts.js';
import { getConcept, normSurface } from '../../resume-intelligence/taxonomy.js';
import { rankKeywords, buildExcludeSet } from '../../server/resumeAnalysis.js';

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const GENERIC = new Set(['experience', 'ability', 'skills', 'strong', 'excellent', 'good', 'working', 'knowledge', 'understanding', 'team', 'work', 'environment', 'required', 'preferred', 'plus', 'must', 'years', 'year', 'including', 'related', 'relevant', 'position', 'role', 'candidate', 'company', 'job', 'duties', 'responsibilities', 'requirements', 'qualifications', 'benefits', 'other', 'daily', 'basis', 'time', 'full', 'part', 'hours', 'shift', 'shifts', 'weekends', 'holidays', 'pay', 'rate', 'hour', 'salary', 'apply', 'applicants', 'equal', 'opportunity', 'employer', 'background', 'check', 'drug', 'screen', 'high', 'school', 'diploma', 'degree', 'bachelor', 'associate', 'master', 'communication', 'written', 'verbal', 'detail', 'oriented', 'fast', 'paced', 'self', 'motivated', 'reliable', 'dependable', 'able', 'lift', 'lbs', 'pounds', 'stand', 'walk', 'sit', 'bend', 'reach', 'valid', 'license', 'driver', 'transportation', 'authorized', 'eligible', 'united', 'states', 'us', 'usa', 'location', 'onsite', 'remote', 'hybrid', 'city', 'state', 'area', 'local', 'travel', 'new', 'great', 'best', 'join', 'looking', 'seeking', 'hiring', 'ideal', 'successful', 'passion', 'passionate', 'love', 'enjoy', 'fun', 'culture', 'growth', 'career', 'opportunities', 'people', 'customers', 'customer', 'clients', 'client', 'members', 'member', 'service', 'services', 'quality', 'safety', 'standards', 'policies', 'procedures', 'needs', 'business', 'needed', 'various', 'general', 'overall', 'support', 'assist', 'help', 'ensure', 'maintain', 'perform', 'provide', 'manage', 'handle', 'etc', 'well', 'highly', 'also', 'within', 'across', 'using', 'use', 'via', 'per', 'based', 'level', 'levels', 'read', 'lead', 'install', 'systems', 'system', 'code', 'operation', 'operations', 'projects', 'project', 'metro', 'sites', 'site', 'proficient', 'proficiency', 'enforce', 'enforces', 'familiar', 'familiarity', 'demonstrated', 'proven', 'minimum', 'maximum', 'least', 'prior', 'previous', 'similar', 'equivalent', 'combination', 'plus', 'bonus', 'desired', 'nice', 'willing', 'willingness', 'available', 'availability', 'flexible', 'flexibility', 'schedule', 'scheduled', 'overtime', 'weekend', 'night', 'nights', 'day', 'days', 'week', 'weekly', 'month', 'monthly', 'annual', 'annually', 'competitive', 'compensation', 'wage', 'wages', 'bonuses', 'insurance', 'dental', 'vision', 'medical', '401k', 'pto', 'vacation', 'paid', 'holiday', 'ensures', 'ensuring', 'including', 'includes', 'include', 'responsible', 'responsibility', 'accountable', 'essential', 'functions', 'function', 'physical', 'demands', 'requirement', 'qualification', 'preferred', 'required', 'education', 'certifications', 'certification', 'certified', 'licensed', 'licensure', 'applicable', 'appropriate', 'necessary', 'additional', 'duties', 'assigned', 'tasks', 'task', 'activities', 'activity', 'items', 'item', 'areas', 'ways', 'things', 'something', 'anything', 'everything', 'individual', 'individuals', 'person', 'employees', 'employee', 'staff', 'management', 'manager', 'supervisor', 'director', 'leadership', 'leader', 'leaders', 'leading', 'leads', 'coordinate', 'coordinating', 'coordination', 'communicate', 'communicating', 'collaborate', 'collaboration', 'collaborative', 'interpersonal', 'organizational', 'organization', 'organized', 'problem', 'solving', 'multitask', 'multitasking', 'prioritize', 'prioritizing', 'attention', 'details', 'accuracy', 'accurate', 'efficient', 'efficiently', 'effective', 'effectively', 'professional', 'professionalism', 'positive', 'attitude', 'energetic', 'enthusiastic', 'friendly', 'outgoing', 'personable', 'punctual', 'honest', 'integrity', 'ethic', 'ethics', 'hardworking', 'hard', 'independently', 'independent', 'minimal', 'supervision', 'direction', 'instructions', 'instruction', 'guidance', 'training', 'train', 'trained', 'learn', 'learning', 'quickly', 'quick', 'adapt', 'adaptable', 'change', 'changing', 'dynamic', 'results', 'result', 'driven', 'goal', 'goals', 'target', 'targets', 'performance', 'metrics', 'success', 'succeed', 'successful', 'contribute', 'contributing', 'contribution', 'impact', 'impactful', 'meaningful', 'mission', 'values', 'value', 'vision', 'purpose', 'committed', 'commitment', 'dedicated', 'dedication', 'focus', 'focused', 'excellence', 'exceptional', 'outstanding', 'superior', 'world', 'class', 'leading', 'industry', 'market', 'leader', 'innovative', 'innovation', 'cutting', 'edge', 'state', 'art', 'exciting', 'rewarding', 'challenging', 'diverse', 'inclusive', 'diversity', 'inclusion', 'equity', 'belonging', 'veteran', 'veterans', 'disability', 'disabilities', 'accommodation', 'accommodations', 'reasonable', 'protected', 'status', 'race', 'color', 'religion', 'sex', 'gender', 'identity', 'orientation', 'national', 'origin', 'age', 'genetic', 'information', 'marital', 'pregnancy', 'law', 'laws', 'federal', 'regulations', 'regulation', 'compliance', 'comply', 'accordance']);

/**
 * @param {string} jobDescription
 * @param {{ jobTitle?: string, company?: string, location?: string }} opts
 */
export function extractJobKeywords(jobDescription, { jobTitle = '', company = '', location = '' } = {}) {
  const jd = String(jobDescription || '');
  const groups = new Map();   // group key → keyword
  const surfaceOwner = new Map(); // surface → group key (a surface belongs to one keyword)
  const contains = (long, short) => new RegExp(`(?<![a-z0-9])${esc(short)}(?![a-z0-9])`).test(long);
  const put = (surface, display, weight, source, concept = null) => {
    const key = normSurface(surface);
    if (!key || key.length < 3) return;
    let gkey = concept ? `c:${concept}` : `t:${normSurface(display) || key}`;
    const owner = surfaceOwner.get(key);
    if (owner && owner !== gkey) {
      // the same surface already belongs to another keyword (a taxonomy alias that is also a listed
      // skill) — just raise that keyword's weight
      const g = groups.get(owner); g.weight = Math.max(g.weight, weight); return;
    }
    if (!concept && !groups.has(gkey)) {
      // An open-vocabulary term inside an existing keyword's surface ("controls" in "motor controls",
      // "certification" in "OSHA certification") is that keyword, not a new one — and it must NOT
      // become a surface of it, or the generic word would satisfy the specific requirement.
      // (ranked terms arrive stemmed — "control" for "controls" — so a word of the surface that
      // starts with a 4+ letter stem counts as containment too)
      const subsumed = (sfc) => sfc !== key && (contains(sfc, key) || (key.length >= 4 && !key.includes(' ') && sfc.split(' ').some((w) => w !== key && w.startsWith(key))));
      for (const g of groups.values()) if (g.surfaces.some(subsumed)) { g.weight = Math.max(g.weight, weight * 0.5); return; }
      // A longer open-vocabulary phrase that extends an existing open-vocabulary keyword ("480V
      // three-phase systems" over the engine's "480v three") joins it and becomes its display.
      for (const [k, g] of groups) {
        if (g.concept) continue;
        if (g.surfaces.some((sfc) => sfc !== key && contains(key, sfc))) { gkey = k; g.display = display || surface; g.term = key; break; }
      }
    }
    let g = groups.get(gkey);
    if (!g) { g = { term: key, display: display || surface, weight, source, concept, surfaces: [] }; groups.set(gkey, g); }
    g.weight = Math.max(g.weight, weight);
    if (!g.surfaces.includes(key)) g.surfaces.push(key);
    surfaceOwner.set(key, gkey);
  };

  // 1. Taxonomy requirements (one keyword per concept; every alias is a surface).
  const profile = buildJobProfile(jd, { jobTitle, company });
  for (const r of profile.requirements) {
    if (r.category === 'experience' || r.category === 'education') continue;
    const c = r.canonicalConcept ? getConcept(r.canonicalConcept) : null;
    const w = Math.max(0.3, Math.min(1, r.importance || 0.5));
    put(r.displayName, r.displayName, w, 'taxonomy', r.canonicalConcept);
    if (c) for (const a of [c.display, ...(c.aliases || [])]) put(a, r.displayName, w, 'taxonomy', r.canonicalConcept);
  }

  // 2. Listed skills after a cue ("experience with …", "proficient in …").
  const san = sanitizeJobText(jd);
  for (const line of san.lines) {
    for (const clause of String(line).split(/(?<=[.;!?])\s+/)) {
      for (const phrase of extractListedSkills(clause)) put(phrase, phrase, 0.6, 'listed');
    }
  }

  // 3. Ranked salient terms (phrases weigh more; repeated words weigh more) minus noise.
  const exclude = buildExcludeSet(company, jobTitle);
  for (const w of normSurface(location).split(' ')) if (w.length >= 3) exclude.add(w);
  for (const k of rankKeywords(san.text, 40, exclude)) {
    const words = k.term.split(' ');
    if (words.every((w) => GENERIC.has(w))) continue;
    if (!k.isPhrase && (GENERIC.has(k.term) || k.term.length < 4 || /^\d/.test(k.term))) continue;
    // a ranked term that is a sub-phrase of a taxonomy/listed keyword is that keyword, not a new one
    const norm = normSurface(k.term);
    if (surfaceOwner.has(norm)) continue;
    const weight = k.isPhrase ? Math.min(0.55, 0.35 + 0.05 * k.count) : Math.min(0.45, 0.2 + 0.05 * k.count);
    put(k.term, k.display, weight, 'ranked');
  }
  const out = [...groups.values()];
  for (const g of out) g.surfaces.sort((a, b) => b.length - a.length); // longest surface first
  return out.sort((a, b) => b.weight - a.weight || a.term.localeCompare(b.term));
}

function surfaceIn(hay, term) {
  if (term.includes(' ')) {
    const m = hay.match(new RegExp(`(?<![a-z0-9])${esc(term).replace(/ /g, '\\s+')}(?![a-z0-9])`));
    return m ? m[0] : null;
  }
  const exact = hay.match(new RegExp(`(?<![a-z0-9])${esc(term)}(?![a-z0-9])`));
  if (exact) return exact[0];
  // a plural posting term matches its singular ("PLCs" → "PLC basics", "forklifts" → "forklift")
  if (/^[a-z0-9]{3,}s$/.test(term)) {
    const sing = hay.match(new RegExp(`(?<![a-z0-9])${esc(term.slice(0, -1))}(?![a-z0-9])`));
    if (sing) return sing[0];
  }
  if (term.length >= 5) {
    const stem = term.replace(/(ing|ings|ed|es|s|er|ers|ion|ions)$/, '');
    if (stem.length >= 5) {
      const m = hay.match(new RegExp(`(?<![a-z0-9])(${esc(stem)}[a-z]{0,5})(?![a-z0-9])`));
      if (m) return m[1];
    }
  }
  return null;
}

/** Does `text` contain the keyword (any of its surfaces; phrase-level; 5+ letter stems for single tokens)? Returns the matched span or null. */
export function keywordIn(text, kw) {
  const hay = normSurface(text);
  for (const term of kw.surfaces && kw.surfaces.length ? kw.surfaces : [kw.term]) {
    const span = surfaceIn(hay, term);
    if (span) return span;
  }
  return null;
}

/** Coverage of a keyword list by a text: { matched: [{...kw, span}], missing: [kw], ratio } (weighted). */
export function keywordCoverage(text, keywords) {
  const matched = [], missing = [];
  for (const kw of keywords) {
    const span = keywordIn(text, kw);
    if (span) matched.push({ ...kw, span }); else missing.push(kw);
  }
  const total = keywords.reduce((s, k) => s + k.weight, 0);
  const ratio = total ? Number((matched.reduce((s, k) => s + k.weight, 0) / total).toFixed(2)) : 1;
  return { matched, missing, ratio };
}

/** Score one bullet against the job's keywords: weight per matched keyword (+0.15 when it carries a number). */
export function scoreBulletKeywords(text, keywords) {
  const hits = [];
  let score = 0;
  for (const kw of keywords) {
    const span = keywordIn(text, kw);
    if (!span) continue;
    hits.push({ requirement: kw.display, weight: kw.weight, source: kw.source, span });
    score += kw.weight;
  }
  const metricBonus = hits.length && /\d/.test(text) ? 0.15 : 0;
  return { score: Number((score + metricBonus).toFixed(3)), hits };
}

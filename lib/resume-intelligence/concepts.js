// Resume Intelligence Engine — CONCEPT / ENTITY EXTRACTION (Phase 4).
//
// "Phrases before words." We match the text against the taxonomy's alias phrases LONGEST-FIRST and
// consume each matched span, so "warehouse management system" resolves to one concept and never
// also emits "management". Then a generic-word-suppressed open-vocabulary pass picks up real skills
// the taxonomy has never seen (NEC code, curriculum design) without turning every noun into a skill.
//
// Methodology adapted (clean-room) from SkillNER (MIT): tokenize → longest-phrase match against a
// concept knowledge base → coverage. spaCy is not needed — Seen's hasWord gives boundary-safe
// matching and the taxonomy carries the surface forms. NO AI, NO I/O.

import { aliasSurfaces, resolveConcept, conceptPlausibleFor, normSurface } from './taxonomy.js';

// Single-word alias surfaces that collide with ordinary English — trust them ONLY when the role
// family makes the concept plausible (so "react to an incident" in a security JD is not React, and
// "rest breaks" is not REST APIs). Multi-word aliases are unambiguous and never gated here.
const AMBIGUOUS_ALIAS = new Set(['rest', 'register', 'react', 'go', 'ml', 'sap', 'iv', 'pos', 'r', 'c', 'ai', 'it', 'ar', 'vr', 'aws']);

// Generic tokens that must never, alone, be a skill (mandate's generic-word suppression). A phrase
// is kept only if it has ≥1 non-generic content word.
const GENERIC = new Set([
  'experience', 'ability', 'able', 'team', 'work', 'working', 'responsible', 'candidate', 'preferred',
  'required', 'requirement', 'requirements', 'knowledge', 'strong', 'excellent', 'good', 'perform',
  'help', 'support', 'ensure', 'ensuring', 'position', 'role', 'duties', 'duty', 'including', 'various',
  'skills', 'skill', 'proficient', 'proficiency', 'familiar', 'familiarity', 'understanding', 'expertise',
  'must', 'will', 'you', 'your', 'our', 'their', 'other', 'related', 'following', 'plus', 'years', 'year',
  'new', 'daily', 'general', 'basic', 'advanced', 'level', 'using', 'used', 'use', 'quality', 'high',
  'company', 'business', 'member', 'members', 'people', 'staff', 'day', 'time', 'need', 'needs', 'want',
  'provide', 'maintain', 'operate', 'handle', 'assist', 'deliver', 'complete', 'meet', 'based',
]);
const STOP = new Set(['a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'with', 'for', 'on', 'at', 'by', 'as', 'is', 'are', 'be', 'per', 'via', 'from', 'into', 'that', 'this', 'who', 'which']);

// Replace the first whole-word occurrence of `phrase` in `hay` (a padded, lowercased string) with
// spaces so overlapping shorter aliases can't re-match the same span. Returns the new string, or
// null when there is no boundary-safe occurrence.
function consumeWord(hay, phrase) {
  let from = 0;
  while (true) {
    const idx = hay.indexOf(phrase, from);
    if (idx === -1) return null;
    const before = idx === 0 ? ' ' : hay[idx - 1];
    const after = idx + phrase.length >= hay.length ? ' ' : hay[idx + phrase.length];
    const okB = !/[a-z0-9]/.test(before) || !/[a-z0-9]/.test(phrase[0]);
    const okA = !/[a-z0-9]/.test(after) || !/[a-z0-9]/.test(phrase[phrase.length - 1]);
    if (okB && okA) return hay.slice(0, idx) + ' '.repeat(phrase.length) + hay.slice(idx + phrase.length);
    from = idx + 1;
  }
}

// Extract TAXONOMY concepts from text. Longest alias first, span-consuming, deduped by concept id.
// Ambiguous single-word aliases are gated by role-family plausibility. Returns
// [{ id, surface, display, category, gated:false }].
export function extractTaxonomyConcepts(text, { family = 'general' } = {}) {
  let remaining = ' ' + normSurface(text) + ' ';
  const found = new Map(); // id → { id, surface, display, category }
  const rejected = [];     // { surface, reason } for the debug view
  for (const surface of aliasSurfaces()) {
    if (!remaining.includes(surface)) continue;
    // Ambiguity gate: a bare English-colliding alias must be plausible for the role.
    const single = !surface.includes(' ');
    let next = consumeWord(remaining, surface);
    while (next !== null) {
      const res = resolveConcept(surface);
      if (res) {
        if (single && AMBIGUOUS_ALIAS.has(surface) && !conceptPlausibleFor(res.id, family)) {
          rejected.push({ surface, reason: `ambiguous token "${surface}" not plausible for ${family}` });
        } else if (!found.has(res.id)) {
          found.set(res.id, { id: res.id, surface, display: res.display, category: res.category, gated: false });
        }
      }
      remaining = next;
      next = consumeWord(remaining, surface);
    }
  }
  return { concepts: [...found.values()], rejected };
}

// Open-vocabulary extraction for skills the taxonomy has never seen (NEC code, curriculum design,
// specimen collection). Skills are LISTED, not prose-mined — so we fire only on an explicit skill-
// list cue ("Required:", "proficient in", "experience with", "skills:") and take the comma/and/or-
// separated tail, applying the full junk firewall: URL/id contamination, bare credential words,
// generic prose nouns, generic-verb-led sentence fragments, and generic-only phrases are all
// rejected. This is precise (matches how JDs actually list skills) instead of turning every noun
// into a skill. Returns [phrase]. Caller filters out anything the taxonomy already resolved.
const REQ_LIST_CUE = /\b(required|requirements?|must have|preferred|nice to have|qualifications?|skills?|proficient in|proficiency in|experience (?:with|in)|knowledge of|skilled in|familiar\w* with|expertise in|background in|understanding of)\b\s*[:\-]?\s*/i;
const CONTAMINATED = /[/@_]|[?=&#]|\b[a-z0-9-]{2,}\.(?:com|org|net|io|biz|co|gov|edu|info|xyz|us|app|dev|link)\b|\d{4,}/i;
const CREDENTIAL_LEAD = /^(licens\w*|certif\w*|credential)\b/;
// Any credential/license token → defer the whole item to the structured cert extractor (which
// classifies it as a must-not-invent credential), so "Valid Class A CDL" never becomes a soft skill.
const CREDENTIAL_TOKEN = /\b(cdl|licen[cs]e|licensure|certif\w*|certification|clearance|diploma|osha|hazmat|twic|servsafe)\b/i;
const GENERIC_LEAD = new Set(['provide', 'ensure', 'perform', 'operate', 'maintain', 'assist', 'support', 'help', 'handle', 'follow', 'complete', 'based', 'using', 'deliver', 'drive', 'conduct', 'participate', 'meet', 'manage', 'work', 'create', 'build', 'develop', 'respond']);
const GENERIC_OPEN_NOUN = new Set(['team members', 'team member', 'members', 'member', 'technology', 'guests', 'guest', 'company policy', 'policy', 'policies', 'equivalent', 'age', 'tools', 'duties', 'staff', 'people', 'environment', 'business needs', 'other duties', 'where applicable']);

export function extractListedSkills(clause) {
  const m = REQ_LIST_CUE.exec(clause);
  if (!m) return [];
  const tail = clause.slice(m.index + m[0].length);
  const out = new Set();
  for (const raw of tail.split(/[,;|]|\s+and\s+|\s+or\s+|\s*\/\s*/)) {
    if (CONTAMINATED.test(raw)) continue;
    if (CREDENTIAL_TOKEN.test(raw)) continue; // defer credentials/licenses to the structured extractor
    let s = raw.replace(/[.()]/g, ' ').replace(/\b(\d+\+?\s*years?(?:\s+of)?)\b/gi, ' ')
      .replace(/\b(experience|proficien\w*|knowledge|skills?|expertise|background|familiar\w*|understanding|strong|excellent|good|solid|working|ability\s+to|ability)\b/gi, '')
      .replace(/\s+/g, ' ').trim().toLowerCase();
    if (s.length < 3 || s.length > 40) continue;
    if (CREDENTIAL_LEAD.test(s)) continue;
    if (GENERIC_OPEN_NOUN.has(s)) continue;
    const words = s.split(' ').filter((w) => !STOP.has(w));
    if (!words.length) continue;
    if (GENERIC_LEAD.has(words[0])) continue;
    if (words.length > 1 && /ing$/.test(words[0])) continue; // gerund-led = a verb phrase, not a skill ("preventing theft")
    if (words.every((w) => GENERIC.has(w))) continue; // all-generic phrase → not a skill
    if (words.length > 4) continue;
    const phrase = words.join(' ');
    if (phrase.length >= 3) out.add(phrase);
  }
  return [...out];
}

export { GENERIC, STOP, AMBIGUOUS_ALIAS };

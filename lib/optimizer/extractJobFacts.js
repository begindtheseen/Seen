// Deterministic job description → facts extraction. NO external AI.
//
// v2 (2026-10-24, after two expert audits): the posting is SECTIONED first and requirements are
// read only from the sections that state them (Requirements / Responsibilities / Preferred /
// Physical / Schedule — never Benefits, Culture, EEO or the company blurb); skills are matched
// on word STEMS so "training" meets "Trained"; the hourly vocabulary (hourlyVocabulary.js) gives
// cashier, sales-floor, front-desk, food and warehouse postings their real words; generic soft
// skills need a requirement cue in their sentence; verb-shaped tokens (excel, lead, drive) need a
// tool cue; the posting's own title words are never a skill; and years, degree + GPA,
// certification, schedule, physical, language and management scope come out as structured
// CONSTRAINT facts (postingSections.extractConstraints) with their own match rules.
import { canonicalText, normalizeSkill, BUILTIN_TAXONOMY } from './normalizeSkills.js';
import { detectRoleFamily } from '../application-intelligence/roleOntology.js';
import { requirementSentences, sectionPosting, extractConstraints, REQUIREMENT_CUE_RE } from './postingSections.js';
import { SOFT_SKILLS, AMBIGUOUS_TOKENS, LEADERSHIP_NOT_A_REQUIREMENT, TITLE_WORDS, vocabularySkills } from './hourlyVocabulary.js';
import { tokenize, findStemmed, stemPhrase, dehyphenate } from './lemma.js';

export const JOB_FACTS_VERSION = 'jobfacts_v2';

// Programming/infra canonical tokens that must NOT be evaluated for a non-technical role — the
// ambiguous ones (`go`, `rest`) collide with ordinary English and `aws` aliases resolve to a
// cloud term no retail/security JD is actually asking for. Gated behind detectRoleFamily so a
// software/data role still gets its full technical vocabulary. (Excel, Salesforce, CRM, SAP,
// data analytics stay cross-industry and are intentionally NOT in this set.)
const TECH_CANON = new Set([
  'javascript', 'typescript', 'python', 'java', 'c#', 'c++', 'go', 'ruby', 'php', 'swift', 'kotlin', 'rust',
  'react', 'angular', 'vue', 'node.js', 'next.js', 'express', 'django', 'flask', 'rails', 'spring',
  'sql', 'postgresql', 'mysql', 'mongodb', 'redis', 'graphql', 'rest',
  'aws', 'google cloud', 'azure', 'docker', 'kubernetes', 'terraform', 'ci/cd', 'git',
]);
const TECH_FAMILIES = new Set(['software_engineering', 'data_analytics']);
// Same recognized vocabulary as the résumé side, so a job skill and a résumé skill
// normalize to the same canonical token.
export const KNOWN_SKILLS = [
  'javascript', 'typescript', 'python', 'java', 'c#', 'c++', 'go', 'ruby', 'php', 'swift', 'kotlin', 'rust',
  'react', 'angular', 'vue', 'node.js', 'next.js', 'express', 'django', 'flask', 'rails', 'spring',
  'sql', 'postgresql', 'mysql', 'mongodb', 'redis', 'graphql', 'rest',
  'aws', 'google cloud', 'azure', 'docker', 'kubernetes', 'terraform', 'ci/cd', 'git',
  'machine learning', 'data analytics', 'data science', 'tableau', 'power bi', 'excel',
  'microsoft word', 'microsoft powerpoint', 'google workspace', 'microsoft office', 'salesforce', 'crm', 'quickbooks', 'sap',
  'customer service', 'customer intake', 'point of sale', 'cash handling', 'route planning', 'logistics',
  'inventory management', 'scheduling', 'data entry', 'accounting', 'bookkeeping', 'phlebotomy',
  'food safety', 'forklift', 'warehouse', 'shipping', 'receiving', 'merchandising', 'sales',
  'leadership', 'team management', 'project management', 'communication', 'teamwork',
  'time management', 'problem solving', 'conflict resolution', 'training', 'onboarding',
  'hospitality', 'retail', 'call center', 'quality assurance', 'workforce management', 'vendor management', 'strategic planning', 'budgeting',
  ...vocabularySkills(),
];
const ALIAS_PHRASES = Object.keys(BUILTIN_TAXONOMY.aliases);
const PHRASES = [...new Set([...KNOWN_SKILLS, ...ALIAS_PHRASES])].map((phrase) => ({ phrase, stems: stemPhrase(phrase) })).filter((p) => p.stems.length);
// Industry words that are context, not a skill, when they only name where the work happens.
const INDUSTRY_WORDS = new Set(['retail', 'hospitality', 'call center', 'warehouse']);
const PREFERRED_CUE = /\b(prefer(?:red)?|nice to have|a plus|bonus|ideal(?:ly)?|desired|would be great|familiarity with|exposure to|helpful)\b/i;
const SENIORITY_TITLE = [
  { re: /\b(chief|vp|vice president|c-level)\b/i, level: 'executive', rank: 6 },
  { re: /\b(director|head of)\b/i, level: 'director', rank: 5 },
  { re: /\b(manager|supervisor|principal|staff)\b/i, not: /\b(assistant\s+manager)\b/i, level: 'lead', rank: 4 },
  { re: /\b(?:team|shift)\s+lead\b|\blead\s+(?:cashier|associate|barista|teller|server|technician)\b/i, level: 'mid', rank: 2 },
  { re: /\blead\b/i, level: 'lead', rank: 4 },
  { re: /\b(senior|sr\.?)\b/i, level: 'senior', rank: 3 },
  { re: /\b(junior|jr\.?|entry[- ]?level|intern|trainee|graduate|seasonal|part[- ]time)\b/i, level: 'entry', rank: 1 },
];
const HOURLY_FAMILIES = new Set(['retail', 'customer_service', 'food_service', 'hospitality', 'valet_parking', 'warehouse', 'delivery_logistics', 'security']);

// The posting's own title, masked out of a sentence before matching: "As a Customer Service
// Representative you will…" is the job naming itself, not a requirement.
function maskTitle(sentence, title) {
  const t = String(title || '').split(/\s+[-–—|(]\s*|\s*\(/)[0].trim();
  if (t.length < 4) return sentence;
  const re = new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+') + 's?', 'gi');
  return sentence.replace(re, (m) => ' '.repeat(m.length));
}

/**
 * @param {string} jobDescription
 * @param {{ jobTitle?: string, taxonomy?: object }} opts
 * @returns facts: skill facts, constraint facts, one seniority fact
 */
export function extractJobFacts(jobDescription, opts = {}) {
  const taxonomy = opts.taxonomy || BUILTIN_TAXONOMY;
  const text = dehyphenate(String(jobDescription || ''));
  const title = String(opts.jobTitle || '');
  const roleFam = detectRoleFamily(title, text);
  const isTech = TECH_FAMILIES.has(roleFam.family);

  // Sentences a requirement may be read from. A posting with no recognisable requirement text
  // (an Adzuna teaser) yields nothing — better an honest empty than a grep over a pay disclaimer.
  let rows = requirementSentences(text);
  if (!rows.length) rows = sectionPosting(text).filter((r) => (r.kind === 'about' || r.kind === 'other') && REQUIREMENT_CUE_RE.test(r.sentence)).map((r) => ({ sentence: r.sentence, kind: 'requirements', importance: 'required', explicit: false }));

  // skill → best importance found (required beats preferred)
  const found = new Map();
  const rank = { nice_to_have: 0, preferred: 1, responsibility: 2, required: 3 };
  for (const row of rows) {
    const sentence = row.sentence;
    const tokens = tokenize(maskTitle(sentence, title));
    const hasCue = REQUIREMENT_CUE_RE.test(sentence);
    const pref = row.importance === 'preferred' || (PREFERRED_CUE.test(sentence) && !/\b(?:required|must)\b/i.test(sentence));
    const importance = pref ? 'preferred' : row.importance === 'responsibility' ? 'responsibility' : 'required';
    for (const { phrase, stems } of PHRASES) {
      if (!findStemmed(tokens, stems).length) continue;
      const normalized = normalizeSkill(phrase, taxonomy);
      if (!normalized) continue;
      // a job-title head noun (cashier, associate, crew member) is the job, never a skill
      if (TITLE_WORDS.has(normalized) || TITLE_WORDS.has(phrase)) continue;
      // verb-shaped tokens need a tool cue in THIS sentence ("how we grow and excel" is a verb)
      if (AMBIGUOUS_TOKENS[normalized] && !AMBIGUOUS_TOKENS[normalized].test(sentence)) continue;
      if (normalized === 'leadership' && LEADERSHIP_NOT_A_REQUIREMENT.test(sentence)) continue;
      // a generic soft skill is a requirement only in a sentence that asks for something
      if (SOFT_SKILLS.has(normalized) && !hasCue) continue;
      // an industry word names where the work happens — a skill only when the posting asks for
      // experience in it ("retail experience preferred")
      if (INDUSTRY_WORDS.has(normalized) && !/\b(?:experience|background)\b/i.test(sentence)) continue;
      const prev = found.get(normalized);
      if (prev) prev.phrases.add(phrase);
      if (!prev || rank[importance] > rank[prev.importance]) found.set(normalized, { importance, phrases: prev ? prev.phrases : new Set([phrase]), evidence: sentence.slice(0, 240), section: row.kind, mentions: (prev ? prev.mentions : 0) + 1 });
      else prev.mentions += 1;
    }
  }

  const facts = [];
  const anyRequired = [...found.values()].some((v) => v.importance === 'required');
  for (const [normalized, { importance, phrases, evidence, section, mentions }] of found) {
    let imp = importance;
    if (imp === 'responsibility') imp = 'required'; // a core duty IS a requirement of the job
    if (!anyRequired && imp === 'nice_to_have') imp = 'required';
    const soft = SOFT_SKILLS.has(normalized);
    // Weight: a stated requirement 1, a duty 0.5 (taught on the job, not screened), preferred 0.6; a soft skill
    // counts a third (no recruiter screens on "communication" alone); a skill the posting states
    // more than once counts a little more (prominence, capped).
    let weight = imp === 'required' ? (importance === 'responsibility' ? 0.5 : 1) : imp === 'preferred' ? 0.6 : 0.4;
    if (soft) weight *= 0.35;
    if (mentions > 1) weight = Math.min(weight * 1.15, 1.15);
    facts.push({
      factType: 'skill',
      // display the canonical skill ("cash handling"), keep every posting phrase for the ATS
      // literal check and the wording notes ("cash drawer", "cash handling")
      label: normalized, normalizedLabel: normalized, postingPhrases: [...phrases],
      importance: imp, weight: Number(weight.toFixed(3)),
      // a HARD requirement: stated in a requirements sentence, not a duty, not a soft skill
      hard: imp === 'required' && importance !== 'responsibility' && !soft,
      soft, confidence: 0.8, evidence, section, extractor: JOB_FACTS_VERSION,
    });
  }

  // Structured constraints (years, degree, certification, schedule, physical, language, …).
  for (const c of extractConstraints(text, { jobTitle: title })) {
    facts.push({
      factType: 'constraint', kind: c.kind, label: c.label, normalizedLabel: `constraint:${c.kind}:${String(c.value).toLowerCase().slice(0, 60)}`,
      importance: c.importance, weight: 1, confidence: 0.8, gate: !!c.gate, value: c.value, items: c.items || null,
      alternatives: c.alternatives || null, gpa: c.gpa || null, management: !!c.management, evidence: c.sentence.slice(0, 240), extractor: JOB_FACTS_VERSION,
    });
  }

  // Seniority: the TITLE decides; the body only when the title is silent, and then only
  // years-of-management in the requirement sentences — never "the Store Manager" in a duty.
  let seniority = null;
  for (const { re, not, level } of SENIORITY_TITLE) if (re.test(title) && !(not && not.test(title))) { seniority = level; break; }
  if (!seniority) {
    const mgmt = facts.find((f) => f.factType === 'constraint' && (f.kind === 'management' || (f.kind === 'years' && f.management)));
    if (mgmt) seniority = 'lead';
    else if (rows.some((r) => /\b(?:senior|sr\.)\s+(?:level|role|position)\b/i.test(r.sentence))) seniority = 'senior';
    else if (HOURLY_FAMILIES.has(roleFam.family) || /\b(associate|cashier|clerk|crew|team member|attendant|representative|barista|server|stocker|picker|packer)\b/i.test(title)) seniority = 'entry';
  }
  if (seniority) facts.push({ factType: 'seniority', label: seniority, normalizedLabel: `seniority:${seniority}`, importance: 'required', weight: 1, confidence: 0.7, extractor: JOB_FACTS_VERSION });

  if (!isTech) return facts.filter((f) => !(f.factType === 'skill' && TECH_CANON.has(f.normalizedLabel)));
  return facts;
}

export function jobSeniorityRank(facts) {
  const levelRank = { entry: 1, mid: 2, senior: 3, lead: 4, director: 5, executive: 6 };
  for (const f of facts) if (f.factType === 'seniority') return levelRank[f.label] || 0;
  return 0;
}

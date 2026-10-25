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
import { normalizeSkill, BUILTIN_TAXONOMY, mergeTaxonomy } from './normalizeSkills.js';
import { detectRoleFamily } from '../application-intelligence/roleOntology.js';
import { requirementSentences, sectionPosting, extractConstraints, REQUIREMENT_CUE_RE, PREFERRED_CUE_RE } from './postingSections.js';
import { SOFT_SKILLS, AMBIGUOUS_TOKENS, LEADERSHIP_NOT_A_REQUIREMENT, TITLE_WORDS, vocabularySkills } from './hourlyVocabulary.js';
import { tokenize, findStemmed, stemPhrase, dehyphenate } from './lemma.js';
import { professionalFamilyGates } from './professionalVocabulary.js';

export const JOB_FACTS_VERSION = 'jobfacts_v3'; // v3: alternatives (anyOf) — 2026-10-25

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
const PREFERRED_CUE = PREFERRED_CUE_RE;
// Salaried skills a posting may ask for only inside their role families (professionalVocabulary.js).
const FAMILY_GATES = professionalFamilyGates();
// A degree-equivalence clause ("in lieu of a degree … three years of specialized training … for each
// missing year of college") states the education rule; its words are not skills (Kunai's posting
// read "training" as a hard requirement from it, 2026-10-25).
const EQUIVALENCE_RE = /\bin\s+lieu\s+of\b|\bfor\s+each\s+(?:missing\s+)?year\b|\bequivalent\s+combination\s+of\b/i;
// One skill offered with a hedge right after it: "AWS or other providers", "Tableau or similar".
// The innermost parenthetical around character `index` ({ open, close } offsets) or null.
function parenAround(text, index) {
  let depth = 0;
  for (let i = index - 1; i >= 0; i--) {
    if (text[i] === ')') depth++;
    else if (text[i] === '(') {
      if (depth === 0) {
        let d = 0;
        for (let j = i + 1; j < text.length; j++) {
          if (text[j] === '(') d++;
          else if (text[j] === ')') { if (d === 0) return { open: i, close: j + 1 }; d--; }
        }
        return { open: i, close: text.length };
      }
      depth--;
    }
  }
  return null;
}
// The sentence without the parentheticals that name skills (offsets of their "(").
function stripParens(text, opens) {
  let out = text;
  for (const open of [...opens].sort((a, b) => b - a)) {
    const p = parenAround(text, open + 1);
    if (p) out = out.slice(0, p.open) + ' '.repeat(p.close - p.open) + out.slice(p.close);
  }
  return out;
}
const NEGATED_BEFORE_RE = /(?:\(\s*not\b[^)]*|\bnot\s+(?:purely|just|only|simply|merely)\s+(?:[a-z-]+\s+){0,2})$/i;
const NOT_A_SKILL = {
  intake: /\b(?:asset|file|data|content|creative|document|request|ticket)s?\s+intake\b/i,
  // a TEAM, not the skill: "work with product and compliance to ship …"
  compliance: /\b(?:with|and)\s+(?:product|legal|risk|finance)\s+(?:and|&)\s+compliance\b|\bcompliance\s+(?:team|teams|partners)\b/i,
};
// One skill introduced as an example: "a language like Python", "a BI tool such as Tableau".
const HEDGE_BEFORE_RE = /\b(?:such\s+as|like|e\.g\.?|for\s+example|for\s+instance)\s+(?:[A-Za-z0-9+#./-]+\s+){0,1}$/i;
const HEDGE_AFTER_RE = /^\s*\)?\s*,?\s*(?:or\s+(?:an?\s+)?(?:other|another|similar|equivalent|comparable)\b|etc\b|and\/or\s+(?:other|similar))/i;
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

const TECH_CASED = { go: /(?:^|[^.!?]\s)Go\b(?!\s+(?:to|out|above|beyond|through|the extra))/, rest: /\bREST(?:ful)?\b/ };
function techCased(normalized, sentence) {
  return !!(TECH_CASED[normalized] && TECH_CASED[normalized].test(sentence));
}

// Does a sentence offer a CHOICE among the skills it names? "Go, Java, C/C++ etc.", "Python or
// Ruby", "Java/Kotlin", "at least one of…". Slashes inside one skill's name (C/C++, CI/CD) and
// "would like" are not choices. The free fit check said "Missing required skill: java" to a Go
// engineer for a posting that asked for "at least one of Go, Java, C/C++ etc." (2026-10-25).
const CHOICE_CUE_RE = /\b(?:or|etc|e\.g|such as|like|one of|any of|at least one|similar|equivalent|comparable|and\/or)\b/i;
const NAME_SLASH_RE = /\bc\/c\+\+|\bci\/cd\b|\bpl\/sql\b|\btcp\/ip\b|\bui\/ux\b|\bap\/ar\b|\ba\/b\b|\bpub\/sub\b/gi;
// The skills a sentence offers as one choice: ≥2 skills whose LIST carries the cue — between the
// first and the last of them, or just after the last ("…, C/C++ etc."), or just before the first
// ("at least one of …"). A cue elsewhere in the sentence ("…and work weekends or holidays") does
// not turn a stated list into alternatives.
function choiceAmong(sentence, hits) {
  const none = new Set();
  if (hits.length < 2) return none;
  const sorted = hits.slice().sort((a, b) => a.start - b.start);
  const from = sorted[0].start;
  const to = sorted[sorted.length - 1].end;
  if (to - from > 90) return none; // skills far apart in a long sentence are not one list
  const lower = String(sentence || '').toLowerCase();
  const clean = (t) => t.replace(/\b(?:would|'d|’d)\s+like\b/g, ' ').replace(NAME_SLASH_RE, ' ');
  // a hedge on the LAST skill ("AWS or other providers") is not a choice among all of them
  const rawWithin = clean(lower.slice(from, Math.min(lower.length, to + 14)));
  const HEDGE = /\bor\s+(?:an?\s+)?(?:other|another|similar|equivalent|comparable)\b.*$/;
  // a LIST of skills (only commas / and / or / slashes between them) ending in "or similar" is a choice
  const listy = sorted.every((h, i) => i === 0 || /^[\s,/&]*(?:\b(?:and|or)\b)?[\s,/&]*$/.test(lower.slice(sorted[i - 1].end, h.start)));
  const within = listy && HEDGE.test(rawWithin) ? rawWithin.replace(HEDGE, ' or ') : rawWithin.replace(HEDGE, ' ');
  const before = clean(lower.slice(Math.max(0, from - 40), from));
  // An introducing cue INSIDE the list starts the choice there: in "customer service experience in
  // industries such as hospitality, retail or restaurant", customer service is required and only
  // the industries are examples.
  const intro = /\b(?:such as|like|e\.g\.?|including|one of|any of|at least one|either)\b/.exec(within);
  if (intro) {
    const at = from + intro.index;
    // examples inside parentheses end at the closing parenthesis: "event-driven (e.g. Kafka/CDC), or
    // real-time APIs" offers Kafka or CDC, not APIs
    const open = lower.lastIndexOf('(', at);
    const close = open >= 0 && open > lower.lastIndexOf(')', at) ? lower.indexOf(')', at) : -1;
    const after = sorted.filter((h) => h.start > at && (close < 0 || h.start < close));
    if (after.length < 2) return none;
    const set = new Set(after.map((h) => h.skill));
    // the skill the examples illustrate: "event-driven architectures like Kafka and CDC" → Kafka and
    // CDC are examples OF event-driven architecture, not two more requirements
    const head = sorted.filter((h) => h.end <= at && at - h.end <= 30).pop();
    if (head) set.head = head.skill;
    return set;
  }
  const cue = CHOICE_CUE_RE.test(within) || /[a-z+#]\s*\/\s*[a-z]/.test(within)
    || /\b(?:such as|like|e\.g\.?|one of|any of|at least one|either)\b[^.;]*$/.test(before);
  return cue ? new Set(sorted.map((h) => h.skill)) : none;
}

/**
 * @param {string} jobDescription
 * @param {{ jobTitle?: string, taxonomy?: object }} opts
 * @returns facts: skill facts, constraint facts, one seniority fact
 */
export function extractJobFacts(jobDescription, opts = {}) {
  // A DB taxonomy is an OVERLAY on the built-in one, never a replacement (api/optimizer.js passed
  // the raw DB rows, so in production the hourly vocabulary's aliases were silently dropped).
  const taxonomy = mergeTaxonomy(opts.taxonomy);
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
  // A stated level beats a duty: a skill that is a duty AND "a plus" in Preferred is preferred.
  const rank = { nice_to_have: 0, responsibility: 0.5, preferred: 1, required: 3 };
  // Alternatives: skills a sentence offers as a CHOICE ("at least one of Go, Java, C/C++ etc.")
  // are satisfied by any one of them. skill → group key; a skill also stated on its own elsewhere
  // is a plain requirement (plainStated wins).
  const altGroupOf = new Map();
  const plainStated = new Set();
  const hedged = new Set();
  const examplesOf = new Map(); // head skill → its example skills
  for (const row of rows) {
    const sentenceHits = [];
    const sentence = row.sentence;
    if (EQUIVALENCE_RE.test(sentence)) continue;
    const maskedSentence = maskTitle(sentence, title);
    const tokens = tokenize(maskedSentence);
    const hasCue = REQUIREMENT_CUE_RE.test(sentence);
    const candidates = [];
    for (const { phrase, stems } of PHRASES) {
      const at = findStemmed(tokens, stems);
      if (!at.length) continue;
      const normalized = normalizeSkill(phrase, taxonomy);
      if (!normalized) continue;
      // a negated mention ("(not purely scheduling/community)") or a non-skill sense ("asset intake")
      if (NEGATED_BEFORE_RE.test(maskedSentence.slice(Math.max(0, at[0].start - 40), at[0].start))) continue;
      if (NOT_A_SKILL[phrase] && NOT_A_SKILL[phrase].test(sentence)) continue;
      // a job-title head noun (cashier, associate, crew member) is the job, never a skill
      if (TITLE_WORDS.has(normalized) || TITLE_WORDS.has(phrase)) continue;
      // a salaried skill outside its role families ("accept payments" at a register)
      if (FAMILY_GATES[normalized] && !FAMILY_GATES[normalized].has(roleFam.family)) continue;
      // verb-shaped tokens need a tool cue in THIS sentence ("how we grow and excel" is a verb)
      // (a tech posting's capitalised "Go" / "REST" in a stack list is the language / the API style)
      if (AMBIGUOUS_TOKENS[normalized] && !AMBIGUOUS_TOKENS[normalized].test(sentence) && !(isTech && techCased(normalized, sentence))) continue;
      if (normalized === 'leadership' && LEADERSHIP_NOT_A_REQUIREMENT.test(sentence)) continue;
      // a generic soft skill is a requirement only in a sentence that asks for something
      if (SOFT_SKILLS.has(normalized) && !hasCue) continue;
      // an industry word names where the work happens — a skill only when the posting asks for
      // experience in it ("retail experience preferred")
      if (INDUSTRY_WORDS.has(normalized) && !/\b(?:experience|background)\b/i.test(sentence)) continue;
      candidates.push({ phrase, normalized, all: at });
    }
    // A phrase inside a longer matched phrase is not a second mention: "email marketing operations"
    // is email marketing, not also "marketing operations" (the shorter one counts only where it
    // stands alone — "…, CRM administration, or marketing operations").
    candidates.sort((a, b) => (b.all[0].end - b.all[0].start) - (a.all[0].end - a.all[0].start));
    const claimed = [];
    for (let i = candidates.length - 1; i >= 0; i--) candidates[i].keep = true;
    for (const c of candidates) {
      const free = c.all.find((o) => !claimed.some((k) => k.normalized !== c.normalized && o.start >= k.start && o.end <= k.end));
      if (!free) { c.keep = false; continue; }
      c.at = free;
      c.paren = parenAround(maskedSentence, free.start);
      claimed.push({ start: free.start, end: free.end, normalized: c.normalized });
    }
    for (let i = candidates.length - 1; i >= 0; i--) if (!candidates[i].keep) candidates.splice(i, 1);
    candidates.sort((a, b) => a.at.start - b.at.start);
    // A parenthetical that carries its own level applies to the skills inside it: "Must have basic
    // HTML knowledge (CSS and Handlebar (Or equivalent) is a plus)" requires HTML; CSS and
    // Handlebars are a plus. A bare marker ("Bachelor's degree (preferred)") applies to the sentence.
    const skillParens = new Set(candidates.filter((c) => c.paren).map((c) => c.paren.open));
    const outside = stripParens(sentence, skillParens);
    const pref = row.importance === 'preferred' || (PREFERRED_CUE.test(outside) && !/\b(?:required|must)\b/i.test(outside));
    const importance = pref ? 'preferred' : row.importance === 'responsibility' ? 'responsibility' : 'required';
    for (const c of candidates) {
      const { phrase, normalized } = c;
      let imp = importance;
      if (c.paren && imp !== 'preferred') {
        const inner = sentence.slice(c.paren.open, c.paren.close);
        if (PREFERRED_CUE.test(inner) && !/\b(?:required|must)\b/i.test(inner)) imp = 'preferred';
      }
      const prev = found.get(normalized);
      if (prev) prev.phrases.add(phrase);
      if (!prev || rank[imp] > rank[prev.importance]) found.set(normalized, { importance: imp, phrases: prev ? prev.phrases : new Set([phrase]), evidence: sentence.slice(0, 240), section: row.kind, mentions: (prev ? prev.mentions : 0) + 1 });
      else prev.mentions += 1;
      if (!sentenceHits.some((h) => h.skill === normalized)) sentenceHits.push({ skill: normalized, start: c.at.start, end: c.at.end, group: c.paren ? c.paren.open : -1 });
    }
    // Choices are read within one level of the sentence: skills in a parenthetical are never
    // alternatives to the skill the main clause states.
    const groups = new Map();
    for (const h of sentenceHits) groups.set(h.group, [...(groups.get(h.group) || []), h]);
    for (const [key, hits] of groups) {
      const choice = choiceAmong(sentence, hits);
      // a parenthetical list names examples of the skill right before it: "an ERP system (SAP,
      // Oracle, or NetSuite)", "message queues (Kafka, RabbitMQ, or SQS)"
      if (key >= 0 && choice.size && !choice.head) {
        const head = sentenceHits.filter((h) => h.group !== key && h.end <= key && key - h.end <= 30 && !choice.has(h.skill)).pop();
        if (head) choice.head = head.skill;
      }
      if (choice.head) examplesOf.set(choice.head, [...new Set([...(examplesOf.get(choice.head) || []), ...choice])]);
      for (const h of hits) {
        if (choice.has(h.skill)) { if (!altGroupOf.has(h.skill)) altGroupOf.set(h.skill, `anyof:${[...choice].sort().join('|')}`); }
        // a duty mention ("set up campaigns in the CRM") does not turn a stated choice into a requirement
        else { if (row.importance !== 'responsibility') plainStated.add(h.skill); if (HEDGE_AFTER_RE.test(maskedSentence.slice(h.end)) || (hits.length === 1 && HEDGE_BEFORE_RE.test(maskedSentence.slice(Math.max(0, h.start - 30), h.start)))) hedged.add(h.skill); }
      }
    }
  }
  // A tech posting's title names its stack: "Senior Backend Engineer (Golang)" requires Go even when
  // the body only says "working primarily in Go" in a sentence no section reader keeps.
  if (isTech) {
    const tTokens = tokenize(title);
    for (const { phrase, stems } of PHRASES) {
      if (!findStemmed(tTokens, stems).length) continue;
      const normalized = normalizeSkill(phrase, taxonomy);
      if (!normalized || !(TECH_CANON.has(normalized) || FAMILY_GATES[normalized])) continue;
      if (AMBIGUOUS_TOKENS[normalized] && !AMBIGUOUS_TOKENS[normalized].test(title) && !/\(\s*Go\s*\)|^Go\s/.test(title)) continue;
      const prev = found.get(normalized);
      if (prev) { if (rank[prev.importance] < rank.required) prev.importance = 'required'; prev.phrases.add(phrase); }
      else found.set(normalized, { importance: 'required', phrases: new Set([phrase]), evidence: `Job title: ${title}`.slice(0, 240), section: 'title', mentions: 1 });
      plainStated.add(normalized);
    }
  }
  for (const h of plainStated) altGroupOf.delete(h);
  // members still offered as a choice, per group; a group left with one member is an optional
  // alternative to a skill the posting also states outright
  const groupMembers = new Map();
  for (const [h, key] of altGroupOf) groupMembers.set(key, [...(groupMembers.get(key) || []), h]);

  const facts = [];
  const anyRequired = [...found.values()].some((v) => v.importance === 'required');
  for (const [normalized, { importance, phrases, evidence, section, mentions }] of found) {
    let imp = importance;
    if (imp === 'responsibility') imp = 'required'; // a core duty IS a requirement of the job
    if (!anyRequired && imp === 'nice_to_have') imp = 'required';
    const groupKey = altGroupOf.get(normalized) || null;
    const members = groupKey ? groupMembers.get(groupKey) : null;
    const anyOf = members && members.length >= 2 ? groupKey : null;
    if (groupKey && !anyOf && imp === 'required') imp = 'preferred';
    const soft = SOFT_SKILLS.has(normalized);
    // Weight: a stated requirement 1, a duty 0.5 (taught on the job, not screened), preferred 0.6; a soft skill
    // counts a third (no recruiter screens on "communication" alone); a skill the posting states
    // more than once counts a little more (prominence, capped).
    let weight = imp === 'required' ? (importance === 'responsibility' ? 0.5 : 1) : imp === 'preferred' ? 0.6 : 0.4;
    if (hedged.has(normalized) && imp === 'required') weight *= 0.8; // "AWS or other providers"
    if (soft) weight *= 0.35;
    if (mentions > 1) weight = Math.min(weight * 1.15, 1.15);
    facts.push({
      factType: 'skill',
      // display the canonical skill ("cash handling"), keep every posting phrase for the ATS
      // literal check and the wording notes ("cash drawer", "cash handling")
      label: normalized, normalizedLabel: normalized, postingPhrases: [...phrases],
      importance: imp, weight: Number(weight.toFixed(3)),
      // a HARD requirement: stated in a requirements sentence, not a duty, not a soft skill
      hard: imp === 'required' && importance !== 'responsibility' && !soft && !hedged.has(normalized),
      // "AWS or other providers": any comparable skill meets it
      orSimilar: hedged.has(normalized) || null,
      // "event-driven architectures like Kafka and CDC": the examples the posting gives for this skill
      examples: examplesOf.has(normalized) ? examplesOf.get(normalized).filter((x) => x !== normalized) : null,
      exampleOf: [...examplesOf.entries()].find(([, xs]) => xs.includes(normalized))?.[0] || null,
      // one of a set of alternatives: met when ANY member is met (scoreFit / scoreAts)
      anyOf, anyOfLabels: anyOf ? members.slice() : null,
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

/** Seniority from a job TITLE alone ('entry' | 'mid' | 'senior' | 'lead' | 'director' | 'executive' | null). */
export function seniorityFromTitle(title) {
  const t = String(title || '');
  for (const { re, not, level } of SENIORITY_TITLE) if (re.test(t) && !(not && not.test(t))) return level;
  if (/\b(associate|cashier|clerk|crew|team member|attendant|representative|barista|server|stocker|picker|packer)\b/i.test(t)) return 'entry';
  return null;
}

export function jobSeniorityRank(facts) {
  const levelRank = { entry: 1, mid: 2, senior: 3, lead: 4, director: 5, executive: 6 };
  for (const f of facts) if (f.factType === 'seniority') return levelRank[f.label] || 0;
  return 0;
}

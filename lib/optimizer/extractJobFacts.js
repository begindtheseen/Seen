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
import { escapeRegExp } from '../text/escapeRegExp.js';
import { normalizeSkill, BUILTIN_TAXONOMY, mergeTaxonomy } from './normalizeSkills.js';
import { detectRoleFamily } from '../application-intelligence/roleOntology.js';
import { requirementSentences, sectionPosting, extractConstraints, levelText, REQUIREMENT_CUE_RE, PREFERRED_CUE_RE, inferJobTitle, STAFF_TECH_RE } from './postingSections.js';
import { SOFT_SKILLS, AMBIGUOUS_TOKENS, LEADERSHIP_NOT_A_REQUIREMENT, TITLE_WORDS, vocabularySkills } from './hourlyVocabulary.js';
import { tokenize, findStemmed, stemPhrase, dehyphenate } from './lemma.js';
import { professionalFamilyGates } from './professionalVocabulary.js';
import { extractPostingTerms, extractDutyTerms, POSTING_TERMS_VERSION } from './postingTerms.js';
import { cleanPastedPosting } from './pastedText.js';
import { buildStatements } from './statements.js';

export const JOB_FACTS_VERSION = 'jobfacts_v4'; // v4: the posting's own requirement terms (postingTerms.js) — 2026-11-08

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
const PLAIN_LANGUAGES = new Set(['python', 'java', 'c++', 'c#', 'sql', 'javascript', 'typescript', 'postgresql', 'mysql']);
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
  // a topic or a data set, not the skill: "questions about billing, scheduling and account access",
  // "healthcare claims or scheduling data"
  scheduling: /\b(?:flexible|flexibility\s+in|predictable|consistent|self-)\s*scheduling\b|\bscheduling\s+(?:flexibility|options)\b|\bscheduling\s+(?:data|software|systems?|tools?|apps?|platform)\b|\bbilling,?\s+(?:and\s+)?scheduling\b|\bscheduling,?\s+(?:and\s+)?billing\b/i,
  compliance: /\b(?:with|and)\s+(?:product|legal|risk|finance)\s+(?:and|&)\s+compliance\b|\bcompliance\s+(?:team|teams|partners)\b/i,
};
// A vocabulary alias read in another sense (2026-11-10 judge, optimize #7). Keyed by the posting phrase the alias
// matched; true = this sentence does NOT ask for the skill.
const NOT_A_SKILL_PHRASE = {
  // "Register patients efficiently" is the verb — the till is "the/a/cash register"
  register: (s) => !/\b(?:cash|the|a|at\s+the|on\s+the|run(?:ning)?\s+(?:the|a)|operat\w*\s+(?:the|a))\s+register\b/i.test(s),
  registers: (s) => !/\b(?:cash|the|a|at\s+the|on\s+the|run(?:ning)?\s+(?:the|a)|operat\w*\s+(?:the|a))\s+registers?\b|\bregisters\s+(?:and|or|&)\b/i.test(s),
  // "our customer-facing portal" is a product, not customer service
  'customer-facing': (s) => /\bcustomer-facing\s+(?:portal|app|application|product|features?|ui|platform|tools?|dashboard|software|website|site)\b/i.test(s),
  // "prepaid expenses", "labor expenses" are ledger lines, not expense reports
  expenses: (s) => !/\bexpense\s+report|\bexpenses?\s+(?:reports?|reporting|reimbursement)|\bt\s?&\s?e\b/i.test(s),
  // newsletters among program handouts are print materials, not email marketing
  newsletters: (s) => !/\b(?:email|e-mail|mailchimp|klaviyo|subscribers?|open\s+rates?|campaigns?)\b/i.test(s),
  'policies and procedures': () => true, 'company policies and procedures': () => true,
};
// The same, keyed by the canonical skill.
const NOT_A_SKILL_CANON = {
  // "shipping safely with AI-assisted tooling" (software sense of ship); a warehouse ships orders
  shipping: (s, fam) => /\bship(?:ping|s|ped)?\s+(?:safely|fast|quickly|code|features?|products?|software|to\s+production|it\b|changes|updates|releases?|value|work|ideas)\b/i.test(s) || ['software_engineering', 'data_analytics', 'marketing', 'finance_accounting', 'clinical'].includes(fam),
  // a retail word: "client relationship skills" for a consulting engineer is not clienteling
  clienteling: (s, fam) => !['retail', 'customer_service', 'sales', 'hospitality', 'general'].includes(fam),
  'returns and refunds': (s, fam) => ['software_engineering', 'data_analytics', 'finance_accounting', 'marketing'].includes(fam),
  replenishment: (s, fam) => ['software_engineering', 'data_analytics', 'finance_accounting', 'marketing', 'clinical'].includes(fam),
  'point of sale': (s, fam) => ['clinical', 'software_engineering', 'finance_accounting'].includes(fam) && !/\b(?:pos|point[- ]of[- ]sale|cash\s+register)\b/i.test(s),
  // "patients receiving ABA treatment" is not the receiving dock
  receiving: (s) => /\breceiving\s+(?:treatment|care|services|therapy|patients?|calls|training|feedback|benefits|an?\s)/i.test(s),
  // "scheduling logistics", "event logistics" are arrangements, not the logistics function
  logistics: (s) => /\b(?:scheduling|event|meeting|travel|program|workshop|office|conference)\s+logistics\b/i.test(s),
  // "travel for training shifts", "paid training" — training is given, not asked for
  training: (s) => /\btraining\s+(?:shifts?|will\s+be|is\s+provided|period|provided|program\s+(?:is\s+)?provided)\b|\b(?:for|paid|ongoing|on-the-job)\s+training\b/i.test(s) && !/\b(?:train(?:ing)?\s+(?:new|staff|employees|associates|others)|experience\s+(?:in|with)\s+training)\b/i.test(s),
  // a code of conduct is not compliance work
  compliance: (s) => /\b(?:code\s+of\s+(?:ethics|conduct)|compliance\s+program|corporate\s+compliance)\b/i.test(s),
};
// One skill introduced as an example: "a language like Python", "a BI tool such as Tableau".
const HEDGE_BEFORE_RE = /\b(?:such\s+as|like|e\.g\.?|for\s+example|for\s+instance)\s+(?:[A-Za-z0-9+#./-]+\s+){0,1}$/i;
const HEDGE_AFTER_RE = /^\s*\)?\s*,?\s*(?:or\s+(?:an?\s+)?(?:other|another|similar|equivalent|comparable)\b|etc\b|and\/or\s+(?:other|similar))/i;
const SENIORITY_TITLE = [
  { re: /\b(chief|vp|vice president|c-level)\b/i, level: 'executive', rank: 6 },
  { re: /\b(director|head of)\b/i, level: 'director', rank: 5 },
  { re: /\b(manager|supervisor|principal)\b/i, not: /\b(assistant\s+manager)\b/i, level: 'lead', rank: 4 },
  // "Staff" is a level only in tech titles; a Staff Accountant / Staff Nurse is entry-level (postingSections.STAFF_TECH_RE)
  { re: STAFF_TECH_RE, level: 'lead', rank: 4 },
  { re: /\b(?:team|shift)\s+lead\b|\blead\s+(?:cashier|associate|barista|teller|server|technician)\b/i, level: 'mid', rank: 2 },
  { re: /\blead\b/i, level: 'lead', rank: 4 },
  { re: /\b(senior|sr\.?)\b/i, level: 'senior', rank: 3 },
  { re: /\b(junior|jr\.?|entry[- ]?level|intern|trainee|graduate|seasonal|part[- ]time)\b/i, level: 'entry', rank: 1 },
];
const HOURLY_FAMILIES = new Set(['retail', 'customer_service', 'food_service', 'hospitality', 'valet_parking', 'warehouse', 'delivery_logistics', 'security']);

// A duty object worth reading from a posting that already states its requirements: a named procedure, piece of
// equipment or work product (its last word), not a manner or a request ("efficient manner", "internal requests").
const DUTY_HEAD_RE = /\b(?:therapy|therapies|irrigation|tubes?|drains?|catheters?|dressings?|assessments?|reconciliations?|ventilators?|telemetry|triage|phlebotomy|injections?|infusions?|wounds?|ostomy|dopplers?|panels?|circuits?|schematics?|harness(?:es)?|conduit|switchgear|transformers?|breakers?|wiring|blueprints?|forklifts?|pallets?|scanners?|jacks?|journal\s+entries|statements?|ledgers?|payroll|invoices?|audits?|recognition|analysis|upgrades?|replacements?|installations?|repairs?|inspections?|maintenance|calibration|testing|troubleshooting|diagnostics?|welding|soldering|fabrication|plans?\s+of\s+care|care\s+plans?|charting|documentation|immunizations?|vitals?|specimens?|claims|reports?)$/i;
// The posting's own title, masked out of a sentence before matching: "As a Customer Service
// Representative you will…" is the job naming itself, not a requirement.
function maskTitle(sentence, title) {
  const t = String(title || '').split(/\s+[-–—|(]\s*|\s*\(/)[0].trim();
  if (t.length < 4) return sentence;
  const re = new RegExp(escapeRegExp(t).replace(/\s+/g, '\\s+') + 's?', 'gi');
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
  // "What your workday looks like" is a day at work, not the Workday HR system (round 3: "Missing required
  // skill: workday" to a warehouse lead)
  const text = dehyphenate(cleanPastedPosting(String(jobDescription || ''))).replace(/\b(your|a|the|typical|each|every|normal|average)\s+workday\b/gi, '$1 work day').replace(/\bworkday\s+(looks|will|includes|starts|ends|is|might)\b/gi, 'work day $1');
  const title = String(opts.jobTitle || '');
  // No title given → the posting's own ("As a Data Engineer…", "software engineering skills") decides the
  // family, so the vocabulary is the same with the title box empty (Dev, round 3: 6 requirements → 1).
  const roleFam = detectRoleFamily(title || inferJobTitle(text), text);
  const isTech = TECH_FAMILIES.has(roleFam.family);

  // Sentences a requirement may be read from. A posting with no recognisable requirement text
  // (an Adzuna teaser) yields nothing — better an honest empty than a grep over a pay disclaimer.
  let rows = readingRows(text, title);
  if (false) rows = sectionPosting(text).filter((r) => (r.kind === 'about' || r.kind === 'other') && REQUIREMENT_CUE_RE.test(r.sentence)).map((r) => ({ sentence: r.sentence, kind: 'requirements', importance: 'required', explicit: false }));

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
      if (NOT_A_SKILL_PHRASE[phrase] && NOT_A_SKILL_PHRASE[phrase](sentence)) continue;
      if (NOT_A_SKILL_CANON[normalized] && NOT_A_SKILL_CANON[normalized](sentence, roleFam.family)) continue;
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
    // the sentence's level is read here, not from the row: a Preferred SECTION, else a cue outside the
    // skill-bearing parentheticals and outside a trailing ", ideally …" clause
    const outside = levelText(stripParens(sentence, skillParens));
    const pref = row.kind === 'preferred' || (PREFERRED_CUE.test(outside) && !/\b(?:required|must)\b/i.test(outside));
    const importance = pref ? 'preferred' : row.kind === 'responsibilities' ? 'responsibility' : 'required';
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
        if (choice.has(h.skill)) { if (!altGroupOf.has(h.skill)) altGroupOf.set(h.skill, `one of ${[...choice].sort().join(', ')}`); }
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
      // a language/tool named in the title ("(Golang)", "Python Developer") — never a team name
      // ("Backend Engineer, Payments Platform" does not require payments experience)
      if (!normalized || !TECH_CANON.has(normalized)) continue;
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

  // The posting's own requirement terms — everything the vocabulary above does not know ("head-to-toe
  // assessment", "MBSE", "STCW", "wound care"). A posting outside the vocabulary's worlds used to read as
  // "no requirements" and was refused (2026-11-08 corpus: 19% of full postings). They count toward the fit
  // like any requirement, a little lighter (read from wording, not a known skill), and never as a HARD
  // "missing required skill" — the risk flag stays for requirements Seen recognises with confidence.
  const taken = facts.flatMap((f) => [f.label, ...(f.postingPhrases || [])]).map((p) => tokenize(p).map((t) => t.stem)).filter((x) => x.length);
    const termTitle = title;
  let terms = extractPostingTerms(rows.filter((r) => !EQUIVALENCE_RE.test(r.sentence)), { title: termTitle, company: opts.company || '', taken, postingText: text });
  // a posting that states almost no requirements: what it asks the person to DO is what the résumé should show
  // Only hard requirements count toward "states almost nothing": three soft skills and a licence are not a read posting.
  const stated = facts.filter((f) => !f.soft).length + terms.length + extractConstraints(text, { jobTitle: title }).filter((c) => ['degree', 'years', 'management', 'seniority', 'certification', 'language'].includes(c.kind)).length;
  const termTaken = [...taken, ...terms.map((t) => t.stems)];
  if (stated < 5) terms = [...terms, ...extractDutyTerms(rows, { title: termTitle, company: opts.company || '', taken: termTaken, postingText: text })];
  else {
    // A posting that states its requirements still names procedures and equipment in its duties ("continuous bladder
    // irrigation", "IV therapy", "triage"): those are read too, as duties — light, capped, never crowding out what it
    // states (judge optimize #11). Only duty lines (a Responsibilities block), only specific objects.
    const duties = extractDutyTerms(rows.filter((r) => r.kind === 'responsibilities'), { title: termTitle, company: opts.company || '', taken: termTaken, postingText: text })
      .filter((t) => t.acronym || (t.stems.length >= 2 && t.label.split(/\s+/).length <= 4 && !/\b(?:in|into|before|after|with|across|for|of|on|at|from)\b/i.test(t.label) && DUTY_HEAD_RE.test(t.label)));
    terms = [...terms, ...duties.slice(0, 5)];
  }
  // A term's identity is its own words, readable as written (lower-cased, spaces normalised): every screen
  // that prints a requirement's key prints words, never an engine key ("term:futur leader" reached paying
  // users, 2026-11-09). Term-ness rides on `term` and `extractor` only. One key per posting: a term whose
  // words are already a requirement here (a recognised skill or an earlier term) is that requirement.
  const usedKeys = new Set(facts.map((f) => f.normalizedLabel));
  const keyOf = new Map(terms.map((t) => [t, postingTermKey(t.label)]));
  terms = terms.filter((t) => { const k = keyOf.get(t); if (!k || usedKeys.has(k)) return false; usedKeys.add(k); return true; });
  const termKey = (t) => keyOf.get(t) || postingTermKey(t.label);
  for (const t of terms) {
    const imp = t.importance === 'preferred' ? 'preferred' : 'required';
    const weight = t.importance === 'required' ? 0.8 : t.importance === 'preferred' ? 0.5 : 0.4;
    facts.push({
      factType: 'skill', label: t.label, normalizedLabel: termKey(t), postingPhrases: t.phrases,
      importance: imp, weight, hard: false, orSimilar: null,
      // "acute and post-acute care (e.g., CHF, COPD, wound care)": any example met meets the requirement
      examples: t.examples ? t.examples.map(termKey) : null, exampleOf: t.exampleOf ? termKey(t.exampleOf) : null,
      anyOf: t.anyOf, anyOfLabels: null, soft: false, confidence: 0.6, evidence: t.evidence,
      section: t.importance === 'responsibility' ? 'responsibilities' : t.importance === 'preferred' ? 'preferred' : 'requirements',
      extractor: POSTING_TERMS_VERSION, term: { stems: t.stems, acronym: t.acronym, phrases: t.phrases },
    });
  }

  // Structured constraints (years, degree, certification, schedule, physical, language, …).
  for (const c of extractConstraints(text, { jobTitle: title })) {
    facts.push({
      factType: 'constraint', kind: c.kind, label: c.label, normalizedLabel: `constraint:${c.kind}:${String(c.value).toLowerCase().slice(0, 60)}`,
      importance: c.importance, weight: 1, confidence: 0.8, gate: !!c.gate, value: c.value, items: c.items || null,
      alternatives: c.alternatives || null, gpa: c.gpa || null, management: !!c.management, state: c.state || null, compact: c.compact || null, evidence: c.sentence.slice(0, 240), extractor: JOB_FACTS_VERSION,
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
  // a choice of posting terms ("e.g., DOORS or Jama") is met by any one of them (scoreFit.collapseAlternatives)
  const termGroups = new Map();
  for (const f of facts) if (f.extractor === POSTING_TERMS_VERSION && f.anyOf) termGroups.set(f.anyOf, [...(termGroups.get(f.anyOf) || []), f]);
  for (const members of termGroups.values()) {
    if (members.length < 2) { members[0].anyOf = null; continue; }
    // the group's identity is its members' own words ("one of doors, jama"), never a counter key ("terms:0")
    const groupId = `one of ${members.map((x) => x.normalizedLabel).join(', ')}`;
    for (const m of members) { m.anyOf = groupId; m.anyOfLabels = members.map((x) => x.normalizedLabel); }
  }
  if (seniority) facts.push({ factType: 'seniority', label: seniority, normalizedLabel: `seniority:${seniority}`, importance: 'required', weight: 1, confidence: 0.7, extractor: JOB_FACTS_VERSION });

  // A non-software posting keeps a programming language it plainly names in a requirement ("C++ or Python"
  // for a quantitative researcher, "SQL" for an analyst); only the words that collide with English or name a
  // vendor nobody asked for are dropped ("go", "rest", "express", "aws"…).
  const kept = isTech ? facts : facts.filter((f) => !(f.factType === 'skill' && !f.term && TECH_CANON.has(f.normalizedLabel) && !(PLAIN_LANGUAGES.has(f.normalizedLabel) && f.section !== 'responsibilities')));
  // the requirement lines a person reads (statements.js); every fact read from a line carries its statementId
  // promises are read from every line, benefits included ("No nights or weekends!" under Perks)
  const statements = buildStatements(rows, kept, { promiseRows: sectionPosting(text).filter((r) => !REQUIREMENT_KINDS_SET.has(r.kind)) });
  // terms read from a line about the company or the reader (statements.js PITCH_START_RE) are not requirements
  const out = kept.filter((f) => !f._pitch);
  out.statements = statements;
  return out;
}

/** The rows a posting's requirements are read from (the same text cleaning extractJobFacts uses). */
const REQUIREMENT_KINDS_SET = new Set(['requirements', 'responsibilities', 'preferred', 'physical', 'schedule']);
export function postingReadingRows(jobDescription, jobTitle = '') {
  const text = dehyphenate(cleanPastedPosting(String(jobDescription || ''))).replace(/\b(your|a|the|typical|each|every|normal|average)\s+workday\b/gi, '$1 work day').replace(/\bworkday\s+(looks|will|includes|starts|ends|is|might)\b/gi, 'work day $1');
  return readingRows(text, jobTitle);
}
function readingRows(text, jobTitle = '') {
  const rows = requirementSentences(text, { jobTitle });
  if (rows.length) return rows;
  return sectionPosting(text).filter((r) => (r.kind === 'about' || r.kind === 'other') && REQUIREMENT_CUE_RE.test(r.sentence)).map((r) => ({ sentence: r.sentence, kind: 'requirements', importance: 'required', explicit: false }));
}

/**
 * The identity (normalizedLabel) of a requirement in the posting's own words: its display label,
 * lower-cased with whitespace normalised ("Head-to-toe assessment" → "head-to-toe assessment", "CHF" → "chf").
 * Human words by construction, so any screen that prints it prints the posting's words.
 */
export function postingTermKey(label) {
  return String(label || '').replace(/\s+/g, ' ').trim().toLowerCase();
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

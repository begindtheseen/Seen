// Posting terms — the requirements a posting states in its own words, beyond the fixed vocabulary.
//
// Why (2026-11-08, scripts/optimizer-corpus.mjs over 299 live full postings): the job-facts reader only
// recognised skills from a fixed word list (tech, office, retail and hourly words), so a posting outside
// those worlds read as "no requirements" and the paid optimizer refused it: a home-health RN posting with
// "head-to-toe assessment", "wound care", "IV therapy" read 2 requirements; a systems engineer posting with
// "MBSE", "Cameo", "DOORS or Jama", "FMEA" read 1; a ship's engineer posting with "STCW" read 0. 19% of
// full postings were refused this way, and the median posting read 5 requirements.
//
// What it does, deterministically (no model):
//   • reads only requirement / preferred / responsibility rows (postingSections.requirementSentences),
//     never benefits, pay or EEO lines the section reader let through;
//   • takes the OBJECT of a requirement cue — "experience with X", "knowledge of X", "proficiency in X",
//     "familiarity with X", "X skills", "X experience", "certified in X" — and splits lists ("X, Y and Z");
//   • takes named examples ("(e.g., CHF, COPD, wound care)", "such as DOORS or Jama") as alternatives;
//   • takes acronyms a row states ("MBSE", "STCW"), with the long form when the posting spells it out
//     ("Model-Based Systems Engineering (MBSE)");
//   • drops anything generic (an "ability", "the team", soft words) or already read by the vocabulary.
// Each term is matched against the résumé by word stems on one line (matchTerm) — never by a guess — so
// a term the résumé does not show is reported as not shown, in the posting's own words.

import { tokenize, stemWord } from './lemma.js';

export const POSTING_TERMS_VERSION = 'posting_terms_v1';

// Rows the section reader sometimes files under requirements that are benefits, pay or legal text.
const NOT_A_REQUIREMENT_RE = /\b(?:accommodations?|sponsorship|paid\s+(?:parental|time|holidays?|leave|sick)|parental\s+leave|adoptive\s+leave|pto\b|401\s?\(?k\)?|hsa\b|fsa\b|dental|vision\s+(?:insurance|plan|coverage)|medical\s+(?:insurance|plan|coverage)|health\s+(?:insurance|benefits)|life\s+insurance|disability\s+(?:insurance|coverage)|short\s+and\s+long\s+term\s+disability|ad&d|tuition|reimbursement|stipend|bonus|equity|stock\s+options?|rsus?\b|salary|compensation|pay\s+range|base\s+pay|per\s+hour|\$\s?\d|benefits?\s+(?:package|include)|perks|wellness|gym\s+membership|commuter|relocation\s+assistance|equal\s+opportunity|eeo\b|e-verify|reasonable\s+accommodation|classification\s*:|exempt\b|background\s+check|drug\s+(?:test|screen)|at-will)\b/i;

const DEGREE_ROW_RE = /\b(?:bachelor'?s?|master'?s?|associate'?s?\s+degree|degree\s+in|ph\.?d|b\.s\.|b\.a\.|m\.s\.|mba|diploma|ged|gpa)\b/i;
const LICENSE_ROW_RE = /\b(?:licen[sc]e[ds]?|licensure|certifications?|certificates?|certified\s+(?:as|by)|registration\s+as)\b/i;
const SCHEDULE_ROW_RE = /\b(?:able\s+to\s+work|available\s+to\s+work|availability|flexible\s+(?:hours|schedule)|blackout|work\s+(?:nights|weekends|holidays|evenings)|including\s+(?:early|nights|weekends|evenings|holidays))\b/i;
// An example list is a requirement only after a word that asks for one ("experience in industries such as…",
// "tools (e.g., CRMs…)"); "partner with teams such as Product, Engineering" names colleagues.
const EXAMPLE_CUE_RE = /\b(?:experience|experienced|knowledge|proficien\w*|familiar\w*|skills?|tools?|software|systems?|platforms?|applications?|certif\w*|licen[sc]\w*|background|industr\w*|languages?|technolog\w*|expertise|understanding|equipment|machinery|instruments?|methods?|techniques?|frameworks?|care|conditions?|modalities|procedures)\b/i;

// The cue words whose object is the requirement.
const CUE_OBJECT_RE = /\b(?:hands-on\s+experience|working\s+knowledge|in-depth\s+knowledge|deep\s+knowledge|solid\s+understanding|strong\s+understanding|experience|expertise|proficiency|proficient|skilled|knowledge|familiarity|familiar|understanding|background|competency|competence|fluency|fluent|exposure|track\s+record|certified|certification|licensed|trained|versed|comfort|comfortable)\s+(?:working\s+)?(?:with|in|of|on|using|across|around)\s+/gi;
// "experience wiring harnesses", "experience designing or fabricating enclosures": a gerund carries the object
const CUE_GERUND_RE = /\b(?:experience|expertise|background)\s+((?:[a-z]+ing)(?:\s*(?:,|or|and|and\/or)\s*[a-z]+ing)*)\s+/gi;
// "<object> skills / experience / knowledge / expertise / background / certification".
const OBJECT_CUE_RE = /([A-Za-z0-9][\w+#./&'’-]*(?:\s+[A-Za-z0-9][\w+#./&'’-]*){0,4})\s+(?:skills?|experience|knowledge|expertise|background|certification|license|licensure)\b/g;
// Examples the posting names: "(e.g., A, B, C)", "such as A or B", "including A and B", "like A, B".
const EXAMPLES_RE = /\b(?:e\.g\.?,?|i\.e\.?,?|such\s+as|including|like|for\s+example|for\s+instance)\s+/gi;

// Where an object phrase ends.
const OBJECT_END_RE = /\s*(?:[.;:!?()\[\]]|\s+of\s+(?:all|any|every)\b|,\s*(?:and\s+|or\s+)?(?:the\s+)?ability|,\s*(?:with|including|such|which|who|that|while|where|as\s+well)|\s+(?:to|for|that|which|who|while|where|when|within|across|through|from|at|by|as|is|are|was|be|being|preferred|required|a\s+plus|is\s+a\s+plus|desired|strongly|ideally|highly|helpful|nice)\b|\s+-\s+|\s+–\s+|\s+—\s+)/i;

// Words that never make a term on their own (generic, soft, filler).
const GENERIC = new Set([
  'ability', 'abilities', 'skill', 'skills', 'experience', 'experiences', 'knowledge', 'expertise', 'background', 'understanding',
  'work', 'working', 'job', 'role', 'position', 'team', 'teams', 'company', 'organization', 'organizational', 'business', 'environment',
  'environments', 'people', 'person', 'individual', 'others', 'thing', 'things', 'area', 'areas', 'field', 'fields', 'industry',
  'industries', 'setting', 'settings', 'level', 'levels', 'type', 'types', 'kind', 'variety', 'range', 'number', 'years', 'year',
  'months', 'month', 'time', 'times', 'day', 'days', 'way', 'ways', 'part', 'parts', 'set', 'sets', 'tool', 'tools', 'system',
  'systems', 'process', 'processes', 'practice', 'practices', 'concept', 'concepts', 'principle', 'principles', 'method', 'methods',
  'technique', 'techniques', 'technology', 'technologies', 'solution', 'solutions', 'project', 'projects', 'task', 'tasks', 'need',
  'needs', 'detail', 'details', 'communication', 'communications', 'written', 'verbal', 'oral', 'interpersonal', 'organization',
  'relationship', 'relationships', 'collaboration', 'teamwork', 'leadership', 'motivation', 'attitude', 'mindset', 'passion',
  'commitment', 'diversity', 'inclusion', 'trust', 'integrity', 'flexibility', 'adaptability', 'creativity', 'initiative', 'ownership',
  'self', 'starter', 'fast', 'paced', 'pace', 'dynamic', 'new', 'idea', 'ideas', 'problem', 'problems', 'solving', 'learning',
  'growth', 'success', 'results', 'impact', 'quality', 'standards', 'standard', 'requirements', 'requirement', 'responsibilities',
  'duties', 'etc', 'related', 'relevant', 'similar', 'equivalent', 'other', 'various', 'multiple', 'different', 'general', 'overall',
  'professional', 'professionals', 'customer', 'customers', 'client', 'clients', 'user', 'users', 'product', 'products', 'service',
  'services', 'data', 'information', 'computer', 'computers', 'office', 'english', 'language', 'languages', 'degree', 'education',
  'school', 'diploma', 'ged', 'certificate', 'license', 'licensure', 'certification', 'role-related', 'one', 'two', 'three',
  'specification', 'specifications', 'documentation', 'execution', 'setup', 'operations', 'operation', 'support', 'management',
  'focus', 'ability', 'knows', 'know', 'combining', 'combine', 'everything', 'anything', 'something', 'world', 'lives', 'life',
  // schedule, place and language are read as constraints (postingSections.extractConstraints), never as skills
  'morning', 'mornings', 'evening', 'evenings', 'weekend', 'weekends', 'holiday', 'holidays', 'night', 'nights', 'overnight',
  'shift', 'shifts', 'overtime', 'schedule', 'schedules', 'availability', 'available', 'hours', 'fluency', 'fluent', 'bilingual',
  'spanish', 'french', 'german', 'mandarin', 'chinese', 'japanese', 'portuguese', 'full-time', 'part-time', 'seasonal', 'travel',
  'onsite', 'on-site', 'remote', 'hybrid', 'office-based', 'location', 'locations', 'citizenship', 'clearance', 'authorization',
  'information', 'initiative', 'initiatives', 'goal', 'goals', 'strategy', 'strategies', 'aspect', 'aspects', 'incentive', 'incentives',
  'facet', 'facets', 'priority', 'priorities', 'policy', 'policies', 'procedure', 'procedures', 'guideline', 'guidelines',
  'expectation', 'expectations', 'objective', 'objectives', 'metric', 'metrics', 'target', 'targets', 'willingness', 'desire',
  'curiosity', 'interest', 'eagerness', 'enthusiasm', 'role', 'roles', 'mission', 'vision', 'values', 'culture', 'opportunity',
  'opportunities', 'responsibility', 'department', 'departments', 'function', 'functions', 'stakeholder', 'stakeholders',
  'software', 'hardware', 'platform', 'platforms', 'application', 'applications', 'program', 'programs', 'equipment',
  'exposure', 'sector', 'sectors', 'stack', 'spend', 'acumen', 'value', 'love', 'note', 'database', 'databases', 'collection',
  'candidate', 'candidates', 'applicant', 'applicants', 'ideal', 'employee', 'employees', 'hire', 'hires', 'combines', 'comfort',
]);
// A lone lowercase word is a term only when it names a thing: these -ing words do; other -ing / -ed /
// adjective-shaped single words ("combining", "airborne", "mechanical") do not.
const ING_NOUNS = new Set(['troubleshooting', 'soldering', 'welding', 'machining', 'programming', 'scheduling', 'budgeting', 'forecasting',
  'nursing', 'coding', 'testing', 'accounting', 'bookkeeping', 'auditing', 'underwriting', 'merchandising', 'plumbing', 'wiring',
  'framing', 'drywall', 'painting', 'roofing', 'landscaping', 'cooking', 'baking', 'catering', 'bartending', 'tutoring', 'counseling',
  'phlebotomy', 'charting', 'triage', 'billing', 'coding', 'recruiting', 'sourcing', 'onboarding', 'prospecting', 'fundraising',
  'copywriting', 'editing', 'proofreading', 'modeling', 'modelling', 'rigging', 'surveying', 'drafting', 'estimating', 'scaffolding',
  'brazing', 'fabricating', 'lifeguarding', 'housekeeping', 'dispatching', 'routing', 'trucking', 'warehousing', 'picking', 'packing',
  'shipping', 'receiving', 'networking', 'debugging', 'scripting', 'benchmarking', 'refactoring', 'pentesting', 'finishing']);
function singleWordOk(w) {
  if (/[A-Z]/.test(w.slice(1)) || /[0-9+#&/]/.test(w)) return true; // acronym / tool shape (C++, iOS, J-STD-001)
  if (/^[A-Z]/.test(w)) return true; // a proper name (Cameo, Jama, Defense) — the caller drops sentence-initial ones
  const lw = w.toLowerCase();
  if (lw.length < 5 || GENERIC.has(lw) || EDGE.has(lw)) return false;
  if (/ing$/.test(lw)) return ING_NOUNS.has(lw);
  // a lone plural ("initiatives", "strategies") is a category, not a requirement
  if (/[^su]s$/.test(lw)) return false;
  return !/(?:ed|ly|al|ic|ive|ous|ent|ant|ary|ular|ible|able|ful|less|ish|ward|wise|borne|ize|ise|ate)$/.test(lw);
}
// Words stripped from the edges of a term.
const EDGE = new Set([
  'a', 'an', 'the', 'any', 'some', 'all', 'of', 'in', 'on', 'with', 'and', 'or', 'nor', 'to', 'for', 'at', 'by', 'as', 'your', 'our',
  'their', 'its', 'this', 'that', 'these', 'those', 'strong', 'excellent', 'proven', 'solid', 'demonstrated', 'demonstrable', 'good',
  'great', 'basic', 'advanced', 'intermediate', 'expert', 'expert-level', 'working', 'hands-on', 'relevant', 'prior', 'previous',
  'professional', 'extensive', 'deep', 'broad', 'significant', 'substantial', 'considerable', 'practical', 'direct', 'recent',
  'minimum', 'at', 'least', 'plus', 'years', 'year', 'yrs', 'months', 'experience', 'experienced', 'knowledge', 'skills', 'skill',
  'expertise', 'familiarity', 'understanding', 'proficiency', 'background', 'general', 'overall', 'technical', 'functional',
  'specific', 'particular', 'related', 'similar', 'equivalent', 'applicable', 'appropriate', 'necessary', 'required', 'preferred',
  'desired', 'ideal', 'ideally', 'highly', 'very', 'well', 'more', 'most', 'other', 'etc', 'including', 'such', 'like', 'use',
  'using', 'utilize', 'utilizing', 'apply', 'applying', 'ability', 'able', 'must', 'have', 'has', 'having', 'be', 'is', 'are', 'you',
  'we', 'who', 'will', 'would', 'should', 'can', 'may', 'also', 'both', 'either', 'one', 'two', 'three', 'four', 'five', 'six',
  'multiple', 'several', 'various', 'numerous', 'diverse', 'new', 'current', 'modern', 'complex', 'large', 'small', 'high',
  'low', 'top', 'key', 'core', 'main', 'primary', 'secondary', 'daily', 'day-to-day', 'end-to-end', 'full', 'entire', 'robust',
  'and/or', 'especially', 'particularly', 'though', 'although', 'please', 'wed', 'we\'d', 'our', 'previous', 'possesses', 'possess',
  'early', 'late', 'environment', 'environments', 'setting', 'settings', 'mindset', 'roles', 'role', 'field', 'fields', 'areas',
  'diverse', 'large-scale', 'small-scale', 'fast-paced', 'high-volume', 'cross-functional', 'additional', 'further', 'extra',
]);
// Acronyms that are never a requirement.
const ACRONYM_STOP = new Set([
  'US', 'USA', 'UK', 'EU', 'EEO', 'EOE', 'HSA', 'FSA', 'PTO', 'AD', 'OR', 'AND', 'NOT', 'ALL', 'ANY', 'NEW', 'THE', 'FAQ', 'HR', 'CEO',
  'CFO', 'CTO', 'COO', 'VP', 'SVP', 'EVP', 'LLC', 'INC', 'LTD', 'CORP', 'CO', 'TBD', 'TBA', 'ASAP', 'FYI', 'ETC', 'AM', 'PM', 'EST',
  'PST', 'CST', 'MST', 'UTC', 'GMT', 'ID', 'II', 'III', 'IV', 'VI', 'OK', 'NA', 'N/A', 'Q1', 'Q2', 'Q3', 'Q4', 'BS', 'BA', 'MS', 'MA',
  'MBA', 'PHD', 'BSC', 'MSC', 'GED', 'HS', 'ADA', 'FMLA', 'DEI', 'ESG', 'AI', 'IT', 'YOU', 'WE', 'OUR', 'YOUR', 'WHO', 'WHAT',
  'ABOUT', 'ROLE', 'JOB', 'TEAM', 'NOTE', 'NOTES', 'KEY', 'MUST', 'PLUS', 'BONUS', 'REMOTE', 'HYBRID', 'ONSITE', 'FT', 'PT', 'W2',
  'USD', 'K', 'M', 'B', 'GPA', 'SAT', 'ACT', 'FTE', 'ET', 'NYC', 'SF', 'LA', 'DC', 'USC', 'EO', 'AA', 'EEOC', 'OFCCP', 'RSU', 'RSUS', 'ESPP', 'COVID', 'ATS', 'SMS', 'URL', 'FAQ', 'DOE', 'LGBTQ', 'LGBTQIA', 'BIPOC', 'AAP',
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'IA', 'IL', 'IN', 'KS', 'KY', 'LA', 'MD', 'ME', 'MI', 'MN', 'MO',
  'MT', 'NC', 'ND', 'NE', 'NH', 'NJ', 'NM', 'NV', 'NY', 'OH', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VA', 'VT', 'WA', 'WI', 'WV', 'WY',
]);

const tokensOf = (s) => tokenize(s).map((t) => t.raw);
const contentStems = (s) => tokensOf(s).filter((w) => !EDGE.has(w) && !GENERIC.has(w) && w.length > 1).map(stemWord);

/** Clean a raw object phrase into a term label, or '' when nothing specific is left. */
export function cleanTerm(raw) {
  let s = String(raw || '').replace(/[“”"‘’]/g, '').replace(/\s+/g, ' ').trim();
  s = s.replace(/^[\s,•▪◦·‣\-–*]+|[\s,.:;\-–]+$/g, '');
  // "setup of research framework" → research framework; "teams in call center environments" → call center
  const ofIn = s.match(/^(\S+(?:\s+\S+)?)\s+(?:of|in|for|with)\s+(.+)$/i);
  if (ofIn && ofIn[1].split(/\s+/).every((w) => GENERIC.has(w.toLowerCase()) || EDGE.has(w.toLowerCase()))) s = ofIn[2];
  // a run-on into the next sentence ("details Leverages company tools") or an infinitive is not a term
  if (/\b[a-z][a-z-]*\s+[A-Z][a-z]+(?:s|es|ly)\b/.test(s) || /\sto\s/i.test(s)) return '';
  let words = s.split(' ');
  while (words.length && EDGE.has(words[0].toLowerCase().replace(/[^a-z-]/g, ''))) words.shift();
  while (words.length && EDGE.has(words[words.length - 1].toLowerCase().replace(/[^a-z-]/g, ''))) words.pop();
  // "years of" leftovers, a dangling number
  words = words.filter((w, i) => !(i === 0 && /^\d+\+?$/.test(w)));
  if (!words.length || words.length > 5) return '';
  const label = words.join(' ').replace(/\s*&\s*/g, ' & ');
  if (!/[A-Za-z]{2}|[A-Za-z][+#]/.test(label)) return '';
  // a negation, an adverb or a run-on into the next sentence is a sentence fragment, not a requirement:
  // "No previous wound care", "Consistently foster…", "account funnel work Production dbt" (a flat posting
  // whose bullets lost their full stops)
  if (/\b(?:no|not|never|without|none|nor|does|do|did|don't|doesn't)\b/i.test(label)) return '';
  if (words.some((w) => /^[a-z]{3,}ly$/i.test(w) && !/^(?:supply|apply|family|assembly|anomaly|monopoly|italy|july)$/i.test(w))) return '';
  for (let i = 1; i < words.length; i++) {
    if (/^[A-Z][a-z]{2,}$/.test(words[i]) && (/^[a-z]/.test(words[i - 1]) || /^[A-Za-z]$/.test(words[i - 1]))) return '';
  }
  if (/-{2,}|—/.test(label)) return '';
  if (words.length === 1 && !singleWordOk(words[0])) return '';
  // "developing leadership", "combining knowledge": a gerund at the head is a duty, not a term
  if (words.length > 1 && /ing$/i.test(words[0]) && !ING_NOUNS.has(words[0].toLowerCase())) return '';
  if (label.length < 2 || label.length > 60) return '';
  // something specific must be left: a content word, or an acronym / tool-shaped token
  const specific = words.some((w) => {
    const lw = w.toLowerCase().replace(/[^a-z0-9+#./-]/g, '');
    if (!lw) return false;
    if (/^[A-Z][A-Z0-9+#&/-]{1,9}$/.test(w) && !ACRONYM_STOP.has(w.toUpperCase())) return true;
    return !GENERIC.has(lw) && !EDGE.has(lw) && lw.length > 2;
  });
  if (!specific) return '';
  // a verb phrase is a duty sentence, not a term ("work independently", "manage a schedule")
  if (/^(?:work|manage|lead|support|help|ensure|provide|maintain|perform|develop|create|build|drive|own|handle|deliver|communicate|collaborate|partner|identify|prioritize|learn|adapt|thrive|enjoy|take|make|get|keep|stay|meet|exceed|follow|travel|lift|stand|sit|walk|obtain|earn|hold|pass|complete|focus|knows?|understand|apply|design|review|track|monitor|prepare|conduct|coordinate|assist|operate|install|repair|test|analyze|analyse|write|read|speak|use|utilize|seek|serve|sell|teach|train|mentor|guide|grow|scale|run|set|define|foster|influence|optimize|optimise|share|continue|possesses|possess|value|love|enjoys?|wants?|needs?|brings?|join|joins|ensures?|shows?|demonstrates?|thrives?|lives|takes|makes|gets)\b/i.test(label)) return '';
  return label;
}

/** Split a list object ("wound care, IV therapy and post-surgical care") into items. */
function splitList(phrase) {
  const items = String(phrase || '')
    .split(/\s*(?:,|;|\/(?=\s)|\s+and\/or\s+|\s+and\s+|\s+or\s+|\s+&\s+(?=[A-Z]))\s*/)
    .map((x) => x.trim())
    .filter(Boolean);
  // a modifier listed before a phrase shares its head noun: "acute and post-acute care", "written and verbal"
  const last = items[items.length - 1] || '';
  const lw = last.split(/\s+/);
  if (items.length > 1 && lw.length >= 2) {
    const headNoun = lw[lw.length - 1];
    for (let i = 0; i < items.length - 1; i++) {
      const w = items[i];
      if (!/\s/.test(w) && /^[a-z][a-z-]+$/.test(w) && (/(?:al|ic|ute|ive|ary|ar|post-\w+|pre-\w+|non-\w+)$/.test(w) || /^(?:post|pre|non|inter|intra|sub)-/.test(w))) items[i] = `${w} ${headNoun}`;
    }
  }
  return items;
}

/** The object phrase that starts at `from` in `sentence`. */
function objectAt(sentence, from) {
  const rest = sentence.slice(from);
  const end = rest.search(OBJECT_END_RE);
  return (end < 0 ? rest : rest.slice(0, end)).slice(0, 140);
}

/** Acronyms in a sentence, with their long form when spelled out as "Long Form (ACR)". */
function acronymsIn(sentence) {
  const out = [];
  const longForm = new Map();
  const lfRe = /((?:[A-Z][\w&'’-]*\s+(?:&\s+|of\s+|and\s+|for\s+)?){1,6})\(\s*([A-Z][A-Za-z0-9&/+-]{1,9})s?\s*\)/g;
  let m;
  while ((m = lfRe.exec(sentence)) !== null) {
    const acr = m[2];
    const words = m[1].trim().split(/\s+/);
    // keep only as many trailing words as the acronym has letters (+ small joiners)
    const initials = acr.replace(/[^A-Z]/g, '');
    // walk back over the words, matching the acronym's letters from its end (hyphenated words give one per part)
    const picked = [];
    let k = initials.length - 1;
    for (let i = words.length - 1; i >= 0 && k >= 0; i--) {
      const w = words[i];
      if (/^(?:&|of|and|for)$/i.test(w)) { picked.unshift(w); continue; }
      const parts = w.split('-').filter(Boolean).reverse();
      let ok = true;
      for (const part of parts) { if (k >= 0 && part[0] && part[0].toUpperCase() === initials[k]) k--; else { ok = false; break; } }
      if (!ok) break;
      picked.unshift(w);
    }
    while (picked.length && /^(?:&|of|and|for)$/i.test(picked[0])) picked.shift();
    if (k < 0 && picked.length) longForm.set(acr, picked.join(' '));
  }
  const re = /\b([A-Z][A-Z0-9]{1,7}(?:[/&+-][A-Z0-9]{1,6})?)\b/g;
  while ((m = re.exec(sentence)) !== null) {
    const a = m[1];
    if (ACRONYM_STOP.has(a.toUpperCase()) || /^\d/.test(a)) continue;
    // an all-caps heading ("REQUIREMENTS", "ABOUT THE ROLE") is not an acronym: long words, or the row is shouted
    if (a.length > 6 && !/\d|[/&+-]/.test(a)) continue;
    const letters = (sentence.match(/[A-Za-z]/g) || []).length;
    const caps = (sentence.match(/[A-Z]/g) || []).length;
    if (letters && caps / letters > 0.6) continue;
    out.push({ acronym: a, long: longForm.get(a) || null });
  }
  return out;
}

/**
 * The posting's own requirement terms, from requirement rows.
 * @param {Array<{ sentence: string, kind: string, importance: string }>} rows postingSections.requirementSentences(text)
 * @param {{ title?: string, company?: string, taken?: string[][] }} opts taken = stem lists already read as facts
 * @returns {Array<{ label: string, phrases: string[], importance: 'required'|'preferred'|'responsibility', evidence: string, anyOf: string|null, acronym: string|null }>}
 */
export function extractPostingTerms(rows, opts = {}) {
  const titleStems = new Set(contentStems(opts.title || ''));
  const companyStems = new Set(contentStems(opts.company || ''));
  // "CSR" for a Customer Service Representative posting, "PLS" for PLS Check Cashers: the job and the employer
  const initials = (str) => tokensOf(str).filter((w) => !/^(?:of|and|the|for|&|a|an|in)$/.test(w)).map((w) => w[0]).join('').toUpperCase();
  const ownAcronyms = new Set([initials(opts.title || ''), initials(opts.company || ''), ...String(opts.company || '').split(/[^A-Za-z0-9]+/).filter((w) => /^[A-Z0-9]{2,}$/.test(w))].filter((x) => x.length >= 2));
  for (const run of `${opts.title || ''} | ${opts.company || ''}`.match(/(?:[A-Z][\w&'’]*\s+){1,5}[A-Z][\w&'’]*/g) || []) { const i = initials(run); if (i.length >= 2) ownAcronyms.add(i); }
  const titleAcrs = (opts.title || '').match(/\b[A-Z][A-Z0-9]{1,7}\b/g) || [];
  for (const a of titleAcrs) ownAcronyms.add(a);
  const taken = (opts.taken || []).filter((s) => s.length);
  const out = new Map(); // stem key → term
  const rank = { responsibility: 0, preferred: 1, required: 2 };

  const add = (label, row, extra = {}) => {
    const clean = cleanTerm(label);
    if (!clean) return null;
    const stems = contentStems(clean);
    const acr = extra.acronym || (/^[A-Z][A-Z0-9]{1,7}(?:[/&+-][A-Z0-9]{1,6})?$/.test(clean) && !ACRONYM_STOP.has(clean) ? clean : null);
    // a capitalised single word that only opens the row ("Defense", "Construction") is a proper name only mid-row
    if (!acr && !/\s/.test(clean) && /^[A-Z][a-z]/.test(clean) && sentenceStart(row.sentence, clean) && !singleWordOk(clean.toLowerCase())) return null;
    if (!stems.length && !acr) return null;
    if (acr && (ownAcronyms.has(acr) || [...ownAcronyms].some((o) => o.length >= 3 && o.startsWith(acr) && acr.length >= 3))) return null;
    if (acr && String(opts.company || '').toLowerCase().split(/[^a-z0-9]+/).some((w) => w && (w === acr.toLowerCase() || (acr.length >= 3 && w.startsWith(acr.toLowerCase()))))) return null;
    const key = acr || stems.join(' ');
    const longKey = extra.long ? contentStems(extra.long).join(' ') : '';
    // the job title's own words ("Registered Nurse" for an RN posting) and the employer are not requirements
    if (stems.length && stems.every((s) => titleStems.has(s) || companyStems.has(s))) return null;
    // already read by the vocabulary (same stems, or contained in a fact's phrase)
    if (stems.length && taken.some((t) => stems.every((s) => t.includes(s)) || t.every((s) => stems.includes(s)))) return null;
    const importance = row.kind === 'preferred' || row.importance === 'preferred' ? 'preferred' : row.kind === 'responsibilities' || row.importance === 'responsibility' ? 'responsibility' : 'required';
    const prev = out.get(key) || (longKey && out.get(longKey)) || (acr && [...out.values()].find((t) => t.acronym === acr));
    if (prev) {
      if (rank[importance] > rank[prev.importance]) prev.importance = importance;
      if (!prev.phrases.includes(clean)) prev.phrases.push(clean);
      return prev;
    }
    const term = { label: extra.long ? `${extra.long} (${acr})` : clean, phrases: [clean, ...(extra.long ? [extra.long] : [])], importance, evidence: row.sentence.slice(0, 240), anyOf: extra.anyOf || null, acronym: acr, stems: extra.long ? contentStems(extra.long) : stems };
    out.set(key, term);
    if (longKey && longKey !== key) out.set(longKey, term);
    return term;
  };
  const sentenceStart = (sentence, word) => String(sentence || '').replace(/^[\s•▪◦·‣\-–*]+/, '').startsWith(word);

  let group = 0;
  for (const row of rows || []) {
    const sentence = String(row.sentence || '').trim();
    if (sentence.length < 6 || NOT_A_REQUIREMENT_RE.test(sentence)) continue;
    // a degree or schedule statement is a constraint (degree field, shifts), read elsewhere
    if (DEGREE_ROW_RE.test(sentence) || SCHEDULE_ROW_RE.test(sentence)) continue;
    // a licence or certificate is read as a certification constraint (an "active RN license", "BLS")
    if (LICENSE_ROW_RE.test(sentence)) continue;
    // 1. examples the posting names — alternatives of one requirement
    EXAMPLES_RE.lastIndex = 0;
    let m;
    const exampleSpans = [];
    const parenExamples = [];
    while ((m = EXAMPLES_RE.exec(sentence)) !== null) {
      const start = m.index + m[0].length;
      const inParen = sentence.lastIndexOf('(', m.index) > sentence.lastIndexOf(')', m.index);
      const close = inParen ? sentence.indexOf(')', start) : -1;
      const span = close > 0 ? sentence.slice(start, close) : objectAt(sentence, start);
      const items = splitList(span).filter((x) => x.split(/\s+/).length <= 5);
      if (items.length && EXAMPLE_CUE_RE.test(sentence.slice(0, m.index))) {
        const key = items.length > 1 ? `terms:${group++}` : null;
        // a choice one of whose options the vocabulary already read ("industries such as hospitality, financial
        // services, retail") is that requirement — its other options are alternatives, not new requirements
        const isTaken = (it) => { const st = contentStems(cleanTerm(it)); return st.length && taken.some((t) => st.every((x) => t.includes(x)) || t.every((x) => st.includes(x))); };
        const added = items.some(isTaken) ? [] : items.map((it) => add(it, row, { anyOf: key })).filter(Boolean);
        exampleSpans.push([m.index, close > 0 ? close : start + span.length]);
        // "(e.g., CHF, COPD, wound care)" right after a requirement: the examples illustrate it
        if (inParen && added.length) parenExamples.push({ paren: sentence.lastIndexOf('(', m.index), terms: added });
      }
    }
    const inExample = (i) => exampleSpans.some(([a, b]) => i >= a && i <= b);
    // 2. cue → object ("experience with X, Y and Z")
    CUE_OBJECT_RE.lastIndex = 0;
    while ((m = CUE_OBJECT_RE.exec(sentence)) !== null) {
      const start = m.index + m[0].length;
      if (inExample(start)) continue;
      const obj = objectAt(sentence, start);
      const heads = splitList(obj).map((it) => add(it, row)).filter(Boolean);
      // the requirement an example list illustrates: "experience with acute and post-acute care (e.g., CHF, …)"
      const after = start + obj.length;
      const ex = parenExamples.find((p) => p.paren >= after && p.paren - after <= 3);
      if (ex && heads.length) {
        for (const h of heads) h.examples = [...new Set([...(h.examples || []), ...ex.terms])];
        for (const t of ex.terms) if (!t.exampleOf) t.exampleOf = heads[0];
      }
    }
    // 2b. cue → gerund → object ("experience wiring harnesses" → wiring harnesses; "experience designing or
    //     fabricating enclosures, mounting brackets, or racking systems" → each object)
    CUE_GERUND_RE.lastIndex = 0;
    while ((m = CUE_GERUND_RE.exec(sentence)) !== null) {
      const start = m.index + m[0].length;
      if (inExample(start)) continue;
      const gerunds = m[1].split(/\s*(?:,|or|and|and\/or)\s*/).filter(Boolean);
      const items = splitList(objectAt(sentence, start).replace(/:.*$/, ''));
      items.forEach((it, i) => add(i === 0 && gerunds.length === 1 && ING_NOUNS.has(gerunds[0]) ? `${gerunds[0]} ${it}` : it, row));
    }
    // 3. object → cue ("head-to-toe assessment skills", "SRM design experience")
    OBJECT_CUE_RE.lastIndex = 0;
    while ((m = OBJECT_CUE_RE.exec(sentence)) !== null) {
      if (inExample(m.index)) continue;
      // keep only the words after the last clause break inside the match
      const head = m[1].split(/\b(?:with|in|of|and|or|have|has|use|utilize|demonstrate|demonstrated|possess|bring|show)\b/i).pop();
      add(head, row);
    }
    // 4. acronyms the row states
    for (const a of acronymsIn(sentence)) {
      if (inExample(sentence.indexOf(a.acronym))) continue;
      add(a.acronym, row, { acronym: a.acronym, long: a.long });
    }
  }
  let terms = [...new Set(out.values())];
  const seenLabel = new Set();
  terms = terms.filter((t) => { const k = t.label.toLowerCase().replace(/\s+/g, ' '); if (seenLabel.has(k)) return false; seenLabel.add(k); return true; });
  terms = terms.filter((t) => !t.acronym && t.stems.length ? !terms.some((o) => o !== t && o.evidence === t.evidence && o.stems.length > t.stems.length && t.stems.every((x) => o.stems.includes(x))) : true);
  terms = terms.filter((t) => !(t.acronym && t.label === t.acronym && terms.some((o) => o !== t && o.label.includes(t.acronym))));
  // a long posting can state dozens; keep the strongest: required, then preferred, then duties (a choice counts once)
  terms.sort((a, b) => rank[b.importance] - rank[a.importance]);
  const kept = [];
  const groups = new Set();
  for (const t of terms) {
    const slot = t.anyOf || t;
    if (!groups.has(slot) && groups.size >= MAX_TERMS) continue;
    groups.add(slot);
    kept.push(t);
  }
  return kept;
}

/** At most this many requirements per posting from its own words (a choice of alternatives counts once). */
export const MAX_TERMS = 14;

/**
 * Is a posting term on the résumé? Matched by word stems inside ONE résumé line (all content stems
 * for a 1–2 word term, two thirds for a longer one), or by the acronym as a whole word, or by its long form.
 * @param {{ label: string, stems?: string[], acronym?: string|null, phrases?: string[] }} term
 * @param {string} resumeText
 * @returns {{ matched: boolean, line: string|null, partial: boolean }}
 */
export function matchTerm(term, resumeText) {
  const lines = String(resumeText || '').split(/\n+/).map((l) => l.trim()).filter(Boolean);
  if (term.acronym) {
    const re = new RegExp(`(^|[^A-Za-z0-9])${term.acronym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^A-Za-z0-9])`);
    const hit = lines.find((l) => re.test(l));
    if (hit) return { matched: true, line: hit, partial: false };
  }
  const variants = [...new Set([...(term.phrases || []), term.label])].map((p) => contentStems(p)).filter((s) => s.length);
  let best = { matched: false, line: null, partial: false, score: 0 };
  for (const want of variants) {
    const need = want.length <= 2 ? want.length : Math.ceil(want.length * 2 / 3);
    for (const l of lines) {
      const have = new Set(tokenize(l).map((t) => t.stem));
      const got = want.filter((s) => have.has(s)).length;
      if (got >= need && got / want.length > best.score) best = { matched: true, line: l, partial: got < want.length, score: got / want.length };
    }
  }
  return { matched: best.matched, line: best.line ? best.line.slice(0, 240) : null, partial: best.partial };
}

/**
 * The matching data of a term rebuilt from its stored label (a cached job_facts row keeps only the label):
 * "Model-Based Systems Engineering (MBSE)" → stems of the long form + the acronym.
 */
export function termFromLabel(label) {
  const s = String(label || '');
  const m = s.match(/^(.*?)\s*\(\s*([A-Z][A-Za-z0-9&/+-]{1,9})\s*\)$/);
  const long = m ? m[1] : s;
  const acronym = m ? m[2] : (/^[A-Z][A-Z0-9]{1,7}(?:[/&+-][A-Z0-9]{1,6})?$/.test(s) ? s : null);
  return { stems: contentStems(long), acronym, phrases: m ? [long, acronym] : [s] };
}

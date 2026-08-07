// Job parser V2 — turns a job description into a structured requirement set, not a bag of
// keywords. It tells apart a HARD requirement, a PREFERRED nice-to-have, a plain
// RESPONSIBILITY, and generic company fluff, and tags each with a category, weight, evidence
// sentence, and whether missing it is fatal / risky / recoverable. Pure + deterministic.

import { canonSkill, SKILL_ALIASES, hasWord } from './skillGraph.js';
import { detectRoleFamily, roleFamily } from './roleOntology.js';

const KNOWN_SURFACES = [...new Set([
  ...Object.keys(SKILL_ALIASES), ...Object.values(SKILL_ALIASES),
  'customer service', 'communication', 'teamwork', 'leadership', 'safety', 'accuracy',
  'inventory', 'shipping', 'receiving', 'merchandising', 'scheduling', 'documentation',
  'point of sale', 'cash handling', 'food safety', 'route planning', 'logistics',
  'data entry', 'customer intake', 'reporting', 'sales', 'compliance', 'hospitality',
  'excel', 'sql', 'crm', 'salesforce', 'quickbooks', 'microsoft office', 'forklift',
])].filter(s => s.length >= 3).sort((a, b) => b.length - a.length);

const REQUIRED_CUES = /\b(required|must have|must be|minimum|at least|need to have|requirement|essential|mandatory)\b/i;
const PREFERRED_CUES = /\b(preferred|plus|nice to have|nice-to-have|bonus|a plus|ideal(ly)?|desired|we'd love|would be great)\b/i;
const RESP_CUES = /\b(responsib|you will|you'll|duties|day to day|day-to-day|in this role|what you'll do|the role)\b/i;
const FLUFF_RE = /\b(fast-paced environment|team player|self-starter|wear many hats|dynamic|passionate|rockstar|ninja|work hard play hard|competitive salary|great culture)\b/i;
const CREDENTIAL_RE = /\b(certif\w*|licens\w*|degree|diploma|ged|cdl|rn\b|lpn|cpa|pmp|comptia|servsafe|forklift certif\w*|bachelor'?s?|associate'?s?|high school)\b/i;
const PHYSICAL_RE = /\b(lift(?:ing)?\s*(?:up to\s*)?\d+\s*(?:lbs?|pounds?)|stand(?:ing)? for|physical(?:ly)?|bend|stoop|walk\b|on your feet)\b/i;
const SCHEDULE_RE = /\b(shift|overnight|weekends?|holidays?|part[- ]time|full[- ]time|overtime|on-call|flexible schedule|nights?|mornings?|evenings?)\b/i;
const TRAVEL_RE = /\b(travel\s*(?:up to\s*)?\d+%|willing to travel|travel required)\b/i;
const REMOTE_RE = /\b(remote|hybrid|on-?site|in-?office|work from home|wfh)\b/i;
const YEARS_RE = /(\d+)\+?\s*(?:-\s*\d+\s*)?years?(?:\s+of)?\s+(?:experience|exp)/i;
const DISQ_RE = /\b(must pass|background check|drug (?:test|screen)|clean driving record|no felon\w*|authorized to work|clearance)\b/i;

// Strip contamination that must never become a "requirement": URLs, bare domains + their
// paths (the tgt.biz/BenefitsForYou_C benefit-link that split into "tgt biz" / "benefitsforyou_c"),
// and emails. Runs before clause splitting so no downstream extractor ever sees them. Kept narrow
// (real TLDs only) so tech tokens like "node.js" survive. (Phase 1 replaces this with the shared
// sanitizer; this local copy keeps the Phase 0 fix self-contained.)
function stripJobContaminants(s) {
  return String(s || '')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\bwww\.\S+/gi, ' ')
    .replace(/\b[a-z0-9][a-z0-9-]*\.(?:com|org|net|io|biz|co|gov|edu|info|xyz|us|app|dev|link|page|site)(?:\/\S*)?/gi, ' ')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/gi, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function splitClauses(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .split(/(?:\n|[•\-*▪◦·]|(?<=[.;!?])\s+)/)
    .map(s => s.trim())
    .filter(s => s.length >= 8 && s.length <= 300);
}

// Open-vocabulary skill phrases named by a "experience with / proficient in / knowledge of …"
// pattern OR by an explicit "Required: a, b, c" / "Skills: a, b, c" list. Lets the parser pick
// up SEO, curriculum design, NEC code — any industry's terms — with no dictionary entry.
const REQ_LIST_CUE = /\b(required|requirements?|must have|preferred|nice to have|qualifications?|skills?|proficient in|proficiency in|experience (?:with|in)|knowledge of|skilled in|familiar\w* with|expertise in|background in|understanding of|ability to)\b\s*[:\-]?\s*/i;
const STOP_PHRASE = /^(a|an|the|and|or|of|to|in|with|strong|excellent|good|our|your|this|that|their|other|various|related|following|plus|years?|year|experience|ability)\b/i;
// Generic action verbs that lead a RESPONSIBILITY clause tail, not a skill name. "ability to
// provide you with…" / "operate handheld scanners" are sentences, not skills — reject them so
// they never become scoreable requirements.
const GENERIC_LEAD = new Set(['provide', 'provides', 'providing', 'ensure', 'ensures', 'ensuring', 'perform', 'performs', 'performing', 'operate', 'operates', 'operating', 'maintain', 'maintains', 'maintaining', 'assist', 'assists', 'assisting', 'support', 'supports', 'supporting', 'help', 'helps', 'helping', 'handle', 'handles', 'handling', 'follow', 'follows', 'following', 'complete', 'completes', 'completing', 'based', 'using', 'deliver', 'delivering', 'drive', 'driving', 'conduct', 'conducting', 'participate', 'participating', 'perform', 'meet', 'meeting']);
// Reject items carrying URL/email/path/query/id contamination (a slash, @, underscore, query
// char, a real-TLD domain, or a long digit run). Belt-and-suspenders after stripJobContaminants.
const CONTAMINATED = /[/@_]|[?=&#]|\b[a-z0-9-]{2,}\.(?:com|org|net|io|biz|co|gov|edu|info|xyz|us|app|dev|link)\b|\d{4,}/i;
// A bare credential word is noise — real credentials come from CREDENTIAL_RE / the cert extractor.
const CREDENTIAL_LEAD = /^(licens\w*|certif\w*|credential)\b/;
// Prose nouns that ride along in a sentence tail but are never a standalone skill. (Phase 2's
// canonical phrase extractor replaces this blocklist with proper generic-word suppression.)
const GENERIC_OPEN_NOUN = new Set(['team members', 'team member', 'members', 'member', 'technology', 'guests', 'guest', 'company policy', 'policy', 'policies', 'equivalent', 'age', 'tools', 'duties', 'staff', 'people', 'environment', 'business needs', 'business need', 'other duties']);

function extractOpenSkills(clause) {
  const out = new Set();
  const m = REQ_LIST_CUE.exec(clause);
  if (!m) return out;
  const tail = clause.slice(m.index + m[0].length);
  // split the tail into candidate skill items
  const items = tail.split(/[,;|]|\s+and\s+|\s+or\s+|\s*\/\s*/);
  for (let raw of items) {
    if (CONTAMINATED.test(raw)) continue; // URL/email/path/tracking fragment — never a skill
    let s = raw.replace(/[.()]/g, ' ').replace(/\b(\d+\+?\s*years?(?:\s+of)?)\b/gi, ' ').trim().toLowerCase();
    s = s.replace(/\b(experience|proficien\w*|knowledge|skills?|expertise|background|familiar\w*|understanding|strong|excellent|good|solid|working)\b/gi, '').replace(/\s+/g, ' ').trim();
    if (s.length < 2 || s.length > 40) continue;
    if (STOP_PHRASE.test(s)) continue;
    if (!/[a-z]/.test(s)) continue;
    if (CREDENTIAL_LEAD.test(s)) continue; // "licensure", "certification where applicable" — noise
    if (GENERIC_OPEN_NOUN.has(s)) continue; // "team members", "technology" — prose, not a skill
    // A tail that leads with a generic action verb is a responsibility sentence, not a skill.
    const words = s.split(' ');
    if (GENERIC_LEAD.has(words[0])) continue;
    // keep 1–4 word phrases only (skills, not sentences)
    if (words.length > 4) continue;
    out.add(canonSkill(s));
  }
  return out;
}

function surfacesIn(clause) {
  const lower = clause.toLowerCase();
  const found = new Set();
  for (const surf of KNOWN_SURFACES) if (hasWord(lower, surf)) found.add(canonSkill(surf));
  for (const s of extractOpenSkills(clause)) found.add(s);
  return [...found];
}

function categoryOf(canon, clause) {
  if (CREDENTIAL_RE.test(clause)) return 'credential';
  if (/excel|sql|crm|salesforce|quickbooks|microsoft office|forklift|pos|point of sale|rf scanner/i.test(clause) && /\b(software|system|tool|proficien|experience with)\b/i.test(clause)) return 'tool';
  if (['customer service', 'communication', 'teamwork', 'leadership', 'reliability', 'time management', 'conflict resolution'].includes(canon)) return 'soft_skill';
  return 'skill';
}

export function parseJobV2(jobDescription, { jobTitle = '' } = {}) {
  const text = stripJobContaminants(String(jobDescription || ''));
  const clauses = splitClauses(text);
  const rf = detectRoleFamily(jobTitle, text);
  const famData = roleFamily(rf.family);

  // Keyword frequency (for "repeated keyword" signal).
  const freq = {};
  const lowerText = text.toLowerCase();
  for (const surf of KNOWN_SURFACES) {
    const c = canonSkill(surf);
    // boundary-aware count so "register" doesn't count "registered"
    const n = (lowerText.match(new RegExp(`(?<![a-z0-9])${surf.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9])`, 'g')) || []).length;
    if (n) freq[c] = (freq[c] || 0) + n;
  }
  const repeatedKeywords = Object.entries(freq).filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).map(([k]) => k);

  const requirements = [];
  const seen = new Set();
  for (const clause of clauses) {
    if (FLUFF_RE.test(clause) && surfacesIn(clause).length === 0) continue; // pure fluff
    const isReq = REQUIRED_CUES.test(clause);
    const isPref = PREFERRED_CUES.test(clause);
    const isResp = RESP_CUES.test(clause);
    const surfaces = surfacesIn(clause);
    const yearsHere = YEARS_RE.exec(clause);
    // Emit one requirement per distinct skill surface in the clause; if none, only emit for
    // credential/years/responsibility clauses (so we don't manufacture empty requirements).
    const targets = surfaces.length ? surfaces : (CREDENTIAL_RE.test(clause) || yearsHere ? ['__meta__'] : (isResp ? ['__responsibility__'] : []));
    for (const canon of targets) {
      let importance = 'responsibility';
      if (isReq || (yearsHere && !isPref)) importance = 'required';
      else if (isPref) importance = 'preferred';
      else if (isResp) importance = 'responsibility';
      else if (surfaces.length) importance = repeatedKeywords.includes(canon) ? 'required' : 'preferred';
      const category = canon.startsWith('__') ? (CREDENTIAL_RE.test(clause) ? 'credential' : yearsHere ? 'experience' : 'responsibility') : categoryOf(canon, clause);
      const label = canon === '__meta__' ? (CREDENTIAL_RE.exec(clause)?.[0] || (yearsHere ? `${yearsHere[1]}+ years experience` : 'requirement')) : canon === '__responsibility__' ? clause.slice(0, 60) : canon;
      // A bare generic credential word ("licensure", "certification", "degree") with no specific
      // name is noise, not a checkable requirement — skip it so it never becomes a missing gap.
      if (canon === '__meta__' && category === 'credential' && /^(licens\w*|certif\w*|certification|credential|degree|diploma)$/i.test(label.trim())) continue;
      const key = `${importance}:${label.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const weight = importance === 'required' ? 1 : importance === 'preferred' ? 0.6 : importance === 'nice_to_have' ? 0.3 : 0.4;
      // Missing a required hard skill/credential is fatal; a required soft skill is risky;
      // everything else is recoverable.
      const fatal = importance === 'required' && (category === 'credential' || category === 'tool' || category === 'skill');
      const missSeverity = fatal ? 'fatal' : importance === 'required' ? 'risky' : 'recoverable';
      requirements.push({
        text: clause.slice(0, 240), normalizedLabel: label, importance, category,
        evidence: clause.slice(0, 240), weight, missSeverity, fatalIfMissing: fatal,
      });
    }
  }

  // Hidden requirements the JD implies but does not list as a bullet — derived from the role
  // family's known employer priorities that the text hints at.
  const hidden = [];
  if (famData) {
    for (const p of famData.employerPriorities) {
      if (lowerText.includes(p.split(' ')[0])) hidden.push({ normalizedLabel: p, importance: 'hidden', category: 'soft_skill', weight: 0.5, evidence: `Role-family signal: ${famData.label} employers weight "${p}".`, missSeverity: 'recoverable', fatalIfMissing: false });
    }
  }

  const yearsM = YEARS_RE.exec(text);
  return {
    jobTitle: jobTitle || null,
    roleFamily: rf.family,
    roleFamilyLabel: rf.label,
    roleFamilyConfidence: rf.confidence,
    seniority: /\b(senior|sr\.?|lead|principal|staff)\b/i.test(`${jobTitle} ${text}`) ? 'senior' : /\b(junior|jr\.?|entry|intern)\b/i.test(`${jobTitle} ${text}`) ? 'entry' : 'mid',
    yearsRequired: yearsM ? Number(yearsM[1]) : null,
    requirements,
    hiddenRequirements: hidden,
    repeatedKeywords,
    schedule: SCHEDULE_RE.test(text) ? (text.match(SCHEDULE_RE) || [])[0] : null,
    physical: PHYSICAL_RE.test(text) ? (text.match(PHYSICAL_RE) || [])[0] : null,
    travel: TRAVEL_RE.test(text) ? (text.match(TRAVEL_RE) || [])[0] : null,
    remote: REMOTE_RE.test(text) ? (text.match(REMOTE_RE) || [])[0] : null,
    credentials: [...new Set((text.match(new RegExp(CREDENTIAL_RE, 'gi')) || []).map(s => s.toLowerCase()))].slice(0, 8),
    disqualifiers: [...new Set((text.match(new RegExp(DISQ_RE, 'gi')) || []).map(s => s.toLowerCase()))].slice(0, 8),
  };
}

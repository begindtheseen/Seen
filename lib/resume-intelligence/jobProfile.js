// Resume Intelligence Engine — CANONICAL JOB PROFILE (Phases 2–4).
//
// ONE job-understanding pipeline that replaces the three competing interpretations:
//   sanitize → section detection → role/occupation classification → phrase-first concept extraction
//   + open-vocabulary mining + structured extractors → taxonomy normalization → importance
//   classification → a structured JobProfile with TYPED requirements.
//
// Every requirement is an object (never a bare string): { id, canonicalConcept, displayName,
// category, requirementLevel, importance, sourceText, sourceSection, confidence, requiredYears,
// aliases, relatedConcepts }. Section placement + cue language + repetition + role relevance decide
// the level. Pure + deterministic, NO AI, NO I/O.

import { sanitizeJobText } from './sanitize.js';
import { detectRoleFamily, roleFamily } from '../application-intelligence/roleOntology.js';
import { extractTaxonomyConcepts, extractListedSkills } from './concepts.js';
import { resolveConcept, relatedConcepts, getConcept } from './taxonomy.js';
import { extractYears, extractEducation, extractCertifications, extractPhysical, extractSchedule, extractScreening } from './structured.js';

// ── Section detection ─────────────────────────────────────────────────────────
const HEADER_PATTERNS = [
  ['responsibilities', /^(?:key\s+)?(?:responsibilities|duties|essential\s+(?:duties|functions|job\s+functions)|what\s+you(?:'|')?ll\s+do|what\s+you\s+will\s+do|the\s+role|your\s+role|role\s+overview|job\s+duties|day[- ]to[- ]day|a\s+day\s+in\s+the\s+life)\b/i],
  ['required', /^(?:requirements?|(?:required|minimum|basic|core)\s+qualifications?|qualifications?|what\s+you\s+bring|what\s+we(?:'|')?re\s+looking\s+for|what\s+we\s+need|must[- ]haves?|who\s+you\s+are|required\s+skills|skills\s+(?:&|and)\s+qualifications|experience\s+(?:&|and)\s+qualifications|you\s+have|you(?:'|')?ll\s+need)\b/i],
  ['preferred', /^(?:preferred(?:\s+qualifications?|\s+skills)?|nice[- ]to[- ]haves?|bonus(?:\s+points)?|(?:it(?:'|')?s\s+a\s+)?pluses?|a\s+plus)\b/i],
  ['benefits', /^(?:benefits|perks(?:\s+(?:&|and)\s+benefits)?|what\s+we\s+offer|we\s+offer|why\s+(?:join|work)|compensation\s+(?:&|and)\s+benefits|our\s+benefits)\b/i],
  ['schedule', /^(?:schedule|shifts?|hours|availability|work\s+schedule|shift\s+details)\b/i],
  ['pay', /^(?:pay(?:\s+range|\s+rate)?|compensation|salary(?:\s+range)?|wage|hourly\s+rate)\b/i],
];

function detectSections(lines) {
  const sections = {}; // name → [lines]
  const add = (name, text) => { if (text) (sections[name] = sections[name] || []).push(text); };
  let current = 'overview';
  for (const line of lines) {
    const stripped = line.replace(/^[#>\-*•▪◦·\s]+/, '').replace(/\*\*/g, '').trim();
    let matched = null;
    for (const [name, re] of HEADER_PATTERNS) {
      const m = stripped.match(re);
      if (m) {
        matched = name; current = name;
        const rest = stripped.slice(m[0].length).replace(/^\s*[:\-–—]\s*/, '').trim();
        if (rest) add(name, rest);
        break;
      }
    }
    if (!matched) add(current, stripped);
  }
  const out = {};
  for (const k of Object.keys(sections)) out[k] = sections[k].join('\n');
  return out;
}

// ── Requirement level from section + cue ───────────────────────────────────────
const LEVELS = { REQUIRED: 4, STRONGLY_PREFERRED: 3, PREFERRED: 2, CONTEXTUAL: 1 };
const REQUIRED_CUE = /\b(required|must\s+have|must\s+be|minimum|at\s+least|need\s+to\s+have|essential|mandatory)\b/i;
const STRONG_PREF_CUE = /\b(strongly\s+preferred|highly\s+(?:desired|preferred)|strong\s+plus|big\s+plus)\b/i;
const PREFERRED_CUE = /\b(preferred|nice\s+to\s+have|nice-to-have|bonus|a\s+plus|is\s+a\s+plus|ideal(?:ly)?|desired|we'?d\s+love|familiarity\s+with|exposure\s+to)\b/i;
const RESP_CUE = /\b(responsib|you\s+will|you'?ll|duties|day[- ]to[- ]day|in\s+this\s+role|the\s+role)\b/i;

function levelForClause(clause, section) {
  if (STRONG_PREF_CUE.test(clause)) return 'STRONGLY_PREFERRED';
  const req = REQUIRED_CUE.test(clause), pref = PREFERRED_CUE.test(clause);
  if (pref && !req) return 'PREFERRED';
  if (req) return 'REQUIRED';
  if (section === 'required') return 'REQUIRED';
  if (section === 'preferred') return 'PREFERRED';
  if (section === 'responsibilities' || section === 'overview' || RESP_CUE.test(clause)) return 'CONTEXTUAL';
  return 'REQUIRED'; // education/certifications/experience/schedule sections default hard
}

// numeric importance 0..1 from level + specificity + repetition + role relevance.
function importanceScore(level, { specific, repeated, roleRelevant }) {
  let s = { REQUIRED: 0.85, STRONGLY_PREFERRED: 0.7, PREFERRED: 0.5, CONTEXTUAL: 0.3 }[level] || 0.5;
  if (specific) s += 0.07;
  if (repeated) s += 0.06;
  if (roleRelevant) s += 0.06;
  return Math.min(1, Number(s.toFixed(2)));
}

let _idCounter = 0;
function reqId() { return `r${++_idCounter}`; }

// Build one requirement object.
function makeRequirement({ canonicalConcept, displayName, category, level, sourceText, section, confidence, requiredYears, family, repeated }) {
  const specific = (displayName || '').split(/\s+/).length >= 2 || category === 'credential';
  const roleRelevant = canonicalConcept ? (getConcept(canonicalConcept)?.domains || []).includes(family) : false;
  return {
    id: reqId(),
    canonicalConcept: canonicalConcept || null,
    displayName: displayName,
    category: category || 'skill',
    requirementLevel: level,
    importance: importanceScore(level, { specific, repeated, roleRelevant }),
    sourceText: (sourceText || '').slice(0, 200),
    sourceSection: section,
    confidence: confidence == null ? 0.8 : confidence,
    requiredYears: requiredYears || null,
    aliases: canonicalConcept ? (getConcept(canonicalConcept)?.aliases || []) : [],
    relatedConcepts: canonicalConcept ? relatedConcepts(canonicalConcept).map((r) => r.to) : [],
  };
}

// Split a section blob into clauses (bullets/sentences), for cue detection + source text.
function clauses(text) {
  return String(text || '')
    .split(/(?:\n|[•\-*▪◦·]|(?<=[.;!?])\s+)/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 3 && s.length <= 300);
}

export function buildJobProfile(rawDescription, { jobTitle = '', company = '' } = {}) {
  _idCounter = 0;
  const san = sanitizeJobText(rawDescription);
  const cleanText = san.text;
  const sections = detectSections(san.lines);

  const rf = detectRoleFamily(jobTitle, cleanText);
  const family = rf.family;
  const famData = roleFamily(family);

  // Repetition signal: canonical concepts that recur across the whole JD.
  const wholeConcepts = extractTaxonomyConcepts(cleanText, { family }).concepts.map((c) => c.id);
  const freq = {};
  for (const id of wholeConcepts) freq[id] = (freq[id] || 0) + 1;

  const requirements = [];
  const responsibilities = [];
  const byKey = new Map(); // dedup key → requirement (keep strongest level)
  const rejectedConcepts = [];

  const upsert = (req) => {
    const key = req.canonicalConcept || req.displayName.toLowerCase();
    const prev = byKey.get(key);
    if (!prev) { byKey.set(key, req); requirements.push(req); return; }
    if (LEVELS[req.requirementLevel] > LEVELS[prev.requirementLevel]) {
      prev.requirementLevel = req.requirementLevel;
      prev.importance = Math.max(prev.importance, req.importance);
    }
  };

  // Section-scoped requirement extraction.
  const skillSections = ['required', 'preferred', 'responsibilities', 'overview', 'schedule'];
  for (const section of skillSections) {
    const blob = sections[section];
    if (!blob) continue;
    const { concepts, rejected } = extractTaxonomyConcepts(blob, { family });
    rejectedConcepts.push(...rejected);
    // taxonomy concepts
    for (const c of concepts) {
      const cl = clauses(blob).find((x) => x.toLowerCase().includes(c.surface)) || blob;
      const level = levelForClause(cl, section);
      if (section === 'responsibilities' || section === 'overview') {
        // concept appearing only in responsibilities is CONTEXTUAL evidence of the role, not a gate
      }
      upsert(makeRequirement({
        canonicalConcept: c.id, displayName: c.display, category: c.category, level,
        sourceText: cl, section, confidence: 0.85, family, repeated: (freq[c.id] || 0) >= 2,
      }));
    }
    // open-vocabulary skills from explicit list clauses. Runs on requirement sections AND the
    // overview (header-less JDs put "Required: a, b, c" there) — extractListedSkills only fires on a
    // real list cue, and gerund/generic prose is rejected, so marketing text doesn't leak.
    if (section === 'required' || section === 'preferred' || section === 'overview') {
      for (const cl of clauses(blob)) {
        const level = levelForClause(cl, section);
        for (const phrase of extractListedSkills(cl)) {
          if (resolveConcept(phrase)) continue; // already covered by the taxonomy pass
          if (phrase.split(' ').length < 2 && phrase.length < 5) continue; // no vague single tokens
          upsert(makeRequirement({
            canonicalConcept: null, displayName: phrase, category: 'skill', level,
            sourceText: cl, section, confidence: 0.6, family,
          }));
        }
      }
    }
  }

  // Responsibilities (context, never a gap) — keep the raw lines for the UI's "the role" view.
  for (const cl of clauses(sections.responsibilities || '')) responsibilities.push(cl.slice(0, 160));

  // Structured requirements over the whole (non-benefit) signal text.
  const signalText = [sections.required, sections.preferred, sections.responsibilities, sections.overview, sections.schedule, sections.education, sections.experience].filter(Boolean).join('\n') || cleanText;
  const educationRequirements = [];
  const edu = extractEducation(signalText);
  if (edu) { educationRequirements.push(edu); upsert(makeRequirement({ canonicalConcept: null, displayName: edu, category: 'education', level: /required|must/i.test(signalText) && !/preferred/i.test(signalText.slice(Math.max(0, signalText.toLowerCase().indexOf(edu.toLowerCase()) - 40))) ? 'REQUIRED' : 'PREFERRED', sourceText: edu, section: 'education', confidence: 0.85, family })); }

  const certificationRequirements = extractCertifications(signalText);
  for (const cert of certificationRequirements) {
    // Resolve to a taxonomy concept when possible so "Forklift certification" (structured) and
    // forklift_operation (taxonomy alias) dedup into ONE requirement instead of two.
    const res = resolveConcept(cert);
    upsert(makeRequirement({ canonicalConcept: res ? res.id : null, displayName: cert, category: 'credential', level: 'REQUIRED', sourceText: cert, section: 'certifications', confidence: 0.85, family }));
  }

  const years = extractYears(signalText);
  const experienceRequirements = years ? [`${years}+ years experience`] : [];
  if (years) upsert(makeRequirement({ canonicalConcept: null, displayName: `${years}+ years experience`, category: 'experience', level: 'REQUIRED', sourceText: `${years}+ years`, section: 'experience', confidence: 0.8, family, requiredYears: years }));

  const physicalRequirements = extractPhysical(signalText);
  const scheduleRequirements = extractSchedule(signalText);
  const screeningRequirements = extractScreening(signalText);
  // Screening gates (18+, background check, clearance) are hard eligibility — REQUIRED credentials.
  for (const sc of screeningRequirements) {
    upsert(makeRequirement({ canonicalConcept: null, displayName: sc, category: 'credential', level: 'REQUIRED', sourceText: sc, section: 'screening', confidence: 0.85, family }));
  }

  const skills = requirements.filter((r) => r.canonicalConcept).map((r) => r.canonicalConcept);

  return {
    title: jobTitle || null,
    normalizedTitle: (jobTitle || '').toLowerCase().trim() || null,
    company: company || null,
    roleFamily: family,
    roleFamilyLabel: rf.label,
    roleFamilyConfidence: rf.confidence,
    industry: famData?.label || 'General',
    seniority: /\b(senior|sr\.?|lead|principal|staff|director|head|vp|chief)\b/i.test(`${jobTitle} ${cleanText}`) ? 'senior'
      : /\b(junior|jr\.?|entry|intern|trainee|apprentice)\b/i.test(`${jobTitle} ${cleanText}`) ? 'entry' : 'mid',

    requirements,
    responsibilities,
    skills,
    educationRequirements,
    certificationRequirements,
    experienceRequirements,
    scheduleRequirements,
    physicalRequirements,
    screeningRequirements,

    // debug / explainability
    _debug: {
      roleFamily: family,
      sections: Object.keys(sections),
      removed: san.removed,
      rejectedConcepts,
      requirementCount: requirements.length,
    },
  };
}

export { LEVELS };

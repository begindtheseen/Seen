// Section-heading recogniser built on NORMALISED TOKENS, not on a fixed list of spellings.
//
// The exact-phrase table in lexicon.js (HEADER_VOCAB) is still consulted first by sections.js; this
// is what reads every heading the table does not spell: "LICENSES / CERTS", "Licences & Certs",
// "CERTS", "Nursing Licenses", "Career Break", "Notes", "Additional Info", "Volunteer Work &
// Leadership", "Training/Certifications"… An electrician's whole licences section vanished and the
// heading "LICENSES / CERTS" was printed under his name as a headline because the table had no
// "licenses / certs" (Studio judge, 2026-11-10).
//
// How: split on / & + , and "and", fold case, singularise ("certs" → "cert", "activities" →
// "activity"), map synonyms onto a concept ("cert" → certification, "licence" → license), then
// require every token to be a concept or a heading modifier ("professional", "relevant", "key"…).
// One unknown word (a field: "Nursing Licenses", "Safety Certifications") is allowed only with
// typographic evidence (ALL CAPS / bold / larger / a trailing colon) — never on a line holding a
// job-title word or sitting right above a date line, so "TRAINING COORDINATOR" / "Jan 2020 –" stays
// a role. Pure, no I/O.

import { TITLE_WORD_RE } from './lexicon.js';

// token → concept
const CONCEPT = new Map(Object.entries({
  // experience
  experience: 'experience', employment: 'experience', work: 'experience:weak', career: 'experience:weak', job: 'experience:weak',
  position: 'experience:weak', history: 'experience:weak', background: 'experience:weak', internship: 'experience', placement: 'experience:weak',
  // education
  education: 'education', academic: 'education', academics: 'education', schooling: 'education', degree: 'education', study: 'education:weak',
  // skills
  skill: 'skills', competency: 'skills', expertise: 'skills', proficiency: 'skills', technology: 'skills', tool: 'skills',
  ability: 'skills', strength: 'skills', stack: 'skills', knowledge: 'skills', software: 'skills:weak', equipment: 'skills:weak',
  // summary
  summary: 'summary', profile: 'summary', objective: 'summary', overview: 'summary', about: 'summary:weak', statement: 'summary:weak',
  introduction: 'summary:weak', bio: 'summary', snapshot: 'summary',
  // certifications / licences
  certification: 'certifications', license: 'certifications', credential: 'certifications', accreditation: 'certifications',
  registration: 'certifications:weak', clearance: 'certifications:weak', endorsement: 'certifications:weak',
  // training (a certifications-kind section unless education names itself)
  training: 'training:weak', course: 'training', coursework: 'coursework', workshop: 'training', seminar: 'training',
  development: 'training:weak', ce: 'training:weak', ceu: 'training',
  // projects
  project: 'projects', portfolio: 'projects',
  // languages
  language: 'languages',
  // awards
  award: 'awards', honor: 'awards', achievement: 'awards', accomplishment: 'awards', recognition: 'awards', distinction: 'awards', scholarship: 'awards',
  // publications
  publication: 'publications', paper: 'publications', presentation: 'publications', patent: 'publications', talk: 'publications:weak', research: 'publications:weak',
  // volunteer
  volunteer: 'volunteer', volunteering: 'volunteer', community: 'volunteer:weak', service: 'volunteer:weak', outreach: 'volunteer', civic: 'volunteer:weak',
  // interests
  interest: 'interests', hobby: 'interests', activity: 'interests', extracurricular: 'interests', pursuit: 'interests:weak',
  // affiliations
  affiliation: 'affiliations', membership: 'affiliations', association: 'affiliations', organization: 'affiliations:weak',
  society: 'affiliations:weak', leadership: 'affiliations:weak', involvement: 'affiliations:weak',
  // references
  reference: 'references', referee: 'references',
  // free-form notes (printed as written, in a section of their own)
  note: 'notes', information: 'notes:weak', break: 'notes:weak', gap: 'notes:weak', miscellaneous: 'notes', misc: 'notes',
  sabbatical: 'notes', addendum: 'notes', other: 'notes:weak', additional: 'notes:weak',
  // contact
  contact: 'contact',
}));

// spelling / abbreviation → canonical token (applied before singularising)
const SYNONYM = new Map(Object.entries({
  cert: 'certification', certs: 'certification', certificate: 'certification', certificates: 'certification', certificat: 'certification',
  certifications: 'certification', certs_: 'certification', certified: 'certification', certification: 'certification',
  licence: 'license', licences: 'license', licenses: 'license', licensure: 'license', licensing: 'license', lic: 'license',
  credentials: 'credential', accreditations: 'accreditation',
  exp: 'experience', experiences: 'experience', employ: 'employment',
  edu: 'education', educational: 'education',
  quals: 'qualification', qualifications: 'qualification',
  info: 'information', infos: 'information',
  honours: 'honor', honour: 'honor', honors: 'honor',
  organisations: 'organization', organisation: 'organization', organizations: 'organization',
  memberships: 'membership', affiliations: 'affiliation', associations: 'association',
  extracurriculars: 'extracurricular', activities: 'activity', hobbies: 'hobby', abilities: 'ability',
  competencies: 'competency', proficiencies: 'proficiency', technologies: 'technology', studies: 'study',
  courses: 'course', trainings: 'training', publications: 'publication', presentations: 'presentation',
  achievements: 'achievement', accomplishments: 'accomplishment', awards: 'award', languages: 'language',
  projects: 'project', references: 'reference', referees: 'referee', notes: 'note', interests: 'interest',
  skills: 'skill', tools: 'tool', strengths: 'strength', positions: 'position', jobs: 'job', internships: 'internship',
  miscellaneous: 'miscellaneous', volunteers: 'volunteer', volunteered: 'volunteer',
}));

// words a heading may carry around its concept
const MODIFIER = new Set([
  'professional', 'relevant', 'key', 'core', 'technical', 'additional', 'other', 'selected', 'select', 'recent', 'related',
  'notable', 'my', 'section', 'and', 'of', 'in', 'the', 'for', 'a', 'an', 'to', 'with', 'highlight', 'highlights', 'area', 'areas',
  'specialized', 'specialised', 'industry', 'prior', 'previous', 'earlier', 'personal', 'general', 'primary', 'current',
  'active', 'applicable', 'list', 'summary', 'continued', 'cont', 'detail', 'details', 'qualification', 'qualifications',
  'field', 'hands', 'on', 'job', 'specific', 'trade', 'state', 'professionally', 'formal', 'further', 'continuing', 'ongoing',
  'pertinent', 'achieved', 'held', 'earned', 'completed', 'valid', 'relevent',
]);

function singular(w) {
  if (SYNONYM.has(w)) return SYNONYM.get(w);
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') && !/(?:us|is)$/.test(w)) {
    const s = w.slice(0, -1);
    return SYNONYM.get(s) || s;
  }
  return w;
}

/** "LICENSES / CERTS" → ['license', 'certification'] (canonical tokens, connectors dropped). */
export function headingTokens(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[“”"'’]/g, '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[&+/|,;:·•–—_=*#~-]+/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(singular);
}

// When a heading names two concepts, which section is it? (Composite headings keep the reading the
// exact-phrase table already gives them: "Skills & Certifications" is a skills section the skills
// handler pulls certifications out of, "Education & Certifications" an education section.)
const PRIORITY = ['summary', 'volunteer', 'experience', 'education', 'skills', 'certifications', 'training', 'coursework', 'projects', 'languages', 'awards', 'publications', 'affiliations', 'interests', 'references', 'notes', 'contact'];
const KIND_OF = { training: 'certifications', notes: 'custom', coursework: 'custom' };

/**
 * Recognise a section heading from its tokens.
 * @param {string} text the line as written
 * @param {{ structural?: boolean, nextHasDate?: boolean }} ctx typographic evidence around the line
 * @returns {{ kind: string, title: string, concept: string } | null}
 */
export function recognizeHeading(text, { structural = false, nextHasDate = false } = {}) {
  const raw = String(text || '').trim().replace(/[:：]\s*$/, (m) => { structural = true; return ''; }).trim();
  if (!raw || raw.length > 60 || /\d{3,}|@|https?:|www\./i.test(raw) || /[.!?]$/.test(raw)) return null;
  const toks = headingTokens(raw);
  if (!toks.length || toks.length > 6) return null;
  const concepts = [];
  const unknown = [];
  for (const t of toks) {
    const c = CONCEPT.get(t);
    if (c) concepts.push(c);
    else if (!MODIFIER.has(t)) unknown.push(t);
  }
  if (!concepts.length) return null;
  const strong = concepts.filter((c) => !c.endsWith(':weak')).map((c) => c.split(':')[0]);
  const weak = concepts.filter((c) => c.endsWith(':weak')).map((c) => c.split(':')[0]);
  // a line holding a job-title word is a role ("Training Coordinator", "Volunteer Coordinator")
  const titleWords = raw.replace(/\b(?:volunteer|volunteering|research|service|leadership|security|support|product|tech|technical|professional|work|career)\b/gi, ' ');
  if (TITLE_WORD_RE.test(titleWords)) return null;
  // an employer ("Career Education Corp", "Community Health Center") is never a heading
  if (/\b(?:inc|llc|ltd|corp|co|company|group|university|college|hospital|center|centre|clinic|bank)\b/i.test(raw)) return null;
  if (unknown.length > 1) return null;
  if (unknown.length === 1 && (!structural || nextHasDate || !strong.length)) return null;
  // weak concepts alone ("Work", "Service", "Other", "Career Break") need typography or a partner
  if (!strong.length && !(structural || weak.length >= 2)) return null;
  const pool = strong.length ? strong : weak;
  // "Summary of Qualifications" is a summary; "Skills Summary" is a skills section
  let concept = null;
  if (pool.includes('summary') && pool.some((c) => c !== 'summary') && toks[0] !== 'summary') concept = PRIORITY.find((p) => p !== 'summary' && pool.includes(p));
  if (!concept) concept = PRIORITY.find((p) => pool.includes(p));
  // "Training & Certifications": training beside a certification is the certification section;
  // "Education & Training" stays education (priority already says so)
  if (!concept) return null;
  // "Career Break" / "Employment Gap": a note about the timeline, not a work history
  if (toks.some((t) => t === 'break' || t === 'gap' || t === 'sabbatical')) concept = 'notes';
  return { kind: KIND_OF[concept] || concept, title: raw, concept };
}

/** True when a line reads as a section heading of any kind (the headline / title guard). */
export function isSectionHeading(text, ctx = {}) {
  return !!recognizeHeading(text, ctx);
}

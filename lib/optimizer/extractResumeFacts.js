// Deterministic résumé → facts extraction. NO external AI.
//
// We pull skills, tools, titles, seniority, metrics, education, certifications, total and
// management experience out of plain résumé text using the SAME vocabulary the posting side uses
// (extractJobFacts.KNOWN_SKILLS + the taxonomy aliases) and the SAME stemmer (lemma.js), so
// "Trained 4 new hires" meets a posting's "training" and "POS systems" meets "register". Every
// fact carries the exact source span (`evidenceText`) so downstream bullet generation can PROVE a
// claim is backed by the résumé (anti-hallucination is enforced here, not by a model promising to
// behave).
//
// v2 (2026-10-24, two expert audits):
//   • stem matching (lemma.js) instead of literal containment;
//   • verb-shaped tokens (excel, lead, go, rest, drive) count only with a tool cue on their line;
//   • education comes from real degree phrases ("Associate of Arts", "Bachelor's degree"), never
//     from a job title ("Sales Associate" is not an associate degree);
//   • a title is the whole title segment ("Membership Specialist", not "Specialist");
//   • total and supervisory experience are measured from the role date ranges (hard gates);
//   • METRIC_RE lists long units first ("20 months" is never "20 m");
//   • evidence outside a bullet is the SENTENCE it sits in, with "full-\ntime" re-joined — never a
//     line fragment that starts mid-word.
import { canonicalText, normalizeSkill, BUILTIN_TAXONOMY } from './normalizeSkills.js';
import { KNOWN_SKILLS } from './extractJobFacts.js';
import { AMBIGUOUS_TOKENS } from './hourlyVocabulary.js';
import { tokenize, findStemmed, stemPhrase } from './lemma.js';
import { detectRoleFamily } from '../application-intelligence/roleOntology.js';

const SENIORITY_TITLE = [
    { re: /\b(chief|c-level|cto|ceo|cfo|cio|vp|vice president)\b/i, level: 'executive', rank: 6 },
    { re: /\b(director|head of)\b/i, level: 'director', rank: 5 },
    { re: /\b(manager|supervisor|principal|staff)\b/i, not: /\bassistant\s+manager\b/i, level: 'lead', rank: 4 },
    { re: /\b(?:team|shift)\s+lead\b|\blead\s+(?:cashier|associate|barista|teller|server|technician)\b|\bassistant\s+manager\b|\bkey\s*holder\b/i, level: 'mid', rank: 2 },
    { re: /\blead\b/i, level: 'lead', rank: 4 },
    { re: /\b(senior|sr\.?)\b/i, level: 'senior', rank: 3 },
    { re: /\b(junior|jr\.?|entry[- ]?level|intern|trainee)\b/i, level: 'entry', rank: 1 },
];
// Store-level / hourly title nouns — an entry-level role when no seniority word is present.
const HOURLY_TITLE_RE = /\b(associate|cashier|clerk|crew|team member|attendant|representative|barista|server|host|hostess|stocker|picker|packer|driver|courier|valet|specialist|greeter|teller|receptionist|agent|guard|cook|dishwasher|busser|runner|merchandiser|warehouse)\b/i;
const LEVEL_RANK = { entry: 1, mid: 2, senior: 3, lead: 4, director: 5, executive: 6 };

// A real degree phrase. "Associate" alone is a job title; it is a degree only as "Associate of
// Arts/Science", "Associate's degree", "A.A./A.S." or "associate degree".
// The phrase must END at a non-letter: the old trailing `\b` could never match after the final
// "." of "B.S." (a "." followed by a space is not a word boundary), so "B.S. Computer Science —
// The University of Texas at Austin 2018" read as "no degree" (Dev, 2026-10-25). Abbreviations
// are accepted dotted, undotted only before "in" ("BS in", never "MS Excel") and as B.Sc./M.Sc.
const DEGREE_RE = /(?<![a-z0-9])(b\.\s?s\.\s?n\.|m\.\s?s\.\s?n\.|ph\.?\s?d\.?|doctorate|doctor of [a-z]+|master'?s?(?:\s+degree|\s+of\s+[a-z]+)|m\.?b\.?a\.?|m\.\s?sc?\.?|m\.\s?a\.|bachelor'?s?(?:\s+degree|\s+of\s+[a-z]+)?|b\.\s?sc?\.?|b\.\s?a\.|b\.?\s?b\.?\s?a\.?|b\.?\s?s\.?\s?n\.?|m\.?\s?s\.?\s?n\.?|b\.f\.a\.|m\.f\.a\.|b\.?\s?eng\.?|b\.?\s?com\.?|a\.b\.|m\.p\.a\.|m\.p\.h\.|m\.s\.w\.|b\.s\.w\.|bsw|msw|bba|bfa|mfa|mph|mpa|bsee|bsme|bsce|bscs|(?:bs|ba|ms|bsc|msc)(?=\s+in\s)|associate'?s?\s+(?:degree|of\s+(?:arts|science|applied\s+science))|associate\s+degree|a\.a\.s?\.?|a\.s\.|b\.\s?ed\.?|m\.\s?ed\.?|(?:bed|med)(?=\s+in\s)|high\s+school\s+diploma|high\s+school|ged)(?![a-z0-9])/gi;
// A degree the line says is unfinished ("Coursework toward A.A.S.", "pursuing a B.A.", "expected
// 2027" is fine — that is a degree date) is not a degree held.
const UNFINISHED_RE = /\b(?:coursework|courses|credits|classes)\s+(?:toward|towards|in)\b|\b(?:pursuing|working\s+toward|incomplete|not\s+completed|some\s+college)\b/i;
// …and a line that says the degree is still being earned anywhere on it ("Currently enrolled: RN to BSN, Grand Canyon
// University (expected 2027)", "B.S. Computer Science — in progress") — G2: the nurse's ADN was printed as "Your
// Bachelor's degree meets the education requirement" because the BSN she is still studying for counted.
const IN_PROGRESS_DEGREE_RE = /\b(?:currently\s+enrolled|enrolled\s+in|enrolled:|in\s+progress|candidate\s+for|anticipated|expected\s*(?:graduation|completion|:)?\s*(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+)?((?:19|20)\d\d))\b/i;
function degreeInProgress(line) {
    const m = String(line || '').match(IN_PROGRESS_DEGREE_RE);
    if (!m) return false;
    // "expected 2019" on an old line is a finished degree's date; a year still to come is not
    return !m[1] || Number(m[1]) >= new Date().getUTCFullYear();
}
// A credential the line says is not held yet ("CPA Candidate", "CPA exam: REG in progress", "pursuing PMP").
const CERT_NOT_HELD_AFTER_RE = /^[\s,:–—-]*(?:\(\s*)?(?:candidate|candidacy|exam(?:s|ination)?|eligible|eligibility|in[\s-]progress|track|student|trainee|expected|anticipated|pending|coursework|prep(?:aration)?|parts?\s+(?:passed|remaining))\b/i;
const CERT_NOT_HELD_BEFORE_RE = /(?:pursuing|studying\s+for|preparing\s+for|candidate\s+for|working\s+towards?|eligible\s+for|enrolled\s+in|sitting\s+for|registered\s+for)\s+(?:the\s+|a\s+|an\s+)?$/i;
function certNotHeld(text, index, length) {
    const after = text.slice(index + length, index + length + 40);
    const before = text.slice(Math.max(0, index - 40), index);
    return CERT_NOT_HELD_AFTER_RE.test(after) || CERT_NOT_HELD_BEFORE_RE.test(before);
}
const GPA_RE = /\bgpa\b[:\s]*(\d\.\d{1,2})|\b(\d\.\d{1,2})\s*(?:\/\s*4(?:\.0)?\s*)?gpa\b/i;
const CERT_RE = /\b(food\s+handler'?s?\s+(?:card|permit|certificat\w+)|servsafe|tips\s+certif\w+|forklift\s+(?:certif\w+|licen[sc]e[ds]?)|osha\s+(?:10|30)|cpr(?:\s*\/\s*first\s+aid)?|first\s+aid|guard\s+card|tabc|bls\b|cdl(?:\s+class\s+[abc])?|aws certified|pmp|cpa|cfa|cissp|comptia|scrum master|six sigma|notary|certifi(?:ed|cation)|licensed?)\b/gi;
// Long units first, and a unit must end at a word boundary: "20 months" → "20 months", never "20 m".
const METRIC_RE = /(\$?\d[\d,]*(?:\.\d+)?\+?\s*(?:%|percent|million|billion|months?|years?|weeks?|days?|hours?|customers?|clients?|members?|guests?|tickets?|calls?|orders?|deliveries|vehicles?|transactions?|users?|accounts?|reports?|employees?|hires?|people|items?|units?|stores?|sku|skus|k\b|m\b|x\b)|\btop\s+\d+\s+of\s+\d+\b|\b\d+\s+of\s+\d+\s+(?:months?|weeks?|shifts?|quarters?)\b)/gi;
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
const DATE_TOKEN = String.raw`(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s*\d{4}|(?:0?[1-9]|1[0-2])\/\d{2,4}|(?:19|20)\d{2})`;
const DATE_RANGE_RE = new RegExp(`(${DATE_TOKEN})\\s*(?:-|–|—|to|until)\\s*(present|current|now|today|${DATE_TOKEN})`, 'i');
const SUPERVISE_RE = /\b(?:supervis(?:ed|ing|e)|managed\s+(?:a\s+)?(?:team|staff|crew|\d+\s+(?:employees|associates|people|staff|reps|agents))|led\s+(?:a\s+)?(?:team|crew|staff)\s+of|direct\s+reports|hired\s+and\s+(?:trained|managed)|people\s+manager)\b/i;

// ── People-management evidence (G 2026-11-10: "Hire, schedule and train a crew of 14" and "Lead a team of 8 support
// agents… weekly 1:1s" were told "your résumé shows none") ─────────────────────────────────────────────────────
// A title that manages people. Titles that carry "manager"/"lead" without managing people are excluded.
export const MGMT_TITLE_RE = /\b(?:manager|supervisor|lead|head|chief|foreman|forewoman|superintendent|director|captain|charge\s+nurse|crew\s+chief|sous\s+chef|executive\s+chef|head\s+chef|chef\s+de\s+cuisine|keyholder|key\s+holder|president|owner|vp|vice\s+president|principal\s+(?:of|at)|store\s+leader|team\s+leader)\b/i;
export const NOT_PEOPLE_MANAGER_TITLE_RE = /\b(?:account|product|project|program|case|territory|portfolio|community|social\s+media|content|brand|marketing|customer\s+success|client\s+success|relationship|partner|engagement|campaign|asset|property|category|channel|lead\s+(?:generation|generator))\s+(?:manager|lead|director)\b|\blead\s+(?:generator|generation)\b/i;
// A bullet that runs people: leads/manages/supervises a team/crew/staff, "a team of N", hires, schedules people, 1:1s,
// performance reviews, direct reports.
export const MGMT_BULLET_RE = /\b(?:led|lead|leads|leading|managed|manage|manages|managing|supervised|supervise|supervises|supervising|oversaw|oversee|oversees|overseeing|directed|direct|directs|ran|run|runs)\s+(?:a\s+|an\s+|the\s+|my\s+|our\s+)?(?:[\w/-]+\s+){0,3}?(?:team|teams|crew|crews|staff|shift|shifts|department|store|kitchen|line|group|unit|associates|employees|technicians|cashiers|drivers|reps|agents|engineers|nurses|apprentices|installers|workers|cooks|servers)\b|\b(?:team|crew|staff)\s+of\s+(?:up\s+to\s+)?\d+|\bdirect\s+reports?\b|\b(?:hire|hired|hires|hiring)\b[^.\n]{0,40}\b(?:train|trained|schedule|scheduled|staff|crew|team|cooks?|associates?|agents?|employees)\b|\b1:1s?\b|\bone-on-ones?\b|\bperformance\s+(?:reviews?|evaluations?|appraisals?)\b|\bschedul\w*\s+(?:and\s+\w+\s+)?(?:a\s+|the\s+)?(?:\d+\+?\s+)?(?:crew|staff|team|employees|associates|cashiers|agents|nurses)\b|\bpeople\s+manager\b/i;
// A lead DUTY short of managing: training, coaching, mentoring or precepting people.
export const LEAD_DUTY_RE = /\b(?:trained|train|trains|coached|coach|coaches|coaching|mentored|mentor|mentors|mentoring|precepted|precept|onboarded|onboard)\b(?![^.\n]{0,12}\b(?:on|in)\s+(?:my|our)\s+own)/i;
/** Does a role (title + bullets) show people management? `strong` = a manager title or a people bullet; `duty` = a lead duty only. */
export const HEAD_ROLE_RE = /\b(?:executive|head|sous)\s+chef\b|\bchef\s+de\s+cuisine\b|\bhead\s+(?:cook|nurse|teacher|of\s+\w+)\b|\bforem[ae]n\b|\bsuperintendent\b|\bcharge\s+nurse\b|\bgeneral\s+manager\b|\bowner(?:\s*\/\s*operator)?\b|\bdirector\b|\bcrew\s+chief\b/i;
export function managementEvidence(role) {
    const title = String(role && role.title || '');
    // a head-of title leads people by definition: an executive chef runs the kitchen (G5)
    const titled = !!title && ((MGMT_TITLE_RE.test(title) && !NOT_PEOPLE_MANAGER_TITLE_RE.test(title) && !/\bassistant\s+to\b/i.test(title)) || HEAD_ROLE_RE.test(title));
    const bullets = (role && role.bullets) || [];
    // "Supervise and train 6 RBTs", "managed 12 technicians": a lead verb over a counted group of people (G5)
    const lines = bullets.filter((b) => MGMT_BULLET_RE.test(b) || /\b(?:[Ss]upervis\w*|[Mm]anag(?:e|ed|es|ing)|[Ll]ed|[Ll]ead|[Oo]versaw|[Oo]versee\w*)\b[^.;\n]{0,24}?\b\d{1,3}\+?\s+(?:[A-Za-z][\w-]*\s+){0,2}(?:[A-Z]{2,5}s|(?:associates|employees|technicians|staff|people|workers|agents|cashiers|nurses|aides|tutors|teachers|drivers|cooks|servers|reps|representatives|engineers|developers|analysts|specialists|coordinators|assistants))\b/.test(b));
    const duty = bullets.filter((b) => !MGMT_BULLET_RE.test(b) && LEAD_DUTY_RE.test(b));
    return { strong: titled || lines.length > 0, titled, lines, duty };
}

function uniqueByLabel(facts) {
    const seen = new Map();
    const out = [];
    for (const f of facts) {
        const key = `${f.factType}:${f.normalizedLabel}`;
        const prev = seen.get(key);
        if (prev !== undefined) {
            // Same skill reached through an alias — keep whichever occurrence is a real bullet.
            if (out[prev].evidenceKind !== 'bullet' && f.evidenceKind === 'bullet') out[prev] = f;
            continue;
        }
        seen.set(key, out.length);
        out.push(f);
    }
    return out;
}
function lineContaining(text, index) {
    const start = text.lastIndexOf('\n', index) + 1;
    let end = text.indexOf('\n', index);
    if (end === -1) end = text.length;
    return text.slice(start, end).trim().slice(0, 240);
}

// ── Where in the résumé a line lives ────────────────────────────────────────────────────
// Only an experience bullet is a claim a rewrite may stand on — the summary sentence and the
// skills list are NOT bullets. Every skill fact carries `evidenceKind` and prefers a 'bullet'.
const SECTION_RE = [
    { kind: 'summary', re: /^\s*(professional\s+)?(summary|objective|profile|about( me)?)\b/i },
    { kind: 'skills', re: /^\s*(technical\s+|core\s+|key\s+)?(skills|competencies|proficiencies|technologies|tools)\b/i },
    // "NURSING EXPERIENCE", "MILITARY EXPERIENCE", "WHAT I'VE BUILT" — a short heading whose words end on experience (G5)
    { kind: 'experience', re: /^\s*(?:(work\s+|professional\s+|relevant\s+|additional\s+|employment\s+)?(experience|employment|work history|history)\b|(?:[A-Za-z&/'’-]+\s+){1,3}(?:experience|employment|history)\s*:?\s*$|what\s+i(?:'|’)ve\s+(?:built|done)\b)/i },
    { kind: 'education', re: /^\s*(education|academic)\b/i },
    { kind: 'other', re: /^\s*(certifications?|licenses?|license\s*\/\s*certs?|certs|credentials|projects|portfolio|awards|volunteer\w*|references|languages|interests|availability)\b/i },
];
const BULLET_LINE_RE = /^\s*[•\-*▪◦·‣–—]\s+/;
// (G 2026-11-10: + Electrician, Executive, RN, Chef, Handler, Operator… — "Journeyman Electrician — Sunbelt Electric",
// "Account Executive — Freightly" and "Home Health RN — Amedisys" read as no title, so their years counted toward no field)
const TITLE_NOUN_RE = /\b(Counselor|Tutor|Mentor|Guard|Rep|NCOIC|NCO|Custodian|Producer|Underwriter|Adjuster|Paralegal|Aide|Engineer|Developer|Manager|Director|Analyst|Specialist|Representative|Associate|Coordinator|Lead|Designer|Consultant|Administrator|Technician|Clerk|Driver|Cashier|Nurse|Assistant|Supervisor|Agent|Officer|Attendant|Barista|Server|Host|Hostess|Stocker|Picker|Packer|Courier|Receptionist|Teller|Cook|Crew Member|Team Member|Member|Merchandiser|Guard|Advisor|Planner|Recruiter|Generalist|Accountant|Bookkeeper|Writer|Editor|Teacher|Tutor|Intern|Owner|Founder|President|Electrician|Executive|RN|LPN|LVN|CNA|Chef|Handler|Operator|Mechanic|Installer|Apprentice|Foreman|Superintendent|Instructor|Trainer|Coach|Therapist|Paramedic|EMT|Pharmacist|Programmer|Architect|Scientist|Captain|Worker|Aide|Caregiver|Dispatcher|Auditor|Controller|Keyholder|Busser|Dishwasher|Bartender|Welder|Machinist|Plumber|Carpenter|Estimator|Paralegal|Secretary|Stylist|Colorist|Barber|Cosmetologist|Esthetician|Aesthetician|Manicurist|Artist|Principal|Dean|Registrar|Librarian|Superintendent)\b/;
const HEADER_SPLIT_RE = /\s+[—–|]\s+|\s+-\s+|\s*,\s+|\s+@\s+|\s+at\s+/;
const SENTENCE_VERB_RE = /^(led|managed|built|created|developed|designed|implemented|resolved|handled|delivered|processed|coordinated|trained|reduced|increased|improved|maintained|operated|scheduled|documented|served|assisted|drove|parked|reconciled|analyzed|scanned|picked|packed|sold|advised|greeted|supported|answered|provided|prepared|completed|achieved|exceeded|oversaw|supervised|organized|planned|negotiated|closed|generated|recruited|onboarded|audited|tracked|restocked|stocked|cleaned|inspected|installed|repaired|tested|wrote|taught|cared|monitored|dispatched|loaded|unloaded|counted)\b/i;

/** The title segment of a role header line ("Membership Specialist — UFC Gym, Phoenix" → "Membership Specialist"). */
export function titleFromHeader(line) {
    const clean = String(line || '').replace(BULLET_LINE_RE, '').replace(DATE_RANGE_RE, '').trim();
    const pieces = clean.split(HEADER_SPLIT_RE).map((x) => x.trim()).filter(Boolean);
    let first = (pieces[0] || '').trim();
    // employer first ("Amazon Fulfillment Center DFW7 — Fulfillment Associate (Tier 1)", "U.S. ARMY — 17C Cyber Operations
    // Specialist"): the piece that carries a title noun is the title (G5)
    if (first && !TITLE_NOUN_RE.test(first)) { const alt = pieces.slice(1, 3).find((x) => TITLE_NOUN_RE.test(x) && x.length <= 60 && /^[A-Z0-9]/.test(x)); if (alt) first = alt.replace(/^\d{2}[A-Z]\s+/, ''); }
    if (!first || first.length > 60 || !TITLE_NOUN_RE.test(first)) return null;
    if (!/^[A-Z]/.test(first)) return null;
    return first.replace(/[\s,;:–—-]+$/, '');
}

/** Every résumé line with its kind (header / summary / skills / education / other / bullet / role) and section. */
export function resumeLineInfo(text) { return classifyLines(joinWrappedRanges(String(text || ''))); }
function classifyLines(text) {
    const lines = text.split('\n');
    const out = [];
    let section = 'header';
    let offset = 0;
    for (const raw of lines) {
        const line = raw.trim();
        const start = offset;
        offset += raw.length + 1;
        let kind = 'other';
        const sec = SECTION_RE.find(({ re }) => re.test(line) && line.length < 40);
        if (sec) { section = sec.kind; kind = 'header'; }
        else if (!line) kind = 'other';
        else if (section === 'summary') kind = 'summary';
        else if (section === 'skills') kind = 'skills';
        else if (section === 'education') kind = 'education';
        else if (section === 'other') kind = 'other';
        else if (BULLET_LINE_RE.test(raw)) kind = 'bullet';
        else if (DATE_RANGE_RE.test(line) || (titleFromHeader(line) && line.length < 130)) kind = 'role';
        else if (section === 'experience' && SENTENCE_VERB_RE.test(line)) kind = 'bullet';
        else if (section === 'header') kind = /^[^a-z]*$/i.test(line) || line.length < 25 ? 'other' : (SENTENCE_VERB_RE.test(line) ? 'bullet' : 'summary');
        out.push({ start, end: start + raw.length, kind, section, text: line });
    }
    return out;
}
function lineAt(lineInfo, index) {
    return lineInfo.find((l) => index >= l.start && index <= l.end) || null;
}

// Evidence for a hit: a bullet is its own line (a literal span of the résumé — rewrites stand on
// it); anything else is the SENTENCE it sits in, with the paragraph's wrapped lines re-joined.
function evidenceFor(text, lineInfo, index) {
    const at = lineAt(lineInfo, index);
    if (!at) return lineContaining(text, index);
    if (at.kind === 'bullet' || at.kind === 'role' || at.kind === 'skills') return at.text.slice(0, 240);
    // the paragraph: contiguous non-empty lines of the same kind
    const i = lineInfo.indexOf(at);
    let a = i, b = i;
    while (a > 0 && lineInfo[a - 1].kind === at.kind && lineInfo[a - 1].text) a--;
    while (b < lineInfo.length - 1 && lineInfo[b + 1].kind === at.kind && lineInfo[b + 1].text) b++;
    const parts = lineInfo.slice(a, b + 1);
    let joined = '';
    let mapped = 0;
    for (const p of parts) {
        const raw = text.slice(p.start, p.end);
        const lead = raw.length - raw.trimStart().length;
        // a line that ends in a hyphen continues the word on the next line ("full-\ntime")
        const sep = joined ? (/[A-Za-z]-$/.test(joined) ? '' : ' ') : '';
        joined += sep;
        if (p === at) mapped = joined.length + Math.max(0, index - p.start - lead);
        joined += p.text;
    }
    let s = Math.max(0, Math.min(mapped, joined.length - 1));
    let e = s;
    while (s > 0 && !/[.!?;•·]/.test(joined[s - 1])) s--;
    while (e < joined.length && !/[.!?;•·]/.test(joined[e])) e++;
    return joined.slice(s, Math.min(joined.length, e + 1)).replace(/^[\s•·\-–*]+/, '').trim().slice(0, 240);
}

/** THE résumé date reader (G5): a month index from any token a person writes — "Jan 2020", "Sept. 2019", "01/2020",
 *  "2020" (mid-year), present / current / now / today. Used by rolesFromText (every years gate and sentence) and by
 *  lib/resume/years.js coveredMonths (supportedYears). */
export function dateTokenMonth(tok, end = false, now = null) { return monthIndex(tok, end, now); }
function monthIndex(tok, end = false, now = null) {
    const t = String(tok || '').toLowerCase().trim();
    if (/^(present|current|now|today)$/.test(t)) { const d = now instanceof Date ? now : new Date(); return d.getUTCFullYear() * 12 + d.getUTCMonth(); }
    let m = t.match(/^([a-z]+)\.?\s*(\d{4})$/);
    if (m && MONTHS[m[1].slice(0, 4)] !== undefined) return Number(m[2]) * 12 + MONTHS[m[1].slice(0, 4)];
    if (m && MONTHS[m[1].slice(0, 3)] !== undefined) return Number(m[2]) * 12 + MONTHS[m[1].slice(0, 3)];
    m = t.match(/^(\d{1,2})\/(\d{2,4})$/);
    if (m) { const y = Number(m[2].length === 2 ? `20${m[2]}` : m[2]); return y * 12 + Number(m[1]) - 1; }
    m = t.match(/^(\d{4})$/);
    // a bare year is mid-year (July in, June out), the same convention as lib/resume/years.js coveredMonths: "2019 – 2020"
    // is about one year, not two (coordinator G2: a years sentence summed to 8 for roles that add up to about 7)
    if (m) return Number(m[1]) * 12 + (end ? 5 : 6);
    return null;
}

// A date range the PDF wrapped across two lines ("…, Chicago, IL Jan 2025 –\nAug 2025") is one
// range: Tasha's internship had no dates at all, so it counted toward nothing (2026-10-25).
const WRAPPED_RANGE_RE = new RegExp(`(${DATE_TOKEN})\\s*(-|–|—|to)\\s*\\n\\s*(?=(?:present|current|now|${DATE_TOKEN})\\s*$)`, 'gim');
export function joinWrappedRanges(text) {
    return String(text || '').replace(WRAPPED_RANGE_RE, '$1 $2 ');
}

/** Roles with their date span (months), title and the bullets under them. `now` = the date "Present" means (tests pass it). */
export function rolesFromText(text, { now = null } = {}) {
    text = joinWrappedRanges(text);
    const lineInfo = classifyLines(text);
    const roles = [];
    let cur = null;
    for (const l of lineInfo) {
        if (l.kind === 'role') {
            const dm = l.text.match(DATE_RANGE_RE);
            // a season and year ("Summer 2024", "Summers 2025 & 2026", "Fall 2023"): three months a season (G5)
            const sm = !dm ? l.text.match(/\b(summers?|spring|fall|autumn|winter)\s+((?:19|20)\d\d)(?:\s*(?:&|and|,|\/)\s*((?:19|20)\d\d))?/i) : null;
            const title = titleFromHeader(l.text);
            if (sm && title) {
                const start = { summer: 5, spring: 2, fall: 8, autumn: 8, winter: 11 }[sm[1].toLowerCase().replace(/s$/, '')];
                const count = sm[3] ? 2 : 1;
                const from = Number(sm[2]) * 12 + start;
                cur = { title, header: l.text, from, to: from + 3 * count - 1, approx: true, seasonal: count, bullets: [] };
                roles.push(cur);
                continue;
            }
            if (dm || title) {
                let from = dm ? monthIndex(dm[1], false, now) : null;
                let to = dm ? monthIndex(dm[2], true, now) : null;
                const approx = !!dm && (/^\s*\d{4}\s*$/.test(dm[1]) || /^\s*\d{4}\s*$/.test(dm[2]));
                // "2020 – 2020" (or a bare start year with an end month earlier in the same year): a part of that year
                if (from != null && to != null && to < from && Math.floor(from / 12) === Math.floor(to / 12)) { from = Math.floor(from / 12) * 12 + 3; to = from + 5; }
                // a date-only line right after a title line belongs to that role
                if (cur && !title && dm && cur.from == null) { cur.from = from; cur.to = to; cur.approx = approx; continue; }
                cur = { title: title || '', header: l.text, from, to, approx, bullets: [] };
                roles.push(cur);
                continue;
            }
        }
        if (l.kind === 'bullet' && cur) cur.bullets.push(l.text);
    }
    // a "role" with no dates and nothing under it is a header line ("Rebecca Lyle, RN", "DEVON PARK — Staff UI Engineer")
    return roles.filter((r) => r.from != null || r.to != null || r.bullets.length);
}

function mergedMonths(spans) {
    const s = spans.filter((x) => x.from != null && x.to != null && x.to >= x.from).sort((a, b) => a.from - b.from);
    let total = 0, curFrom = null, curTo = null;
    for (const x of s) {
        if (curTo == null || x.from > curTo + 1) { if (curTo != null) total += curTo - curFrom + 1; curFrom = x.from; curTo = x.to; }
        else curTo = Math.max(curTo, x.to);
    }
    if (curTo != null) total += curTo - curFrom + 1;
    return total;
}

// The domain a years requirement is about: "3+ years of experience in email marketing
// operations, CRM administration, or marketing operations" → ['email', 'marketing', 'crm']. Words
// that name no field (operations, administration, experience, related…) are dropped; an empty
// list means the requirement is about experience of any kind.
// Words that qualify a requirement without naming a field ("2+ years of knowledge of commercial
// health plans" is about commercial health plans, not about "knowledge"; Maria's paid result read
// "knowledg / commercial", round 3) are generic too — both their surface form and their stem.
const DOMAIN_GENERIC = new Set(['experience', 'experienc', 'operation', 'administration', 'administr', 'related', 'relat', 'similar', 'equivalent', 'equival', 'field', 'role', 'position', 'setting', 'environment', 'environ', 'industry', 'professional', 'profession', 'work', 'working', 'job', 'year', 'the', 'and', 'or', 'a', 'an', 'of', 'in', 'with', 'as', 'at', 'for', 'similar', 'relevant', 'relev', 'progressive', 'progress', 'hands-on', 'direct', 'prior', 'minimum', 'least', 'plus', 'etc', 'other', 'any', 'combination', 'combin', 'including', 'includ', 'such', 'area', 'function', 'capacity', 'level',
    'knowledge', 'knowledg', 'understanding', 'understand', 'familiarity', 'familiar', 'proven', 'demonstrated', 'demonstrat', 'demonstrabl', 'strong', 'solid', 'track', 'background', 'skill', 'ability', 'abil', 'expertise', 'expertis', 'proficiency', 'profici', 'proficient', 'hands', 'previous', 'recent', 'successful', 'applicable', 'applic', 'required', 'requir', 'preferred', 'prefer', 'overall', 'general', 'total', 'cumulative', 'cumul', 'verifiable', 'verifi', 'documented', 'document', 'paid', 'exposure', 'exposur', 'practical', 'practic', 'extensive', 'extens', 'significant', 'signific', 'substantial', 'substanti', 'relevant', 'specific', 'comparable', 'compar', 'current', 'ongoing', 'full-time', 'part-time', 'post-graduate', 'post', 'graduate', 'graduat']);
// The domain text of a years sentence: the clause after "years … experience in/with" or between
// "years of" and "experience".
export function yearsDomainClause(sentence) {
    const m = String(sentence || '').match(/\byears?\b[^.;]*?\b(?:experience|work(?:ing)?)\s+(?:in|with|as|on|doing|across|supporting|within)\s+([^.;]+)/i)
        || String(sentence || '').match(/\byears?\s+(?:of\s+)?([a-z][a-z /&,+-]{2,60}?)\s+experience\b/i);
    return m ? m[1] : '';
}
/**
 * The domain of a years requirement as `{ stems, words }`: `stems` are what matching uses
 * (relevantExperienceYears compares stems), `words` are the sentence's own words, lower-cased, in
 * order, one per stem — the ONLY form a message may print. A stem ("knowledg", "navigat") is never
 * shown to a person.
 */
export function yearsDomain(sentence) {
    const clause = yearsDomainClause(sentence).replace(/\btrack\s+records?\b/gi, ' ');
    if (!clause) return { stems: [], words: [] };
    const stems = [];
    const words = [];
    for (const t of tokenize(clause)) {
        const st = t.stem;
        if (st.length < 2 || DOMAIN_GENERIC.has(st) || DOMAIN_GENERIC.has(t.raw) || /^\d/.test(st) || stems.includes(st)) continue;
        stems.push(st);
        words.push(t.raw);
        if (stems.length >= 8) break;
    }
    return { stems, words };
}
export function domainOfYearsSentence(sentence) {
    return yearsDomain(sentence).stems;
}
/** The same domain as the sentence's own words ("commercial", "navigating") — for messages. */
export function domainWordsOfYearsSentence(sentence) {
    return yearsDomain(sentence).words;
}

/**
 * Years of experience in roles whose title or bullets name the domain (each calendar month once).
 * With no domain terms, every role counts.
 */
export function relevantExperienceYears(resumeText, domainStems, { jobFamily = null } = {}) {
    const roles = rolesFromText(String(resumeText || ''));
    const want = (domainStems || []).filter(Boolean);
    // A role counts when it names the domain, or when its title is in the posting's own field
    // ("Backend Engineer" for "software development experience").
    const sameField = (r) => !!jobFamily && jobFamily !== 'general' && !!r.title && detectRoleFamily(r.title, '').family === jobFamily;
    const relevant = !want.length ? roles : roles.filter((r) => {
        const stems = new Set(tokenize([r.title, r.header, ...r.bullets].join(' ')).map((t) => t.stem));
        return want.some((w) => stems.has(w)) || sameField(r);
    });
    return { years: mergedMonths(relevant) / 12, roles: relevant.map((r) => r.title).filter(Boolean) };
}

function titleRank(title) {
    for (const { re, not, level } of SENIORITY_TITLE) if (re.test(title) && !(not && not.test(title))) return LEVEL_RANK[level];
    return HOURLY_TITLE_RE.test(title) ? 1 : 2;
}

export function extractResumeFacts(resumeText, taxonomy = BUILTIN_TAXONOMY) {
    const text = joinWrappedRanges(String(resumeText || ''));
    if (!text.trim())
        return [];
    const facts = [];
    const lineInfo = classifyLines(text);
    const toks = tokenize(text);

    // ── Skills & tools (dictionary + alias match, by stem) ──
    const phrases = [...new Set([...KNOWN_SKILLS, ...Object.keys(taxonomy.aliases)])];
    for (const phrase of phrases) {
        const stems = stemPhrase(phrase);
        if (!stems.length) continue;
        let hits = findStemmed(toks, stems);
        if (!hits.length) continue;
        const normalized = normalizeSkill(phrase, taxonomy);
        if (!normalized) continue;
        // verb-shaped tokens are a tool only with a tool cue on their own line ("excel at" ≠ Excel)
        const cue = AMBIGUOUS_TOKENS[normalized];
        // (a capitalised "Go" / "REST" mid-line is the language / the API style: "Built Go services")
        if (cue) hits = hits.filter((h) => cue.test(lineContaining(text, h.start)) || /^(?:microsoft|ms)\s/i.test(phrase)
            || (normalized === 'go' && text.slice(h.start, h.end) === 'Go' && !/^[\s•\-*]*$/.test(text.slice(text.lastIndexOf('\n', h.start) + 1, h.start)))
            || (normalized === 'rest' && /^REST/.test(text.slice(h.start, h.end))));
        // A word inside an EMPLOYER's name is not a skill: "Cox Communications" is not
        // communication (Maria, 2026-10-25). On a role header, a capitalised hit after the title
        // separator ("Title — Employer", "Title at Employer", "Title, Employer") is skipped.
        hits = hits.filter((h) => {
            const at = lineAt(lineInfo, h.start);
            if (!at || !(at.kind === 'role' || (at.kind === 'other' && at.section === 'experience'))) return true;
            const lineStart = at.start + (text.slice(at.start, at.end).length - text.slice(at.start, at.end).trimStart().length);
            const before = text.slice(lineStart, h.start);
            const word = text.slice(h.start, h.end);
            // (G 2026-11-10: lower case too — "Account Executive — Freightly (logistics SaaS)" proved "inventory management"
            // through "logistics", a word describing the employer)
            return !(/\s(?:—|–|-|\||@|at)\s|,\s/.test(before) && (/^[A-Z]/.test(word) || /\s(?:—|–|\||@|at)\s/.test(before)));
        });
        if (!hits.length) continue;
        const kinds = hits.map((h) => (lineAt(lineInfo, h.start) || { kind: 'other' }).kind);
        // the first bullet that DID the thing; a bullet that trained others on it is evidence only when no other
        // bullet names it (round 7, Maria: "cash handling ← Trained 30+ new hires on POS, cash handling…" while
        // "Processed … 200+ transactions per shift with accurate cash handling" sat below)
        const teaches = (h) => { const at = lineAt(lineInfo, h.start); return !!at && /^[\s•●▪◦*·\-–—]*(?:trained|certified|taught|coached|onboarded|mentored)\b/i.test(text.slice(at.start, at.end)); };
        const doing = kinds.findIndex((k, i) => k === 'bullet' && !teaches(hits[i]));
        const bulletAt = doing >= 0 ? doing : kinds.indexOf('bullet');
        // then the job title, then the skills list, then a summary — never an objective while anything else names it
        // ("warehouse ← Hard working and dependable warehouse professional looking for a lead role", judge optimize #5)
        const objective = (h) => { const at = lineAt(lineInfo, h.start); return !!at && (at.kind === 'summary' || at.section === 'header') && /\b(?:looking\s+for|seeking|to\s+obtain|objective|hard[- ]?working|team\s+player|where\s+i\s+can)\b/i.test(text.slice(at.start, at.end)); };
        const order = ['role', 'skills', 'summary', 'other', 'education'];
        let pick = bulletAt;
        for (const k of order) { if (pick >= 0) break; pick = kinds.findIndex((x, i) => x === k && !objective(hits[i])); }
        if (pick < 0) pick = 0;
        const idx = hits[pick].start;
        const factType = isTool(normalized) ? 'tool' : 'skill';
        facts.push({
            factType,
            label: phrase,
            normalizedLabel: normalized,
            evidenceText: evidenceFor(text, lineInfo, idx),
            evidenceKind: kinds[pick],
            confidence: 0.9,
        });
    }

    // Leadership is shown by leading: a line that led, supervised or managed a team is the fact, whether or
    // not the word "leadership" appears (round 6, Ray: a Warehouse Lead with "Led 2nd shift team of 15" was told
    // to "write a bullet for leadership")
    if (!facts.some((f) => f.normalizedLabel === 'leadership')) {
        const LEAD_RE = /\b(?:led|lead|leading|supervised|supervising|managed|managing|oversaw|overseeing|ran|running)\s+(?:a\s+|the\s+|an?\s+|my\s+)?(?:[\w-]+\s+){0,3}(?:teams?|crews?|staff|shifts?|department|store|associates|employees|technicians|cashiers|drivers|reps|agents|engineers|nurses|apprentices|installers|workers)\b/i;
        const line = lineInfo.find((l) => l.kind === 'bullet' && (LEAD_RE.test(l.text || '') || SUPERVISE_RE.test(l.text || '')));
        if (line) facts.push({ factType: 'skill', label: 'leadership', normalizedLabel: 'leadership', evidenceText: String(line.text || '').trim().slice(0, 240), evidenceKind: 'bullet', confidence: 0.8 });
    }

    // ── Roles: titles, seniority, total and supervisory experience ──
    const roles = rolesFromText(text);
    let maxRank = 0;
    for (const r of roles) {
        if (r.title) {
            facts.push({ factType: 'title', label: r.title, normalizedLabel: canonicalText(r.title), evidenceText: r.header.slice(0, 240), confidence: 0.75 });
            maxRank = Math.max(maxRank, titleRank(r.title));
        }
    }
    // a résumé with no role headers (a pasted paragraph): read seniority words from the text
    if (!maxRank) {
        for (const { re, not, level } of SENIORITY_TITLE) {
            if (re.test(text) && !(not && not.test(text))) { maxRank = LEVEL_RANK[level]; break; }
        }
    }
    if (maxRank) {
        const level = Object.keys(LEVEL_RANK).find((k) => LEVEL_RANK[k] === maxRank);
        facts.push({ factType: 'seniority', label: level, normalizedLabel: `seniority:${level}`, evidenceText: '', confidence: 0.7 });
    }
    const totalMonths = mergedMonths(roles);
    // people management: a manager / supervisor / lead title, or a bullet that leads, hires, schedules or reviews people —
    // never a "Staff Accountant" or an "Account Manager" (G 2026-11-10)
    const mgmtMonths = mergedMonths(roles.filter((r) => managementEvidence(r).strong));
    if (totalMonths) facts.push({ factType: 'experience', label: `${Math.round(totalMonths / 12 * 10) / 10} years`, normalizedLabel: 'experience:total', value: totalMonths / 12, evidenceText: '', confidence: 0.7 });
    facts.push({ factType: 'experience', label: `${Math.round(mgmtMonths / 12 * 10) / 10} years supervisory`, normalizedLabel: 'experience:management', value: mgmtMonths / 12, evidenceText: '', confidence: 0.7 });

    // ── Education (real degree phrases only) + GPA ──
    let em;
    DEGREE_RE.lastIndex = 0;
    while ((em = DEGREE_RE.exec(text)) !== null) {
        const label = (em[1] || em[0]).replace(/\s+/g, ' ');
        const line = lineContaining(text, em.index);
        const before = line.slice(0, Math.max(0, line.toLowerCase().indexOf(label.toLowerCase())));
        if (UNFINISHED_RE.test(before) || degreeInProgress(line)) continue;
        facts.push({ factType: 'education', label, normalizedLabel: `education:${canonicalText(label)}`, rank: degreeRank(label), evidenceText: lineContaining(text, em.index), confidence: 0.8 });
    }
    const gpa = text.match(GPA_RE);
    if (gpa) facts.push({ factType: 'gpa', label: gpa[1] || gpa[2], normalizedLabel: 'gpa', value: Number(gpa[1] || gpa[2]), evidenceText: lineContaining(text, gpa.index), confidence: 0.8 });

    // ── Certifications ──
    let cm;
    CERT_RE.lastIndex = 0;
    while ((cm = CERT_RE.exec(text)) !== null) {
        if (certNotHeld(text, cm.index, cm[0].length)) continue;
        facts.push({ factType: 'certification', label: cm[1], normalizedLabel: `cert:${canonicalText(cm[1])}`, evidenceText: lineContaining(text, cm.index), confidence: 0.65 });
    }

    // ── Metrics (real numbers from the résumé — the ONLY numbers we may ever reuse) ──
    let mm;
    METRIC_RE.lastIndex = 0;
    while ((mm = METRIC_RE.exec(text)) !== null) {
        facts.push({ factType: 'metric', label: mm[1].trim(), normalizedLabel: `metric:${canonicalText(mm[1])}`, evidenceText: lineContaining(text, mm.index), confidence: 0.8 });
    }
    return uniqueByLabel(facts);
}

/** 1 high school · 2 associate · 3 bachelor · 4 master · 5 doctorate · 0 unknown. */
export function degreeRank(label) {
    const l = String(label || '').toLowerCase().replace(/\./g, '');
    if (/phd|ph d|doctorate|doctor of/.test(l)) return 5;
    if (/master|^mba$|^m ?(?:a|s|sc|ed)$/.test(l)) return 4;
    if (/^m ?s ?n$|^(?:msw|mfa|mph|mpa)$/.test(l)) return 4;
    if (/^(?:bsw|bba|bfa|bsee|bsme|bsce|bscs|beng|b eng|bcom|b com|ab)$/.test(l)) return 3;
    if (/bachelor|^b ?(?:a|s|sc|ba|sn|ed)$/.test(l)) return 3;
    if (/associate|^aas?$|^as$/.test(l)) return 2;
    if (/high school|ged|diploma/.test(l)) return 1;
    return 0;
}

// Tools are concrete named software/equipment; everything else is a skill. Used only for
// fact_type tagging — matching treats them the same.
const TOOL_SET = new Set([
    'javascript', 'typescript', 'python', 'java', 'c#', 'c++', 'go', 'ruby', 'php', 'swift', 'kotlin', 'rust',
    'react', 'angular', 'vue', 'node.js', 'next.js', 'express', 'django', 'flask', 'rails', 'spring',
    'sql', 'postgresql', 'mysql', 'mongodb', 'redis', 'graphql', 'aws', 'google cloud', 'azure',
    'docker', 'kubernetes', 'terraform', 'git', 'tableau', 'power bi', 'excel', 'microsoft word',
    'microsoft powerpoint', 'google workspace', 'microsoft office', 'salesforce', 'quickbooks', 'sap', 'point of sale', 'forklift',
    'rf scanner', 'pallet jack',
]);
export function isTool(normalized) {
    return TOOL_SET.has(normalized);
}
// Convenience: just the normalized skill/tool labels present in the résumé.
export function resumeSkillLabels(facts) {
    return [...new Set(facts.filter((f) => f.factType === 'skill' || f.factType === 'tool').map((f) => f.normalizedLabel))];
}
// Highest seniority rank found in the résumé's role titles (0 if none).
export function resumeSeniorityRank(facts) {
    let max = 0;
    for (const f of facts) if (f.factType === 'seniority') max = Math.max(max, LEVEL_RANK[f.label] || 0);
    return max;
}

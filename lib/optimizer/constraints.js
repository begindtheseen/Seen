// Structured posting constraints vs the résumé — the HARD GATES a recruiter or an ATS knock-out
// question applies before any keyword is read (2026-10-24 ATS audit, D3; recruiter R1/R5/R6).
//
// Each constraint from postingSections.extractConstraints is judged against the résumé facts:
//   status 'met'      — the résumé states it (degree rank, measured years, a named certification…)
//   status 'unmet'    — the résumé shows it is not met (an Associate of Arts against a required
//                       Bachelor's; 0 supervisory years against "6+ years managing a team")
//   status 'ask'      — the résumé cannot say either way (availability, lifting, age, a GPA it does
//                       not list): a yes/no for the person, never a "missing keyword"
// A constraint with gate:true whose status is 'unmet' and whose kind is a credential, years,
// management or seniority requirement caps the fit score (GATE_CAP) and is the first line of
// every explanation. Nothing here invents a fact: 'ask' is the honest answer when the résumé is
// silent.
import { escapeRegExp } from '../text/escapeRegExp.js';
import { hasStemmed } from './lemma.js';
import { credentialHeld } from './credentials.js';
import { DEGREE_LABEL } from './postingSections.js';
import { yearsDomain, yearsDomainClause, NOT_PEOPLE_MANAGER_TITLE_RE } from './extractResumeFacts.js';
import { US_STATES, STATE_ABBR } from './postingSections.js';
import { experienceProfile } from '../resume/years.js';
import { roleField, titleField, fieldLabel, areAdjacent, postingField, FIELDS, roleDuties, isNewGradPosting } from './fieldMatch.js';
import { vocabularyAliases } from './hourlyVocabulary.js';
import { tokenize } from './lemma.js';
import { notYetHeld } from './lineProof.js';

// How a credential reads in a sentence: a bare acronym is a certification ("CPR certification", not "a CPR").
function credentialName(label) {
  const l = String(label || '').trim();
  return /^(?:CPR|BLS|ACLS|PALS|NRP|TNCC|NIHSS|OSHA\s*\d+|EPA\s*608)$/i.test(l) ? `${l} certification` : l;
}
// The US states a résumé's license lines name ("Arizona Journeyman Electrician", "RN — Michigan", "AZ RN #12345").
// The résumé's own name for the license on its license line ("Arizona Journeyman Electrician" → "Journeyman Electrician").
function licenseWords(resumeText, value) {
  const re = /journeyman|master|electric/i.test(value) ? /\b((?:journeyman|master)(?:\s+electrician|\s+plumber)?)\b/i : /\b(RN|registered\s+nurse|LPN|LVN)\b/i;
  for (const line of String(resumeText || '').split(/\n/)) { const m = line.match(re); if (m && /licen|journeyman|master|\bRN\b|#/i.test(line)) return m[1].replace(/^\w/, (c) => c.toUpperCase()); }
  return '';
}
function licenseStates(resumeText, value) {
  const kindWord = /journeyman|master|electric/i.test(value) ? /journeyman|master|electrician|electrical/i : /\brn\b|nurs/i.test(value) ? /\bRN\b|nurs|licen/i : /licen/i;
  const states = new Set();
  for (const line of String(resumeText || '').split(/\n/)) {
    if (!kindWord.test(line) || !/licen|journeyman|master|\bRN\b|certif/i.test(line)) continue;
    for (const st of US_STATES) if (new RegExp(`\\b${st}\\b`).test(line)) states.add(st);
    for (const [ab, st] of Object.entries(STATE_ABBR)) if (new RegExp(`(?<![A-Za-z])${ab}(?![A-Za-z])`).test(line) && /licen|journeyman|\bRN\b|#/i.test(line)) states.add(st);
  }
  return [...states];
}
// college attended (a degree, coursework, an enrolment) implies the high-school diploma a posting asks for
// (a job title "Warehouse Associate" / "Sales Associate" is not a degree: only "Associate's" or "Associate degree / of …")
const COLLEGE_RE = /\b(?:college|university|community\s+college|coursework|credits?\s+toward|associate(?:'s|’s|\s+degree|\s+of\s+(?:arts|science|applied))|bachelor'?s?|a\.a\.s?\.?|b\.s\.|b\.a\.)(?![a-z])/i;

// ── The degree the résumé actually lists (G2) ─────────────────────────────────────────────────────────────────
// Every education sentence names the person's OWN degree, as the résumé writes it ("your B.S. in Accountancy"), never a
// rank label ("Your Bachelor's degree meets…" was printed for an Associate Degree in Nursing; "your high school diploma"
// for a résumé that lists only college coursework).
const DOTTED_VOWEL_SOUND = /^[AEFHILMNORSX]\./;
function anA(phrase) { const p = String(phrase || ''); return DOTTED_VOWEL_SOUND.test(p) || /^[AEFHILMNORSX][A-Z0-9]/.test(p) ? 'an' : /^[aeiou]/i.test(p) ? 'an' : 'a'; }
function degreeFieldOn(line, label) {
  const l = String(line || '');
  const i = l.toLowerCase().indexOf(String(label || '').toLowerCase());
  if (i < 0) return '';
  const rest = l.slice(i + String(label).length).replace(/^[\s,:]*(?:degree\s+)?(?:(?:in|of)\s+)?/i, '');
  const f = (rest.split(/\s+[—–|-]\s+|,|\(|\bfrom\b|\b(?:19|20)\d\d\b|\s{2,}/)[0] || '').trim().replace(/[.;:]+$/, '');
  return /^[A-Za-z][A-Za-z &/'-]{1,48}$/.test(f) && !/^[A-Z]{2,4}$/.test(f) && !/\b(?:university|college|school|institute|academy)\b/i.test(f) ? f : '';
}
// A degree abbreviation names its subject ("BSN" is nursing, "MSW" social work) — G5: a BSN was read as "a degree
// without its subject" and passed a social-work degree ask
const ABBR_SUBJECTS = [[/^b\.?\s?s\.?\s?n\.?$|^m\.?\s?s\.?\s?n\.?$|^adn$/i, 'Nursing'], [/^(?:bsw|msw)$/i, 'Social Work'], [/^(?:bba|m\.?b\.?a\.?)$/i, 'Business'], [/^bsee$/i, 'Electrical Engineering'], [/^bsme$/i, 'Mechanical Engineering'], [/^bsce$/i, 'Civil Engineering'], [/^bscs$/i, 'Computer Science'], [/^(?:bfa|mfa)$/i, 'Fine Arts'], [/^mph$/i, 'Public Health'], [/^mpa$/i, 'Public Administration'], [/^(?:b\.?\s?ed\.?|m\.?\s?ed\.?)$/i, 'Education']];
function abbrSubject(label) { const hit = ABBR_SUBJECTS.find(([re]) => re.test(String(label || '').trim())); return hit ? hit[1] : ''; }
export function resumeEducation(text, facts, rank) {
  const eds = (facts || []).filter((f) => f.factType === 'education' && f.rank).sort((a, b) => b.rank - a.rank);
  // the education line that names its subject wins over a credential suffix in the header ("Samantha Reyes, BSN, RN")
  const withField = eds.filter((f) => degreeFieldOn(f.evidenceText, f.label));
  const top = withField.find((f) => f.rank === rank) || eds.find((f) => f.rank === rank) || withField[0] || eds[0] || null;
  if (top && top.rank >= 2) {
    const label = /^associate\s+degree$/i.test(top.label) ? 'Associate degree' : top.label.replace(/^bachelor'?s?$/i, "Bachelor's degree").replace(/^master'?s?$/i, "Master's degree");
    const written = degreeFieldOn(top.evidenceText, top.label);
    const field = written || abbrSubject(top.label);
    // an abbreviation already says its subject ("a BSN", never "a BSN in Nursing")
    const phrase = `${label}${written && !/\bin\s/i.test(label) ? ` in ${written}` : ''}`;
    return { rank: top.rank, label, field, phrase: `${anA(phrase)} ${phrase}`, own: phrase, line: top.evidenceText || '' };
  }
  if (rank >= 1 && COLLEGE_RE.test(String(text || '')) && !(top && top.rank >= 2)) {
    const line = String(text || '').split(/\n/).find((l) => COLLEGE_RE.test(l)) || '';
    // a certificate or program from a college is named as the résumé names it ("HVAC Technology Certificate")
    const cred = (line.trim().split(/\s+[—–|-]\s+|,\s+/).find((x) => /\b(?:certificate|diploma|program|training)\b/i.test(x)) || '').trim();
    const own = cred && cred.length <= 60 ? cred : 'college coursework';
    return { rank: 1, label: own, field: '', phrase: cred ? `${anA(cred)} ${cred} but no degree` : 'college coursework but no degree', own, line: line.trim(), college: true };
  }
  if (top && top.rank === 1) return { rank: 1, label: 'high school diploma', field: '', phrase: 'a high school diploma', own: 'high school diploma', line: top.evidenceText || '' };
  return { rank: 0, label: '', field: '', phrase: 'no degree', own: '', line: '' };
}
// The subjects a posting names for its degree ("Bachelor's degree in Information Systems, Computer Science or Life
// Sciences", "(business, marketing, experience design or related field)").
export function postingDegreeFields(quote) {
  const q = String(quote || '');
  const m = q.match(/\b(?:degree|bachelor'?s?|master'?s?|associate'?s?|B\.?S\.?|B\.?A\.?|diploma)\b[^.;\n(]{0,24}?\b(?:in|of)\s+([^.;\n]{3,160})/i)
    || q.match(/\b(?:degree|bachelor'?s?|master'?s?|associate'?s?)\b[^.;\n(]{0,12}\(([^)]{3,160})\)/i);
  if (!m) return { fields: [], related: false };
  let list = m[1].replace(/\b(?:required|preferred|is\s+a\s+plus|strongly\s+preferred)\b.*$/i, '').replace(/\s+(?:with|and\s+\d|plus|from|at|or\s+(?:equivalent|\d|higher)).*$/i, '');
  const related = /\b(?:related|similar|relevant|comparable|equivalent)\s+(?:field|discipline|area|major|subject|technical\s+field|degree)s?\b|\bor\s+related\b/i.test(m[1]);
  list = list.replace(/,?\s*(?:or|and)?\s*(?:an?\s+)?(?:other\s+)?(?:closely\s+)?(?:related|similar|relevant|comparable|equivalent)\s+(?:\w+\s+)?(?:field|discipline|area|major|subject)s?\b.*$/i, '').replace(/\s+or\s+related\b.*$/i, '');
  list = list.replace(/\b(?:program|programs|degree|from\s+an?\s+accredited.*)$/i, '');
  const fields = list.split(/,\s*(?:or\s+|and\s+)?|\s+or\s+|\s+and\s+|\s*\/\s*/).map((x) => x.trim().replace(/^(?:an?|the)\s+/i, '').replace(/[.)]+$/, '')).filter((x) => x && x.length <= 40 && /^[A-Za-z]/.test(x) && !/\b(?:experience|years?|field|degree|equivalent|bachelor|associate|master|science\s+in|arts\s+in|program)\b/i.test(x));
  return { fields: fields.slice(0, 6), related };
}
// Subject families: a degree in a clearly related subject meets a named-subject ask (G5). No generic "science" or
// "studies" entry — "Health Sciences" is not "Computer Science".
const DEGREE_FAMILIES = [
  /\b(?:engineering|computer\s+science|software|computer\s+engineering|information\s+(?:systems|technology|science)|data\s+science|mathematics|math|applied\s+math\w*|statistics|physics|computing|informatics|electrical|mechanical|aerospace|industrial|chemical\s+engineering|technical)\b|\b(?:IT|IS|CS|EE|ME)\b/,
  /\b(?:nursing|health\s+sciences?|public\s+health|kinesiology|exercise\s+science|nutrition|dietetics|respiratory|radiolog\w*|medical\s+technology|health\s+administration|healthcare)\b/i,
  /\b(?:biology|biological|chemistry|biochem\w*|life\s+sciences?|microbiology|neuroscience|physiology|pharmac\w*|molecular|genetics)\b/i,
  /\b(?:business|finance|financial|accounting|accountancy|economics|commerce|management|administration|supply\s+chain|operations|marketing|hospitality\s+management)\b/i,
  /\b(?:marketing|communications?|journalism|advertising|public\s+relations|media|english)\b/i,
  /\b(?:design|graphic|fine\s+arts?|art|human[- ]computer|experience\s+design|architecture|interior)\b/i,
  /\b(?:education|teaching|early\s+childhood|child\s+development|elementary|special\s+education|curriculum)\b/i,
  /\b(?:social\s+work|psychology|counsel\w*|sociology|human\s+services|criminal\s+justice|behavio\w+\s+science|marriage\s+and\s+family|family\s+therapy)\b/i,
  /\b(?:human\s+resources|organizational|industrial\s+relations|labor\s+relations|business)\b/i,
];
const sameWords = (a, b) => { const st = (x) => new Set(tokenize(String(x)).map((t) => t.stem).filter((y) => y.length > 1 && !/^(?:and|of|the|in|scienc|studi|art)$/.test(y))); const A = st(a), B = st(b); return [...A].some((x) => B.has(x) || (x.length >= 6 && [...B].some((y) => y.length >= 6 && y.slice(0, 6) === x.slice(0, 6)))); };
export function degreeFieldFits(resumeField, posting) {
  const want = posting.fields || [];
  if (!want.length) return 'none';
  if (!resumeField) return 'unknown';
  if (want.some((w) => sameWords(w, resumeField))) return 'same';
  if (want.some((w) => DEGREE_FAMILIES.some((g) => g.test(w) && g.test(resumeField)))) return 'neighbour';
  return 'other';
}
const isEduYears = (a) => !!a && !a.degree && /\b(?:college|university|coursework|credits?|undergraduate|post-?secondary|higher\s+education)\b/i.test(`${a.field || ''} ${a.from || ''}`);

export const GATE_CAP = 35;
// A years ask met by roles doing exactly the asked work but short of the figure: from this share of it (and at least one
// year) a recruiter calls it close — "about 4 years closing Enterprise deals; they ask for 5+" is PARTLY. Below it the gap is
// real (not shown). Roles of another kind of work never lend years at all (G5, director 2026-11-10).
export const NEAR_YEARS_SHARE = 0.7;
export const TENURE_RE = /\b(?:after|upon\s+completion\s+of|following|once\s+you(?:'ve|\s+have)?\s+complete[d]?|eligible\s+after)\s+(?:\(?\d+\)?|one|two|three|four|five|six|ninety|thirty|sixty)\s+(?:full\s+)?(?:years?|months?|days?)\b(?:\s+of\s+(?:continuous\s+)?(?:service|employment|tenure))?|\b(?:years?|months?|days?)\s+of\s+(?:continuous\s+)?(?:service|employment|tenure)\b|\b(?:401\s*\(?k\)?|pto|sabbatical|vest(?:ing|ed)|parental\s+leave|tuition\s+reimbursement|raise|bonus)\b[^.;]{0,60}\bafter\b/i;
// "CPA candidacy desirable but not required", "CPA preferred", "CDL is a plus", "SAP TM certification is highly desirable"
export const CREDENTIAL_OPTIONAL_RE = /\bnot\s+(?:required|necessary|mandatory)\b|\b(?:desirable|desired|preferred|a\s+plus|nice[\s-]to[\s-]have|bonus|an\s+advantage|advantageous|helpful|beneficial)\b/i;
// "CPA eligible", "CPA candidacy", "CPA or working toward it", "active progress toward it", "within 12 months of hire",
// "active or pending", "or have submitted application for licensure"
export const CREDENTIAL_PROSPECTIVE_RE = /\b(?:candidacy|candidates?\s+for|eligib(?:le|ility)(?!\s+requirements?)|working\s+towards?|(?:active\s+)?progress\s+towards?|pursuing|pending|submitted\s+(?:an\s+)?application|within\s+(?:\d+|one|two|three|six|nine|twelve|eighteen|thirty|sixty|ninety)\s+(?:days?|weeks?|months?|years?)\s+of\s+(?:hire|hiring|employment|start(?:ing)?|joining))\b/i;
export const OBTAIN_LATER_RE = /\b(?:obtain|obtained|acquire|acquired|earn|earned|complete|completed)\b[^.;\n]{0,60}\bwithin\s+(?:\d+|thirty|sixty|ninety|one|two|three|six)\s+(?:days?|weeks?|months?)\b|\bwilling(?:ness)?\s+to\s+(?:obtain|get|earn)\b|\bability\s+to\s+obtain\b|\b(?:able|eligible)\s+to\s+obtain\b|\bobtain\s+(?:upon|after)\s+hire\b/i;
export const GATE_KINDS = new Set(['degree', 'years', 'management', 'seniority', 'certification']);

const AVAILABILITY_RE = /\b(?:availab(?:le|ility)|open\s+availability|weekends?|nights?|evenings?|overnight|holidays?|any\s+shift|flexible\s+schedule)\b/i;
const FULL_TIME_RE = /\bfull[\s-]*time\b/i;

// "a food handler card", "an RN license", "an OSHA 10" — an acronym is read letter by letter.
function article(label) {
  const l = String(label || '');
  if (/^(?:an?|the)\s/i.test(l)) return '';
  if (/^[AEFHILMNORSX][A-Z0-9]/.test(l)) return 'an ';
  return /^[aeiou]/i.test(l) ? 'an ' : 'a ';
}
// Does the résumé hold a license/certification? By the posting's own words, a synonym, or the
// credential's acronym/number ("RN" for "RN license" — "Rebecca Thornton, BSN, RN"; "EPA" + "608" for
// "EPA 608 Universal" — "EPA Section 608 Universal"). An acronym next to "exam", "candidate" or
// "pursuing" is a credential in progress, not held ("sitting for the CPA exam").
const CERT_SYNONYMS = [
  [/\brn\b|registered\s+nurse/i, [/\bRN\b/, /\bregistered\s+nurse\b/i]],
  // ServSafe Manager (a food protection manager certificate) is a higher credential: a Food Handler card
  // does not meet it, while a manager certificate does meet a food-handler ask.
  [/servsafe\s+manager|food\s+(?:protection|safety)\s+manager|\bcfpm\b/i, [/\bservsafe\s+manager/i, /\bfood\s+(?:protection|safety)\s+manager/i, /\bCFPM\b/]],
  [/food\s+handler|servsafe(?!\s+manager)/i, [/\bfood\s+handler/i, /\bservsafe\b/i, /\bfood\s+(?:safety\s+)?manager\s+certif/i]],
  // a credential asked as a CLASS is held through its instance (G5, A1): "food safety certification" ← ServSafe
  [/food\s+safety\s+(?:certif\w*|card|permit|training)|food\s+safety\s+manager/i, [/\bservsafe\b/i, /\bfood\s+handler/i, /\bfood\s+(?:protection|safety)\s+manager/i, /\bHACCP\b/, /\bCFPM\b/]],
  [/forklift|powered\s+industrial\s+truck/i, [/forklift[^.\n]{0,40}certif/i, /certified[^.\n]{0,20}forklift/i, /forklift[^.\n]{0,15}licen[sc]e/i, /^\s*certifications?\s*:?[^\n]*\bforklift\b/im, /\bpowered\s+industrial\s+truck/i]],
  [/forklift/i, [/forklift[^.\n]{0,40}certif/i, /certified[^.\n]{0,20}forklift/i, /forklift[^.\n]{0,15}licen[sc]e/i]],
  [/teaching\s+licen|teacher\s+certif/i, [/teaching\s+licen[sc]/i, /teacher\s+(?:licen[sc]|certif)/i, /licensed\s+teacher/i, /initial\s+professional\s+licen[sc]e/i]],
  // an RN license is a higher license than an LPN / LVN one: it meets an "LPN/LVN license" ask
  [/\b(?:LPN|LVN|licensed\s+(?:practical|vocational)\s+nurse)\b/i, [/\bLPN\b/, /\bLVN\b/, /\bRN\b/, /\bregistered\s+nurse\b/i, /\blicensed\s+(?:practical|vocational)\s+nurse\b/i]],
  [/\bnurs\w*\s+licen/i, [/\bRN\b/, /\bLPN\b/, /\bLVN\b/, /\bregistered\s+nurse\b/i, /\blicensed\s+(?:practical|vocational)\s+nurse\b/i]],
  [/\bcpr\b/i, [/\bCPR\b/, /\bBLS\b/, /\bbasic\s+life\s+support\b/i, /\bACLS\b/, /\bPALS\b/]],
  [/driver'?s?\s+licen/i, [/driver'?s?\s+licen[sc]e/i, /\bcdl\b/i]],
];
const IN_PROGRESS_RE = /^[^.\n]{0,30}\b(?:exam|candidate|eligible|in\s+progress|pursuing|sitting|track|coursework)\b/i;
// A credential mentioned as in progress ("the CPA exam", "CPA candidate") is not held: it is blanked
// out before ANY held-credential check reads the text.
export const withoutInProgress = (resumeText) => String(resumeText || '').replace(/\b([A-Z]{2,6})\b(?=[^.\n]{0,30}\b(?:exam|candidate|eligible|in\s+progress|pursuing|sitting|track|coursework)\b)/g, (x) => ' '.repeat(x.length));
export function certHeld(resumeText, value, label) {
  const text = withoutInProgress(resumeText);
  if (hasStemmed(text, value)) return true;
  for (const [want, ways] of CERT_SYNONYMS) if (want.test(`${value} ${label}`) && ways.some((re) => re.test(text))) return true;
  const marks = String(label || value).match(/\b(?:[A-Z]{2,6}|\d{2,4})\b/g) || [];
  if (!marks.length) return false;
  return marks.every((mk) => {
    // The mark is letters/digits by construction, but it came from the posting: escape it before it is a pattern.
    const esc = escapeRegExp(mk);
    let m; const g = new RegExp(`(?<![A-Za-z0-9])${esc}(?![A-Za-z0-9])`, 'g');
    while ((m = g.exec(text)) !== null) if (!IN_PROGRESS_RE.test(text.slice(m.index + mk.length))) return true;
    return false;
  });
}
/** Every résumé mention of the credential's words is a junior role ("Physical Therapist Assistant", "Pharmacy Technician
 *  … Pharmacist"?): the words followed by Assistant / Aide / Technician / Tech, or the junior acronym (PTA, COTA, LPTA). */
function juniorOnly(resumeText, value) {
  const core = String(value || '').replace(/\b(?:license|licence|certification|certificate|active|current|valid|state|registered|\(?[A-Z]{2,5}\)?)\b/g, ' ').replace(/\s+/g, ' ').trim();
  if (core.split(/\s+/).length < 2) return false;
  const re = new RegExp(`(?<![A-Za-z])${escapeRegExp(core)}(?![A-Za-z])(\\s+(?:assistant|aide|technician|tech)\\b)?`, 'gi');
  let m, junior = '', senior = false;
  while ((m = re.exec(String(resumeText || ''))) !== null) { if (!m[1]) senior = true; else junior = junior || m[0]; }
  return junior && !senior ? junior.replace(/\s+/g, ' ').trim() : '';
}
/** A degree the résumé says is still being earned ("B.S. Data Analytics — Ohio State, expected May 2027"), or null. */
function inProgressDegree(resumeText) {
  for (const raw of String(resumeText || '').split(/\n/)) {
    const line = raw.trim();
    if (!/\b(?:expected|anticipated|in\s+progress|candidate|pursuing|currently\s+enrolled|class\s+of)\b/i.test(line)) continue;
    const m = line.match(/\b(B\.?\s?S\.?N?\.?|B\.?\s?A\.?|B\.?B\.?A\.?|Bachelor(?:'s)?(?:\s+of\s+\w+)?|A\.?A\.?S?\.?|Associate(?:'s)?(?:\s+degree)?|M\.?\s?S\.?|M\.?\s?A\.?|MBA|Master(?:'s)?(?:\s+of\s+\w+)?)(?=[\s,]|$)/);
    if (!m) continue;
    const rank = /^(?:M|Master)/i.test(m[1]) ? 4 : /^(?:A\.?A|Associate)/i.test(m[1]) ? 2 : 3;
    const field = (line.slice(m.index + m[1].length).replace(/^[\s,:]*(?:degree\s+)?(?:in|of)?\s*/i, '').split(/\s+[—–|-]\s+|,|\(|\bexpected\b|\b(?:19|20)\d\d\b/i)[0] || '').trim();
    const when = (line.match(/\b(?:expected|anticipated|class\s+of)\s*:?\s*((?:[A-Z][a-z]+\.?\s+)?(?:19|20)\d\d)/i) || [])[1] || null;
    const label = m[1].replace(/\s+/g, '');
    return { rank, line, when, phrase: `${anA(label)} ${label}${field && /^[A-Za-z][A-Za-z &/-]{1,40}$/.test(field) ? ` in ${field}` : ''}` };
  }
  return null;
}
/** The education line that shows a degree of `rank`: that level exactly, else the lowest higher one ("a bachelor's degree
 *  implies it"), else null. */
function degreeCite(resumeText, facts, rank) {
  const eds = (facts || []).filter((f) => f.factType === 'education' && f.rank && f.evidenceText);
  const exact = eds.find((f) => f.rank === rank);
  if (exact) return { line: exact.evidenceText.trim(), why: 'This line shows it.' };
  const higher = eds.filter((f) => f.rank > rank).sort((a, b) => a.rank - b.rank)[0];
  if (higher) return { line: higher.evidenceText.trim(), why: `${String(DEGREE_LABEL[higher.rank] || 'a degree').replace(/^\w/, (x) => x.toUpperCase())} implies it.` };
  if (rank <= 1) { const col = String(resumeText || '').split(/\n/).find((l) => COLLEGE_RE.test(l)); if (col) return { line: col.trim(), why: 'College coursework implies it.' }; }
  return null;
}
/** The résumé line that shows a held credential: its own words, its acronym, or a synonym the posting accepts. */
function certLine(resumeText, value, label) {
  let lines = String(resumeText || '').split(/\n/).map((l) => l.trim()).filter(Boolean);
  const marks = String(label || value).match(/\b(?:[A-Z]{2,6}|\d{2,4})\b/g) || [];
  const syn = CERT_SYNONYMS.filter(([want]) => want.test(`${value} ${label}`)).flatMap(([, ways]) => ways);
  // a header never shows a certification: a role header (it has dates) or the name / contact lines at the top (G5)
  const head = new Set(lines.slice(0, 3).filter((l) => !/licen|certif|\bcerts?\b/i.test(l)));
  lines = lines.filter((l) => !head.has(l) && !(/(?:19|20)\d\d\s*(?:-|–|—|to)\s*(?:(?:19|20)\d\d|present|now|current)/i.test(l) && /\s[—–|-]\s/.test(l) && !/licen|certif/i.test(l)));
  return lines.find((l) => hasStemmed(l, String(value || '')) && !notYetHeld(l, String(value || '')))
    || lines.find((l) => marks.length && marks.every((mk) => new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(mk)}(?![A-Za-z0-9])`).test(l)))
    || lines.find((l) => syn.some((re) => re.test(l))) || null;
}
// The license a degree sentence also requires, judged on the résumé's license lines.
const LICENSE_FOR = [
  [/social\s+work/i, 'social work license', /\b(?:LCSW|LMSW|LISW|LSW|LICSW|licensed\s+(?:clinical\s+)?social\s+worker)\b/i],
  [/counsel/i, 'counseling license', /\b(?:LPC|LPCC|LMHC|licensed\s+(?:professional\s+)?counselor)\b/i],
  [/marriage|family\s+therapy/i, 'marriage and family therapy license', /\b(?:LMFT|licensed\s+marriage)\b/i],
  [/nursing/i, 'nursing license', /\b(?:RN|LPN|LVN|registered\s+nurse|nursing\s+licen[sc]e)\b/],
  [/psycholog/i, 'psychology license', /\blicensed\s+psychologist\b|\bpsychologist\s+licen[sc]e\b/i],
  [/pharmac/i, 'pharmacist license', /\b(?:RPh|PharmD|licensed\s+pharmacist|pharmacist\s+licen[sc]e)\b/i],
];
function impliedLicense(c, jobFacts, resumeText) {
  const q = String(c.evidence || '');
  if (!/\blicen[sc](?:ed|e|ure)\b/i.test(q)) return null;
  if ((jobFacts || []).some((f) => f.factType === 'constraint' && f.kind === 'certification' && ((c.statementId && f.statementId === c.statementId) || f.evidence === c.evidence))) return null;
  const spec = LICENSE_FOR.find(([re]) => re.test(q));
  if (!spec) return null;
  const held = spec[2].test(withoutInProgress(resumeText));
  const sentence = held ? `Your résumé lists a ${spec[1]}.` : `This sentence also requires a ${spec[1]}; your résumé does not list one.`;
  return { kind: 'certification', label: spec[1], value: spec[1], implied: true, status: held ? 'met' : 'unmet', message: sentence, sentence, grade: held ? 'met' : 'not_shown', caps: false, factor: held ? 1 : 0.6, gate: false };
}
// The not-yet-held phrase when EVERY résumé line that names the credential qualifies it ("CPA Candidate"), else null.
// A firm name in a role header ("Henley & Moss CPAs") is never a mention.
export function credentialPending(resumeText, label, value) {
  const marks = [...new Set([...String(label || '').matchAll(/\b[A-Z]{2,6}\b/g), ...String(value || '').matchAll(/\b[A-Z]{2,6}\b/g)].map((m) => m[0]))];
  const words = String(value || label || '').trim();
  const tokens = [...marks, ...(words.length >= 4 && !marks.includes(words) ? [words] : [])].filter((t) => !/^(?:US|USA|OR|AND|THE)$/.test(t)).slice(0, 4);
  if (!tokens.length) return null;
  let phrase = null;
  for (const raw of String(resumeText || '').split(/\n/)) {
    const line = raw.trim();
    if (!line) continue;
    for (const tok of tokens) {
      const re = new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(tok)}(?![A-Za-z0-9])`, /^[A-Z0-9]+$/.test(tok) ? '' : 'i');
      const m = line.match(re);
      if (!m) continue;
      // a role header's employer part ("Staff Accountant — Henley & Moss CPA Group") names a firm, not the person
      const sep = line.search(/\s[—–|]\s/);
      if (sep > 0 && m.index > sep && /\b(?:19|20)\d\d\b|present/i.test(line)) continue;
      const nh = notYetHeld(line, tok);
      if (!nh) return null;
      phrase = phrase || nh;
    }
  }
  return phrase;
}
function resumeDegree(facts) {
  return facts.filter((f) => f.factType === 'education').reduce((m, f) => Math.max(m, f.rank || 0), 0);
}
function years(facts, key) {
  const f = facts.find((x) => x.factType === 'experience' && x.normalizedLabel === key);
  return f ? f.value : 0;
}
function fmtYears(y) {
  if (!y) return 'none';
  const r = Math.round(y * 10) / 10;
  return `${r} year${r === 1 ? '' : 's'}`;
}

/**
 * @param {object[]} jobFacts  extractJobFacts output (constraint + seniority facts are read)
 * @param {object[]} resumeFacts extractResumeFacts output
 * @param {string} resumeText
 * @returns {{ kind, label, status, gate, importance, message, evidence }[]}
 */
export function evaluateConstraints(jobFacts, resumeFacts, resumeText = '', { jobFamily = null, jobTitle = '', jobText = '', jobField: jobFieldKey = null, now = new Date() } = {}) {
  void jobFamily;
  const out = [];
  const text = String(resumeText || '');
  // a diploma gate is met by any college coursework or degree (judge optimize #4: "Requires a high school diploma" for
  // someone with college coursework → 35)
  const deg = Math.max(resumeDegree(resumeFacts), COLLEGE_RE.test(text) ? 1 : 0);
  const totalY = years(resumeFacts, 'experience:total');
  const mgmtY = years(resumeFacts, 'experience:management');
  const gpaFact = resumeFacts.find((f) => f.factType === 'gpa');
  const seniority = resumeFacts.filter((f) => f.factType === 'seniority').map((f) => f.label);
  const leadRank = seniority.some((l) => ['lead', 'director', 'executive'].includes(l));
  void leadRank;
  // ONE experience profile for every years / management gate: dated roles, each with its field and its people evidence
  const profile = experienceProfile(text, { now, fieldOf: roleField });
  const jobField = jobFieldKey || postingField(jobTitle || '', '');
  const ctx = { text, profile, jobField, jobTitle, totalY: profile.totalYears || totalY, now, degreeRank: deg, edu: resumeEducation(text, resumeFacts, deg), newGrad: isNewGradPosting(jobTitle, jobText) };

  for (let c of jobFacts.filter((f) => f.factType === 'constraint')) {
    // posting_quote: the posting's own sentence a gate stands on — no hard gate is ever shown without one
    const base = { kind: c.kind, label: c.label, gate: !!c.gate, importance: c.importance, evidence: c.evidence || '', posting_quote: c.evidence || '', statementId: c.statementId || null, items: c.items || null, value: c.value ?? null };
    switch (c.kind) {
      case 'degree': {
        const alts = c.alternatives && c.alternatives.length ? c.alternatives : [{ degree: c.value, years: 0, management: false }];
        const edu = resumeEducation(text, resumeFacts, deg);
        const primary = Math.max(0, ...alts.map((a) => a.degree || 0));
        const needLabel = DEGREE_LABEL[primary] || 'a degree';
        // an alternative is met when the résumé holds the degree AND its years; "2 years of college" by an Associate degree
        const altMet = (a) => isEduYears(a) ? deg >= 2 : (!a.degree || deg >= a.degree) && (!a.years || (a.management ? mgmtY : totalY) + 0.25 >= a.years);
        const byDegree = alts.find((a) => a.degree && altMet(a));
        const byYears = !byDegree ? alts.find((a) => !a.degree && !isEduYears(a) && a.years && altMet(a)) : null;
        const byCollege = !byDegree && !byYears ? alts.find((a) => isEduYears(a) && altMet(a)) : null;
        // a degree still being earned meets an ask stated as "pursuing / graduating by …", or any degree ask in a posting written
        // for new graduates (G6): in progress IS the requirement there
        const pend = inProgressDegree(text);
        const acceptsPending = /\b(?:pursuing|graduat\w*\s+(?:by|in|between|no\s+later)|currently\s+enrolled|enrolled\s+in|expected\s+graduation|class\s+of\s+20\d\d|working\s+toward|in\s+progress)\b/i.test(String(c.evidence || '')) || ctx.newGrad;
        if (!alts.some((a) => a.degree && altMet(a)) && pend && acceptsPending && pend.rank >= Math.max(1, ...alts.map((a) => a.degree || 0))) {
          const sentence = `You're finishing ${pend.phrase}${pend.when ? ` (expected ${pend.when})` : ''}; they accept a degree in progress.`;
          out.push({ ...base, status: 'met', message: sentence, sentence, grade: 'met', caps: false, factor: 1, line: pend.line, why: 'In progress, which the posting accepts.' });
          break;
        }
        const metAlt = byDegree || byYears || byCollege;
        const degreeOk = alts.some((a) => !a.degree || deg >= a.degree);
        let status = metAlt ? 'met' : 'unmet';
        let message;
        let extra = {};
        if (status === 'met' && c.gpa) {
          status = gpaFact ? (gpaFact.value >= c.gpa ? 'met' : 'unmet') : 'ask';
          const g = Number(c.gpa).toFixed(1);
          message = gpaFact ? `GPA ${gpaFact.value} against a ${g} minimum.` : `The posting asks for a ${g}+ GPA — your résumé does not list one. Add it only if it is ${g} or higher.`;
        } else if (status === 'unmet') {
          message = degreeOk
            ? `Requires ${c.label}; your résumé shows ${(alts[0].management ? mgmtY : totalY) ? `${fmtYears(alts[0].management ? mgmtY : totalY)} of` : 'no'} ${alts[0].management ? 'supervisory ' : ''}experience.`
            : `Requires ${alts.some((a) => a.years) ? c.label : `${needLabel}${c.gpa ? ` (GPA ${Number(c.gpa).toFixed(1)}+)` : ''}`}; your résumé lists ${pend ? `${pend.phrase}${pend.when ? `, expected ${pend.when}` : ' (in progress)'}` : edu.phrase}${alts.some((a) => a.management) ? ` and ${mgmtY ? fmtYears(mgmtY) + ' of' : 'no'} supervisory experience` : ''}.`;
        } else if (byYears) {
          // met through the years they accept instead of the degree: say that, never "your diploma meets it"
          const y = byYears.management ? mgmtY : totalY;
          message = `They accept ${byYears.years} years of ${byYears.management ? 'supervisory ' : ''}experience in place of the degree; your résumé shows ${about(y)}.`;
          extra = { grade: 'met', caps: false, factor: 1, via: 'years' };
        } else if (byCollege) {
          message = `They accept ${byCollege.years} years of college in place of ${needLabel}; your ${edu.own} covers that.`;
          extra = { grade: 'met', caps: false, factor: 1, via: 'college' };
        } else {
          // met by the degree: the subject they name is checked too ("a degree in IS, CS or Life Sciences" is not met by a
          // B.S. in Accountancy)
          const pf = postingDegreeFields(c.evidence || '');
          // the degree of the level asked is the one named (a B.A. for "Bachelor's (any field)", not the M.S. above it),
          // unless only the higher one fits the subject
          const atLevel = resumeFacts.some((f) => f.factType === 'education' && f.rank === (byDegree.degree || primary)) ? resumeEducation(text, resumeFacts, byDegree.degree || primary) : edu;
          const pick = degreeFieldFits(atLevel.field, pf) !== 'other' || degreeFieldFits(edu.field, pf) === 'other' ? atLevel : edu;
          const fits = degreeFieldFits(pick.field, pf);
          const subjects = pf.related ? pf.fields.slice(0, 3).join(', ') : joinOr(pf.fields.slice(0, 3));
          if (fits === 'other') {
            // an unrelated subject is part of the way only when the posting accepts a related field or equivalent
            // experience AND the person works in the posting's field; otherwise the degree asked is not shown (G5)
            const pref = c.importance && c.importance !== 'required';
            const lenient = pf.related || /\bequivalent\b/i.test(String(c.evidence || ''));
            const inField = !!jobField && profile.roles.some((r) => r.field === jobField);
            const part = lenient && inField;
            message = part ? `You have ${edu.phrase}; they ask for ${subjects} or a related field.` : `They ask for a degree in ${subjects}${pf.related ? ' or a related field' : ''}; you list ${edu.phrase}.`;
            extra = { grade: part ? 'partly' : 'not_shown', caps: false, factor: pref ? 0.97 : part ? 0.85 : 0.75, fieldAsked: pf.fields, fieldHave: edu.field };
            status = pref ? 'ask' : 'unmet';
          } else if (fits === 'unknown') {
            message = `They ask for a degree in ${subjects}${pf.related ? ' or a related field' : ''}; your résumé lists ${edu.phrase} without its subject — add it.`;
            extra = { grade: 'partly', caps: false, factor: 0.95, fieldAsked: pf.fields };
            status = 'ask';
          } else {
            message = `Your ${pick.own || String(DEGREE_LABEL[deg] || 'education').replace(/^(?:an?|the)\s+/i, '')} meets the education requirement${fits === 'neighbour' ? ` (they ask for ${subjects} or a related field)` : ''}.`;
          }
          // a met degree carries the résumé line that shows it — the exact level asked first ("Bachelor's (any field)" cites
          // the bachelor's line, not the master's beside it), else the higher degree that implies it (G5, B)
          // a high-school ask is shown by the high-school line itself, named as written ("Dobson High School, 2018")
          if ((byDegree.degree || primary) <= 1) { const hsF = resumeFacts.find((f) => f.factType === 'education' && f.rank === 1 && f.evidenceText); if (hsF) { const ln = hsF.evidenceText.trim(); message = `Your résumé lists ${ln.replace(/,?\s+((?:19|20)\d\d)\s*$/, ', $1').replace(/^EDUCATION:?\s*/i, '')}.`; } }
          const cite = pick !== atLevel ? (pick.line ? { line: pick.line.trim(), why: 'This line shows it.' } : null) : degreeCite(text, resumeFacts, byDegree.degree || primary);
          if (cite) extra = { ...extra, line: cite.line, why: cite.why };
        }
        out.push({ ...base, status, message, ...(extra.grade ? { ...extra, sentence: message } : {}), ...(extra.line ? { line: extra.line, why: extra.why } : {}) });
        // a sentence that requires BOTH a license and the degree is two gates: the license is judged too, on the same
        // statement, when the reader did not read it as its own row (G5 — "licensed by the Board of Social Work Examiners,
        // has a Bachelor's degree in social work")
        const lic = impliedLicense(c, jobFacts, text);
        if (lic) out.push({ ...base, ...lic });
        break;
      }
      case 'years': {
        // a figure no job asks for is the company's history ("BAYADA is celebrating 50 years"), never a requirement
        if (!(Number(c.value) > 0) || Number(c.value) > 25) break;
        // G4: tenure with the employer ("401k match after one year of service", "sabbatical after 4 years of service",
        // "PTO after 90 days of employment") is a benefit, never a requirement
        if (TENURE_RE.test(String(c.sentence || c.evidence || '')) || TENURE_RE.test(String(c.label || ''))) break;
        // a posting for new graduates expects no years: "0–1 years, internships count" is never a years gate (G6)
        if (ctx.newGrad && Number(c.value) <= 1) break;
        // "Bachelor's degree or 8 years of equivalent experience": the years are an ALTERNATIVE to the degree, judged once
        // by the degree row — a separate years row failed people who hold the degree; "2 years of college" is schooling
        { const alts = c.alternatives || []; const substitute = alts.some((a) => a && a.degree > 0 && !a.years) && alts.some((a) => a && !a.degree && a.years); if (substitute || isEduYears(alts[0]) || /\b(?:college|university|coursework|credits?)\b/i.test(String(c.field || ''))) break; }
        // a "management" flag on a sentence whose object is a thing ("infrastructure management or backend software
        // development") is a years-in-field requirement, not people management
        const ph = domainPhrase(c);
        // "2+ years supervising warehouse teams": managing people IN an area — the area is checked too (G4)
        const ys = yearsSubject(c);
        const area = !!(ys && /^(?:supervis|manag|lead)/i.test(ys.lead) && ph && ph !== 'managing people' && phraseStems(ph).some((x) => !WEAK_DOMAIN.has(x) && !PEOPLE_STEMS.has(x)));
        if (area) c = { ...c, field: `${ys.lead} ${ph}` };
        // with an area, the years grader's leadership path judges both the managing and the area
        const people = !area && c.management && (!ph || ph === 'managing people' || peopleManagement(c.sentence || c.evidence || ph));
        // "skills typically attained with 1 year of…", "or an equivalent combination": a guide, not a gate
        const pref = (c.importance && c.importance !== 'required') || /\btypically\s+(?:attained|acquired|gained|obtained)|\bequivalent\s+combination\b/i.test(String(c.sentence || c.evidence || ''));
        out.push({ ...base, ...(people ? gradeManagement({ ...c, _preferred: pref }, ctx) : gradeYears({ ...c, management: false, _preferred: pref }, ctx)) });
        break;
      }
      case 'management':
      case 'seniority': {
        // "Responsible for managing patient health records", "manage multiple tasks": managing a thing is not a team (G5)
        // "work with minimum supervision", "under general supervision": being supervised is not supervising
        if (c.kind === 'management' && /\b(?:minimum|minimal|little|limited|no|without|general|close|direct)\s+supervision\b|\bunder\s+(?:the\s+)?(?:\w+\s+)?supervision\b|\bindependently\b/i.test(String(c.evidence || '')) && !/\b(?:supervis(?:e|ed|ing)\s+(?:a\s+)?(?:team|staff|\d))/i.test(String(c.evidence || ''))) break;
        if (c.kind === 'management' && !peopleManagement(String(c.evidence || c.label || '')) && !/\b(?:team|staff|people|employees|direct\s+reports|crew|associates|supervis\w*|lead(?:ing|ership)?)\b/i.test(String(c.evidence || ''))) break;
        out.push({ ...base, ...gradeManagement({ ...c, _preferred: c.importance && c.importance !== 'required' }, ctx) });
        break;
      }
      case 'certification': {
        // G4: a credential is a gate only when the posting requires HOLDING it. Optional wording ("desirable", "not
        // required", "a plus") makes it preferred; prospective wording ("CPA eligible", "candidacy", "or working toward",
        // "within 12 months of hire", "pending") is a question — or met by a candidate — never a not-met gate.
        if (CREDENTIAL_OPTIONAL_RE.test(String(c.evidence || '')) && !CREDENTIAL_PROSPECTIVE_RE.test(String(c.evidence || ''))) { c = { ...c, importance: 'preferred', gate: false }; base.importance = 'preferred'; base.gate = false; }
        if (CREDENTIAL_PROSPECTIVE_RE.test(String(c.evidence || ''))) {
          const nm = credentialName(c.label);
          const sureP = withoutInProgress(text);
          const heldP = hasStemmed(sureP, String(c.value || '')) || !!credentialHeld(sureP, c.value || c.label) || certHeld(text, c.value, c.label);
          const pend = credentialPending(text, c.label, c.value);
          if (heldP || pend) {
            const sentence = pend ? `They accept ${String(c.label || nm).replace(/^an?\s+/i, '')} candidacy; you list "${pend}".` : `Your résumé lists ${nm}.`;
            out.push({ ...base, gate: false, status: 'met', message: sentence, sentence, grade: 'met', caps: false, factor: 1, ...(pend ? { pending: pend } : {}), prospective: true });
          } else {
            const sentence = `They accept someone working toward ${article(nm)}${nm}; your résumé doesn't say you are. Add it if you are eligible or studying for it.`;
            out.push({ ...base, gate: false, importance: CREDENTIAL_OPTIONAL_RE.test(String(c.evidence || '')) ? 'preferred' : base.importance, status: 'ask', message: sentence, sentence, grade: 'cannot_tell', caps: false, factor: 0.95, prospective: true });
          }
          break;
        }
        // a credential the employer lets you earn after hire ("obtain … within 30 days of hire", "or willingness to
        // obtain") is a question, never a gate
        if (OBTAIN_LATER_RE.test(String(c.evidence || ''))) {
          const nm = credentialName(c.label);
          const sentence = `They ask you to get ${article(nm)}${nm} after you start, so it is not a requirement to apply; say so if you already hold it.`;
          out.push({ ...base, gate: false, importance: 'preferred', status: 'ask', message: sentence, sentence, grade: 'cannot_tell', caps: false, factor: 1, obtainLater: true });
          break;
        }
        const sure = withoutInProgress(text);
        const coreValue = String(c.value || '').replace(new RegExp(`^(?:${US_STATES.join('|')})\\s+`, 'i'), '');
        let held = hasStemmed(sure, coreValue) || !!credentialHeld(sure, coreValue || c.label) || certHeld(text, coreValue, c.label)
          || (/journeyman|master/i.test(coreValue) && /\bjourneyman\b|\bmaster\s+electrician\b/i.test(sure) && (!/master/i.test(coreValue) || /journeyman/i.test(coreValue)))
          // "Residential Electrician Certification or higher": a journeyman / master electrician holds a higher class (G4)
          || (/\b(?:residential|general|electrician|electrical)\b[^.]{0,30}\b(?:certification|certificate|license)\b/i.test(coreValue) && /\bor\s+higher\b/i.test(String(c.evidence || '')) && /\bjourneyman\b|\bmaster\s+electrician\b/i.test(sure));
        // a junior credential is not the senior one: "Physical Therapist Assistant (PTA)" does not hold a "Physical Therapist"
        // license (G5)
        const junior = held && juniorOnly(text, coreValue || c.label);
        if (junior) {
          held = false;
          const nmJ = credentialName(c.label);
          const sentence = `They ask for ${article(nmJ)}${nmJ}; you list ${junior}, a different credential.`;
          out.push({ ...base, status: c.gate || c.importance === 'required' ? 'unmet' : 'ask', message: sentence, sentence, grade: 'not_shown', caps: !!c.gate, factor: 0.5, junior: true });
          break;
        }
        const name = credentialName(c.label);
        // a license the posting ties to a state is compared with the state on the résumé's license line: "Texas
        // Journeyman required — your résumé shows an Arizona Journeyman license" is a real, specific gate
        if (held && c.state) {
          const states = licenseStates(text, coreValue);
          if (states.length && !states.includes(c.state)) {
            const status = c.compact ? 'ask' : (c.gate ? 'unmet' : 'ask');
            out.push({ ...base, status, state: c.state, resumeStates: states, message: status === 'unmet'
              ? `Requires ${article(name)}${name}; your résumé shows ${states.length === 1 ? `${article(states[0]).trim()} ${states[0]}` : states.join(' / ')}${licenseWords(text, coreValue) ? ` ${licenseWords(text, coreValue)}` : ''} license.`
              : `The posting asks for ${article(name)}${name}${c.compact ? ' (a compact license may count)' : ''}; your résumé shows ${states.join(' / ')}. Say whether you hold or can transfer it.` });
            break;
          }
          if (!states.length) {
            out.push({ ...base, status: 'ask', state: c.state, message: `The posting asks for ${article(name)}${name}. Your résumé does not say which state your license is from — add the state if it is ${c.state}.` });
            break;
          }
        }
        // held by the old test, but every line that names it says it is not held yet ("CPA Candidate", "CPA exam — REG in
        // progress", "pursuing PMP"): never met — what is listed, and that the credential itself is not (G2, A1)
        const pending = held ? credentialPending(text, c.label, coreValue) : null;
        // a posting that asks for the candidacy itself ("CPA candidacy desirable", "CPA eligible") is met by a candidate
        const asksCandidacy = /\b(?:candidacy|candidate|eligib\w*|pursuing|working\s+towards?|progress\s+towards?)\b/i.test(String(c.evidence || ''));
        if (pending && !asksCandidacy) {
          const pref = (c.importance && c.importance !== 'required') || /\bnot\s+required\b|\b(?:desirable|desired|preferred|a\s+plus|nice\s+to\s+have|bonus)\b/i.test(String(c.evidence || ''));
          const kindWord = OCCUPATION_LICENCE_RE.test(String(c.label || '')) ? 'license' : 'certification';
          const sentence = `They ask for ${article(name)}${name}; you list "${pending}", so the ${kindWord} itself isn't on your résumé yet.`;
          out.push({ ...base, ...(pref ? { importance: 'preferred', gate: false } : {}), status: pref ? 'ask' : 'unmet', message: sentence, sentence, grade: 'partly', caps: false, factor: pref ? 0.95 : (c.gate ? 0.7 : 0.8), pending });
          break;
        }
        if (pending && asksCandidacy) {
          const sentence = `They accept ${String(c.label || name).replace(/^an?\s+/i, '')} candidacy; you list "${pending}".`;
          out.push({ ...base, status: 'met', message: sentence, sentence, grade: 'met', caps: false, factor: 1, pending });
          break;
        }
        const status = held ? 'met' : (c.gate ? 'unmet' : 'ask');
        const shownLine = held ? certLine(text, coreValue, c.label) : null;
        out.push({ ...base, ...(shownLine ? { line: shownLine, why: 'This line shows it.' } : {}), status, message: status === 'met' ? `Your résumé lists ${name}.`
          : status === 'unmet' ? `Requires ${article(name)}${name}; your résumé does not list it.`
          : `The posting asks for ${name}. Do you have it? Add it under Certifications only if you do.` });
        break;
      }
      case 'language': {
        const want = String(c.value || '').toLowerCase();
        // "bilingual English/Spanish" is met by a résumé that names every non-English language it
        // asks for ("Bilingual English/Spanish" on Maria's résumé read as "ask", 2026-10-25).
        const LANGS = /\b(spanish|french|german|mandarin|chinese|cantonese|japanese|korean|vietnamese|tagalog|arabic|russian|portuguese|italian|hindi|punjabi|urdu|polish|haitian creole|creole|asl|american sign language|somali|farsi|persian|hmong)\b/gi;
        const asked = [...new Set([...`${c.label || ''} ${want}`.matchAll(LANGS)].map((m) => m[1].toLowerCase()))];
        // a language written in itself ("español", "Bilingüe") is that language (G5)
        const NATIVE = { spanish: /\b(?:espa(?:ñ|n)ol|biling(?:ü|u)e)\b/i, french: /\bfran(?:ç|c)ais\b/i, portuguese: /\bportugu(?:ê|e)s\b/i, german: /\bdeutsch\b/i };
        let status = want === 'english' && !asked.length ? 'met'
          : (asked.length ? asked.every((l) => new RegExp(`(?<![a-z])${escapeRegExp(l)}(?![a-z])`, 'i').test(text) || (NATIVE[l] && NATIVE[l].test(text))) : hasStemmed(text, want)) ? 'met' : 'ask';
        // "Spanish (conversational)" is not bilingual (round 9): a posting that asks for bilingual or
        // fluent is met only by a résumé that says so
        const level = asked.length ? (text.match(new RegExp(`[^\\n,;•]{0,24}(?<![a-z])${escapeRegExp(asked[0])}(?![a-z])[^\\n,;•]{0,24}`, 'i')) || [''])[0] : '';
        const weak = /\b(?:conversational|basic|beginner|some|elementary|limited|learning)\b/i.test(level);
        if (status === 'met' && weak && /\b(?:bilingual|fluent|fluency|native)\b/i.test(`${c.label} ${want}`)) status = 'partial';
        out.push({ ...base, gate: false, status, message: status === 'met' ? `Your résumé mentions ${want === 'english' ? 'English' : c.label}.`
          : status === 'partial' ? `The posting asks for ${c.label}; your résumé says ${level.trim()}. Say exactly that — don't upgrade it.`
          : `The posting asks for ${c.label}. Add it only if you speak it.` });
        break;
      }
      case 'schedule': {
        // every item the posting needs has to be on the résumé's availability line ("Available weekends" does
        // not cover holidays or nights — round 9)
        const missing = (c.items || []).filter((i) => !/part-time|seasonal|temporary|full-time|hours|shift/.test(i) && !new RegExp(`\\b${escapeRegExp(String(i).replace(/s$/, ''))}`, 'i').test(text));
        const hasLine = AVAILABILITY_RE.test(text) && !missing.length;
        const partTime = (c.items || []).some((i) => /part-time|seasonal|temporary/.test(i));
        const conflict = partTime && FULL_TIME_RE.test(text);
        const pt = (c.items || []).filter((i) => /part-time|seasonal|temporary/.test(i)).join('/');
        out.push({ ...base, gate: false, status: hasLine && !conflict ? 'met' : 'ask', conflict,
          short: conflict ? `this job is ${pt} and your résumé asks for full-time work` : undefined,
          message: conflict
            ? `This job is ${(c.items || []).filter((i) => /part-time|seasonal|temporary/.test(i)).join('/')}; your résumé says you want full-time work. Change that line if part-time works for you.`
            : hasLine && !conflict ? `This job needs ${c.label}; your availability line covers it.`
            : `This job needs ${c.label}. If you can work that, add an availability line under your header.` });
        break;
      }
      case 'physical':
        out.push({ ...base, gate: false, status: 'ask', message: `Physical requirement: ${c.label}. Add "Able to ${c.label.split(', ')[0]}" only if true.` });
        break;
      case 'age':
        out.push({ ...base, gate: false, status: 'ask', message: `You must be ${c.label} for this job.` });
        break;
      case 'background':
        out.push({ ...base, gate: false, status: 'ask', message: `The employer runs a ${c.label}.` });
        break;
      default:
        break;
    }
  }
  // the license a job turns on, when the posting's own reading did not list it ("A current nursing license in good standing")
  const lic = occupationLicense(jobField, jobTitle, jobText, text, out);
  if (lic) out.push(lic);
  for (const row of out) {
    if (!row.grade) {
      const g = gradeOther(row, ctx);
      if (row.importance && row.importance !== 'required') { g.caps = false; g.factor = 1 - (1 - (Number.isFinite(g.factor) ? g.factor : 1)) * 0.3; }
      Object.assign(row, g);
    }
    if (!row.statementStatus) row.statementStatus = STATEMENT_STATUS[row.grade] || 'cannot_tell';
  }
  // One row per message: a posting that states the same requirement twice (a summary line and a
  // bullet) showed it twice in one list (Maria, round 3). The first row keeps its place and gate.
  const seen = new Set();
  return out.filter((c) => { const k = `${c.kind}|${c.message}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

/** The unmet hard gates, most decisive first (credential/years/seniority before the rest). */
export function failedGates(evaluated) {
  const order = { degree: 0, years: 1, seniority: 2, management: 3, certification: 4 };
  // invariant: a hard gate needs the posting sentence it stands on; a gate without one is never applied
  // a gate caps the score only when the résumé POSITIVELY shows it is not met (`caps`, set by the graders below):
  // partial, undated or arguable evidence lowers the score instead (`factor`) and never prints "shows none"
  return (evaluated || []).filter((c) => (c.gate || c.importance === 'required') && c.status === 'unmet' && c.caps === true && GATE_KINDS.has(c.kind) && String(c.posting_quote || c.evidence || '').trim()).sort((a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9));
}

// ── Evidence-graded gates (G 2026-11-10) ─────────────────────────────────────────────────────────────────────
// Every judged constraint carries:
//   grade:    'met' | 'partly' | 'not_shown' | 'cannot_tell'
//   computed: the figure the résumé supports (years), or null;  needed: the posting's figure, or null
//   counted:  [{ title, span, years, line? }] — the résumé roles / lines that were counted, with the dates used
//   caps:     true only when the résumé positively shows the requirement is not met (the score is capped at GATE_CAP)
//   factor:   0..1 — how much the gap lowers the score when it does not cap (1 = no effect)
//   sentence: the plain sentence (also `message`, which every surface already prints)
// `status` keeps its old meaning for every consumer: met | unmet (a real gap) | ask (the person can answer it) |
// partial (language only).
const round1 = (x) => Math.round((Number(x) || 0) * 10) / 10;
function yrs(y) {
  const r = round1(y);
  if (r < 1) return r > 0 ? 'under a year' : 'no time';
  return `${r % 1 === 0 ? r : r} year${r === 1 ? '' : 's'}`;
}
// "3.5 years" stays 3.5 (rounding it to "about 4" made a staff accountant look like he met a 4-year ask); whole-ish
// figures read "about 6 years"
// year-only dates ("2019 – 2020") are estimates: their total is said as "about N"
function aboutR(y, roles) { return (roles || []).some((r) => r.approx) && round1(y) >= 2 ? `about ${Math.round(round1(y))} years` : about(y); }
function about(y) { const r = round1(y); const frac = r % 1; return r < 1 ? 'under a year' : r < 2 ? yrs(r) : frac >= 0.3 && frac <= 0.7 && r < 10 ? `${r} years` : `about ${Math.round(r)} years`; }
const askOf = (need, what, lead) => `${need}+ ${Number(need) === 1 ? 'year' : 'years'} ${lead || 'of'} ${what}`;
// Every role a years figure counted is named (a figure is the sum of exactly the roles listed — coordinator G2 item 1);
// past four, the rest are counted as "and N other jobs".
const tidyTitle = (t) => String(t || '').replace(/\s*\([^()]*\)/g, '').replace(/\s*\(.*$/, '').trim();
function roleList(roles, max = 4) {
  const titled = roles.filter((r) => r.title);
  // a title's aside ("(part time, during school)") is dropped, closed or not
  const tidy = (t) => String(t).replace(/\s*\([^()]*\)/g, '').replace(/\s*\(.*$/, '').trim();
  const named = titled.slice(0, max).map((r) => `${tidy(r.title)}${r.span ? `, ${r.span}` : ''}`);
  const more = titled.length - named.length;
  return `${named.join('; ')}${more > 0 ? `; and ${more} other job${more === 1 ? '' : 's'}` : ''}`;
}
const counted = (roles) => roles.slice(0, 6).map((r) => ({ title: r.title || null, span: r.span || null, years: r.years, field: r.field || null }));
// Stems that name no work on their own ("control" in "inventory control", "high-volume", "fast-paced").
const WEAK_DOMAIN = new Set(['control', 'manag', 'management', 'servic', 'service', 'support', 'system', 'process', 'technic', 'technical', 'general', 'team', 'high', 'volum', 'volume', 'fast', 'pace', 'paced', 'base', 'based', 'hand', 'squar', 'square', 'foot', 'feet', 'environ', 'center', 'centr', 'large', 'larg', 'small', 'busi', 'busy', 'complex', 'complex', 'commerci', 'commercial', 'oper', 'operat', 'operations', 'role', 'lead', 'senior', 'similar', 'divers', 'multi', 'site', 'fulli', 'new', 'client', 'facing', 'face', 'enterpris', 'like',
  // G3: words that name no kind of work on their own — a "Guest EXPERIENCE Team Lead" who does people MANAGEMENT is not
  // "infrastructure management or backend software development experience"
  // job nouns that name no kind of work ("sales role", "technician role", "in a … setting")
  'rol', 'roles', 'position', 'positions', 'job', 'jobs', 'sett', 'setting', 'capacity', 'worker', 'workers', 'technician', 'specialist', 'professional',
  'experienc', 'experience', 'develop', 'development', 'profession', 'professional', 'environment', 'work', 'data', 'product', 'driven', 'drive', 'business', 'skill', 'skills', 'solution', 'solutions', 'industri', 'industry', 'program', 'project', 'customer', 'global', 'strong', 'relev', 'relat', 'year']);
let ALIAS_STEMS = null;
function aliasStems() {
  if (ALIAS_STEMS) return ALIAS_STEMS;
  const byCanon = new Map();
  for (const [alias, canon] of Object.entries(vocabularyAliases())) {
    const st = tokenize(alias).map((t) => t.stem).filter((x) => x.length > 1);
    if (!st.length || st.length > 3) continue;
    byCanon.set(canon, [...(byCanon.get(canon) || []), st]);
  }
  ALIAS_STEMS = byCanon;
  return byCanon;
}
/** The domain of a years requirement as a line test: its specific stems, and every surface of a vocabulary skill it names
 *  ("inventory control" → cycle counts, stock counts, inventory…). */
function domainTest(stems) {
  const specific = stems.filter((x) => !WEAK_DOMAIN.has(x));
  const phrases = [];
  if (stems.length) {
    const set = new Set(stems);
    for (const variants of aliasStems().values()) {
      if (variants.some((v) => v.every((x) => set.has(x)) && v.some((x) => !WEAK_DOMAIN.has(x)))) phrases.push(...variants);
    }
  }
  // a line names the work by its head noun (the last specific word: "credentialing" in "provider enrollment and
  // credentialing"), by two of its specific words, or by a vocabulary surface — "assisted providers" alone is not
  // provider enrollment (G 2026-11-10)
  const head = specific[specific.length - 1];
  return (line) => {
    const have = new Set(tokenize(String(line || '')).map((t) => t.stem));
    if (phrases.some((v) => v.every((x) => have.has(x)))) return true;
    // generic words never carry a match alone: with no specific word there is nothing a line can name (G3 — the old
    // "two of zero specific words" test passed EVERY line)
    if (!specific.length) return false;
    const hits = specific.filter((x) => have.has(x)).length;
    return have.has(head) || (specific.length >= 2 && hits >= 2);
  };
}
/** The posting's object of a years requirement, as words a person would say ("inventory control", "SaaS sales"). */
// "1–3 years in loan processing", "1+ year working with children and adolescent patients", "6+ years in semiconductor
// photolithography operations": the subject after the years, when the sentence has no "experience" word (G2, A3 — these
// fell to the whole-career path)
// …and a gerund subject: "2+ years supervising warehouse teams", "5+ years closing complex Enterprise deals" (G4)
const SUBJECT_AFTER_YEARS_RE = /\b(?:years?|yrs?)\b[^.;\n]{0,30}?\b(working\s+(?:with|in|as|on)|work(?:ed)?\s+(?:with|in|as)|in|with|as\s+an?|as|doing|supporting|within|serving|(?:supervis|manag|lead|clos|sell|run|build|develop|design|teach|train|operat|install|repair|maintain|coordinat|recruit)[a-z]*ing)\s+([^.;\n]{3,140})/i;
function yearsSubject(c) {
  const sent = String(c.sentence || c.evidence || '');
  const m = sent.match(SUBJECT_AFTER_YEARS_RE);
  if (!m) return null;
  const subject = m[2].replace(/\s+(?:is|are|preferred|required|strongly|a\s+plus|highly)\b.*$/i, '').trim();
  if (/^(?:the|this|a|an)\s+(?:field|industry|role|position)\b|^(?:a\s+)?(?:similar|related|relevant|comparable)\b/i.test(subject)) return null;
  return { lead: m[1].toLowerCase().replace(/\s+/g, ' '), subject };
}
function domainLead(c) {
  const sent = String(c.sentence || c.evidence || '').replace(/\bwithin\s+the\s+(?:past|last)\b[^.;]*/gi, '');
  if (yearsDomainClause(sent)) {
    const m = sent.match(/\b(experience|work(?:ing)?)\s+(in|with|as|on|doing|across|supporting|within)\s/i);
    if (!m) return 'of';
    const prep = m[2].toLowerCase();
    if (/^work/i.test(m[1])) return `${m[1].toLowerCase()} ${prep}`;
    return /^(?:with|as|doing|supporting)$/.test(prep) ? `of experience ${prep}` : prep;
  }
  const s2 = yearsSubject(c);
  return s2 ? s2.lead : 'of';
}
function domainPhrase(c) {
  // the reader carries the subject on the alternative ("5+ years of office management" → field "office management") — G5
  const altField = (c.alternatives || []).map((a) => a && !a.degree && a.field).find((f) => f && !/^(?:equivalent|related|relevant|similar)$/i.test(String(f).trim()));
  let raw = String(c.field || altField || yearsDomainClause(c.sentence || c.evidence || '') || (yearsSubject(c) || {}).subject || '').trim();
  // a parenthetical is an aside; an unclosed one (cut by the sentence end) is dropped with everything after it
  // …but a parenthetical LIST of fields is the subject's alternatives ("related office experience (legal, paralegal,
  // finance, or accounting)" — G4)
  const parenList = (String(c.sentence || c.evidence || '').match(/\(([^()]{3,120}(?:,|\bor\b)[^()]{2,120})\)/) || [])[1];
  raw = raw.replace(/\s*\([^()]*\)/g, ' ').replace(/\s*[(\[].*$/, '').trim();
  // a parenthetical that is a preference ("(Home Health, Med-Surg, ICU, or Acute Care preferred)") is not the subject
  if (parenList && !/\d|\$|e\.g\.|i\.e\.|such\s+as|\b(?:preferred|a\s+plus|ideally|desired|desirable|helpful)\b/i.test(parenList)) {
    const alts = parenList.split(/,\s*(?:or\s+|and\s+)?|\s+or\s+/i).map((x) => x.trim()).filter((x) => x && x.split(/\s+/).length <= 3);
    if (alts.length >= 2) return alts.slice(0, 4).join(' or ');
  }
  raw = raw.replace(/^(?:experience\s+(?:in|with|as|doing)\s+)?(?:an?\s+|the\s+)?/i, '').replace(/\s+experience$/i, '');
  // "experience leading or managing…" → "leading or managing…"; "closing B2B deals as an Account Executive or in a similar
  // role" → the role clause is not the subject (G5)
  raw = raw.replace(/^experience\s+/i, '').replace(/\s+as\s+(?:an?\s+|the\s+)?[A-Z][^,;.]*$/, '').replace(/\s+(?:or|and)\s+in\s*$/i, '').replace(/\s+as\s+an?\s*$/i, '');
  // "…backend software development experience in a fast-paced, product-driven environment": the subject ends before
  // "experience" and before a setting ("in a … environment") — the sentence never ends on a dangling "in" (G3)
  raw = raw.replace(/\s+(?:roles?|positions?|jobs?|capacity|settings?)\b(?=\s*$|\s+(?:in|within|at)\b)/i, '').replace(/\s+experience\b.*$/i, '').replace(/\s+(?:in|within|at)\s+(?:an?|the)\s+[^,.;]*?(?:environment|setting|industry|company|organization|startup|team|culture)s?\b.*$/i, '').trim();
  raw = raw.replace(/^(?:(?:proven|demonstrated|working|strong|solid|deep|hands-on|direct|prior|relevant|professional|progressive)\s+)*(?:knowledge|understanding|familiarity|experience|expertise|proficiency)\s+(?:of|with|in)\s+/i, '');
  // qualifiers in front of the subject ("current or recent hands-on medical") are not the subject — G5
  raw = raw.replace(/^(?:(?:current|recent|prior|previous|hands-on|direct|relevant|related|professional|practical|progressive|paid)(?:\s*(?:,|or|and|\/)\s*|\s+))+/i, '');
  raw = raw.replace(/^either\s+/i, '').replace(/\band\s*\/\s*or\b/gi, 'or').replace(/\s*\/\s*/g, ' or ').replace(/\s+/g, ' ').replace(/[\s,;:.]+$/, '');
  // a list of fields offered as a choice: keep at most the first two ("email marketing operations or CRM administration");
  // otherwise the object ends at the first comma / "including" ("software design and development, including building…")
  const isChoice = /,\s*or\s|\sor\s/i.test(raw);
  if (!isChoice) raw = raw.split(/,|\s+(?:including|with|where|while|that|which|and\s+(?:a|an|the)\s)\b/i)[0].trim();
  const items = isChoice ? raw.split(/,\s*(?:or\s+|and\s+)?|\s+or\s+/i).map((x) => x.trim()).filter(Boolean) : [raw];
  let phrase = items.length > 2 ? `${items[0]} or ${items[1]}` : items.join(' or ');
  if (phrase.split(/\s+/).length > 8) phrase = phrase.split(/\s+/).slice(0, 8).join(' ');
  if (/^(?:management|supervisory|managerial|leadership|people management)(?:\s+or\s+(?:management|supervisory|leadership))?$/i.test(phrase)) return 'managing people';
  // a phrase of qualifiers only ("relevant", "professional") names no object
  // a phrase that ends on a modifier names no work ("client-centric", "customer-facing", "data-driven"): the reader cut it
  if (/(?:-centric|-facing|-oriented|-based|-driven|-focused|-related|\bfast-paced|\bhigh-volume)$/i.test(phrase)) return '';
  if (!phraseStems(phrase).length || /^(?:(?:job[- ]related|related|relevant|similar|applicable|comparable|professional|industry|work|hands-on|direct|prior|paid|progressive|proven|demonstrated|demonstrable|solid|strong|successful|significant|extensive|previous|recent)\s*)+(?:industry|field|work|roles?|positions?|settings?|environments?|areas?|capacity)?$/i.test(phrase)) return '';
  return phrase;
}
// A subject that is a field's own bare noun ("building software", "in nursing", "selling … sales") names that field (G4)
const BARE_FIELDS = [[/^(?:\w+\s+){0,2}(?:software|web\s+applications?|backend\s+systems?|code)$/i, 'software'], [/^(?:\w+\s+)?nursing$/i, 'nursing'], [/^(?:\w+\s+)?(?:accounting|bookkeeping)$/i, 'accounting'], [/^(?:\w+\s+)?marketing$/i, 'marketing'], [/^(?:\w+\s+)?(?:b2b\s+|saas\s+)?sales$/i, 'sales'], [/^(?:\w+\s+)?retail$/i, 'retail'], [/^(?:\w+\s+)?construction$/i, 'construction'], [/^(?:\w+\s+)?(?:customer\s+(?:service|support))$/i, 'support'], [/^(?:\w+\s+)?teaching$/i, 'education'], [/^(?:\w+\s+)?hospitality$/i, 'hospitality'], [/^(?:\w+\s+)?warehouse$/i, 'warehouse']];
const SETTING_FIELDS = [[/\b(?:customer|guest|client)[- ](?:facing|service|focused)\b/i, ['support', 'retail', 'food', 'hospitality', 'sales']], [/\b(?:culinary|kitchen|restaurant|food\s+service|hospitality\s+kitchen)\b/i, 'food'], [/\b(?:retail|store)\b/i, 'retail'], [/\b(?:warehouse|distribution|fulfil?lment)\b/i, 'warehouse'], [/\b(?:hospital|clinical|healthcare|acute\s+care)\b/i, 'nursing'], [/\b(?:call\s+center|contact\s+center)\b/i, 'support'], [/\b(?:construction|job\s*site)\b/i, 'construction'], [/\b(?:classroom|school)\b/i, 'education']];
function bareField(phrase) { const t = String(phrase || '').trim(); const hit = BARE_FIELDS.find(([re]) => re.test(t)); return hit ? hit[1] : null; }
/** The specific stems of a subject phrase. */
function phraseStems(phrase) {
  phrase = String(phrase || '').replace(/\bbusiness[\s-]to[\s-]business\b/gi, 'B2B');
  const viaYears = yearsDomain(`5 years of ${phrase} experience`).stems;
  if (viaYears.length) return viaYears;
  return [...new Set(tokenize(String(phrase || '')).map((t) => t.stem).filter((x) => x.length > 2 && !/^(?:and|the|for|with|or|of|in)$/.test(x)))].slice(0, 8);
}
/** The alternatives a subject phrase offers ("loan processing or mortgage operations" → two), each with its stems. */
function subjectItems(phrase) {
  return String(phrase || '').split(/\s+or\s+|,\s*/i).map((x) => x.trim()).filter(Boolean).slice(0, 3).map((x) => ({ text: x, stems: phraseStems(x) })).filter((x) => x.stems.length);
}
// People nouns name WHO, not the work: "children and adolescent patients" is shown by a line about children, never by any
// line with "patients" on it (an RN's whole career was counted for "1+ year working with children" — G2, A3)
const PEOPLE_STEMS = new Set(tokenize('patients customers clients guests members users people individuals persons staff employees stakeholders consumers visitors residents associates workers crew crews teammates hourly').map((t) => t.stem));
/** A line test for a years subject: any alternative named by its head noun, two of its specific words, or a vocabulary
 *  surface; a people noun counts only when the alternative has no other specific word. */
// Trade names a résumé uses for a subject the posting names by its class ("personal lines" ← auto / home / renters /
// umbrella policies) — G5
const SUBJECT_ALIASES = [
  [/(?:^|\s)personal\s+lines?$/i, ['auto policies', 'home policies', 'homeowners', 'renters', 'umbrella', 'personal auto', 'auto, home']],
  [/(?:^|\s)commercial\s+lines?$/i, ['commercial policies', 'business owners', 'general liability', 'workers comp', 'commercial auto']],
  [/^(?:intelligence|intel)(?:\s+analysis)?$/i, ['sigint', 'humint', 'osint', 'all-source', 'intsum', 'intsums', 'mi brigade', 'military intelligence', 'threat reports', 'intelligence']],
  [/^outbound$/i, ['cold calling', 'cold call', 'prospecting', 'outreach', 'sdr', 'bdr', 'outbound']],
  [/^inbound$/i, ['inbound', 'call center', 'incoming calls', 'inbound calls']],
  [/^enterprise$/i, ['enterprise', 'fortune 500', 'large accounts', 'strategic accounts']],
  [/^(?:b2b|business[\s-]to[\s-]business)$/i, ['b2b', 'business-to-business', 'saas', 'small businesses', 'enterprise']],
  [/(?:^|\s)(?:b2b|business[\s-]to[\s-]business)\s+sales$/i, ['b2b', 'business-to-business', 'saas sales', 'enterprise sales', 'account executive']],
];
function subjectTest(items) {
  const tests = items.map((it) => {
    const specific = it.stems.filter((x) => !WEAK_DOMAIN.has(x));
    const work = specific.filter((x) => !PEOPLE_STEMS.has(x));
    const alias = (SUBJECT_ALIASES.find(([re]) => re.test(it.text.trim())) || [null, []])[1].map((a) => tokenize(a).map((t) => t.stem).filter((x) => x.length > 1));
    const viaAlias = (line) => { const have = new Set(tokenize(String(line || '')).map((t) => t.stem)); return alias.some((v) => v.length && v.every((x) => have.has(x))); };
    if (!work.length) { const d = domainTest(it.stems); return (line) => d(line) || viaAlias(line); }
    // a compound noun ("B2B sales", "court records", "semiconductor photolithography") needs every specific word on the
    // line — "age-restricted sales" is not B2B sales; a list ("provider enrollment and credentialing") keeps its head
    if (work.length >= 2 && !/\band\b|&|,/.test(it.text)) {
      return (line) => { const have = new Set(tokenize(String(line || '')).map((t) => t.stem)); return work.every((x) => have.has(x)) || viaAlias(line); };
    }
    const inner = domainTest(work);
    return (line) => inner(line) || viaAlias(line);
  });
  return (line) => tests.some((t) => t(line));
}

// "infrastructure management", "inventory management": managing a thing, not people
const THING_MANAGEMENT_RE = /\b(?:office|front\s+office|practice|records|clinic|store\s+operations|brand|product\s+marketing|marketing|channel|category|social\s+media|community|partner|partnership|program|portfolio|lifecycle|infrastructure|project|program|inventory|property|account|product|data|risk|case|change|configuration|vendor|supply\s+chain|asset|records?|document|content|campaign|category|revenue|portfolio|knowledge|release|incident|quality|time|stakeholder|relationship|systems?|database|cloud|network|fleet|facilit(?:y|ies)|event|budget|contract|pipeline|territory|client|customer)\s+management\b/gi;
const peopleManagement = (phrase) => LEAD_PHRASE_RE.test(String(phrase || '').replace(THING_MANAGEMENT_RE, ' '));
const LEAD_PHRASE_RE = /\b(?:leadership|leading|lead\s+role|supervis\w*|managing\s+(?:people|a\s+team|teams|staff|employees)|people\s+management|management)\b/i;
function gradeYears(c, ctx) {
  const need = Number(c.value);
  const { profile, jobField, now } = ctx;
  void now;
  let phrase = domainPhrase(c);
  // "4+ years of experience in a leadership role within a Shipping Operations environment" is people management first;
  // a setting the sentence names after it ("1+ year of leadership experience in a culinary environment") is kept (G5)
  const settingM = String(c.evidence || c.sentence || '').match(/\b(?:in|within)\s+(?:an?|the)\s+([a-z][\w\s&-]{2,40}?)\s+(?:environment|setting|industry|operation|facility)s?\b/i);
  if ((phrase === 'managing people' || (phrase && peopleManagement(phrase))) && settingM && !new RegExp(escapeRegExp(settingM[1]), 'i').test(phrase)) phrase = `${phrase === 'managing people' ? 'leadership' : phrase} in a ${settingM[1]} environment`;
  // leading people IN a setting: "1+ year of experience leading a shift or crew in a restaurant, coffee shop or other food
  // service setting" — the setting list is met by ANY one item: the role's own words (title, employer, lines), its field,
  // or the field of another role at the same employer (Dutch Bros Coffee: barista → food service). Said in the posting's
  // words (G5, worked example 1).
  const ev = String(c.evidence || c.sentence || '');
  const leadM = ev.match(/\b(?:leading|supervising|managing|running|overseeing)\s+((?:an?\s+|the\s+)?[a-z][\w\s/-]{1,40}?)\s+(?:in|at|within)\s+(?:an?\s+|the\s+)?([^.;()]{3,120})/i);
  const settingRaw = leadM ? leadM[2] : (settingM ? settingM[1] : '');
  if (settingRaw && (phrase === 'managing people' || (phrase && peopleManagement(phrase)) || leadM)) {
    const row = gradeManagement({ ...c, kind: 'years' }, ctx);
    const settings = settingRaw.replace(/\s+(?:settings?|environments?|industry|operations?|facilit(?:y|ies))\b.*$/i, '').split(/,\s*(?:or\s+|and\s+)?|\s+or\s+|\s+and\s+/i)
      .map((x) => x.trim().replace(/^(?:other|similar|any|an?|the)\s+/i, '').replace(/^(?:other|similar)\s+/i, '')).filter((x) => x && x.length <= 40);
    const obj = leadM ? leadM[1].split(/\s+or\s+/i)[0].trim() : 'people';
    // an adjective setting keeps its noun: "a culinary environment", not "a culinary"
    const settingNoun = (settingRaw.match(/\b(settings?|environments?|industry|operations?|facilit(?:y|ies))\b/i) || [null, 'environment'])[1].replace(/s$/, '');
    const say = (it) => (/^[a-z-]+(?:ary|al|ic|ical|ive|-facing|-focused|-paced|-driven|-based)$/i.test(it) ? `${it} ${settingNoun}` : it);
    if (row.grade === 'met' && settings.length) {
      const employer = (r) => { const h = String(r.header || ''); const t = String(r.title || ''); const rest = h.indexOf(t) >= 0 ? h.slice(h.indexOf(t) + t.length) : h; return rest.replace(/^[\s,—–|-]+/, '').split(/\s+-\s+|,\s+|\s{2,}|\s+(?:19|20)\d\d/)[0].trim(); };
      const sameEmployerFields = (r) => { const e = employer(r).toLowerCase(); return e ? profile.roles.filter((x) => x !== r && employer(x).toLowerCase() === e).map((x) => x.field) : []; };
      // the item the role's own words name wins ("coffee shop" ← Dutch Bros Coffee), then one its field covers
      const byWords = (r, it) => { const words = phraseStems(it).filter((x) => !WEAK_DOMAIN.has(x) && !PEOPLE_STEMS.has(x)); const have = new Set(tokenize(`${r.title} ${r.header} ${(r.bullets || []).join(' ')}`).map((t) => t.stem)); return words.some((x) => have.has(x)); };
      const byField = (r, it) => { const f = [titleField(it), bareField(it), ...[].concat((SETTING_FIELDS.find(([re]) => re.test(it)) || [])[1] || [])].filter(Boolean); return f.some((x) => r.field === x || sameEmployerFields(r).includes(x)); };
      const hitItem = (r) => settings.find((it) => byWords(r, it)) || settings.find((it) => byField(r, it));
      const where = profile.management.roles.map((r) => ({ r, it: hitItem(r) })).filter((x) => x.it);
      if (where.length) {
        const first = where[0];
        const yrsHere = profile.yearsWhere((r) => where.some((w) => w.r === r));
        const froms = where.map((w) => w.r.from).filter((x) => x != null);
        const since = froms.length ? Math.floor(Math.min(...froms) / 12) : null;
        const emp = employer(first.r);
        const titles = [...new Set(where.map((w) => tidyTitle(w.r.title)).filter(Boolean))].slice(0, 2);
        const sentence = `${joinList(titles.length ? titles : [tidyTitle(first.r.title)])}${emp ? ` at ${emp}` : ''}${since ? ` since ${since}` : ''} — ${aboutR(yrsHere.years, yrsHere.roles)} leading ${obj} in ${/^[aeiou]/i.test(say(first.it)) ? 'an' : 'a'} ${say(first.it)}; they ask for ${need}.`;
        return finish({ _preferred: !!c._preferred, ...row, computed: yrsHere.years, counted: counted(yrsHere.roles), sentence });
      }
      const fields = [...new Set(profile.management.roles.map((r) => fieldLabel(r.field)).filter(Boolean))];
      return finish({ _preferred: !!c._preferred, ...row, grade: 'partly', factor: 0.85, sentence: `You show ${aboutR(row.computed, profile.management.roles)} leading people (${roleList(profile.management.roles)})${fields.length ? `, in ${joinList(fields.slice(0, 2))}` : ''}; they ask for ${need}+ years of it in ${joinOr(settings.map((x) => `${/^[aeiou]/i.test(x) ? 'an' : 'a'} ${x}`))}. Say what carries over.` });
    }
    return row;
  }
  // leading people with no setting named: the management grader alone
  if (phrase && (phrase === 'managing people' || peopleManagement(phrase))) {
    // managing people IN an area with no setting word ("2+ years supervising warehouse teams"): the area is checked too
    const row = gradeManagement({ ...c, kind: 'years' }, ctx);
    const rest = phrase.replace(LEAD_PHRASE_RE, ' ').replace(/\b(?:supervis\w*|manag\w*|lead\w*|running|overseeing|role|roles|position|capacity|experience|within|in|an?|the|of|environment|setting)\b/gi, ' ').replace(/\s+/g, ' ').trim();
    const st = rest ? phraseStems(rest).filter((x) => !WEAK_DOMAIN.has(x) && !PEOPLE_STEMS.has(x)) : [];
    if (row.grade === 'met' && st.length) {
      const test = domainTest(st);
      const setField = titleField(rest) || bareField(rest) || [].concat((SETTING_FIELDS.find(([re]) => re.test(rest)) || [])[1] || [])[0] || null;
      const where = profile.management.roles.filter((r) => test(r.title) || test(r.header) || r.bullets.some(test) || (setField && r.field === setField));
      if (!where.length) {
        const fields = [...new Set(profile.management.roles.map((r) => fieldLabel(r.field)).filter(Boolean))];
        return finish({ _preferred: !!c._preferred, ...row, grade: 'partly', factor: 0.85, sentence: `You show ${aboutR(row.computed, profile.management.roles)} leading people (${roleList(profile.management.roles)})${fields.length ? `, in ${joinList(fields.slice(0, 2))}` : ''}; they ask for ${need}+ years of it in ${rest}. Say what carries over.` });
      }
    }
    return row;
  }
  const stems = phrase ? phraseStems(phrase) : [];
  const items = phrase ? subjectItems(phrase) : [];
  const lead = domainLead(c);
  const generic = !stems.length && !/\b(?:relevant|related|similar|this\s+field|the\s+field|industry|comparable)\b/i.test(String(c.sentence || c.evidence || ''));
  const total = profile.totalYears || ctx.totalY || 0;
  const roles = profile.roles;
  // the field the requirement is about: the field its words name, else (no object) the posting's own field
  // (a domain word the posting's own title carries — "software" in "Senior Software Engineer I" — is the posting's field)
  const titleStems = new Set(tokenize(String(ctx.jobTitle || '')).map((t) => t.stem));
  // a phrase names a field only through a field's own title words — never through the role-family guesser ("children and
  // adolescent patients" is not patient-care work)
  const phraseField = phrase ? (FIELDS.some((f) => f.title.test(phrase)) ? titleField(phrase) : null) || bareField(phrase) || (stems.some((x) => !WEAK_DOMAIN.has(x) && !PEOPLE_STEMS.has(x) && titleStems.has(x)) ? jobField : null) : null;
  const reqField = phraseField || (!stems.length ? jobField : null);
  // a role is in the field by its title or by what its bullets do (a Process Assistant whose lines are pick/stow is warehouse
  // work — G5)
  // by its title, or — only when the title places it nowhere — by what its bullets do; a placed role in another field (a
  // cashier's "age-restricted sales") never counts as years of the asked work (G5, A4)
  const isFieldRole = (r) => !!reqField && (r.field === reqField || (!r.field && roleDuties(r).includes(reqField)) || (!!r.title && !!(FIELDS.find((x) => x.key === reqField) || {}).title && (FIELDS.find((x) => x.key === reqField) || {}).title.test(r.title) && areAdjacent(r.field, reqField)));
  // a SPECIALTY in front of the field ("cath lab or interventional radiology nursing", "commercial chiller HVAC"): the
  // specialty must be on the résumé — being in the field is not enough (G5)
  const fieldRe = reqField && (FIELDS.find((f) => f.key === reqField) || {}).title;
  // the qualifier of an item = the item minus the field phrase the field's pattern finds in it ("backend software
  // development" → "backend"); a SPECIALTY only when some item has one
  const qualifierOf = (t) => { if (!fieldRe) return ''; const m = String(t).match(new RegExp(fieldRe.source, 'i')); if (!m) return ''; const q = `${t.slice(0, m.index)} ${t.slice(m.index + m[0].length)}`.replace(/\s+/g, ' ').trim(); return phraseStems(q).some((x) => !WEAK_DOMAIN.has(x) && !PEOPLE_STEMS.has(x)) ? q : ''; };
  const specialty = !!(phrase && phraseField && fieldRe && fieldRe.test(phrase) && items.some((it) => qualifierOf(it.text)));
  const isField = (r) => !specialty && isFieldRole(r);
  const testItems = specialty ? items.map((it) => { const t = qualifierOf(it.text) || it.text; return { text: t, stems: phraseStems(t) }; }).filter((x) => x.stems.length) : items;
  const test = testItems.length ? subjectTest(testItems) : domainTest(stems);
  const share = (r) => (r.bullets.length ? r.bullets.filter(test).length / r.bullets.length : 0);
  // a role placed in a field that is neither the subject's field nor next to it never counts by its words: a retail
  // lead's lines do not prove years of software development (G3; known-different ⇒ no years-in-field row met)
  // when the subject names no field ("1+ year of medical experience"), the posting's own field guards it: a role in a known,
  // unrelated field never counts by a shared word — an electrician's "a 4-story medical office building" is not medical
  // experience (G5 CI)
  const guardField = reqField || jobField || null;
  const outside = (r) => !!guardField && !!r.field && r.field !== guardField && !areAdjacent(r.field, guardField);
  // a specialty is shown by one line that names it; a whole subject by a third of a role's lines (or its title)
  // a specialty may be named by a role next to the field or unplaced ("Project Logistics Coordinator" for construction
  // logistics), never by a role in a known, unrelated field — an accountant "closing" the books does not close sales (G5 CI #1)
  const specOk = (r) => !r.field || r.field === reqField || areAdjacent(r.field, reqField);
  const textHit = (r) => (specialty ? specOk(r) : !outside(r)) && stems.length && (test(r.title) || test(String(r.header || '').split(/\s+[—–|]\s+/)[0]) || (r.bullets.length >= 1 && (specialty ? r.bullets.some(test) : share(r) >= 1 / 3)));
  // when some role names the subject itself, those roles are the count — a field role that never names it is not
  // ("4+ years in court records": the Records Custodian, not the law-firm File Clerk — G5)
  const namesField = !!phrase && (FIELDS.some((f) => f.title.test(phrase)) || !!bareField(phrase));
  const anyText = !!phrase && !namesField && roles.some((r) => r.title && textHit(r));
  // a subject that IS a field ("sales or business development") is met only by roles in that field (or unplaced roles
  // whose lines do it) — never by a cashier's "age-restricted sales" line (G5, A4)
  // per alternative: an alternative that names a field ("customer service") is met only by roles in that field; another
  // alternative ("office management") by any role whose words name it (G5)
  // a role whose title names the field counts even when a ladder word places it next door ("Call Center Trainer",
  // "Customer Service Team Lead" for customer-service years); a cashier's "age-restricted sales" line never names sales
  const titleNames = (r, f) => { const re = (FIELDS.find((x) => x.key === f) || {}).title; return !!re && re.test(String(r.title || '')); };
  const altOk = (r) => testItems.some((it) => { const f = FIELDS.some((x) => x.title.test(it.text)) ? titleField(it.text) : bareField(it.text); if (f && r.field && r.field !== f && !titleNames(r, f)) return false; return subjectTest([it])(r.title) || subjectTest([it])(String(r.header || '').split(/\s+[—–|]\s+/)[0]) || (r.bullets.length >= 1 && (specialty ? r.bullets.some(subjectTest([it])) : r.bullets.filter(subjectTest([it])).length / r.bullets.length >= 1 / 3)); });
  // a specialty is named by the role's own words whatever field its title sits in ("Project Logistics Coordinator" shows
  // construction logistics) — G5
  const named = (r) => (anyText ? textHit(r) : isField(r) || (textHit(r) && (specialty ? specOk(r) : !outside(r)) && altOk(r)));
  // scope: 'generic' (any work), 'field' (the posting's / a known field's years), 'subject' (a named kind of work)
  const scope = generic ? 'generic' : reqField && (!phrase || phraseField) ? 'field' : 'subject';
  if (generic) {
    // "5+ years of experience": every dated month counts
    const ok = total + 0.25 >= need;
    return finish({ _preferred: !!c._preferred, scope, grade: ok ? 'met' : total >= need * 0.75 ? 'partly' : 'not_shown', computed: total, needed: need, counted: counted(roles.filter((r) => r.months)), caps: !ok && total < need * 0.5 && !profile.undated,
      factor: ok ? 1 : Math.max(0.6, 0.6 + 0.4 * (total / need)),
      sentence: ok ? `You show ${about(total)} of work in all; they ask for ${need}+.` : `They ask for ${need}+ years of experience; the dated jobs on your résumé add up to ${about(total)}.` });
  }
  let what = phrase || (reqField ? fieldLabel(reqField) : 'this work');
  // a bare adjective is said with its noun: "medical" → "medical experience"
  if (/^[a-z-]+(?:al|ic|ical|ive|ary)$/i.test(what)) what = `${what} experience`;
  // "warehouse or similar environment" is a place: "working in a warehouse or similar environment"
  let leadW = lead;
  if (/\b(?:environment|setting|facility|industry|capacity|atmosphere)s?$/i.test(what) && /^(?:of|in)$/.test(lead)) { leadW = 'working in'; if (!/^(?:an?|the)\s/i.test(what) && !/s$/i.test(what)) what = `${/^[aeiou]/i.test(what) ? 'an' : 'a'} ${what}`; }
  const ask = askOf(need, what, leadW);
  // only titled roles are counted, so the figure is the sum of the roles the sentence names
  const hit = profile.yearsWhere((r) => !!r.title && named(r));
  const H = hit.years;
  const dutyRoles = roles.filter((r) => r.title && !named(r) && !outside(r) && !(namesField && r.field && r.field !== reqField) && stems.length && r.bullets.some(test));
  const D = profile.yearsWhere((r) => dutyRoles.includes(r)).years;
  const adjRoles = roles.filter((r) => !named(r) && !dutyRoles.includes(r) && reqField && r.field && areAdjacent(r.field, reqField));
  const A = profile.yearsWhere((r) => adjRoles.includes(r)).years;
  const adjFields = fieldsPhrase(adjRoles.map((r) => fieldLabel(r.field)));
  // roles counted only because they sit in the field (their words never name the subject) are said as the field:
  // a Marketing Coordinator has "6.5 years in marketing", not "6.5 years in brand management"
  const countedWhat = (rs) => (phrase && reqField && rs.length && rs.every((r) => isField(r) && !(test(r.title) || r.bullets.some(test))) ? fieldLabel(reqField) : what);
  const subjectStems = [...new Set(items.flatMap((it) => it.stems).filter((x) => !WEAK_DOMAIN.has(x) && !PEOPLE_STEMS.has(x)))];
  const base = { scope, reqField: reqField || null, subjectStems: subjectStems.length ? subjectStems : undefined, computed: H, needed: need, counted: counted(hit.roles), domain: stems.length ? stems : undefined, lookedFor: items.length ? items.map((x) => x.text) : undefined };
  if (H + 0.25 >= need) return finish({ _preferred: !!c._preferred, ...base, grade: 'met', caps: false, factor: 1, sentence: `You show ${H < need ? `close to ${yrs(need)}` : aboutR(H, hit.roles)} ${leadW === 'of' ? 'of ' : `${leadW} `}${countedWhat(hit.roles)} (${roleList(hit.roles)}); they ask for ${need}+.` });
  // the roles next to it are named by their FIELD, never listed as if they were counted (a years sentence lists only
  // roles whose title or bullets contain the subject — G2, F)
  const extra = D > 0 ? ` Your duties as ${roleList(dutyRoles, 1)} include ${what} too — if that work counts, say so plainly in the role.`
    : A > 0 ? ` ${about(A).replace(/^\w/, (x) => x.toUpperCase())} in ${adjFields} sits next to it — make the overlap explicit.` : '';
  if (H > 0) {
    const r = H / need;
    const reach = H + D + A * 0.5;
    // positively short: even every dated month of work would not reach half the ask
    const caps = total < need * 0.5 && !profile.undated;
    // roles of the RIGHT kind, short of the ask: close (≥ NEAR_YEARS_SHARE of it, at least a year) is partly, further off is
    // not shown — the true figure either way (G5, director's corrected rule)
    return finish({ _preferred: !!c._preferred, ...base, grade: H >= need * NEAR_YEARS_SHARE && H >= 1 ? 'partly' : 'not_shown', caps, factor: Math.max(0.55, Math.min(0.97, 0.55 + 0.45 * Math.min(1, reach / need))),
      sentence: caps
        ? `They ask for ${ask}; your résumé shows ${about(H)} of it (${roleList(hit.roles)}), and ${about(total)} of work in all.`
        // ONE shape for an unmet years ask: what you have (and where), then what they ask (G5 CI #4)
        : `Your résumé shows ${aboutR(H, hit.roles)} ${leadW === 'of' ? 'of ' : `${leadW} `}${countedWhat(hit.roles)} (${roleList(hit.roles)}); they ask for ${need}+.${extra}`, shortfall: Number((1 - r).toFixed(2)) });
  }
  if (specialty && reqField) {
    const fy = profile.yearsWhere(isFieldRole).years;
    const spec = joinOr(testItems.map((x) => x.text));
    return finish({ _preferred: !!c._preferred, ...base, computed: 0, grade: 'not_shown', caps: false, counted: [], factor: 0.65, specialty: true,
      sentence: fy > 0 ? `They ask for ${ask}; you show ${about(fy)} in ${fieldLabel(reqField)}, but no job on your résumé mentions ${spec}.` : `They ask for ${ask}; no job on your résumé mentions ${spec}.` });
  }
  if (D > 0) {
    return finish({ _preferred: !!c._preferred, ...base, grade: 'not_shown', caps: false, counted: counted(dutyRoles), factor: 0.8,
      sentence: `No job title on your résumé names ${what}, but your duties as ${roleList(dutyRoles, 1)} include it; they ask for ${ask}. Make that work explicit in the role.` });
  }
  if (A > 0) {
    // the field next to it counts at half: plenty of it (an electrician's 9 years against "5+ years of maintenance")
    // costs little, a short stint costs more
    return finish({ _preferred: !!c._preferred, ...base, grade: 'not_shown', caps: false, counted: [], nearest: { field: adjFields, years: A }, factor: Math.round((0.7 + 0.2 * Math.min(1, (A * 0.5) / need)) * 100) / 100,
      sentence: `They ask for ${ask}; no job on your résumé is ${what}, and the nearest is ${about(A)} of ${adjFields}. Make the overlap explicit if the work was the same.` });
  }
  // nothing names the subject, but the person has worked in the posting's own field long enough: the subject is
  // something the résumé's words cannot confirm either way ("technical products", "children and adolescent patients"), so
  // it is asked, not failed — and no role is listed as if it had been counted
  const fieldYears = jobField ? profile.yearsWhere((r) => r.field === jobField).years : 0;
  if (fieldYears >= need * 0.75 && fieldYears > 0) {
    const looked = items.length ? joinList(items.map((x) => x.text)) : what;
    return finish({ _preferred: !!c._preferred, ...base, computed: 0, grade: 'cannot_tell', caps: false, counted: [], factor: 0.88,
      sentence: `They ask for ${ask}; your ${about(fieldYears)} in ${fieldLabel(jobField)} may cover it, but no job on your résumé mentions ${looked}. If one did, say so in that job.` });
  }
  // nothing names the work: it caps only when the résumé positively shows other work (every dated month is placed in
  // another field) or the whole history is too short
  const fields = [...new Set(roles.filter((r) => r.field && r.months).map((r) => fieldLabel(r.field)))];
  const allPlaced = roles.length > 0 && roles.every((r) => !r.months || r.field) && !profile.undated;
  const caps = (total < need * 0.5 && !profile.undated) || (allPlaced && !!reqField && fields.length > 0);
  return finish({ _preferred: !!c._preferred, ...base, computed: 0, counted: [], grade: 'not_shown', caps, factor: 0.65,
    sentence: caps && fields.length && total >= need * 0.5
      ? `They ask for ${ask}; your ${Math.round(total)} years of work are in ${fieldsPhrase(fields)}.`
      : caps ? `They ask for ${ask}; the dated jobs on your résumé add up to ${about(total)} in all.`
        : roles.some((r) => r.months) && roles.every((r) => !r.months || outside(r))
          // every dated job is in a known, unrelated field: say it plainly, never "if one of your jobs involved it"
          ? `Your résumé shows no ${what}; they ask for ${need}+ ${Number(need) === 1 ? 'year' : 'years'}.`
          : `They ask for ${ask}; no job on your résumé names that work. If one of your jobs involved it, say so in that job.` });
}
/** "electrical and warehouse work" — field labels in a sentence, a shared trailing "work" said once. */
function fieldsPhrase(labels) {
  const ls = [...new Set(labels.filter(Boolean))].slice(0, 2);
  if (ls.length === 2 && / work$/.test(ls[0]) && / work$/.test(ls[1])) return `${ls[0].replace(/ work$/, '')} and ${ls[1]}`;
  return joinList(ls);
}
function joinOr(items) { return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`; }
function joinList(items) { return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`; }

function gradeManagement(c, ctx) {
  const { profile } = ctx;
  const need = c.kind === 'years' ? Number(c.value) : null;
  const M = profile.management.years;
  const mRoles = profile.management.roles;
  const duty = profile.management.dutyRoles;
  const total = profile.totalYears || ctx.totalY || 0;
  const what = 'managing people';
  const sub = subCondition(c);
  const base = { computed: M, needed: need, counted: counted(mRoles.length ? mRoles : duty) };
  const lead = (roles) => roleList(roles);
  let row;
  if (M > 0 && (need == null || M + 0.25 >= need)) {
    row = { grade: 'met', caps: false, factor: 1, sentence: need ? `You show ${about(M)} ${what} (${lead(mRoles)}); they ask for ${need}+.` : `Your résumé shows you leading people (${lead(mRoles)}).` };
  } else if (M > 0) {
    const caps = total < need * 0.75 && !profile.undated;
    row = { grade: 'partly', caps, factor: Math.max(0.6, Math.min(0.95, 0.6 + 0.4 * (M / need))), sentence: `Your résumé shows ${about(M)} ${what} (${lead(mRoles)}); they ask for ${need}+.` };
  } else if (duty.length) {
    const line = String(duty[0].mgmt.duty[0] || '').replace(/^[\s•\-*·–]+/, '').replace(/[.;]\s*$/, '');
    // lead duties are real, but a whole work history shorter than the years of managing asked for cannot meet it
    // lead duties stand in for a year or two of managing; against several years of it they are a long way short
    row = { grade: 'partly', caps: (need != null && total + 0.25 < need && !profile.undated) || (c.kind === 'seniority' && Number(c.value) >= 5), factor: need != null && need >= 3 ? 0.6 : 0.75, counted: counted(duty),
      sentence: `Your résumé shows lead duties ("${line.length > 70 ? `${line.slice(0, 67).replace(/\s+\S*$/, '')}…` : line}") but no role where you managed people${need ? `; they ask for ${need}+ years of it` : ''}. If you supervised anyone, say how many and for how long.` };
  } else if (c.kind === 'seniority' && /\b(?:staff|principal|senior|sr\.?|lead)\s+(?:\w+\s+){0,2}(?:engineer|developer|scientist|architect|analyst|designer|researcher)\b/i.test(String(ctx.jobTitle || '')) && !/\b(?:manager|director|head)\b/i.test(String(ctx.jobTitle || ''))) {
    // a staff / principal individual contributor: a level (judged by the level rule), not a team to run (G5)
    row = { grade: 'cannot_tell', caps: false, factor: 1, sentence: `This is a ${String(ctx.jobTitle).replace(/\s*[-–—|(].*$/, '').trim()} role — a senior individual-contributor level, not a people-manager one.` };
  } else if (c.kind === 'seniority' && NOT_PEOPLE_MANAGER_TITLE_RE.test(String(ctx.jobTitle || ''))) {
    // "Account Manager", "Product Manager": a level in the title, not a team to run
    row = { grade: 'cannot_tell', caps: false, factor: 1, sentence: `The title says ${String(c.label || 'manager-level').replace(/^an?\s+/i, '')}, but this job manages accounts or work, not people.` };
  } else if (c.kind === 'seniority') {
    // a director-level role needs someone who has run people; a manager-level title alone does not prove the level
    row = { grade: 'not_shown', caps: Number(c.value) >= 5, factor: 0.75, sentence: `This is a ${String(c.label || 'management-level role').replace(/^an?\s+/i, '')}; no role or line on your résumé shows you leading people. If you have, add it.` };
  } else {
    // only a stated number of years managing caps: a "management experience" line with no figure lowers the score
    row = { grade: 'not_shown', caps: need != null, factor: 0.6, sentence: need ? `They ask for ${need}+ years ${what}; your résumé shows ${about(total)} of work and no role or duty leading others.` : `They ask for experience ${what}; no role or line on your résumé shows you leading others.` };
  }
  if (sub && row.grade === 'met') {
    const sNeed = sub.years;
    const sLead = /\b(?:senior|lead|manag|supervis|principal|staff)/i.test(sub.of);
    const S = sLead ? profile.yearsWhere((r) => r.mgmt.strong || /\b(?:senior|sr\.?|lead|principal|staff|manager)\b/i.test(r.title || '')).years : M;
    if (S + 0.25 < sNeed) row = { ...row, grade: 'partly', factor: Math.min(row.factor, 0.85), sentence: `${row.sentence.replace(/\.$/, '')}; they also ask for ${sNeed} of those years ${sub.of}, and your résumé shows ${about(S)}.` };
  }
  return finish({ _preferred: !!c._preferred, ...base, ...(need != null ? { scope: 'management' } : {}), ...row });
}
// "10+ years …, with at least 4 in a senior or lead capacity": { years: 4, of: 'in a senior or lead capacity' }
function subCondition(c) {
  const sub = c.sub;
  if (!sub) return null;
  if (Array.isArray(sub)) { const x = sub[0]; return x && x.min ? { years: Number(x.min), of: String(x.text || '').replace(/^\d+\+?\s*(?:years?|yrs?)\s*/i, '') } : null; }
  return sub.years ? { years: Number(sub.years), of: String(sub.of || '') } : null;
}
function finish(row) {
  if (row && row._preferred) {
    // a preferred requirement can lower the score a little; it never caps it or sinks it
    row = { ...row, caps: false, factor: 1 - (1 - (Number.isFinite(row.factor) ? row.factor : 1)) * 0.3 };
  }
  // a partial showing under half the ask is still a real gap (status unmet) — it just does not cap the score
  const short = row.needed ? (Number(row.computed) || 0) / row.needed < 0.5 : false;
  const status = row.grade === 'met' ? 'met' : row.grade === 'cannot_tell' ? 'ask' : row.grade === 'partly' && !row.caps && !short ? 'ask' : 'unmet';
  const { _preferred, ...clean } = row;
  void _preferred;
  return { ...clean, status, message: row.sentence, statementStatus: STATEMENT_STATUS[row.grade] || 'cannot_tell' };
}
// how a graded constraint reads as a statement status (statements.js speaks in shown / partly / not_shown / cannot_tell)
const STATEMENT_STATUS = { met: 'shown', partly: 'partly', not_shown: 'not_shown', cannot_tell: 'cannot_tell' };
// The licenses a job TURNS ON: not having one is a positive "not met" for a person outside that field.
const OCCUPATION_LICENCE_RE = /\b(?:real\s+estate\s+licen\w*|insurance\s+(?:producer\s+)?licen\w*|cosmetology\s+licen\w*|RN|registered\s+nurse|LPN|LVN|nursing\s+licen|journeyman|master\s+electrician|electrical\s+licen|CDL|commercial\s+driver|CPA|certified\s+public\s+accountant|teaching\s+licen|teacher\s+certif|pharmacist|physician|medical\s+licen|bar\s+(?:admission|licen)|admitted\s+to\s+(?:the|practice)|licensed\s+(?:clinical|professional|practical|vocational|electrician|plumber|social)|PE\s+licen|professional\s+engineer|dental\s+hygien|LCSW|LPC|LMFT|BCBA|NP\b|nurse\s+practitioner|CRNA)\b/i;
// Fields whose job IS a license: the title names the licensed role, so the license is required whether or not the posting
// spells it out. Held = the résumé names it anywhere.
const LICENSED_TITLES = [
  { field: 'nursing', title: /\b(?:registered\s+nurse|RN|LPN|LVN|licensed\s+(?:practical|vocational)\s+nurse|nurse\s+practitioner)\b/i, held: /\b(?:RN|LPN|LVN|registered\s+nurse|licensed\s+(?:practical|vocational)\s+nurse|NP|APRN|nursing\s+licen[sc]e)\b/, label: 'a nursing license (RN or LPN)' },
  { field: 'electrical', title: /\b(?:journeyman|master\s+electrician|licensed\s+electrician)\b/i, held: /\b(?:journeyman|master\s+electrician|electrical\s+licen[sc]e|licensed\s+electrician)\b/i, label: 'a journeyman electrician license' },
];
function occupationLicense(jobField, jobTitle, jobText, resumeText, rows) {
  const spec = LICENSED_TITLES.find((x) => x.field === jobField && x.title.test(String(jobTitle || '')));
  if (!spec || spec.held.test(withoutInProgress(resumeText))) return null;
  if (rows.some((r) => r.kind === 'certification' && /licen|\bRN\b|LPN|journeyman|master/i.test(String(r.label || '')))) return null;
  const quote = (String(jobText || '').match(/[^.\n]{0,160}\blicen[sc]\w*[^.\n]{0,120}/i) || [String(jobTitle || '')])[0].trim();
  const sentence = `This job requires ${spec.label}; your résumé does not list one.`;
  return { kind: 'certification', label: spec.label, gate: true, importance: 'required', evidence: quote, posting_quote: quote, statementId: null, items: null, status: 'unmet', message: sentence, implied: true };
}

/** Grade fields for the rows the switch above judged by status (degree, certification, language, schedule, …). */
function gradeOther(row, ctx) {
  const { profile, jobField } = ctx;
  if (row.kind === 'degree') {
    if (row.status === 'met') return { grade: 'met', caps: false, factor: 1, sentence: row.message };
    if (row.status === 'ask') return { grade: 'cannot_tell', caps: false, factor: 0.97, sentence: row.message };
    const eduSection = /\n\s*(?:education|academic)/i.test(`\n${ctx.text}`);
    const want = Number(row.value) || 0;  // the lowest degree any alternative accepts (the constraint's value)
    const have = ctx.degreeRank || 0;
    const equivalent = /equivalent/i.test(String(row.label || ''));
    if (!eduSection && !have) return { grade: 'cannot_tell', caps: false, factor: 0.9, status: 'ask', sentence: `${row.message.replace(/\.$/, '')}. If you have schooling, add an education section.`, message: `${row.message.replace(/\.$/, '')}. If you have schooling, add an education section.` };
    const gap = want - have;
    if (gap <= 0) {
      // the degree is met; the years it is paired with ("Bachelor's + 6 years of management") are judged by the years row
      const sentence = `Your ${(ctx.edu && ctx.edu.rank >= have && ctx.edu.own) || String(DEGREE_LABEL[have] || 'education').replace(/^(?:an?|the)\s+/i, '')} meets the education part of this requirement; the years it pairs with are judged on their own.`;
      return { grade: 'partly', caps: false, factor: 1, status: 'met', sentence, message: sentence };
    }
    // a listed degree below the one required (no "or equivalent") is a positive "not met": an ATS knock-out question
    const caps = gap >= 1 && !equivalent && !!row.gate && (have > 0 || eduSection);
    return { grade: caps || gap >= 2 ? 'not_shown' : 'partly', caps, factor: gap >= 2 ? 0.7 : 0.85, sentence: row.message };
  }
  if (row.kind === 'certification') {
    if (row.status === 'met') return { grade: 'met', caps: false, factor: 1, sentence: row.message };
    if (row.state && row.resumeStates && row.resumeStates.length) {
      // the license is held in another state: a real, specific gate when the posting requires it (an Arizona
      // journeyman license is not a Texas one); a compact / "or eligible" ask is a question
      // G3: the same license from another state is a real gap (a new exam or a transfer), not a positive "not met" of the
      // trade — it lowers the score, it does not cap it
      return row.status === 'unmet' ? { grade: 'partly', caps: false, factor: 0.6, sentence: row.message } : { grade: 'cannot_tell', caps: false, factor: 0.9, sentence: row.message };
    }
    // a license the posting says is required (status 'ask' only because the reader did not mark the line a gate)
    const requiredLicense = row.status === 'ask' && !row.prospective && OCCUPATION_LICENCE_RE.test(String(row.label || '')) && /\b(?:required|must)\b/i.test(String(row.posting_quote || '')) && !CREDENTIAL_OPTIONAL_RE.test(String(row.posting_quote || '')) && !CREDENTIAL_PROSPECTIVE_RE.test(String(row.posting_quote || ''));
    if (row.status === 'ask' && !requiredLicense) return { grade: 'cannot_tell', caps: false, factor: row.gate ? 0.93 : 1, sentence: row.message };
    // unmet: an occupation license held by someone outside the field caps; anything else is a gap to answer
    // …or the credential the posting's own TITLE names ("Certified Patient Care Assistant CNA LNA")
    const marks = String(row.label || '').match(/\b[A-Z]{2,6}\b/g) || [];
    const inTitle = marks.some((mk) => new RegExp(`(?<![A-Za-z])${escapeRegExp(mk)}(?![A-Za-z])`).test(String(ctx.jobTitle || '')));
    const occupational = (OCCUPATION_LICENCE_RE.test(`${row.label || ''} ${row.posting_quote || ''}`.slice(0, 300)) && OCCUPATION_LICENCE_RE.test(String(row.label || ''))) || inTitle;
    // the person's own job title implies the license (a Registered Nurse holds an RN license; an electrician's journeyman
    // card) — being in the same broad field does not (a SaaS account executive holds no real estate license)
    const IMPLIES = [[/\bRN\b|nurs/i, /\bnurse\b|\bRN\b/i], [/journeyman|master\s+electrician|electrical\s+licen/i, /electrician/i], [/teach/i, /teacher/i], [/\bCPA\b|public\s+accountant/i, /\bCPA\b/]];
    const inField = profile.roles.some((r) => IMPLIES.some(([lab, title]) => lab.test(String(row.label || '')) && title.test(String(r.title || r.header || ''))));
    if (requiredLicense) { const m = `This job requires ${String(row.label).replace(/^an?\s+/i, 'a ')}; your résumé does not list one.`; return inField ? { grade: 'cannot_tell', caps: false, factor: 0.85, status: 'ask', sentence: row.message } : { grade: 'not_shown', caps: true, factor: 0.5, status: 'unmet', sentence: m, message: m }; }
    // a certificate the posting's title names (CNA) is earned by training inside the field: someone already in it is
    // asked, not capped
    const sameField = !!jobField && profile.roles.some((r) => r.field === jobField || (r.field && areAdjacent(r.field, jobField)));
    if (occupational && !inField && !(inTitle && !OCCUPATION_LICENCE_RE.test(String(row.label || '')) && sameField)) return { grade: 'not_shown', caps: true, factor: 0.5, sentence: row.message };
    return { grade: 'not_shown', caps: false, factor: occupational ? 0.75 : 0.9, sentence: inField && occupational ? `${row.message.replace(/\.$/, '')} — add it if you hold it.` : row.message };
  }
  if (row.kind === 'language') {
    if (row.status === 'met') return { grade: 'met', caps: false, factor: 1, sentence: row.message };
    if (row.status === 'partial') return { grade: 'partly', caps: false, factor: 0.8, sentence: row.message };
    // a language the job is done in (required) that the résumé never mentions weighs heavily, but it is not proof
    return { grade: 'cannot_tell', caps: false, factor: row.importance === 'required' && /\b(?:must|fluent|fluently|bilingual|required)\b/i.test(String(row.posting_quote || '')) ? 0.45 : 0.95, sentence: row.message };
  }
  if (row.conflict) return { grade: 'not_shown', caps: false, factor: 0.9, sentence: row.message };
  return { grade: row.status === 'met' ? 'met' : 'cannot_tell', caps: false, factor: 1, sentence: row.message };
}

/** The score effect of the graded constraints: a cap (GATE_CAP) when any capping gate fails, and the product of factors. */
export function constraintEffect(evaluated) {
  const rows = evaluated || [];
  const capping = failedGates(rows);
  // the weakest gap counts in full; each further gap adds less (two partial gates are not twice as damning as one)
  const fs = rows.filter((c) => !c.caps).map((c) => (Number.isFinite(c.factor) ? c.factor : 1)).filter((f) => f < 1).sort((a, b) => a - b);
  const factor = fs.length ? fs[0] * fs.slice(1).reduce((p, f) => p * Math.pow(f, 0.4), 1) : 1;
  return { cap: capping.length ? GATE_CAP : null, factor: Math.max(0.35, factor), capping };
}

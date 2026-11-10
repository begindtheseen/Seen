// judge2: a résumé read as LINES with a kind each — the job header lines, the DOING lines under them, the skills /
// education / certification / summary lines — and the role each doing line sits under. Rules about how résumés are
// laid out (headings, bullets, a dated header line), not about any one résumé.
//
//   readResume(text) → { lines: Line[], roles: Role[] }
//   Line = { text, kind: 'contact'|'heading'|'role'|'doing'|'skills'|'education'|'cert'|'summary'|'other', role: number|null, bullet }
//   Role = { title, employer, line, current, start, end }

const BULLET_RE = /^\s*(?:[•●▪◦‣∙·*>]|[-–—](?=\s)|\d{1,2}[.)](?=\s))\s*/;
const YEAR_RE = /\b(?:19[6-9]\d|20[0-4]\d)\b/;
const NOW_RE = /\b(?:present|current|now|today)\b/i;
const MONTH_RE = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(?:19|20)\d\d\b/i;
const SECTION = [
  ['experience', /^(?:(?:work|professional|relevant|employment|career|military|additional|other)\s+)?(?:experience|history|employment|background)\b|^work\s+history\b|^employment\b/i],
  ['education', /^(?:education|academic|training|schooling)\b/i],
  ['skills', /^(?:(?:technical|core|key|computer|software|other|additional)\s+)?(?:skills|tools|technologies|competencies|proficiencies|languages)\b|^computer\b|^tools\b/i],
  ['cert', /^(?:certifications?|certificates?|licen[sc]es?|credentials|certs)\b/i],
  ['summary', /^(?:summary|profile|objective|about|professional\s+summary|career\s+summary|highlights|qualifications)\b/i],
  ['other', /^(?:other|volunteer|activities|awards|honors|interests|projects|additional|references)\b/i],
];
const EMAIL_RE = /\S+@\S+\.\w+/;
const PHONE_RE = /\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/;
const DEGREE_RE = /\b(?:diploma|ged|high\s+school|degree|bachelor'?s?|associate'?s?|master'?s?|b\.?\s?s\.?|b\.?\s?a\.?|m\.?\s?s\.?|m\.?\s?a\.?|mba|ph\.?\s?d|a\.?\s?a\.?\s?s?\.?|university|college|academy|coursework|graduated?)\b/i;
// a line about schooling (stricter than DEGREE_RE: "Associate" alone is a job title — "Warehouse Associate")
const SCHOOL_RE = /\b(?:diploma|ged|high\s+school|degree|bachelor'?s?|master'?s|b\.\s?s\.|b\.\s?a\.|m\.\s?s\.|mba|ph\.?\s?d|university|college|coursework|graduated|a\.a\.s?\.?|associate'?s?\s+(?:degree|of|in))\b/i;
const CERT_RE = /\b(?:certif\w*|licen[sc]e[ds]?|cpr|bls|acls|pals|servsafe|osha|cdl|epa\s*608|nate|card)\b/i;
// the separators a header line puts between title, employer, place and dates
const SEP_RE = /\s+[—–|]\s+|\s+-\s+|\s*\|\s*|,\s+(?=[A-Z])|\s+@\s+|\s+at\s+(?=[A-Z])/;

/** @param {string} s */
const clean = (s) => String(s || '').replace(BULLET_RE, '').replace(/\s+/g, ' ').trim();

/** A heading line: short, no sentence, all capitals or a known section word (optionally with a colon). @param {string} t */
function headingOf(t) {
  const words = t.split(/\s+/);
  if (words.length > 6 || /[.!?]$/.test(t)) return null;
  const bare = t.replace(/[:\s]+$/, '');
  for (const [name, re] of SECTION) if (re.test(bare) && (bare.length < 40)) {
    // "Skills: Excel, Word" is a skills LINE, not a heading
    if (/:\s*\S/.test(t)) return null;
    return name;
  }
  if (/^[A-Z][A-Z &/,'-]{2,}$/.test(bare) && !YEAR_RE.test(bare)) return 'other';
  return null;
}

/** A line that lists things (skills line): label + colon, or three+ short items between separators, no sentence. @param {string} t */
function listLine(t) {
  if (/^[A-Za-z /&]{2,30}:\s*\S/.test(t) && !YEAR_RE.test(t.split(':')[0])) return true;
  const items = t.split(/\s*[,;·•|]\s*/).filter(Boolean);
  if (items.length < 3) return false;
  const avg = items.reduce((a, x) => a + x.split(/\s+/).length, 0) / items.length;
  return avg <= 4;
}

/** Title and employer of a header line ("Shift Supervisor, Dutch Bros Coffee - Mesa, AZ 2022 - present"). @param {string} t */
function roleOf(t) {
  const noDates = t.replace(/\(?\s*(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+)?(?:19|20)\d\d\s*(?:[-–—]|to)\s*(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+)?(?:(?:19|20)\d\d|present|current|now)\s*\)?/gi, ' ')
    .replace(/\(?\b(?:19|20)\d\d\b\)?/g, ' ').replace(/\((?:\d+\s*(?:yrs?|years?|mos?|months?))\)/gi, ' ').replace(/\s+/g, ' ').trim().replace(/[,|–—-]+\s*$/, '').trim();
  const parts = noDates.split(SEP_RE).map((x) => x.trim()).filter(Boolean);
  const years = (t.match(/\b(?:19|20)\d\d\b/g) || []).map(Number);
  return { title: parts[0] || noDates, employer: parts[1] || '', start: years.length ? Math.min(...years) : null, end: NOW_RE.test(t) ? null : years.length ? Math.max(...years) : null, current: NOW_RE.test(t) };
}

/**
 * @param {string} text
 * @returns {{ lines: Array<{ text: string, kind: string, role: number|null, bullet: boolean }>, roles: Array<{ title: string, employer: string, line: string, current: boolean, start: number|null, end: number|null }> }}
 */
export function readResume(text) {
  const raw = String(text || '').split(/\r?\n/);
  /** @type {Array<{ text: string, kind: string, role: number|null, bullet: boolean }>} */
  const lines = [];
  /** @type {Array<{ title: string, employer: string, line: string, current: boolean, start: number|null, end: number|null }>} */
  const roles = [];
  let section = 'top';
  let role = /** @type {number|null} */ (null);
  let seenContent = false;
  for (let i = 0; i < raw.length; i++) {
    const original = raw[i];
    if (!original.trim()) continue;
    const bullet = BULLET_RE.test(original);
    const t = clean(original);
    if (!t) continue;
    const push = (/** @type {string} */ kind) => lines.push({ text: t, kind, role: kind === 'doing' ? role : null, bullet });
    // contact block: the first line (a name), and any line with an email or phone number
    if (EMAIL_RE.test(t) || PHONE_RE.test(t) || (!seenContent && lines.length === 0 && t.split(/\s+/).length <= 5 && !YEAR_RE.test(t))) { push('contact'); continue; }
    if (!bullet) {
      const h = headingOf(t);
      if (h) { section = h; role = null; push('heading'); continue; }
    }
    seenContent = true;
    const dated = YEAR_RE.test(t) || MONTH_RE.test(t) || NOW_RE.test(t);
    // a job header: not a bullet, dated (or a "Title — Employer" line right before bullets in the experience section),
    // short, and not an education or certification line
    const nextBullet = raw.slice(i + 1).find((x) => x.trim());
    const labelled = /^[A-Za-z /&]{2,30}:\s*\S/.test(t) && !YEAR_RE.test(t.split(':')[0]);
    const looksHeader = !bullet && !labelled && t.split(/\s+/).length <= 18 && !/[.!?]$/.test(t)
      && ((dated && (SEP_RE.test(t) || /\s(?:19|20)\d\d/.test(t))) || (section === 'experience' && SEP_RE.test(t) && !listLine(t) && nextBullet && BULLET_RE.test(nextBullet)));
    if (looksHeader && section !== 'education' && section !== 'cert' && section !== 'skills' && !(SCHOOL_RE.test(t) && !/\b(?:assistant|aide|teacher|instructor|tutor|coordinator|advisor|counselor|intern)\b/i.test(t))) {
      const r = roleOf(t);
      roles.push({ ...r, line: t });
      role = roles.length - 1;
      if (section === 'top' || section === 'summary') section = 'experience';
      push('role');
      continue;
    }
    // "Skills: …", "TOOLS: …", "Computer: …" is a list line wherever it sits
    if (labelled && !bullet) { push(CERT_RE.test(t.split(':')[0]) ? 'cert' : 'skills'); continue; }
    if (section === 'education') { push(DEGREE_RE.test(t) ? 'education' : CERT_RE.test(t) || listLine(t) ? 'cert' : 'education'); continue; }
    if (section === 'cert') { push(listLine(t) ? 'skills' : 'cert'); continue; }
    if (section === 'skills') { push('skills'); continue; }
    if (!bullet && listLine(t)) { push(CERT_RE.test(t) && !/[,;·•|]/.test(t) ? 'cert' : 'skills'); continue; }
    if (section === 'summary' || (section === 'top' && !bullet)) { push('summary'); continue; }
    if (!bullet && DEGREE_RE.test(t) && YEAR_RE.test(t) && t.split(/\s+/).length <= 14 && role === null) { push('education'); continue; }
    if (!bullet && CERT_RE.test(t) && t.split(/\s+/).length <= 10 && role === null) { push('cert'); continue; }
    if (section === 'other' && !bullet && role === null) { push('other'); continue; }
    // a bullet or sentence under a job (or any bullet outside the special sections) is a doing line
    push('doing');
  }
  return { lines, roles };
}

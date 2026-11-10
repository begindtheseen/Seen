// match2 — WHO THE PERSON IS, read once per résumé text (cached by hash).
//
// Roles come from the product's résumé parser (lib/resume/parse, the same one Studio and the job keys use), with
// the fit engine's own role reader (rolesFromText) as the fallback. Each role is placed with the occupation module
// (occupationOf with the role's employer and its own lines) and given a rung (rung.js). Nothing here is a table of
// titles or fields: an unplaced title stays unknown.
//
// DIRECTION — where the person is going, in this order:
//   1. a target the summary states ("moving into HR", "seeking a dispatcher role"), placed by occupationOf, or kept as
//      its own words when nothing places it (then a listing whose field words all sit inside the target is in it);
//   2. the occupation of the current / latest role that is not an internship, volunteer, seasonal or side job
//      ("part-time through school", "while in nursing school");
//   3. a degree finished within the last year (or in progress) opens the entry rungs of the occupation its field
//      names, when no regular role is the direction.
//   A field the summary says they are leaving ("transitioning from restaurant kitchens into …") is never a direction.
import { createHash } from 'node:crypto';
import { parseResume } from '../../resume/parse/index.js';
import { rolesFromText, titleFromHeader } from '../../optimizer/extractResumeFacts.js';
import { occupationOf } from '../../occupations/index.js';
import { rungOf } from './rung.js';

/** @typedef {{ code: string, title: string, confidence: string, zone?: number, ambiguous?: boolean }} Occ */
/** @typedef {{ title: string, company: string, from: number|null, to: number|null, current: boolean, kind: string,
 *   lines: string[], occ: Occ|null, rung: number, rungStated: boolean, startYear: string|null, endYear: string|null, index: number }} Role */

const CACHE = new Map();

/** @param {string} text */
export function textHash(text) { return createHash('sha1').update(String(text || '')).digest('hex').slice(0, 16); }

/** "2024-01" / "2020" / "present" → month index (a bare year: July in, June out). */
function monthOf(tok, end, now) {
  const t = String(tok || '').trim().toLowerCase();
  if (!t) return null;
  if (/^(present|current|now|today)$/.test(t)) return now.getUTCFullYear() * 12 + now.getUTCMonth();
  let m = t.match(/^(\d{4})-(\d{2})/);
  if (m) return Number(m[1]) * 12 + Number(m[2]) - 1;
  m = t.match(/^(\d{4})$/);
  if (m) return Number(m[1]) * 12 + (end ? 5 : 6);
  return null;
}

// Role kinds the direction skips. Each is a statement about the job, written by the person.
const INTERN_RE = /\b(intern|internship|co-?op|externship|practicum|student (?:worker|assistant))\b/i;
const VOLUNTEER_RE = /\b(volunteer|unpaid|pro bono)\b/i;
const SEASONAL_RE = /\b(seasonal|summer (?:job|position|help|camp)|holiday (?:help|associate|season))\b/i;
const SIDE_RE = /\b(through (?:school|college|university)|while (?:in|attending|studying|at) [a-z ]{0,30}(?:school|college|university|program)|during (?:school|college|university)|student job)\b/i;

/** The lines a person writes before their first section: the summary / objective a parser may not label. */
function headLines(text, doc) {
  const out = [];
  if (doc?.basics?.summary) out.push(String(doc.basics.summary));
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim());
  for (let i = 1; i < Math.min(lines.length, 14); i++) {
    const l = lines[i];
    if (!l) continue;
    if (/^[A-Z][A-Z &/,]{3,}:?$/.test(l) || /^(EXPERIENCE|EDUCATION|SKILLS|CERTIFICATIONS|LICENSES|WORK HISTORY|EMPLOYMENT)\b/.test(l)) break;
    if (/@|https?:|www\.|\b\d{3}[-.)\s]\d{3}[-.\s]\d{4}\b|·/.test(l) && l.length < 160) continue;
    if (/\b(19|20)\d\d\s*[-–—]\s*((19|20)\d\d|present|current)\b/i.test(l)) break;
    if (l.length >= 20 && !out.some((x) => x.includes(l))) out.push(l);
  }
  // an OBJECTIVE / SUMMARY / PROFILE section anywhere
  const sec = String(text || '').match(/\n\s*(?:OBJECTIVE|SUMMARY|PROFILE|PROFESSIONAL SUMMARY|CAREER OBJECTIVE|GOAL)S?\s*:?\s*\n([\s\S]{20,600}?)(?:\n\s*\n|\n[A-Z][A-Z &/]{3,}:?\s*\n)/);
  if (sec && !out.some((x) => x.includes(sec[1].trim().slice(0, 40)))) out.push(sec[1].trim());
  const inline = String(text || '').match(/^(?:OBJECTIVE|SUMMARY|GOAL)\s*:\s*(.{20,400})$/im);
  if (inline && !out.some((x) => x.includes(inline[1].trim().slice(0, 40)))) out.push(inline[1].trim());
  return out;
}

// A stated target: the words after a verb of seeking or moving. The phrase is placed by occupationOf; a leaving
// clause ("from restaurant kitchens") names the field they are leaving.
const TARGET_RE = /\b(?:seeking|pursuing|looking for|moving into|transitioning (?:from [^.;\n]{2,60}? )?(?:in)?to|switching (?:careers? )?(?:from [^.;\n]{2,60}? )?(?:in)?to|pivoting (?:from [^.;\n]{2,60}? )?(?:in)?to|changing careers? (?:from [^.;\n]{2,60}? )?(?:in)?to|career change (?:from [^.;\n]{2,60}? )?(?:in)?to|ready (?:to move|for) (?:in)?to)\s+(?:an? |the |my )?(?:first |new |entry[- ]level |full[- ]time |part[- ]time )*([^.;\n(]{3,90})/i;
const LEAVING_RE = /\b(?:transitioning|switching|pivoting|moving|changing careers?|career change|stepping away|leaving)\s+(?:away\s+)?(?:from|out of)?\s*([^.;\n]{3,60}?)\s+(?:(?:in)?to|for)\b|\bleaving\s+(?:the\s+)?([^.;\n]{3,40}?)(?=[,.;]|\s+(?:to|for|and)\b)/i;

/** @param {string} phrase */
function cleanTarget(phrase) {
  return String(phrase || '')
    .replace(/\b(?:role|position|job|career|opportunit(?:y|ies)|work|roles|positions|jobs)\b.*$/i, '')
    .replace(/\b(?:where|that|which|with|at|in a|in an|within|near|around|close to)\b.*$/i, '')
    .replace(/[,–—-]+\s*$/, '').trim();
}

/**
 * @param {string} text the résumé text
 * @param {{ now?: Date }} [opts]
 */
export function readPerson(text, { now = new Date() } = {}) {
  const key = `${textHash(text)}␟${now.getUTCFullYear() * 12 + now.getUTCMonth()}`;
  const hit = CACHE.get(key);
  if (hit) return hit;
  const p = readPersonUncached(String(text || ''), now);
  if (CACHE.size > 500) CACHE.clear();
  CACHE.set(key, p);
  return p;
}

/** @param {string} text @param {Date} now */
function readPersonUncached(text, now) {
  let doc = null;
  try { doc = parseResume({ text }); } catch { doc = null; }
  /** @type {Array<{ title: string, company: string, start: any, end: any, type: string, bullets: string[] }>} */
  let raw = [];
  if (doc && Array.isArray(doc.experience) && doc.experience.length) {
    raw = doc.experience.map((r) => ({ title: String(r.title || '').trim(), company: String(r.company || '').trim(), start: r.start, end: r.end, type: String(r.employmentType || ''), bullets: (r.bullets || []).map((b) => (typeof b === 'string' ? b : b?.text || '')).filter(Boolean) }));
  } else {
    for (const r of rolesFromText(text, { now })) {
      const title = r.title || titleFromHeader(r.header) || '';
      const company = String(r.header || '').replace(title, '').replace(/\b(19|20)\d\d\b.*$/, '').replace(/^[\s—–|,-]+|[\s—–|,-]+$/g, '').trim();
      raw.push({ title, company, start: null, end: null, type: '', bullets: r.bullets, _from: r.from, _to: r.to });
    }
  }
  const lowerText = text.toLowerCase();
  /** @type {Role[]} */
  const roles = [];
  raw.forEach((r, i) => {
    if (!r.title || r.title.length > 90) return;
    const from = /** @type {any} */ (r)._from ?? monthOf(r.start, false, now);
    const to = /** @type {any} */ (r)._to ?? monthOf(r.end, true, now);
    const current = /^(present|current|now)$/i.test(String(r.end || '').trim()) || (to != null && to >= now.getUTCFullYear() * 12 + now.getUTCMonth());
    // the header line as written (type, parenthetical) — "(part-time through school)" sits there
    const hdr = text.split(/\r?\n/).find((l) => l.includes(r.title)) || '';
    const blob = `${r.title} ${r.company} ${r.type} ${hdr}`;
    const kind = INTERN_RE.test(r.title) ? 'internship' : VOLUNTEER_RE.test(blob) ? 'volunteer' : SEASONAL_RE.test(blob) ? 'seasonal' : SIDE_RE.test(blob) ? 'side' : 'regular';
    let occ = null;
    try { occ = occupationOf(r.title, { employer: r.company, lines: r.bullets }); } catch { occ = null; }
    if (occ && occ.confidence === 'guess') occ = null; // a guess is a tie-break, never who the person is
    const rg = rungOf(r.title, occ);
    const yr = (/** @type {any} */ tok) => { const m = String(tok || '').match(/^(\d{4})/); return m && lowerText.includes(m[1]) ? m[1] : null; };
    roles.push({ title: r.title, company: r.company, from, to, current, kind, lines: r.bullets.slice(0, 10), occ: occ ? { code: occ.code, title: occ.title, confidence: occ.confidence, zone: occ.zone, ambiguous: !!occ.ambiguous } : null, rung: rg.rung, rungStated: rg.stated, startYear: yr(r.start), endYear: yr(r.end), index: i });
  });

  const head = headLines(text, doc).join(' \n ');
  // stated target
  let target = null;
  const tm = head.match(TARGET_RE);
  if (tm) {
    const phrase = cleanTarget(tm[1]);
    if (phrase.length >= 3) {
      let occ = null;
      try { occ = occupationOf(phrase); } catch { occ = null; }
      if (occ && occ.confidence === 'guess') occ = null;
      target = { phrase, occ: occ ? { code: occ.code, title: occ.title, confidence: occ.confidence, zone: occ.zone } : null };
    }
  }
  const lm = head.match(LEAVING_RE);
  const leavingPhrase = lm ? String(lm[1] || lm[2] || '').trim() : '';

  // direction role(s): current regular roles, else the latest-ending regular role
  const regular = roles.filter((r) => r.kind === 'regular');
  const nowMi = now.getUTCFullYear() * 12 + now.getUTCMonth();
  let dir = regular.filter((r) => r.current);
  if (!dir.length && regular.length) {
    const lastEnd = Math.max(...regular.map((r) => r.to ?? r.from ?? -1));
    dir = regular.filter((r) => (r.to ?? r.from ?? -1) === lastEnd);
  }
  // a role in the field they say they are leaving is not their direction
  const leaves = (/** @type {Role} */ r) => {
    if (!leavingPhrase) return false;
    const w = leavingPhrase.toLowerCase().split(/[^a-z]+/).filter((x) => x.length >= 4).map((x) => x.slice(0, 5));
    const blob = `${r.title} ${r.lines.join(' ')} ${r.occ?.title || ''}`.toLowerCase();
    return w.some((x) => blob.includes(x));
  };
  if (target && leavingPhrase) dir = dir.filter((r) => !leaves(r));
  // education: a degree finished within a year (or in progress) whose field occupationOf places
  /** @type {Array<{ occ: Occ, field: string, degree: string, year: string|null }>} */
  const degrees = [];
  for (const e of (doc?.education || [])) {
    const field = String(e.field || '').replace(/[^A-Za-z &/-]/g, ' ').trim();
    if (field.length < 3) continue;
    const endMi = monthOf(e.end, true, now);
    const studying = !e.end || (endMi != null && endMi > nowMi);
    if (!(studying || (endMi != null && nowMi - endMi <= 12))) continue;
    let occ = null;
    try { occ = occupationOf(field); } catch { occ = null; }
    if (!occ || occ.confidence === 'guess') continue;
    degrees.push({ occ: { code: occ.code, title: occ.title, confidence: occ.confidence, zone: occ.zone }, field, degree: String(e.degree || ''), year: (String(e.end || '').match(/^(\d{4})/) || [])[1] || null });
  }
  return { roles, direction: dir, target, leavingPhrase, degrees, head, doc: { summary: head } };
}

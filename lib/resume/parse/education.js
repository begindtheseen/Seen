// Education parsing: lines of an EDUCATION section → entries {school, degree, field, location,
// start/end, gpa, details}. Handles one-line entries ("B.S. Computer Science, UC San Diego, 2018"),
// stacked entries (degree line, then school line, then details), and school-first layouts.

import { findDateRange, findTrailingDate, stripDateRange } from './dates.js';
import { DEGREE_RE, SCHOOL_RE, GPA_RE, HONORS_RE, LOCATION_INLINE_RE, LOCATION_RE } from './lexicon.js';
import { newId } from '../model.js';

const wordCount = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).length;
const DEGREE_CORE = DEGREE_RE.source.slice(3, -10); // strip the leading \b( and the trailing )(?![a-z])
const DEGREE_FULL_RE = new RegExp(`^(${DEGREE_CORE})\\.?(?:\\s*(?:of|in|,|:|–|—|-)\\s*(.+))?$`, 'i');
const FIELD_RE = /\b(?:in|of)\s+([A-Z][A-Za-z&,\-\s]{2,60}?)(?=\s*(?:[,|–—(]|$|\bfrom\b|\bat\b))/;

// Strong separators first ("|", "—", "–", "•", " - "); commas second — a comma may sit inside
// a school name ("University of California, San Diego") or a degree ("B.S., Computer Science").
function splitStrong(text) {
  return String(text || '').split(/\s*(?:\||—|–|•|·)\s*|\s+-\s+/).map((p) => p.trim()).filter(Boolean);
}
function splitComma(text) {
  return String(text || '').split(/,\s+(?=[A-Z0-9])|\s+at\s+(?=[A-Z])|\s+from\s+(?=[A-Z])/).map((p) => p.trim().replace(/^[,;:]+|[,;:]+$/g, '').trim()).filter(Boolean);
}
const trimSeps = (t) => String(t || '').replace(/^[\s|,;:–—-]+|[\s|,;:–—-]+$/g, '').trim();

function newEntry() { return { id: newId('e'), school: '', degree: '', field: '', location: '', start: '', end: '', dateText: '', gpa: '', details: [], _lines: 0 }; }

function applyDegree(entry, p) {
  // "Coursework toward A.A.S. Business Management" → degree "Coursework toward A.A.S.", field "Business
  // Management" (it rendered "Coursework, toward A.A.S. Business Management" — round 5, Maria)
  const cw = p.match(/^((?:relevant\s+)?coursework\s+(?:toward|towards|in|for)\s+)(.+)$/i);
  if (cw) { applyDegree(entry, cw[2].trim()); entry.degree = `${cw[1].trim()} ${entry.degree}`.replace(/\s+/g, ' ').trim(); return; }
  const m = p.match(DEGREE_FULL_RE);
  if (m) { entry.degree = m[1].trim(); if (m[2]) entry.field = m[2].trim(); }
  else {
    const fm = p.match(FIELD_RE);
    const dm = p.match(DEGREE_RE);
    entry.degree = dm ? p.slice(0, dm.index + dm[0].length).trim() : p;
    entry.field = fm ? fm[1].trim() : p.slice(dm ? dm.index + dm[0].length : 0).replace(/^[\s,:–—-]*(?:in|of)?\s*/i, '').trim();
  }
  // "Bachelor of Science in Nursing" → degree "Bachelor of Science", field "Nursing".
  const inSplit = entry.degree.match(/^(.+?)\s+in\s+(.+)$/i);
  if (inSplit && !entry.field) { entry.degree = inSplit[1].trim(); entry.field = inSplit[2].trim(); }
  // "BSc (Hons) Accounting" → the honours marker belongs to the degree.
  const hons = entry.field.match(/^\((hons|honours|honors)\)\s*(.*)$/i);
  if (hons) { entry.degree = `${entry.degree} (${hons[1]})`; entry.field = hons[2].trim(); }
}

function foldEducationLine(entry, text) {
  let t = text;
  const gpa = t.match(GPA_RE);
  if (gpa) { entry.gpa = gpa[1]; t = trimSeps(t.replace(gpa[0], ' ').replace(/\(\s*\)/g, ' ')); }
  const dr = findDateRange(t);
  if (dr) { entry.start = dr.start; entry.end = dr.end; t = trimSeps(stripDateRange(t)); }
  for (const strong of splitStrong(t)) {
    if (!strong) continue;
    if (LOCATION_RE.test(strong)) { if (!entry.location) entry.location = strong.replace(/\.$/, ''); continue; }
    if (/^(?:19|20)\d{2}$/.test(strong)) { if (!entry.end) entry.end = strong; continue; }
    let piece = strong;
    const td = findTrailingDate(piece);
    if (td && !entry.end) { entry.end = td.token; if (td.expected) entry.dateText = 'Expected'; piece = trimSeps(piece.slice(0, td.index)); }
    const lm = piece.match(LOCATION_INLINE_RE);
    if (lm && !entry.location && lm.index > 0 && lm.index + lm[0].length >= piece.length - 1) { entry.location = lm[0].trim(); piece = trimSeps(piece.slice(0, lm.index)); }
    if (!piece) continue;
    let prevWasDegree = false;
    for (const p of splitComma(piece)) {
      if (!p) continue;
      if (/^(?:19|20)\d{2}$/.test(p)) { if (!entry.end) entry.end = p; prevWasDegree = false; continue; }
      if (LOCATION_RE.test(p)) { if (!entry.location) entry.location = p; prevWasDegree = false; continue; }
      if (HONORS_RE.test(p) && !DEGREE_RE.test(p) && !SCHOOL_RE.test(p)) { entry.details.push({ id: newId('b'), text: p }); prevWasDegree = false; continue; }
      if (SCHOOL_RE.test(p) && !DEGREE_RE.test(p.replace(/\bhigh school\b/i, ''))) {
        if (!entry.school) entry.school = p;
        else if (entry._schoolGuess) {
          // The earlier "school" was a guess from an unlabeled piece; a real school word wins and
          // the guess becomes the field of study.
          if (entry.degree && !entry.field) entry.field = entry.school; else entry.details.push({ id: newId('b'), text: entry.school });
          entry.school = p; entry._schoolGuess = false;
        } else entry.details.push({ id: newId('b'), text: p });
        entry._lastWasSchool = true; prevWasDegree = false;
        continue;
      }
      if (DEGREE_RE.test(p)) {
        if (entry.degree) entry.details.push({ id: newId('b'), text: p });
        else applyDegree(entry, p);
        entry._lastWasSchool = false; prevWasDegree = true;
        continue;
      }
      // "University of California, San Diego" — a short capitalized tail right after the school is
      // part of its name, not a separate fact.
      if (entry.school && entry._lastWasSchool && /^[A-Z]/.test(p) && wordCount(p) <= 3 && !/\d/.test(p)) { entry.school += `, ${p}`; continue; }
      entry._lastWasSchool = false;
      // Unknown piece: right after the degree it is the field; otherwise a school without a school
      // word ("MIT", "Front Range CC").
      if (prevWasDegree && entry.degree && !entry.field && wordCount(p) <= 6) { entry.field = p; prevWasDegree = false; continue; }
      prevWasDegree = false;
      if (!entry.school && /^[A-Z]/.test(p) && wordCount(p) <= 6) { entry.school = p; entry._schoolGuess = true; entry._lastWasSchool = true; }
      else if (!entry.field && entry.degree && wordCount(p) <= 6) entry.field = p;
      else entry.details.push({ id: newId('b'), text: p });
    }
  }
}

/**
 * @param {object[]} lines rich lines of the section
 * @returns {object[]} education entries
 */
export function parseEducation(lines) {
  const entries = [];
  let cur = null;
  const flush = () => { if (cur && (cur.school || cur.degree || cur.details.length)) entries.push(cur); cur = null; };
  for (const line of lines) {
    const text = line.text.trim();
    if (!text) continue;
    const hasDegree = DEGREE_RE.test(text);
    const hasSchool = SCHOOL_RE.test(text);
    const isDetail = line.bullet || (!hasDegree && !hasSchool && !findDateRange(text) && !findTrailingDate(text) && !LOCATION_RE.test(text) && !GPA_RE.test(text) && wordCount(text) > 6)
      || /^(relevant )?coursework|^minor|^concentration|^thesis|^honou?rs|^activities|^gpa/i.test(text) && !hasSchool;
    if (isDetail) {
      if (!cur) cur = newEntry();
      const gpa = text.match(GPA_RE);
      if (gpa && !cur.gpa) { cur.gpa = gpa[1]; if (text.replace(gpa[0], '').replace(/[^A-Za-z]/g, '').length < 3) continue; }
      cur.details.push({ id: newId('b'), text: line.bullet ? text : text });
      continue;
    }
    // Does this line start a new entry or complete the current one?
    const startsNew = cur && cur._lines >= 1 && (
      (hasDegree && cur.degree) || (hasSchool && cur.school) || (cur._lines >= 3) ||
      (findDateRange(text) && cur.end && cur._lines >= 2) ||
      // "ICAEW — ACA Qualification (2020)": a new institution line once the entry already has
      // both a school and a degree.
      (cur.school && cur.degree && /^[A-Z]/.test(text) && !line.bullet && (hasSchool || hasDegree || findTrailingDate(text)))
    );
    if (startsNew) flush();
    if (!cur) cur = newEntry();
    foldEducationLine(cur, text);
    cur._lines += 1;
  }
  flush();
  return entries.map(({ _lines, _lastWasSchool, _schoolGuess, ...e }) => e);
}

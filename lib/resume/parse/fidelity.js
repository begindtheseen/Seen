// Source-line accounting: is every line the person wrote somewhere in the document?
//
// The Studio judge found an electrician's whole licences section, an admin's career-break note and a
// summary gone from the parsed document — and the ATS check still said 100 / A, because it compared
// the render with the already-damaged parse (2026-11-10). This is the check that compares against
// the SOURCE: every non-blank line of what the person uploaded is either placed in the document or
// returned in `unplaced`, with the section it sat under.
//
// How a line is placed (two passes over the document's own words, each document word used once):
//   1. exact — the line's words appear as one contiguous run of the document's words (bullets,
//      skills, summaries, a wrapped line that was rejoined, a role header printed in the canonical
//      "Title — Company | Place | Dates" shape: punctuation and case are ignored);
//   2. loose — at least `minShare` of its words are found among the document words not yet used
//      (a header whose pieces were re-ordered: "College of DuPage — Coursework" → "Coursework —
//      College of DuPage").
// A line found only loosely and short of every word is `altered` (words were lost); a line under
// `minShare` is `unplaced`. Section headings are structure, page furniture (page numbers, Seen's
// own footer) and a repeat of an earlier line (a running header) are not content.
// Pure + deterministic, no I/O.

import { serializeToText } from '../model.js';
import { PAGE_NOISE_RE, FOOTER_NOISE_RE } from './lexicon.js';
import { recognizeHeading } from './headings.js';
import { HEADER_VOCAB } from './lexicon.js';

export const FIDELITY_VERSION = 'fidelity_v1';

const MONTHS = { january: 'jan', february: 'feb', march: 'mar', april: 'apr', june: 'jun', july: 'jul', august: 'aug', september: 'sep', sept: 'sep', october: 'oct', november: 'nov', december: 'dec' };
// labels the parser rightly drops ("Phone: 555…", "Email:"), and words a date range is printed without
const DROPPABLE = new Set(['phone', 'tel', 'mobile', 'cell', 'email', 'e', 'mail', 'address', 'linkedin', 'github', 'website', 'web', 'portfolio', 'location', 'to', 'current', 'now', 'present', 'till', 'until', 'date', 'dates', 'since', 'at', 'in']);

const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const SEASON = { spring: 'mar', summer: 'jun', fall: 'sep', autumn: 'sep', winter: 'dec' };

/** A line's words, normalised the same way on both sides (dates in every written form read alike). */
export function fidelityTokens(s) {
  return String(s || '')
    .toLowerCase()
    // "03/2019" · "3-2019" → "mar 2019"; "Q3 2019" → "jul 2019"; "Summer 2017" → "jun 2017"
    .replace(/\b(0?[1-9]|1[0-2])\s*[/.-]\s*((?:19|20)\d{2})\b/g, (m, mo, y) => `${MON[Number(mo) - 1]} ${y}`)
    .replace(/\bq([1-4])\s*((?:19|20)\d{2})\b/g, (m, q, y) => `${MON[(Number(q) - 1) * 3]} ${y}`)
    .replace(/\b(spring|summer|fall|autumn|winter)\s+((?:19|20)\d{2})\b/g, (m, se, y) => `${SEASON[se]} ${y}`)
    // "GPA 3.7/4.0" is printed "GPA 3.7"
    .replace(/(\d\.\d{1,2})\s*\/\s*4(?:\.0+)?\b/g, '$1')
    .replace(/[‘’`´]/g, "'")
    .replace(/'s\b/g, '')
    .replace(/[^a-z0-9+#$%' ]+/g, ' ')
    .replace(/'/g, '')
    .split(/\s+/)
    .filter((w) => w && (w.length > 1 || /\d/.test(w)) && !/^[+#$%]+$/.test(w))
    .map((w) => MONTHS[w] || w);
}

function isFurniture(line) {
  const t = line.trim();
  return !t || PAGE_NOISE_RE.test(t) || FOOTER_NOISE_RE.test(t) || !/[A-Za-z0-9]/.test(t);
}

function headingOf(line, blankAbove = false) {
  const t = line.trim().replace(/^[\s=*_~#•·–—-]+|[\s=*_~#•·–—:-]+$/g, '');
  if (!t || t.split(/\s+/).length > 8) return null;
  const norm = t.toLowerCase().replace(/&/g, 'and').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (HEADER_VOCAB.has(norm) || HEADER_VOCAB.has(norm.replace(/ and /g, ' & '))) return t;
  const letters = t.replace(/[^A-Za-z]/g, '');
  const caps = letters.length >= 3 && letters === letters.toUpperCase();
  return recognizeHeading(t, { structural: caps || blankAbove || /[:：]$/.test(line.trim()) }) ? t : null;
}

/**
 * @param {string} sourceText what the person uploaded (the extracted text of a file)
 * @param {object|string} doc a ResumeDoc, or already-rendered text to account against
 * @param {{ minShare?: number }} opts
 * @returns {{ version, placed, total, altered: object[], unplaced: object[], headings: number, ignored: number, linePct: number }}
 *   unplaced / altered items: { line, index (0-based source line), nearestSection, missing: string[] }
 */
export function parseFidelity(sourceText, doc, { minShare = 0.8 } = {}) {
  const docText = typeof doc === 'string' ? doc : serializeToText(doc);
  const D = fidelityTokens(docText);
  const used = new Array(D.length).fill(false);
  // word → positions, for the exact-run search
  const at = new Map();
  D.forEach((w, i) => { if (!at.has(w)) at.set(w, []); at.get(w).push(i); });

  const srcLines = String(sourceText || '').replace(/\r\n?/g, '\n').split('\n');
  let section = '';
  let headings = 0, ignored = 0;
  const seen = new Set();
  const rows = [];
  srcLines.forEach((raw, index) => {
    const line = raw.trim();
    if (isFurniture(line)) { if (line) ignored++; return; }
    const h = headingOf(line, index > 0 && !srcLines[index - 1].trim());
    if (h) { section = h; headings++; return; }
    // an inline heading's label ("Objective: CNA looking for…") is structure, not content
    const label = line.match(/^([A-Za-z][A-Za-z &/]{2,38}):\s+(\S.*)$/);
    const body = label && headingOf(label[1], true) ? label[2] : line;
    const toks = fidelityTokens(body).filter((w) => !DROPPABLE.has(w));
    const key = toks.join(' ');
    if (!toks.length) { ignored++; return; }
    if (seen.has(key)) { ignored++; return; } // a running header / repeated line
    seen.add(key);
    rows.push({ line, index, nearestSection: section, toks });
  });

  // Pass 1: exact contiguous runs, longest lines first (a long line claims its words before a
  // short line that shares them).
  const order = [...rows].sort((a, b) => b.toks.length - a.toks.length || a.index - b.index);
  for (const r of order) {
    const first = at.get(r.toks[0]) || [];
    for (const p of first) {
      if (p + r.toks.length > D.length) break;
      let ok = true;
      for (let k = 0; k < r.toks.length; k++) if (used[p + k] || D[p + k] !== r.toks[k]) { ok = false; break; }
      if (ok) { for (let k = 0; k < r.toks.length; k++) used[p + k] = true; r.exact = true; break; }
    }
  }
  // Pass 2: loose — the remaining document words, used once each.
  const free = new Map();
  D.forEach((w, i) => { if (!used[i]) free.set(w, (free.get(w) || 0) + 1); });
  const unplaced = [], altered = [];
  let placed = 0;
  // lines that are nearly whole claim their words first, so a damaged line is not blamed for a word a
  // neighbouring line lost ("Remote" belongs to the role header, not to "(open to remote)")
  const potential = (r) => r.toks.filter((w) => (free.get(w) || 0) > 0).length / r.toks.length;
  const loose = rows.filter((x) => !x.exact).map((r) => ({ r, p: potential(r) })).sort((a, b) => b.p - a.p || a.r.index - b.r.index).map((x) => x.r);
  for (const r of loose) {
    const take = [], missing = [];
    for (const w of r.toks) { if ((free.get(w) || 0) > 0) { free.set(w, free.get(w) - 1); take.push(w); } else missing.push(w); }
    const share = take.length / r.toks.length;
    const item = { line: r.line, index: r.index, nearestSection: r.nearestSection, missing };
    if (share >= minShare) { placed++; if (missing.length) altered.push(item); }
    else { for (const w of take) free.set(w, free.get(w) + 1); unplaced.push(item); }
  }
  placed += rows.filter((x) => x.exact).length;
  unplaced.sort((a, b) => a.index - b.index); altered.sort((a, b) => a.index - b.index);
  const total = rows.length;
  return { version: FIDELITY_VERSION, placed, total, altered, unplaced, headings, ignored, linePct: total ? Math.round((placed / total) * 100) : 100 };
}

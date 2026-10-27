// What a person meant by what they typed in the job search box — without a model.
//
// Audit 2026-10-27 (125 live searches): a misspelt role returned nothing ("cashir", "nurce", "recepcionist",
// "electrition" — 0 matches each, then 24 unrelated listings); natural phrasing was matched as one literal phrase
// ("work from home data entry" → data engineers; "jobs that pay 20 an hour"); and a place typed into the query box
// ("nurse jobs in tucson") was searched as part of the role. parseSearchQuery() separates the role words from the
// modifiers, fixes a misspelt role word against the words Seen's listings actually use, and reports every change so
// the page can say "Showing results for cashier" with a way back to the exact words.
import { TITLE_VOCABULARY } from './titleVocabulary.data.js';
import { editDistance } from '../text/editDistance.js';
import { resolveLocation } from '../geo/resolveLocation.js';

let _vocab = null;
function vocab() {
  if (_vocab) return _vocab;
  _vocab = new Map();
  for (const line of TITLE_VOCABULARY.split('\n')) {
    const i = line.lastIndexOf(' ');
    if (i > 0) _vocab.set(line.slice(0, i), Number(line.slice(i + 1)) || 0);
  }
  // words a search may use that a title rarely does — never "corrected"
  for (const w of ['remote', 'hiring', 'jobs', 'near', 'entry', 'level', 'shift', 'weekend', 'weekends', 'overnight', 'hourly', 'temp', 'seasonal', 'cdl', 'hvac', 'budtender', 'caregiver', 'esthetician', 'doula', 'sommelier', 'barback', 'busser', 'dishwasher', 'stocker', 'janitor', 'custodian', 'porter', 'groomer', 'lifeguard', 'nanny', 'babysitter', 'tutor', 'notary', 'phlebotomist', 'phlebotomy', 'paralegal', 'bookkeeper', 'receptionist', 'cashier', 'valet']) if (!_vocab.has(w)) _vocab.set(w, 3);
  return _vocab;
}
const allowed = (len) => (len <= 3 ? 0 : len <= 8 ? 1 : 2);

/** How many listings' titles or employer names use a word (0 for a word Seen's listings never use). */
export function wordCount(word) {
  return vocab().get(String(word || '').toLowerCase()) || 0;
}

/**
 * The singular a plural search word stands for ("nurses" → "nurse", "drivers" → "driver", "cashiers" → "cashier"),
 * or null. Audit 2026-10-27: "nurses · Phoenix" found 0 listings in the area while "nurse" found 59 — the plural only
 * matched titles written in the plural. A word whose plural is the common form ("sales", "operations", "logistics",
 * "services") stays: the singular must be used by more listings than the plural.
 */
export function singularWord(word) {
  const w = String(word || '').toLowerCase();
  if (w.length < 4 || !/^[a-z]+s$/.test(w) || /(?:ss|us|is)$/.test(w)) return null;
  const v = vocab();
  const cands = w.endsWith('ies') ? [`${w.slice(0, -3)}y`] : w.endsWith('es') ? [w.slice(0, -2), w.slice(0, -1)] : [w.slice(0, -1)];
  const plural = v.get(w) || 0;
  for (const c of cands) if ((v.get(c) || 0) > Math.max(plural, 2)) return c;
  return null;
}

/**
 * The closest word Seen's listings use for a word they never use, or null. Only a clear typo is fixed: the word is
 * absent from the vocabulary, the replacement is used by at least 10 listings and is within 1 edit (2 for 9+ letters).
 */
export function correctWord(word) {
  const w = String(word || '').toLowerCase();
  if (w.length < 4 || !/^[a-z]+$/.test(w)) return null;
  const v = vocab();
  if ((v.get(w) || 0) >= 3) return null;
  const max = allowed(w.length);
  let best = null, bd = 99, bc = 0;
  for (const [cand, count] of v) {
    if (count < 10 || Math.abs(cand.length - w.length) > max) continue;
    const d = editDistance(w, cand, max);
    if (d > max) continue;
    if (d < bd || (d === bd && count > bc)) { best = cand; bd = d; bc = count; }
  }
  return best;
}

const MODIFIERS = [
  // [kind, pattern] — matched on the lowercased query, whole words; the matched words are removed from the role
  ['remote', /\b(?:remote(?:ly)?|work(?:ing)?[- ]from[- ]home|wfh|from home|telecommute|telework|virtual)\b/g],
  ['part_time', /\bpart[- ]?time\b/g],
  ['full_time', /\bfull[- ]?time\b/g],
  ['entry', /\b(?:entry[- ]?level|no experience(?: (?:needed|required|necessary))?|beginners?|first job)\b/g],
  ['night', /\b(?:night[- ]?shifts?|overnight shifts?|graveyard(?: shift)?|(?:3rd|third) shift|nights)\b/g],
  ['weekend', /\bweekends?(?: only)?\b/g],
  ['filler', /\b(?:jobs?|hiring(?: now)?|now hiring|near me|nearby|openings?|positions?|careers?|immediate(?:ly| start| hire)?|asap|urgent(?:ly)?)\b/g],
];
// "$20 an hour", "20/hr", "20+ per hour", "jobs that pay 25 an hour", "paying $18 hourly"
const PAY_RE = /\b(?:that\s+pays?\s+|paying\s+|pays?\s+)?\$?\s?(\d{2,3})(?:\.\d{1,2})?\s*\+?\s*(?:\/\s*h(?:ou)?r\b|(?:an|per|a)\s+hour\b|hourly\b|hr\b|\/hour\b)/;

/**
 * @param {string} raw the search box text
 * @param {{ hasLocation?: boolean, exact?: boolean }} [opts] hasLocation: the location box is filled (a place in the
 *   query is then left alone); exact: the person asked for their words as typed (no typo fixes)
 * @returns {{ role: string, remote: boolean, partTime: boolean, fullTime: boolean, entry: boolean, night: boolean,
 *   weekend: boolean, payMin: number|null, location: string|null, corrections: Array<{from: string, to: string}>,
 *   changed: boolean, browse: boolean }} browse: no role words were typed — list what is near, ranked by the modifiers
 */
export function parseSearchQuery(raw, { hasLocation = false, exact = false } = {}) {
  const original = String(raw || '').replace(/\s+/g, ' ').trim();
  const out = { role: original, remote: false, partTime: false, fullTime: false, entry: false, night: false, weekend: false, payMin: null, location: null, corrections: [], changed: false };
  if (!original) return out;
  let q = original.toLowerCase();

  // a place typed after "in"/"near"/"around" when the location box is empty: "nurse jobs in tucson"
  if (!hasLocation) {
    const m = q.match(/\s(?:in|near|around)\s+([a-z][a-z .,'-]{1,40})$/);
    if (m) {
      const r = resolveLocation(m[1]);
      if (r && (r.kind === 'city' || r.kind === 'state')) { out.location = r.label; q = q.slice(0, m.index).trim(); }
      else if (r && r.kind === 'remote') { out.remote = true; q = q.slice(0, m.index).trim(); }
    }
  }

  const pay = q.match(PAY_RE);
  if (pay) {
    const n = Number(pay[1]);
    if (n >= 8 && n <= 200) { out.payMin = n; q = (q.slice(0, pay.index) + ' ' + q.slice(pay.index + pay[0].length)).replace(/\b(?:that|which)\s*$/, ''); }
  }

  const flags = { remote: 'remote', part_time: 'partTime', full_time: 'fullTime', entry: 'entry', night: 'night', weekend: 'weekend' };
  let role = q;
  for (const [kind, re] of MODIFIERS) {
    const next = role.replace(re, ' ');
    if (next !== role) { if (flags[kind]) out[flags[kind]] = true; role = next; }
  }
  // the joining words a removed modifier leaves at the edges ("cashier that", "with data entry") — only when something
  // was removed, so a name that ends in "a" or starts with "in" ("chick fil a", "in-n-out") is never cut
  if (role !== q) role = role.replace(/(?:^|\s)(?:and|or|with|for|a|an|the|that|which|in|at|to|paying|pay|pays)(?=\s*$)/g, ' ').replace(/^\s*(?:and|or|with|for|a|an|the|in|at)\s+/, ' ');
  role = role.replace(/[,;]+/g, ' ').replace(/\s+/g, ' ').trim();
  // nothing left but modifiers ("part time", "remote", "jobs that pay 20 an hour"): no role to match — the caller lists
  // what is near, ranked by the modifiers
  if (!/[a-z0-9]/.test(role)) role = '';

  if (!exact) {
    const words = role.split(' ');
    const fixed = words.map((w) => {
      const c = correctWord(w);
      if (c && c !== w) { out.corrections.push({ from: w, to: c }); return singularWord(c) || c; }
      return singularWord(w) || w;
    });
    role = fixed.join(' ');
  }
  out.role = role;
  out.changed = role !== original.toLowerCase() || !!out.location;
  out.browse = !role;
  return out;
}

// A job search as a URL: /jobs?q=cashier&loc=Phoenix%2C+AZ&r=50&sort=recent&type=Part-time …
//
// Searches used to live only in React state: the URL stayed /jobs, so a search could not be shared,
// a reload lost it and Back from a listing landed on an empty page (audit 2026-10-24, H2). The jobs
// page writes the COMMITTED search here (Enter / Search / a picked suggestion / a filter or sort
// change after a search — never per keystroke) and reads it back on load. Defaults are left out so a
// plain search reads /jobs?q=cashier&loc=Phoenix%2C+AZ. Pure — shared by the hook and its test.

const SORTS = new Set(['best', 'transparency', 'waste', 'recent']);
const NICHES = new Set(['tech', 'healthcare', 'retail', 'logistics', 'finance', 'other']);
const LEVELS = new Set(['entry', 'mid', 'senior']);
const TYPES = new Set(['Full-time', 'Part-time']);
const POSTED = new Set(['1', '7', '30']);
const RADII = new Set(['0', '10', '25', '50', '100']);
export const DEFAULT_RADIUS = '25';

const clip = (v) => String(v == null ? '' : v).trim().slice(0, 200);

/**
 * The query string for a search (no leading "?"; '' when there is no query).
 * @param {{ q?: string, loc?: string, radius?: string, sort?: string, niche?: string, level?: string, type?: string, posted?: string }} s
 */
export function searchQueryString(s = {}) {
  const q = clip(s.q);
  if (!q) return '';
  const p = new URLSearchParams();
  p.set('q', q);
  const loc = clip(s.loc);
  if (loc) p.set('loc', loc);
  const r = String(s.radius ?? '');
  if (RADII.has(r) && r !== DEFAULT_RADIUS) p.set('r', r);
  if (SORTS.has(String(s.sort)) && s.sort !== 'best') p.set('sort', String(s.sort));
  if (NICHES.has(String(s.niche))) p.set('niche', String(s.niche));
  if (LEVELS.has(String(s.level))) p.set('level', String(s.level));
  if (TYPES.has(String(s.type))) p.set('type', String(s.type));
  if (POSTED.has(String(s.posted))) p.set('posted', String(s.posted));
  return p.toString();
}

/**
 * A search read from a URL's query string. Unknown or malformed values fall back to the defaults —
 * a hand-edited link never puts the page in a state its controls cannot show.
 * @param {string} search location.search (with or without "?")
 */
export function readSearchQuery(search) {
  let p;
  try { p = new URLSearchParams(String(search || '')); } catch { p = new URLSearchParams(); }
  const pick = (k, set, dflt = '') => { const v = p.get(k) || ''; return set.has(v) ? v : dflt; };
  return {
    q: clip(p.get('q')),
    loc: clip(p.get('loc')),
    radius: pick('r', RADII, DEFAULT_RADIUS),
    sort: pick('sort', SORTS, 'best'),
    niche: pick('niche', NICHES),
    level: pick('level', LEVELS),
    type: pick('type', TYPES),
    posted: pick('posted', POSTED),
  };
}

/** The shareable path for a search: "/jobs?q=…" (just "/jobs" with no query). */
export function searchPath(s) {
  const qs = searchQueryString(s);
  return qs ? `/jobs?${qs}` : '/jobs';
}

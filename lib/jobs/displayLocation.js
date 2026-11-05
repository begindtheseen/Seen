// A listing's location as a person should read it — one line, not a board's whole office list.
//
// Employer boards store every office a role may sit in, joined with ";" or "|" (sometimes commas) and
// each one spelled out to the country: "Bozeman, Montana, United States; Missoula, Montana, United
// States; Open to Remote" on a row the list called "Remote", "Toronto Canada, San Francisco, Remote in
// US, Remote in Canada" on a Stripe row (round-3 review 2026-11-03, printed raw on /saved and the card).
// Here:
//   • ", United States" / ", USA" / ", US" come off every part (Seen lists US jobs);
//   • a state written out becomes its code ("Bozeman, Montana" → "Bozeman, MT");
//   • a part naming a non-US place is dropped when there are others (a US search never needs Toronto);
//   • one place prints as itself;
//   • several places print "Remote (US)" (or "Remote") first when any part says remote, then at most
//     two named places, then "+N more";
//   • duplicates (the same town twice) count once.
// Used by JobCard, JobDetailDrawer, SwipeJobDeck, /jobs/[id] and /saved; never by the search or the geo
// code. Tests: lib/jobs/displayLocation.test.mjs.

import { locationScope } from './usLocation.js';

// Only a comma-separated country suffix comes off ("Phoenix, AZ, United States"); "Remote - US" is written as is.
const US_SUFFIX_RE = /,\s*(?:united states(?: of america)?|u\.s\.a\.?|usa|u\.s\.|us)\s*$/i;
const REMOTE_RE = /\bremote\b|\banywhere\b|work from home|\bwfh\b|\btelecommute\b/i;
const US_WORD_RE = /\b(?:us|usa|u\.s\.a?\.?|united states|america|nationwide)\b/i;
const MAX_NAMED = 2;

const STATE_CODE = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO', connecticut: 'CT',
  delaware: 'DE', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
  kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI',
  minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH',
  'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH',
  oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD',
  tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV',
  wisconsin: 'WI', wyoming: 'WY', 'district of columbia': 'DC', 'puerto rico': 'PR',
};
const STATE_NAME_RE = new RegExp(`,\\s*(${Object.keys(STATE_CODE).join('|')})(?=\\s*(?:,|$))`, 'i');
const BARE_STATE_RE = new RegExp(`^(?:${Object.keys(STATE_CODE).join('|')}|[A-Z]{2})$`, 'i');

/** One part, tidied: no country suffix, the state as its code, single spaces. */
function tidy(raw) {
  let p = String(raw || '').replace(/\s+/g, ' ').trim();
  p = p.replace(US_SUFFIX_RE, '').trim().replace(/[,\s]+$/, '');
  p = p.replace(STATE_NAME_RE, (m, name) => `, ${STATE_CODE[name.toLowerCase()]}`);
  return p;
}

/** The parts of a stored location, each tidied, in order and deduplicated. */
export function locationParts(location) {
  const s = String(location || '').trim();
  if (!s) return [];
  let raw = s.split(/\s*(?:;|\||\s\/\s|\s•\s|\s·\s)\s*/).filter(Boolean);
  // A comma-joined office list ("Toronto Canada, San Francisco, Remote in US, Remote in Canada") only
  // reads as one when a part says remote and there are at least three segments; a segment that is only a
  // state goes back onto the city before it ("Remote, Phoenix, AZ" → "Remote" + "Phoenix, AZ").
  if (raw.length === 1 && REMOTE_RE.test(s) && s.split(',').length >= 3) {
    const segs = s.split(',').map((x) => x.trim()).filter(Boolean);
    const glued = [];
    for (const seg of segs) {
      if (glued.length && BARE_STATE_RE.test(seg) && !REMOTE_RE.test(glued[glued.length - 1])) glued[glued.length - 1] += `, ${seg}`;
      else glued.push(seg);
    }
    raw = glued;
  }
  const seen = new Set();
  const out = [];
  for (const r of raw) {
    const p = tidy(r);
    if (!p) continue;
    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

/**
 * @param {string|null|undefined} location
 * @returns {string} "" for nothing; the single place; "Remote (US) · San Francisco"; "Austin, TX · Denver, CO · +1 more"
 */
export function displayLocation(location) {
  const parts = locationParts(location);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  const remote = parts.filter((p) => REMOTE_RE.test(p));
  let named = parts.filter((p) => !REMOTE_RE.test(p));
  // A US search never needs the Toronto office: non-US places are dropped when a US place or a remote
  // part is there to show instead.
  const usNamed = named.filter((p) => locationScope(p) !== 'non_us');
  if (usNamed.length || remote.length) named = usNamed;
  const out = [];
  if (remote.length) {
    const saysUs = remote.some((p) => US_WORD_RE.test(p)) || (named.length > 0 && named.every((p) => locationScope(p) === 'us'));
    out.push(saysUs ? 'Remote (US)' : 'Remote');
  }
  out.push(...named.slice(0, MAX_NAMED));
  const more = named.length - MAX_NAMED;
  if (more > 0) out.push(`+${more} more`);
  return out.join(' · ');
}

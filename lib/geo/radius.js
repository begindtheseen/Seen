// ONE way to say where a listing is and whether it is inside a search radius — used by job search
// (api/jobs.js), the résumé matches, the job-alert emails (api/cron-job-matches.js) and the coordinate
// backfill (scripts/geo/backfill-job-coords.mjs). Plain node: no Next/React imports, no network.
//
//   placeListing(row)                 → { lat, lng, source: 'coords'|'text'|null, points, states, remote, remoteOnly, hybrid, us }
//   withinRadius(row, center, miles)  → { in: boolean, miles: number|null, by: 'coords'|'text'|'county'|'name'|null, place: string|null }
//   placeSearch(text)                 → { kind: 'point'|'state'|'remote'|'none', lat, lng, state, label, zip, suggestions }
//   isRemoteListing(row)              → true when the listing's location/type says remote (and not hybrid)
//   isNonUsLocation(text)             → true for a place outside the US (placeListing marks it `us: false`, no points)
//
// Rules (tests: lib/geo/radius.test.mjs):
//  • A row with usable coordinates is measured from them — unless its text names only a whole state
//    ("Arizona"), whose stored coordinates are the state's middle and not a place.
//  • A row with no coordinates is measured from the place(s) its location text names (lib/geo/usPlaces.js).
//  • A listing that names several places ("Phoenix, AZ; Tempe, AZ") is inside when ANY of them is; its
//    distance is the nearest one's.
//  • A whole state is never a point: a state-only row is never inside a city radius.
//  • Non-US text has no place.
//  • `in` is distance ≤ miles exactly (no buffer), so a wider radius always holds every row of a narrower one.

import { geocodePlace, geocodeAll, distanceMiles, placesByPopulation, placeCandidates, isDevicePhrase, namesCounty, findCounties, countyLabel, countiesOfPlace, countyReachMiles } from './usPlaces.js';
import { locationScope } from '../jobs/usLocation.js';

const REMOTE_RE = /\bremote\b|\bwork from home\b|\bwfh\b|\banywhere\b|\btelecommute\b|\bvirtual\b/i;
const HYBRID_RE = /\bhybrid\b/i;
// "Remote - Phoenix, AZ", "Remote (Austin, TX)", "remote within the US", "Remote: Texas" — the place belongs to the remote role.
const REMOTE_PART_RE = /\b(?:100% |fully )?remote\b(?:\s*(?:[-–—:(]|in|within|based in|from)\s*[^;|/)]*\)?)?/gi;

// Places outside the US that lib/jobs/usLocation.js does not name (its list is the employer-board ingest's):
// regions and the countries it leaves out. Used only when the line carries no US marker, so "Lebanon, PA",
// "Peru, IN" and "Mexico, MO" stay American.
const FOREIGN_RE = new RegExp(`\\b(?:${[
  'europe', 'european', '(?<!new\\s)england', 'scotland', 'wales', 'northern ireland', 'emea', 'apac', 'latam', 'africa', 'african', 'asia', 'asian', 'middle east', 'oceania', 'nordics?', 'dach', 'benelux', 'balkans',
  'afghanistan', 'albania', 'algeria', 'andorra', 'angola', 'armenia', 'azerbaijan', 'bahrain', 'bangladesh', 'belarus', 'benin', 'bhutan',
  'bolivia', 'bosnia', 'botswana', 'brunei', 'burkina faso', 'burundi', 'cambodia', 'cameroon', 'cape verde', 'chad', 'congo', 'cote d.?ivoire',
  'ivory coast', 'cyprus', 'djibouti', 'ecuador', 'el salvador', 'eritrea', 'estonia', 'eswatini', 'ethiopia', 'fiji', 'gabon', 'gambia', 'ghana',
  'guatemala', 'guinea', 'guyana', 'haiti', 'honduras', 'iceland', 'iraq', 'jamaica', 'kazakhstan', 'kenya', 'kosovo', 'kuwait', 'kyrgyzstan',
  'laos', 'latvia', 'lesotho', 'liberia', 'libya', 'liechtenstein', 'luxembourg', 'madagascar', 'malawi', 'maldives', 'mali', 'malta',
  'mauritania', 'mauritius', 'moldova', 'monaco', 'mongolia', 'montenegro', 'morocco', 'mozambique', 'myanmar', 'namibia', 'nepal', 'nicaragua',
  'niger', 'nigeria', 'north macedonia', 'oman', 'pakistan', 'palestine', 'papua new guinea', 'paraguay', 'qatar', 'rwanda', 'saudi arabia',
  'senegal', 'serbia', 'seychelles', 'sierra leone', 'slovenia', 'somalia', 'sri lanka', 'sudan', 'suriname', 'syria', 'tajikistan', 'tanzania',
  'togo', 'trinidad', 'tunisia', 'turkmenistan', 'uganda', 'ukraine', 'uruguay', 'uzbekistan', 'venezuela', 'yemen', 'zambia', 'zimbabwe',
  'dakar', 'lagos', 'nairobi', 'accra', 'cairo', 'casablanca', 'kampala', 'kigali', 'addis ababa', 'johannesburg', 'cape town', 'karachi', 'lahore', 'dhaka', 'colombo', 'kathmandu',
].join('|')})\\b`, 'i');

/** Is the listing outside the US? (lib/jobs/usLocation.js, plus the regions and countries it leaves out.) */
export function isNonUsLocation(text) {
  const t = String(text || '');
  if (!t.trim()) return false;
  // usLocation reads "New England" as England; it is the six north-eastern states.
  if (/\bnew england\b/i.test(t)) return isNonUsLocation(t.replace(/\bnew england\b/gi, ' '));
  // A line that ends in a US state ("Mexico, MO", "Paris, TX", "London, KY", "Peru, IN") is American.
  const tail = (t.replace(/\([^)]*\)/g, ' ').split(/,|\s+-\s+/).map((x) => x.trim().replace(/\s+\d{5}(?:-\d{4})?$/, '')).filter(Boolean).pop() || '');
  if (/^[A-Z]{2}$/.test(tail) && STATE_FULL[tail]) return false;
  if (Object.values(STATE_FULL).some((n) => n.toLowerCase() === tail.toLowerCase())) return false;
  const scope = locationScope(t);
  if (scope === 'non_us') return true;
  // The line ENDS in a foreign country ("Virginia Water, Surrey, England") — "Virginia" is not the state.
  const last = t.split(/,|\s+-\s+/).map((x) => x.trim()).filter(Boolean).pop() || '';
  if (FOREIGN_RE.test(last) && !/\b(?:usa?|united states)\b/i.test(t)) return true;
  if (scope === 'us') return false;
  return FOREIGN_RE.test(t);
}

const usable = (p) => !!p && p.lat != null && p.lng != null && p.lat !== '' && p.lng !== ''
  && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)) && !(Number(p.lat) === 0 && Number(p.lng) === 0);

/** Does the listing say it is remote (its location or type), and not hybrid? */
export function isRemoteListing(row) {
  const text = `${row?.location || ''} ${row?.type || ''}`;
  if (HYBRID_RE.test(text)) return false;
  if (REMOTE_RE.test(text)) return true;
  // A location that names no place ("United States", "USA", blank) whose text says plainly near the top that the
  // job is remote — the same reading as job search (api/jobs.js). A description that merely mentions remote
  // ("not remote", "remote teams we support") does not count, and neither does one under a named town.
  const head = String(row?.description || '').slice(0, 600);
  const namesPlace = geocodeAll(String(row?.location || '')).points.length > 0;
  return !namesPlace && /\b(?:fully|100%|is|are) remote\b|\bremote[- ](?:first|friendly|ok|position|role|work|job)\b|\bwork from home\b|\bwork from anywhere\b/i.test(head)
    && !/\b(?:not|no|non-?)\s*remote\b|\bon-?site only\b/i.test(head);
}

/**
 * Where a listing is.
 * @param {{ location?: string, lat?: number|null, lng?: number|null, type?: string }} row
 */
export function placeListing(row) {
  const text = String(row?.location || '');
  const remote = isRemoteListing(row || {});
  const hybrid = HYBRID_RE.test(text);
  // Remote ONLY: the listing offers no workplace of its own. "New York, NY/Remote" and "San Francisco, CA, New York,
  // NY, or Remote within the US" have offices (in the area when one is near); "Remote - Phoenix, AZ" and
  // "Remote (Austin, TX)" are remote jobs that name a place.
  const remoteOnly = remote && !(text && geocodeAll(text.replace(REMOTE_PART_RE, ' ')).points.length);
  if (text && isNonUsLocation(text)) return { lat: null, lng: null, source: null, points: [], states: [], remote, remoteOnly, hybrid, us: false };
  const { points: textPoints, states } = text ? geocodeAll(text) : { points: [], states: [] };
  const stateOnlyText = !textPoints.length && states.length > 0;
  const hasCoords = usable(row) && !stateOnlyText;
  const coords = hasCoords ? { lat: Number(row.lat), lng: Number(row.lng), name: textPoints[0]?.name ?? null, state: textPoints[0]?.state ?? null, by: 'coords' } : null;
  // One named place + coordinates → the coordinates (the finer point). Several named places → every one counts.
  const points = coords
    ? (textPoints.length >= 2 ? [coords, ...textPoints.map((p) => ({ ...p, by: p.county ? 'county' : 'text' }))] : [coords])
    : textPoints.map((p) => ({ ...p, by: p.county ? 'county' : 'text' }));
  const first = points[0] || null;
  return {
    lat: first ? first.lat : null,
    lng: first ? first.lng : null,
    source: first ? first.by : null,
    points,
    states,
    remote,
    remoteOnly,
    hybrid,
    us: true,
  };
}

const label = (p) => (p && p.county ? `${p.county}, ${p.state}` : p && p.name ? `${p.name}, ${p.state}` : p && p.state ? p.state : null);

/**
 * Is a listing inside `miles` of `center`?
 * `nameKey` (optional): the searched city, lowercased — a row with no placeable text that still names
 * it ("KPNX-TV Phoenix") counts as inside with an unknown distance (`by: 'name'`).
 * @returns {{ in: boolean, miles: number|null, by: 'coords'|'text'|'name'|null, place: string|null }}
 */
export function withinRadius(row, center, miles, { nameKey = '' } = {}) {
  const m = Number(miles);
  if (!usable(center) || !Number.isFinite(m) || m < 0) return { in: false, miles: null, by: null, place: null };
  const placed = row && row.points ? row : placeListing(row);
  let best = null, bestD = Infinity;
  for (const p of placed.points) {
    const d = distanceMiles(center, p);
    if (d < bestD) { bestD = d; best = p; }
  }
  if (best) {
    // Membership is judged on the distance as shown (tenths of a mile), so "10.0 mi" is never outside a 10-mile
    // search; still monotonic in `miles`, so widening never drops a row.
    const rounded = Math.round(bestD * 10) / 10;
    return { in: rounded <= m, miles: rounded, by: best.by || 'text', place: label(best) };
  }
  if (nameKey && nameKey.length >= 3 && !placed.states.length) {
    const text = String(row?.location || '').toLowerCase();
    if (new RegExp(`\\b${nameKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(text) && locationScope(text) !== 'non_us') {
      return { in: true, miles: null, by: 'name', place: null };
    }
  }
  return { in: false, miles: null, by: null, place: null };
}

/**
 * Does the row belong to a county search? A town it names lies in that county (Census place parts; a place not on
 * that list, by the nearest county middle in its state), or its text names the county ("Pico Heights, Los Angeles
 * County"). Returns the town that counted ("Newton, NJ"), or null.
 */
export function inCounty(row, county) {
  const placed = row && row.points ? row : placeListing(row);
  for (const p of placed.points) {
    if (p.state !== county.state) continue;
    if (countiesOf(p).includes(county.name)) return p.county ? `${p.county}, ${p.state}` : (p.name ? `${p.name}, ${p.state}` : null) || county.label;
  }
  return null;
}
const _countyMemo = new Map();
function countiesOf(p) {
  const k = `${p.state}|${p.name}|${p.county || ''}|${p.lat},${p.lng}`;
  let v = _countyMemo.get(k);
  if (!v) { v = countiesOfPlace(p); if (_countyMemo.size > 50000) _countyMemo.clear(); _countyMemo.set(k, v); }
  return v;
}

/** Does the row belong to a whole-state search? (a place in that state, or the state named alone) */
export function inState(row, state) {
  const placed = row && row.points ? row : placeListing(row);
  return placed.points.some((p) => p.state === state) || placed.states.includes(state);
}

// ── What a person typed into the location box ────────────────────────────────────────────────

let NAME_LIST = null;
function nameList() {
  if (NAME_LIST) return NAME_LIST;
  const seen = new Set();
  NAME_LIST = [];
  for (const p of placesByPopulation(5000)) {
    const k = `${p.name}|${p.state}`;
    if (seen.has(k)) continue;
    seen.add(k);
    NAME_LIST.push({ name: p.name, state: p.state, pop: p.pop, key: p.name.toLowerCase().replace(/[^a-z ]/g, '') });
  }
  return NAME_LIST;
}

function editDistance(a, b, cap = 3) {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > cap) return cap + 1;
    prev = cur;
  }
  return prev[b.length];
}

/**
 * US places spelled like what was typed ("Pheonix" → Phoenix, AZ), most populous first.
 * @returns {string[]} "City, ST" labels
 */
export function suggestPlaces(text, limit = 4) {
  const q = String(text || '').split(',')[0].toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
  if (q.length < 3) return [];
  const cap = q.length <= 5 ? 1 : 2;
  const hits = [];
  for (const p of nameList()) {
    const d = editDistance(q, p.key, cap);
    const prefix = p.key.startsWith(q) && q.length >= 4;
    if (d <= cap || prefix) hits.push({ ...p, d: prefix ? Math.min(d, 1) : d });
  }
  hits.sort((a, b) => (a.d - b.d) || (b.pop - a.pop));
  return [...new Set(hits.map((h) => `${h.name}, ${h.state}`))].slice(0, limit);
}

const STATE_FULL = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware',
  DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon',
  PA: 'Pennsylvania', PR: 'Puerto Rico', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas',
  UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};
export const stateName = (st) => STATE_FULL[st] || st;

/**
 * The searched place. A ZIP is centred on its own area (not its city's downtown); a city on its town
 * centre; a whole state is a state filter, never a point; "remote" is not a place.
 * @returns {{ kind: 'point'|'state'|'county'|'remote'|'none', lat: number|null, lng: number|null, state: string|null,
 *   name: string|null, label: string, zip: string|null, reason: null|'empty'|'needs_position'|'non_us'|'unknown'|'ambiguous'|'not_in_state', suggestions: string[] }}
 */
export function placeSearch(text) {
  const raw = String(text || '').trim().slice(0, 120);
  const none = (reason, suggestions = []) => ({ kind: 'none', lat: null, lng: null, state: null, name: null, label: raw, zip: null, reason, suggestions });
  if (!raw) return none('empty');
  if (isDevicePhrase(raw)) return none('needs_position');
  if (/^(?:remote|anywhere|work from home|wfh)$/i.test(raw)) return { ...none(null), kind: 'remote', label: 'Remote' };
  if (isNonUsLocation(raw)) return none('non_us');
  // A county is an AREA, not its biggest town: every job in it (membership: inCounty below).
  if (namesCounty(raw)) {
    const counties = findCounties(raw);
    if (counties.length === 1) {
      const c = counties[0];
      return { kind: 'county', lat: c.lat, lng: c.lng, state: c.state, name: c.name, county: c.name, label: countyLabel(c), zip: null, reason: null, suggestions: [], reach: countyReachMiles(c) };
    }
    if (counties.length > 1) {
      // Several states have one ("Washington County"): ask which, biggest first.
      const ranked = counties.map((c) => ({ c, pop: (placesByPopulation(0).filter((p) => p.state === c.state && distanceMiles(p, c) <= countyReachMiles(c)).reduce((a, p) => Math.max(a, p.pop), 0)) }))
        .sort((a, b) => b.pop - a.pop).map((x) => countyLabel(x.c));
      return none('ambiguous', ranked.slice(0, 8));
    }
    return none('unknown', []);
  }
  const zip = (raw.match(/^\s*(\d{5})(?:-\d{4})?\s*$/) || [])[1] || null;
  // "Baltimore city", "St. Louis city": an independent city (a county-equivalent) is that city.
  const g = geocodePlace(raw) || (/\s+city$/i.test(raw) ? geocodePlace(raw.replace(/\s+city$/i, '')) : null);
  if (!g) {
    // A bare name several US places share ("Glendale", "Springfield"): ask which one.
    const cands = !raw.includes(',') ? placeCandidates(raw) : [];
    if (cands.length >= 2) return none('ambiguous', cands.map((c) => `${c.name}, ${c.state}`));
    return none('unknown', suggestPlaces(raw));
  }
  if (g.stateOnly) {
    // "Phoenix, TX" places only to Texas: a city we cannot find in the state the person named is a typo or
    // a mix-up, not a request for the whole state.
    const cityPart = raw.split(',')[0].trim();
    const typedOnlyState = !raw.includes(',') || cityPart.toLowerCase() === stateName(g.state).toLowerCase() || cityPart.toUpperCase() === g.state;
    if (!typedOnlyState) return none('not_in_state', suggestPlaces(raw));
    return { kind: 'state', lat: null, lng: null, state: g.state, name: null, label: stateName(g.state), zip: null, reason: null, suggestions: [] };
  }
  const name = g.name || null;
  const lbl = zip ? `${zip}${name ? ` (${name}, ${g.state})` : ''}` : name ? `${name}, ${g.state}` : `${g.state}`;
  return { kind: 'point', lat: g.lat, lng: g.lng, state: g.state, name, label: lbl, zip, reason: null, suggestions: [] };
}

/** Radius options the search offers, in miles; each one's results hold every row of the smaller ones. */
export const RADIUS_OPTIONS = [10, 25, 50, 100];

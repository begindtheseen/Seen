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

import { geocodePlace, geocodeAll, distanceMiles, placesByPopulation, placeNames, placeCandidates, sameNameEntries, hostCity, isNickname, isDevicePhrase, namesCounty, findCounties, countyLabel, countiesOfPlace, countyReachMiles } from './usPlaces.js';
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
    // A county-only point: in when the county's area (as a circle of its land area) reaches the search circle.
    // Its "distance" is to the county's edge for ordering, and is never shown.
    const d = p.countyArea ? Math.max(0, distanceMiles(center, p.countyArea) - Math.sqrt(Math.max(1, p.countyArea.aland || 1) / Math.PI)) : distanceMiles(center, p);
    if (d < bestD) { bestD = d; best = p; }
  }
  if (best && best.countyArea) {
    return { in: Math.round(bestD * 10) / 10 <= m, miles: null, by: 'county', place: label(best) };
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
// Every name a place of 5,000+ people goes by — its Census name, the name without its legal kind ("Indianapolis"),
// its everyday name ("Nashville", "Louisville") and nicknames — each with the place it means.
function nameList() {
  if (NAME_LIST) return NAME_LIST;
  NAME_LIST = [];
  const seen = new Set();
  for (const p of placeNames(5000)) {
    const key = p.key.toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
    const k = `${key}|${p.state}|${p.name}`;
    if (!key || seen.has(k)) continue;
    seen.add(k);
    NAME_LIST.push({ name: p.name, state: p.state, pop: p.pop, key });
  }
  return NAME_LIST;
}

// Optimal-string-alignment distance: insertions, deletions, substitutions and adjacent transpositions ("Tuscon" →
// "Tucson" is one edit). Gives up past `cap`.
function editDistance(a, b, cap = 3) {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2][j - 2] + 1);
      d[i][j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > cap) return cap + 1;
  }
  return d[a.length][b.length];
}

/**
 * US places spelled like what was typed ("Pheonix" → Phoenix, AZ), most populous first.
 * @returns {string[]} "City, ST" labels
 */
export function suggestPlaces(text, limit = 4, state = null) {
  return nearMisses(text, state).slice(0, limit).map((h) => `${h.name}, ${h.state}`);
}

// Places spelled like `text` (in `state` when one was given): [{ name, state, pop, d }], closest first, then biggest.
function nearMisses(text, state = null) {
  const q = String(text || '').split(',')[0].toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
  if (q.length < 3) return [];
  const cap = q.length <= 4 ? 1 : q.length <= 8 ? 2 : 3;
  const hits = [];
  const seen = new Set();
  for (const p of nameList()) {
    if (state && p.state !== state) continue;
    const d = editDistance(q, p.key, cap);
    const prefix = p.key.startsWith(q) && q.length >= 4;
    if (d > cap && !prefix) continue;
    const k = `${p.name}|${p.state}`;
    if (seen.has(k)) continue;
    seen.add(k);
    hits.push({ ...p, d: prefix ? Math.min(d, 1) : d });
  }
  hits.sort((a, b) => (a.d - b.d) || (b.pop - a.pop));
  return hits;
}

/**
 * The one place a misspelling clearly means: the closest spelling, when it is the only one that close or is at
 * least five times bigger than the next as close (in the state named, when there is one). null = ask.
 */
function clearCorrection(text, state) {
  // A correction keeps the first letter and changes the length by at most a quarter ("Nashvegas" is never Las Vegas).
  const q = String(text || '').split(',')[0].toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
  const hits = nearMisses(text, state).filter((h) => h.key[0] === q[0] && Math.abs(h.key.length - q.length) <= Math.max(1, Math.floor(q.length / 4)) && editDistance(q, h.key, 3) <= 3);
  if (!hits.length) return null;
  const [a, b] = hits;
  if (!b || b.d > a.d || a.pop >= 5 * b.pop) return a;
  return null;
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
  // "remote", "Remote US", "Remote - US", "Remote, USA", "work from home", "anywhere in the US": remote jobs.
  if (isRemoteSearch(raw)) return { ...none(null), kind: 'remote', label: 'Remote jobs in the US' };
  // "LA" is Los Angeles to most people and Louisiana to the post office: ask.
  if (/^l\.?\s?a\.?$/i.test(raw)) return none('ambiguous', ['Los Angeles, CA', 'Louisiana']);
  // …but "LA" beside "CA" or a Los Angeles word is Los Angeles ("LA, CA", "Downtown LA", "East LA", "West LA").
  const la = raw.match(/^(?:(downtown|east|west|south|north|central|greater)\s+)?l\.?\s?a\.?(?:\s*,?\s*(?:ca|calif|california))?$/i);
  if (la) {
    const where = la[1] ? la[1].toLowerCase() : '';
    const hit = geocodePlace(where === 'downtown' ? 'Downtown Los Angeles, CA' : where === 'east' ? 'East Los Angeles, CA' : 'Los Angeles, CA');
    if (hit) return { kind: 'point', lat: hit.lat, lng: hit.lng, state: hit.state, name: hit.name, label: `${hit.name}, ${hit.state}`, zip: null, reason: null, suggestions: [], understood: raw };
  }
  if (isNonUsLocation(raw)) return none('non_us');
  // A county is an AREA, not its biggest town: every job in it (membership: inCounty below).
  // (A town named with its county — "Buckhead, Morgan County, GA" — is that town, not the county.)
  const townBeside = raw.split(',').map((x) => x.trim()).filter((x) => x && !namesCounty(x) && !STATE_FULL[x.toUpperCase()] && !Object.values(STATE_FULL).some((n) => n.toLowerCase() === x.toLowerCase())).length > 0;
  if (namesCounty(raw) && !townBeside) {
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
  // A ZIP, alone or with a state beside it ("85001", "85001 AZ", "AZ 85001", "85001, Arizona").
  const zm = raw.match(/^\s*(?:([A-Za-z][A-Za-z .]+?)\s*,?\s+)?(\d{5})(?:-\d{4})?(?:\s*,?\s*([A-Za-z][A-Za-z .]+?))?\s*$/);
  const zip = zm ? zm[2] : null;
  // "Baltimore city", "St. Louis city": an independent city (a county-equivalent) is that city.
  const g = geocodePlace(raw) || (/\s+city$/i.test(raw) ? geocodePlace(raw.replace(/\s+city$/i, '')) : null);
  // A ZIP with a state it is not in ("85001 TX"), or a ZIP no ZIP area shares three digits with: never the state.
  if (zip && (!g || g.stateOnly)) return none(g ? 'not_in_state' : 'unknown', []);
  if (!g || g.stateOnly) {
    // What is left beside a state is a place name that must resolve or be corrected — never dropped: "Tuscon AZ"
    // (with or without a comma) is Tucson, never all of Arizona. Only a bare state name or code is the whole state.
    const { rest, state } = splitState(raw, g && g.stateOnly ? g.state : null);
    if (state && !rest) return { kind: 'state', lat: null, lng: null, state, name: null, label: stateName(state), zip: null, reason: null, suggestions: [] };
    if (!state) {
      // A bare name several US places share ("Glendale", "Springfield"): ask which one.
      const cands = placeCandidates(rest || raw);
      if (cands.length >= 2) return none('ambiguous', cands.map((c) => `${c.name}, ${c.state}`));
    }
    // A near-miss spelling resolves when one place clearly fits, and the label says what was understood.
    const fix = clearCorrection(rest || raw, state);
    if (fix) {
      const hit = geocodePlace(`${fix.name}, ${fix.state}`);
      if (hit && !hit.stateOnly) {
        return { kind: 'point', lat: hit.lat, lng: hit.lng, state: hit.state, name: hit.name, label: `${hit.name}, ${hit.state}`, zip: null, reason: null, suggestions: [], understood: raw };
      }
    }
    // Suggestions come only from the state the person named, when they named one.
    const sugg = suggestPlaces(rest || raw, 5, state);
    return none(state ? 'not_in_state' : 'unknown', sugg);
  }
  // A tiny place spelled like (or named like) a much bigger place or a big city's neighbourhood: ask, bigger first —
  // "Scotsdale" is Scottsdale, AZ to almost everyone; "Buckhead" is the Atlanta neighbourhood, not the town of 200.
  if (!zip && g.name) {
    const { state: typedState, rest } = splitState(raw, null);
    // With a state typed, only choices inside it ("Buckhead, GA" still asks; "Scotsdale, MO" is Scotsdale).
    // (A name already qualified by a county or a city — "Glendale, Los Angeles County" — is not asked about.)
    const ask = String(rest || raw).includes(',') ? null : smallPlaceQuestion(rest || raw, g, typedState);
    if (ask) return none('ambiguous', ask);
  }
  const name = g.name || null;
  // A neighbourhood is labelled with its city ("Buckhead (Atlanta), GA"), never confusable with a town of that name.
  const host = name && !zip ? neighbourhoodHost(g) : null;
  const lbl = zip ? `${zip} (${name ? `${name}, ` : ''}${g.state})` : name ? `${name}${host ? ` (${host})` : ''}, ${g.state}` : `${g.state}`;
  // A nickname ("Indy", "NYC", "Philly") resolves, and the page says what it was read as.
  if (!zip && isNickname(raw)) return { kind: 'point', lat: g.lat, lng: g.lng, state: g.state, name, label: lbl, zip, reason: null, suggestions: [], understood: raw };
  // `approx`: a ZIP that is not a ZIP code area, placed among its neighbours (85001 → the Phoenix 850xx areas).
  return { kind: 'point', lat: g.lat, lng: g.lng, state: g.state, name, label: lbl, zip, reason: null, suggestions: [], ...(g.approx ? { approx: true } : {}) };
}

// The text is normalised first (dots dropped, every run of spaces / commas / dashes becomes ONE space), so each
// alternative is separated by exactly one space and the pattern has a single way to read any input — the earlier
// form let "u.s" match two ways with an optional separator and backtracked exponentially on "wfhu.su.su.s…".
// Round 8: "Remote (US)" (parentheses read as spaces), "work remotely", "remote work", "telework".
const REMOTE_SEARCH_RE = /^(?:(?:fully|100%|all) )?(?:remote(?: work| only| positions?)?|work remotely|anywhere|work from home|wfh|telecommute|telework|virtual)(?: jobs?)?(?: (?:in (?:the )?)?(?:us|usa|united states(?: of america)?|nationwide|only|america))*$/;
function isRemoteSearch(raw) {
  const t = String(raw || '').toLowerCase().replace(/\./g, '').replace(/[\s,()–—-]+/g, ' ').trim();
  return t.length <= 80 && REMOTE_SEARCH_RE.test(t);
}

// "Tuscon AZ" / "Tuscon, AZ" / "AZ Tuscon" / "Sacremento California" → { rest: 'Tuscon', state: 'AZ' }.
function splitState(raw, hint) {
  const codeOf = (w) => {
    const t = w.replace(/\./g, '').trim();
    if (/^[A-Za-z]{2}$/.test(t) && STATE_FULL[t.toUpperCase()]) return t.toUpperCase();
    const full = Object.entries(STATE_FULL).find(([, n]) => n.toLowerCase() === t.toLowerCase());
    return full ? full[0] : null;
  };
  const parts = raw.split(',').map((x) => x.trim()).filter(Boolean);
  if (parts.length > 1) {
    const st = codeOf(parts[parts.length - 1]);
    if (st) return { rest: parts.slice(0, -1).join(', '), state: st };
  }
  const words = raw.replace(/,/g, ' ').split(/\s+/).filter(Boolean);
  for (let n = 3; n >= 1; n--) { // a trailing state of up to three words ("New Mexico", "District of Columbia")
    if (words.length < n) continue;
    const st = codeOf(words.slice(-n).join(' '));
    if (st) return { rest: words.slice(0, -n).join(' '), state: st };
  }
  // A leading state CODE ("AZ Phoenix", "US CA San Mateo" style) — a leading state NAME is usually part of the place
  // ("Oklahoma City", "Kansas City", "Colorado Springs").
  if (words.length > 1 && /^[A-Za-z]{2}$/.test(words[0])) { const st = codeOf(words[0]); if (st) return { rest: words.slice(1).join(' '), state: st }; }
  return { rest: raw, state: hint };
}

// The question for a tiny exact match (< 2,000 people) when a place 50× bigger shares its name or is one edit from
// it, or a big city has a neighbourhood of that name: the choices, bigger first, the tiny place last. null = no question.
function neighbourhoodHost(g) {
  const e = sameNameEntries(g.name).find((x) => x.state === g.state && distanceMiles(x, g) < 1);
  if (!e || e.pop > 1) return null;
  const h = hostCity(e);
  return h && h.name !== g.name ? h.name : null;
}
function smallPlaceQuestion(typed, g, inState = null) {
  const same = sameNameEntries(typed).filter((e) => !inState || e.state === inState);
  const own = same.find((e) => e.state === g.state && distanceMiles(e, g) < 2);
  const pop = own ? own.pop : 0;
  if (pop >= 2000) return null;
  const alts = [];
  for (const e of same) {
    if (e === own) continue;
    if (e.pop <= 1) { const h = hostCity(e); if (h) alts.push({ label: `${e.name} (${h.name}), ${e.state}`, pop: h.pop }); }
    else if (e.pop >= 50 * Math.max(1, pop)) alts.push({ label: `${e.name}, ${e.state}`, pop: e.pop });
  }
  const q = String(typed).toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
  for (const h of nearMisses(typed, inState)) {
    if (h.d > 1 || h.key[0] !== q[0] || h.pop < 50 * Math.max(1, pop) || h.key === q) continue;
    alts.push({ label: `${h.name}, ${h.state}`, pop: h.pop });
  }
  if (!alts.length) return null;
  const labels = [...new Set(alts.sort((a, b) => b.pop - a.pop).map((a) => a.label))].slice(0, 4);
  // The tiny place itself, named so picking it does not ask again ("Buckhead, Morgan County, GA").
  const county = countiesOfPlace({ name: g.name, state: g.state, lat: g.lat, lng: g.lng })[0];
  const sameState = alts.some((a) => a.label.endsWith(`, ${g.state}`));
  return [...labels, sameState && county ? `${g.name}, ${county}, ${g.state}` : `${g.name}, ${g.state}`];
}

/** Radius options the search offers, in miles; each one's results hold every row of the smaller ones. */
export const RADIUS_OPTIONS = [10, 25, 50, 100];

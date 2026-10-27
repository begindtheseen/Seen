// What place a person meant by what they typed in the job search's location box — without a network call.
//
// Audit 2026-10-27 (owner's own searches): "valet · Anahiem ca", "host · Anahiem ca", "Data Analyst · Anahiem ca" all
// came back with 0 listings in the area, while "valet · cerritos, ca" had 51. The typed text went straight to
// Nominatim (which has no fuzzy matching, throttles server traffic, and answers "pheonix" with a business in Round
// Rock, TX and "socal" with a Miami cantina), to the location-text match for listings without coordinates, and to the
// live pull's `where` — so one transposed letter emptied the page. "LA" was read as Louisiana, "Arizona" as a 25-mile
// circle around the middle of the state.
//
// resolveLocation() reads a bundled Census gazetteer (lib/geo/usPlaces.data.js, ~10k places) and returns the place:
//   { kind: 'city', label: 'Anaheim, CA', city, state, lat, lng, corrected } — exact name, nickname, or a close typo
//   { kind: 'state', label: 'Arizona', state, box }                          — a state on its own
//   { kind: 'zip', zip }                                                      — a ZIP code (the caller geocodes it)
//   { kind: 'remote' }                                                        — "remote"
//   { kind: 'unknown', label: input, state? }                                 — nothing matched: the caller's geocoder
// `corrected` is true when the label is not what was typed (a typo or a nickname), so the page can say so.
import { US_PLACES, US_ZIP3 } from './usPlaces.data.js';
import { editDistance } from '../text/editDistance.js';

export { editDistance };

export const US_STATES = {
  al: 'alabama', ak: 'alaska', az: 'arizona', ar: 'arkansas', ca: 'california', co: 'colorado', ct: 'connecticut',
  de: 'delaware', fl: 'florida', ga: 'georgia', hi: 'hawaii', id: 'idaho', il: 'illinois', in: 'indiana', ia: 'iowa',
  ks: 'kansas', ky: 'kentucky', la: 'louisiana', me: 'maine', md: 'maryland', ma: 'massachusetts', mi: 'michigan',
  mn: 'minnesota', ms: 'mississippi', mo: 'missouri', mt: 'montana', ne: 'nebraska', nv: 'nevada', nh: 'new hampshire',
  nj: 'new jersey', nm: 'new mexico', ny: 'new york', nc: 'north carolina', nd: 'north dakota', oh: 'ohio', ok: 'oklahoma',
  or: 'oregon', pa: 'pennsylvania', ri: 'rhode island', sc: 'south carolina', sd: 'south dakota', tn: 'tennessee',
  tx: 'texas', ut: 'utah', vt: 'vermont', va: 'virginia', wa: 'washington', wv: 'west virginia', wi: 'wisconsin',
  wy: 'wyoming', dc: 'district of columbia',
};
const STATE_BY_NAME = Object.fromEntries(Object.entries(US_STATES).map(([a, n]) => [n, a]));
const titleCase = (s) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());

// Nicknames and regions people type. A region resolves to the city at its middle, labelled as the region.
const ALIASES = {
  nyc: ['New York', 'NY'], 'new york city': ['New York', 'NY'], manhattan: ['New York', 'NY'], 'the bronx': ['New York', 'NY'],
  la: ['Los Angeles', 'CA'], socal: ['Los Angeles', 'CA'], 'southern california': ['Los Angeles', 'CA'],
  sf: ['San Francisco', 'CA'], 'san fran': ['San Francisco', 'CA'], 'bay area': ['San Francisco', 'CA'], 'sf bay area': ['San Francisco', 'CA'],
  'silicon valley': ['San Jose', 'CA'], 'south bay': ['San Jose', 'CA'], 'east bay': ['Oakland', 'CA'],
  dc: ['Washington', 'DC'], 'washington dc': ['Washington', 'DC'], 'washington d c': ['Washington', 'DC'], 'district of columbia': ['Washington', 'DC'],
  philly: ['Philadelphia', 'PA'], vegas: ['Las Vegas', 'NV'], nola: ['New Orleans', 'LA'], atl: ['Atlanta', 'GA'],
  chi: ['Chicago', 'IL'], chitown: ['Chicago', 'IL'], 'chi town': ['Chicago', 'IL'], dfw: ['Dallas', 'TX'], 'dallas fort worth': ['Dallas', 'TX'],
  'dallas ft worth': ['Dallas', 'TX'], metroplex: ['Dallas', 'TX'], htown: ['Houston', 'TX'], 'h town': ['Houston', 'TX'], satx: ['San Antonio', 'TX'],
  okc: ['Oklahoma City', 'OK'], slc: ['Salt Lake City', 'UT'], kc: ['Kansas City', 'MO'], indy: ['Indianapolis', 'IN'], abq: ['Albuquerque', 'NM'],
  pdx: ['Portland', 'OR'], phx: ['Phoenix', 'AZ'], jax: ['Jacksonville', 'FL'], 'twin cities': ['Minneapolis', 'MN'], 'tampa bay': ['Tampa', 'FL'],
  'south florida': ['Miami', 'FL'], 'inland empire': ['Riverside', 'CA'], 'orange county': ['Santa Ana', 'CA', 'Orange County, CA'],
  'orange county ca': ['Santa Ana', 'CA', 'Orange County, CA'], oc: ['Santa Ana', 'CA', 'Orange County, CA'], 'the valley': ['Phoenix', 'AZ'],
  'east valley': ['Mesa', 'AZ'], 'west valley': ['Glendale', 'AZ'], 'san fernando valley': ['Los Angeles', 'CA'], 'long island': ['Hempstead', 'NY', 'Long Island, NY'],
  'research triangle': ['Raleigh', 'NC'], triangle: ['Raleigh', 'NC'], 'hampton roads': ['Norfolk', 'VA'], 'the woodlands': ['The Woodlands', 'TX'],
};

// Cities abroad that share a name with a small US town: typed alone they mean the foreign city (Seen lists US jobs, so the
// caller's own handling applies), never Toronto, OH or London, KY. With a state ("London, KY") they resolve normally.
const FOREIGN = new Set(['toronto', 'vancouver', 'montreal', 'ottawa', 'calgary', 'edmonton', 'winnipeg', 'london', 'paris', 'berlin',
  'madrid', 'barcelona', 'dublin', 'amsterdam', 'rome', 'milan', 'lisbon', 'sydney', 'melbourne', 'mexico city', 'guadalajara',
  'monterrey', 'tijuana', 'bangalore', 'mumbai', 'delhi', 'manila', 'tokyo', 'singapore', 'hong kong', 'dubai', 'tel aviv', 'warsaw']);

/** Lowercase, drop punctuation, spell out the abbreviations place names use ("St." → "saint", "Ft" → "fort"). */
export function normPlace(s) {
  const t = String(s || '').toLowerCase().replace(/[’'`.]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  if (!t) return '';
  const w = t.split(' ');
  const ABBR = { st: 'saint', ste: 'sainte', ft: 'fort', mt: 'mount', pt: 'point' };
  const DIR = { n: 'north', s: 'south', e: 'east', w: 'west' };
  return w.map((x, i) => ABBR[x] || (i === 0 && w.length > 1 && DIR[x]) || x).join(' ');
}

let _index = null;
function index() {
  if (_index) return _index;
  const byName = new Map();
  const byState = new Map();
  const all = [];
  for (const line of US_PLACES.split('\n')) {
    const [st, name, lat, lng, pop] = line.split('|');
    const p = { st, name, lat: Number(lat), lng: Number(lng), pop: Number(pop) || 0, n: normPlace(name) };
    all.push(p);
    if (!byName.has(p.n)) byName.set(p.n, []);
    byName.get(p.n).push(p);
    if (!byState.has(st)) byState.set(st, []);
    byState.get(st).push(p);
  }
  // A state's box from its places, padded ~20 miles so towns at the edge are inside.
  const boxes = new Map();
  for (const [st, list] of byState) {
    let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
    for (const p of list) { a = Math.min(a, p.lat); b = Math.max(b, p.lat); c = Math.min(c, p.lng); d = Math.max(d, p.lng); }
    boxes.set(st, { latMin: a - 0.3, latMax: b + 0.3, lngMin: c - 0.35, lngMax: d + 0.35 });
  }
  _index = { byName, byState, all, boxes };
  return _index;
}

const allowedTypos = (len) => (len <= 4 ? 0 : len <= 7 ? 1 : 2);

/** The state a token names ("az", "arizona", "arizonia"), or ''. */
function stateOf(tok, { fuzzy = true } = {}) {
  const t = normPlace(tok);
  if (!t) return '';
  if (US_STATES[t]) return t;
  if (STATE_BY_NAME[t]) return STATE_BY_NAME[t];
  if (fuzzy && t.length >= 5) {
    let best = '', bd = 99;
    for (const [name, ab] of Object.entries(STATE_BY_NAME)) {
      const d = editDistance(t, name, 2);
      if (d < bd) { bd = d; best = ab; }
    }
    if (bd <= allowedTypos(t.length)) return best;
  }
  return '';
}

function cityResult(p, input, corrected, label) {
  return { kind: 'city', label: label || `${p.name}, ${p.st}`, city: p.name, state: p.st, lat: p.lat, lng: p.lng, pop: p.pop, corrected: !!corrected, input };
}

/** The best place named `city` (normalized), in `st` when given: exact, then a close typo, then a long-enough prefix. */
function findCity(city, st) {
  const { byName, byState, all } = index();
  const ST = st ? st.toUpperCase() : '';
  const exact = (byName.get(city) || []).filter((p) => !ST || p.st === ST).sort((a, b) => b.pop - a.pop);
  if (exact.length) return { p: exact[0], typo: false };
  const pool = ST ? (byState.get(ST) || []) : all;
  const max = allowedTypos(city.length);
  if (max > 0) {
    let best = null, bd = 99;
    for (const p of pool) {
      if (!ST && p.pop < 10000) continue; // with no state to narrow it, a typo only resolves to a real city
      const d = editDistance(city, p.n, max);
      if (d < bd || (d === bd && best && p.pop > best.pop)) { bd = d; best = p; }
    }
    if (best && bd <= max) return { p: best, typo: true };
  }
  // a name typed part-way ("phoe", "anah") — only when one big city clearly owns the prefix
  if (city.length >= 4) {
    const hits = pool.filter((p) => p.n.startsWith(city)).sort((a, b) => b.pop - a.pop);
    if (hits.length && hits[0].pop >= (ST ? 20000 : 100000) && (!hits[1] || hits[1].pop * 3 <= hits[0].pop)) return { p: hits[0], typo: true };
  }
  return null;
}

/**
 * Resolve a typed location. Never throws; never calls the network.
 * @param {string} input
 */
export function resolveLocation(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  let s = normPlace(raw).replace(/\b(usa|us|united states|united states of america)$/, '').trim();
  if (!s) return { kind: 'unknown', label: raw };
  if (/^(remote|anywhere|work from home|wfh|nationwide)$/.test(s)) return { kind: 'remote' };
  const zip = s.match(/\b(\d{5})(?:\s?\d{4})?\b/);
  if (zip) return { kind: 'zip', zip: zip[1], input: raw };

  const alias = ALIASES[s];
  if (alias) {
    const hit = findCity(normPlace(alias[0]), alias[1].toLowerCase());
    if (hit) return cityResult(hit.p, raw, normPlace(alias[2] || `${alias[0]} ${alias[1]}`) !== s && normPlace(alias[0]) !== s, alias[2]);
  }

  // Split into a city part and a state part: "Anaheim, CA", "anaheim ca", "kansas city missouri", "Phoenix Arizona".
  let city = s, st = '';
  if (raw.includes(',')) {
    const parts = raw.split(',').map((x) => x.trim()).filter(Boolean);
    city = normPlace(parts[0]);
    st = parts.length > 1 ? stateOf(parts[parts.length - 1].replace(/\d+/g, '').trim()) : '';
  } else {
    const w = s.split(' ');
    for (const k of [2, 1]) {
      if (w.length <= k) continue;
      const cand = stateOf(w.slice(-k).join(' '), { fuzzy: k === 2 || w.slice(-k).join(' ').length >= 5 });
      if (cand) { st = cand; city = w.slice(0, -k).join(' '); break; }
    }
  }

  // The whole text is a state ("arizona", "AZ", "texas") — unless it is also a big city's name ("New York").
  if (!st || city === s) {
    const whole = stateOf(s, { fuzzy: s.length >= 5 });
    if (whole) {
      const sameName = (index().byName.get(s) || []).find((p) => p.st === whole.toUpperCase() && p.pop >= 300000);
      if (sameName) return cityResult(sameName, raw, false);
      return { kind: 'state', label: titleCase(US_STATES[whole]), state: whole.toUpperCase(), box: index().boxes.get(whole.toUpperCase()) || null, corrected: normPlace(US_STATES[whole]) !== s && whole !== s, input: raw };
    }
  }
  if (!city) return st ? { kind: 'state', label: titleCase(US_STATES[st]), state: st.toUpperCase(), box: index().boxes.get(st.toUpperCase()) || null, corrected: false, input: raw } : { kind: 'unknown', label: raw };

  const aliasCity = ALIASES[city];
  if (aliasCity && (!st || aliasCity[1].toLowerCase() === st)) {
    const hit = findCity(normPlace(aliasCity[0]), aliasCity[1].toLowerCase());
    if (hit) return cityResult(hit.p, raw, true, aliasCity[2]);
  }
  if (!st && FOREIGN.has(city)) return { kind: 'unknown', label: raw };
  const hit = findCity(city, st);
  if (hit) return cityResult(hit.p, raw, hit.typo || hit.p.n !== city);
  return { kind: 'unknown', label: raw, state: st ? st.toUpperCase() : undefined };
}

/** The padded bounding box of a state's places ({ latMin, latMax, lngMin, lngMax }), or null. */
export function stateBox(st) {
  return index().boxes.get(String(st || '').toUpperCase()) || null;
}

let _zip3 = null;
/** The centre of a ZIP code's 3-digit prefix area ({ lat, lng }), or null — coarse, for when no geocoder answers. */
export function zip3Center(zip) {
  if (!_zip3) {
    _zip3 = new Map();
    for (const line of US_ZIP3.split('\n')) { const [k, lat, lng] = line.split('|'); _zip3.set(k, { lat: Number(lat), lng: Number(lng) }); }
  }
  return _zip3.get(String(zip || '').slice(0, 3)) || null;
}

/**
 * The place a point belongs to — how a ZIP code is named on the page ("Phoenix, AZ"). Among places of at least `minPop`
 * residents within 15 miles, the big city wins over a closer suburb (10001 is "New York, NY", not Hoboken): each mile
 * counts against a place, each factor of ten in population for it. Falls back to the nearest place at any distance.
 */
export function nearestPlace(lat, lng, minPop = 5000) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const cos = Math.cos((lat * Math.PI) / 180);
  let best = null, bs = Infinity, near = null, nd = Infinity;
  for (const p of index().all) {
    if (p.pop < minPop) continue;
    const miles = Math.sqrt((p.lat - lat) ** 2 + ((p.lng - lng) * cos) ** 2) * 69;
    if (miles < nd) { nd = miles; near = p; }
    if (miles > 15) continue;
    const score = miles - 2 * Math.log10(p.pop);
    if (score < bs) { bs = score; best = p; }
  }
  const p = best || near;
  return p ? { label: `${p.name}, ${p.st}`, city: p.name, state: p.st } : null;
}

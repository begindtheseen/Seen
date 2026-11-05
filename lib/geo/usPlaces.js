// US place lookup without any network call: "Phoenix, AZ" / "85004" / "Greater Seattle Area" →
// coordinates, from US Census Bureau + USGS GNIS data vendored in lib/geo/data (public domain;
// rebuild with scripts/geo/build-us-places.mjs). Every US incorporated place and CDP (32k) plus
// ZIP code areas (33.8k).
//
//   geocodePlace(text)                 → { lat, lng, name, state } | { lat, lng, name: null, state, stateOnly: true } | null
//   distanceMiles(a, b)                → great-circle miles between two {lat,lng}
//   withinMiles(jobLocation, origin, miles) → true | false | null (null = a side can't be placed, or is a whole state)
//   placesWithin(center, miles, opts)  → the most populous places within `miles` of a point
//
// A place is one point — its town centre (GNIS), else its Census internal point; a ZIP is its
// area's internal point. A listing that says only "Phoenix, AZ" is placed at downtown Phoenix, not
// at its street address, so distances to it are approximate by up to the city's size.
// The data is read once per process, on first use. Tests: lib/geo/usPlaces.test.mjs.

import { readFileSync } from 'node:fs';

const STATES = {
  AL: 'alabama', AK: 'alaska', AZ: 'arizona', AR: 'arkansas', CA: 'california', CO: 'colorado', CT: 'connecticut',
  DE: 'delaware', DC: 'district of columbia', FL: 'florida', GA: 'georgia', HI: 'hawaii', ID: 'idaho', IL: 'illinois',
  IN: 'indiana', IA: 'iowa', KS: 'kansas', KY: 'kentucky', LA: 'louisiana', ME: 'maine', MD: 'maryland',
  MA: 'massachusetts', MI: 'michigan', MN: 'minnesota', MS: 'mississippi', MO: 'missouri', MT: 'montana',
  NE: 'nebraska', NV: 'nevada', NH: 'new hampshire', NJ: 'new jersey', NM: 'new mexico', NY: 'new york',
  NC: 'north carolina', ND: 'north dakota', OH: 'ohio', OK: 'oklahoma', OR: 'oregon', PA: 'pennsylvania',
  PR: 'puerto rico', RI: 'rhode island', SC: 'south carolina', SD: 'south dakota', TN: 'tennessee', TX: 'texas',
  UT: 'utah', VT: 'vermont', VA: 'virginia', WA: 'washington', WV: 'west virginia', WI: 'wisconsin', WY: 'wyoming',
};
const STATE_BY_KEY = new Map();
for (const [ab, name] of Object.entries(STATES)) { STATE_BY_KEY.set(ab.toLowerCase(), ab); STATE_BY_KEY.set(name, ab); }
STATE_BY_KEY.set('d c', 'DC');
STATE_BY_KEY.set('washington dc', 'DC');
STATE_BY_KEY.set('washington d c', 'DC');
// Two-word state names, for "salt lake city utah"-style trailing states.
const LONG_STATE_NAMES = Object.values(STATES).filter((n) => n.includes(' ')).sort((a, b) => b.length - a.length);

// Names people use that are not Census place names → the place they mean.
const NICKNAMES = {
  'nyc': ['NY', 'new york'], 'new york city': ['NY', 'new york'],
  'bay area': ['CA', 'san francisco'], 'sf bay': ['CA', 'san francisco'], 'sf': ['CA', 'san francisco'],
  'san francisco bay': ['CA', 'san francisco'], 'silicon valley': ['CA', 'san jose'], 'inland empire': ['CA', 'riverside'],
  'dfw': ['TX', 'dallas'], 'dallas fort worth': ['TX', 'dallas'], 'twin cities': ['MN', 'minneapolis'],
  'chicagoland': ['IL', 'chicago'], 'philly': ['PA', 'philadelphia'], 'vegas': ['NV', 'las vegas'],
  'nola': ['LA', 'new orleans'], 'okc': ['OK', 'oklahoma city'], 'slc': ['UT', 'salt lake city'],
  'st pete': ['FL', 'st petersburg'], 'tampa bay': ['FL', 'tampa'], 'hampton roads': ['VA', 'norfolk'],
  'research triangle': ['NC', 'raleigh'], 'raleigh durham': ['NC', 'raleigh'], 'dmv': ['DC', 'washington'],
};

// Words that say how or where-ish, not which place.
const NOISE_RE = /\b(?:100% remote|fully remote|remote first|remote|hybrid|on ?site|onsite|in ?office|work from home|wfh|telecommute|telework|temporarily|flexible|greater|metropolitan|metroplex|metro|area|region|vicinity|surrounding|and surrounding|headquarters|hq|office|offices|campus|downtown)\b/g;
const COUNTRY_RE = /^(?:united states(?: of america)?|usa|us|u s|u s a|america|north america|us national|nationwide|national)$/;
const NOWHERE_RE = /^(?:anywhere|nationwide|multiple|multiple locations|various|various locations|virtual|tbd|n a|na|none|worldwide|global)$/;

let _data = null;

// Never throws: if the data file is missing (a bundle without it), every lookup answers null and
// callers fall back to what they did before this table existed.
function load() {
  if (_data) return _data;
  let places;
  try {
    places = JSON.parse(readFileSync(new URL('./data/us-places.json', import.meta.url), 'utf8'));
  } catch (e) {
    console.error(`[usPlaces] place data unavailable: ${e.message}`);
    places = { centers: {}, states: {} };
  }
  const byName = new Map(); // key → [{ name, state, lat, lng, pop }] most populous first
  const all = [];
  const add = (key, entry) => {
    if (!key) return;
    let list = byName.get(key);
    if (!list) { list = []; byName.set(key, list); }
    if (!list.some((e) => e.state === entry.state && e.lat === entry.lat && e.lng === entry.lng)) list.push(entry);
  };
  for (const [state, rows] of Object.entries(places.states)) {
    for (const [name, lat, lng, pop, aliases] of rows) {
      const entry = { name, state, lat, lng, pop: pop || 0 };
      all.push(entry);
      add(norm(name), entry);
      for (const a of aliases || []) add(norm(a), { ...entry, name: a });
    }
  }
  for (const [nick, [state, target]] of Object.entries(NICKNAMES)) {
    const hit = (byName.get(target) || []).find((e) => e.state === state);
    if (hit) add(nick, hit);
  }
  for (const list of byName.values()) list.sort((a, b) => b.pop - a.pop);
  _data = { byName, all, centers: places.centers, zips: null };
  return _data;
}

function zipTable() {
  const d = load();
  if (d.zips) return d.zips;
  let raw = '';
  try {
    raw = JSON.parse(readFileSync(new URL('./data/us-zips.json', import.meta.url), 'utf8')).zips || '';
  } catch (e) {
    console.error(`[usPlaces] ZIP data unavailable: ${e.message}`);
  }
  const m = new Map();
  for (const rec of raw ? raw.split(';') : []) {
    const [z, lat, lng] = rec.split(',');
    m.set(z, { lat: Number(lat), lng: Number(lng) });
  }
  d.zips = m;
  return m;
}

// Lowercase, no accents or periods, "saint"/"ft"/"mt" spelled one way. Commas, hyphens and
// slashes survive (they separate parts); callers strip them where needed.
function norm(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’.]/g, '')
    .replace(/[^a-z0-9,\-/ ]+/g, ' ')
    .replace(/\b(?:saint|ste)\b/g, 'st')
    .replace(/\bft\b/g, 'fort')
    .replace(/\bmt\b/g, 'mount')
    .replace(/\s+/g, ' ')
    .trim();
}

const usable = (p) => !!p && p.lat != null && p.lng != null && p.lat !== '' && p.lng !== ''
  && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)) && !(Number(p.lat) === 0 && Number(p.lng) === 0);

/** Great-circle miles between two {lat,lng}. Infinity when either point is missing. */
export function distanceMiles(a, b) {
  if (!usable(a) || !usable(b)) return Infinity;
  const R = 3958.7613;
  const rad = (d) => (Number(d) * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function stateOnly(state) {
  if (state === 'DC') { // DC is one city
    const w = (load().byName.get('washington') || []).find((e) => e.state === 'DC');
    if (w) return { lat: w.lat, lng: w.lng, name: w.name, state: 'DC' };
  }
  const c = load().centers[state];
  return c ? { lat: c[0], lng: c[1], name: null, state, stateOnly: true } : null;
}

// Best place for one name, optionally inside a state.
function lookup(key, state) {
  const { byName } = load();
  const tries = [key];
  if (key.includes('-')) tries.push(key.replace(/-/g, ' '), key.split('-')[0].trim()); // "winston-salem", "dallas-fort worth"
  for (const k of tries) {
    const list = byName.get(k);
    if (!list) continue;
    const hit = state ? list.find((e) => e.state === state) : list[0];
    if (hit) return hit;
  }
  return null;
}

function nearestPlace(pt) {
  let best = null, bestD = Infinity;
  for (const e of load().all) {
    if (e.pop < 1000) continue;
    if (Math.abs(e.lat - pt.lat) > 1 || Math.abs(e.lng - pt.lng) > 1.5) continue;
    const d = distanceMiles(pt, e);
    if (d < bestD) { bestD = d; best = e; }
  }
  return best;
}

function cleanSegment(seg) {
  let s = ` ${seg} `.replace(/\b\d+\s+(?:more\s+|other\s+)?locations?\b/g, ' ').replace(NOISE_RE, ' ').replace(/\s+/g, ' ').trim();
  s = s.replace(/^(?:(?:work|working|based|located|position|job|jobs|role)\s+)*(?:in|near|at|around|from)\s+/, '');
  return s.replace(/^(?:work|based|located)\s+/, '').replace(/^-+|-+$/g, '').trim();
}

// One location ("Phoenix, AZ 85004") → a place, a whole state, or null.
function parseOne(text, splitHyphens = false) {
  let s = norm(text);
  if (!s) return null;
  const zm = s.match(/\b(\d{5})(?:-\d{4})?\b/);
  const zip = zm ? zm[1] : null;
  if (zip) s = s.replace(zm[0], ' ');
  const sep = splitHyphens ? /,|\/|-/ : /,|\/|\s+-\s+/;
  // Each part keeps its raw words too: "Greater Carrollwood" is a real place name.
  let segs = s.split(sep).map((r) => ({ raw: r.trim(), key: cleanSegment(r) }))
    .filter((x) => x.key && !COUNTRY_RE.test(x.key));
  if (segs.every((x) => NOWHERE_RE.test(x.key))) segs = [];
  if (segs.length > 1) segs = segs.filter((x) => !/\b(?:county|parish)$/.test(x.key));

  // The state: the last part that is a whole state ("..., AZ"), else a trailing state word on the
  // last part ("phoenix az", "salt lake city utah"). A lone "New York" is the city.
  let state = null;
  for (let i = segs.length - 1; i >= 0; i--) {
    const ab = STATE_BY_KEY.get(segs[i].key);
    if (ab && !(segs.length === 1 && segs[i].key === 'new york')) { state = ab; segs.splice(i, 1); break; }
  }
  if (!state && segs.length) {
    const last = segs[segs.length - 1];
    const tail = LONG_STATE_NAMES.find((n) => last.key.endsWith(` ${n}`)) || last.key.split(' ').pop();
    const ab = last.key.includes(' ') ? STATE_BY_KEY.get(tail) : null;
    if (ab) {
      state = ab;
      const key = last.key.slice(0, last.key.length - tail.length).trim();
      segs[segs.length - 1] = { raw: key, key };
    }
  }
  segs = segs.filter((x) => x.key);

  // The place: the most populous match among the parts ("Old Sixth Ward, Houston" → Houston).
  let best = null, unresolvedLast = false;
  segs.forEach((seg, i) => {
    const hit = (seg.raw !== seg.key && lookup(seg.raw, state)) || lookup(seg.key, state);
    if (!hit && i === segs.length - 1) unresolvedLast = true;
    if (hit && (!best || hit.pop > best.pop)) best = hit;
  });

  const zpt = zip ? zipTable().get(zip) : null;
  if (best) {
    // A non-US line ("Paris, France", "Toronto, ON") ends in a part we can't place.
    if (!state && segs.length > 1 && unresolvedLast) return null;
    // The ZIP is the finer point when it agrees with the city.
    if (zpt && distanceMiles(zpt, best) <= 40) return { lat: zpt.lat, lng: zpt.lng, name: best.name, state: best.state };
    return { lat: best.lat, lng: best.lng, name: best.name, state: best.state };
  }
  if (zpt) {
    const near = nearestPlace(zpt);
    if (!state || !near || near.state === state) return { lat: zpt.lat, lng: zpt.lng, name: near ? near.name : null, state: near ? near.state : state };
  }
  if (!splitHyphens && s.includes('-')) { // "US-AZ-Phoenix", "Phoenix-AZ"
    const again = parseOne(text, true);
    if (again && (!again.stateOnly || !state)) return again;
  }
  return state ? stateOnly(state) : null;
}

/**
 * A free-form US location → its coordinates. Ambiguous bare names pick the most populous place;
 * a whole state gives the state's center with `stateOnly: true`; remote / non-US / unknown → null.
 * @param {unknown} text
 * @returns {{ lat: number, lng: number, name: string|null, state: string, stateOnly?: true } | null}
 */
export function geocodePlace(text) {
  if (text == null) return null;
  const raw = String(text).slice(0, 300);
  if (!raw.trim()) return null;
  let fallback = null;
  // Several locations ("Phoenix, AZ; Dallas, TX") → the first that places; a parenthesis is tried
  // after the text around it ("Remote (Austin, TX)").
  for (const group of raw.split(/;|\||\n|\s+or\s+|\s+•\s+/i)) {
    const outside = group.replace(/\([^)]*\)/g, ' ');
    const inside = [...group.matchAll(/\(([^)]*)\)/g)].map((m) => m[1]);
    for (const part of [outside, ...inside]) {
      const r = parseOne(part);
      if (r && !r.stateOnly) return r;
      if (r && !fallback) fallback = r;
    }
  }
  return fallback;
}

// text | {lat,lng} | {location} → a point, or null for a whole state / unplaceable.
function toPoint(x) {
  if (x == null) return null;
  if (typeof x === 'object') {
    if (x.stateOnly) return null;
    if (usable(x)) return { lat: Number(x.lat), lng: Number(x.lng) };
    if (typeof x.location === 'string') return toPoint(x.location);
    return null;
  }
  const g = geocodePlace(x);
  return g && !g.stateOnly ? g : null;
}

/**
 * Is a job within `miles` of the origin? Each side may be text or {lat,lng} (a row with
 * {lat,lng,location} uses its coordinates, else its location text). null when either side
 * can't be placed or names only a whole state.
 */
export function withinMiles(jobLocation, origin, miles) {
  const m = Number(miles);
  if (!Number.isFinite(m) || m < 0) return null;
  const a = toPoint(jobLocation);
  const b = toPoint(origin);
  if (!a || !b) return null;
  return distanceMiles(a, b) <= m;
}

/**
 * The most populous places within `miles` of a point, most populous first.
 * @returns {Array<{ name: string, state: string, lat: number, lng: number, pop: number, miles: number }>}
 */
export function placesWithin(center, miles, { limit = 12, minPop = 0 } = {}) {
  if (!usable(center) || !Number.isFinite(miles) || miles <= 0) return [];
  const c = { lat: Number(center.lat), lng: Number(center.lng) };
  const latPad = miles / 68.7;
  const lngPad = miles / (68.7 * Math.max(0.01, Math.cos((c.lat * Math.PI) / 180)));
  const out = [];
  const seen = new Set();
  for (const e of load().all) {
    if (e.pop < minPop) continue;
    if (Math.abs(e.lat - c.lat) > latPad || Math.abs(e.lng - c.lng) > lngPad) continue;
    const d = distanceMiles(c, e);
    if (d > miles) continue;
    const k = `${e.state}|${e.name}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ name: e.name, state: e.state, lat: e.lat, lng: e.lng, pop: e.pop, miles: d });
  }
  out.sort((a, b) => b.pop - a.pop);
  return out.slice(0, Math.max(0, limit));
}

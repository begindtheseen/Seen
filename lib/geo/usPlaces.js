// US place lookup without any network call: "Phoenix, AZ" / "85004" / "Greater Seattle Area" →
// coordinates, from US Census Bureau + USGS GNIS data vendored in lib/geo/data (public domain;
// rebuild with scripts/geo/build-us-places.mjs and scripts/geo/build-us-towns.mjs). Every US incorporated
// place and CDP (32k), the towns/townships of the 12 states that use them as addresses (4.7k), and ZIP
// code areas (33.8k).
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
import { orLiteral } from '../server/pgrest.js';

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
  'phx': ['AZ', 'phoenix'], 'atl': ['GA', 'atlanta'], 'nyc metro': ['NY', 'new york'], 'socal': null, 'norcal': null,
  'orange county': ['CA', 'santa ana'], 'east bay': ['CA', 'oakland'], 'south bay': null, 'tysons corner': ['VA', 'tysons'],
  'vandenberg': ['CA', 'vandenberg afb'], 'vandenberg sfb': ['CA', 'vandenberg afb'], 'vandenberg space force base': ['CA', 'vandenberg afb'],
};

// Places job listings name that are not Census places (a new city, an office park, a base, a space
// centre, a Phoenix "village"). Coordinates: the place's centre, to about a mile. Population 0 so a
// Census place of the same name always wins a bare-name lookup.
const EXTRA_PLACES = [
  ['Starbase', 'TX', 25.996, -97.154], ['Annapolis Junction', 'MD', 39.119, -76.795],
  ['Research Triangle Park', 'NC', 35.899, -78.863, ['RTP']], ['Playa Vista', 'CA', 33.973, -118.425],
  ['McCarran', 'NV', 39.548, -119.437], ['Wallops Island', 'VA', 37.94, -75.466],
  ['Stennis Space Center', 'MS', 30.363, -89.6], ['Quonset', 'RI', 41.59, -71.42, ['Quonset Point']],
  ['McHenry', 'MS', 30.71, -89.135],
  ['Ahwatukee', 'AZ', 33.335, -111.985, ['Ahwatukee Foothills', 'Ahwatukee Foothills Village']],
  ['Fort Huachuca', 'AZ', 31.555, -110.35], ['Luke AFB', 'AZ', 33.535, -112.383, ['Luke Air Force Base']],
  ['Hill AFB', 'UT', 41.124, -111.973, ['Hill Air Force Base']], ['Kennedy Space Center', 'FL', 28.573, -80.649], ['Cape Canaveral Space Force Station', 'FL', 28.489, -80.578],
];
// A Census name that carries its legal kind ("Indianapolis city", "Boise City", "Braintree Town",
// "Westport Village") is also known by the bare name a listing uses.
const NOT_BARE = new Set(['panama', 'mexico', 'quebec', 'belize']); // "Panama City" is never "Panama"
const KIND_SUFFIX_RE = /\s+(?:city|town|village|borough|township|municipality|plantation)$/i;

// Words that say how or where-ish, not which place.
const NOISE_RE = /\b(?:100% remote|fully remote|remote first|remote|hybrid|on ?site|onsite|in ?office|work from home|wfh|telecommute|telework|temporarily|flexible|greater|metropolitan|metroplex|metro|area|region|vicinity|surrounding|and surrounding|headquarters|hq|office|offices|campus|downtown)\b/g;
const COUNTRY_RE = /^(?:united states(?: of america)?|usa|us|u s|u s a|america|north america|us national|nationwide|national)$/;
const NOWHERE_RE = /^(?:anywhere|nationwide|multiple|multiple locations|various|various locations|virtual|tbd|n a|na|none|worldwide|global)$/;

// "near me", "my location": a request for the device's position, never a place ("me" is not Maine).
const DEVICE_RE = /^\s*(?:jobs?\s+)?(?:near\s*me|nearby|near\s*by|around\s*me|close\s*to\s*me|close\s*by|my\s*(?:current\s*)?location|current\s*location|where\s*i\s*am|here|my\s*area|local)\s*$/i;
/** Is the text a request for the device's position ("near me", "current location")? */
export function isDevicePhrase(text) { return DEVICE_RE.test(String(text || '')); }

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
      const bare = name.replace(KIND_SUFFIX_RE, '');
      if (bare !== name && bare.length >= 3 && !STATE_BY_KEY.has(norm(bare)) && !NOT_BARE.has(norm(bare))) add(norm(bare), { ...entry, name: bare });
    }
  }
  // Towns and townships that are not Census places ("Edison, NJ", "Mount Laurel, NJ") — us-towns.json,
  // built by scripts/geo/build-us-towns.mjs. Population 0: a Census place of the same name wins.
  try {
    const towns = JSON.parse(readFileSync(new URL('./data/us-towns.json', import.meta.url), 'utf8')).towns || {};
    for (const [state, rows] of Object.entries(towns)) {
      for (const [name, lat, lng] of rows) {
        const entry = { name, state, lat, lng, pop: 0 };
        all.push(entry);
        add(norm(name), entry);
      }
    }
  } catch (e) {
    console.error(`[usPlaces] town data unavailable: ${e.message}`);
  }
  for (const [name, state, lat, lng, aliases] of EXTRA_PLACES) {
    const entry = { name, state, lat, lng, pop: 1 }; // 1: named sites may be read bare ("Starbase"); towns (0) may not
    all.push(entry);
    add(norm(name), entry);
    for (const a of aliases || []) add(norm(a), { ...entry, name });
  }
  const nicks = [];
  for (const [nick, spec] of Object.entries(NICKNAMES)) {
    if (!spec) continue; // a region too wide to be one point ("SoCal")
    const [state, target] = spec;
    const hit = (byName.get(target) || []).find((e) => e.state === state);
    if (hit) { add(nick, hit); nicks.push({ nick, ...hit }); }
  }
  for (const list of byName.values()) list.sort((a, b) => b.pop - a.pop);
  _data = { byName, all, nicks, centers: places.centers, zips: null };
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
    .replace(/\bft\s+(?=[a-z])/g, 'fort ')
    .replace(/\bmt\s+(?=[a-z])/g, 'mount ')
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
// A bare name ("Glendale", "Springfield") names one place only when one candidate clearly dominates: ≥ 3× the
// population of the next one, or the two are neighbours (Kansas City MO / KS). Otherwise it is ambiguous and
// places nowhere — a listing's "Glendale" is never silently Arizona's.
function dominant(list) {
  const byState = [];
  // A town/township with no population figure (us-towns.json) is only ever read with its state: a bare
  // "Southeast" or "Lower" is a word, not Southeast, NY.
  for (const e of list.filter((x) => x.pop > 0)) if (!byState.some((x) => x.state === e.state && distanceMiles(x, e) < 30)) byState.push(e);
  if (byState.length <= 1) return byState[0] || null;
  const [a, b] = byState; // list is most populous first
  if (a.pop >= 3 * b.pop || distanceMiles(a, b) <= 30) return a;
  return null;
}

// `near`: counties the text names — the place must lie in one of them (nearest to its middle).
function lookup(key, state, near = null) {
  const { byName } = load();
  const tries = [key];
  if (key.includes('-')) tries.push(key.replace(/-/g, ' '), key.split('-')[0].trim()); // "winston-salem", "dallas-fort worth"
  for (const k of tries) {
    const list = byName.get(k);
    if (!list) continue;
    if (near && near.length) {
      // A Census-listed member of the county wins ("Corona, Riverside County" → the city of Corona, 90 mi from the
      // county's middle); else the nearest same-name place within reach of the county's middle (CDPs, hamlets).
      const member = list.find((e) => near.some((c) => c.state === e.state && countyHas(c, e.name)));
      if (member) return member;
      let best = null, bestD = Infinity;
      for (const e of list) {
        for (const c of near) {
          if (e.state !== c.state) continue;
          const d = distanceMiles(e, c);
          if (d <= countyReach(c) && d < bestD) { bestD = d; best = e; }
        }
      }
      if (best) return best;
      continue;
    }
    const hit = state ? list.find((e) => e.state === state) : dominant(list);
    if (hit) return hit;
  }
  return null;
}

/** Every place a bare name could be, most populous first, one per state ("Glendale" → AZ, CA, …). */
export function placeCandidates(text, limit = 5) {
  const list = load().byName.get(norm(text).replace(/,.*$/, '').trim()) || [];
  const out = [];
  for (const e of list) if (!out.some((x) => x.state === e.state)) out.push({ name: e.name, state: e.state, pop: e.pop });
  return out.slice(0, limit);
}

// ── Counties (lib/geo/data/us-counties.json) ──
let _counties = null;
let _members = new Map(); // "ST|Riverside County" → [[place, population of its part], …] most populous first
const _memberSets = new Map();
function countyHas(c, placeName) {
  const k = `${c.state}|${c.name}`;
  let set = _memberSets.get(k);
  if (!set) { set = new Set((_members.get(k) || []).map(([n]) => norm(n))); _memberSets.set(k, set); }
  return set.has(norm(placeName));
}
function countyTable() {
  if (_counties) return _counties;
  _counties = new Map();
  try {
    const file = JSON.parse(readFileSync(new URL('./data/us-counties.json', import.meta.url), 'utf8'));
    _members = new Map();
    for (const [k, list] of Object.entries(file.members || {})) _members.set(k, list);
    const rows = file.counties || [];
    for (const [state, name, lat, lng, aland] of rows) {
      const k = norm(name);
      if (!_counties.has(k)) _counties.set(k, []);
      _counties.get(k).push({ state, name, lat, lng, aland });
    }
  } catch (e) {
    console.error(`[usPlaces] county data unavailable: ${e.message}`);
  }
  return _counties;
}
// How far from a county's middle a town in it can be: about the county's half-width, plus slack.
const countyReach = (c) => 10 + 0.8 * Math.sqrt(Math.max(1, c.aland || 400));
const _principal = new Map();
/** The county's principal city: its most populous place near the county's middle. */
function countyPrincipal(c) {
  const k = `${c.state}|${c.name}`;
  if (_principal.has(k)) return _principal.get(k);
  // The county's most populous incorporated place (Riverside County → Riverside, Clark → Las Vegas) — never its
  // geometric middle, which for the big western counties is desert.
  for (const [name] of _members.get(k) || []) {
    const hit = (load().byName.get(norm(name)) || []).find((e) => e.state === c.state);
    if (hit) { _principal.set(k, hit); return hit; }
  }
  let best = null;
  for (const e of load().all) {
    if (e.state !== c.state || e.pop <= 0) continue;
    if (distanceMiles(e, c) > 4 + 0.5 * Math.sqrt(Math.max(1, c.aland || 400))) continue; // well inside the county
    if (!best || e.pop > best.pop) best = e;
  }
  _principal.set(k, best);
  return best;
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

// A street line ("13945 w sunrise blvd sunrise", "20545 harville avenue perris") keeps only the words
// after its last street word — the town a mailing address ends with.
const STREET_WORDS = new Set(['st', 'street', 'ave', 'avenue', 'blvd', 'boulevard', 'rd', 'road', 'dr', 'drive', 'way', 'ln', 'lane', 'pkwy', 'parkway',
  'hwy', 'highway', 'ct', 'court', 'cir', 'circle', 'pl', 'place', 'ter', 'terrace', 'trl', 'trail', 'suite', 'ste', 'unit', 'floor', 'fl']);
function afterStreet(seg) {
  const w = seg.split(' ');
  const firstNum = w.findIndex((x) => /^\d+$/.test(x));
  if (firstNum < 0) return seg;
  let last = -1;
  for (let i = firstNum + 1; i < w.length - 1; i++) if (STREET_WORDS.has(w[i])) last = i;
  return last >= 0 ? w.slice(last + 1).join(' ') : seg;
}
const COUNTRY_TAIL_RE = /\s+(?:united states(?: of america)?|usa|us|u s a?)$/;
const COUNTRY_HEAD_RE = /^(?:united states(?: of america)?|usa|us|u s a?)\s+/;
const CALL_SIGN_RE = /^(?:[kw][a-z]{2,3}(?:[ -][a-z]{2,4})*-tv)\s+/;
const IN_PERSON_RE = /\b(?:in person|in-person|field based|field-based|on the road|in the field)\b/g;

function cleanSegment(seg) {
  let s = ` ${seg} `.replace(/\b\d+\s+(?:more\s+|other\s+)?locations?\b/g, ' ').replace(IN_PERSON_RE, ' ').replace(NOISE_RE, ' ').replace(/\s+/g, ' ').trim();
  if (/\d/.test(s)) s = afterStreet(s);
  s = s.replace(COUNTRY_TAIL_RE, '').replace(COUNTRY_HEAD_RE, '');
  s = s.replace(CALL_SIGN_RE, ''); // "kpnx-tv phoenix" (a TV station's newsroom) → "phoenix"
  s = s.replace(/^(?:(?:work|working|based|located|position|job|jobs|role)\s+)*(?:in|near|at|around|from)\s+/, '');
  return s.replace(/^(?:work|based|located)\s+/, '').replace(/^-+|-+$/g, '').trim();
}

// One location ("Phoenix, AZ 85004") → a place, a whole state, or null.
function parseOne(text, splitHyphens = false) {
  let s = norm(String(text || '').replace(/>/g, ','));
  if (!s) return null;
  const zms = [...s.matchAll(/\b(\d{5})(?:-\d{4})?\b/g)];
  // The ZIP is the last 5-digit token, and only when nothing but a country follows it ("…, Houston,
  // Texas 77042"); a street number ("10777 Westheimer Road") is not a ZIP.
  const zm = zms.length ? zms[zms.length - 1] : null;
  const zipOk = zm && /^[\s,]*(?:(?:united states(?: of america)?|usa|us)\b)?[\s,]*$/.test(s.slice(zm.index + zm[0].length));
  const zip = zipOk ? zm[1] : null;
  if (zip) s = s.slice(0, zm.index) + ' ' + s.slice(zm.index + zm[0].length);
  const sep = splitHyphens ? /,|\/|-|>/ : /,|\/|>|\s+-\s+/;
  // Each part keeps its raw words too: "Greater Carrollwood" is a real place name.
  let segs = s.split(sep).map((r) => ({ raw: r.trim(), key: cleanSegment(r) }))
    .filter((x) => x.key && !COUNTRY_RE.test(x.key));
  if (segs.every((x) => NOWHERE_RE.test(x.key))) segs = [];
  // "Glendale, Los Angeles County" → the Glendale IN that county; "Tempe, Maricopa County" → Tempe; a county
  // alone ("Orange County, CA") stays for the nickname table, else its principal city.
  const isCounty = (x) => /\b(?:county|parish|borough|census area)$/.test(x.key);
  let counties = segs.filter(isCounty).flatMap((x) => countyTable().get(x.key) || []);
  const countyNames = segs.filter(isCounty).map((x) => x.raw);
  if (segs.some((x) => !isCounty(x) && !STATE_BY_KEY.has(x.key))) segs = segs.filter((x) => !isCounty(x));
  // "suite 400", "1800 owens", "bldg 2": a part with a number is an address detail, not a place.
  if (segs.length > 1 && segs.some((x) => !/\d/.test(x.key))) segs = segs.filter((x) => !/\d/.test(x.key));

  // The state: the last part that is a whole state ("..., AZ"), else a trailing state word on the
  // last part ("phoenix az", "salt lake city utah"). A lone "New York" is the city.
  let state = null;
  for (let i = segs.length - 1; i >= 0; i--) {
    const ab = STATE_BY_KEY.get(segs[i].key);
    if (ab && !(segs.length === 1 && segs[i].key === 'new york')) { state = ab; segs.splice(i, 1); break; }
  }
  if (!state && segs.length === 1 && segs[0].key.includes(' ')) { // "ca san mateo" (after "US ")
    const [head, ...rest] = segs[0].key.split(' ');
    const ab = head.length === 2 ? STATE_BY_KEY.get(head) : null;
    if (ab && lookup(rest.join(' '), ab)) { state = ab; segs = [{ raw: rest.join(' '), key: rest.join(' ') }]; }
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
  if (state) counties = counties.filter((c) => c.state === state);
  const near = counties.length ? counties : null;

  // The place: the most populous match among the parts ("Old Sixth Ward, Houston" → Houston).
  let best = null, unresolvedLast = false;
  segs.forEach((seg, i) => {
    if (isCounty(seg)) return;
    const hit = (seg.raw !== seg.key && lookup(seg.raw, state, near)) || lookup(seg.key, state, near);
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
    const close = nearestPlace(zpt);
    if (!state || !close || close.state === state) return { lat: zpt.lat, lng: zpt.lng, name: close ? close.name : null, state: close ? close.state : state };
  }
  // A neighbourhood we do not know in a county we do ("Pico Heights, Los Angeles County", "Stock Yards, Cook
  // County") → the county's principal city, marked `county` (the point is that city, not the street).
  // Several states share the name ("Cook County") → only when one is far bigger (Cook IL = Chicago).
  if (counties.length) {
    const ranked = counties.map((c) => ({ c, p: countyPrincipal(c) })).filter((x) => x.p).sort((a, b) => b.p.pop - a.p.pop);
    const principal = ranked.length === 1 || (ranked.length > 1 && ranked[0].p.pop >= 3 * ranked[1].p.pop) ? ranked[0] : null;
    if (principal) return { lat: principal.p.lat, lng: principal.p.lng, name: principal.p.name, state: principal.p.state, county: principal.c.name };
  }
  void countyNames;
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
  if (!raw.trim() || isDevicePhrase(raw)) return null;
  // Several locations ("Phoenix, AZ; Dallas, TX") → the first that places (geocodeAll reads them all, with the
  // same parenthesis and county rules).
  const { points, states } = geocodeAll(raw);
  if (points.length) return points[0];
  return states.length ? stateOnly(states[0]) : null;
}

// "San Francisco, CA, New York, NY, Portland, OR" in one comma list → each "<place>, <state>" pair.
function statePairs(group) {
  const parts = norm(group.replace(/>/g, ',')).split(',').map((x) => cleanSegment(x)).filter(Boolean);
  const out = [];
  for (let i = 1; i < parts.length; i++) {
    const ab = STATE_BY_KEY.get(parts[i]);
    if (!ab) continue;
    const hit = lookup(parts[i - 1], ab);
    if (hit) out.push({ lat: hit.lat, lng: hit.lng, name: hit.name, state: hit.state });
  }
  return out;
}

/**
 * EVERY place a listing's location names — "Phoenix, AZ; Tempe, AZ", "San Francisco, CA | New York City, NY",
 * "Denver, CO or Long Beach, CA" — so a multi-location listing is in range when ANY of its places is.
 * `states` are the states named with no place ("Arizona", "Remote - Texas"): never a point.
 * @returns {{ points: Array<{ lat: number, lng: number, name: string|null, state: string }>, states: string[] }}
 */
export function geocodeAll(text, max = 20) {
  const points = [], states = [];
  if (text == null || isDevicePhrase(text)) return { points, states };
  const raw = String(text).slice(0, 600);
  const seen = new Set();
  const push = (r) => {
    if (!r) return;
    if (r.stateOnly) { if (!states.includes(r.state)) states.push(r.state); return; }
    const k = `${r.lat},${r.lng}`;
    if (seen.has(k) || points.length >= max) return;
    seen.add(k);
    points.push({ lat: r.lat, lng: r.lng, name: r.name, state: r.state, ...(r.county ? { county: r.county } : {}) });
  };
  for (const group of raw.split(/;|\||\n|\s+or\s+|\s+•\s+/i)) {
    if (/^\s*-?\d+\.\d+\s*$/.test(group)) continue; // a bare coordinate stored in the text
    const outside = group.replace(/\([^)]*\)/g, ' ');
    const pairs = statePairs(outside);
    if (pairs.length >= 2) { pairs.forEach(push); continue; }
    // A parenthesis is read only when the text around it names no place ("Remote (Austin, TX)"); beside a
    // place it is a note — "Woodfield Mall, Schaumburg, IL (10112)" is a store number, not a New York ZIP.
    // A bare name outside and a "City, ST" inside ("Mather HQ (Evanston, IL)") → the parenthesis is the place.
    let around = parseOne(outside);
    const inside = [...group.matchAll(/\(([^)]*)\)/g)].map((m) => m[1]);
    if (around && !around.stateOnly && !outside.includes(',')) {
      const pair = inside.map((t) => statePairs(t)[0]).find(Boolean);
      if (pair) around = pair;
    }
    push(around);
    // Beside a whole state, a parenthesis counts only inside that state ("Gladstone, VA (Nelson County)").
    if (!around || around.stateOnly) for (const t of inside) { const r = parseOne(t); if (r && (!around || r.state === around.state)) push(r); }
  }
  // A state named elsewhere on the line is not "state only" when a place in that state was found.
  return { points, states: states.filter((st) => !points.some((p) => p.state === st)) };
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

/** Every place with at least `minPop` people: [{ name, state, lat, lng, pop }] (for spelling suggestions). */
export function placesByPopulation(minPop = 5000) {
  return load().all.filter((e) => e.pop >= minPop);
}

/**
 * The words a location line uses for the places inside a circle, as PostgREST `ilike` patterns, for a
 * database read of the rows that have no coordinates (`*` = any text, `_` = one character standing for
 * the comma, which would split PostgREST's or=() list). The caller measures every row it gets back
 * (lib/geo/radius.js withinRadius), so a pattern may over-match ("*mesa*" reads "Costa Mesa") but should
 * not miss. Rules: every place, town and named site in the circle written "<name>, <ST>" / "<name>,
 * <State>" / "<ST> > <State> > <name>"; places of 50,000+ people and the nicknames of places in the circle
 * ("NYC", "Philly") also bare, because listings write "New York" / "Phoenix" / "Houston; Seattle" alone.
 * @returns {string[]}
 */
export function areaTextPatterns(center, miles, { bareMinPop = 50000 } = {}) {
  if (!usable(center) || !Number.isFinite(miles) || miles <= 0) return [];
  const c = { lat: Number(center.lat), lng: Number(center.lng) };
  // Every piece goes through lib/server/pgrest.js orLiteral (escaped, no list syntax); a period becomes `*`
  // so "St. Louis" also matches "St Louis". The names come from the vendored place tables, never from input.
  const clean = (x) => String(x).toLowerCase().replace(/[:/\\]/g, ' ').split('.').map((part) => orLiteral(part)).join('*').replace(/\s+/g, ' ').trim();
  const out = new Set();
  for (const p of placesWithin(c, miles, { limit: 100000, minPop: 0 })) {
    const name = clean(p.name);
    if (name.length < 3) continue;
    const st = p.state.toLowerCase();
    const full = STATES[p.state];
    if (p.pop >= bareMinPop) { out.add(`*${name}*`); continue; }
    if (p.pop > 0 && p.pop < 1000) continue; // a hamlet: listings there are rare and the read is per pattern
    out.add(`*${name}_ ${st}*`);
    if (p.pop >= 10000) {
      out.add(`*${name} ${st}`); // "Mesa AZ" (no comma), at the end
      if (full) { out.add(`*${name}_ ${full}*`); out.add(`*${full} > ${name}*`); } // "Mesa, Arizona" / "US > Arizona > Mesa"
    }
  }
  for (const n of load().nicks) if (distanceMiles(c, n) <= miles) out.add(`*${clean(n.nick)}*`);
  return [...out];
}

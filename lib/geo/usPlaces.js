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
import { prefixState } from './zipPrefixes.js';

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
  'phx': ['AZ', 'phoenix'], 'atl': ['GA', 'atlanta'], 'kc': ['MO', 'kansas city'], 'chi town': ['IL', 'chicago'], 'h town': ['TX', 'houston'], 'nyc area': ['NY', 'new york'], 'nyc metro': ['NY', 'new york'], 'socal': null, 'norcal': null,
  'orange county': ['CA', 'santa ana'], 'east bay': ['CA', 'oakland'], 'south bay': null, 'tysons corner': ['VA', 'tysons'],
  'vandenberg': ['CA', 'vandenberg afb'], 'vandenberg sfb': ['CA', 'vandenberg afb'], 'vandenberg space force base': ['CA', 'vandenberg afb'],
  // Short names of the largest metros, as people type them (round 8; written from general knowledge). Two-letter
  // forms that are also state codes are left out ("LA" asks; "SD" is South Dakota).
  'indy': ['IN', 'indianapolis'], 'stl': ['MO', 'st louis'], 'st louis city': ['MO', 'st louis'], 'big d': ['TX', 'dallas'],
  'cowtown': ['TX', 'fort worth'], 'htx': ['TX', 'houston'], 'h-town': ['TX', 'houston'], 'satx': ['TX', 'san antonio'],
  'atx': ['TX', 'austin'], 'chi': ['IL', 'chicago'], 'chi-town': ['IL', 'chicago'], 'windy city': ['IL', 'chicago'],
  'motor city': ['MI', 'detroit'], 'motown': ['MI', 'detroit'], 'beantown': ['MA', 'boston'], 'bmore': ['MD', 'baltimore'],
  'charm city': ['MD', 'baltimore'], 'pdx': ['OR', 'portland'], 'abq': ['NM', 'albuquerque'], 'burque': ['NM', 'albuquerque'],
  'jax': ['FL', 'jacksonville'], 'cbus': ['OH', 'columbus'], 'cincy': ['OH', 'cincinnati'], 'cle': ['OH', 'cleveland'],
  'pgh': ['PA', 'pittsburgh'], 'the burgh': ['PA', 'pittsburgh'], 'msp': ['MN', 'minneapolis'], 'mke': ['WI', 'milwaukee'],
  'sactown': ['CA', 'sacramento'], 'clt': ['NC', 'charlotte'], 'rdu': ['NC', 'raleigh'], 'rva': ['VA', 'richmond'],
  'hotlanta': ['GA', 'atlanta'], 'nashvegas': ['TN', 'nashville'], 'music city': ['TN', 'nashville'], 'sin city': ['NV', 'las vegas'],
  'mile high city': ['CO', 'denver'], 't-town': ['OK', 'tulsa'], 'south beach': ['FL', 'miami beach'], 'the district': ['DC', 'washington'],
  'pvd': ['RI', 'providence'], 'bk': ['NY', 'brooklyn'], 'big apple': ['NY', 'new york'], 'the big apple': ['NY', 'new york'],
  'los angeles area': ['CA', 'los angeles'], 'greater la': ['CA', 'los angeles'], 'dtla': ['CA', 'los angeles'],
  'uptown charlotte': ['NC', 'charlotte'], 'queen city': null, 'the valley': null,
};
/** Is the text one of the nickname table's names ("Indy", "Philly", "NYC")? */
export function isNickname(text) { return Object.prototype.hasOwnProperty.call(NICKNAMES, norm(text)) && !!NICKNAMES[norm(text)]; }

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
  // New York City neighbourhoods listings write as a town ("Woodside, NY"); each is read with its state.
  ['Woodside', 'NY', 40.745, -73.905], ['Astoria', 'NY', 40.772, -73.93], ['Long Island City', 'NY', 40.744, -73.949, ['LIC']],
  ['Flushing', 'NY', 40.765, -73.833], ['Jamaica', 'NY', 40.702, -73.789], ['Harlem', 'NY', 40.811, -73.946],
  ['Bushwick', 'NY', 40.694, -73.922], ['Williamsburg', 'NY', 40.708, -73.957], ['Park Slope', 'NY', 40.672, -73.977],
  ['Bay Ridge', 'NY', 40.626, -74.03], ['Tribeca', 'NY', 40.716, -74.009], ['SoHo', 'NY', 40.723, -74.003],
  // Named neighbourhoods and districts of the largest cities, as job listings and searchers write them. Each is read
  // with its own state ("Hollywood, CA" is Los Angeles; a bare "Hollywood" is still Hollywood, FL). Centres to ~1 mi.
  ['Hollywood', 'CA', 34.098, -118.327], ['North Hollywood', 'CA', 34.172, -118.379, ['NoHo']], ['Venice', 'CA', 33.985, -118.469],
  ['Koreatown', 'CA', 34.058, -118.3], ['Silver Lake', 'CA', 34.087, -118.27], ['Echo Park', 'CA', 34.078, -118.261],
  ['Westwood', 'CA', 34.063, -118.445], ['Encino', 'CA', 34.159, -118.501], ['Van Nuys', 'CA', 34.186, -118.449],
  ['Sherman Oaks', 'CA', 34.151, -118.449], ['Studio City', 'CA', 34.14, -118.396], ['Woodland Hills', 'CA', 34.168, -118.606],
  ['San Pedro', 'CA', 33.736, -118.292], ['Northridge', 'CA', 34.228, -118.536], ['Chatsworth', 'CA', 34.257, -118.601],
  ['Boyle Heights', 'CA', 34.034, -118.205], ['Eagle Rock', 'CA', 34.139, -118.212], ['Playa del Rey', 'CA', 33.959, -118.441],
  ['Century City', 'CA', 34.056, -118.417], ['Bel Air', 'CA', 34.1, -118.459], ['Los Feliz', 'CA', 34.108, -118.29],
  ['Mid-Wilshire', 'CA', 34.062, -118.348], ['Pacific Palisades', 'CA', 34.048, -118.526], ['Tarzana', 'CA', 34.173, -118.554],
  ['Reseda', 'CA', 34.201, -118.536], ['Canoga Park', 'CA', 34.201, -118.598], ['Sylmar', 'CA', 34.308, -118.449],
  ['Hollywood Hills', 'CA', 34.123, -118.34], ['Downtown Los Angeles', 'CA', 34.047, -118.25, ['DTLA']],
  ['SoMa', 'CA', 37.779, -122.405, ['South of Market']], ['Mission District', 'CA', 37.76, -122.415, ['The Mission']],
  ['Nob Hill', 'CA', 37.793, -122.416], ['Potrero Hill', 'CA', 37.759, -122.401], ['Dogpatch', 'CA', 37.761, -122.388],
  ['Hayes Valley', 'CA', 37.776, -122.424], ['Marina District', 'CA', 37.803, -122.437],
  ['Manhattan', 'NY', 40.783, -73.971], ['Midtown Manhattan', 'NY', 40.754, -73.984], ['Lower Manhattan', 'NY', 40.708, -74.011, ['Financial District']],
  ['Upper East Side', 'NY', 40.774, -73.957], ['Upper West Side', 'NY', 40.787, -73.975], ['Greenwich Village', 'NY', 40.734, -74.0],
  ['East Village', 'NY', 40.727, -73.984], ['Brooklyn Heights', 'NY', 40.696, -73.994], ['DUMBO', 'NY', 40.703, -73.989],
  ['Downtown Brooklyn', 'NY', 40.693, -73.99], ['Red Hook', 'NY', 40.676, -74.01], ['Crown Heights', 'NY', 40.669, -73.943],
  ['Bedford-Stuyvesant', 'NY', 40.687, -73.942, ['Bed-Stuy']], ['Greenpoint', 'NY', 40.73, -73.951], ['Sunset Park', 'NY', 40.645, -74.01],
  ['Forest Hills', 'NY', 40.718, -73.845], ['Bayside', 'NY', 40.768, -73.777], ['Jackson Heights', 'NY', 40.756, -73.883],
  ['Chelsea', 'NY', 40.746, -74.002], ['Hudson Yards', 'NY', 40.754, -74.0],
  ['The Loop', 'IL', 41.881, -87.63, ['Loop', 'Chicago Loop']], ['River North', 'IL', 41.892, -87.634], ['Lincoln Park', 'IL', 41.921, -87.651],
  ['Wicker Park', 'IL', 41.909, -87.677], ['Hyde Park', 'IL', 41.794, -87.59], ['Lakeview', 'IL', 41.94, -87.659], ['Logan Square', 'IL', 41.923, -87.708],
  ['West Loop', 'IL', 41.882, -87.648], ['Pilsen', 'IL', 41.856, -87.656], ['Streeterville', 'IL', 41.893, -87.62], ['Gold Coast', 'IL', 41.905, -87.628],
  ['Montrose', 'TX', 29.746, -95.391], ['Houston Heights', 'TX', 29.798, -95.398, ['The Heights']], ['Uptown Houston', 'TX', 29.751, -95.461, ['Galleria']],
  ['Energy Corridor', 'TX', 29.783, -95.64], ['Texas Medical Center', 'TX', 29.707, -95.401], ['Clear Lake', 'TX', 29.56, -95.115],
  ['Westchase', 'TX', 29.725, -95.56], ['Midtown Houston', 'TX', 29.741, -95.38],
  ['Uptown Dallas', 'TX', 32.8, -96.802], ['Deep Ellum', 'TX', 32.784, -96.783], ['Oak Lawn', 'TX', 32.808, -96.812],
  ['Buckhead', 'GA', 33.838, -84.38], ['Midtown Atlanta', 'GA', 33.781, -84.386], ['Old Fourth Ward', 'GA', 33.764, -84.372],
  ['Capitol Hill', 'WA', 47.623, -122.319], ['Ballard', 'WA', 47.668, -122.385], ['South Lake Union', 'WA', 47.627, -122.337],
  ['Queen Anne', 'WA', 47.637, -122.357], ['Belltown', 'WA', 47.614, -122.346], ['Pioneer Square', 'WA', 47.602, -122.334],
  ['University District', 'WA', 47.661, -122.313, ['U District']], ['Fremont', 'WA', 47.651, -122.35],
  ['Capitol Hill', 'DC', 38.889, -76.996], ['Georgetown', 'DC', 38.909, -77.065], ['Dupont Circle', 'DC', 38.91, -77.043],
  ['Navy Yard', 'DC', 38.876, -77.003], ['Foggy Bottom', 'DC', 38.9, -77.05],
  ['Back Bay', 'MA', 42.35, -71.081], ['Seaport District', 'MA', 42.349, -71.042, ['Seaport', 'South Boston Waterfront']],
  ['Beacon Hill', 'MA', 42.358, -71.067], ['Dorchester', 'MA', 42.3, -71.064], ['Jamaica Plain', 'MA', 42.31, -71.12],
  ['Allston', 'MA', 42.354, -71.132], ['South Boston', 'MA', 42.338, -71.047], ['Roxbury', 'MA', 42.315, -71.09], ['Charlestown', 'MA', 42.378, -71.061],
  ['Arcadia', 'AZ', 33.5, -111.977], ['Maryvale', 'AZ', 33.505, -112.177], ['Laveen', 'AZ', 33.363, -112.17], ['Desert Ridge', 'AZ', 33.677, -111.975],
  ['LoDo', 'CO', 39.753, -104.999], ['Capitol Hill', 'CO', 39.731, -104.979], ['RiNo', 'CO', 39.768, -104.98, ['River North Art District']],
  ['Brickell', 'FL', 25.76, -80.193], ['Wynwood', 'FL', 25.801, -80.199], ['Little Havana', 'FL', 25.774, -80.215],
  ['Center City', 'PA', 39.952, -75.164], ['Fishtown', 'PA', 39.972, -75.134], ['University City', 'PA', 39.952, -75.193],
  ['Fells Point', 'MD', 39.283, -76.593], ['Inner Harbor', 'MD', 39.286, -76.608], ['Federal Hill', 'MD', 39.279, -76.611],
  ['Pearl District', 'OR', 45.528, -122.682], ['South Congress', 'TX', 30.25, -97.749, ['SoCo']], ['East Austin', 'TX', 30.263, -97.721],
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
const DEVICE_RE = /^\s*(?:jobs?\s+)?(?:near\s*me|nearby|near\s*by|around\s*me|close\s*to\s*me|close\s*by|my\s*(?:current\s*)?location|current\s*location|where\s*i\s*am|here|my\s*area|local|(?:near\s+)?downtown|in\s+town|my\s+city)\s*$/i;
/** Is the text a request for the device's position ("near me", "current location")? */
export function isDevicePhrase(text) { return DEVICE_RE.test(String(text || '')); }

const DISPLAY = new Map();
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
      // The name people use for a consolidated government ("Nashville-Davidson" → "Nashville", "Urban Honolulu").
      if (aliases && aliases.length && /[-/]|^Urban /.test(name)) DISPLAY.set(`${state}|${norm(name)}`, aliases[0]);
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
        const entry = { name, state, lat, lng, pop: 0, town: true };
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
  for (const e of list.filter((x) => x.pop > 0 || !x.town)) if (!byState.some((x) => x.state === e.state && distanceMiles(x, e) < 30)) byState.push(e);
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

function nearestPlace(pt, state = null) {
  let best = null, bestD = Infinity;
  for (const e of load().all) {
    if (e.pop < 1000 || (state && e.state !== state)) continue;
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
  // …a state may follow it too ("85001 AZ", "85001, Arizona").
  const after = zm ? s.slice(zm.index + zm[0].length).replace(/[\s,]+/g, ' ').replace(/\b(?:united states(?: of america)?|usa|us)\s*$/, '').trim() : '';
  // …or it opens the line ("85004 Phoenix AZ": the ZIP, then its town).
  const zipOk = zm && (!after || STATE_BY_KEY.has(after) || (zm.index === 0 && zms.length === 1));
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
    // "West New York" / "Kansas City" / "Virginia Beach" are places, not "<place> <state>": the trailing state word
    // is split off only when what is left is a place in that state, or the whole part is not a place.
    const rest = ab ? last.key.slice(0, last.key.length - tail.length).trim() : '';
    if (ab && !lookup(rest, ab) && (load().byName.get(last.key) || []).length) { /* keep the whole name */ } else
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
  // A neighbourhood named before its city ("Ahwatukee Foothills, Phoenix", "Hollywood, Los Angeles") is the finer
  // point: the first place, when the bigger one is within 30 miles of it.
  // "koreatown los angeles" / "midtown manhattan" (no comma): a place name at the end, the neighbourhood before it.
  let best = null, unresolvedLast = false;
  const hits = [];
  segs.forEach((seg, i) => {
    if (isCounty(seg)) return;
    let hit = (seg.raw !== seg.key && lookup(seg.raw, state, near)) || lookup(seg.key, state, near);
    if (!hit && seg.key.includes(' ')) {
      const w = seg.key.split(' ');
      for (let k = 1; k < w.length && !hit; k++) {
        const tail = lookup(w.slice(k).join(' '), state, near);
        // Only a big city at the end ("koreatown los angeles", "midtown manhattan") — "Cienega Springs" is not
        // somewhere in Springs, NY.
        if (!tail || tail.pop < 50000) continue;
        // …and a neighbourhood we know before it: "Winston Salem" is not somewhere in Salem, OR.
        const head = lookup(w.slice(0, k).join(' '), tail.state);
        if (head && distanceMiles(head, tail) <= 30) hit = head;
      }
    }
    if (!hit && i === segs.length - 1) unresolvedLast = true;
    if (hit) hits.push(hit);
    if (hit && (!best || hit.pop > best.pop)) best = hit;
  });
  // A first part that did not resolve alone may resolve inside the city's state ("Bellevue, Seattle").
  if (best && !state && segs.length > 1 && hits[0] === best && !isCounty(segs[0])) {
    const first = lookup(segs[0].key, best.state);
    if (first && first !== best && distanceMiles(first, best) <= 30) hits.unshift(first);
  }
  if (best && hits.length > 1 && hits[0] !== best && hits[0].pop < best.pop && distanceMiles(hits[0], best) <= 30) best = hits[0];

  const zpt = zip ? zipPoint(zip) : null;
  if (best) {
    // A non-US line ("Paris, France", "Toronto, ON") ends in a part we can't place.
    if (!state && segs.length > 1 && unresolvedLast) return null;
    // The ZIP is the finer point when it is in the city's state and near it.
    if (zpt && !zpt.approx && zpt.state === best.state && distanceMiles(zpt, best) <= 40) return { lat: zpt.lat, lng: zpt.lng, name: best.name, state: best.state };
    return { lat: best.lat, lng: best.lng, name: best.name, state: best.state };
  }
  // A ZIP (alone, or with its state: "85001 AZ", "AZ 85001") is the ZIP — its own state and city, never the nearest
  // town across a state line.
  if (zpt && (!state || zpt.state === state)) return { lat: zpt.lat, lng: zpt.lng, name: zpt.name, state: zpt.state, ...(zpt.approx ? { approx: true } : {}) };
  // A neighbourhood we do not know in a county we do ("Pico Heights, Los Angeles County", "Stock Yards, Cook
  // County") → the county's principal city, marked `county` (the point is that city, not the street).
  // Several states share the name ("Cook County") → only when one is far bigger (Cook IL = Chicago).
  if (counties.length) {
    const ranked = counties.map((c) => ({ c, p: countyPrincipal(c) })).filter((x) => x.p).sort((a, b) => b.p.pop - a.p.pop);
    const principal = ranked.length === 1 || (ranked.length > 1 && ranked[0].p.pop >= 3 * ranked[1].p.pop) ? ranked[0] : null;
    // A row placed only to a county: the county's area (its middle and land area) travels with it, so a radius search
    // asks whether the COUNTY reaches the circle, and the card names the county, never a distance.
    if (principal) return { lat: principal.p.lat, lng: principal.p.lng, name: principal.p.name, state: principal.p.state, county: principal.c.name, countyArea: { lat: principal.c.lat, lng: principal.c.lng, aland: principal.c.aland } };
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
    points.push({ lat: r.lat, lng: r.lng, name: r.name, state: r.state, ...(r.county ? { county: r.county, countyArea: r.countyArea } : {}) });
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
    // "Buckhead (Atlanta), GA": the parenthesis names the city the place is in — the same-name place nearest to it.
    if (around && !around.stateOnly && inside.length) {
      const host = parseOne(`${inside[0]}, ${around.state}`);
      if (host && !host.stateOnly && host.name !== around.name) {
        const head = outside.split(',')[0];
        const near = sameNameEntries(head).filter((e) => e.state === host.state).sort((a, b) => distanceMiles(a, host) - distanceMiles(b, host))[0];
        if (near && distanceMiles(near, host) <= 30) around = { lat: near.lat, lng: near.lng, name: near.name, state: near.state };
      }
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
export function areaTextPatterns(center, miles, { bareMinPop = 50000, split = false } = {}) {
  if (!usable(center) || !Number.isFinite(miles) || miles <= 0) return [];
  const c = { lat: Number(center.lat), lng: Number(center.lng) };
  // Every piece goes through lib/server/pgrest.js orLiteral (escaped, no list syntax); a period becomes `*`
  // so "St. Louis" also matches "St Louis". The names come from the vendored place tables, never from input.
  const clean = (x) => String(x).toLowerCase().replace(/[:/\\]/g, ' ').split('.').map((part) => orLiteral(part)).join('*').replace(/\s+/g, ' ').trim();
  const out = new Set();
  const dense = new Set(); // patterns that match many rows (big places, counties, nicknames) — read in small chunks
  // A row counts as inside on its distance in tenths of a mile (lib/geo/radius.js), so the words are read for every
  // place up to a mile past the edge — never fewer than the ranking could accept.
  const reach = miles + 1;
  const names = (p) => {
    // "San Buenaventura (Ventura)": the name, and each part as listings write it.
    const raw = String(p.name);
    const parts = raw.includes('(') ? [raw.replace(/\s*\([^)]*\)/g, ''), ...[...raw.matchAll(/\(([^)]*)\)/g)].map((m) => m[1])] : [raw];
    // "St. John" is also written "Saint John", "Ft. Myers" "Fort Myers", "Mt. Juliet" "Mount Juliet" (and back).
    const spelled = [];
    for (const x of parts) {
      spelled.push(x);
      if (/^(?:St|Ste)\.?\s/i.test(x)) spelled.push(x.replace(/^Ste?\.?\s/i, 'Saint '));
      if (/^Saint\s/i.test(x)) spelled.push(x.replace(/^Saint\s/i, 'St. '));
      if (/^Fort\s/i.test(x)) spelled.push(x.replace(/^Fort\s/i, 'Ft. '));
      if (/^Mount\s/i.test(x)) spelled.push(x.replace(/^Mount\s/i, 'Mt. '));
    }
    return [...new Set(spelled.map(clean).filter((n) => n.length >= 3))];
  };
  for (const p of placesWithin(c, reach, { limit: 100000, minPop: 0 })) {
    const all = names(p);
    if (!all.length) continue;
    // Shared with a state or with a bigger place outside the circle ("Columbia, MD" / Columbia SC / District of
    // Columbia; "California, MD"): never read bare — a bare "Columbia" places nowhere anyway (ambiguous).
    // (A lone "New York" is the city — parseOne reads it so — and so is read bare.)
    const shared = (STATE_BY_KEY.has(norm(p.name)) && norm(p.name) !== 'new york')
      || (load().byName.get(norm(p.name)) || []).some((e) => e.pop > p.pop && (e.state !== p.state || distanceMiles(e, p) > 30));
    // Washington, DC is written "Washington, D.C.", "Washington DC", "District of Columbia".
    if (p.state === 'DC') { dense.add('*washington*d*c*'); dense.add('*district of columbia*'); }
    if (p.pop >= bareMinPop && !shared) { for (const name of all) dense.add(`*${name}*`); continue; }
    for (const name of all) {
    if (p.pop > 1 && p.pop < 1000) continue; // a hamlet (named sites are population 1, towns 0: both kept)
    // The town and its state in either order, with anything between: "Mesa, AZ", "Mesa AZ", "Mesa, AZ 85201",
    // "AZ - Mesa", "US-AZ-Mesa", "Mesa, Arizona", "US > Arizona > Mesa". Over-matches are measured away.
    // A distinctive name (two words, or 8+ letters: "Piscataway", "Mount Laurel") is read bare — one pattern for
    // every form. A short one ("Union", "Avon") is read beside its state code or state name, in either order.
    // …unless a state or a bigger place elsewhere shares it (`shared`, above).
    if (!shared && (name.includes(' ') || name.length >= 8)) { out.add(`*${name}*`); continue; }
    const st = p.state.toLowerCase();
    const full = clean(STATES[p.state] || '');
    out.add(`*${name}*${st}*`);
    out.add(`*${st}*${name}*`);
    if (full) { out.add(`*${name}*${full}*`); out.add(`*${full}*${name}*`); }
    }
  }
  // A line that is ONLY a ZIP ("90012", "90012-1234"): every ZIP area in the circle, by its 3-digit prefix, matched
  // as the whole value (a line with a town in it is read by the town).
  for (const pre of zipPrefixesWithin(c, reach)) { out.add(`${pre}__`); out.add(`${pre}__-*`); }
  // "<town>, <County>" and "<neighbourhood>, <County>" (Adzuna): every county the circle can reach, by name.
  for (const [, list] of countyTable()) {
    for (const k of list) {
      if (distanceMiles(c, k) > reach + countyReach(k)) continue;
      dense.add(`*${clean(k.name)}*`);
    }
  }
  for (const n of load().nicks) if (distanceMiles(c, n) <= reach) dense.add(`*${clean(n.nick)}*`);
  for (const d of dense) out.delete(d);
  if (split) return { dense: [...dense], sparse: [...out] };
  return [...dense, ...out];
}

/** The 3-digit prefixes of every ZIP area whose point lies within `miles` of `center`. */
export function zipPrefixesWithin(center, miles) {
  if (!usable(center) || !Number.isFinite(miles) || miles <= 0) return [];
  const out = new Set();
  const latPad = miles / 68.7 + 0.01;
  const lngPad = miles / (68.7 * Math.max(0.01, Math.cos((Number(center.lat) * Math.PI) / 180))) + 0.01;
  for (const [z, p] of zipTable()) {
    if (Math.abs(p.lat - center.lat) > latPad || Math.abs(p.lng - center.lng) > lngPad) continue;
    if (distanceMiles(center, p) <= miles) out.add(z.slice(0, 3));
  }
  return [...out].sort();
}

// ── County searches ("Sussex County, NJ", "Los Angeles County", "Orleans Parish") ─────────────────
const COUNTY_WORD_RE = /\b(?:county|parish|borough|census area)\b/i;
/** Does the text name a county (or parish / borough / census area)? */
export function namesCounty(text) { return COUNTY_WORD_RE.test(String(text || '')); }

/**
 * The counties a typed county search can mean: [{ state, name, lat, lng, aland }]. "Sussex County, NJ" → one;
 * "Washington County" → every state's (the caller asks which); "Maricopa County" → one.
 */
export function findCounties(text) {
  const parts = norm(String(text || '').replace(/>/g, ',')).split(',').map((x) => x.trim()).filter(Boolean);
  const countyPart = parts.find((x) => COUNTY_WORD_RE.test(x));
  if (!countyPart) return [];
  // "sussex county nj" (no comma): a trailing state word.
  let key = countyPart, state = null;
  for (const x of parts) if (x !== countyPart && STATE_BY_KEY.has(x)) state = STATE_BY_KEY.get(x);
  const m = key.match(/^(.*\b(?:county|parish|borough|census area))\s+(.+)$/);
  if (!state && m && STATE_BY_KEY.has(m[2])) { key = m[1]; state = STATE_BY_KEY.get(m[2]); }
  const list = countyTable().get(key) || [];
  return state ? list.filter((c) => c.state === state) : list.slice();
}

/** A county's display label: "Sussex County, NJ". */
export const countyLabel = (c) => `${c.name}, ${c.state}`;

/**
 * The counties a placed town lies in (a city can span several: New York, Chicago). From the Census place-part list
 * for incorporated places; a place not on it (a CDP, a named site, a township) falls in the county whose middle is
 * nearest within reach, in its own state — approximate at county lines.
 * @param {{ name?: string|null, state: string, lat: number, lng: number, county?: string }} pt
 * @returns {string[]} county names
 */
export function countiesOfPlace(pt) {
  if (!pt || !pt.state) return [];
  if (pt.county) return [pt.county];
  countyTable();
  const out = [];
  if (pt.name) {
    const key = `${pt.state}|${norm(pt.name)}`;
    if (!_placeCounties) {
      _placeCounties = new Map();
      for (const [k, list] of _members) {
        const [st, county] = k.split('|');
        for (const [n] of list) {
          const pk = `${st}|${norm(n)}`;
          if (!_placeCounties.has(pk)) _placeCounties.set(pk, []);
          _placeCounties.get(pk).push(county);
        }
      }
    }
    const hit = _placeCounties.get(key);
    if (hit && hit.length) return hit.slice();
  }
  let best = null, bestD = Infinity;
  for (const list of countyTable().values()) {
    for (const c of list) {
      if (c.state !== pt.state) continue;
      const d = distanceMiles(c, pt);
      if (d <= countyReach(c) && d < bestD) { bestD = d; best = c; }
    }
  }
  if (best) out.push(best.name);
  return out;
}
let _placeCounties = null;

/** How far from a county's middle its towns can lie (for a read that must hold the whole county). */
export function countyReachMiles(c) { return countyReach(c); }

// ── ZIP codes: their own state and city (lib/geo/data/us-zip-places.json, scripts/geo/build-us-zip-places.mjs) ──
let _zipPlaces = null;
function zipPlaces() {
  if (_zipPlaces) return _zipPlaces;
  try { _zipPlaces = JSON.parse(readFileSync(new URL('./data/us-zip-places.json', import.meta.url), 'utf8')).zips || {}; }
  catch (e) { console.error(`[usPlaces] ZIP place data unavailable: ${e.message}`); _zipPlaces = {}; }
  return _zipPlaces;
}
let _byPrefix = null;
/**
 * A ZIP's point, state and city. A ZIP code area (ZCTA) is its own internal point, labelled with the place that holds
 * most of its land, in the ZIP's own state (a rural ZIP outside every place: the nearest place in that state). A
 * five-digit ZIP that is not a ZCTA (PO boxes such as 85001, a single business such as 12345) is placed by its
 * neighbours: the ZCTAs sharing its first three digits, at the middle of those in the place most of them name, with
 * `approx: true`. null when no ZCTA shares its first three digits.
 * @returns {{ lat: number, lng: number, state: string, name: string|null, approx?: true } | null}
 */
export function zipPoint(zip) {
  const z = String(zip || '');
  if (!/^\d{5}$/.test(z)) return null;
  const table = zipTable();
  const own = (code) => { const v = zipPlaces()[code]; return v ? { state: v[0], name: v[1] || null } : null; };
  const pt = table.get(z);
  if (pt) {
    const info = own(z);
    if (!info) return null;
    load();
    const raw = info.name || (nearestPlace(pt, info.state) || {}).name || null;
    const name = raw ? (DISPLAY.get(`${info.state}|${norm(raw)}`) || raw) : null;
    return { lat: pt.lat, lng: pt.lng, state: info.state, name };
  }
  if (!_byPrefix) {
    _byPrefix = new Map();
    for (const code of table.keys()) { const k = code.slice(0, 3); if (!_byPrefix.has(k)) _byPrefix.set(k, []); _byPrefix.get(k).push(code); }
  }
  // Only for an assigned USPS prefix with a ZIP area numerically close (85001 → 85003; 12345 → 12309): 99999 has
  // no area within reach and is not a ZIP.
  if (!prefixState(z)) return null;
  const all = (_byPrefix.get(z.slice(0, 3)) || []);
  if (!all.some((code) => Math.abs(Number(code) - Number(z)) <= 40)) return null;
  const near = all.map((code) => ({ code, pt: table.get(code), info: own(code) })).filter((x) => x.info);
  if (!near.length) return null;
  const tally = new Map();
  for (const x of near) { const k = `${x.info.state}|${x.info.name || ''}`; tally.set(k, (tally.get(k) || 0) + 1); }
  const [topKey] = [...tally].sort((a, b) => b[1] - a[1])[0];
  const group = near.filter((x) => `${x.info.state}|${x.info.name || ''}` === topKey);
  const lat = group.reduce((a, x) => a + x.pt.lat, 0) / group.length;
  const lng = group.reduce((a, x) => a + x.pt.lng, 0) / group.length;
  const [state, name] = topKey.split('|');
  const raw = name || (nearestPlace({ lat, lng }, state) || {}).name || null;
  return { lat: Math.round(lat * 1000) / 1000, lng: Math.round(lng * 1000) / 1000, state, name: raw ? (DISPLAY.get(`${state}|${norm(raw)}`) || raw) : null, approx: true };
}

/** Every ZIP code area in the data, for checks: [zip, { state, name }]. */
export function allZips() {
  return Object.entries(zipPlaces()).map(([zip, v]) => [zip, { state: v[0], name: v[1] || null }]);
}

/** Every name a place goes by (Census name, without its legal kind, aliases, nicknames): [{ key, name, state, pop }]. */
export function placeNames(minPop = 5000) {
  const out = [];
  for (const [key, list] of load().byName) {
    for (const e of list) {
      if (e.pop < minPop) continue;
      // The display name: the everyday one ("Nashville" for Nashville-Davidson, "Indianapolis" for "Indianapolis city").
      // (Only a lower-case legal kind is dropped: "Oklahoma City" keeps its "City".)
      const display = DISPLAY.get(`${e.state}|${norm(e.name)}`) || e.name.replace(/\s+(?:city|town|village|borough|township|municipality)$/, '');
      out.push({ key, name: display, state: e.state, pop: e.pop });
    }
  }
  return out;
}

/** Every place entry with this exact name, all states, with population and point (for "which one?" questions). */
export function sameNameEntries(text) {
  const list = load().byName.get(norm(String(text || '')).trim()) || [];
  const out = [];
  for (const e of list) if (!out.some((x) => x.state === e.state && distanceMiles(x, e) < 1)) out.push({ name: e.name, state: e.state, lat: e.lat, lng: e.lng, pop: e.pop });
  return out;
}

/** The big city (200,000+) a point sits in or beside (within 15 mi), or null — names a neighbourhood's city. */
export function hostCity(pt) {
  let best = null, bestD = Infinity;
  for (const e of load().all) {
    if (e.pop < 200000 || e.state !== pt.state) continue;
    const d = distanceMiles(e, pt);
    if (d <= 15 && (!best || e.pop > best.pop)) { best = e; bestD = d; } // the biggest city it sits in or beside
  }
  void bestD;
  return best;
}

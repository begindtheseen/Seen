// Place text formatting shared by the browser and the server — small, pure, no place data.
//
// The ONE fixed format every place field ends up holding is "City, ST" ("Boise, ID", "Phoenix, AZ"); a whole state is
// its name ("Texas"; "New York State" so it is never read back as the city); remote work is "Remote". The
// authoritative "City, ST" comes from the server (lib/geo/placeSuggest.js, which reads lib/geo/usPlaces.js); this file
// only knows the 50 states + DC + PR and how to tidy text for display.
//
//   normalizeLocationText(text) → tidy spacing / commas / case for display ("phoenix ,az" → "Phoenix, AZ"); never
//                                 changes which place the words name, never adds or removes a word.
//   placeKey(text)              → the lowercase cache key for a typed place ("  Phoenix,AZ " → "phoenix, az")
//   isRemoteText(text)          → "remote", "fully remote", "work from home", "wfh"
//   stateLabel(code)            → "Texas", "New York State", null for an unknown code
//   looksFixed(text)            → already in the fixed format ("Phoenix, AZ", "Texas", "Remote") — no need to ask

export const STATE_NAMES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut',
  DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  PR: 'Puerto Rico', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas',
  UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};

/**
 * The label a whole-state search holds. New York is "New York State": a lone "New York" is read as the city
 * everywhere on the site (lib/geo/usPlaces.js). DC is a city ("Washington, DC"), never a state label.
 * @param {string} code
 * @returns {string|null}
 */
export function stateLabel(code) {
  const c = String(code || '').toUpperCase();
  if (c === 'DC' || !STATE_NAMES[c]) return null;
  return c === 'NY' ? 'New York State' : STATE_NAMES[c];
}

const REMOTE_RE = /^\s*(?:100%\s+|fully\s+|full[\s-]time\s+)?(?:remote(?:\s+(?:only|work|jobs?|us|usa|united states))?|work\s+from\s+home|wfh|telecommute|work\s+from\s+anywhere)\s*$/i;
/** Does the text ask for remote work rather than a place? */
export function isRemoteText(text) { return REMOTE_RE.test(String(text ?? '')); }

/** The lowercase key a typed place is cached under: same words, same commas, any spacing or case. */
export function placeKey(text) {
  return String(text ?? '').toLowerCase().replace(/\s*,\s*/g, ', ').replace(/\s+/g, ' ').replace(/^[\s,]+|[\s,]+$/g, '').slice(0, 120);
}

// Words that stay lower case inside a title-cased place name ("Village of Oak Creek", "Paso de Robles").
const SMALL = new Set(['of', 'de', 'del', 'la', 'le', 'du', 'and', 'on', 'the', 'upon', 'at', 'by']);
const titleWord = (w, i) => {
  if (i > 0 && SMALL.has(w)) return w;
  // "o'fallon" → "O'Fallon", "winston-salem" → "Winston-Salem", "mcallen" → "McAllen"
  return w.replace(/(^|[-'’])([a-z])/g, (_, p, c) => p + c.toUpperCase()).replace(/^Mc([a-z])/, (_, c) => `Mc${c.toUpperCase()}`);
};

/**
 * Tidy a typed place for display: one space between words, ", " after a comma and none before it, no stray commas
 * at the ends; text typed all in lower or all in upper case is title-cased, and a state code after a comma (or a
 * known two-letter code at the end) is upper case. Mixed-case text keeps its own case. Display only — the words and
 * their order are kept, so it never names a different place. `keepCase`: spacing and commas only (what the place
 * field does to text it could not place — that stays as the person typed it).
 * @param {unknown} text
 * @param {{ keepCase?: boolean }} [opts]
 * @returns {string}
 */
export function normalizeLocationText(text, { keepCase = false } = {}) {
  let s = String(text ?? '').replace(/\s+/g, ' ').replace(/\s*,[\s,]*/g, ', ').replace(/^[\s,]+|[\s,]+$/g, '');
  if (!s || keepCase) return s;
  const letters = s.replace(/[^A-Za-z]/g, '');
  if (letters && (letters === letters.toLowerCase() || (letters === letters.toUpperCase() && letters.length > 3))) {
    s = s.split(', ').map((part) => part.toLowerCase().split(' ').map(titleWord).join(' ')).join(', ');
  }
  // A two-letter state code last ("phoenix, az", "Phoenix Az") is upper case.
  s = s.replace(/(^|[ ,])([A-Za-z]{2})$/, (m, p, code) => (STATE_NAMES[code.toUpperCase()] ? p + code.toUpperCase() : m));
  return s;
}

const FIXED_RE = /^[A-Z][^,]{0,60}, ([A-Z]{2})$/;
/**
 * Is the text already in the fixed format — "City, ST" with a real state code, a state label, or "Remote"? A field
 * holding one needs no round trip before a search or a save.
 * @param {unknown} text
 */
export function looksFixed(text) {
  const t = String(text ?? '');
  const m = FIXED_RE.exec(t);
  if (m) return !!STATE_NAMES[m[1]];
  if (t === 'Remote') return true;
  return Object.keys(STATE_NAMES).some((c) => stateLabel(c) === t);
}

// Is a listing's location in Seen's market (the US, or remote)?
//
// Employer boards (Greenhouse/Lever/Ashby/…) list every office a company has. A 2026-10-20 sample of
// 25 registered Greenhouse boards had 758 openings, 57% of them US or remote; the rest were London,
// Bengaluru, Toronto, "Remote (EMEA)" and so on. Seen's users search US jobs, so those rows only cost
// database space and dilute results. Used by the employer-board sync (api/refresh-employer-boards.js).
//
// Scopes:
//   'us'       — names the US, a US state (name or ", XX" code), or a well-known US city
//   'remote'   — remote/anywhere with no non-US region attached
//   'unknown'  — empty, so nothing to judge (kept: absence of evidence is not a foreign office)
//   'non_us'   — names a non-US country, region or major foreign city, and no US marker
//   'unplaced' — a bare place name we cannot place (dropped: on a multinational board it is far more
//                often a foreign office than an unlisted US town)
// A line that names BOTH ("New York or London") is 'us'. Tests: lib/jobs/usLocation.test.mjs.

const STATE_NAMES = [
  'alabama', 'alaska', 'arizona', 'arkansas', 'california', 'colorado', 'connecticut', 'delaware', 'florida',
  'georgia', 'hawaii', 'idaho', 'illinois', 'indiana', 'iowa', 'kansas', 'kentucky', 'louisiana', 'maine',
  'maryland', 'massachusetts', 'michigan', 'minnesota', 'mississippi', 'missouri', 'montana', 'nebraska', 'nevada',
  'new hampshire', 'new jersey', 'new mexico', 'new york', 'north carolina', 'north dakota', 'ohio', 'oklahoma',
  'oregon', 'pennsylvania', 'rhode island', 'south carolina', 'south dakota', 'tennessee', 'texas', 'utah',
  'vermont', 'virginia', 'washington', 'west virginia', 'wisconsin', 'wyoming', 'district of columbia', 'puerto rico',
];
const STATE_CODES = 'AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC|PR';
const US_CITIES = [
  'new york city', 'nyc', 'los angeles', 'chicago', 'houston', 'phoenix', 'philadelphia', 'san antonio', 'san diego',
  'dallas', 'san jose', 'austin', 'jacksonville', 'fort worth', 'columbus', 'charlotte', 'san francisco', 'bay area',
  'silicon valley', 'indianapolis', 'seattle', 'denver', 'boston', 'nashville', 'detroit', 'portland', 'las vegas',
  'baltimore', 'milwaukee', 'sacramento', 'kansas city', 'atlanta', 'raleigh', 'miami', 'oakland', 'minneapolis',
  'tampa', 'new orleans', 'cleveland', 'pittsburgh', 'cincinnati', 'st. louis', 'saint louis', 'orlando', 'salt lake city',
  'palo alto', 'mountain view', 'menlo park', 'redwood city', 'santa monica', 'brooklyn', 'manhattan', 'cambridge, ma',
  'boulder', 'ann arbor', 'durham', 'irvine', 'plano', 'scottsdale', 'boise', 'richmond', 'louisville', 'honolulu',
];

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Strong US evidence: the country, a state's full name, or a well-known US city.
const US_STRONG_RE = new RegExp(
  [
    '\\b(?:united states(?: of america)?|u\\.s\\.a\\.?|usa|north america)\\b',
    `\\b(?:${STATE_NAMES.map(esc).join('|')})\\b`,
    `\\b(?:${US_CITIES.map(esc).join('|')})\\b`,
  ].join('|'),
  'i',
);
// "Remote - US", "US (Remote)", "U.S." — upper case only, so "us" in prose is not a match.
const US_TOKEN_RE = /(?:^|[\s(,/-])(?:US|U\.S\.?)(?=$|[\s),/-])/;
// Weak US evidence: ", XX" with a state code ("Austin, TX", "Austin, TX 78701"). "IN" is also India
// and "CA" also Canada, so a code alone never beats a named foreign place.
const US_CODE_RE = new RegExp(`,\\s*(?:${STATE_CODES})(?=$|[\\s,;)/-])`, 'i');

// Unicode-aware word edges: \b treats "á" as a non-letter, so "Bogotá" never matched "bogotá\b".
const NON_US_RE = new RegExp(
  '(?<!\\p{L})(?:' + [
    // countries
    'canada', 'mexico', 'méxico', 'cdmx', 'ciudad de méxico', 'brazil', 'brasil', 'argentina', 'colombia', 'chile', 'peru', 'uruguay', 'costa rica',
    'united kingdom', 'uk', 'u\\.k\\.', 'england', 'scotland', 'wales', 'ireland', 'northern ireland', 'germany',
    'deutschland', 'france', 'spain', 'españa', 'portugal', 'italy', 'netherlands', 'the netherlands', 'belgium',
    'switzerland', 'austria', 'sweden', 'norway', 'denmark', 'finland', 'iceland', 'poland', 'czech republic', 'czechia',
    'slovakia', 'romania', 'bulgaria', 'hungary', 'greece', 'croatia', 'serbia', 'ukraine', 'estonia', 'latvia',
    'lithuania', 'turkey', 'türkiye', 'israel', 'uae', 'united arab emirates', 'saudi arabia', 'qatar', 'egypt',
    'morocco', 'nigeria', 'kenya', 'ghana', 'south africa', 'india', 'pakistan', 'bangladesh', 'sri lanka', 'nepal',
    'singapore', 'malaysia', 'indonesia', 'philippines', 'vietnam', 'thailand', 'china', 'hong kong', 'taiwan',
    'japan', 'south korea', 'korea', 'australia', 'new zealand', 'luxembourg', 'cyprus', 'malta',
    // regions
    'emea', 'apac', 'apj', 'latam', 'latin america', 'europe', 'european union', 'eu', 'asia', 'asia pacific',
    'africa', 'middle east', 'nordics', 'dach', 'benelux', 'anz', 'oceania',
    // major foreign cities that boards list without a country
    'london', 'berlin', 'munich', 'hamburg', 'frankfurt', 'paris', 'madrid', 'barcelona', 'lisbon', 'amsterdam',
    'dublin', 'zurich', 'zürich', 'geneva', 'stockholm', 'copenhagen', 'oslo', 'helsinki', 'warsaw', 'krakow',
    'kraków', 'prague', 'budapest', 'bucharest', 'vienna', 'milan', 'rome', 'brussels', 'tel aviv', 'dubai',
    'toronto', 'montreal', 'montréal', 'vancouver, bc', 'calgary', 'ottawa', 'waterloo, on', 'mexico city',
    'são paulo', 'sao paulo', 'buenos aires', 'bogotá', 'bogota', 'bangalore', 'bengaluru', 'hyderabad',
    'chennai', 'pune', 'mumbai', 'delhi', 'gurgaon', 'gurugram', 'noida', 'manila', 'tokyo', 'seoul', 'shanghai',
    'beijing', 'shenzhen', 'sydney', 'melbourne', 'auckland',
  ].map(esc).join('|') + ')(?!\\p{L})'
  // Canadian provinces after a comma ("Toronto, ON")
  + '|,\\s*(?:ON|BC|QC|AB|MB|NS|NB|NL|PE|SK)(?=$|[\\s,;)/-])',
  'iu',
);
const REMOTE_RE = /\b(?:remote|anywhere|work from home|wfh|distributed|virtual|worldwide|global)\b/i;

/** @returns {'us'|'remote'|'unknown'|'non_us'|'unplaced'} */
export function locationScope(location) {
  const s = String(location ?? '').replace(/\s+/g, ' ').trim();
  if (!s || /^(?:n\/?a|tbd|unknown|not specified|multiple locations?|various)$/i.test(s)) return 'unknown';
  if (US_STRONG_RE.test(s) || US_TOKEN_RE.test(s)) return 'us';
  if (NON_US_RE.test(s)) return 'non_us';
  if (US_CODE_RE.test(s)) return 'us';
  if (REMOTE_RE.test(s)) return 'remote';
  return 'unplaced';
}

/** True when a board listing belongs in Seen's US + remote market. */
export function inUsMarket(location) {
  const scope = locationScope(location);
  return scope === 'us' || scope === 'remote' || scope === 'unknown';
}

// ── Country codes ─────────────────────────────────────────────────────────────────────────────
// Some feeds state the country as an ISO 3166-1 alpha-2 code beside a bare city ("La Roca del
// Valles, Barcelona" + country "ES"; "Serravalle Scrivia, Piedmont" + "IT"). The text alone can
// be 'unplaced'; the code is decisive. `withCountry` writes the country's name into the location
// text so `locationScope` (and every reader of the stored row) can judge it.
const COUNTRY_NAMES = {
  US: 'United States', PR: 'Puerto Rico',
  CA: 'Canada', MX: 'Mexico', BR: 'Brazil', AR: 'Argentina', CO: 'Colombia', CL: 'Chile', PE: 'Peru', UY: 'Uruguay', CR: 'Costa Rica',
  GB: 'United Kingdom', UK: 'United Kingdom', IE: 'Ireland', DE: 'Germany', FR: 'France', ES: 'Spain', PT: 'Portugal', IT: 'Italy',
  NL: 'Netherlands', BE: 'Belgium', CH: 'Switzerland', AT: 'Austria', SE: 'Sweden', NO: 'Norway', DK: 'Denmark', FI: 'Finland',
  IS: 'Iceland', PL: 'Poland', CZ: 'Czech Republic', SK: 'Slovakia', RO: 'Romania', BG: 'Bulgaria', HU: 'Hungary', GR: 'Greece',
  HR: 'Croatia', RS: 'Serbia', UA: 'Ukraine', EE: 'Estonia', LV: 'Latvia', LT: 'Lithuania', TR: 'Turkey', IL: 'Israel',
  AE: 'United Arab Emirates', SA: 'Saudi Arabia', QA: 'Qatar', EG: 'Egypt', MA: 'Morocco', NG: 'Nigeria', KE: 'Kenya', GH: 'Ghana',
  ZA: 'South Africa', IN: 'India', PK: 'Pakistan', BD: 'Bangladesh', LK: 'Sri Lanka', NP: 'Nepal', SG: 'Singapore', MY: 'Malaysia',
  ID: 'Indonesia', PH: 'Philippines', VN: 'Vietnam', TH: 'Thailand', CN: 'China', HK: 'Hong Kong', TW: 'Taiwan', JP: 'Japan',
  KR: 'South Korea', AU: 'Australia', NZ: 'New Zealand', LU: 'Luxembourg', CY: 'Cyprus', MT: 'Malta',
};

/** True for a US country code (US, PR); false for any other known code; null when the code is unknown/empty. */
export function countryIsUs(code) {
  const c = String(code ?? '').trim().toUpperCase();
  if (!c) return null;
  if (c === 'US' || c === 'USA' || c === 'PR') return true;
  return COUNTRY_NAMES[c] ? false : null;
}

/**
 * A location text that names its country when a feed stated one by code and the text does not
 * already: ("La Roca del Valles, Barcelona", "ES") → "La Roca del Valles, Barcelona, Spain";
 * ("Austin, TX", "US") → "Austin, TX" (a US code adds nothing). Unknown codes change nothing.
 */
export function withCountry(location, code) {
  const loc = String(location ?? '').replace(/\s+/g, ' ').trim();
  const c = String(code ?? '').trim().toUpperCase();
  const name = COUNTRY_NAMES[c];
  if (!name || countryIsUs(c)) return loc;
  if (!loc) return name;
  if (loc.toLowerCase().includes(name.toLowerCase())) return loc;
  return `${loc}, ${name}`;
}

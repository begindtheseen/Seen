// THE one place a stored company name becomes a readable one. Plain JS so the api/*.js handlers, the
// enrichment pipeline, lib/ and the client bundle (through lib/companyDisplay.ts) all read the same map
// — /companies rendered "Jpmorganchase" and the jobs page "plscareers" because each surface cased names
// on its own (audit 2026-10-23/24).
//
// Stored data is never changed here: company_scores / reports / jobs keep their stored names.

// Brands whose spelling is not Title Case, keyed by the stored (lowercase) name or a single word of it,
// plus ATS board slugs that are stored AS the company name ("plscareers" is Greenhouse's board slug for
// PLS Financial Services). Small on purpose — add a line when a real company on the site renders wrong,
// never guess.
export const KNOWN_BRANDS = Object.freeze({
  "mcdonald's": "McDonald's", mcdonalds: "McDonald's", ebay: 'eBay', iheartmedia: 'iHeartMedia', pwc: 'PwC',
  ups: 'UPS', 'at&t': 'AT&T', aaa: 'AAA', ibm: 'IBM', cvs: 'CVS', hp: 'HP', '3m': '3M', kpmg: 'KPMG', ey: 'EY',
  bmw: 'BMW', usaa: 'USAA', fedex: 'FedEx', cdw: 'CDW', saic: 'SAIC', 'h&m': 'H&M', 't-mobile': 'T-Mobile',
  jpmorgan: 'JPMorgan', jpmorganchase: 'JPMorgan Chase', 'jp morgan': 'JPMorgan', 'jp morgan chase': 'JPMorgan Chase',
  nvidia: 'NVIDIA', ubs: 'UBS', cbre: 'CBRE', adp: 'ADP', aecom: 'AECOM', bae: 'BAE',
  dhl: 'DHL', dsw: 'DSW', gnc: 'GNC', hca: 'HCA', kfc: 'KFC', lg: 'LG', nbcuniversal: 'NBCUniversal', pnc: 'PNC',
  pepsico: 'PepsiCo', usps: 'USPS', ulta: 'Ulta', wework: 'WeWork', 'o’reilly': 'O’Reilly',
  "o'reilly": "O'Reilly", linkedin: 'LinkedIn', paypal: 'PayPal', youtube: 'YouTube', github: 'GitHub',
  gitlab: 'GitLab', doordash: 'DoorDash', carmax: 'CarMax', petsmart: 'PetSmart', walgreens: 'Walgreens',
  'mistral.ai': 'Mistral AI', openai: 'OpenAI', deepmind: 'DeepMind', spacex: 'SpaceX', 'coca-cola': 'Coca-Cola',
  taskus: 'TaskUs', givewell: 'GiveWell', sosafe: 'SoSafe', adventhealth: 'AdventHealth', arcbest: 'ArcBest',
  sunrun: 'Sunrun', dupont: 'DuPont', servicenow: 'ServiceNow', salesforce: 'Salesforce', snowflake: 'Snowflake',
  uwm: 'UWM', ge: 'GE', td: 'TD', bny: 'BNY', rbc: 'RBC', hsbc: 'HSBC',
  nyu: 'NYU', ucla: 'UCLA', usc: 'USC', mit: 'MIT', llc: 'LLC', inc: 'Inc', usa: 'USA', us: 'US',
  heb: 'H-E-B', 'h-e-b': 'H-E-B', 'cvs health': 'CVS Health', 'ups store': 'UPS Store',
  // ATS board slugs seen as company names on /jobs (audit 2026-10-24).
  plscareers: 'PLS Financial Services', aloyoga: 'Alo Yoga', karllagerfeld: 'Karl Lagerfeld',
  tactilemedical: 'Tactile Medical', storycannabis: 'Story Cannabis', spacexglobal: 'SpaceX',
});

// Words that stay lowercase inside a name ("Bank of America", "Barnes & Noble").
const SMALL_WORDS = new Set(['of', 'and', 'the', 'for', 'at', 'in', 'on', 'de', 'la', 'du', 'von', 'van', 'y']);

function caseWord(word, first) {
  const lower = word.toLowerCase();
  if (KNOWN_BRANDS[lower]) return KNOWN_BRANDS[lower];
  if (!first && SMALL_WORDS.has(lower)) return lower;
  // Capitalize the first letter and the letter after a hyphen ("e-commerce" → "E-Commerce",
  // "coca-cola" → "Coca-Cola"); never after an apostrophe ("lowe's" stays "Lowe's").
  return lower.replace(/(^|-)([a-zà-ÿ])/g, (_m, sep, c) => sep + c.toUpperCase());
}

/**
 * How a stored company name is shown: "walmart" → "Walmart", "united wholesale mortgage" →
 * "United Wholesale Mortgage", "aaa" → "AAA", "jpmorganchase" → "JPMorgan Chase", "plscareers" →
 * "PLS Financial Services", "bank of america" → "Bank of America". A name that already carries mixed
 * case (an employer-typed "DoorDash") is returned as is. Empty input → ''.
 * @param {string|null|undefined} name
 * @returns {string}
 */
export function displayCompanyName(name) {
  const raw = String(name ?? '').trim().replace(/\s+/g, ' ');
  if (!raw) return '';
  const whole = KNOWN_BRANDS[raw.toLowerCase()];
  if (whole) return whole;
  // Already mixed-case (not all lower, not all upper) → the author chose the casing; keep it.
  if (raw !== raw.toLowerCase() && raw !== raw.toUpperCase()) return raw;
  return raw.split(' ').map((w, i) => caseWord(w, i === 0)).join(' ');
}

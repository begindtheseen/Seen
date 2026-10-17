// City capture for the credit report jobs (web-reports.mjs, reddit-backfill.mjs write).
//
// Where a report's city lives (verified on prod 2026-10-17): `reports` has NO city column
// (`select=city` → 42703 "column reports.city does not exist"); company pages read a report's city
// through reports.location_id → company_locations.city (api/reports.js buildResponse). So a captured
// city is written ONLY as location_id, resolved/created with the app's own resolveOrCreateLocation
// (api/_utils/reportWrite.js) — exact case-insensitive match on (company_id, city), else insert.
//
// Format: "City, ST" for US states (the app's own example, "Austin, TX"; full state names are folded
// to the postal code so "Austin, Texas" and "Austin, TX" don't become two rows we create). Anything
// else stated with a region ("Toronto, ON", "London, UK") is kept as written. Vague values
// ("Remote", "USA", "multiple locations") are null — never guessed.

import { resolveOrCreateLocation } from '../../../api/_utils/reportWrite.js';

export const US_STATES = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO', connecticut: 'CT',
  delaware: 'DE', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
  kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI',
  minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH',
  'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH',
  oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD',
  tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV',
  wisconsin: 'WI', wyoming: 'WY', 'district of columbia': 'DC', 'washington dc': 'DC', 'washington d.c.': 'DC', 'd.c.': 'DC',
  'puerto rico': 'PR',
};
const STATE_CODES = new Set(Object.values(US_STATES));

const VAGUE = /^(?:remote|hybrid|on-?site|virtual|work from home|wfh|anywhere|nationwide|national|multiple|various|several|many|usa?|u\.s\.a?\.?|united states|america|n\/?a|none|null|unknown|not stated|unspecified|headquarters|hq|corporate|global|worldwide|international)(?:\s+(?:locations?|offices?|sites?|cities|states|areas?|only|based))?$/i;

const titleWord = (w) => (/^[a-z]/.test(w) && w === w.toLowerCase() ? w[0].toUpperCase() + w.slice(1) : w);

/** Model-returned city → "City, ST" / "City, Region" / "City", or null. */
export function normalizeCity(raw) {
  if (raw == null || typeof raw !== 'string') return null;
  let s = raw.replace(/\s+/g, ' ').trim().replace(/[.;]+$/, '');
  if (!s || s.length > 80) return null;
  if (/[@<>`\\/]|https?:|www\./i.test(s)) return null;
  s = s.replace(/\s*\b\d{5}(?:-\d{4})?\b\s*$/, '').trim();          // trailing ZIP
  s = s.replace(/,\s*(usa|us|u\.s\.a?\.?|united states)$/i, '').trim(); // ", USA"
  if (/\d/.test(s)) return null;                                      // street addresses, "3 cities"
  if (!/[a-z]/i.test(s) || VAGUE.test(s)) return null;
  const parts = s.split(',').map((p) => p.trim()).filter(Boolean);
  if (!parts.length || parts.length > 3) return null;
  const city = parts[0].split(' ').map(titleWord).join(' ');
  if (city.length < 2 || VAGUE.test(city)) return null;
  if (parts.length === 1) {
    // "Washington DC" / "Washington, D.C." style without a comma.
    return US_STATES[city.toLowerCase()] === 'DC' ? 'Washington, DC' : city;
  }
  const region = parts[parts.length - 1];
  const code = US_STATES[region.toLowerCase()] || (STATE_CODES.has(region.toUpperCase()) && region.length === 2 ? region.toUpperCase() : null);
  return `${city}, ${code || region}`;
}

/**
 * Per-run cache around resolveOrCreateLocation: one lookup per (company_id, city), null when either
 * is missing. resolve is injectable for tests; errors read as null (the report is still written).
 */
export function createLocationResolver({ url, hdrs, resolve = resolveOrCreateLocation, log = () => {} }) {
  const cache = new Map();
  const stats = { lookups: 0, resolved: 0, failed: 0 };
  async function locationId(companyId, city) {
    if (!companyId || !city) return null;
    const key = `${companyId}|${city.toLowerCase()}`;
    if (!cache.has(key)) {
      stats.lookups++;
      cache.set(key, Promise.resolve()
        .then(() => resolve(url, hdrs, companyId, city))
        .then((id) => { if (id) stats.resolved++; else stats.failed++; return id || null; })
        .catch((e) => { stats.failed++; log(`    location "${city}" failed: ${String(e?.message || e).slice(0, 120)}`); return null; }));
    }
    return cache.get(key);
  }
  return { locationId, stats };
}

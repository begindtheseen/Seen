// USAJOBS — the US federal government's official job board (developer.usajobs.gov).
//
// Free, keyed, and documented: GET https://data.usajobs.gov/api/Search with three headers —
// Host: data.usajobs.gov, User-Agent: <the email the key was issued to>, Authorization-Key: <key>.
// Up to 500 rows a page and 10,000 a query; no request-rate limit is published (checked 2026-10-20).
// Federal openings span every field Seen covers (warehouse, nursing, admin, trades, IT), with real
// pay ranges on every posting.
//
// No-op (returns []) unless USAJOBS_API_KEY and USAJOBS_EMAIL are set, so it can ship before the key.
// Rows go through buildJob() like every other source (same junk filter, scoring, 14-day expiry).
// Tests: lib/server/usajobs.test.mjs.

import { buildJob } from './jobSources.js';
import { normalizePay } from '../jobs/pay.js';

const ENDPOINT = 'https://data.usajobs.gov/api/Search';

export function usajobsCredentials(env = process.env) {
  const key = env.USAJOBS_API_KEY;
  const email = env.USAJOBS_EMAIL;
  return key && email ? { key, email } : null;
}

// RateIntervalCode → the period lib/jobs/pay.js normalises in (PA per annum, PH per hour, PW per week,
// PM per month). Any other code (PD per day, BW bi-weekly, FB fee basis, WC without compensation) is
// shown as the raw amounts with the posting's own interval words — never relabelled.
const RATE_PERIOD = { PA: 'year', PH: 'hour', PW: 'week', PM: 'month' };
// A code we know is NOT one of those periods still declares the figure's period → never inferred.
const OTHER_RATE = new Set(['PD', 'BW', 'FB', 'WC']);

/** "$52k–$68k/yr" or "$18.50–$22/hr" from PositionRemuneration[0]; yearlyMin for the scorer. */
export function usajobsSalary(rem) {
  if (!rem) return { text: null, yearlyMin: 0 };
  const lo = Number(rem.MinimumRange) || 0;
  const hi = Number(rem.MaximumRange) || 0;
  if (!(lo > 0) && !(hi > 0)) return { text: null, yearlyMin: 0 };
  const code = String(rem.RateIntervalCode || '').toUpperCase();
  const period = RATE_PERIOD[code] || (OTHER_RATE.has(code) ? 'other' : null);
  const n = normalizePay({ min: lo, max: hi, period });
  if (!n) return { text: null, yearlyMin: 0 };
  if (n.period || !rem.Description) return { text: n.text, yearlyMin: n.yearlyMin };
  return { text: `${n.text} ${String(rem.Description).trim().toLowerCase()}`.slice(0, 120), yearlyMin: 0 };
}

/** One SearchResultItems[] entry → a buildJob() row, or null. */
export function mapUsajobsItem(item, searchQuery = '') {
  const d = item?.MatchedObjectDescriptor;
  if (!d) return null;
  const first = Array.isArray(d.PositionLocation) ? d.PositionLocation[0] : null;
  const display = String(d.PositionLocationDisplay || '').trim();
  // "Multiple Locations" says nothing; the first listed location is a real place on the posting.
  const location = (!display || /^multiple locations$/i.test(display)) ? (first?.LocationName || display || 'United States') : display;
  const { text: salary, yearlyMin } = usajobsSalary(Array.isArray(d.PositionRemuneration) ? d.PositionRemuneration[0] : null);
  const details = d.UserArea?.Details || {};
  const duties = Array.isArray(details.MajorDuties) ? details.MajorDuties.join(' ') : (details.MajorDuties || '');
  const description = [details.JobSummary, duties, d.QualificationSummary].filter(Boolean).join('\n\n');
  const schedule = Array.isArray(d.PositionSchedule) ? d.PositionSchedule[0]?.Name : '';
  const applyUrl = (Array.isArray(d.ApplyURI) && d.ApplyURI[0]) || d.PositionURI || null;
  const id = item.MatchedObjectId || d.PositionID;
  return buildJob({
    title: d.PositionTitle,
    company: d.OrganizationName || d.DepartmentName,
    location,
    salary,
    description,
    apply_url: applyUrl,
    source: 'USAJOBS',
    type: /part/i.test(schedule || '') ? 'Part-time' : 'Full-time',
    searchQuery,
    externalId: id ? `usajobs-${id}` : null,
    salaryMin: yearlyMin,
    lat: first?.Latitude ?? null,
    lng: first?.Longitude ?? null,
  });
}

/**
 * Search USAJOBS. `where` may be empty or "Remote" (both search nationwide); radiusMiles applies
 * only with a location. Never throws: any failure is logged and returns [].
 */
export async function fetchUsaJobs(what, where = '', { credentials = usajobsCredentials(), radiusMiles = 0, perPage = 100, fetchImpl = fetch, timeoutMs = 9000 } = {}) {
  if (!credentials || !what) return [];
  const url = new URL(ENDPOINT);
  url.searchParams.set('Keyword', what);
  const place = String(where || '').trim();
  if (place && !/^remote$/i.test(place)) {
    url.searchParams.set('LocationName', place);
    if (radiusMiles > 0) url.searchParams.set('Radius', String(Math.round(radiusMiles)));
  }
  url.searchParams.set('ResultsPerPage', String(Math.min(500, Math.max(1, perPage))));
  url.searchParams.set('DatePosted', '30');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url.toString(), {
      headers: { Host: 'data.usajobs.gov', 'User-Agent': credentials.email, 'Authorization-Key': credentials.key, Accept: 'application/json' },
      signal: ctrl.signal,
    });
    if (!res.ok) { console.warn(`USAJOBS ${res.status} for "${what}"`); return []; }
    const data = await res.json();
    const items = data?.SearchResult?.SearchResultItems;
    return (Array.isArray(items) ? items : []).map((i) => mapUsajobsItem(i, what)).filter(Boolean);
  } catch (e) {
    console.warn('USAJOBS fetch error:', e.message);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

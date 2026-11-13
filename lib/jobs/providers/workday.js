// Workday — the public candidate site's own JSON ("cxs") API.
//
// Tenant string (company_sources.tenant): "<host prefix>/<tenant>/<site>", e.g. "hpinc.wd5/hpinc/hpinc"
// for https://hpinc.wd5.myworkdayjobs.com/hpinc. The registry lowercases tenants; Workday's cxs paths
// answer the same in any case (verified 2026-11-13 on ProPetro_Careers), and the apply link is the
// posting's own externalUrl, so nothing depends on the original case.
//
//   list:   POST https://<host>/wday/cxs/<tenant>/<site>/jobs  {limit:20, offset, searchText:'', appliedFacets:{}}
//           → { total (first page only), jobPostings:[{ title, externalPath, locationsText, postedOn, bulletFields }] }
//   detail: GET  https://<host>/wday/cxs/<tenant>/<site><externalPath>
//           → { jobPostingInfo: { jobDescription (HTML), location, additionalLocations[], country.alpha2Code,
//               timeType, startDate, jobReqId, externalUrl }, hiringOrganization: { name } }
//
// The list carries no description and only a place label ("Odessa-TX-USA", "TX - Midland", "6 Locations",
// "GB-AC-ABERDEEN-…"), so every kept posting needs its detail: postings the list already places abroad
// are skipped before that call (Baker Hughes lists 668 openings worldwide), and the detail's country
// code decides the rest. A posting at several places becomes one row per US place (rowsForPlaces).
// Workday states no structured pay on this API; pay stated in the posting text stays in the text.

import { buildJob, cleanDescription } from '../../server/jobSources.js';
import { pickCompanyName } from '../companyName.js';
import { locationScope, countryIsUs } from '../usLocation.js';
import { request, makeBudget, callTimeout, mapWithin, rotated, plainText, sameHostUrl, placeWithCountry, rowsForPlaces, tidyCaps } from './common.js';

const PAGE = 20; // the cxs API refuses larger pages
const STATE_CODES = new Set('AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC PR'.split(' '));
const STATE_NAMES = new Set(['alabama', 'alaska', 'arizona', 'arkansas', 'california', 'colorado', 'connecticut', 'delaware', 'florida', 'georgia', 'hawaii', 'idaho', 'illinois', 'indiana', 'iowa', 'kansas', 'kentucky', 'louisiana', 'maine', 'maryland', 'massachusetts', 'michigan', 'minnesota', 'mississippi', 'missouri', 'montana', 'nebraska', 'nevada', 'new hampshire', 'new jersey', 'new mexico', 'new york', 'north carolina', 'north dakota', 'ohio', 'oklahoma', 'oregon', 'pennsylvania', 'rhode island', 'south carolina', 'south dakota', 'tennessee', 'texas', 'utah', 'vermont', 'virginia', 'washington', 'west virginia', 'wisconsin', 'wyoming']);
// Every ISO 3166-1 alpha-2 country code, for list labels that lead with one ("LY-TRIPOLI-…", "GY-…").
// A code that is also a US state (CA, IN, DE, AZ, ID, CO, GA, …) is never judged from the list.
const ISO2 = new Set(('AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ '
  + 'CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH '
  + 'GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB '
  + 'LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM '
  + 'PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG '
  + 'TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW').split(' '));
// Three-letter country codes boards put first ("IND - Karnataka - Mysuru"); never a US state.
const ISO3_ABROAD = new Set('IND MEX CAN GBR BRA ARG COL ECU PER NOR AUS NZL SAU ARE KWT QAT OMN BHR IRQ EGY DZA NGA AGO GHA KEN ZAF CHN SGP MYS IDN THA VNM PHL JPN KOR DEU FRA NLD ITA ESP POL ROU KAZ AZE TTO GUY'.split(' '));

const PREFIX_RE = /^[a-z0-9-]{1,63}(?:\.wd\d{1,3})?$/i;
const NAME_RE = /^[a-z0-9][a-z0-9_.-]{0,99}$/i;

/** "hpinc.wd5/hpinc/hpinc" → { host, tenant, site } or null when it is not a full Workday tenant. */
export function parseWorkdayTenant(value) {
  const parts = String(value || '').trim().split('/');
  if (parts.length !== 3) return null;
  const [prefix, tenant, site] = parts;
  if (!PREFIX_RE.test(prefix) || !NAME_RE.test(tenant) || !NAME_RE.test(site)) return null;
  return { host: `${prefix.toLowerCase()}.myworkdayjobs.com`, tenant, site };
}

const titleCase = (s) => (s === s.toUpperCase() ? s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()) : s);

/**
 * A Workday place label as "City, ST" when it is one of the US shapes boards use, with the country
 * written in when the posting states it (placeWithCountry):
 *   "Odessa-TX-USA" → "Odessa, TX"; "US-TX-HOUSTON-2001 RANKIN ROAD" → "Houston, TX";
 *   "TX - Midland, 3919 N FM 1788" → "Midland, TX"; "USA - Utah - West Valley City" → "West Valley City, Utah".
 * `usBoard`: the posting's own country is the US (state-first labels are only read as states then —
 * "CA - Calgary" on a Canadian posting is not California).
 */
export function workdayPlace(text, countryCode = null, { usBoard = false } = {}) {
  let t = plainText(text, 160);
  const us = countryIsUs(countryCode) === true || (!countryCode && usBoard);
  const hadUsMarker = /^(?:USA?|United States(?: of America)?)\s*-\s*/i.test(t);
  if (us || hadUsMarker) {
    t = t.replace(/^(?:USA?|United States(?: of America)?)\s*-\s*/i, '');
    let m = t.match(/^(.+?)\s*-\s*([A-Za-z]{2})\s*-\s*USA?$/i);
    if (m && STATE_CODES.has(m[2].toUpperCase())) t = `${titleCase(m[1].trim())}, ${m[2].toUpperCase()}`;
    else if ((m = t.match(/^([A-Z]{2})\s*-\s*([^,-]+)/)) && STATE_CODES.has(m[1])) t = `${titleCase(m[2].trim())}, ${m[1]}`;
    else if ((m = t.match(/^([A-Za-z ]+?)\s+-\s+([^,-]+)/)) && STATE_NAMES.has(m[1].trim().toLowerCase())) t = `${titleCase(m[2].trim())}, ${m[1].trim()}`;
  }
  return countryCode ? placeWithCountry(t, countryCode) : t;
}

/** True when the list's place label already says the posting is abroad (its detail is not fetched). */
export function listPlaceAbroad(label) {
  const t = plainText(label, 160);
  if (!t || /^\d+\s+locations?$/i.test(t)) return false;
  if (locationScope(t) === 'non_us') return true;
  const toks = t.split(/\s*-\s*/);
  if (toks[0] === 'DNU') toks.shift();
  if (toks.length < 2) return false;
  const c = toks[0];
  if (/^[A-Z]{2}$/.test(c)) return ISO2.has(c) && !STATE_CODES.has(c) && c !== 'US' && c !== 'UM' && c !== 'VI' && c !== 'GU' && c !== 'AS' && c !== 'MP';
  if (/^[A-Z]{3}$/.test(c)) return ISO3_ABROAD.has(c);
  return false;
}

export const workday = {
  id: 'workday', sourceType: 'ATS_DIRECT', ingestable: true,
  /**
   * @param {string} tenantValue "<host prefix>/<tenant>/<site>"
   * @param {{ companyName?: string, fetchImpl?: typeof fetch, timeoutMs?: number, budgetMs?: number, maxPostings?: number, concurrency?: number }} opts
   */
  async fetchCompanyJobs(tenantValue, { companyName, fetchImpl, timeoutMs = 10000, budgetMs = 60000, maxPostings = 2000, concurrency = 6, rotate } = {}) {
    const t = parseWorkdayTenant(tenantValue);
    if (!t) return [];
    const budget = makeBudget(budgetMs);
    const base = `https://${t.host}/wday/cxs/${encodeURIComponent(t.tenant)}/${encodeURIComponent(t.site)}`;

    // 1. Every list page, until the board's total, the posting cap, or the budget.
    const postings = [];
    let total = Infinity;
    for (let offset = 0; offset < Math.min(total, maxPostings) && !budget.expired(); offset += PAGE) {
      const page = await request(`${base}/jobs`, {
        method: 'POST', body: { limit: PAGE, offset, searchText: '', appliedFacets: {} },
        headers: { 'Content-Type': 'application/json' }, fetchImpl, timeoutMs: callTimeout(budget, timeoutMs),
      });
      const list = Array.isArray(page?.jobPostings) ? page.jobPostings : null;
      if (!list) { if (offset === 0) return []; break; }
      // Workday states the total on the first page only (later pages answer 0).
      if (offset === 0) total = Number.isFinite(Number(page.total)) && Number(page.total) > 0 ? Number(page.total) : list.length;
      postings.push(...list);
      if (list.length < PAGE) break;
    }

    // 2. One detail per posting the list does not already place abroad.
    const seen = new Set();
    const wanted = postings.filter((p) => {
      const path = typeof p?.externalPath === 'string' ? p.externalPath : '';
      if (!/^\/job\/[^?#]+$/.test(path) || path.includes('..') || seen.has(path)) return false;
      seen.add(path);
      return !listPlaceAbroad(p.locationsText);
    });
    let feedName = '';
    const rows = await mapWithin(rotated(wanted, rotate), concurrency, budget, async (p) => {
      const detail = await request(`${base}${p.externalPath}`, { fetchImpl, timeoutMs: callTimeout(budget, timeoutMs) });
      const info = detail?.jobPostingInfo;
      if (!info || info.posted === false) return null;
      if (!feedName && typeof detail?.hiringOrganization?.name === 'string') feedName = detail.hiringOrganization.name.replace(/^\d+\s+/, '');
      const title = plainText(tidyCaps(info.title || p.title));
      const country = info.jobRequisitionLocation?.country?.alpha2Code || info.country?.alpha2Code || null;
      const usBoard = countryIsUs(country) === true;
      const places = [workdayPlace(info.location || p.locationsText, country), ...(Array.isArray(info.additionalLocations) ? info.additionalLocations : []).map((l) => workdayPlace(l, null, { usBoard }))]
        .filter(Boolean).map((text) => ({ text }));
      const applyUrl = sameHostUrl(info.externalUrl, t.host) || `https://${t.host}/${encodeURIComponent(t.site)}${p.externalPath}`;
      // The posting's own id: one requisition can carry several postings ("…_R163672" and "…_R163672-1").
      const postingId = /^[a-z0-9]{8,64}$/i.test(String(info.id || '')) ? String(info.id) : p.externalPath.split('/').pop();
      const reqId = plainText(postingId, 120);
      return { title, places, applyUrl, reqId, description: cleanDescription(String(info.jobDescription || '')), partTime: /part/i.test(String(info.timeType || p.timeType || '')) };
    });

    const company = pickCompanyName({ registered: companyName, feed: feedName, tenant: t.tenant });
    const tenantKey = String(tenantValue).toLowerCase();
    const out = rows.filter(Boolean).flatMap((r) => rowsForPlaces(r.places, (place) => buildJob({
      title: r.title,
      company,
      location: place.text,
      description: r.description,
      apply_url: r.applyUrl,
      source: 'Workday',
      type: r.partTime ? 'Part-time' : 'Full-time',
      searchQuery: r.title,
      lat: place.lat,
      lng: place.lng,
    }), { provider: 'workday', tenant: tenantKey, externalId: `workday:${tenantKey}:${r.reqId}`, applyUrl: r.applyUrl }));
    out.boardTotal = Number.isFinite(total) ? Math.max(total, postings.length) : postings.length; // the board's own count (fetchSourceJobs)
    return out;
  },
};

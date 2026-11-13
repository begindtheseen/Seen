// Oracle Recruiting Cloud (Oracle Fusion HCM "Candidate Experience") — the candidate site's REST API.
//
// Tenant string: "<host>/<site number>", e.g. "fa-elpm-saasfaprod1.fa.ocs.oraclecloud.com/cx" for
// https://fa-elpm-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/requisitions.
// The registry lowercases tenants; site numbers are upper case on every board seen ("CX", "CX_1",
// "CX_2001"), so the site is upper-cased for every request and link.
//
//   list:   GET /hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true
//               &expand=requisitionList.secondaryLocations&finder=findReqs;siteNumber=<S>,limit=<n>,offset=<m>
//           → items[0] = { TotalJobsCount, requisitionList:[{ Id, Title, PostedDate, PrimaryLocation,
//               PrimaryLocationCountry, secondaryLocations:[{ Name, CountryCode, Latitude, Longitude }] }] }
//           NO keyword: an empty keyword="" answers 0 requisitions (Patterson-UTI, 2026-11-13). `hasMore`
//           reads false even when more remain (Nabors: 200 of 230), so paging runs on TotalJobsCount.
//   detail: GET /hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails?expand=all&onlyData=true
//               &finder=ById;Id="<id>",siteNumber=<S>
//           → items[0] = { ExternalDescriptionStr, ExternalResponsibilitiesStr, ExternalQualificationsStr,
//               CorporateDescriptionStr, OrganizationDescriptionStr, JobSchedule, primaryLocationCoordinates }
//
// The list's country code decides the market BEFORE any detail is read (NOV lists 711 openings worldwide).
// No structured pay on this API.

import { buildJob, cleanDescription } from '../../server/jobSources.js';
import { oracleRequisitionHtml } from '../atsText.js';
import { pickCompanyName } from '../companyName.js';
import { countryIsUs } from '../usLocation.js';
import { request, makeBudget, callTimeout, mapWithin, rotated, tidyCaps, plainText, placeWithCountry, rowsForPlaces } from './common.js';

const PAGE = 200;
const HOST_RE = /^[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63}){0,4}\.oraclecloud\.com$/;
const SITE_RE = /^[A-Za-z0-9_]{1,40}$/;

/** "<host>/<site>" → { host, site } (site upper-cased) or null. */
export function parseOracleTenant(value) {
  const parts = String(value || '').trim().split('/');
  if (parts.length !== 2) return null;
  const host = parts[0].toLowerCase();
  if (!HOST_RE.test(host) || !SITE_RE.test(parts[1])) return null;
  return { host, site: parts[1].toUpperCase() };
}

const isUsCode = (c) => countryIsUs(c) === true;

export const oraclecloud = {
  id: 'oraclecloud', sourceType: 'ATS_DIRECT', ingestable: true,
  /**
   * @param {string} tenantValue "<host>/<site number>"
   * @param {{ companyName?: string, fetchImpl?: typeof fetch, timeoutMs?: number, budgetMs?: number, maxPostings?: number, concurrency?: number }} opts
   */
  async fetchCompanyJobs(tenantValue, { companyName, fetchImpl, timeoutMs = 15000, budgetMs = 60000, maxPostings = 2000, concurrency = 6, rotate } = {}) {
    const t = parseOracleTenant(tenantValue);
    if (!t) return [];
    const budget = makeBudget(budgetMs);
    const api = `https://${t.host}/hcmRestApi/resources/latest`;

    // 1. The requisition list, page by page, to the board's total.
    const reqs = [];
    let total = Infinity;
    for (let offset = 0; offset < Math.min(total, maxPostings) && !budget.expired(); offset += PAGE) {
      const data = await request(`${api}/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList.secondaryLocations&finder=findReqs;siteNumber=${encodeURIComponent(t.site)},limit=${PAGE},offset=${offset}`, {
        fetchImpl, timeoutMs: callTimeout(budget, timeoutMs),
      });
      const search = Array.isArray(data?.items) ? data.items[0] : null;
      const list = Array.isArray(search?.requisitionList) ? search.requisitionList : null;
      if (!list) { if (offset === 0) return []; break; }
      if (offset === 0) total = Number(search.TotalJobsCount) > 0 ? Number(search.TotalJobsCount) : list.length;
      reqs.push(...list);
      if (!list.length) break;
    }

    // 2. Details for the requisitions the list places in the US (primary or any secondary place).
    const seen = new Set();
    const wanted = reqs.filter((r) => {
      const id = String(r?.Id ?? '');
      if (!/^[A-Za-z0-9_-]{1,40}$/.test(id) || seen.has(id)) return false;
      seen.add(id);
      return isUsCode(r.PrimaryLocationCountry) || (Array.isArray(r.secondaryLocations) && r.secondaryLocations.some((l) => isUsCode(l?.CountryCode)));
    });
    let feedName = '';
    const rows = await mapWithin(rotated(wanted, rotate), concurrency, budget, async (r) => {
      const id = String(r.Id);
      const data = await request(`${api}/recruitingCEJobRequisitionDetails?expand=all&onlyData=true&finder=ById;Id=${encodeURIComponent(`"${id}"`)},siteNumber=${encodeURIComponent(t.site)}`, {
        fetchImpl, timeoutMs: callTimeout(budget, timeoutMs),
      });
      const d = Array.isArray(data?.items) ? data.items[0] : null;
      if (!d) return null;
      if (!feedName && typeof d.LegalEmployer === 'string') feedName = d.LegalEmployer;
      const pc = Array.isArray(d.primaryLocationCoordinates) ? d.primaryLocationCoordinates[0] : null;
      const primary = { text: placeWithCountry(d.PrimaryLocation || r.PrimaryLocation, d.PrimaryLocationCountry || r.PrimaryLocationCountry), lat: pc?.Latitude, lng: pc?.Longitude };
      const secondary = (Array.isArray(d.secondaryLocations) ? d.secondaryLocations : (r.secondaryLocations || []))
        .map((l) => ({ text: placeWithCountry(l?.Name, l?.CountryCode), lat: l?.Latitude, lng: l?.Longitude, us: isUsCode(l?.CountryCode) }));
      // A requisition placed abroad with a US secondary place leads with that US place.
      const places = isUsCode(d.PrimaryLocationCountry || r.PrimaryLocationCountry)
        ? [primary, ...secondary]
        : [...secondary.filter((l) => l.us), primary];
      const schedule = [d.JobSchedule, d.JobType, d.WorkerType].filter(Boolean).join(' ');
      return {
        id,
        title: plainText(tidyCaps(d.Title || r.Title)),
        places,
        description: cleanDescription(oracleRequisitionHtml(d)),
        partTime: /part[\s-]?time/i.test(schedule),
      };
    });

    const company = pickCompanyName({ registered: companyName, feed: feedName, tenant: t.host.split('.')[0] });
    const tenantKey = `${t.host}/${t.site}`.toLowerCase();
    const out = rows.filter(Boolean).flatMap((r) => {
      const applyUrl = `https://${t.host}/hcmUI/CandidateExperience/en/sites/${encodeURIComponent(t.site)}/job/${encodeURIComponent(r.id)}`;
      return rowsForPlaces(r.places, (place) => buildJob({
        title: r.title,
        company,
        location: place.text,
        description: r.description,
        apply_url: applyUrl,
        source: 'Oracle Recruiting',
        type: r.partTime ? 'Part-time' : 'Full-time',
        searchQuery: r.title,
        lat: place.lat,
        lng: place.lng,
      }), { provider: 'oraclecloud', tenant: tenantKey, externalId: `oraclecloud:${tenantKey}:${r.id}`, applyUrl });
    });
    out.boardTotal = Number.isFinite(total) ? Math.max(total, reqs.length) : reqs.length; // the board's own count (fetchSourceJobs)
    return out;
  },
};

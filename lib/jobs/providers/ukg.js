// UKG Pro (UltiPro) Recruiting — the public job board's own search and posting pages.
//
// Tenant string: "<host>/<company code>/<board id>", e.g.
// "recruiting2.ultipro.com/atl1007atsc/6eb447b8-e4eb-4c77-8c5c-5c6dc1f7a616" for
// https://recruiting2.ultipro.com/ATL1007ATSC/JobBoard/6eb447b8-e4eb-4c77-8c5c-5c6dc1f7a616.
// The registry lowercases tenants; the company code is upper-cased again for every request and link
// (UKG answers either case — verified 2026-11-13 — but its own links are upper case).
//
//   list:   POST <board>/JobBoardView/LoadSearchResults  (the body the board page itself sends)
//           { opportunitySearch: { Top, Skip, QueryString:'', OrderBy:[…PostedDate desc], Filters:[…] }, matchCriteria:{…} }
//           → { opportunities:[{ Id, Title, RequisitionNumber, FullTime, PostedDate, Locations:[{ Address:{ City,
//               State:{Code}, Country:{Code,Name} }, Coordinates }], BriefDescription }], totalCount }
//   detail: GET  <board>/OpportunityDetail?opportunityId=<Id>  — the posting page, whose data is the argument
//           of `new US.Opportunity.CandidateOpportunityDetail({...})`: Description (HTML),
//           EqualOpportunityEmployerDescription, Salaried, CompensationAmount, Compensation{Hourly,Annual}{Min,Max}imum,
//           PayRange + PayRangeVisible, CompensationCurrencyCode.
//
// Pay is kept only when the posting states it in those fields, in US dollars. The page shows PayRange
// only when `isSalaryRangeFieldsEnabled` is on AND the posting's PayRangeVisible is true — the same rule here.

import { buildJob, cleanDescription } from '../../server/jobSources.js';
import { pickCompanyName } from '../companyName.js';
import { payFields } from '../pay.js';
import { request, makeBudget, callTimeout, mapWithin, rotated, tidyCaps, plainText, jsonObjectAt, placeWithCountry, rowsForPlaces } from './common.js';

const PAGE = 50; // the board's own page size
const HOST_RE = /^recruiting\d{0,2}\.ultipro\.com$/;
const CODE_RE = /^[a-z0-9]{3,24}$/i;
const BOARD_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "<host>/<code>/<board id>" → { host, code, boardId, board } or null. */
export function parseUkgTenant(value) {
  const parts = String(value || '').trim().split('/');
  if (parts.length !== 3) return null;
  const host = parts[0].toLowerCase();
  if (!HOST_RE.test(host) || !CODE_RE.test(parts[1]) || !BOARD_RE.test(parts[2])) return null;
  const code = parts[1].toUpperCase();
  const boardId = parts[2].toLowerCase();
  return { host, code, boardId, board: `https://${host}/${code}/JobBoard/${boardId}` };
}

const searchBody = (skip) => ({
  opportunitySearch: {
    Top: PAGE, Skip: skip, QueryString: '',
    OrderBy: [{ Value: 'postedDateDesc', PropertyName: 'PostedDate', Ascending: false }],
    Filters: [
      { t: 'TermsSearchFilterDto', fieldName: 4, extra: null, values: [] },
      { t: 'TermsSearchFilterDto', fieldName: 5, extra: null, values: [] },
      { t: 'TermsSearchFilterDto', fieldName: 6, extra: null, values: [] },
    ],
  },
  matchCriteria: { PreferredJobs: [], Educations: [], LicenseAndCertifications: [], Skills: [], hasNoLicenses: false, SkippedSkills: [] },
});

/** A UKG location → { text, lat, lng, us }. US: "Kermit, TX"; abroad: "City, Region, Country". */
export function ukgPlace(loc) {
  const a = loc?.Address || {};
  const countryCode = String(a.Country?.Code || '').toUpperCase();
  const us = countryCode === 'USA' || countryCode === 'US' || /^united states/i.test(String(a.Country?.Name || ''));
  const city = plainText(a.City, 80);
  const region = plainText(us ? (a.State?.Code || a.State?.Name) : (a.State?.Name || a.State?.Code), 60);
  const text = us
    ? placeWithCountry([city, region].filter(Boolean).join(', '), 'US')
    : [city, region, plainText(a.Country?.Name, 60)].filter(Boolean).join(', ');
  return { text, lat: loc?.Coordinates?.Latitude, lng: loc?.Coordinates?.Longitude, us };
}

/** The posting data embedded in a UKG OpportunityDetail page, or null. */
export function ukgDetailFromPage(html) {
  const s = String(html || '');
  const marker = s.indexOf('CandidateOpportunityDetail(');
  if (marker < 0) return null;
  return jsonObjectAt(s, marker + 'CandidateOpportunityDetail('.length);
}

/**
 * The pay a UKG posting states, through the one pay normaliser; { salary: null, salaryMin: 0 } otherwise.
 * @param {object} d detail data; @param {boolean} rangeFieldsOn the page's isSalaryRangeFieldsEnabled
 */
export function ukgPay(d, rangeFieldsOn, text = '') {
  const usd = (code) => !code || String(code).toUpperCase() === 'USD';
  const pick = (min, max, period) => {
    const lo = Number(min) || 0; const hi = Number(max) || 0;
    if (!(lo > 0 || hi > 0)) return null;
    const f = payFields({ min: lo, max: hi, period, text });
    return f.salary ? { salary: f.salary, salaryMin: f.salaryMin } : null;
  };
  const amount = d?.CompensationAmount;
  if (amount && Number(amount.Value) > 0 && usd(amount.Code)) {
    const p = pick(amount.Value, 0, d.Salaried ? 'year' : 'hour');
    if (p) return p;
  }
  if (usd(d?.CompensationCurrencyCode)) {
    const p = d?.Salaried
      ? pick(d.CompensationAnnualMinimum, d.CompensationAnnualMaximum, 'year')
      : pick(d?.CompensationHourlyMinimum, d?.CompensationHourlyMaximum, 'hour');
    if (p) return p;
  }
  if (rangeFieldsOn && d?.PayRangeVisible && d?.PayRange && usd(d.PayRangeCurrencyCode)) {
    const p = pick(d.PayRange.PayRangeMinimum, d.PayRange.PayRangeMaximum, d.Salaried ? 'year' : 'hour');
    if (p) return p;
  }
  return { salary: null, salaryMin: 0 };
}

export const ukg = {
  id: 'ukg', sourceType: 'ATS_DIRECT', ingestable: true,
  /**
   * @param {string} tenantValue "<host>/<company code>/<board id>"
   * @param {{ companyName?: string, fetchImpl?: typeof fetch, timeoutMs?: number, budgetMs?: number, maxPostings?: number, concurrency?: number }} opts
   */
  async fetchCompanyJobs(tenantValue, { companyName, fetchImpl, timeoutMs = 12000, budgetMs = 60000, maxPostings = 1000, concurrency = 6, rotate } = {}) {
    const t = parseUkgTenant(tenantValue);
    if (!t) return [];
    const budget = makeBudget(budgetMs);

    // 1. The board's search, page by page.
    const opps = [];
    let total = Infinity;
    for (let skip = 0; skip < Math.min(total, maxPostings) && !budget.expired(); skip += PAGE) {
      const data = await request(`${t.board}/JobBoardView/LoadSearchResults`, {
        method: 'POST', body: searchBody(skip),
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Requested-With': 'XMLHttpRequest' },
        fetchImpl, timeoutMs: callTimeout(budget, timeoutMs),
      });
      const list = Array.isArray(data?.opportunities) ? data.opportunities : null;
      if (!list) { if (skip === 0) return []; break; }
      if (skip === 0) total = Number(data.totalCount) > 0 ? Number(data.totalCount) : list.length;
      opps.push(...list);
      if (list.length < PAGE) break;
    }

    // 2. The posting page of every opportunity with a US place.
    const seen = new Set();
    const wanted = opps.filter((o) => {
      const id = String(o?.Id || '');
      if (!BOARD_RE.test(id) || seen.has(id)) return false;
      seen.add(id);
      return (Array.isArray(o.Locations) ? o.Locations : []).some((l) => ukgPlace(l).us);
    });
    const rows = await mapWithin(rotated(wanted, rotate), concurrency, budget, async (o) => {
      const id = String(o.Id).toLowerCase();
      const html = await request(`${t.board}/OpportunityDetail?opportunityId=${encodeURIComponent(id)}`, { as: 'text', fetchImpl, timeoutMs: callTimeout(budget, timeoutMs) });
      const d = ukgDetailFromPage(html);
      if (!d || d.OpportunityIsClosed === true) return null;
      const rangeFieldsOn = /isSalaryRangeFieldsEnabled\s*:\s*true/.test(String(html));
      const description = cleanDescription([d.Description, d.EqualOpportunityEmployerDescription].filter((x) => String(x || '').trim()).join('\n<br>\n'));
      const title = plainText(tidyCaps(d.Title || o.Title));
      const places = (Array.isArray(d.Locations) && d.Locations.length ? d.Locations : o.Locations || []).map(ukgPlace);
      return {
        id, title, description,
        // US places first: the posting's first US place is its main row.
        places: [...places.filter((p) => p.us), ...places.filter((p) => !p.us)],
        pay: ukgPay(d, rangeFieldsOn, `${title}\n${description}`),
        partTime: d.FullTime === false || o.FullTime === false,
      };
    });

    const company = pickCompanyName({ registered: companyName, feed: '', tenant: t.code.toLowerCase() });
    const tenantKey = `${t.host}/${t.code}/${t.boardId}`.toLowerCase();
    const out = rows.filter(Boolean).flatMap((r) => {
      const applyUrl = `${t.board}/OpportunityDetail?opportunityId=${encodeURIComponent(r.id)}`;
      return rowsForPlaces(r.places, (place) => buildJob({
        title: r.title,
        company,
        location: place.text,
        salary: r.pay.salary,
        salaryMin: r.pay.salaryMin,
        description: r.description,
        apply_url: applyUrl,
        source: 'UKG',
        type: r.partTime ? 'Part-time' : 'Full-time',
        searchQuery: r.title,
        lat: place.lat,
        lng: place.lng,
      }), { provider: 'ukg', tenant: tenantKey, externalId: `ukg:${t.code.toLowerCase()}:${r.id}`, applyUrl });
    });
    out.boardTotal = Number.isFinite(total) ? Math.max(total, opps.length) : opps.length; // the board's own count (fetchSourceJobs)
    return out;
  },
};

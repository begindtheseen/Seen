// "Pull every source for this company" — the company-first job search.
//
// For one company name, in order, each reported on its own:
//   1. boards     — its registered job boards (company_sources); when it has none, find them
//                   (lib/jobs/boardFinder.js) and register the verified ones so the hourly sync keeps them.
//   2. career_site — its own career site (lib/jobs/careerSite.js): robots.txt → job sitemap →
//                   schema.org JobPosting. A site that refuses servers or renders in JavaScript comes
//                   back as needs_browser with a URL for Seen Command's local Chrome collector.
//   3. adzuna     — an Adzuna search for the name, keeping only listings whose employer IS that company.
// Indeed is not here: it can only be read from the owner's Mac, so Seen Command runs it alongside.
//
// Only US/remote listings are stored (board rows through syncBoards' market filter; site rows through
// rowFromPosting). Every count is what actually happened. Injectable for tests: lib/jobs/companyJobs.test.mjs.

import { syncBoards, sourcesForCompanies } from '../../api/refresh-employer-boards.js';
import { findBoards, sameCompanyName } from './boardFinder.js';
import { readCareerSite } from './careerSite.js';
import { registerSource } from './sourceRegistry.js';
import { fetchAdzuna, upsertJobs } from '../server/jobSources.js';
import { inUsMarket } from './usLocation.js';

const SOURCE_SELECT = 'select=id,company_name,provider,tenant,consecutive_failures';

async function saveRows(rows, upsert, supabaseUrl, serviceKey) {
  let saved = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const u = await upsert(rows.slice(i, i + 100), supabaseUrl, serviceKey).catch(() => ({ upserted: 0 }));
    saved += u.upserted || 0;
  }
  return saved;
}

export async function pullCompanyJobs(company, {
  supabaseUrl, serviceKey, siteLimit = 40, website = null, deadline = Date.now() + 240_000,
  adzuna = { appId: process.env.ADZUNA_APP_ID, appKey: process.env.ADZUNA_APP_KEY },
  deps = {},
} = {}) {
  const d = {
    sourcesFor: deps.sourcesFor || ((names) => sourcesForCompanies(names, supabaseUrl, serviceKey)),
    findBoards: deps.findBoards || findBoards,
    register: deps.register || ((e) => registerSource(e, supabaseUrl, serviceKey)),
    readSources: deps.readSources || (async (pairs) => {
      if (!pairs.length) return [];
      const or = pairs.map((p) => `and(provider.eq.${p.provider},tenant.eq.${p.tenant})`).join(',');
      const r = await fetch(`${supabaseUrl}/rest/v1/company_sources?or=(${encodeURIComponent(or)})&${SOURCE_SELECT}`, { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } });
      return r.ok ? r.json() : [];
    }),
    syncBoards: deps.syncBoards || ((sources) => syncBoards(sources, { supabaseUrl, serviceKey, deadline })),
    readCareerSite: deps.readCareerSite || readCareerSite,
    fetchAdzuna: deps.fetchAdzuna || fetchAdzuna,
    upsert: deps.upsert || upsertJobs,
  };
  const report = { company, boards: null, career_site: null, adzuna: null, needs_browser: null, saved: 0 };

  // 1. Job boards — registered, else found.
  try {
    let { sources } = await d.sourcesFor([company]);
    let found = [];
    if (!sources.length) {
      const f = await d.findBoards(company);
      found = f.found;
      for (const b of found) {
        await d.register({ provider: b.provider, tenant: b.tenant, companyName: company, confidence: b.nameVerified ? 0.85 : 0.6, discoveredVia: 'company_search' });
      }
      sources = await d.readSources(found);
    }
    if (!sources.length) report.boards = { status: 'none', note: 'no board on Greenhouse, Lever, Ashby, Workable, Recruitee or SmartRecruiters', saved: 0 };
    else {
      const s = await d.syncBoards(sources);
      report.boards = {
        status: 'ok', registered: found.length ? 'new' : 'existing',
        boards: sources.map((x) => ({ provider: x.provider, tenant: x.tenant, ...(found.find((f) => f.provider === x.provider && f.tenant === x.tenant)?.nameVerified === false ? { name_unverified: true } : {}) })),
        fetched: s.fetched, kept: s.kept, outside_market: s.dropped_outside_market, saved: s.upserted,
      };
      report.saved += s.upserted || 0;
    }
  } catch (e) { report.boards = { status: 'error', note: String(e.message || e).slice(0, 160), saved: 0 }; }

  // 2. Career site.
  if (Date.now() < deadline) {
    try {
      const site = await d.readCareerSite(company, { website, limit: siteLimit });
      const saved = site.rows.length ? await saveRows(site.rows, d.upsert, supabaseUrl, serviceKey) : 0;
      report.career_site = { status: site.status, host: site.host, url: site.careersUrl, listed: site.sitemapJobs, read: site.pagesRead, kept: site.rows.length, skipped: site.skipped, note: site.note, saved };
      report.saved += saved;
      if (site.status === 'blocked' || site.status === 'needs_browser') report.needs_browser = { url: site.careersUrl, host: site.host, reason: site.status };
    } catch (e) { report.career_site = { status: 'error', note: String(e.message || e).slice(0, 160), saved: 0 }; }
  } else report.career_site = { status: 'skipped', note: 'out of time', saved: 0 };

  // 3. Adzuna, filtered to this employer.
  if (!adzuna.appId || !adzuna.appKey) report.adzuna = { status: 'unavailable', note: 'Adzuna is not configured', saved: 0 };
  else if (Date.now() >= deadline) report.adzuna = { status: 'skipped', note: 'out of time', saved: 0 };
  else {
    try {
      // Every page, not just the first 50: up to 10 pages while Adzuna keeps returning full pages and
      // the pages still hold this employer's listings (two pages in a row without one → stop).
      const all = []; let dry = 0;
      for (let page = 1; page <= 10 && Date.now() < deadline; page++) {
        const batch = await d.fetchAdzuna(company, '', adzuna.appId, adzuna.appKey, 0, page);
        all.push(...batch);
        dry = batch.some((j) => sameCompanyName(j.company, company)) ? 0 : dry + 1;
        if (batch.length < 50 || dry >= 2) break;
      }
      const seenIds = new Set();
      const fresh = (j) => { const k = j.external_id || j.apply_url; if (!k) return true; if (seenIds.has(k)) return false; seenIds.add(k); return true; };
      const mine = all.filter((j) => sameCompanyName(j.company, company) && inUsMarket(j.location) && fresh(j));
      const saved = mine.length ? await saveRows(mine.map((j) => ({ ...j, search_query: company.toLowerCase() })), d.upsert, supabaseUrl, serviceKey) : 0;
      report.adzuna = { status: 'ok', found: all.length, this_company: mine.length, saved };
      report.saved += saved;
    } catch (e) { report.adzuna = { status: 'error', note: String(e.message || e).slice(0, 160), saved: 0 }; }
  }
  return report;
}

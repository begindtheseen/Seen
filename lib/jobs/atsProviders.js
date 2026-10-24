// Seen Job Ingestion — EMPLOYER-DIRECT ATS PROVIDERS.
//
// Each provider hits a PUBLIC, STRUCTURED JSON endpoint of an Applicant Tracking System and returns
// employer-DIRECT listings — the freshest, most authoritative source of a company's real openings,
// with the real application URL (not an aggregator redirect). NO API keys, NO scraping, NO auth
// bypass, NO CAPTCHA circumvention — only documented public endpoints. Every failure is isolated
// (a provider returns [] on any error) so one broken ATS can never break search.
//
// Providers share one interface:
//   { id, sourceType, ingestable, fetchCompanyJobs(tenant, opts) -> Promise<CanonicalJobRow[]> }
// Rows are produced by the existing buildJob() (same normalization/junk-filter/scoring as every
// other source) and stamped with provenance (source_type/ats_provider/ats_tenant/external_id/
// canonical_url) so employer-direct listings rank above aggregators and dedup by requisition.

import { buildJob, cleanDescription, mapLimit } from '../server/jobSources.js';
import { inUsMarket, withCountry } from './usLocation.js';
import { pickCompanyName, isTenantName } from './companyName.js';

// ── fetch-with-timeout (injectable for tests) ─────────────────────────────────
async function getJson(url, { fetchImpl = fetch, timeoutMs = 9000, headers = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { headers: { Accept: 'application/json', 'User-Agent': 'SeenJobs/1.0 (+https://seenjobs.io)', ...headers }, signal: controller.signal });
    clearTimeout(timer);
    if (!res || !res.ok) return null;
    return await res.json();
  } catch {
    clearTimeout(timer);
    return null;
  }
}

// Decode HTML entities before buildJob strips tags (ATS "content" fields are entity-escaped HTML,
// so tags must be un-escaped first or they'd survive as literal <p> text).
function decodeEntities(s) {
  return String(s || '')
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;|&rsquo;/gi, "'").replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&');
}

function stamp(row, { provider, tenant, externalId, applyUrl }) {
  if (!row) return null;
  return {
    ...row,
    source_type: 'ATS_DIRECT',
    ats_provider: provider,
    ats_tenant: tenant,
    external_id: externalId ? String(externalId) : null,
    canonical_url: applyUrl || row.apply_url || null,
  };
}

// ── Greenhouse — https://boards-api.greenhouse.io/v1/boards/{tenant}/jobs?content=true ─────────
// The employer's name as the board itself states it. Discovery registers a board by its slug
// ("plscareers"), and the registered name used to be stamped on every row — 62,219 of 81,918 active
// rows carried a slug as `company` (prod 2026-10-24). Greenhouse keeps the name on the board's
// metadata endpoint, so it is read once per sync, and only when the registered name is just the
// slug (one extra request for exactly the boards that need it).
async function greenhouseBoardName(tenant, { fetchImpl, timeoutMs } = {}) {
  const meta = await getJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(tenant)}`, { fetchImpl, timeoutMs });
  return typeof meta?.name === 'string' ? meta.name : '';
}

export const greenhouse = {
  id: 'greenhouse', sourceType: 'ATS_DIRECT', ingestable: true,
  async fetchCompanyJobs(tenant, { companyName, fetchImpl, timeoutMs } = {}) {
    const data = await getJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(tenant)}/jobs?content=true`, { fetchImpl, timeoutMs });
    if (!data?.jobs?.length) return [];
    const feedName = isTenantName(companyName, tenant) ? await greenhouseBoardName(tenant, { fetchImpl, timeoutMs }) : '';
    const company = pickCompanyName({ registered: companyName, feed: feedName || data.jobs.find((j) => j.company_name)?.company_name, tenant });
    return data.jobs.map((j) => stamp(buildJob({
      title: j.title,
      company,
      location: j.location?.name || (j.offices?.[0]?.name) || 'Remote',
      description: cleanDescription(decodeEntities(j.content || '')),
      apply_url: j.absolute_url,
      source: 'Greenhouse',
      type: 'Full-time',
      searchQuery: j.title,
    }), { provider: 'greenhouse', tenant, externalId: j.id, applyUrl: j.absolute_url })).filter(Boolean);
  },
};

// ── Lever — https://api.lever.co/v0/postings/{tenant}?mode=json ────────────────────────────────
// Lever splits its public Postings API by data-residency host: a board hosted on jobs.eu.lever.co
// (EU data residency) 404s against the global api.lever.co and must be read from api.eu.lever.co
// instead — the two are entirely separate backends, not a redirect. Measured live in production
// 2026-09-26: 53 of 54 registered EU-hosted Lever boards had never once synced (job_count stuck at
// 0, consecutive_failures climbing) after the #295 scheduler fix confirmed they WERE being picked up
// and queried — only the single non-EU board and one EU board (already fixed by chance) ever
// returned data. getJson collapses "wrong host" (404) and "genuinely zero postings" into the same
// null/[] with no way to tell them apart afterward, so a wrong-host tenant looks identical to a dead
// one and both get shown into the same silent circuit-breaker path (see recordSourceSync). Given
// there is no reliable way to know a tenant's data-residency region from its slug alone, try the
// global host first (cheap, correct for the majority) and fall back to the EU host only when the
// first attempt comes back empty — at most one extra request, only for tenants the global host
// cannot serve.
const LEVER_HOSTS = ['https://api.lever.co', 'https://api.eu.lever.co'];

export const lever = {
  id: 'lever', sourceType: 'ATS_DIRECT', ingestable: true,
  async fetchCompanyJobs(tenant, { companyName, fetchImpl, timeoutMs } = {}) {
    let data = null;
    for (const host of LEVER_HOSTS) {
      data = await getJson(`${host}/v0/postings/${encodeURIComponent(tenant)}?mode=json`, { fetchImpl, timeoutMs });
      if (Array.isArray(data) && data.length) break;
    }
    if (!Array.isArray(data) || !data.length) return [];
    const company = pickCompanyName({ registered: companyName, feed: '', tenant });
    return data.map((j) => {
      const applyUrl = j.applyUrl || j.hostedUrl;
      const desc = j.descriptionPlain || cleanDescription(decodeEntities(j.description || ''));
      // Lever states the country as a code beside a bare place ("La Roca del Valles, Barcelona" +
      // "ES"): written into the text so the market filter — and every reader of the row — can judge it.
      const location = withCountry(j.categories?.location || (j.workplaceType === 'remote' ? 'Remote' : ''), j.country) || 'Remote';
      return stamp(buildJob({
        title: j.text,
        company,
        location,
        description: desc,
        apply_url: applyUrl,
        source: 'Lever',
        type: /part/i.test(j.categories?.commitment || '') ? 'Part-time' : 'Full-time',
        searchQuery: j.text,
      }), { provider: 'lever', tenant, externalId: j.id, applyUrl });
    }).filter(Boolean);
  },
};

// ── Ashby — https://api.ashbyhq.com/posting-api/job-board/{tenant}?includeCompensation=true ─────
export const ashby = {
  id: 'ashby', sourceType: 'ATS_DIRECT', ingestable: true,
  async fetchCompanyJobs(tenant, { companyName, fetchImpl, timeoutMs } = {}) {
    const data = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(tenant)}?includeCompensation=true`, { fetchImpl, timeoutMs });
    if (!data?.jobs?.length) return [];
    const company = pickCompanyName({ registered: companyName, feed: data.jobs.find((j) => j.organizationName)?.organizationName, tenant });
    return data.jobs.map((j) => {
      const applyUrl = j.applyUrl || j.jobUrl;
      const desc = j.descriptionPlain || cleanDescription(decodeEntities(j.descriptionHtml || ''));
      return stamp(buildJob({
        title: j.title,
        company,
        location: j.isRemote ? 'Remote' : (j.location || j.address?.postalAddress?.addressLocality || 'Remote'),
        description: desc,
        apply_url: applyUrl,
        source: 'Ashby',
        type: /part/i.test(j.employmentType || '') ? 'Part-time' : 'Full-time',
        searchQuery: j.title,
      }), { provider: 'ashby', tenant, externalId: j.id, applyUrl });
    }).filter(Boolean);
  },
};

// ── Workable — https://apply.workable.com/api/v1/widget/accounts/{tenant}?details=true ──────────
export const workable = {
  id: 'workable', sourceType: 'ATS_DIRECT', ingestable: true,
  async fetchCompanyJobs(tenant, { companyName, fetchImpl, timeoutMs } = {}) {
    const data = await getJson(`https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(tenant)}?details=true`, { fetchImpl, timeoutMs });
    const jobs = data?.jobs || data?.results || [];
    if (!Array.isArray(jobs) || !jobs.length) return [];
    // The widget answers with the account's own name at the top level ({ name: "Spotify", jobs }).
    const company = pickCompanyName({ registered: companyName, feed: data?.name || jobs.find((j) => j.company)?.company, tenant });
    return jobs.map((j) => {
      const loc = [j.location?.city, j.location?.region, j.location?.country].filter(Boolean).join(', ') || (j.telecommuting ? 'Remote' : 'Remote');
      return stamp(buildJob({
        title: j.title,
        company,
        location: loc,
        description: cleanDescription(decodeEntities(j.description || j.full_description || '')),
        apply_url: j.url || j.application_url || j.shortlink,
        source: 'Workable',
        type: /part/i.test(j.employment_type || j.type || '') ? 'Part-time' : 'Full-time',
        searchQuery: j.title,
      }), { provider: 'workable', tenant, externalId: j.shortcode || j.id, applyUrl: j.url || j.shortlink });
    }).filter(Boolean);
  },
};

// ── Recruitee — https://{tenant}.recruitee.com/api/offers/ ──────────────────────────────────────
export const recruitee = {
  id: 'recruitee', sourceType: 'ATS_DIRECT', ingestable: true,
  async fetchCompanyJobs(tenant, { companyName, fetchImpl, timeoutMs } = {}) {
    const data = await getJson(`https://${encodeURIComponent(tenant)}.recruitee.com/api/offers/`, { fetchImpl, timeoutMs });
    if (!data?.offers?.length) return [];
    const company = pickCompanyName({ registered: companyName, feed: data.offers.find((j) => j.company_name)?.company_name, tenant });
    return data.offers.map((j) => {
      const loc = j.location || [j.city, j.country].filter(Boolean).join(', ') || 'Remote';
      return stamp(buildJob({
        title: j.title,
        company,
        location: loc,
        description: cleanDescription(decodeEntities(j.description || '')),
        apply_url: j.careers_url || j.careers_apply_url,
        source: 'Recruitee',
        type: /part/i.test(j.employment_type_code || '') ? 'Part-time' : 'Full-time',
        searchQuery: j.title,
      }), { provider: 'recruitee', tenant, externalId: j.id, applyUrl: j.careers_url });
    }).filter(Boolean);
  },
};

// ── SmartRecruiters — postings list (+ bounded detail for descriptions) ─────────────────────────
// The list endpoint lacks descriptions; enrich the top N with the public posting-detail endpoint
// (bounded concurrency) so buildJob's description-quality gate is met honestly.
export const smartrecruiters = {
  id: 'smartrecruiters', sourceType: 'ATS_DIRECT', ingestable: true,
  async fetchCompanyJobs(tenant, { companyName, fetchImpl, timeoutMs } = {}) {
    const data = await getJson(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(tenant)}/postings?limit=100`, { fetchImpl, timeoutMs });
    const postings = data?.content || [];
    if (!Array.isArray(postings) || !postings.length) return [];
    const company = pickCompanyName({ registered: companyName, feed: postings.find((p) => p.company?.name)?.company?.name, tenant });
    const top = postings.slice(0, 40);
    const rows = await mapLimit(top, 4, async (p) => {
      const detail = await getJson(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(tenant)}/postings/${encodeURIComponent(p.id)}`, { fetchImpl, timeoutMs });
      const sections = detail?.jobAd?.sections || {};
      const desc = cleanDescription(decodeEntities([sections.jobDescription?.text, sections.qualifications?.text, sections.additionalInformation?.text].filter(Boolean).join(' ')));
      const loc = [p.location?.city, p.location?.region, p.location?.country].filter(Boolean).join(', ') || (p.location?.remote ? 'Remote' : 'Remote');
      const applyUrl = `https://jobs.smartrecruiters.com/${encodeURIComponent(tenant)}/${encodeURIComponent(p.id)}`;
      return stamp(buildJob({
        title: p.name,
        company,
        location: loc,
        description: desc,
        apply_url: applyUrl,
        source: 'SmartRecruiters',
        type: /part/i.test(p.typeOfEmployment?.label || '') ? 'Part-time' : 'Full-time',
        searchQuery: p.name,
      }), { provider: 'smartrecruiters', tenant, externalId: p.id, applyUrl });
    });
    return rows.filter(Boolean);
  },
};

export const PROVIDERS = { greenhouse, lever, ashby, workable, recruitee, smartrecruiters };
export function getProvider(id) { return PROVIDERS[id] || null; }
export const INGESTABLE_PROVIDER_IDS = Object.keys(PROVIDERS);

// Fetch a registered source's jobs through its provider. THE ONE entry every board path uses (the
// hourly sync, the search-time top-up, company pulls), so the market filter lives here: `rows` is
// US/remote only (lib/jobs/usLocation.js), `total` is everything the board returned (the circuit
// breaker judges health on it), `droppedOutsideMarket` the difference, and `companyName` the name
// the rows carry (the board's own when the registered one was just the slug — callers write it back
// to company_sources). ok:false when the provider errored or is unknown (drives circuit breaking).
export async function fetchSourceJobs({ provider, tenant, companyName }, opts = {}) {
  const p = getProvider(provider);
  if (!p) return { rows: [], ok: false, total: 0, droppedOutsideMarket: 0, companyName: null };
  try {
    const all = await p.fetchCompanyJobs(tenant, { companyName, ...opts });
    const list = Array.isArray(all) ? all : [];
    const rows = list.filter((r) => inUsMarket(r.location));
    return { rows, ok: true, total: list.length, droppedOutsideMarket: list.length - rows.length, companyName: list[0]?.company || null };
  } catch {
    return { rows: [], ok: false, total: 0, droppedOutsideMarket: 0, companyName: null };
  }
}

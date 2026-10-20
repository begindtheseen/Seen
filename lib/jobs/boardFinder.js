// Find a company's job board when Seen has none registered.
//
// Seen's registry (company_sources) only knows boards it has already seen in an apply link or a
// Common Crawl sweep. For a company typed by name ("Tesla", "Home Depot") this asks the six public
// job-board APIs Seen can read whether a board exists under a few name-shaped slugs.
//
// A 200 is NOT proof (checked live 2026-10-20): Workable answers 200 with name "Tesla" and zero jobs
// for an abandoned account, and SmartRecruiters answers 200 with totalFound 0 for any slug. So a hit
// needs at least one open job, and when the board reports its own company name that name must match.
// Lever and Ashby report no name; a hit there needs the slug to be the whole company name, and it is
// labelled "name not reported by the board".
//
// Pure orchestration over public JSON endpoints; every request is bounded and fail-soft. Tests:
// lib/jobs/boardFinder.test.mjs.

import { mapLimit } from '../server/jobSources.js';

const UA = 'SeenJobs/1.0 (+https://seenjobs.io)';
const LEGAL = /\b(?:incorporated|inc|llc|l\.l\.c|corp|corporation|co|company|ltd|limited|plc|gmbh|sa|ag|holdings?)\b\.?/gi;

/** "The Home Depot, Inc." → "home depot" (for name comparison). */
export function nameKey(name) {
  return String(name || '').toLowerCase().replace(/&/g, ' and ').replace(LEGAL, ' ')
    .replace(/^the\s+/, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Do two company names mean the same company? Strict: equal after dropping legal suffixes and "The". */
export function sameCompanyName(a, b) {
  const x = nameKey(a); const y = nameKey(b);
  return !!x && x === y;
}

/** Likely board slugs for a company name, most likely first. */
export function slugCandidates(name, max = 6) {
  const key = nameKey(name);
  if (!key) return [];
  const words = key.split(' ');
  const out = [words.join(''), words.join('-')];
  // "The Home Depot" boards are often registered as "thehomedepot".
  if (/^\s*the\s/i.test(String(name))) out.push(`the${words.join('')}`);
  if (words.length > 1) out.push(words.join('_'));
  return [...new Set(out.filter((s) => s.length >= 2 && s.length <= 60))].slice(0, max);
}

async function getJson(url, { fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  try {
    const r = await fetchImpl(url, { headers: { Accept: 'application/json', 'User-Agent': UA }, signal: AbortSignal.timeout(timeoutMs) });
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// Each probe answers { jobs: number, name: string|null } or null (no board / unreachable).
export const PROBES = {
  async greenhouse(slug, o) {
    const [board, jobs] = await Promise.all([
      getJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}`, o),
      getJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs`, o),
    ]);
    if (!jobs || !Array.isArray(jobs.jobs)) return null;
    return { jobs: jobs.jobs.length, name: board?.name || null };
  },
  async lever(slug, o) {
    for (const host of ['https://api.lever.co', 'https://api.eu.lever.co']) {
      const d = await getJson(`${host}/v0/postings/${encodeURIComponent(slug)}?mode=json&limit=1`, o);
      if (Array.isArray(d) && d.length) return { jobs: d.length, name: null };
    }
    return null;
  },
  async ashby(slug, o) {
    const d = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}`, o);
    if (!d || !Array.isArray(d.jobs)) return null;
    return { jobs: d.jobs.length, name: d.jobs.find((j) => j.organizationName)?.organizationName || null };
  },
  async workable(slug, o) {
    const d = await getJson(`https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(slug)}`, o);
    if (!d) return null;
    return { jobs: Array.isArray(d.jobs) ? d.jobs.length : 0, name: d.name || null };
  },
  async recruitee(slug, o) {
    if (!/^[a-z0-9-]+$/.test(slug)) return null; // it is a subdomain
    const d = await getJson(`https://${slug}.recruitee.com/api/offers/`, o);
    if (!d || !Array.isArray(d.offers)) return null;
    return { jobs: d.offers.length, name: d.offers.find((x) => x.company_name)?.company_name || null };
  },
  async smartrecruiters(slug, o) {
    const d = await getJson(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(slug)}/postings?limit=1`, o);
    if (!d) return null;
    return { jobs: Number(d.totalFound) || 0, name: d.content?.[0]?.company?.name || null };
  },
};

/**
 * Probe every provider × slug for a company. Returns { found: [...], tried: n } where each found
 * entry is { provider, tenant, jobs, name, nameVerified }. Only real boards are returned.
 */
export async function findBoards(companyName, { fetchImpl = fetch, timeoutMs = 8000, providers = Object.keys(PROBES), concurrency = 6 } = {}) {
  const slugs = slugCandidates(companyName);
  const pairs = providers.flatMap((p) => slugs.map((s) => ({ p, s })));
  const fullSlug = nameKey(companyName).replace(/\s+/g, '');
  const results = await mapLimit(pairs, concurrency, async ({ p, s }) => {
    const r = await PROBES[p](s, { fetchImpl, timeoutMs }).catch(() => null);
    if (!r || r.jobs < 1) return null;
    if (r.name) return sameCompanyName(r.name, companyName) ? { provider: p, tenant: s, jobs: r.jobs, name: r.name, nameVerified: true } : null;
    // No name reported: only the slug that IS the whole name counts.
    return s.replace(/[-_]/g, '') === fullSlug ? { provider: p, tenant: s, jobs: r.jobs, name: null, nameVerified: false } : null;
  });
  // One board per provider (the first slug that matched wins).
  const seen = new Set(); const found = [];
  for (const f of results) if (f && !seen.has(f.provider)) { seen.add(f.provider); found.push(f); }
  return { found, tried: pairs.length };
}

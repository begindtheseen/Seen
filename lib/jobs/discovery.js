// Seen Job Ingestion — COMMON CRAWL SOURCE DISCOVERY.
//
// Builds Seen's OWN employer/ATS directory at scale, so no human ever hand-adds companies. It sweeps
// the free Common Crawl URL index (CDX) for ATS host patterns, extracts each employer's tenant id
// from the matched URLs, and registers the INGESTABLE ones. This regenerates Seen's own directory
// from Common Crawl (whose Terms of Use permit commercial reuse) — it does NOT copy any project's
// curated dataset (job-board-aggregator's slug lists are CC BY-NC / non-commercial, so off-limits).
//
// Bounded per run (this is cron-oriented, not per-request): a modest per-pattern limit + a rotating
// page so successive runs cover more of the index. Fail-open: any network/parse error yields fewer
// results, never an exception. Validation of a discovered tenant (does it actually return jobs?)
// happens later at ingest time via the provider + circuit breaker.

import { detectAts } from './atsDetect.js';
import { registerSource } from './sourceRegistry.js';

// Ingestable ATS host patterns to sweep. `*` is CDX's wildcard. Only providers Seen can pull
// directly are swept (no point registering a Workday tenant we can't yet ingest).
export const CRAWL_PATTERNS = [
  'boards.greenhouse.io/*',
  'job-boards.greenhouse.io/*',
  'jobs.lever.co/*',
  'jobs.ashbyhq.com/*',
  'apply.workable.com/*',
  'careers.smartrecruiters.com/*',
  '*.recruitee.com/api/offers*',
];

async function getText(url, fetchImpl, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { headers: { 'User-Agent': 'SeenJobs/1.0 (+https://seenjobs.io)' }, signal: controller.signal });
    clearTimeout(timer);
    if (!res || !res.ok) return null;
    return await res.text();
  } catch { clearTimeout(timer); return null; }
}

// Newest available Common Crawl collection id (e.g. "CC-MAIN-2026-30"), from the public index list.
export async function latestCrawlId(fetchImpl = fetch) {
  const text = await getText('https://index.commoncrawl.org/collinfo.json', fetchImpl);
  if (!text) return null;
  try {
    const list = JSON.parse(text);
    return Array.isArray(list) && list[0]?.id ? list[0].id : null;
  } catch { return null; }
}

// Parse a CDX JSONL response into the set of ingestable {provider, tenant, careersUrl} it reveals.
export function tenantsFromCdx(text) {
  const out = new Map();
  for (const line of String(text || '').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    let row;
    try { row = JSON.parse(t); } catch { continue; }
    if (row.status && String(row.status) !== '200') continue; // only pages that resolved
    const hit = detectAts(row.url);
    if (hit && hit.ingestable) out.set(`${hit.provider}|${hit.tenant}`, { provider: hit.provider, tenant: hit.tenant, careersUrl: hit.careersUrl });
  }
  return [...out.values()];
}

// Run a bounded discovery sweep and register the ingestable tenants found. Returns a summary.
export async function discoverFromCommonCrawl({
  supabaseUrl, serviceKey, fetchImpl = fetch,
  patterns = CRAWL_PATTERNS, perPatternLimit = 400, page = 0, maxRegister = 300,
} = {}) {
  const crawl = await latestCrawlId(fetchImpl);
  if (!crawl) return { crawl: null, discovered: 0, registered: 0 };
  const seen = new Map();
  for (const pattern of patterns) {
    const url = `https://index.commoncrawl.org/${crawl}-index?url=${encodeURIComponent(pattern)}&output=json&limit=${perPatternLimit}&page=${page}`;
    const text = await getText(url, fetchImpl);
    for (const e of tenantsFromCdx(text)) seen.set(`${e.provider}|${e.tenant}`, e);
  }
  const entries = [...seen.values()].slice(0, maxRegister);
  let registered = 0;
  if (supabaseUrl && serviceKey) {
    const results = await Promise.all(entries.map((e) =>
      registerSource({ ...e, sourceType: 'ATS_DIRECT', ingestable: true, discoveredVia: 'crawl', confidence: 0.6 }, supabaseUrl, serviceKey).catch(() => false)
    ));
    registered = results.filter(Boolean).length;
  }
  return { crawl, discovered: seen.size, registered };
}

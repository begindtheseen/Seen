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
import { registerSource, existingSourceKeys } from './sourceRegistry.js';

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

// Least time a single pattern sweep is worth starting with. Below this the CDX fetch would only be
// aborted mid-flight, so the loop stops and reports how far it got instead of burning the caller's
// remaining budget on a request that cannot land.
const PATTERN_MIN_MS = 3000;
const PATTERN_TIMEOUT_MS = 12000;

// Run a bounded discovery sweep and register the ingestable tenants found.
//
// `deadline` is an absolute epoch-ms budget and is HONOURED — the pattern loop stops early and the
// summary says so. It used to be accepted by the caller's call site but not by this signature, so a
// sweep the caller had budgeted 45s for could run 8 sequential 12s fetches (~96s) and blow through it.
//
// `page` walks the CDX index. Callers MUST rotate it between runs: at a fixed page every run rescans
// the identical first `perPatternLimit` rows per pattern forever, so the registry can never grow past
// whatever that first page happens to hold.
//
// The summary distinguishes the ways a sweep can come back empty — `reason` is one of:
//   no_crawl_id  Common Crawl's collection index was unreachable/unparseable (nothing was swept)
//   deadline     ran out of budget before sweeping every pattern
//   no_tenants   swept fine, the index revealed no ingestable tenants
//   all_known    found tenants, every one already in the registry
//   ok           registered at least one genuinely new board
export async function discoverFromCommonCrawl({
  supabaseUrl, serviceKey, fetchImpl = fetch,
  patterns = CRAWL_PATTERNS, perPatternLimit = 400, page = 0, maxRegister = 300,
  deadline = null,
  // Test seams, same spirit as fetchImpl — the registry round-trip is injectable so the sweep can be
  // exercised without a database. Production callers never pass these.
  registerImpl = registerSource, existingKeysImpl = existingSourceKeys,
} = {}) {
  const msLeft = () => (deadline == null ? Infinity : deadline - Date.now());
  const out = {
    crawl: null, page, discovered: 0, registered: 0, new_boards: 0,
    patterns_swept: 0, patterns_total: patterns.length, reason: null,
  };

  const crawl = await latestCrawlId(fetchImpl);
  if (!crawl) { out.reason = 'no_crawl_id'; return out; }
  out.crawl = crawl;

  const seen = new Map();
  for (const pattern of patterns) {
    if (msLeft() < PATTERN_MIN_MS) { out.reason = 'deadline'; break; }
    const url = `https://index.commoncrawl.org/${crawl}-index?url=${encodeURIComponent(pattern)}&output=json&limit=${perPatternLimit}&page=${page}`;
    const text = await getText(url, fetchImpl, Math.min(PATTERN_TIMEOUT_MS, msLeft()));
    out.patterns_swept++;
    for (const e of tenantsFromCdx(text)) seen.set(`${e.provider}|${e.tenant}`, e);
  }
  out.discovered = seen.size;

  const entries = [...seen.values()].slice(0, maxRegister);
  if (supabaseUrl && serviceKey && entries.length) {
    // Snapshot the registry BEFORE upserting so new_boards is a real count and not an upsert tally.
    // null = the lookup failed; leave new_boards at 0 rather than claiming every board is new.
    const before = await existingKeysImpl(supabaseUrl, serviceKey);
    const results = await Promise.all(entries.map((e) =>
      registerImpl({ ...e, sourceType: 'ATS_DIRECT', ingestable: true, discoveredVia: 'crawl', confidence: 0.6 }, supabaseUrl, serviceKey).catch(() => false)
    ));
    out.registered = results.filter(Boolean).length;
    if (before) {
      out.new_boards = entries.filter((e, i) => results[i] && !before.has(`${e.provider}|${e.tenant}`)).length;
    }
  }

  if (!out.reason) {
    out.reason = out.new_boards > 0 ? 'ok' : (out.discovered ? 'all_known' : 'no_tenants');
  }
  return out;
}

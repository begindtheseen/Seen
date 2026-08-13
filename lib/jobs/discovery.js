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
import { mapLimit } from '../server/jobSources.js';

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

// `diag`, when passed, is filled with WHY a fetch produced nothing. Every failure here used to
// collapse to a bare null, which is how a sweep that never reached Common Crawl at all looked
// identical to one that swept cleanly and found nothing.
async function getText(url, fetchImpl, timeoutMs = 12000, diag = null) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { headers: { 'User-Agent': 'SeenJobs/1.0 (+https://seenjobs.io)' }, signal: controller.signal });
    clearTimeout(timer);
    if (!res || !res.ok) {
      if (diag) diag.detail = `http_${res ? res.status : 'no_response'}`;
      return null;
    }
    return await res.text();
  } catch (e) {
    clearTimeout(timer);
    if (diag) diag.detail = `${(e && e.name) || 'error'}: ${((e && e.message) || '').slice(0, 90)}`;
    return null;
  }
}

// Newest available Common Crawl collection id (e.g. "CC-MAIN-2026-30"), from the public index list.
// Optionally fills `diag.detail` with the reason it could not be determined.
export async function latestCrawlId(fetchImpl = fetch, diag = null) {
  const text = await getText('https://index.commoncrawl.org/collinfo.json', fetchImpl, 12000, diag);
  if (!text) return null;
  try {
    const list = JSON.parse(text);
    if (Array.isArray(list) && list[0]?.id) return list[0].id;
    if (diag) diag.detail = `unexpected_shape: ${text.slice(0, 80)}`;
    return null;
  } catch {
    if (diag) diag.detail = `parse_error: ${text.slice(0, 80)}`;
    return null;
  }
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
  deadline = null, concurrency = 4,
  // Test seams, same spirit as fetchImpl — the registry round-trip is injectable so the sweep can be
  // exercised without a database. Production callers never pass these.
  registerImpl = registerSource, existingKeysImpl = existingSourceKeys,
} = {}) {
  const msLeft = () => (deadline == null ? Infinity : deadline - Date.now());
  const out = {
    crawl: null, page, discovered: 0, registered: 0, new_boards: 0,
    patterns_swept: 0, patterns_total: patterns.length, reason: null, detail: null,
  };

  const diag = {};
  const crawl = await latestCrawlId(fetchImpl, diag);
  // Carry the concrete cause (http_403, TimeoutError, parse_error: …) so an unreachable Common Crawl
  // is diagnosable from one log line instead of another round of guessing.
  if (!crawl) { out.reason = 'no_crawl_id'; out.detail = diag.detail || null; return out; }
  out.crawl = crawl;

  // Sweep the patterns CONCURRENTLY. Measured against CC-MAIN-2026-30 on 2026-08-13, the seven
  // patterns cost 19.3s wall-clock SEQUENTIALLY at limit=3 — with careers.smartrecruiters.com at 9.0s
  // and *.recruitee.com at 7.0s all by themselves. That is per-pattern index seek time, not row
  // transfer, so it does not shrink at the real limit=300. Sequentially it cannot fit a 45s reserve;
  // at concurrency 4 the wall-clock is roughly the slowest pattern, not their sum. Kept modest on
  // purpose: Common Crawl's CDX server is a free public service that degrades under load, and the
  // request carries an identifying User-Agent.
  const results = await mapLimit(patterns, Math.max(1, concurrency), async (pattern) => {
    const left = msLeft();
    // Report a pattern we never attempted as skipped rather than as swept-and-empty — otherwise a
    // truncated sweep is indistinguishable from a genuinely empty index.
    if (left < PATTERN_MIN_MS) return { skipped: true, text: null };
    const url = `https://index.commoncrawl.org/${crawl}-index?url=${encodeURIComponent(pattern)}&output=json&limit=${perPatternLimit}&page=${page}`;
    return { skipped: false, text: await getText(url, fetchImpl, Math.min(PATTERN_TIMEOUT_MS, left)) };
  });

  const seen = new Map();
  let skipped = 0;
  for (const r of results) {
    if (!r || r.skipped) { skipped++; continue; }
    out.patterns_swept++;
    for (const e of tenantsFromCdx(r.text)) seen.set(`${e.provider}|${e.tenant}`, e);
  }
  if (skipped) out.reason = 'deadline';
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

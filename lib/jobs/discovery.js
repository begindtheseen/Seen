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

const UA = 'SeenJobs/1.0 (+https://seenjobs.io)';

// Returns a STRUCTURED outcome, because the single most expensive bug in this file came from not
// having one: a bare `null` meant BOTH "the request failed" and "the body was empty", so an HTTP 400
// was indistinguishable from a clean sweep that found nothing. Callers must be able to tell those
// apart to label a zero honestly.
async function fetchText(url, fetchImpl, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { headers: { 'User-Agent': UA }, signal: controller.signal });
    clearTimeout(timer);
    if (!res || !res.ok) {
      return { ok: false, status: res ? res.status : 0, text: null, error: `http_${res ? res.status : 'no_response'}` };
    }
    return { ok: true, status: res.status == null ? 200 : res.status, text: await res.text(), error: null };
  } catch (e) {
    clearTimeout(timer);
    return { ok: false, status: 0, text: null, error: `${(e && e.name) || 'error'}: ${((e && e.message) || '').slice(0, 90)}` };
  }
}

// `diag`, when passed, is filled with WHY a fetch produced nothing.
async function getText(url, fetchImpl, timeoutMs = 12000, diag = null) {
  const r = await fetchText(url, fetchImpl, timeoutMs);
  if (!r.ok && diag) diag.detail = r.error;
  return r.text;
}

// How many pagination pages the CDX index actually has for this pattern.
//
// CDX paginates in BLOCKS, and these host patterns are SMALL: boards.greenhouse.io/* reports
// {"pages":1,"pageSize":5,"blocks":5}. Page 0 is the only valid page, and any page above it returns
// 400 {"message":"Page 1 invalid: First Page is 0, Last Page is 0"}. PR #273 rotated the cursor blind
// on the assumption that more pages existed — an assumption never checked against the index — reached
// page 36, and every CDX request 400ed from then on. Fast, total, and silent.
//
// So ask, then clamp: rotation stays correct if the index ever grows, and is a harmless no-op while
// there is only one page. Returns null when the count can't be determined, and the caller falls back
// to page 0 — the only page guaranteed to exist.
async function cdxPageCount(crawl, pattern, fetchImpl, timeoutMs) {
  const url = `https://index.commoncrawl.org/${crawl}-index?url=${encodeURIComponent(pattern)}&output=json&showNumPages=true`;
  const r = await fetchText(url, fetchImpl, timeoutMs);
  if (!r.ok || !r.text) return null;
  try {
    const n = Number(JSON.parse(r.text)?.pages);
    return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
  } catch {
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
// `page` is a ROTATION HINT, not the page that gets requested. It is taken modulo the pattern's real
// page count (see cdxPageCount) and falls back to 0. It used to be sent verbatim, which walked the
// cursor off the end of a one-page index and 400ed every request for hours.
//
// The summary distinguishes the ways a sweep can come back empty — `reason` is one of:
//   no_crawl_id  Common Crawl's collection index was unreachable/unparseable (nothing was swept)
//   deadline     ran out of budget before sweeping every pattern
//   cdx_error    the index was reached but REFUSED the query (see pattern_errors / detail)
//   no_tenants   every attempted pattern returned 200 and revealed no ingestable tenants
//   all_known    found tenants, every one already in the registry
//   ok           registered at least one genuinely new board
//
// cdx_error exists because its absence caused the exact failure this summary was written to prevent:
// a 400 from the CDX server parsed to zero tenants and was reported as `no_tenants` with detail=null —
// "swept fine, found nothing" — for a query the server had flatly rejected. A non-200 must never be
// able to wear no_tenants' clothes. `no_tenants` now requires that every attempted pattern was a 200.
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
    // Report a pattern we never attempted as skipped rather than as swept-and-empty — otherwise a
    // truncated sweep is indistinguishable from a genuinely empty index.
    if (msLeft() < PATTERN_MIN_MS) return { pattern, skipped: true };
    const budget = () => Math.min(PATTERN_TIMEOUT_MS, msLeft());

    // Clamp the rotation hint to what this pattern actually has before asking for it.
    const pages = await cdxPageCount(crawl, pattern, fetchImpl, budget());
    const usePage = pages && pages > 0 ? (page % pages) : 0;
    if (msLeft() < PATTERN_MIN_MS) return { pattern, skipped: true };

    const url = `https://index.commoncrawl.org/${crawl}-index?url=${encodeURIComponent(pattern)}&output=json&limit=${perPatternLimit}&page=${usePage}`;
    const r = await fetchText(url, fetchImpl, budget());
    return { pattern, skipped: false, page: usePage, pages, ok: r.ok, error: r.error, text: r.text };
  });

  const seen = new Map();
  const pagesUsed = new Set();
  let skipped = 0;
  out.pattern_errors = [];
  // Per-pattern "reported page count -> page actually asked for". Without this, pages_used is not
  // self-interpreting: a mixed [0,1] could be correct clamping across patterns with different page
  // counts, or an off-by-one, and telling those apart required recomputing the modulo by hand.
  out.pattern_pages = {};
  for (const r of results) {
    if (!r || r.skipped) { skipped++; continue; }
    out.patterns_swept++;
    out.pattern_pages[r.pattern] = `${r.pages == null ? 'unknown' : r.pages}->${r.page}`;
    pagesUsed.add(r.page);
    // A refused query is an ERROR, not an empty index. Keeping these separate is the whole point.
    if (!r.ok) { out.pattern_errors.push(`${r.pattern} ${r.error}`); continue; }
    for (const e of tenantsFromCdx(r.text)) seen.set(`${e.provider}|${e.tenant}`, e);
  }
  out.pages_used = [...pagesUsed].sort((a, b) => a - b);
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

  // Precedence matters. A refused query outranks "found nothing", because a 400 reported as
  // no_tenants is a lie the reader cannot detect — and did in fact send two people chasing latency
  // and starvation theories for a sweep the server was rejecting outright.
  if (out.new_boards > 0) {
    out.reason = 'ok';
  } else if (out.discovered) {
    out.reason = 'all_known';
  } else if (out.pattern_errors.length) {
    out.reason = 'cdx_error';
    out.detail = out.pattern_errors.slice(0, 3).join('; ');
  } else if (skipped) {
    out.reason = 'deadline';
  } else {
    out.reason = 'no_tenants';
  }
  // Budget truncation is worth saying even when the sweep otherwise succeeded — a partial sweep that
  // registered a board is still partial, and silently calling it 'ok' hides the next problem.
  if (skipped && out.reason !== 'deadline') {
    out.detail = [`${skipped}/${patterns.length} patterns skipped for budget`, out.detail].filter(Boolean).join('; ');
  }
  return out;
}

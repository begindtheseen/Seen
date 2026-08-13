// Seen Job Ingestion — COMMON CRAWL SOURCE DISCOVERY, off the cc-index objects.
//
// Builds Seen's OWN employer/ATS directory at scale, so no human ever hand-adds companies. It sweeps
// the free Common Crawl URL index for ATS host patterns, extracts each employer's tenant id from the
// matched URLs, and registers the INGESTABLE ones. This regenerates Seen's own directory from Common
// Crawl (whose Terms of Use permit commercial reuse) — it does NOT copy any project's curated dataset
// (job-board-aggregator's slug lists are CC BY-NC / non-commercial, so off-limits).
//
// WHY THIS READS INDEX OBJECTS AND NOT THE CDX QUERY API. Measured from production on 2026-08-13:
// `index.commoncrawl.org/{crawl}-index?url=...` returns HTTP 503 to Vercel on ALL SEVEN patterns,
// repeatedly. That is not host-level or network-level blocking — at the same minute, on the same host,
// `index.commoncrawl.org/collinfo.json` returned 200 in 21ms and `data.commoncrawl.org/robots.txt`
// returned 200. The CDX *query endpoint* specifically refuses us, and a residential IP with the
// IDENTICAL User-Agent gets 200 from it, so the UA is eliminated as a cause. Meanwhile the underlying
// index OBJECTS are readable: a Range request for
// `data.commoncrawl.org/cc-index/collections/{crawl}/indexes/cluster.idx` returns HTTP 206 from Vercel.
// So we skip the query service and read the same index the query service reads.
//
// The CDX-query-API code path is DELETED, not disabled. A dormant unexercised branch is exactly how
// #273's page-rotation bug survived unnoticed for hours, and a fallback we cannot reach from
// production is not a fallback — it is a second thing to misread when the first one breaks.
//
// HOW THE INDEX IS SHAPED (verified live against CC-MAIN-2026-30 on 2026-08-13, not assumed):
//   cluster.idx is a plaintext SECONDARY index, sorted, 103,946,392 bytes / 877,051 lines. Each line is
//     <searchable_key> <timestamp>\t<shard>\t<offset>\t<length>\t<cluster_id>
//   Note the key and timestamp are separated by a SPACE and the remaining fields by TABs — field 0 of a
//   tab-split is "key timestamp", not the key. Longest line measured: 2,091 bytes.
//   Each line names ONE compressed block of a cdx-000NN.gz shard, giving the first key in that block.
//   A block Range-reads as a single gzip member (~220-260KB) and gunzips to ~3,000 CDX lines of
//     <key> <timestamp> <json>
//   where the JSON carries url / status / mime.
//
// cluster.idx IS NOT DOWNLOADED. It is 99MB — pulling it per run would cost more time and memory than
// the whole function has, and would make a bounded sweep impossible. Because it is sorted and the
// bucket serves Range requests, we BINARY SEARCH it: ~10 small ranged reads locate the blocks covering
// a pattern's key prefix, which is a few hundred KB of traffic instead of 99MB.
//
// Bounded per run (this is cron-oriented, not per-request): a byte budget shared across patterns, a
// block cap per pattern, and a rotating start block so successive runs cover more of each prefix.
// Fail-open: any network/parse error yields fewer results, never an exception — but it is always
// REPORTED as an error and never as an empty index.

import { gunzipSync } from 'node:zlib';
import { detectAts } from './atsDetect.js';
import { registerSource, existingSourceKeys } from './sourceRegistry.js';
import { mapLimit } from '../server/jobSources.js';

// Ingestable ATS host patterns to sweep. `*` is a wildcard. Only providers Seen can pull directly are
// swept (no point registering a Workday tenant we can't yet ingest).
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
const CC_DATA = 'https://data.commoncrawl.org/cc-index/collections';

export const clusterIdxUrl = (crawl) => `${CC_DATA}/${encodeURIComponent(crawl)}/indexes/cluster.idx`;
export const shardUrl = (crawl, shard) => `${CC_DATA}/${encodeURIComponent(crawl)}/indexes/${encodeURIComponent(shard)}`;

// Bigger than the longest cluster.idx line measured (2,091 B), so a probe window always contains a
// whole line. If this were smaller than a line the binary search could stall on a straddling record.
const PROBE_BYTES = 8192;
// Once the search has narrowed to this much of the file, stop bisecting and scan it linearly.
const WINDOW_BYTES = 65536;
// Hard stop on forward scanning, so a pathologically wide prefix cannot walk the whole 99MB index.
const MAX_INDEX_WINDOWS = 24;

// ── SURT keys ──────────────────────────────────────────────────────────────────
// cc-index keys are SURT-ish: host labels reversed and comma-joined, then `)`, then the path.
// `boards.greenhouse.io/*` → `io,greenhouse,boards)/`
// A LEADING-WILDCARD host is a different shape on purpose: `*.recruitee.com/api/offers*` has a varying
// subdomain, so the longest usable prefix stops at `com,recruitee,` — the path cannot be part of the
// key prefix when the label before it is unknown. Those hits are filtered by detectAts instead, which
// is where the path rule already lives. (`,` (0x2C) > `)` (0x29), so this prefix excludes the apex
// domain `com,recruitee)` — matching what `*.` means.)
export function surtPrefix(pattern) {
  const p = String(pattern || '').trim().replace(/^https?:\/\//, '');
  if (!p) return null;
  const slash = p.indexOf('/');
  let host = slash === -1 ? p : p.slice(0, slash);
  const path = slash === -1 ? '/' : p.slice(slash);

  const wildHost = host.startsWith('*.');
  if (wildHost) host = host.slice(2);
  if (!host || host.includes('*')) return null;

  const labels = host.split('.').filter(Boolean).reverse();
  if (!labels.length) return null;
  const base = labels.join(',');
  if (wildHost) return `${base},`;

  const star = path.indexOf('*');
  const pathPrefix = star === -1 ? path : path.slice(0, star);
  return `${base})${pathPrefix || '/'}`;
}

// One cluster.idx line → the block it names. Returns null for anything that isn't one, so a truncated
// or partial line is dropped rather than parsed into a bogus byte range.
export function parseClusterLine(line) {
  const t = String(line || '');
  if (!t) return null;
  const f = t.split('\t');
  if (f.length < 5) return null;
  const [keyAndTs, shard, offset, length] = f;
  const sp = keyAndTs.lastIndexOf(' ');
  if (sp <= 0) return null;
  const key = keyAndTs.slice(0, sp);
  const off = Number(offset), len = Number(length);
  if (!key || !shard || !Number.isFinite(off) || !Number.isFinite(len) || off < 0 || len <= 0) return null;
  return { key, timestamp: keyAndTs.slice(sp + 1), shard, offset: off, length: len };
}

// Which of a window's blocks cover `prefix`.
//
// cluster.idx is SPARSE: a line gives the FIRST key of its block, so the block that contains the start
// of the prefix range is the LAST one whose key is <= prefix, not the first one that startsWith it.
// Taking only startsWith matches would silently skip the block where the prefix actually begins — the
// tenants at the front of the range, which for a sorted index is a systematic bias, not a random loss.
export function blocksForPrefix(blocks, prefix) {
  const out = [];
  let candidate = null;
  for (const b of blocks) {
    if (b.key <= prefix) { candidate = b; continue; }
    if (b.key.startsWith(prefix)) { if (candidate) { out.push(candidate); candidate = null; } out.push(b); continue; }
    break; // sorted, and past the prefix range
  }
  if (candidate) out.push(candidate);
  return out;
}

// ── ranged reads ───────────────────────────────────────────────────────────────
function totalFromRange(res) {
  const cr = res?.headers?.get?.('content-range');
  const m = cr && /\/(\d+)\s*$/.exec(String(cr));
  if (m) return Number(m[1]);
  const cl = Number(res?.headers?.get?.('content-length'));
  return Number.isFinite(cl) && cl > 0 ? cl : null;
}

// Returns a STRUCTURED outcome, because the single most expensive bug in this file came from not
// having one: a bare `null` meant BOTH "the request failed" and "the body was empty", so an HTTP 503
// was indistinguishable from a clean sweep that found nothing.
async function fetchRange(url, start, end, fetchImpl, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
  try {
    const res = await fetchImpl(url, {
      headers: { 'User-Agent': UA, Range: `bytes=${start}-${end}` },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res || !res.ok) {
      return { ok: false, status: res ? res.status : 0, buf: null, total: null, error: `http_${res ? res.status : 'no_response'}` };
    }
    const ab = await res.arrayBuffer();
    return { ok: true, status: res.status == null ? 206 : res.status, buf: Buffer.from(ab), total: totalFromRange(res), error: null };
  } catch (e) {
    clearTimeout(timer);
    return { ok: false, status: 0, buf: null, total: null, error: `${(e && e.name) || 'error'}: ${((e && e.message) || '').slice(0, 90)}` };
  }
}

// Every COMPLETE line in a window, plus the byte offsets needed to walk windows without losing one.
//
// `lead`     byte offset of the first complete line (skips the fragment of the previous line)
// `consumed` bytes through the last complete line's newline
//
// `consumed` is what makes forward scanning lossless. Stepping the cursor to `end + 1` looks right and
// silently DROPS the line straddling every window boundary: the first window discards it as a trailing
// fragment and the next discards it as a leading fragment. One skipped cluster.idx line is one unread
// block of ~3,000 URLs, and nothing in the output would have looked wrong. Stepping by `consumed`
// instead leaves the cursor exactly on a line boundary.
function scanLines(buf, lineAligned) {
  const lines = [];
  let start = 0;
  if (!lineAligned) {
    const nl = buf.indexOf(10);
    if (nl === -1) return { lead: buf.length, lines, consumed: buf.length };
    start = nl + 1;
  }
  const lead = start;
  let consumed = start;
  for (;;) {
    const nl = buf.indexOf(10, start);
    if (nl === -1) break;
    if (nl > start) lines.push(buf.toString('utf8', start, nl));
    start = nl + 1;
    consumed = start;
  }
  return { lead, lines, consumed };
}

// Locate the blocks covering `prefix` by BINARY SEARCHING cluster.idx over Range reads.
//
// Invariant of the bisection: the first line whose key > prefix begins somewhere in [lo, hi].
async function clusterBlocksFor({ prefix, url, fetchImpl, budget, msLeft, timeoutMs }) {
  const read = async (start, end) => {
    const r = await fetchRange(url, start, Math.max(start, end), fetchImpl, Math.min(timeoutMs, Math.max(1, msLeft())));
    budget.requests++;
    if (r.ok && r.buf) budget.bytes += r.buf.length;
    return r;
  };

  // The opening read doubles as the size probe: content-range carries the total.
  const head = await read(0, PROBE_BYTES - 1);
  if (!head.ok) return { ok: false, stage: 'cluster_idx', error: head.error, status: head.status };
  const size = head.total;
  if (!Number.isFinite(size) || size <= 0) {
    return { ok: false, stage: 'cluster_idx', error: `no_size: ${String(head.total).slice(0, 40)}`, status: head.status };
  }

  let lo = 0, hi = size;
  while (hi - lo > WINDOW_BYTES) {
    if (msLeft() <= 0) return { ok: false, stage: 'cluster_idx', error: 'deadline_during_index_search', status: null };
    const mid = lo + Math.floor((hi - lo) / 2);
    const r = await read(mid, Math.min(size - 1, mid + PROBE_BYTES - 1));
    if (!r.ok) return { ok: false, stage: 'cluster_idx', error: r.error, status: r.status };
    const { lead, lines } = scanLines(r.buf, mid === 0);
    const first = lines.length ? parseClusterLine(lines[0]) : null;
    if (!first) { hi = mid; continue; }
    const startOfLine = mid + lead;
    if (first.key > prefix) hi = Math.min(hi, startOfLine);
    else lo = Math.max(lo, startOfLine + Buffer.byteLength(lines[0], 'utf8') + 1);
    if (hi <= lo) break;
  }

  // Scan forward from just before `lo`, so the block whose key is <= prefix (the one holding the START
  // of the range) is inside the window and not cut off by where the bisection happened to land.
  //
  // Lines are ACCUMULATED and classified once at the end by blocksForPrefix, rather than per window.
  // Per window, a window lying entirely before the prefix would contribute its last line as a
  // "covering" candidate — a block that does not cover the prefix at all. One classification over the
  // whole span is also exactly what a full linear scan of cluster.idx computes, which is what this is
  // validated against.
  const collected = [];
  let cursor = Math.max(0, lo - PROBE_BYTES);
  let windows = 0, spanned = false, aligned = cursor === 0;
  while (cursor < size) {
    // Caps and the deadline leave the walk PROVABLY incomplete; running off the end of the file does
    // not. Conflating those would flag every sweep of a prefix that sorts last as truncated.
    if (windows >= MAX_INDEX_WINDOWS || msLeft() <= 0) break;
    const r = await read(cursor, Math.min(size - 1, cursor + WINDOW_BYTES - 1));
    if (!r.ok) return { ok: false, stage: 'cluster_idx', error: r.error, status: r.status };
    windows++;
    const { lines, consumed } = scanLines(r.buf, aligned);
    if (!lines.length || consumed <= 0) break;
    for (const line of lines) { const b = parseClusterLine(line); if (b) collected.push(b); }
    const last = collected[collected.length - 1];
    // Stop once a key is provably past the prefix range — that is what makes the span complete.
    if (last && last.key > prefix && !last.key.startsWith(prefix)) { spanned = true; break; }
    cursor += consumed;
    aligned = true;
  }
  // Reaching EOF is as complete as seeing a key past the range: there is no more index to read.
  if (cursor >= size) spanned = true;
  // `spanned` false means the walk stopped on a cap/deadline before it could prove it had seen the end
  // of the range, so the block list may be short. Surfaced so a partial list cannot read as complete.
  return { ok: true, blocks: blocksForPrefix(collected, prefix), index_windows: windows, spanned };
}

// Newest available Common Crawl collection id (e.g. "CC-MAIN-2026-30"), from the public index list.
// collinfo.json is on index.commoncrawl.org and is NOT affected by the CDX query refusal — measured at
// 200/21ms from Vercel on the same host at the same minute the query endpoint was 503ing.
export async function latestCrawlId(fetchImpl = fetch, diag = null) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetchImpl('https://index.commoncrawl.org/collinfo.json', {
      headers: { 'User-Agent': UA }, signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res || !res.ok) {
      if (diag) diag.detail = `http_${res ? res.status : 'no_response'}`;
      return null;
    }
    const text = await res.text();
    try {
      const list = JSON.parse(text);
      if (Array.isArray(list) && list[0]?.id) return list[0].id;
      if (diag) diag.detail = `unexpected_shape: ${text.slice(0, 80)}`;
      return null;
    } catch {
      if (diag) diag.detail = `parse_error: ${text.slice(0, 80)}`;
      return null;
    }
  } catch (e) {
    clearTimeout(timer);
    if (diag) diag.detail = `${(e && e.name) || 'error'}: ${((e && e.message) || '').slice(0, 90)}`;
    return null;
  }
}

// Parse index lines into the set of ingestable {provider, tenant, careersUrl} they reveal.
//
// Accepts BOTH shapes deliberately: bare JSONL (one JSON object per line) and the native cc-index
// shard shape `<key> <timestamp> <json>`. Provider/tenant parsing and the status==='200' filter are
// unchanged from the CDX-query era — only where the JSON starts moved, so this stayed one extractor
// with one status rule rather than two that could drift apart.
export function tenantsFromCdx(text) {
  const out = new Map();
  for (const line of String(text || '').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    const brace = t.indexOf('{');
    if (brace === -1) continue;
    let row;
    try { row = JSON.parse(t.slice(brace)); } catch { continue; }
    if (row.status && String(row.status) !== '200') continue; // only pages that resolved
    const hit = detectAts(row.url);
    if (hit && hit.ingestable) out.set(`${hit.provider}|${hit.tenant}`, { provider: hit.provider, tenant: hit.tenant, careersUrl: hit.careersUrl });
  }
  return [...out.values()];
}

// Least time a single pattern sweep is worth starting with. Below this the reads would only be aborted
// mid-flight, so the loop stops and reports how far it got instead of burning the caller's remaining
// budget on requests that cannot land.
const PATTERN_MIN_MS = 3000;
const REQUEST_TIMEOUT_MS = 20000;

// Sweep ONE pattern: locate its blocks in cluster.idx, read a bounded slice of them, extract tenants.
async function sweepPattern({ pattern, crawl, fetchImpl, budget, msLeft, page, maxBlocksPerPattern }) {
  const prefix = surtPrefix(pattern);
  if (!prefix) return { pattern, skipped: false, ok: false, stage: 'pattern', error: 'unparseable_pattern' };

  const idx = await clusterBlocksFor({
    prefix, url: clusterIdxUrl(crawl), fetchImpl, budget, msLeft, timeoutMs: REQUEST_TIMEOUT_MS,
  });
  if (!idx.ok) return { pattern, prefix, skipped: false, ok: false, stage: idx.stage, error: idx.error, status: idx.status };

  const available = idx.blocks.length;
  if (!available) {
    return {
      pattern, prefix, skipped: false, ok: true, blocks_available: 0, blocks_read: 0, block_start: 0,
      bytes: 0, tenants: [], errors: [], truncated: !idx.spanned, index_windows: idx.index_windows,
    };
  }

  // Rotate the starting block so successive runs cover more of a prefix than its first few blocks.
  // Bounded by `available` so a full-coverage run never re-reads the same block twice.
  const want = Math.min(Math.max(1, maxBlocksPerPattern), available);
  const start = ((Math.abs(Math.trunc(page)) || 0) % available);
  const picked = Array.from({ length: want }, (_, i) => idx.blocks[(start + i) % available]);

  const tenants = new Map();
  const errors = [];
  // An index walk that never proved it reached the end of the range is already a partial answer,
  // regardless of how the block reads go.
  let read = 0, bytes = 0, truncated = !idx.spanned;
  for (const b of picked) {
    if (msLeft() < PATTERN_MIN_MS) { truncated = true; break; }
    if (budget.bytes + b.length > budget.maxBytes) { truncated = true; break; }
    const r = await fetchRange(shardUrl(crawl, b.shard), b.offset, b.offset + b.length - 1, fetchImpl, Math.min(REQUEST_TIMEOUT_MS, Math.max(1, msLeft())));
    budget.requests++;
    if (!r.ok) {
      // A refused byte range is an ERROR, never an empty block. Keeping these apart is the point.
      errors.push(`${b.shard}@${b.offset} ${r.error}`);
      continue;
    }
    budget.bytes += r.buf.length;
    bytes += r.buf.length;
    read++;
    let plain;
    try {
      plain = gunzipSync(r.buf).toString('utf8');
    } catch (e) {
      // A corrupt/short member must not read as "this block had no tenants".
      errors.push(`${b.shard}@${b.offset} gunzip_error: ${((e && e.message) || 'failed').slice(0, 60)}`);
      continue;
    }
    for (const e of tenantsFromCdx(plain)) tenants.set(`${e.provider}|${e.tenant}`, e);
  }

  return {
    pattern, prefix, skipped: false, ok: true,
    blocks_available: available, blocks_read: read, block_start: start,
    bytes, truncated, index_windows: idx.index_windows,
    tenants: [...tenants.values()], errors,
  };
}

// Run a bounded discovery sweep and register the ingestable tenants found.
//
// `deadline` is an absolute epoch-ms budget and is HONOURED — the pattern loop stops early and the
// summary says so.
//
// `page` is a ROTATION HINT over the blocks covering each pattern's key prefix, taken modulo that
// pattern's real block count. It is no longer a CDX page cursor: there is no query API in this path,
// so there is no cursor to walk off the end of. The clamp is kept because the failure it prevents
// (asking for something past the end of the index) is a property of any offset, not of CDX.
//
// The summary distinguishes the ways a sweep can come back empty — `reason` is one of:
//   no_crawl_id     Common Crawl's collection index was unreachable/unparseable (nothing was swept)
//   deadline        ran out of budget before sweeping every pattern
//   cc_index_error  the index objects were reached but a read FAILED (see pattern_errors / detail)
//   truncated       read cleanly, but a byte/block/window cap stopped it short of the range's end
//   no_tenants      every attempted pattern read cleanly and COMPLETELY, revealing no ingestable tenants
//   not_registered  found tenants, but no registry credentials, so none were compared or written
//   all_known       found tenants, every one already in the registry
//   ok              registered at least one genuinely new board
//
// cc_index_error exists because its absence caused the exact failure this summary was written to
// prevent: a non-2xx parsed to zero tenants and was reported as `no_tenants` with detail=null —
// "swept fine, found nothing" — for a request the server had flatly rejected. A non-2xx or a gunzip
// failure must never be able to wear no_tenants' clothes, so `no_tenants` requires that every
// attempted pattern completed with no errors AND that nothing was truncated by a budget.
export async function discoverFromCommonCrawl({
  supabaseUrl, serviceKey, fetchImpl = fetch,
  patterns = CRAWL_PATTERNS, page = 0, maxRegister = 300,
  deadline = null, concurrency = 4,
  // Total bytes this run may pull from data.commoncrawl.org, across every pattern, counting BOTH the
  // cluster.idx lookups and the shard blocks. Measured live: the index lookup costs ~160KB per pattern
  // (~1.1MB for seven) and each block is ~220-260KB, so the default leaves the intended
  // 7 x maxBlocksPerPattern of block reads comfortable headroom rather than having index overhead
  // truncate the run it was supposed to make room for.
  maxBytes = 12_000_000,
  maxBlocksPerPattern = 4,
  // Test seams, same spirit as fetchImpl — the registry round-trip is injectable so the sweep can be
  // exercised without a database. Production callers never pass these.
  registerImpl = registerSource, existingKeysImpl = existingSourceKeys,
} = {}) {
  const msLeft = () => (deadline == null ? Infinity : deadline - Date.now());
  const out = {
    crawl: null, page, discovered: 0, registered: 0, new_boards: 0,
    patterns_swept: 0, patterns_total: patterns.length,
    shards_read: 0, bytes_read: 0, range_requests: 0, truncated: false,
    reason: null, detail: null,
  };

  const diag = {};
  const crawl = await latestCrawlId(fetchImpl, diag);
  // Carry the concrete cause (http_503, TimeoutError, parse_error: …) so an unreachable Common Crawl
  // is diagnosable from one log line instead of another round of guessing.
  if (!crawl) { out.reason = 'no_crawl_id'; out.detail = diag.detail || null; return out; }
  out.crawl = crawl;

  const budget = { bytes: 0, requests: 0, maxBytes: Math.max(0, maxBytes) };

  // Sweep the patterns CONCURRENTLY, kept modest on purpose: data.commoncrawl.org is a free public
  // service and the request carries an identifying User-Agent.
  const results = await mapLimit(patterns, Math.max(1, concurrency), async (pattern) => {
    // Report a pattern we never attempted as skipped rather than as swept-and-empty — otherwise a
    // truncated sweep is indistinguishable from a genuinely empty index.
    if (msLeft() < PATTERN_MIN_MS) return { pattern, skipped: true };
    if (budget.bytes >= budget.maxBytes) return { pattern, skipped: true, reason: 'byte_budget' };
    return sweepPattern({ pattern, crawl, fetchImpl, budget, msLeft, page, maxBlocksPerPattern });
  });

  const seen = new Map();
  let skipped = 0;
  out.pattern_errors = [];
  // Per-pattern "blocks the index says cover this prefix -> blocks actually read @ rotation offset".
  // Without this, a zero is not self-interpreting: 0 blocks available (prefix absent from the index)
  // and 0 blocks read (budget ran out first) are different problems with the same tenant count.
  out.pattern_blocks = {};
  for (const r of results) {
    if (!r || r.skipped) { skipped++; continue; }
    out.patterns_swept++;
    if (!r.ok) {
      out.pattern_errors.push(`${r.pattern} ${r.stage}: ${r.error}`);
      out.pattern_blocks[r.pattern] = 'error';
      continue;
    }
    out.pattern_blocks[r.pattern] = `${r.blocks_available}->${r.blocks_read}@${r.block_start ?? 0}`;
    out.shards_read += r.blocks_read;
    if (r.truncated) out.truncated = true;
    for (const e of r.errors || []) out.pattern_errors.push(`${r.pattern} shard: ${e}`);
    for (const e of r.tenants) seen.set(`${e.provider}|${e.tenant}`, e);
  }
  out.bytes_read = budget.bytes;
  out.range_requests = budget.requests;
  out.discovered = seen.size;

  const entries = [...seen.values()].slice(0, maxRegister);
  if (supabaseUrl && serviceKey && entries.length) {
    // Snapshot the registry BEFORE upserting so new_boards is a real count and not an upsert tally.
    // null = the lookup failed; leave new_boards at 0 rather than claiming every board is new.
    const before = await existingKeysImpl(supabaseUrl, serviceKey);
    const written = await Promise.all(entries.map((e) =>
      registerImpl({ ...e, sourceType: 'ATS_DIRECT', ingestable: true, discoveredVia: 'crawl', confidence: 0.6 }, supabaseUrl, serviceKey).catch(() => false)
    ));
    out.registered = written.filter(Boolean).length;
    if (before) {
      out.new_boards = entries.filter((e, i) => written[i] && !before.has(`${e.provider}|${e.tenant}`)).length;
    }
  }

  // Precedence matters. A failed read outranks "found nothing", because a 503 reported as no_tenants
  // is a lie the reader cannot detect — and did in fact send two people chasing latency and starvation
  // theories for a sweep the server was rejecting outright.
  if (out.new_boards > 0) {
    out.reason = 'ok';
  } else if (out.discovered && !(supabaseUrl && serviceKey)) {
    // Tenants were found but no registry was configured, so nothing was looked up OR written.
    // Calling that `all_known` would assert a comparison against a database this run never opened —
    // the same shape of unearned claim as labelling a refusal `no_tenants`.
    out.reason = 'not_registered';
    out.detail = 'no supabase credentials passed; discovered tenants were neither compared nor written';
  } else if (out.discovered) {
    out.reason = 'all_known';
  } else if (out.pattern_errors.length) {
    out.reason = 'cc_index_error';
    out.detail = out.pattern_errors.slice(0, 3).join('; ');
  } else if (skipped) {
    out.reason = 'deadline';
  } else if (out.truncated) {
    // Read cleanly, but not to the end of what the index offered. That is not an empty index.
    out.reason = 'truncated';
    out.detail = `stopped early: ${out.shards_read} blocks / ${out.bytes_read} bytes read`;
  } else {
    out.reason = 'no_tenants';
  }
  // Budget truncation is worth saying even when the sweep otherwise succeeded — a partial sweep that
  // registered a board is still partial, and silently calling it 'ok' hides the next problem.
  const notes = [];
  if (skipped && out.reason !== 'deadline') notes.push(`${skipped}/${patterns.length} patterns skipped for budget`);
  if (out.truncated && out.reason !== 'truncated') notes.push('block reads truncated by budget');
  // Read failures must survive a SUCCESSFUL headline too. Finding one new board while three of seven
  // patterns 503'd is reason 'ok' — accurate, and still a partial sweep. Without this the errors sit
  // in pattern_errors where a reader who trusted `reason` never looks, which is the same
  // failure-hidden-behind-a-clean-summary shape the reason taxonomy exists to prevent.
  if (out.pattern_errors.length && out.reason !== 'cc_index_error') {
    notes.push(`${out.pattern_errors.length} read error(s): ${out.pattern_errors.slice(0, 2).join('; ')}`);
  }
  if (notes.length) out.detail = [...notes, out.detail].filter(Boolean).join('; ');
  return out;
}

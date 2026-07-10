import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateListingUrl,
  isPrivateIp,
  companyFromUrl,
  titleFromUrl,
  parseListingTitle,
  extractListingFromHtml,
  buildImportedJobRow,
  sourceFromHost,
  atsApiPlan,
  mapAtsJson,
} from './listingImport.js';

// ── validateListingUrl ───────────────────────────────────────────────────────

test('validateListingUrl accepts a normal job link and strips tracking params', () => {
  const v = validateListingUrl('https://www.indeed.com/viewjob?jk=abc123&utm_source=share&gclid=xyz#apply');
  assert.equal(v.ok, true);
  assert.equal(v.host, 'www.indeed.com');
  assert.ok(v.url.includes('jk=abc123'), 'significant params survive');
  assert.ok(!v.url.includes('utm_source'), 'utm stripped');
  assert.ok(!v.url.includes('gclid'), 'gclid stripped');
  assert.ok(!v.url.includes('#'), 'fragment stripped');
});

test('validateListingUrl accepts scheme-less pastes', () => {
  const v = validateListingUrl('boards.greenhouse.io/acme/jobs/12345');
  assert.equal(v.ok, true);
  assert.equal(v.url, 'https://boards.greenhouse.io/acme/jobs/12345');
});

test('validateListingUrl rejects non-http, credentials, localhost, private IPs, internal names', () => {
  for (const bad of [
    '', 'not a url', 'ftp://example.com/job', 'javascript:alert(1)',
    'http://localhost/job', 'http://127.0.0.1/x', 'http://10.1.2.3/x',
    'http://192.168.1.5/x', 'http://172.16.0.9/x', 'http://169.254.169.254/latest/meta-data',
    'http://[::1]/x', 'http://intranet.corp/x', 'http://jobs.local/x',
    'http://user:pass@example.com/x', 'http://singleword/x',
  ]) {
    assert.equal(validateListingUrl(bad).ok, false, `should reject: ${bad}`);
  }
});

test('isPrivateIp classifies ranges', () => {
  for (const ip of ['127.0.0.1', '10.0.0.1', '172.31.255.1', '192.168.0.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fe80::1', 'fd00::1', '::ffff:10.0.0.1']) {
    assert.equal(isPrivateIp(ip), true, `${ip} is private`);
  }
  for (const ip of ['8.8.8.8', '104.16.1.1', '2606:4700::6810:84e5', '::ffff:8.8.8.8']) {
    assert.equal(isPrivateIp(ip), false, `${ip} is public`);
  }
});

// ── URL inference ────────────────────────────────────────────────────────────

test('companyFromUrl reads ATS slugs', () => {
  assert.equal(companyFromUrl('https://boards.greenhouse.io/stripe/jobs/456'), 'Stripe');
  assert.equal(companyFromUrl('https://job-boards.greenhouse.io/coca-cola/jobs/456'), 'Coca Cola');
  assert.equal(companyFromUrl('https://jobs.lever.co/rippling/aaa-bbb'), 'Rippling');
  assert.equal(companyFromUrl('https://jobs.ashbyhq.com/linear/123'), 'Linear');
  assert.equal(companyFromUrl('https://acme-corp.wd5.myworkdayjobs.com/en-US/careers/job/123'), 'Acme Corp');
  assert.equal(companyFromUrl('https://apply.workable.com/deel/j/ABC/'), 'Deel');
  assert.equal(companyFromUrl('https://mycompany.bamboohr.com/careers/42'), 'Mycompany');
  assert.equal(companyFromUrl('https://www.indeed.com/viewjob?jk=abc'), '');
});

test('companyFromUrl and titleFromUrl parse LinkedIn view slugs', () => {
  const u = 'https://www.linkedin.com/jobs/view/senior-software-engineer-at-acme-corp-3948571623';
  assert.equal(companyFromUrl(u), 'Acme Corp');
  assert.equal(titleFromUrl(u), 'Senior Software Engineer');
});

// ── Title heuristics ─────────────────────────────────────────────────────────

test('parseListingTitle handles LinkedIn "Company hiring Title in City"', () => {
  const p = parseListingTitle('Acme Corp hiring Data Analyst in Austin, TX | LinkedIn');
  assert.equal(p.company, 'Acme Corp');
  assert.equal(p.title, 'Data Analyst');
  assert.equal(p.location, 'Austin, TX');
});

test('parseListingTitle strips board suffix and splits Indeed-style titles', () => {
  const p = parseListingTitle('Warehouse Associate - Dallas, TX - Southwest Logistics | Indeed.com');
  assert.equal(p.title, 'Warehouse Associate');
  assert.equal(p.location, 'Dallas, TX');
  assert.equal(p.company, 'Southwest Logistics');
});

test('parseListingTitle handles "Title at Company" and never returns a board as company', () => {
  const p = parseListingTitle('Product Designer at Figma');
  assert.equal(p.title, 'Product Designer');
  assert.equal(p.company, 'Figma');
  const q = parseListingTitle('Registered Nurse - Indeed.com');
  assert.equal(q.title, 'Registered Nurse');
  assert.equal(q.company, '');
});

// ── extractListingFromHtml ───────────────────────────────────────────────────

const LONG_DESC = '<p>We are looking for an engineer to build our payments platform. '
  + 'You will design APIs, ship features, and work with a cross-functional team. '
  + 'Salary range $150,000–$190,000. Benefits include 401k and PTO. Remote friendly.</p>';

test('extracts a full schema.org JobPosting (JSON-LD)', () => {
  const html = `<html><head>
    <script type="application/ld+json">
    {"@context":"https://schema.org/","@type":"JobPosting",
     "title":"Senior Backend Engineer",
     "hiringOrganization":{"@type":"Organization","name":"Acme Payments"},
     "jobLocation":[{"@type":"Place","address":{"@type":"PostalAddress","addressLocality":"Denver","addressRegion":"CO"}}],
     "baseSalary":{"@type":"MonetaryAmount","currency":"USD","value":{"@type":"QuantitativeValue","minValue":150000,"maxValue":190000,"unitText":"YEAR"}},
     "employmentType":"FULL_TIME",
     "description":"${LONG_DESC.replace(/"/g, '\\"')}"}
    </script></head><body></body></html>`;
  const r = extractListingFromHtml(html, 'https://careers.acmepayments.com/jobs/1');
  assert.equal(r.via, 'jsonld');
  assert.equal(r.title, 'Senior Backend Engineer');
  assert.equal(r.company, 'Acme Payments');
  assert.equal(r.location, 'Denver, CO');
  assert.equal(r.salary, '$150k–$190k');
  assert.equal(r.type, 'Full-time');
  // Extraction keeps the raw description; HTML is stripped later in buildImportedJobRow.
  assert.ok(r.description.includes('payments platform'));
});

test('finds JobPosting inside @graph and arrays, maps TELECOMMUTE to Remote', () => {
  const html = `<script type="application/ld+json">
    {"@context":"https://schema.org","@graph":[
      {"@type":"WebSite","name":"x"},
      {"@type":"JobPosting","title":"Support Specialist","jobLocationType":"TELECOMMUTE",
       "hiringOrganization":{"name":"Remote Co"},"employmentType":["PART_TIME"],
       "description":"Help customers succeed."}
    ]}</script>`;
  const r = extractListingFromHtml(html, 'https://example.com/j/1');
  assert.equal(r.via, 'jsonld');
  assert.equal(r.title, 'Support Specialist');
  assert.equal(r.company, 'Remote Co');
  assert.equal(r.location, 'Remote');
  assert.equal(r.type, 'Part-time');
});

test('falls back to og:title/meta when no JSON-LD', () => {
  const html = `<html><head>
    <meta property="og:title" content="Acme Corp hiring Line Cook in Portland, OR | LinkedIn">
    <meta property="og:description" content="Cook on the line at our flagship restaurant.">
    </head></html>`;
  const r = extractListingFromHtml(html, 'https://www.linkedin.com/jobs/view/line-cook-at-acme-corp-999');
  assert.equal(r.via, 'meta');
  assert.equal(r.title, 'Line Cook');
  assert.equal(r.company, 'Acme Corp');
  assert.equal(r.location, 'Portland, OR');
  assert.ok(r.description.includes('flagship'));
});

test('og:site_name fills company on self-hosted pages but never for a board brand', () => {
  const self = `<head><title>Staff Engineer</title><meta property="og:site_name" content="Tailscale"></head>`;
  assert.equal(extractListingFromHtml(self, 'https://tailscale.com/careers/staff').company, 'Tailscale');
  const board = `<head><title>Staff Engineer</title><meta property="og:site_name" content="Indeed"></head>`;
  assert.equal(extractListingFromHtml(board, 'https://www.indeed.com/viewjob?jk=1').company, '');
});

test('falls back to the URL when the page yields nothing (bot-walled)', () => {
  const r = extractListingFromHtml('', 'https://boards.greenhouse.io/notion/jobs/777');
  assert.equal(r.company, 'Notion');
  assert.equal(r.title, '');
  assert.equal(r.via, 'url');
});

test('malformed JSON-LD blocks are skipped without crashing', () => {
  const html = `<script type="application/ld+json">{not json</script>
    <script type="application/ld+json">{"@type":"JobPosting","title":"QA Engineer","hiringOrganization":{"name":"TestCo"},"description":"x"}</script>`;
  const r = extractListingFromHtml(html, 'https://example.com/1');
  assert.equal(r.title, 'QA Engineer');
  assert.equal(r.company, 'TestCo');
});

// ── buildImportedJobRow ──────────────────────────────────────────────────────

test('buildImportedJobRow builds a scored row from a rich extraction', () => {
  const row = buildImportedJobRow({
    title: 'Senior Backend Engineer',
    company: 'Acme Payments',
    location: 'Denver, CO',
    salary: '$150k–$190k',
    salaryMin: 150000,
    description: LONG_DESC,
    type: 'Full-time',
  }, 'https://boards.greenhouse.io/acmepayments/jobs/1');
  assert.equal(row.title, 'Senior Backend Engineer');
  assert.equal(row.company, 'Acme Payments');
  assert.equal(row.source, 'Greenhouse (imported)');
  assert.equal(row.level, 'Senior');
  assert.equal(row.availability_status, 'active');
  assert.equal(row.search_query, 'senior backend engineer');
  assert.ok(!row.description.includes('<p>'), 'HTML stripped');
  assert.ok(Number.isFinite(row.score) && row.score > 50, 'salary+ATS+desc signals earn a score');
  assert.ok(Number.isFinite(row.waste_score));
  const days = (new Date(row.expires_at) - Date.now()) / 86400000;
  assert.ok(days > 55 && days < 65, 'imported listings live ~60 days');
});

test('buildImportedJobRow scores a thin listing from its real signals (owner decision 2026-07-10)', () => {
  const row = buildImportedJobRow(
    { title: 'Line Cook', company: 'Acme Corp', location: '', description: 'Short.' },
    'https://www.acmecorp.com/careers/1'
  );
  // Deterministic scorer, $0: baseline minus the honest thin-description penalty —
  // an earned, explainable number, never null and never fabricated upward.
  assert.ok(Number.isFinite(row.score), 'thin imports are still scored');
  assert.ok(row.score < 50, 'thin description honestly costs points');
  assert.ok(Number.isFinite(row.waste_score));
  assert.equal(row.location, 'See listing');
  assert.equal(row.source, 'Imported');
});

test('a description-less LinkedIn import still earns source points in its score', () => {
  const bare = buildImportedJobRow(
    { title: 'Data Analyst', company: 'Acme Corp', location: 'Austin, TX', description: '' },
    'https://www.linkedin.com/jobs/view/data-analyst-at-acme-corp-123'
  );
  const unknownHost = buildImportedJobRow(
    { title: 'Data Analyst', company: 'Acme Corp', location: 'Austin, TX', description: '' },
    'https://careers.acmecorp.com/jobs/1'
  );
  assert.ok(Number.isFinite(bare.score) && Number.isFinite(unknownHost.score));
  assert.ok(bare.score > unknownHost.score, 'LinkedIn provenance is a real, scoreable signal');
});

test('buildImportedJobRow refuses rows missing title or company', () => {
  assert.equal(buildImportedJobRow({ title: '', company: 'X', description: '' }, 'https://x.com/1'), null);
  assert.equal(buildImportedJobRow({ title: 'X', company: '', description: '' }, 'https://x.com/1'), null);
});

// ── Keyless ATS JSON enrichment ($0 scoring signal) ─────────────────────────

test('atsApiPlan maps ATS listing URLs to their public JSON endpoints', () => {
  assert.deepEqual(atsApiPlan('https://boards.greenhouse.io/stripe/jobs/456'), {
    kind: 'greenhouse', apiUrl: 'https://boards-api.greenhouse.io/v1/boards/stripe/jobs/456', company: 'Stripe',
  });
  assert.equal(atsApiPlan('https://boards.greenhouse.io/embed/job_app?for=stripe&token=456').apiUrl,
    'https://boards-api.greenhouse.io/v1/boards/stripe/jobs/456');
  const lever = atsApiPlan('https://jobs.lever.co/rippling/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  assert.equal(lever.kind, 'lever');
  assert.equal(lever.apiUrl, 'https://api.lever.co/v0/postings/rippling/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  const ashby = atsApiPlan('https://jobs.ashbyhq.com/linear/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  assert.equal(ashby.kind, 'ashby');
  assert.equal(ashby.jobId, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  const sr = atsApiPlan('https://jobs.smartrecruiters.com/AcmeCorp/743999912345678-line-cook');
  assert.equal(sr.apiUrl, 'https://api.smartrecruiters.com/v1/companies/AcmeCorp/postings/743999912345678');
  const wd = atsApiPlan('https://acme.wd5.myworkdayjobs.com/en-US/careers/job/Dallas-TX/Line-Cook_R12345');
  assert.equal(wd.kind, 'workday');
  assert.equal(wd.apiUrl, 'https://acme.wd5.myworkdayjobs.com/wday/cxs/acme/careers/job/Dallas-TX/Line-Cook_R12345');
  // Non-ATS hosts have no plan
  assert.equal(atsApiPlan('https://www.indeed.com/viewjob?jk=abc'), null);
  assert.equal(atsApiPlan('https://boards.greenhouse.io/stripe'), null, 'board index, not a listing');
});

test('mapAtsJson maps each ATS payload shape into extraction fields', () => {
  const gh = mapAtsJson(
    { kind: 'greenhouse', company: 'Stripe' },
    { title: 'Backend Engineer', company_name: 'Stripe', location: { name: 'Denver, CO' }, content: '&lt;p&gt;Build payments infrastructure with our platform team.&lt;/p&gt;' }
  );
  assert.equal(gh.title, 'Backend Engineer');
  assert.ok(gh.description.includes('<p>Build payments'), 'HTML-escaped content decoded');

  const lever = mapAtsJson(
    { kind: 'lever', company: 'Rippling' },
    { text: 'Account Executive', categories: { location: 'Austin, TX', commitment: 'Full-time' }, descriptionPlain: 'Sell the platform.', salaryRange: { min: 90000, max: 120000 } }
  );
  assert.equal(lever.title, 'Account Executive');
  assert.equal(lever.salary, '$90k–$120k');
  assert.equal(lever.salaryMin, 90000);

  const ashby = mapAtsJson(
    { kind: 'ashby', company: 'Linear', jobId: 'abc-123' },
    { jobs: [{ id: 'other' }, { id: 'ABC-123', title: 'Product Engineer', location: 'Remote', descriptionHtml: '<p>Ship product.</p>', employmentType: 'FullTime' }] }
  );
  assert.equal(ashby.title, 'Product Engineer');

  const sr = mapAtsJson(
    { kind: 'smartrecruiters', company: 'AcmeCorp' },
    { name: 'Line Cook', company: { name: 'Acme Corp' }, location: { city: 'Dallas', region: 'TX' }, typeOfEmployment: { label: 'Part-time' }, jobAd: { sections: { jobDescription: { text: 'Cook on the line.' } } } }
  );
  assert.equal(sr.location, 'Dallas, TX');
  assert.equal(sr.type, 'Part-time');

  const wd = mapAtsJson(
    { kind: 'workday', company: 'Acme' },
    { jobPostingInfo: { title: 'Analyst', location: 'Chicago, IL', jobDescription: '<p>Analyze.</p>', timeType: 'Full time' }, hiringOrganization: { name: 'Acme Corp' } }
  );
  assert.equal(wd.title, 'Analyst');
  assert.equal(wd.company, 'Acme Corp');

  // Malformed/empty payloads are rejected, never partially trusted
  assert.equal(mapAtsJson({ kind: 'greenhouse', company: 'X' }, {}), null);
  assert.equal(mapAtsJson({ kind: 'ashby', company: 'X', jobId: 'zzz' }, { jobs: [] }), null);
  assert.equal(mapAtsJson({ kind: 'lever', company: 'X' }, null), null);
});

test('sourceFromHost maps known platforms and defaults to Imported', () => {
  assert.equal(sourceFromHost('www.linkedin.com'), 'LinkedIn (imported)');
  assert.equal(sourceFromHost('acme.wd5.myworkdayjobs.com'), 'Workday (imported)');
  assert.equal(sourceFromHost('careers.somecompany.com'), 'Imported');
});

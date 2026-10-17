// Employer "import from a link" (api/employer-listings.js action 'import_preview'): the pure
// preview shaping + company match, and the endpoint end-to-end with fetch + DNS mocked — it must
// prefill the create form from the listing page and write NOTHING.
// Run: node --test lib/server/employerImport.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import dnsPromises from 'node:dns/promises';
import { buildImportPreview, importCompanyMatches, companyMatchKey, htmlToFormText } from './employerPostings.js';
import { validateListingUrl } from './listingImport.js';
import { resolveListing } from './listingResolve.js';

test('company match: spacing, punctuation and legal suffixes do not matter', () => {
  assert.equal(importCompanyMatches('Seen Jobs', 'SeenJobs'), true);
  assert.equal(importCompanyMatches('Acme, Inc.', 'acme'), true);
  assert.equal(importCompanyMatches('ACME Corp', 'Acme LLC'), true);
  assert.equal(importCompanyMatches('Coca-Cola', 'Coca Cola Company'), true);
  assert.equal(importCompanyMatches('Globex', 'Acme'), false);
  assert.equal(importCompanyMatches('', 'Acme'), null); // listing named no company → unknown, not "no"
  assert.equal(companyMatchKey('Seen Jobs, Inc.'), 'seenjobs');
  // Careers-page naming seen live on careers.airbnb.com: "Careers at Airbnb".
  assert.equal(importCompanyMatches('Careers at Airbnb', 'Airbnb'), true);
  assert.equal(importCompanyMatches('Acme Careers', 'Acme'), true);
  assert.equal(importCompanyMatches('Jobs @ Acme', 'acme inc'), true);
  // "Jobs" at the END is part of real names (Seen Jobs) — never stripped.
  assert.equal(importCompanyMatches('Seen Jobs', 'Seen'), false);
});

test('buildImportPreview shapes the create form and lists what is still missing', () => {
  const p = buildImportPreview({
    title: '  Software Engineer ', company: 'Seen Jobs', location: 'Remote', salary: '$120k–$150k',
    type: 'Part-time', description: 'x'.repeat(120), via: 'jsonld',
  }, { url: 'https://boards.greenhouse.io/seenjobs/jobs/123', claimCompanyName: 'Seen Jobs' });
  assert.deepEqual(p.listing, {
    title: 'Software Engineer', company: 'Seen Jobs', location: 'Remote', salary: '$120k–$150k',
    type: 'Part-time', description: 'x'.repeat(120), apply_url: 'https://boards.greenhouse.io/seenjobs/jobs/123',
  });
  assert.equal(p.company_matches, true);
  assert.equal(p.via, 'jsonld');
  assert.deepEqual(p.missing, []);
  assert.equal(p.needs_details, false);

  const thin = buildImportPreview({ title: 'QA', description: 'short' }, { url: 'javascript:alert(1)', claimCompanyName: 'Acme' });
  assert.deepEqual(thin.missing, ['title', 'description', 'apply_url']);
  assert.equal(thin.needs_details, true);
  assert.equal(thin.listing.apply_url, '');
  assert.equal(thin.listing.type, 'Full-time');
  assert.equal(thin.company_matches, null);
  assert.equal(buildImportPreview(undefined, {}).needs_details, true);
});

// ── endpoint, end-to-end with mocks ───────────────────────────────────────────
const LISTING_URL = 'https://boards.greenhouse.io/seenjobs/jobs/123';
const JD = 'Build the hiring-transparency platform. You will ship features end to end across Next.js and Postgres, with real users.';
const PAGE = `<!doctype html><html><head><title>Software Engineer</title>
<script type="application/ld+json">${JSON.stringify({
  '@context': 'https://schema.org', '@type': 'JobPosting', title: 'Software Engineer',
  hiringOrganization: { '@type': 'Organization', name: 'Seen Jobs' },
  jobLocation: { '@type': 'Place', address: { '@type': 'PostalAddress', addressLocality: 'Austin', addressRegion: 'TX' } },
  employmentType: 'FULL_TIME', description: `<p>${JD}</p>`,
})}</script></head><body><h1>Software Engineer</h1></body></html>`;

function mockRes() {
  return {
    statusCode: 200, body: null, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    end() { return this; },
  };
}

test('import_preview: prefills from the listing page, matches the company, writes nothing', async (t) => {
  process.env.SUPABASE_URL = 'https://db.example.supabase.co';
  process.env.SUPABASE_SERVICE_KEY = 'service-key-for-test';
  delete process.env.SUPABASE_JWT_SECRET;
  const calls = [];
  t.mock.method(dnsPromises, 'lookup', async () => [{ address: '104.18.0.1', family: 4 }]);
  t.mock.method(globalThis, 'fetch', async (url, opts = {}) => {
    const u = String(url);
    calls.push({ url: u, method: opts.method || 'GET' });
    if (u.endsWith('/auth/v1/user')) return new Response(JSON.stringify({ id: 'emp-1' }), { status: 200 });
    if (u.includes('/rest/v1/employer_company_claims')) return new Response(JSON.stringify([{ company_name: 'seen jobs', company_display_name: 'Seen Jobs' }]), { status: 200 });
    if (u.includes('/rest/v1/')) return new Response('[]', { status: 500 }); // rate limiter → fails open
    if (u.startsWith(LISTING_URL)) return new Response(PAGE, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
    return new Response('', { status: 404 });
  });

  const { default: handler } = await import('../../api/employer-listings.js');
  const res = mockRes();
  await handler({ method: 'POST', headers: { authorization: 'Bearer test-token' }, body: { action: 'import_preview', url: LISTING_URL } }, res);

  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.ok, true);
  assert.equal(res.body.listing.title, 'Software Engineer');
  assert.equal(res.body.listing.company, 'Seen Jobs');
  assert.match(res.body.listing.location, /Austin/);
  assert.match(res.body.listing.description, /hiring-transparency platform/);
  assert.equal(res.body.listing.apply_url, LISTING_URL);
  assert.equal(res.body.company_matches, true);
  assert.equal(res.body.your_company, 'Seen Jobs');
  assert.equal(res.body.needs_details, false);
  assert.equal(res.body.page_fetched, true);
  // Writes nothing: no POST/PATCH/DELETE to the jobs table (or anywhere in the DB but the limiter).
  const writes = calls.filter((c) => c.method !== 'GET' && c.url.includes('/rest/v1/') && !/rate/i.test(c.url));
  assert.deepEqual(writes, []);
});

test('import_preview: bad URL → 400 before any page fetch; unauthenticated → 401', async (t) => {
  process.env.SUPABASE_URL = 'https://db.example.supabase.co';
  process.env.SUPABASE_SERVICE_KEY = 'service-key-for-test';
  const pageFetches = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    const u = String(url);
    if (u.endsWith('/auth/v1/user')) return new Response(JSON.stringify({ id: 'emp-1' }), { status: 200 });
    if (u.includes('/rest/v1/employer_company_claims')) return new Response(JSON.stringify([{ company_name: 'acme' }]), { status: 200 });
    if (!u.includes('supabase.co')) pageFetches.push(u);
    return new Response('[]', { status: 200 });
  });
  const { default: handler } = await import('../../api/employer-listings.js');

  const bad = mockRes();
  await handler({ method: 'POST', headers: { authorization: 'Bearer t' }, body: { action: 'import_preview', url: 'http://169.254.169.254/latest/meta-data' } }, bad);
  assert.equal(bad.statusCode, 400);
  assert.deepEqual(pageFetches, []);

  const anon = mockRes();
  await handler({ method: 'POST', headers: {}, body: { action: 'import_preview', url: LISTING_URL } }, anon);
  assert.equal(anon.statusCode, 401);
});

test('htmlToFormText keeps paragraphs and bullets, decodes entities, drops scripts', () => {
  assert.equal(htmlToFormText('<p>Intro &amp; more</p><ul><li>One</li><li>Two&nbsp;three</li></ul><script>x()</script>'), 'Intro & more\n\n• One\n• Two three');
  assert.equal(htmlToFormText('&lt;p&gt;Escaped&lt;/p&gt;&lt;p&gt;Second&lt;/p&gt;'), 'Escaped\nSecond');
  assert.equal(htmlToFormText('Plain text, no tags.'), 'Plain text, no tags.');
  assert.equal(htmlToFormText(null), '');
});

// Live 2026-10-17 on job-boards.greenhouse.io/discord/jobs/8806482002: the page's meta description
// is just the location (22 chars). The Greenhouse API rung fetched the full 4,835-char JD, but the
// merge kept the thin one because it was non-empty. A thin description must yield to a full one.
test('resolveListing: a thin page description yields to the full ATS description', async (t) => {
  const url = 'https://job-boards.greenhouse.io/acme/jobs/42';
  const fullJd = '<p>' + 'Acme builds rockets and you will help. '.repeat(10) + '</p>';
  t.mock.method(dnsPromises, 'lookup', async () => [{ address: '104.18.0.1', family: 4 }]);
  t.mock.method(globalThis, 'fetch', async (u) => {
    const s = String(u);
    if (s.startsWith('https://boards-api.greenhouse.io/v1/boards/acme/jobs/42')) {
      return new Response(JSON.stringify({ title: 'Rocket Engineer', location: { name: 'Austin, TX' }, content: fullJd, company_name: 'Acme' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (s.startsWith(url)) {
      return new Response('<html><head><title>Rocket Engineer at Acme</title><meta property="og:title" content="Rocket Engineer"><meta property="og:description" content="Austin, TX"></head><body></body></html>', { status: 200, headers: { 'content-type': 'text/html' } });
    }
    return new Response('', { status: 404 });
  });
  const { fields, rungs } = await resolveListing(validateListingUrl(url));
  assert.ok(rungs.some((r) => r.rung === 'ats-api'), JSON.stringify(rungs));
  assert.ok(fields.description.length >= 80, `description stayed thin: ${JSON.stringify(fields.description)}`);
  assert.match(fields.description, /Acme builds rockets/);
  assert.equal(fields.via, 'ats-api');
});

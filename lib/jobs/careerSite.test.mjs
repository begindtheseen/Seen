// Run: node --test lib/jobs/careerSite.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRobots, robotsAllows, parseSitemap, jobPostingsFromHtml, rowFromPosting, decodeXmlOnce, readCareerSite, careerHostCandidates } from './careerSite.js';

test('robots: our group or *, longest match wins, wildcards and $ work', () => {
  const r = parseRobots('User-agent: *\nDisallow: /search\nAllow: /search/jobs\nDisallow: /*.pdf$\nSitemap: https://x.com/jobsitemap\n\nUser-agent: GPTBot\nDisallow: /');
  assert.deepEqual(r.sitemaps, ['https://x.com/jobsitemap']);
  assert.equal(robotsAllows(r.rules, '/job/1'), true);
  assert.equal(robotsAllows(r.rules, '/search?q=x'), false);
  assert.equal(robotsAllows(r.rules, '/search/jobs/2'), true);
  assert.equal(robotsAllows(r.rules, '/a/b.pdf'), false);
  assert.equal(robotsAllows(parseRobots('User-agent: seenjobs\nDisallow: /\nUser-agent: *\nDisallow:').rules, '/job/1'), false);
  assert.equal(robotsAllows(parseRobots('User-agent: *\nDisallow:').rules, '/job/1'), true);
});

test('sitemaps: index vs urlset, CDATA, one-pass entity decode', () => {
  const idx = parseSitemap('<sitemapindex><sitemap><loc>https://x.com/jobs.xml</loc></sitemap></sitemapindex>');
  assert.equal(idx.isIndex, true);
  const set = parseSitemap('<urlset><url><loc><![CDATA[https://x.com/job/1?a=1&amp;b=2]]></loc><lastmod>2026-10-01</lastmod></url></urlset>');
  assert.deepEqual(set.entries, [{ loc: 'https://x.com/job/1?a=1&b=2', lastmod: '2026-10-01' }]);
  assert.equal(decodeXmlOnce('&amp;lt;'), '&lt;', 'never double-unescapes');
});

const posting = (over = {}) => ({ '@context': 'https://schema.org', '@type': 'JobPosting', title: 'Warehouse Associate', description: '<p>Load and unload trucks, keep the warehouse safe and tidy, and help customers find what they need every shift.</p>',
  hiringOrganization: { '@type': 'Organization', name: 'The Home Depot' }, identifier: { value: '112839BR' }, employmentType: 'FULL_TIME',
  jobLocation: { '@type': 'Place', address: { addressLocality: 'Locust Grove', addressRegion: 'GA', addressCountry: 'US' } },
  baseSalary: { value: { minValue: 17, maxValue: 19, unitText: 'HOUR' } }, ...over });

test('JobPosting → row: employer must match, US/remote only, expired skipped, salary read', () => {
  const html = `<script type="application/ld+json">${JSON.stringify({ '@graph': [{ '@type': 'WebPage' }, posting()] })}</script>`;
  const [jp] = jobPostingsFromHtml(html);
  const { row } = rowFromPosting(jp, { company: 'Home Depot', pageUrl: 'https://careers.homedepot.com/job/1/x/', host: 'careers.homedepot.com' });
  assert.equal(row.title, 'Warehouse Associate');
  assert.equal(row.location, 'Locust Grove, GA');
  assert.equal(row.salary, '$17 – $19 / hour');
  assert.equal(row.external_id, 'site:careers.homedepot.com:112839BR');
  assert.equal(row.source_type, 'EMPLOYER_SITE');
  assert.equal(rowFromPosting(posting({ hiringOrganization: { name: 'Lowe\'s' } }), { company: 'Home Depot', pageUrl: 'https://x/job/1', host: 'x' }).skip, 'other_employer');
  assert.equal(rowFromPosting(posting({ jobLocation: { address: { addressLocality: 'Toronto', addressCountry: 'CA' } } }), { company: 'Home Depot', pageUrl: 'https://x/job/1', host: 'x' }).skip, 'outside_market');
  assert.equal(rowFromPosting(posting({ validThrough: '2020-01-01' }), { company: 'Home Depot', pageUrl: 'https://x/job/1', host: 'x' }).skip, 'expired');
  assert.equal(rowFromPosting(posting({ jobLocationType: 'TELECOMMUTE', jobLocation: undefined }), { company: 'Home Depot', pageUrl: 'https://x/job/1', host: 'x' }).row.location, 'Remote');
});

function site(pages) {
  return async (url) => {
    const u = String(url); const body = pages[u];
    if (body === 'BLOCK') return { status: 403, url: u, async text() { return '<HTML><HEAD><TITLE>Access Denied</TITLE>'; } };
    if (body == null) { if (u.includes('nohost')) throw Object.assign(new Error('fetch failed'), { cause: { code: 'ENOTFOUND' } }); return { status: 404, url: u, async text() { return ''; } }; }
    return { status: 200, url: u, async text() { return body; } };
  };
}

test('a whole site: robots → job sitemap → pages; robots-disallowed pages are not read', async () => {
  const pages = {
    'https://careers.acme.com/robots.txt': 'User-agent: *\nDisallow: /job/2\nSitemap: https://careers.acme.com/jobsitemap',
    'https://careers.acme.com/jobsitemap': '<urlset><url><loc>https://careers.acme.com/job/1/a</loc></url><url><loc>https://careers.acme.com/job/2/b</loc></url><url><loc>https://careers.acme.com/about</loc></url></urlset>',
    'https://careers.acme.com/job/1/a': `<script type="application/ld+json">${JSON.stringify(posting({ hiringOrganization: { name: 'Acme' } }))}</script>`,
  };
  const r = await readCareerSite('Acme', { fetchImpl: site(pages) });
  assert.equal(r.status, 'ok'); assert.equal(r.rows.length, 1); assert.equal(r.sitemapJobs, 2); assert.equal(r.pagesRead, 1);
});

test('a site that refuses servers is "blocked" with a URL for the browser', async () => {
  const r = await readCareerSite('Tesla', { fetchImpl: site({ 'https://careers.tesla.com/robots.txt': 'BLOCK', 'https://www.tesla.com/robots.txt': 'BLOCK' }) });
  assert.equal(r.status, 'blocked');
  assert.match(r.careersUrl, /^https:\/\/(careers\.tesla\.com\/|www\.tesla\.com\/careers)$/);
  assert.deepEqual(careerHostCandidates('Tesla'), ['careers.tesla.com', 'jobs.tesla.com', 'www.tesla.com']);
});

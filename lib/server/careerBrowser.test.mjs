// Run: node --test lib/server/careerBrowser.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { EXTRACT_JS, parseExtract, safeStartUrl } from './careerBrowser.js';

test('the in-page script finds JobPosting data and same-site job links', () => {
  const doc = {
    scripts: [{ textContent: JSON.stringify({ '@graph': [{ '@type': 'WebPage' }, { '@type': 'JobPosting', title: 'Service Technician' }] }) }, { textContent: '{bad json' }],
    anchors: ['https://www.tesla.com/careers/search/job/service-technician-123', 'https://www.tesla.com/about', 'https://evil.example/jobs/1', '/careers/search/job/x-456#apply'],
  };
  const ctx = { location: { href: 'https://www.tesla.com/careers/search', hostname: 'www.tesla.com' }, URL,
    document: { title: 'Careers', querySelectorAll: (sel) => sel.startsWith('script') ? doc.scripts : doc.anchors.map((h) => ({ href: h })) } };
  const out = parseExtract(vm.runInNewContext(EXTRACT_JS, ctx));
  assert.equal(out.postings.length, 1);
  assert.equal(out.postings[0].title, 'Service Technician');
  assert.deepEqual(out.links, ['https://www.tesla.com/careers/search/job/service-technician-123', 'https://www.tesla.com/careers/search/job/x-456']);
});

test('parseExtract tolerates wrappers and junk; start URLs must be plain https', () => {
  assert.deepEqual(parseExtract({ result: JSON.stringify({ links: ['http://x/jobs/1', 'https://x/jobs/2'] }) }).links, ['https://x/jobs/2']);
  assert.deepEqual(parseExtract('nope').postings, []);
  assert.equal(safeStartUrl('https://www.tesla.com/careers'), 'https://www.tesla.com/careers');
  assert.equal(safeStartUrl('http://www.tesla.com/careers'), null);
  assert.equal(safeStartUrl('https://user:pw@x.com/'), null);
  assert.equal(safeStartUrl('javascript:alert(1)'), null);
});

// ---- the in-page harvest, run in a VM with a fake page ------------------------------------------
import { harvestStartJs, HARVEST_POLL_JS, harvestTakeJs, parseEvalJson } from './careerBrowser.js';
import { rowFromPosting } from '../jobs/careerSite.js';

const LONG = 'You will build drive units on the Cybercab line, run quality checks, and keep the line moving safely every shift. '.repeat(3);
const ldPage = (p) => `<html><head><script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'JobPosting', ...p })}</script></head><body></body></html>`;
const res = (body, status = 200) => ({ ok: status < 300, status, json: async () => (typeof body === 'string' ? JSON.parse(body) : body), text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });

function fakePage({ href, routes, anchors = [], moreAnchors = [], buttons = [] }) {
  const u = new URL(href);
  const calls = [];
  let scrolled = 0;
  const ctx = {
    URL, JSON, Promise, Map, Set, Math, Number, String, Object, Array, Error, encodeURIComponent,
    setTimeout: (fn) => setImmediate(fn),
    location: { href, hostname: u.hostname, origin: u.origin },
    document: {
      body: { scrollHeight: 1000 },
      querySelectorAll: (sel) => (sel === 'a[href]' ? [...anchors, ...(scrolled ? moreAnchors : [])].map(([h, t]) => ({ href: new URL(h, href).toString(), textContent: t })) : sel === 'button, a' ? buttons : []),
    },
    scrollTo: () => { scrolled++; },
    fetch: async (path, init) => {
      const full = new URL(path, href).toString();
      calls.push({ full, init });
      const r = routes[full] ?? routes[new URL(full).pathname];
      return r === undefined ? res('not found', 404) : typeof r === 'function' ? r() : r;
    },
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  return { ctx, calls, run: (js) => vm.runInContext(js, ctx) };
}
async function harvest(page, opts) {
  const start = parseEvalJson(page.run(harvestStartJs({ ...opts, scrollPauseMs: 0, jobPauseMs: 0 })));
  assert.equal(start.started, true);
  for (let i = 0; i < 500; i++) { const s = parseEvalJson(page.run(HARVEST_POLL_JS)); if (!s.running) break; await new Promise((r) => setImmediate(r)); }
  const status = parseEvalJson(page.run(HARVEST_POLL_JS));
  const items = []; for (;;) { const b = parseEvalJson(page.run(harvestTakeJs(2)), []); if (!b.length) break; items.push(...b); }
  return { status, items };
}

test('Tesla: the careers feed lists every job; job pages give the JobPosting; Seen accepts them', async () => {
  const feed = { lookup: { locations: { 1: 'Austin, Texas', 2: 'Berlin, Germany' }, departments: { 9: 'Manufacturing' } },
    listings: [{ id: '256718', t: 'Production Associate, Cybercab, Drive Unit', l: '1', dp: '9' }, { id: '300001', t: 'Service Advisor', l: '2', dp: '9' }] };
  const page = fakePage({ href: 'https://www.tesla.com/careers/search/?site=US', routes: {
    '/cua-api/apps/careers/state': res(feed),
    'https://www.tesla.com/careers/search/job/production-associate-cybercab-drive-unit-256718': res(ldPage({ title: 'Production Associate, Cybercab, Drive Unit', description: LONG, hiringOrganization: { name: 'Tesla' }, jobLocation: { address: { addressLocality: 'Austin', addressRegion: 'TX', addressCountry: 'US' } } })),
    'https://www.tesla.com/careers/search/job/service-advisor-300001': res(ldPage({ title: 'Service Advisor', description: LONG, hiringOrganization: { name: 'Tesla' }, jobLocation: { address: { addressLocality: 'Berlin', addressCountry: 'DE' } } })),
  } });
  const { status, items } = await harvest(page, { company: 'Tesla', maxJobs: 50 });
  assert.equal(status.method, 'tesla_feed');
  assert.equal(status.detail, 'job_page');
  assert.equal(status.listed, 2);
  assert.equal(items.length, 2);
  assert.ok(page.calls.every((c) => c.init?.credentials === 'include'), 'requests go with the visitor’s own session');
  const rows = items.map((it) => rowFromPosting(it.posting, { company: 'Tesla', pageUrl: it.page_url, host: 'www.tesla.com' }));
  assert.equal(rows[0].row.location, 'Austin, TX');
  assert.match(rows[0].row.external_id, /^site:www\.tesla\.com:256718$/);
  assert.equal(rows[1].skip, 'outside_market', 'Berlin is filtered by Seen, not by the page');
});

test('Tesla: a job page without JobPosting data falls back to Tesla’s per-job feed', async () => {
  const page = fakePage({ href: 'https://www.tesla.com/careers/search/?site=US', routes: {
    '/cua-api/apps/careers/state': res({ listings: [{ id: '42', title: 'Body Shop Technician', location: 'Fremont, California' }] }),
    'https://www.tesla.com/careers/search/job/body-shop-technician-42': res('<html><div id="app"></div></html>'),
    '/cua-api/careers/job/42': res({ title: 'Body Shop Technician', location: 'Fremont, California', sections: { overview: 'Short.', description: LONG } }),
  } });
  const { status, items } = await harvest(page, { company: 'Tesla' });
  assert.equal(status.detail, 'tesla_job_feed');
  assert.equal(items.length, 1);
  const r = rowFromPosting(items[0].posting, { company: 'Tesla', pageUrl: items[0].page_url, host: 'www.tesla.com' });
  assert.ok(r.row, JSON.stringify(r));
  assert.equal(r.row.location, 'Fremont, California');
  assert.equal(r.row.apply_url, 'https://www.tesla.com/careers/search/job/body-shop-technician-42');
});

test('when the feed is not there, the page is scrolled until no new jobs appear; a job with no data is counted, not invented', async () => {
  const page = fakePage({ href: 'https://www.tesla.com/careers/search/?site=US',
    routes: {
      '/cua-api/apps/careers/state': res('forbidden', 403),
      'https://www.tesla.com/careers/search/job/a-1001': res(ldPage({ title: 'A', description: LONG, hiringOrganization: 'Tesla', jobLocation: { address: { addressLocality: 'Austin', addressRegion: 'TX', addressCountry: 'US' } } })),
      'https://www.tesla.com/careers/search/job/b-1002': res(ldPage({ title: 'B', description: LONG, hiringOrganization: 'Tesla', jobLocationType: 'TELECOMMUTE' })),
      'https://www.tesla.com/careers/search/job/c-1003': res('<html></html>'),
      '/cua-api/careers/job/1003': res('nope', 500),
    },
    anchors: [['/careers/search/job/a-1001', 'A'], ['/about', 'About']],
    moreAnchors: [['/careers/search/job/b-1002#top', 'B'], ['/careers/search/job/c-1003', 'C'], ['https://other.example/jobs/9', 'X']] });
  const { status, items } = await harvest(page, { company: 'Tesla' });
  assert.equal(status.method, 'page_scroll');
  assert.equal(status.listed, 3);
  assert.equal(items.length, 2);
  assert.equal(status.failed + status.noData, 1);
  assert.match(status.notes.join(' '), /answered 403/, 'a feed that does not apply is a note, not an error');
  assert.equal(status.errors.length, status.failed, 'only real failures are errors');
});

test('a second start while a harvest runs does not start another; the cap limits the jobs read', async () => {
  const listings = Array.from({ length: 30 }, (_, i) => ({ id: String(500 + i), title: `Job ${i}`, location: 'Austin, Texas' }));
  const routes = { '/cua-api/apps/careers/state': res({ listings }) };
  for (const l of listings) routes[`https://www.tesla.com/careers/search/job/job-${l.title.split(' ')[1]}-${l.id}`] = res(ldPage({ title: l.title, description: LONG, hiringOrganization: 'Tesla', jobLocation: { address: { addressLocality: 'Austin', addressRegion: 'TX', addressCountry: 'US' } } }));
  const page = fakePage({ href: 'https://www.tesla.com/careers/search/?site=US', routes });
  const first = parseEvalJson(page.run(harvestStartJs({ company: 'Tesla', maxJobs: 10, scrollPauseMs: 0, jobPauseMs: 0 })));
  const again = parseEvalJson(page.run(harvestStartJs({ company: 'Tesla', maxJobs: 10 })));
  assert.equal(first.started, true); assert.equal(again.already, true);
  for (let i = 0; i < 500 && parseEvalJson(page.run(HARVEST_POLL_JS)).running; i++) await new Promise((r) => setImmediate(r));
  assert.equal(parseEvalJson(page.run(HARVEST_POLL_JS)).listed, 10);
  assert.equal(parseEvalJson(page.run(harvestTakeJs(100))).length, 10);
});

test('only a button whose text STARTS with load/show/view more, more jobs or next page is clicked', async () => {
  const clicked = [];
  const btn = (t) => ({ textContent: t, click: () => clicked.push(t) });
  const page = fakePage({ href: 'https://jobs.example.com/search', routes: {}, anchors: [], buttons: [btn('Learn more jobs info'), btn('See 3 more jobs here'), btn('  Load more  ')] });
  await harvest(page, { company: 'Example' });
  assert.ok(clicked.length >= 1);
  assert.ok(clicked.every((t) => t.trim() === 'Load more'), `clicked: ${clicked.join(' | ')}`);
});

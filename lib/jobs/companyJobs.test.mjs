// Run: node --test lib/jobs/companyJobs.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pullCompanyJobs } from './companyJobs.js';

const job = (company, location = 'Austin, TX') => ({ title: 'Technician', company, location, apply_url: 'https://x/1', description: 'x'.repeat(100) });
const base = (over = {}) => ({
  sourcesFor: async () => ({ sources: [] }),
  findBoards: async () => ({ found: [] }),
  register: async () => true,
  readSources: async () => [],
  syncBoards: async (s) => ({ fetched: 10 * s.length, kept: 8 * s.length, dropped_outside_market: 2 * s.length, upserted: 8 * s.length }),
  readCareerSite: async () => ({ status: 'none', rows: [], skipped: {}, note: 'none' }),
  fetchAdzuna: async () => [],
  upsert: async (rows) => ({ upserted: rows.length }),
  ...over,
});

test('registered boards are used as they are; nothing is searched or registered', async () => {
  let registered = 0;
  const r = await pullCompanyJobs('SpaceX', { adzuna: {}, deps: base({ sourcesFor: async () => ({ sources: [{ id: 1, provider: 'greenhouse', tenant: 'spacex' }] }), findBoards: async () => { throw new Error('must not search'); }, register: async () => { registered++; } }) });
  assert.equal(r.boards.status, 'ok'); assert.equal(r.boards.registered, 'existing'); assert.equal(r.boards.saved, 8);
  assert.equal(registered, 0); assert.equal(r.saved, 8);
});

test('no registered board → found boards are registered, then synced', async () => {
  const regs = [];
  const found = [{ provider: 'ashby', tenant: 'notion', jobs: 133, name: null, nameVerified: false }];
  const r = await pullCompanyJobs('Notion', { adzuna: {}, deps: base({ findBoards: async () => ({ found }), register: async (e) => regs.push(e), readSources: async () => [{ id: 9, provider: 'ashby', tenant: 'notion' }] }) });
  assert.equal(regs.length, 1); assert.equal(regs[0].confidence, 0.6); assert.equal(regs[0].discoveredVia, 'company_search');
  assert.equal(r.boards.registered, 'new'); assert.deepEqual(r.boards.boards, [{ provider: 'ashby', tenant: 'notion', name_unverified: true }]);
});

test('a blocked career site is handed to the browser; site rows and Adzuna rows of THIS employer are saved', async () => {
  const r = await pullCompanyJobs('Tesla', { adzuna: { appId: 'a', appKey: 'k' }, deps: base({
    readCareerSite: async () => ({ status: 'blocked', host: 'www.tesla.com', careersUrl: 'https://www.tesla.com/careers', rows: [], skipped: {}, note: 'refuses servers' }),
    fetchAdzuna: async () => [job('Tesla'), job('Tesla Exteriors'), job('Tesla', 'Berlin, Germany')],
  }) });
  assert.deepEqual(r.needs_browser, { url: 'https://www.tesla.com/careers', host: 'www.tesla.com', reason: 'blocked' });
  assert.equal(r.adzuna.found, 3); assert.equal(r.adzuna.this_company, 1); assert.equal(r.adzuna.saved, 1);
  const h = await pullCompanyJobs('Home Depot', { adzuna: {}, deps: base({ readCareerSite: async () => ({ status: 'ok', host: 'careers.homedepot.com', rows: [job('The Home Depot'), job('The Home Depot')], skipped: {}, note: 'ok' }) }) });
  assert.equal(h.career_site.saved, 2); assert.equal(h.adzuna.status, 'unavailable');
});

test('one source failing never sinks the others', async () => {
  const r = await pullCompanyJobs('Acme', { adzuna: {}, deps: base({ sourcesFor: async () => { throw new Error('db down'); }, readCareerSite: async () => ({ status: 'ok', rows: [job('Acme')], skipped: {} }) }) });
  assert.equal(r.boards.status, 'error'); assert.equal(r.career_site.saved, 1);
});

test('Adzuna: every page while it keeps returning this employer, never the same listing twice', async () => {
  const pages = [];
  const full = (page, co) => Array.from({ length: 50 }, (_, i) => ({ title: `Tech ${page}-${i}`, company: co, location: 'Austin, TX', external_id: `adz-${page}-${i}`, apply_url: `https://adzuna.example/${page}/${i}` }));
  const r = await pullCompanyJobs('Tesla', { adzuna: { appId: 'a', appKey: 'k' },
    deps: base({ fetchAdzuna: async (_w, _l, _a, _k, _d, page) => { pages.push(page); return page <= 3 ? full(page, 'Tesla').concat(page === 2 ? [full(1, 'Tesla')[0]] : []) : page <= 5 ? full(page, 'Other Co') : []; } }) });
  assert.deepEqual(pages, [1, 2, 3, 4, 5], 'kept paging past page 1, stopped after two pages without Tesla');
  assert.equal(r.adzuna.this_company, 150, 'the repeat from page 1 is counted once');
});

// Owner 2026-10-21: "aggregate NASA jobs". A federal agency posts on USAJOBS, not an ATS board.
import { sameAgency, agencyAcronym } from './companyJobs.js';
test('agency names match their acronym and only their own postings are kept', () => {
  assert.equal(agencyAcronym('National Aeronautics and Space Administration'), 'NASA');
  assert.ok(sameAgency('National Aeronautics and Space Administration', 'NASA'));
  assert.ok(sameAgency('National Aeronautics and Space Administration', 'nasa'));
  assert.ok(!sameAgency('Naval Air Systems Command', 'NASA'));
  assert.ok(sameAgency('Federal Aviation Administration', 'FAA'));
  assert.ok(!sameAgency('Federal Aviation Administration', 'Tesla'));
});
test('USAJOBS step: keeps the agency\'s US postings; says "not configured" without a key', async () => {
  const saved = [];
  const r = await pullCompanyJobs('NASA', { adzuna: {}, usajobs: { key: 'k', email: 'e@x' }, deps: base({
    fetchUsaJobs: async (what) => { assert.equal(what, 'NASA'); return [job('National Aeronautics and Space Administration', 'Houston, Texas'), job('Naval Air Systems Command', 'Patuxent River, Maryland'), job('National Aeronautics and Space Administration', 'Paris, France')]; },
    upsert: async (rows) => { saved.push(...rows); return { upserted: rows.length }; },
  }) });
  assert.equal(r.usajobs.status, 'ok'); assert.equal(r.usajobs.found, 3); assert.equal(r.usajobs.this_company, 1); assert.equal(r.usajobs.saved, 1);
  assert.equal(saved[0].search_query, 'nasa');
  const off = await pullCompanyJobs('NASA', { adzuna: {}, usajobs: null, deps: base() });
  assert.equal(off.usajobs.status, 'unavailable'); assert.match(off.usajobs.note, /USAJOBS_API_KEY/);
});

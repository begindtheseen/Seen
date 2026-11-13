// The list + detail employer-board providers (lib/jobs/providers/*): Workday, Oracle Recruiting Cloud,
// UKG Pro Recruiting, EmpForce. Run: node --test lib/jobs/boardProviders.test.mjs
//
// Fixtures under lib/jobs/fixtures/<provider>/ are REAL answers from the boards (read 2026-11-13),
// trimmed to a few postings. Fakes route by the parsed hostname + path (never a regex over the URL).
// Where a test needs a shape the trimmed fixture lacks (pages for paging, a foreign place on an
// all-US board, a stated pay), it edits a COPY of a real record and says so.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { fetchSourceJobs, PROVIDERS, INGESTABLE_PROVIDER_IDS } from './atsProviders.js';
import { cleanDescription } from '../server/jobSources.js';
import { oracleRequisitionHtml } from './atsText.js';
import { workday, workdayPlace, listPlaceAbroad, parseWorkdayTenant } from './providers/workday.js';
import { oraclecloud, parseOracleTenant } from './providers/oraclecloud.js';
import { ukg, ukgDetailFromPage, ukgPay, parseUkgTenant } from './providers/ukg.js';
import { empforce, empforceJobsFromPage, empforceDescriptionFromPage, empforcePay, parseEmpforceTenant } from './providers/empforce.js';
import { request, tidyCaps, rowsForPlaces } from './providers/common.js';
import { detectAts, empforceKeyHex, INGESTABLE_PROVIDERS } from './atsDetect.js';
import { SEED_SOURCES } from './seedSources.js';

const FX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fx = (p) => readFileSync(join(FX, p), 'utf8');
const fxJson = (p) => JSON.parse(fx(p));

// A fake fetch: `routes(u, init)` gets the parsed URL and returns a body (object → JSON, string → text),
// a number (HTTP status), or undefined (404). Every call is logged.
function fakeFetch(routes) {
  const calls = [];
  const impl = async (url, init = {}) => {
    const u = new URL(url);
    calls.push({ u, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
    const out = await routes(u, init);
    if (out === undefined) return { ok: false, status: 404, json: async () => null, text: async () => '' };
    if (typeof out === 'number') return { ok: out < 400, status: out, json: async () => null, text: async () => '' };
    const text = typeof out === 'string' ? out : JSON.stringify(out);
    return { ok: true, status: 200, json: async () => JSON.parse(text), text: async () => text };
  };
  return { impl, calls };
}
// A fetch that never answers and ignores its abort signal — the worst case for a timeout.
const hang = () => new Promise(() => {});

const WD_HOST = 'hpinc.wd5.myworkdayjobs.com';
const WD_TENANT = 'hpinc.wd5/hpinc/hpinc';
const WD_DETAILS = {
  '/wday/cxs/hpinc/hpinc/job/Odessa-TX-USA/US-Rig-Based-Positions_REQ-1': 'workday/detail-req-1.json',
  '/wday/cxs/hpinc/hpinc/job/Tulsa-OK-USA/Experienced-Senior-Accountant--Consolidations---Intercompany-Accounting_REQ-2862': 'workday/detail-req-2862.json',
  '/wday/cxs/hpinc/hpinc/job/Taleigao---Goa/Accounts-Payable-Coordinator_REQ-3006-1': 'workday/detail-req-3006.json',
};
const workdayRoutes = (u) => {
  if (u.hostname !== WD_HOST) return undefined;
  if (u.pathname === '/wday/cxs/hpinc/hpinc/jobs') return fxJson('workday/list.json');
  return WD_DETAILS[u.pathname] ? fxJson(WD_DETAILS[u.pathname]) : undefined;
};

// ── Workday ───────────────────────────────────────────────────────────────────────────────────────
test('workday: reads the list, skips the detail of a posting the list places abroad, one row per US place', async () => {
  const f = fakeFetch(workdayRoutes);
  const r = await fetchSourceJobs({ provider: 'workday', tenant: WD_TENANT, companyName: 'Helmerich & Payne' }, { fetchImpl: f.impl });
  assert.equal(r.ok, true);
  const details = f.calls.filter((c) => c.method === 'GET').map((c) => c.u.pathname);
  assert.ok(!details.some((p) => p.includes('Saudi-Arabia')), 'the list says Saudi Arabia → no detail read');
  assert.equal(details.length, 3);
  // the list call is the board's own search body
  const list = f.calls.find((c) => c.method === 'POST');
  assert.deepEqual(list.body, { limit: 20, offset: 0, searchText: '', appliedFacets: {} });

  // US filter: the India posting (detail country IN) is read but not kept; the rig pool is 6 rows.
  assert.ok(r.rows.every((x) => !/india|saudi/i.test(x.location)));
  const rig = r.rows.filter((x) => x.title === 'U.S. Rig Based Positions');
  assert.deepEqual(rig.map((x) => x.location), ['Odessa, TX', 'Barnesville, OH', 'Grand Junction, CO', 'Dickinson, ND', 'Oklahoma City, OK', 'Tyler, TX']);
  assert.equal(new Set(rig.map((x) => x.external_id)).size, 6, 'each place is its own row id');
  assert.equal(rig[0].external_id, 'workday:hpinc.wd5/hpinc/hpinc:91bf5021c57d013c5beaf6f6ff009aab');
  assert.equal(rig[1].external_id, 'workday:hpinc.wd5/hpinc/hpinc:91bf5021c57d013c5beaf6f6ff009aab#2');
  assert.equal(r.rows.length, 7);
  assert.equal(r.total, 8, 'every row read (4 postings → 8 rows), not just the US ones');
  assert.equal(r.droppedOutsideMarket, 1, 'the India row');

  // whole description, the posting's public URL, provenance, no pay invented
  const detail = fxJson('workday/detail-req-1.json').jobPostingInfo;
  assert.equal(rig[0].description, cleanDescription(detail.jobDescription));
  assert.ok(rig[0].description.length > 3000);
  assert.equal(rig[0].apply_url, 'https://hpinc.wd5.myworkdayjobs.com/HPINC/job/Odessa-TX-USA/US-Rig-Based-Positions_REQ-1');
  assert.equal(rig[0].canonical_url, rig[0].apply_url);
  assert.equal(rig[0].company, 'Helmerich & Payne');
  assert.equal(rig[0].ats_provider, 'workday');
  assert.equal(rig[0].source_type, 'ATS_DIRECT');
  assert.ok(r.rows.every((x) => x.salary === null), 'Workday states no pay field; none is made up');
});

test('workday: paging stops at the first page\'s total (later pages answer total 0) and at the posting cap', async () => {
  const template = fxJson('workday/list.json').jobPostings[2]; // a real Tulsa posting, copied per index
  const page = (offset, n, total) => ({ total, jobPostings: Array.from({ length: n }, (_, i) => ({ ...template, externalPath: `${template.externalPath}-${offset + i}` })) });
  const f = fakeFetch((u, init) => {
    if (u.hostname !== WD_HOST) return undefined;
    if (u.pathname.endsWith('/jobs')) {
      const { offset } = JSON.parse(init.body);
      return offset === 0 ? page(0, 20, 45) : offset === 20 ? page(20, 20, 0) : offset === 40 ? page(40, 5, 0) : page(offset, 20, 0);
    }
    return 404;
  });
  await workday.fetchCompanyJobs(WD_TENANT, { fetchImpl: f.impl, companyName: 'H&P' });
  assert.deepEqual(f.calls.filter((c) => c.method === 'POST').map((c) => c.body.offset), [0, 20, 40]);

  const g = fakeFetch((u) => (u.pathname.endsWith('/jobs') ? page(0, 20, 5000) : 404));
  await workday.fetchCompanyJobs(WD_TENANT, { fetchImpl: g.impl, maxPostings: 60, companyName: 'H&P' });
  assert.deepEqual(g.calls.filter((c) => c.method === 'POST').map((c) => c.body.offset), [0, 20, 40], 'the cap stops paging');
});

test('workday: a board that never answers cannot outlive the budget', async () => {
  const t0 = Date.now();
  const rows = await workday.fetchCompanyJobs(WD_TENANT, { fetchImpl: hang, timeoutMs: 200, budgetMs: 400 });
  assert.deepEqual(rows, []);
  assert.ok(Date.now() - t0 < 1500, `took ${Date.now() - t0} ms`);

  // the list answers, every detail hangs: stops at the budget with what it finished (nothing)
  const t1 = Date.now();
  const f = fakeFetch((u) => (u.pathname.endsWith('/jobs') ? fxJson('workday/list.json') : hang()));
  const r = await workday.fetchCompanyJobs(WD_TENANT, { fetchImpl: f.impl, timeoutMs: 150, budgetMs: 500 });
  assert.deepEqual([...r], []);
  assert.ok(Date.now() - t1 < 2000, `took ${Date.now() - t1} ms`);
});

test('workday: place labels', () => {
  assert.equal(workdayPlace('Odessa-TX-USA', 'US'), 'Odessa, TX');
  assert.equal(workdayPlace('Grand Junction-CO-USA', 'US'), 'Grand Junction, CO');
  assert.equal(workdayPlace('US-TX-HOUSTON-2001 RANKIN ROAD', 'US'), 'Houston, TX');
  assert.equal(workdayPlace('TX - Midland, 3919 N FM 1788', 'US'), 'Midland, TX');
  assert.equal(workdayPlace('USA - Utah - West Valley City', 'US'), 'West Valley City, Utah');
  assert.equal(workdayPlace('Houston Office', 'US'), 'Houston Office');
  assert.equal(workdayPlace('SLB', 'US'), 'SLB, United States');
  assert.equal(workdayPlace('Taleigao - Goa', 'IN'), 'Taleigao - Goa, India');
  assert.equal(workdayPlace('CA - Calgary', 'CA'), 'CA - Calgary, Canada', 'a Canadian posting is never read as California');
  assert.equal(listPlaceAbroad('GB-AC-ABERDEEN-BAKER HUGHES BUILDING'), true);
  assert.equal(listPlaceAbroad('DNU-MX-NLE-MONTERREY-BOULEVARD DIAZ ORDAZ KM. 333'), true);
  assert.equal(listPlaceAbroad('IND - Karnataka - Mysuru'), true);
  assert.equal(listPlaceAbroad('Saudi Arabia Office'), true);
  assert.equal(listPlaceAbroad('TX - Midland'), false);
  assert.equal(listPlaceAbroad('DE-NI-CELLE'), false, 'DE could be Delaware: the detail decides');
  assert.equal(listPlaceAbroad('LY-TRIPOLI-GIRGARESH'), true);
  assert.equal(listPlaceAbroad('6 Locations'), false);
  assert.equal(parseWorkdayTenant('hpinc'), null);
  assert.deepEqual(parseWorkdayTenant('kodiakgas.wd12/kodiakgas/kodiakgascareers'), { host: 'kodiakgas.wd12.myworkdayjobs.com', tenant: 'kodiakgas', site: 'kodiakgascareers' });
  assert.equal(parseWorkdayTenant('evil.com/x/y'), null);
});

// ── Oracle Recruiting Cloud ───────────────────────────────────────────────────────────────────────
const OR_HOST = 'fa-elpm-saasfaprod1.fa.ocs.oraclecloud.com';
const OR_TENANT = `${OR_HOST}/cx`;
const oracleRoutes = (u) => {
  if (u.hostname !== OR_HOST) return undefined;
  if (u.pathname === '/hcmRestApi/resources/latest/recruitingCEJobRequisitions') return fxJson('oraclecloud/list.json');
  if (u.pathname === '/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails') {
    const id = (u.searchParams.get('finder') || '').match(/Id="(\d+)"/)?.[1];
    return id ? fxJson(`oraclecloud/detail-${id}.json`) : undefined;
  }
  return undefined;
};

test('oraclecloud: no keyword, upper-case site; US requisitions only; secondary places become rows', async () => {
  const f = fakeFetch((u) => { try { return oracleRoutes(u); } catch { return undefined; } });
  const r = await fetchSourceJobs({ provider: 'oraclecloud', tenant: OR_TENANT, companyName: 'Patterson-UTI' }, { fetchImpl: f.impl });
  assert.equal(r.ok, true);
  const list = f.calls.find((c) => c.u.pathname.endsWith('recruitingCEJobRequisitions'));
  const finder = list.u.searchParams.get('finder');
  assert.equal(finder, 'findReqs;siteNumber=CX,limit=200,offset=0');
  assert.ok(!/keyword/i.test(list.u.search), 'an empty keyword answers 0 — never sent');
  const detailIds = f.calls.filter((c) => c.u.pathname.endsWith('Details')).map((c) => c.u.searchParams.get('finder'));
  assert.deepEqual(detailIds.sort(), ['ById;Id="5712",siteNumber=CX', 'ById;Id="6127",siteNumber=CX'], 'the Canadian requisition is never read');

  const cdl = r.rows.filter((x) => x.title === 'CDL A Truck Driver');
  assert.deepEqual(cdl.map((x) => x.location), ['Black Lick, PA, United States', 'Mill Hall, PA, United States']);
  assert.equal(cdl[0].lat, 40.47195, 'the detail\'s coordinates');
  assert.equal(cdl[0].apply_url, `https://${OR_HOST}/hcmUI/CandidateExperience/en/sites/CX/job/5712`);
  assert.equal(cdl[0].external_id, `oraclecloud:${OR_TENANT}:5712`);
  const floor = r.rows.find((x) => x.title === 'Floorhand - South and East Texas');
  assert.ok(floor, 'an entry rig job is read');
  const d = fxJson('oraclecloud/detail-6127.json').items[0];
  assert.equal(floor.description, cleanDescription(oracleRequisitionHtml(d)));
  assert.ok(floor.description.length > 3000);
  assert.ok(r.rows.every((x) => x.salary === null));
  assert.equal(r.total, 3);
});

test('oraclecloud: pages by TotalJobsCount (hasMore lies), and a hung board is bounded', async () => {
  const base = fxJson('oraclecloud/list.json');
  const req = base.items[0].requisitionList.find((x) => x.PrimaryLocationCountry === 'CA'); // copied; abroad → no details
  const offsets = [];
  const f = fakeFetch((u) => {
    if (u.hostname !== OR_HOST) return undefined;
    const offset = Number((u.searchParams.get('finder') || '').match(/offset=(\d+)/)?.[1]);
    offsets.push(offset);
    const n = offset === 0 ? 200 : offset === 200 ? 30 : 0;
    return { ...base, hasMore: false, items: [{ ...base.items[0], TotalJobsCount: 230, requisitionList: Array.from({ length: n }, (_, i) => ({ ...req, Id: String(offset + i + 1) })) }] };
  });
  const rows = await oraclecloud.fetchCompanyJobs(OR_TENANT, { fetchImpl: f.impl, companyName: 'X' });
  assert.deepEqual(offsets, [0, 200]);
  assert.equal(rows.boardTotal, 230);

  const t0 = Date.now();
  assert.deepEqual(await oraclecloud.fetchCompanyJobs(OR_TENANT, { fetchImpl: hang, timeoutMs: 200, budgetMs: 400 }), []);
  assert.ok(Date.now() - t0 < 1500);
  assert.deepEqual(parseOracleTenant('egay.fa.us6.oraclecloud.com/cx_2001'), { host: 'egay.fa.us6.oraclecloud.com', site: 'CX_2001' });
  assert.equal(parseOracleTenant('egay.fa.us6.oraclecloud.com.evil.com/cx'), null);
});

// ── UKG Pro Recruiting ────────────────────────────────────────────────────────────────────────────
const UKG_HOST = 'recruiting2.ultipro.com';
const UKG_TENANT = 'recruiting2.ultipro.com/cac1001cacc/a107cbd1-c097-4da7-a6f4-2a4ab021b86e';
const UKG_BOARD = '/CAC1001CACC/JobBoard/a107cbd1-c097-4da7-a6f4-2a4ab021b86e';
const ukgRoutes = (u) => {
  if (u.hostname !== UKG_HOST) return undefined;
  if (u.pathname === `${UKG_BOARD}/JobBoardView/LoadSearchResults`) return fxJson('ukg/list.json');
  if (u.pathname === `${UKG_BOARD}/OpportunityDetail`) {
    const id = u.searchParams.get('opportunityId') || '';
    try { return fx(`ukg/detail-${id.slice(0, 8)}.html`); } catch { return undefined; }
  }
  return undefined;
};

test('ukg: the board\'s own search body, upper-case company code, US opportunities only, whole posting', async () => {
  const f = fakeFetch(ukgRoutes);
  const r = await fetchSourceJobs({ provider: 'ukg', tenant: UKG_TENANT, companyName: 'Cactus' }, { fetchImpl: f.impl });
  assert.equal(r.ok, true);
  const search = f.calls.find((c) => c.method === 'POST');
  assert.equal(search.body.opportunitySearch.Top, 50);
  assert.equal(search.body.opportunitySearch.Skip, 0);
  assert.equal(search.body.opportunitySearch.QueryString, '');
  const details = f.calls.filter((c) => c.method === 'GET').map((c) => c.u.searchParams.get('opportunityId'));
  assert.equal(details.length, 2, 'the Vietnam opportunity is never opened');
  assert.deepEqual(r.rows.map((x) => x.title).sort(), ['Cactus Wellhead - Assembly Technician - North Dakota', 'Cactus Wellhead - Warehouse Clerk I- Night']);
  const clerk = r.rows.find((x) => /Warehouse Clerk/.test(x.title));
  assert.match(clerk.location, /^[A-Z][A-Za-z .]+, [A-Z]{2}$/);
  assert.equal(clerk.apply_url, `https://${UKG_HOST}${UKG_BOARD}/OpportunityDetail?opportunityId=7af8a65b-c4b7-4fd1-b837-0af8e977ffa2`);
  const d = ukgDetailFromPage(fx('ukg/detail-7af8a65b.html'));
  assert.ok(d && d.Description.length > 500);
  assert.equal(clerk.description, cleanDescription([d.Description, d.EqualOpportunityEmployerDescription].filter(Boolean).join('\n<br>\n')));
  assert.ok(r.rows.every((x) => x.salary === null), 'the board states no pay on these postings');
  assert.equal(clerk.external_id, 'ukg:cac1001cacc:7af8a65b-c4b7-4fd1-b837-0af8e977ffa2');
  assert.equal(r.total, 3);
});

test('ukg: pay only when the posting states it, in dollars; the range only when the page shows it', () => {
  const real = ukgDetailFromPage(fx('ukg/detail-7af8a65b.html'));
  assert.deepEqual(ukgPay(real, false), { salary: null, salaryMin: 0 }, 'the real posting states none');
  // copies of the real record with the pay fields a UKG board can fill
  const hourly = ukgPay({ ...real, Salaried: false, CompensationHourlyMinimum: 22, CompensationHourlyMaximum: 28, CompensationCurrencyCode: 'USD' }, false);
  assert.equal(hourly.salary, '$22–$28/hr');
  assert.ok(hourly.salaryMin > 40000);
  assert.equal(ukgPay({ ...real, CompensationAmount: { Value: 65000, Code: 'USD' }, Salaried: true }, false).salary, '$65k/yr');
  assert.equal(ukgPay({ ...real, Salaried: false, CompensationHourlyMinimum: 22, CompensationCurrencyCode: 'CAD' }, false).salary, null, 'not dollars → no pay');
  const range = { ...real, Salaried: false, PayRangeVisible: true, PayRange: { PayRangeMinimum: 20, PayRangeMaximum: 24 }, PayRangeCurrencyCode: 'USD' };
  assert.equal(ukgPay(range, false).salary, null, 'the page hides the range → so does Seen');
  assert.equal(ukgPay(range, true).salary, '$20–$24/hr');
});

test('ukg: paging stops at totalCount; a hung board is bounded', async () => {
  const base = fxJson('ukg/list.json');
  const viet = base.opportunities.find((o) => o.Title.startsWith('VN - ')); // copied; abroad → never opened
  const skips = [];
  const f = fakeFetch((u, init) => {
    if (u.hostname !== UKG_HOST || !u.pathname.endsWith('/LoadSearchResults')) return undefined;
    const { Skip } = JSON.parse(init.body).opportunitySearch;
    skips.push(Skip);
    const n = Skip < 100 ? 50 : Skip === 100 ? 10 : 50;
    return { totalCount: 110, opportunities: Array.from({ length: n }, (_, i) => ({ ...viet, Id: `00000000-0000-4000-8000-${String(Skip + i).padStart(12, '0')}` })) };
  });
  const rows = await ukg.fetchCompanyJobs(UKG_TENANT, { fetchImpl: f.impl, companyName: 'Cactus' });
  assert.deepEqual(skips, [0, 50, 100]);
  assert.equal(rows.boardTotal, 110);
  const t0 = Date.now();
  assert.deepEqual(await ukg.fetchCompanyJobs(UKG_TENANT, { fetchImpl: hang, timeoutMs: 200, budgetMs: 400 }), []);
  assert.ok(Date.now() - t0 < 1500);
  assert.equal(parseUkgTenant('recruiting2.ultipro.com/cac1001cacc/not-a-guid'), null);
  assert.equal(parseUkgTenant(UKG_TENANT).board, `https://${UKG_HOST}${UKG_BOARD}`);
});

// ── EmpForce ──────────────────────────────────────────────────────────────────────────────────────
const EF_HOST = 'na1.empforce.com';
const EF_TENANT = 'na1/71748094ccab2a75';
const efRoutes = (u) => {
  if (u.hostname !== EF_HOST) return undefined;
  if (u.pathname === '/Recruiting/Applicant/JobListings.aspx') return u.searchParams.get('Cd') === 'cXSAlMyrKnU=' ? fx('empforce/list.html') : '<html></html>';
  if (u.pathname === '/Recruiting/Applicant/Job.aspx') {
    const id = { 'pos/JE4n564=': '6252', 'khW+Dpjgf1Y=': '6195', 'Q6WkGQ/xLzY=': '6326' }[u.searchParams.get('Pd')];
    return id ? fx(`empforce/detail-${id}.html`) : undefined;
  }
  return undefined;
};

test('empforce: the case-sensitive board key survives the lower-cased registry; stated pay is kept as stated', async () => {
  const f = fakeFetch(efRoutes);
  const r = await fetchSourceJobs({ provider: 'empforce', tenant: EF_TENANT, companyName: 'Liberty Energy' }, { fetchImpl: f.impl });
  assert.equal(r.ok, true);
  assert.equal(f.calls[0].u.searchParams.get('Cd'), 'cXSAlMyrKnU=', 'hex tenant → the original base64 key');
  const op = r.rows.find((x) => x.title === 'Equipment Operator I');
  assert.ok(op, 'all-caps titles are re-cased');
  assert.equal(op.salary, '$20–$21/hr');
  assert.equal(op.location, 'Cheyenne, Wyoming, US');
  assert.equal(op.apply_url, 'https://na1.empforce.com/Recruiting/Applicant/Job.aspx?Pd=pos%2FJE4n564%3D&Cd=cXSAlMyrKnU%3D');
  assert.equal(op.description, cleanDescription(empforceDescriptionFromPage(fx('empforce/detail-6252.html'))));
  assert.ok(op.description.length > 1500);
  assert.match(op.description, /Benefits/, 'the Benefits block is part of the posting');
  const pm = r.rows.filter((x) => x.title === 'Project Manager');
  assert.deepEqual(pm.map((x) => x.location), ['Denver, Colorado, US', 'Houston, Texas, US', 'Pittsburgh, Pennsylvania, US'], 'AllLocations → one row per place');
  assert.equal(pm[0].salary, '$125k–$200k/yr');
  assert.equal(pm[0].external_id, 'empforce:na1/71748094ccab2a75:6195');
  assert.equal(pm[1].external_id, 'empforce:na1/71748094ccab2a75:6195#2');
});

test('empforce: a job placed abroad is not opened; hidden pay is not shown; a raw lower-cased key reads nothing', async () => {
  // a copy of the real list with one job moved abroad
  const page = fx('empforce/list.html').replace('Cheyenne, Wyoming, US', 'Calgary, Alberta, Canada');
  const f = fakeFetch((u) => (u.pathname.endsWith('JobListings.aspx') ? page : efRoutes(u)));
  const rows = await empforce.fetchCompanyJobs(EF_TENANT, { fetchImpl: f.impl, companyName: 'Liberty Energy' });
  assert.ok(!rows.some((x) => /Calgary/.test(x.location)));
  assert.ok(!f.calls.some((c) => c.u.searchParams.get('Pd') === 'pos/JE4n564='), 'the Calgary job\'s page is never read');
  assert.equal(rows.boardTotal, 3);

  const job = empforceJobsFromPage(fx('empforce/list.html'))[0];
  assert.equal(empforcePay(job).salary, '$20–$21/hr');
  assert.equal(empforcePay({ ...job, ShowCompensation: false }).salary, null);
  assert.equal(empforcePay({ ...job, isSalaryVisible: '0' }).salary, null);
  assert.equal(empforcePay({ ...job, MinimumSalary: 0, MaximumSalary: 0 }).salary, null);

  const g = fakeFetch(efRoutes);
  assert.deepEqual(await empforce.fetchCompanyJobs('na1/cxsalmyrknu=', { fetchImpl: g.impl }), [], 'why the tenant is hex');
  assert.equal(parseEmpforceTenant(EF_TENANT).cd, 'cXSAlMyrKnU=');
  const t0 = Date.now();
  assert.deepEqual(await empforce.fetchCompanyJobs(EF_TENANT, { fetchImpl: hang, timeoutMs: 200, budgetMs: 400 }), []);
  assert.ok(Date.now() - t0 < 1500);
});

// ── shared plumbing ───────────────────────────────────────────────────────────────────────────────
test('request(): a fetch that ignores its abort signal still ends at the timeout', async () => {
  const t0 = Date.now();
  assert.equal(await request('https://example.com/x', { fetchImpl: hang, timeoutMs: 100 }), null);
  assert.ok(Date.now() - t0 < 1000);
});

test('rowsForPlaces: no text → no row (never a made-up "Remote"); same town once; extras abroad dropped', () => {
  const build = (p) => ({ title: 'T', company: 'C', location: p.text, apply_url: 'https://x', description: 'd' });
  const opts = { provider: 'p', tenant: 't', externalId: 'p:t:1', applyUrl: 'https://x' };
  assert.deepEqual(rowsForPlaces([{ text: '' }], build, opts), []);
  const rows = rowsForPlaces([{ text: 'Kermit, TX' }, { text: 'kermit, tx' }, { text: 'London, United Kingdom' }, { text: 'Odessa, TX' }], build, opts);
  assert.deepEqual(rows.map((r) => [r.location, r.external_id]), [['Kermit, TX', 'p:t:1'], ['Odessa, TX', 'p:t:1#3']], 'numbered in the ATS\'s order, after the same-town merge');
});

test('tidyCaps only re-cases all-caps titles', () => {
  assert.equal(tidyCaps('EQUIPMENT OPERATOR I'), 'Equipment Operator I');
  assert.equal(tidyCaps('WTX - FLOORHAND I'), 'WTX - Floorhand I');
  assert.equal(tidyCaps('LPI CNG DRIVER'), 'LPI CNG Driver');
  assert.equal(tidyCaps('Expression of Interest - ALASKA ROUSTABOUT'), 'Expression of Interest - ALASKA ROUSTABOUT');
});

// ── detection, registry, seeds ────────────────────────────────────────────────────────────────────
test('detectAts captures the full tenant of each list + detail system (snowball registers a readable board)', () => {
  const cases = [
    ['https://hpinc.wd5.myworkdayjobs.com/en-US/hpinc/job/Odessa-TX-USA/US-Rig-Based-Positions_REQ-1', 'workday', 'hpinc.wd5/hpinc/hpinc'],
    ['https://kodiakgas.wd12.myworkdayjobs.com/KodiakGasCareers/job/TX---Encinal/Field-Service-Technician--Entry_JR3916', 'workday', 'kodiakgas.wd12/kodiakgas/kodiakgascareers'],
    ['https://fa-eyem-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/1001860', 'oraclecloud', 'fa-eyem-saasfaprod1.fa.ocs.oraclecloud.com/cx_1'],
    ['https://recruiting2.ultipro.com/ATL1007ATSC/JobBoard/6eb447b8-e4eb-4c77-8c5c-5c6dc1f7a616/OpportunityDetail?opportunityId=306e2f9e-2ef4-40e2-8ce3-bd5bd30dcdf6', 'ukg', 'recruiting2.ultipro.com/atl1007atsc/6eb447b8-e4eb-4c77-8c5c-5c6dc1f7a616'],
    ['https://na1.empforce.com/Recruiting/Applicant/Job.aspx?Pd=FbZKDMFN9SQ%3d&Cd=cXSAlMyrKnU%3d', 'empforce', 'na1/71748094ccab2a75'],
  ];
  for (const [url, provider, tenant] of cases) {
    const hit = detectAts(url);
    assert.ok(hit, url);
    assert.equal(hit.provider, provider, url);
    assert.equal(hit.tenant, tenant, url);
    assert.equal(hit.ingestable, true, url);
    // the tenant the detector registers is one the provider can read
    const parse = { workday: parseWorkdayTenant, oraclecloud: parseOracleTenant, ukg: parseUkgTenant, empforce: parseEmpforceTenant }[provider];
    assert.ok(parse(hit.tenant), `${provider} reads ${hit.tenant}`);
  }
  // partial URLs keep the old, not-ingestable record; spoofed hosts are never detected
  assert.deepEqual([detectAts('https://acme.oraclecloud.com/careers').ingestable, detectAts('https://acme.oraclecloud.com/careers').tenant], [false, 'acme']);
  assert.equal(detectAts('https://fa-x.fa.ocs.oraclecloud.com.evil.com/hcmUI/CandidateExperience/en/sites/CX/job/1'), null);
  assert.equal(detectAts('https://recruiting2.ultipro.com.evil.com/ABC/JobBoard/6eb447b8-e4eb-4c77-8c5c-5c6dc1f7a616'), null);
  assert.equal(detectAts('https://evil.com/na1.empforce.com/Recruiting/x?Cd=cXSAlMyrKnU%3d'), null);
  assert.equal(detectAts('https://recruiting2.ultipro.com/ABC/Other/6eb447b8-e4eb-4c77-8c5c-5c6dc1f7a616'), null);
  // a literal "+" in a base64 key (URLSearchParams reads it as a space) is kept
  assert.equal(detectAts('https://na1.empforce.com/Recruiting/Applicant/JobListings.aspx?Cd=ab+/').tenant, `na1/${empforceKeyHex('ab+/')}`);
  assert.equal(empforceKeyHex('not base64!'), null);
});

test('the four providers are registered, ingestable, and every oilfield seed parses', () => {
  for (const id of ['workday', 'oraclecloud', 'ukg', 'empforce']) {
    assert.ok(PROVIDERS[id] && INGESTABLE_PROVIDER_IDS.includes(id) && INGESTABLE_PROVIDERS.has(id), id);
  }
  const parse = { workday: parseWorkdayTenant, oraclecloud: parseOracleTenant, ukg: parseUkgTenant, empforce: parseEmpforceTenant };
  const oil = SEED_SOURCES.filter((s) => parse[s.provider]);
  assert.equal(oil.length, 15);
  for (const s of oil) {
    assert.equal(s.tenant, s.tenant.toLowerCase(), `${s.companyName}: the registry lowercases tenants`);
    assert.ok(parse[s.provider](s.tenant), `${s.companyName}: ${s.tenant}`);
  }
  assert.equal(new Set(SEED_SOURCES.map((s) => `${s.provider}|${s.tenant}`)).size, SEED_SOURCES.length, 'no duplicate seeds');
});

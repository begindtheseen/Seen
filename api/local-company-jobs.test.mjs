// api/local-company-jobs.js + api/ingest-local-career-jobs.js. Run: node --test api/local-company-jobs.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import companyJobs from './local-company-jobs.js';
import careerIngest from './ingest-local-career-jobs.js';

process.env.LOCAL_INDEED_INGEST_SECRET = 'local';
process.env.SUPABASE_URL = 'https://db.test';
process.env.SUPABASE_SERVICE_KEY = 'svc';

const call = (h, req) => new Promise((resolve) => {
  const res = { code: 0, status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b }); } };
  h({ method: 'POST', headers: { authorization: 'Bearer local' }, ...req }, res);
});

test('company pull: auth and input limits', async () => {
  assert.equal((await call(companyJobs, { headers: {} , body: { companies: ['Tesla'] } })).code, 401);
  assert.equal((await call(companyJobs, { body: { companies: [] } })).code, 400);
  assert.equal((await call(companyJobs, { body: { companies: Array.from({ length: 11 }, (_, i) => `C${i}`) } })).code, 400);
  assert.equal((await call(companyJobs, { body: { companies: ['Tesla'], site_limit: 151 } })).code, 400);
  assert.equal((await call(companyJobs, { method: 'GET' })).code, 405);
});

const posting = (over = {}) => ({ '@type': 'JobPosting', title: 'Service Technician', hiringOrganization: { name: 'Tesla' }, description: 'Diagnose and repair vehicles, talk to customers, and keep the service bay safe and organised every day.', jobLocation: { address: { addressLocality: 'Fremont', addressRegion: 'CA', addressCountry: 'US' } }, identifier: { value: '1' }, ...over });

test('browser-read postings get the same checks as a server-read career site', async () => {
  const posted = [];
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('/rest/v1/companies')) return { ok: true, status: 200, async json() { return [{ id: 'c1', name: 'Tesla' }]; } };
    if (u.includes('/rest/v1/jobs')) { const rows = JSON.parse(opts.body); posted.push(...rows); return { ok: true, status: 201, async json() { return rows.map((r, i) => ({ id: `j${i}`, ...r })); } }; }
    throw new Error(`unexpected ${u}`);
  };
  const r = await call(careerIngest, { body: { company: 'Tesla', items: [
    { page_url: 'https://www.tesla.com/careers/search/job/1', posting: posting() },
    { page_url: 'https://www.tesla.com/careers/search/job/2', posting: posting({ hiringOrganization: { name: 'Rivian' } }) },
    { page_url: 'https://www.tesla.com/careers/search/job/3', posting: posting({ jobLocation: { address: { addressLocality: 'Berlin', addressCountry: 'DE' } } }) },
    { page_url: 'http://www.tesla.com/careers/search/job/4', posting: posting() },
  ] } });
  assert.equal(r.code, 200);
  assert.equal(r.body.saved, 1);
  assert.deepEqual(r.body.skipped, { other_employer: 1, outside_market: 1, invalid: 1 });
  assert.equal(posted[0].source, 'Company site (browser)');
  assert.equal(posted[0].source_type, 'EMPLOYER_SITE');
  assert.equal((await call(careerIngest, { body: { company: 'Tesla', items: [] } })).code, 400);
  assert.equal((await call(careerIngest, { headers: {}, body: {} })).code, 401);
});

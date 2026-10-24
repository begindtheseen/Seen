// GET /api/local-company-intel-targets?below=K&order=search_demand: searched companies first, default order
// unchanged without the flag or without search data. Stubbed PostgREST. Run:
// node --test api/local-company-intel-targets.searchDemand.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.LOCAL_COMPANY_INTEL_INGEST_SECRET = 's';
const { default: handler, orderBySearchDemand } = await import('./local-company-intel-targets.js');

const uid = (i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const ok = (b) => ({ ok: true, status: 200, async json() { return b; }, async text() { return JSON.stringify(b); } });
const missing = () => ({ ok: false, status: 404, async json() { return {}; }, async text() { return '{"code":"PGRST205"}'; } });

function install({ search = true } = {}) {
  // Listings: Acme 30, Brex 20, Chipotle 5. Scores: Chipotle 2 reports; Dollar General 1 report, NO open listings.
  const jobs = [...Array(30).fill('Acme Corp'), ...Array(20).fill('Brex Inc'), ...Array(5).fill('Chipotle')].map((company, i) => ({ id: uid(i + 1), company }));
  const scores = [
    { company_name: 'chipotle', report_count: 2, first_party_report_count: 2, data_source: 'reports', mention_count: 0 },
    { company_name: 'dollar general', report_count: 1, first_party_report_count: 1, data_source: 'reports', mention_count: 0 },
  ];
  const day = '2026-10-20';
  const rows = [
    { id: 1, date: day, source: 'google', query: 'dollar general application status', page: 'https://seenjobs.io/company/dollar-general', clicks: 1, impressions: 300, position: 9 },
    { id: 2, date: day, source: 'google', query: 'chipotle interview questions', page: 'https://seenjobs.io/company/chipotle', clicks: 0, impressions: 50, position: 12 },
  ];
  global.fetch = async (url) => {
    const u = new URL(String(url));
    if (u.pathname.endsWith('/search_daily')) return search ? ok(Number((u.searchParams.get('id') || 'gt.0').slice(3)) ? [] : rows) : missing();
    if (u.searchParams.get('select') === 'mention_count' || u.searchParams.get('select') === 'employee_review_count') return ok([]);
    if (u.pathname.endsWith('/jobs')) { const after = (u.searchParams.get('id') || '').replace('gt.', ''); return ok(jobs.filter((j) => !after || j.id > after).slice(0, 1000)); }
    if (u.pathname.endsWith('/company_scores')) return ok(Number(u.searchParams.get('offset') || 0) ? [] : scores);
    return ok([]);
  };
}
async function call(query, opts) {
  install(opts);
  const r = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await handler({ method: 'GET', headers: { authorization: 'Bearer s' }, query }, r);
  return r;
}

test('default order is unchanged (no flag): most listings first, no search fields', async () => {
  const r = await call({ below: '10', limit: '10' });
  assert.deepEqual(r.body.companies.map((c) => c.company), ['Chipotle', 'Acme Corp', 'Brex Inc'], 'footprint first, then listings — as before');
  assert.equal(r.body.order, undefined);
  assert.ok(r.body.companies.every((c) => !('search_demand' in c)));
});

test('order=search_demand: searched companies first by impressions; a searched company with no listings joins', async () => {
  const r = await call({ below: '10', limit: '10', order: 'search_demand' });
  assert.equal(r.code, 200);
  assert.equal(r.body.order, 'search_demand');
  assert.equal(r.body.search_data_ready, true);
  assert.deepEqual(r.body.companies.map((c) => c.company), ['dollar general', 'Chipotle', 'Acme Corp', 'Brex Inc']);
  assert.deepEqual(r.body.companies[0].search_demand, { impressions: 300, clicks: 1, intents: ['application_status'] });
  assert.equal(r.body.below_count, 4);
});

test('order=search_demand before the migration / with no data: default order, ready false', async () => {
  const r = await call({ below: '10', limit: '10', order: 'search_demand' }, { search: false });
  assert.equal(r.body.search_data_ready, false);
  assert.deepEqual(r.body.companies.map((c) => c.company), ['Chipotle', 'Acme Corp', 'Brex Inc']);
});

test('orderBySearchDemand: unknown and over-the-bar companies never join; no duplicates', () => {
  const all = [{ company: 'A', applicant_reports: 0 }, { company: 'B', applicant_reports: 50 }, { company: 'C', applicant_reports: 1 }];
  const queue = [all[0]];
  const demand = [{ company: 'Zed', known: false, impressions: 999 }, { company: 'B', known: true, impressions: 500 }, { company: 'C', known: true, impressions: 10 }, { company: 'A', known: true, impressions: 5 }, { company: 'A', known: true, impressions: 4 }];
  assert.deepEqual(orderBySearchDemand(queue, all, demand, 10).map((c) => c.company), ['C', 'A']);
  assert.deepEqual(orderBySearchDemand(queue, all, demand, null).map((c) => c.company), ['A'], 'without below, only queued companies are reordered');
});

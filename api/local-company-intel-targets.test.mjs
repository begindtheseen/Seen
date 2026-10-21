// Company catalog for Seen Command (GET /api/local-company-intel-targets?catalog=1) against stubbed
// PostgREST. Run: node --test api/local-company-intel-targets.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'k';
process.env.LOCAL_COMPANY_INTEL_INGEST_SECRET = 's';
const { default: handler } = await import('./local-company-intel-targets.js');

const uid = (i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const ok = (b) => ({ ok: true, status: 200, async json() { return b; } });

// 2,500 SpaceX listings (spans three keyset pages), 1 Acme listing, and scores for SpaceX (lowercase,
// as company_scores stores names), Acme, and a company with reports but no open listings.
function install({ jobsFail = false, extraJobs = [] } = {}) {
  const jobs = [...Array.from({ length: 2500 }, (_, i) => ({ id: uid(i + 1), company: 'SpaceX' })), { id: uid(9999), company: 'Acme Corp' }, ...extraJobs];
  const scores = [
    { company_name: 'spacex', report_count: 16, first_party_report_count: 11, data_source: 'reports', mention_count: 20, employee_review_count: 45 },
    { company_name: 'acme corp', report_count: 40, first_party_report_count: 0, data_source: 'web_search', mention_count: 2, employee_review_count: 0 },
    { company_name: 'Gone Inc', report_count: 6, first_party_report_count: 6, data_source: 'reports', mention_count: 0, employee_review_count: 0 },
  ];
  const calls = [];
  global.fetch = async (url) => {
    const u = decodeURIComponent(String(url)); calls.push(u);
    const q = new URL(String(url)).searchParams;
    if (u.includes('/company_scores?select=mention_count&limit=1') || u.includes('/company_scores?select=employee_review_count&limit=1')) return ok([]);
    if (u.includes('/rest/v1/jobs?')) {
      if (jobsFail) return { ok: false, status: 500, async json() { return {}; } };
      const after = (q.get('id') || '').replace('gt.', '');
      return ok(jobs.filter((j) => !after || j.id > after).slice(0, 1000));
    }
    if (u.includes('/rest/v1/company_scores?')) return ok(scores.slice(Number(q.get('offset') || 0), Number(q.get('offset') || 0) + 1000));
    return ok([]);
  };
  return calls;
}
async function call(query, opts) {
  const calls = install(opts);
  const r = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await handler({ method: 'GET', headers: { authorization: 'Bearer s' }, query }, r);
  return { r, calls };
}

test('catalog: every company, with listings AND report counts merged (first-party, not the fused web claim)', async () => {
  const { r, calls } = await call({ catalog: '1' });
  assert.equal(r.code, 200);
  assert.equal(r.body.total, 3);
  const by = Object.fromEntries(r.body.companies.map((c) => [c.company, c]));
  assert.deepEqual(Object.keys(by), ['SpaceX', 'Acme Corp', 'Gone Inc'], 'display names kept; most open jobs first');
  assert.equal(by.SpaceX.active_listings, 2500, 'read past the 1,000-row page cap');
  assert.equal(by.SpaceX.applicant_reports, 11, 'companies WITH listings get their report count too');
  assert.equal(by.SpaceX.employee_reviews, 45);
  assert.equal(by.SpaceX.mentions, 20);
  assert.equal(by.SpaceX.graded, true);
  assert.equal(by['Acme Corp'].applicant_reports, 0, 'a web-research claim is never counted as applicant reports');
  assert.equal(by['Acme Corp'].graded, false);
  assert.ok(by['Acme Corp'].reports_needed > 0);
  assert.equal(by['Gone Inc'].active_listings, 0);
  assert.ok(calls.filter((u) => u.includes('/rest/v1/jobs?')).length >= 3, 'keyset paging');
});

test('default mode is the collector’s top-N by open listings; a failed read refuses instead of showing zeros', async () => {
  const { r } = await call({ limit: '1' });
  assert.deepEqual(r.body.companies.map((c) => c.company), ['SpaceX']);
  assert.equal(r.body.companies[0].existing_reports, 11);
  const bad = await call({ catalog: '1' }, { jobsFail: true });
  assert.equal(bad.r.code, 502);
  const unauth = { code: 0, status(c) { this.code = c; return this; }, json() { return this; } };
  await handler({ method: 'GET', headers: { authorization: 'Bearer nope' }, query: {} }, unauth);
  assert.equal(unauth.code, 401);
});

test('below=K: only companies with open listings and fewer than K applicant reports, most listings first', async () => {
  const { r } = await call({ limit: '10', below: '10' });
  assert.deepEqual(r.body.companies.map((c) => c.company), ['Acme Corp'], 'SpaceX has 11; Gone Inc has no open listings');
  assert.equal(r.body.below, 10);
  assert.equal(r.body.below_count, 1);
  const all = await call({ limit: '10', below: '12' });
  assert.deepEqual(all.r.body.companies.map((c) => c.company), ['SpaceX', 'Acme Corp']);
  const ignored = await call({ limit: '10', below: 'x' });
  assert.equal(ignored.r.body.below, undefined, 'an invalid value is ignored, not guessed');
});

test('below=K: companies with a public footprint (a report or a mention) come before bigger ones without; the queue goes past 100', async () => {
  // 3 Verkada listings beat Acme's 1 on listings alone, but Acme already has an online mention.
  const extraJobs = [...[1, 2, 3].map((i) => ({ id: uid(20000 + i), company: 'Verkada' })),
    ...Array.from({ length: 150 }, (_, i) => ({ id: uid(30000 + i), company: `Shop ${String(i).padStart(3, '0')} Co` }))];
  const { r } = await call({ limit: '1000', below: '10' }, { extraJobs });
  const names = r.body.companies.map((c) => c.company);
  assert.equal(names[0], 'Acme Corp');
  assert.ok(names.indexOf('Verkada') > 0);
  assert.equal(names.length, 152, 'not capped at 100 in the fill queue');
  const plain = await call({ limit: '1000' }, { extraJobs });
  assert.equal(plain.r.body.companies.length, 100, 'the default list keeps its 100 cap');
});

test('targets: a capitalized board slug is never handed out; the catalog still lists it', async () => {
  const extraJobs = [{ id: uid(10001), company: 'Andurilindustries' }, { id: uid(10002), company: 'Walmart' }];
  const { r } = await call({ limit: '25', below: '10' }, { extraJobs });
  const names = r.body.companies.map((c) => c.company);
  assert.ok(!names.includes('Andurilindustries'), names.join(', '));
  assert.ok(names.includes('Walmart'));
  const cat = await call({ catalog: '1' }, { extraJobs });
  assert.ok(cat.r.body.companies.some((c) => c.company === 'Andurilindustries'));
});

// Contract tests for /api/job-insights: nothing is charged silently.
//   • a shared-cache HIT is free and says so (cost 0, charged false, _src 'db')
//   • { probe: true } never gates, never generates, never charges — it answers with the price
//   • a real cache MISS goes through gateAI and reports cost/charged/balance
//   • a signed-out MISS is refused with credits_required (no generation)
// Run: node --test api/job-insights.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://db.example';
process.env.SUPABASE_SERVICE_KEY = 'service-key';
delete process.env.SUPABASE_JWT_SECRET; // gateAI resolves identity via /auth/v1/user

const UID = 'a1b2c3d4-e5f6-4a7b-8c9d-0123456789ab';
const DESC = 'We are hiring a Customer Support Specialist. Required: strong customer service and communication skills. You will answer tickets, resolve billing questions and document every contact in the CRM. Point of sale experience preferred.';

function mockResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, async json() { return body; }, async text() { return JSON.stringify(body); } };
}

// A fake PostgREST + auth. `cachedRow` = the job_insights row a read returns (null = miss).
function installFetch({ cachedRow = null, balance = 5 } = {}) {
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = new URL(String(url));
    calls.push({ path: u.pathname, method: opts.method || 'GET', body: opts.body });
    if (u.pathname === '/auth/v1/user') return mockResponse({ id: UID });
    if (u.pathname === '/rest/v1/feature_flags') return mockResponse([{ status: 'on' }]);
    if (u.pathname === '/rest/v1/rpc/consume_credit') return mockResponse([{ status: 'ok', balance: balance - 1, pro: false }]);
    if (u.pathname === '/rest/v1/job_insights' && (opts.method || 'GET') === 'GET') return mockResponse(cachedRow ? [cachedRow] : []);
    return mockResponse(null, { status: 201 });
  };
  return calls;
}

const { default: handler } = await import('./job-insights.js');

function mockRes() {
  return { code: 200, headers: {}, body: null, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(o) { this.body = o; return this; }, end(b) { this.body = b; return this; } };
}
async function call(body, { auth = true } = {}) {
  const res = mockRes();
  const headers = { origin: 'https://seenjobs.io', ...(auth ? { authorization: 'Bearer tok' } : {}) };
  await handler({ method: 'POST', headers, socket: { remoteAddress: '10.0.0.' + Math.floor(Math.random() * 250) }, body }, res);
  return res;
}

test('cache hit is free and labelled so — no gate, no charge', async () => {
  const calls = installFetch({ cachedRow: { what_they_want: ['x'], hidden_requirements: [], insider_tip: 'tip', description_summary: 'sum' } });
  const res = await call({ jobId: 'j1', job: 'Specialist', company: 'Acme', jobDescription: DESC, needsSummary: true });
  assert.equal(res.code, 200);
  assert.equal(res.body._src, 'db');
  assert.equal(res.body.cost, 0);
  assert.equal(res.body.charged, false);
  assert.ok(!calls.some(c => c.path.includes('consume_credit')), 'a cache hit must never touch credits');
});

test('probe on a miss answers the price without gating, generating or charging', async () => {
  const calls = installFetch();
  const res = await call({ jobId: 'j2', job: 'Specialist', company: 'Acme', jobDescription: DESC, probe: true }, { auth: false });
  assert.equal(res.code, 200);
  assert.deepEqual({ cached: res.body.cached, price: res.body.price, _src: res.body._src, cost: res.body.cost, charged: res.body.charged },
    { cached: false, price: 1, _src: 'uncached', cost: 0, charged: false });
  assert.ok(!calls.some(c => c.path.includes('consume_credit') || c.path === '/auth/v1/user'), 'probe must not gate');
  assert.ok(!calls.some(c => c.path === '/rest/v1/job_insights' && c.method === 'POST'), 'probe must not write');
});

test('probe on a hit returns the cached insight for free', async () => {
  installFetch({ cachedRow: { what_they_want: ['y'], hidden_requirements: [], insider_tip: '', description_summary: '' } });
  const res = await call({ jobId: 'j3', job: 'Specialist', company: 'Acme', jobDescription: DESC, probe: true }, { auth: false });
  assert.equal(res.body._src, 'db');
  assert.deepEqual(res.body.what_they_want, ['y']);
});

test('a real miss charges exactly one credit and reports it', async () => {
  const calls = installFetch({ balance: 5 });
  const res = await call({ jobId: 'j4', job: 'Customer Support Specialist', company: 'Acme', jobDescription: DESC, needsSummary: true });
  assert.equal(res.code, 200, JSON.stringify(res.body));
  assert.equal(res.body._src, 'generated');
  assert.equal(res.body.cost, 1);
  assert.equal(res.body.charged, true);
  assert.equal(res.body.balance, 4);
  assert.equal(calls.filter(c => c.path.includes('consume_credit')).length, 1);
});

test('a signed-out miss is refused with credits_required and nothing is generated', async () => {
  installFetch();
  const res = await call({ jobId: 'j5', job: 'Specialist', company: 'Acme', jobDescription: DESC }, { auth: false });
  assert.equal(res.code, 401);
  assert.equal(res.body.credits_required, true);
  assert.equal(res.body.charged, false);
});

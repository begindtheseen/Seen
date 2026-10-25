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

const { default: handler, insightsCacheKey, hashText } = await import('./job-insights.js');
const { JOB_INSIGHTS_VERSION } = await import('../lib/jobInsightsVersion.js');

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
  const calls = installFetch({ cachedRow: { job_id: insightsCacheKey('j1', DESC), what_they_want: ['x'], hidden_requirements: [], insider_tip: 'tip', description_summary: 'sum' } });
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
  installFetch({ cachedRow: { job_id: insightsCacheKey('j3', DESC), what_they_want: ['y'], hidden_requirements: [], insider_tip: '', description_summary: '' } });
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

// A stateful job_insights table: POST upserts by job_id, GET answers `job_id=eq.…`.
function installTable({ balance = 5 } = {}) {
  const rows = new Map();
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = new URL(String(url));
    const method = opts.method || 'GET';
    calls.push({ path: u.pathname, method, body: opts.body });
    if (u.pathname === '/auth/v1/user') return mockResponse({ id: UID });
    if (u.pathname === '/rest/v1/feature_flags') return mockResponse([{ status: 'on' }]);
    if (u.pathname === '/rest/v1/rpc/consume_credit') return mockResponse([{ status: 'ok', balance: balance - 1, pro: false }]);
    if (u.pathname === '/rest/v1/job_insights' && method === 'POST') { const r = JSON.parse(opts.body); rows.set(r.job_id, r); return mockResponse(null, { status: 201 }); }
    if (u.pathname === '/rest/v1/job_insights') {
      const keys = (u.searchParams.get('job_id') || '').replace(/^in\.\(|\)$/g, '').replace(/^eq\./, '').split(',').map(k => k.replace(/^"|"$/g, ''));
      return mockResponse(keys.map(k => rows.get(k)).filter(Boolean));
    }
    return mockResponse(null, { status: 201 });
  };
  return { rows, calls };
}

test('a paid insight is a FREE cached hit for the next visitor\'s probe (shared cache keyed by job + posting text)', async () => {
  const { rows, calls } = installTable();
  // Visitor A pays (no needsSummary flag — the shared row is still built complete).
  const a = await call({ jobId: 'j9', job: 'Customer Support Specialist', company: 'Acme', jobDescription: DESC });
  assert.equal(a.body._src, 'generated');
  assert.equal(a.body.charged, true);
  const [key] = [...rows.keys()];
  assert.equal(key, `j9:${JOB_INSIGHTS_VERSION}:${hashText(DESC)}`, 'the row is keyed by the job, the generator version and a hash of its description');
  assert.match(key, /^j9:v\d+:[0-9a-f]{16}$/);
  assert.ok(typeof rows.get(key).description_summary === 'string');
  const writeIdx = calls.findIndex(c => c.method === 'POST' && c.path === '/rest/v1/job_insights');
  assert.ok(writeIdx >= 0, 'the shared row is written before the paying response returns');
  // Visitor B, signed out, probes the same posting (whitespace differs): free hit, cached:true.
  const before = calls.filter(c => c.path.includes('consume_credit')).length;
  const b = await call({ jobId: 'j9', job: 'Customer Support Specialist', company: 'Acme', jobDescription: DESC.replace(/ /g, '  '), needsSummary: true, probe: true }, { auth: false });
  assert.equal(b.body.cached, true);
  assert.equal(b.body._src, 'db');
  assert.equal(b.body.charged, false);
  assert.deepEqual(b.body.what_they_want, a.body.what_they_want);
  assert.equal(calls.filter(c => c.path.includes('consume_credit')).length, before, 'no credit touched');
  // An edited posting is not served the old insight.
  const c = await call({ jobId: 'j9', job: 'Customer Support Specialist', company: 'Acme', jobDescription: DESC + ' Night shift differential applies to every hour worked.', probe: true }, { auth: false });
  assert.equal(c.body.cached, false);
});

test('rows written before the current generator version are never served — they regenerate on the next view', async () => {
  // The 2026-10-25 willingness-to-pay test found bad answers cached for 7 days ("Java, C++, Machine
  // Learning, 12+ years experience" for a Stripe "Go, Java, C/C++ etc. · 2–12+ years" posting).
  // A bare-id row (pre-2026-10-24) and a `${jobId}:${hash}` row (v2) are both ignored.
  const { rows } = installTable();
  const bad = { what_they_want: ['Java', 'C++', 'Machine Learning', '12+ years experience'], hidden_requirements: [], insider_tip: '', description_summary: 'sum', expires_at: '2999-01-01' };
  rows.set('j10', { ...bad, job_id: 'j10' });
  rows.set(`j10:${hashText(DESC)}`, { ...bad, job_id: `j10:${hashText(DESC)}` });
  const r = await call({ jobId: 'j10', job: 'Specialist', company: 'Acme', jobDescription: DESC, needsSummary: true, probe: true }, { auth: false });
  assert.equal(r.body.cached, false, 'an old-version row is not passed off as current');
  assert.equal(r.body._src, 'uncached');
  // a paid regeneration writes the current-version row, and that one is served from then on
  const paid = await call({ jobId: 'j10', job: 'Specialist', company: 'Acme', jobDescription: DESC, needsSummary: true });
  assert.equal(paid.body._src, 'generated');
  assert.ok(rows.has(insightsCacheKey('j10', DESC)));
  assert.ok(!paid.body.what_they_want.includes('Machine Learning'));
  const again = await call({ jobId: 'j10', job: 'Specialist', company: 'Acme', jobDescription: DESC, needsSummary: true, probe: true }, { auth: false });
  assert.equal(again.body.cached, true);
});

test('prod has no description_summary column: the write retries without it and a hit rebuilds the summary free', async () => {
  const rows = new Map();
  const writes = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = new URL(String(url));
    const method = opts.method || 'GET';
    if (u.pathname === '/auth/v1/user') return mockResponse({ id: UID });
    if (u.pathname === '/rest/v1/feature_flags') return mockResponse([{ status: 'on' }]);
    if (u.pathname === '/rest/v1/rpc/consume_credit') return mockResponse([{ status: 'ok', balance: 4, pro: false }]);
    if (u.pathname === '/rest/v1/job_insights' && method === 'POST') {
      const r = JSON.parse(opts.body); writes.push(Object.keys(r));
      if ('description_summary' in r) return mockResponse({ message: "Could not find the 'description_summary' column" }, { ok: false, status: 400 });
      rows.set(r.job_id, r); return mockResponse(null, { status: 201 });
    }
    if (u.pathname === '/rest/v1/job_insights') {
      const keys = (u.searchParams.get('job_id') || '').replace(/^in\.\(|\)$/g, '').replace(/^eq\./, '').split(',').map(k => k.replace(/^"|"$/g, ''));
      return mockResponse(keys.map(k => rows.get(k)).filter(Boolean));
    }
    return mockResponse(null, { status: 201 });
  };
  const a = await call({ jobId: 'j12', job: 'Customer Support Specialist', company: 'Acme', jobDescription: DESC, needsSummary: true });
  assert.equal(a.body.charged, true);
  assert.equal(writes.length, 2, 'one rejected write, one retry');
  assert.equal(rows.size, 1, 'the row landed without the missing column');
  const b = await call({ jobId: 'j12', job: 'Customer Support Specialist', company: 'Acme', jobDescription: DESC, needsSummary: true, probe: true }, { auth: false });
  assert.equal(b.body.cached, true);
  assert.equal(b.body.description_summary, a.body.description_summary, 'the deterministic summary is rebuilt, not lost');
});

// A posting that states nothing to read is answered free and NEVER written to the shared cache —
// Groupon's "Relevant experience" filler was charged and cached "free for everyone for 7 days"
// (paid-tool test, 2026-10-25). A cached row holding no read is never served either.
const CAR_WASH = 'Join the Sunbelt Express Car Wash family! We are a locally owned express car wash with 6 locations around Charlotte, and we are growing. Weekly pay, free unlimited wash membership, paid training and a fun, friendly team. Starting pay is $14 – $16 per hour. Apply today!';
test('a posting with nothing to read: free, read:false, never gated, never cached', async () => {
  for (const probe of [true, false]) {
    const calls = installFetch();
    const res = await call({ jobId: 'cw1', job: 'Team Member', company: 'Sunbelt', jobDescription: CAR_WASH, needsSummary: true, probe });
    assert.equal(res.code, 200);
    assert.equal(res.body._src, 'unread');
    assert.equal(res.body.charged, false);
    assert.deepEqual(res.body.what_they_want, []);
    assert.ok(!calls.some(c => c.path.includes('consume_credit')), 'never charged');
    assert.ok(!calls.some(c => c.path === '/rest/v1/job_insights' && c.method === 'POST'), 'never cached');
  }
  const stale = installFetch({ cachedRow: { job_id: insightsCacheKey('cw2', DESC), what_they_want: [], hidden_requirements: [], insider_tip: '' } });
  const res = await call({ jobId: 'cw2', job: 'Specialist', company: 'Acme', jobDescription: DESC, needsSummary: true, probe: true });
  assert.notEqual(res.body._src, 'db', 'an empty cached row is not served as a read');
  void stale;
});

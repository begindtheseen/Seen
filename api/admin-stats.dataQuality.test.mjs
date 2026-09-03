// Contract test for `data_quality` on the GET stats payload.
//
// The bug this pins: `db()` does not throw, and callers reduce a response to a number with `ct()`
// (`parseInt(headers['content-range'].split('/')[1]) || 0`) or `parseInt(rows[0].count) || 0`. So a
// 4xx, a 5xx, or a transport failure silently becomes a clean ZERO that looks exactly like a real
// count of nothing. On 2026-08-12 this endpoint reported active_jobs = 0 while the jobs table held
// tens of thousands of rows, and the exec brain recorded that 0 as a durable fact over the real value.
//
// The counts still degrade to 0 — changing that would ripple through every consumer — but the payload
// now SAYS SO, so nobody records or displays a fabricated number as a measurement.

import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-service-key';

const { default: handler } = await import('./admin-stats.js');

const okRes = (body, headers = {}) => ({
  ok: true, status: 200,
  async json() { return body; },
  async text() { return JSON.stringify(body); },
  headers: { get: (k) => headers[String(k).toLowerCase()] ?? null },
});
const failRes = (status) => ({
  ok: false, status,
  async json() { return null; },
  async text() { return 'error'; },
  headers: { get: () => null },
});

// A GET request carrying a valid admin session.
function reqRes() {
  const req = { method: 'GET', headers: { 'x-admin-token': 'tok' }, body: null, query: {} };
  const out = {};
  const res = {
    status(code) { out.code = code; return this; },
    json(payload) { out.payload = payload; return this; },
    setHeader() { return this; },
    end() { return this; },
  };
  return { req, res, out };
}

const session = [{ expires_at: new Date(Date.now() + 3600e3).toISOString(), role: 'super_admin', admin_id: 'a1' }];

test('a healthy payload reports data_quality.degraded = false', async () => {
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/admin_sessions?token=eq')) return okRes(session);
    // Counts arrive via the content-range header; everything else is an empty list.
    return okRes([], { 'content-range': '0-0/7' });
  };
  const { req, res, out } = reqRes();
  await handler(req, res);
  assert.equal(out.code, 200);
  assert.equal(out.payload.data_quality.degraded, false);
  assert.equal(out.payload.data_quality.failed_query_count, 0);
});

test('active and total job counts use exact HEAD metadata, never the timed-out select=count path', async () => {
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    calls.push({ url: u, opts });
    if (u.includes('/admin_sessions?token=eq')) return okRes(session);
    if (u.includes('/jobs?availability_status=eq.active&select=id')) {
      return okRes([], { 'content-range': '0-0/71372' });
    }
    if (u.endsWith('/jobs?select=id')) return okRes([], { 'content-range': '0-0/72086' });
    return okRes([], { 'content-range': '0-0/7' });
  };

  const { req, res, out } = reqRes();
  await handler(req, res);

  assert.equal(out.code, 200);
  assert.equal(out.payload.jobs.active, 71372);
  assert.equal(out.payload.jobs.total, 72086);
  assert.equal(out.payload.job_health.crisis, false);
  assert.equal(out.payload.data_quality.degraded, false);

  const jobCountCalls = calls.filter((c) => c.url.includes('/jobs?') && c.opts?.method === 'HEAD');
  assert.equal(jobCountCalls.length, 2, 'active and total are the only dedicated jobs count calls');
  for (const call of jobCountCalls) {
    assert.equal(call.opts.headers.Prefer, 'count=exact');
    assert.ok(!call.url.includes('select=count'), `legacy timeout path must be gone: ${call.url}`);
  }
  assert.ok(!calls.some((c) => c.url.includes('select=count')), 'no dashboard query uses select=count');
});

test('a failed query is reported instead of passing off its 0 as a measurement', async () => {
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/admin_sessions?token=eq')) return okRes(session);
    if (u.includes('/jobs')) return failRes(503); // the exact shape of the real incident
    return okRes([], { 'content-range': '0-0/7' });
  };
  const { req, res, out } = reqRes();
  await handler(req, res);

  const dq = out.payload.data_quality;
  assert.equal(dq.degraded, true, 'the payload must admit it is degraded');
  assert.ok(dq.failed_query_count > 0);
  assert.ok(dq.failed_queries.some((f) => f.table.includes('jobs') && f.status === 503),
    'the failing table and status are named');
  // The count itself still reads 0 — which is precisely why `degraded` has to exist.
  assert.equal(out.payload.jobs.active, 0);
});

test('a transport failure is recorded too, and does not throw out of Promise.all', async () => {
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/admin_sessions?token=eq')) return okRes(session);
    if (u.includes('/profiles')) throw new Error('socket hang up');
    return okRes([], { 'content-range': '0-0/7' });
  };
  const { req, res, out } = reqRes();
  await handler(req, res);

  assert.equal(out.code, 200, 'the endpoint still answers rather than 500ing on one dead query');
  const dq = out.payload.data_quality;
  assert.equal(dq.degraded, true);
  assert.ok(dq.failed_queries.some((f) => f.table.includes('profiles') && f.status === 0));
});

test('failed_queries never leaks the query string, which can carry user identifiers', async () => {
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/admin_sessions?token=eq')) return okRes(session);
    if (u.includes('/profiles')) return failRes(400);
    return okRes([], { 'content-range': '0-0/7' });
  };
  const { req, res, out } = reqRes();
  await handler(req, res);
  for (const f of out.payload.data_quality.failed_queries) {
    assert.ok(!f.table.includes('?'), `table must be bare, got ${f.table}`);
    assert.ok(!f.table.includes('eq.'), 'no filter values');
  }
});

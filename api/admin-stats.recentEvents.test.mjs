// Contract test for the `recent_events` live-feed action (Seen Live). Exercises the handler with
// a mocked Supabase REST layer: auth via X-Admin-Token, and the merged event mapping across
// reports / applications / employer_purchases / job_availability_reports / profiles.

import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-service-key';

const { default: handler } = await import('./admin-stats.js');

function mockResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, async json() { return body; }, async text() { return JSON.stringify(body); }, headers: { get() { return null; } } };
}

function installFetch() {
  global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/admin_sessions?token=eq')) {
      return mockResponse([{ expires_at: new Date(Date.now() + 3600e3).toISOString(), role: 'super_admin', admin_id: 'a1' }]);
    }
    if (u.includes('/reports?created_at=gt')) return mockResponse([{ id: 'r1', company_name: 'Aerotek', outcome: 'ghosted', role: 'Warehouse', created_at: '2026-07-05T10:00:00Z' }]);
    if (u.includes('/applications?created_at=gt')) return mockResponse([{ id: 'ap1', company_name: 'Costco', role: 'Cashier', created_at: '2026-07-05T10:01:00Z' }]);
    if (u.includes('/employer_purchases?created_at=gt')) return mockResponse([{ id: 9, company: 'Acme', employer_sku: 'featured30', amount_cents: 7900, created_at: '2026-07-05T10:02:00Z' }]);
    if (u.includes('/job_availability_reports?reported_at=gt')) return mockResponse([{ id: 5, job_id: 'j_x', company: 'BadCo', title: 'Driver', reported_at: '2026-07-05T10:03:00Z' }]);
    if (u.includes('/profiles?created_at=gt')) return mockResponse([{ created_at: '2026-07-05T10:04:00Z' }]);
    return mockResponse([]);
  };
}

function makeRes() {
  const r = { statusCode: 200, jsonBody: null };
  r.setHeader = () => {}; r.status = (c) => { r.statusCode = c; return r; }; r.json = (o) => { r.jsonBody = o; return r; }; r.end = () => r;
  return r;
}

test('recent_events returns merged, typed, newest-first events + a server_time cursor', async () => {
  installFetch();
  const req = { method: 'POST', headers: { 'x-admin-token': 'tok', origin: '' }, body: { action: 'recent_events', since: '2026-07-05T09:00:00Z' } };
  const res = makeRes();
  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.jsonBody.ok, true);
  assert.ok(res.jsonBody.server_time, 'returns a cursor for the next poll');

  const ev = res.jsonBody.events;
  assert.equal(ev.length, 5, 'one event from each source');
  // Newest-first (signup 10:04 → flag 10:03 → purchase 10:02 → app 10:01 → report 10:00).
  assert.deepEqual(ev.map(e => e.type), ['signup', 'flag', 'purchase', 'application', 'report']);

  const purchase = ev.find(e => e.type === 'purchase');
  assert.equal(purchase.sev, 'money');
  assert.match(purchase.title, /\$79/);
  assert.equal(purchase.id, 'purchase:9');

  const report = ev.find(e => e.type === 'report');
  assert.match(report.title, /Aerotek/);
  assert.equal(report.id, 'report:r1');
});

test('recent_events requires a valid admin token', async () => {
  installFetch();
  global.fetch = async (u) => String(u).includes('/admin_sessions') ? mockResponse([]) : mockResponse([]);
  const req = { method: 'POST', headers: { 'x-admin-token': 'bad', origin: '' }, body: { action: 'recent_events' } };
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 401);
});

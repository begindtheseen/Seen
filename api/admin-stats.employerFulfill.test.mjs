// Contract test for `fulfill_employer_purchase` (Engine E4 fulfillment). Asserts the right
// time-boxed perk is granted per SKU and the purchase is marked fulfilled — with a mocked
// Supabase REST layer so the frontend→API→DB contract is real.

import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-service-key';

const { default: handler } = await import('./admin-stats.js');

function mockResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, async json() { return body; }, async text() { return JSON.stringify(body); }, headers: { get() { return null; } } };
}

function installFetch(sku, role = 'super_admin') {
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    const u = String(url); const method = opts.method || 'GET';
    calls.push({ url: u, method, body: opts.body });
    if (u.includes('/admin_sessions?token=eq')) return mockResponse([{ expires_at: new Date(Date.now() + 3600e3).toISOString(), role, admin_id: 'a1' }]);
    if (u.includes('/employer_purchases?id=eq') && method === 'GET') return mockResponse([{ id: 7, company: 'Acme Corp', employer_sku: sku }]);
    return mockResponse(null, { ok: true, status: 204 });
  };
  return calls;
}

function makeRes() {
  const r = { statusCode: 200, jsonBody: null };
  r.setHeader = () => {}; r.status = (c) => { r.statusCode = c; return r; }; r.json = (o) => { r.jsonBody = o; return r; }; r.end = () => r;
  return r;
}

async function fulfill(sku, role) {
  const calls = installFetch(sku, role);
  const req = { method: 'POST', headers: { 'x-admin-token': 'tok', origin: '' }, body: { action: 'fulfill_employer_purchase', purchase_id: 7 } };
  const res = makeRes();
  await handler(req, res);
  return { res, calls };
}

test('verified90 grants verified_until and marks the purchase fulfilled', async () => {
  const { res, calls } = await fulfill('verified90');
  assert.equal(res.statusCode, 200);
  assert.equal(res.jsonBody.perk, 'verified_until');
  const perk = calls.find(c => c.url.includes('/employer_perks') && c.method === 'POST');
  assert.ok(perk, 'upserts the perk');
  assert.match(perk.body, /"company":"acme corp"/); // lowercased key
  assert.match(perk.body, /"verified_until"/);
  assert.doesNotMatch(perk.body, /"featured_until"/);
  const patch = calls.find(c => c.url.includes('/employer_purchases?id=eq') && c.method === 'PATCH');
  assert.ok(patch, 'marks the purchase fulfilled');
  assert.match(patch.body, /"status":"fulfilled"/);
});

test('featured30 grants featured_until', async () => {
  const { res, calls } = await fulfill('featured30');
  assert.equal(res.jsonBody.perk, 'featured_until');
  const perk = calls.find(c => c.url.includes('/employer_perks') && c.method === 'POST');
  assert.match(perk.body, /"featured_until"/);
  assert.doesNotMatch(perk.body, /"verified_until"/);
});

test('moderators cannot fulfill', async () => {
  const { res } = await fulfill('featured30', 'moderator');
  assert.equal(res.statusCode, 403);
});

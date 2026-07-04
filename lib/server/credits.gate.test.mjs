// gateAI gating tests for the purchased-Pro window (pro_until) and purchased credits.
// Exercises the legacy inline path (the consume_credit RPC is mocked unavailable, exactly
// like a DB where migration 044 hasn't landed the new function yet) with a mocked
// Supabase REST layer, mirroring the api test mocking style.

import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
delete process.env.SUPABASE_JWT_SECRET; // force the auth/v1/user resolution path

const { gateAI } = await import('./credits.js');

const UID = 'a1b2c3d4-e5f6-4a7b-8c9d-0123456789ab';
const TODAY = new Date().toISOString().slice(0, 10);

function mockResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, async json() { return body; }, async text() { return JSON.stringify(body); } };
}

// Standard plumbing: auth resolves UID, credit flag is on, the RPC is unavailable
// (404 → gateAI falls through to the legacy inline path), and `row` is the credit row.
function installFetch(row) {
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    calls.push({ url: u, method: opts.method || 'GET', body: opts.body });
    if (u.includes('/auth/v1/user')) return mockResponse({ id: UID });
    if (u.includes('/feature_flags?')) return mockResponse([{ status: 'on' }]);
    if (u.includes('/rpc/consume_credit')) return mockResponse(null, { ok: false, status: 404 });
    if (u.includes('/ai_credits?user_id=eq') && (opts.method || 'GET') === 'GET') return mockResponse(row ? [row] : []);
    return mockResponse(null, { status: 204 });
  };
  return calls;
}

const req = { headers: { authorization: 'Bearer test-token' } };

test('an unexpired pro_until window gates as Pro (no balance deduction)', async () => {
  const calls = installFetch({ user_id: UID, balance: 0, purchased_credits: 0, daily_earned: 0, last_reset: TODAY, pro: false, pro_until: new Date(Date.now() + 3 * 86400e3).toISOString() });
  const gate = await gateAI(req, 'test');
  assert.equal(gate.ok, true);
  assert.equal(gate.pro, true);
  assert.equal(calls.some(c => c.url.includes('/ai_credits') && c.method === 'PATCH'), false, 'Pro never deducts a balance');
});

test('an EXPIRED pro_until window with no credits gates as 402', async () => {
  installFetch({ user_id: UID, balance: 0, purchased_credits: 0, daily_earned: 0, last_reset: TODAY, pro: false, pro_until: new Date(Date.now() - 86400e3).toISOString() });
  const gate = await gateAI(req, 'test');
  assert.equal(gate.ok, false);
  assert.equal(gate.status, 402);
  assert.equal(gate.credits_required, true);
});

test('pro_until window satisfies proOnly features', async () => {
  installFetch({ user_id: UID, balance: 0, purchased_credits: 0, daily_earned: 0, last_reset: TODAY, pro: false, pro_until: new Date(Date.now() + 86400e3).toISOString() });
  const gate = await gateAI(req, 'test', { proOnly: true });
  assert.equal(gate.ok, true);
  assert.equal(gate.pro, true);
});

test('purchased credits are spent AFTER the daily balance is exhausted', async () => {
  const calls = installFetch({ user_id: UID, balance: 0, purchased_credits: 3, daily_earned: 0, last_reset: TODAY, pro: false, pro_until: null });
  const gate = await gateAI(req, 'test');
  assert.equal(gate.ok, true);
  assert.equal(gate.balance, 2);
  const patch = calls.find(c => c.url.includes('/ai_credits') && c.method === 'PATCH');
  assert.deepEqual(JSON.parse(patch.body), { purchased_credits: 2 }, 'deducts from purchased_credits, not balance');
});

test('daily balance is spent first when both exist (combined balance reported)', async () => {
  const calls = installFetch({ user_id: UID, balance: 1, purchased_credits: 20, daily_earned: 0, last_reset: TODAY, pro: false, pro_until: null });
  const gate = await gateAI(req, 'test');
  assert.equal(gate.ok, true);
  assert.equal(gate.balance, 20, '0 daily + 20 purchased after the spend');
  const patch = calls.find(c => c.url.includes('/ai_credits') && c.method === 'PATCH');
  assert.deepEqual(JSON.parse(patch.body), { balance: 0 });
});

test('pre-migration rows (no purchased_credits/pro_until columns) behave exactly as before', async () => {
  const calls = installFetch({ user_id: UID, balance: 1, daily_earned: 0, last_reset: TODAY, pro: false });
  const gate = await gateAI(req, 'test');
  assert.equal(gate.ok, true);
  assert.equal(gate.balance, 0);
  const patch = calls.find(c => c.url.includes('/ai_credits') && c.method === 'PATCH');
  assert.deepEqual(JSON.parse(patch.body), { balance: 0 }, 'never writes the new columns on old rows');
});

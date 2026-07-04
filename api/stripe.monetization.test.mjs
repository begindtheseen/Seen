// Contract tests for Operation 50% monetization (7-day no-card trial + one-time SKUs).
// The api/stripe.js handler is exercised end-to-end with mocked Stripe + Supabase REST
// layers so the REAL contracts are asserted:
//   - checkout (subscription): trial_period_days=7, no-card trial settings
//   - checkout (sku): mode=payment, inline price_data, metadata.sku + metadata.user_id
//   - webhook checkout.session.completed (sku): idempotent fulfillment into
//     purchased_credits + pro_until (NEVER the permanent pro flag)
//   - webhook subscription lifecycle unchanged (pro flag in lockstep)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
process.env.SUPABASE_JWT_SECRET = 'test-jwt-secret';
process.env.STRIPE_SECRET_KEY = 'sk_test_x';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
delete process.env.STRIPE_PRICE_ID_MONTHLY;
delete process.env.STRIPE_PRICE_ID_YEARLY;

const { default: handler } = await import('./stripe.js');

const UID = 'a1b2c3d4-e5f6-4a7b-8c9d-0123456789ab';

function makeJWT(sub = UID) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const payload = b64({ sub, email: 'u@example.com', exp: Math.floor(Date.now() / 1000) + 3600 });
  const sig = createHmac('sha256', process.env.SUPABASE_JWT_SECRET).update(`${head}.${payload}`).digest('base64url');
  return `${head}.${payload}.${sig}`;
}

function mockResponse(body, { ok = true, status = 200 } = {}) {
  return {
    ok, status,
    async json() { return body; },
    async text() { return typeof body === 'string' ? body : JSON.stringify(body); },
    headers: { get() { return null; } },
  };
}

// Installs a recording fetch mock. `routes` is an ordered list of [predicate, responder].
function installFetch(routes = []) {
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    const method = opts.method || 'GET';
    const call = { url: u, method, body: opts.body };
    calls.push(call);
    for (const [match, respond] of routes) {
      if (match(call)) return respond(call);
    }
    return mockResponse(null, { status: 204 });
  };
  return calls;
}

function makeRes() {
  const r = { statusCode: 200, jsonBody: null };
  r.setHeader = () => {};
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (o) => { r.jsonBody = o; return r; };
  r.end = () => r;
  return r;
}

// api/stripe.js disables the body parser and reads the raw stream; readRawBody falls back
// to req.body when present — pass the EXACT raw string for webhooks (HMAC-signed bytes).
async function call({ action, body, headers = {}, method = 'POST' }) {
  const req = {
    method,
    url: `/api/stripe?action=${action}`,
    query: { action },
    headers: { origin: '', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body || {}),
  };
  const res = makeRes();
  await handler(req, res);
  return res;
}

function signWebhook(raw) {
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac('sha256', process.env.STRIPE_WEBHOOK_SECRET).update(`${t}.${raw}`).digest('hex');
  return `t=${t},v1=${v1}`;
}

const auth = () => ({ authorization: `Bearer ${makeJWT()}` });

// ── CHECKOUT: subscription gets the 7-day NO-CARD trial ─────────────────────────────────

test('checkout (subscription) sends trial_period_days=7 + no-card trial settings', async () => {
  const calls = installFetch([
    [c => c.url.includes('api.stripe.com/v1/checkout/sessions'), () => mockResponse({ id: 'cs_1', url: 'https://stripe/redirect' })],
    [c => c.url.includes('/ai_credits?'), () => mockResponse([])],
  ]);
  const res = await call({ action: 'checkout', body: { plan: 'monthly' }, headers: auth() });
  assert.equal(res.statusCode, 200);
  assert.equal(res.jsonBody.url, 'https://stripe/redirect');

  const stripeCall = calls.find(c => c.url.includes('/v1/checkout/sessions'));
  const form = new URLSearchParams(stripeCall.body);
  assert.equal(form.get('mode'), 'subscription');
  assert.equal(form.get('subscription_data[trial_period_days]'), '7');
  assert.equal(form.get('subscription_data[trial_settings][end_behavior][missing_payment_method]'), 'cancel');
  assert.equal(form.get('payment_method_collection'), 'if_required');
  assert.equal(form.get('metadata[uid]'), UID);
  assert.equal(form.get('line_items[0][price_data][unit_amount]'), '999');
});

// ── CHECKOUT: one-time SKUs (mode: payment, inline price_data) ──────────────────────────

test('checkout (sku=sprint) creates a mode=payment session with sku metadata', async () => {
  const calls = installFetch([
    [c => c.url.includes('/v1/checkout/sessions'), () => mockResponse({ id: 'cs_2', url: 'https://stripe/pay' })],
    [c => c.url.includes('/ai_credits?'), () => mockResponse([])],
  ]);
  const res = await call({ action: 'checkout', body: { sku: 'sprint' }, headers: auth() });
  assert.equal(res.statusCode, 200);

  const form = new URLSearchParams(calls.find(c => c.url.includes('/v1/checkout/sessions')).body);
  assert.equal(form.get('mode'), 'payment');
  assert.equal(form.get('metadata[sku]'), 'sprint');
  assert.equal(form.get('metadata[user_id]'), UID);
  assert.equal(form.get('metadata[uid]'), UID);
  assert.equal(form.get('line_items[0][price_data][unit_amount]'), '1499');
  assert.match(form.get('success_url'), /purchase=sprint/);
  // A one-time payment must never carry subscription/trial params.
  assert.equal(form.get('subscription_data[trial_period_days]'), null);
});

test('checkout (sku=credits20) charges $4.99', async () => {
  const calls = installFetch([
    [c => c.url.includes('/v1/checkout/sessions'), () => mockResponse({ id: 'cs_3', url: 'https://stripe/pay' })],
    [c => c.url.includes('/ai_credits?'), () => mockResponse([])],
  ]);
  await call({ action: 'checkout', body: { sku: 'credits20' }, headers: auth() });
  const form = new URLSearchParams(calls.find(c => c.url.includes('/v1/checkout/sessions')).body);
  assert.equal(form.get('mode'), 'payment');
  assert.equal(form.get('line_items[0][price_data][unit_amount]'), '499');
});

test('checkout rejects an unknown sku instead of silently selling a subscription', async () => {
  installFetch([[c => c.url.includes('/ai_credits?'), () => mockResponse([])]]);
  const res = await call({ action: 'checkout', body: { sku: 'bogus' }, headers: auth() });
  assert.equal(res.statusCode, 400);
});

// ── WEBHOOK: one-time fulfillment ────────────────────────────────────────────────────────

function skuEvent({ sku, id = 'evt_1', sessionId = 'cs_live_1', paymentStatus = 'paid' }) {
  return {
    id, type: 'checkout.session.completed',
    data: { object: { id: sessionId, mode: 'payment', payment_status: paymentStatus, customer: 'cus_9', metadata: { uid: UID, user_id: UID, sku } } },
  };
}

test('webhook fulfills sprint: +30 purchased_credits, pro_until ~7d, NOT the pro flag', async () => {
  const row = { user_id: UID, balance: 1, purchased_credits: 5, daily_earned: 0, pro: false, pro_until: null, stripe_customer_id: 'cus_9' };
  const calls = installFetch([
    [c => c.url.includes('/stripe_events_processed') && c.method === 'POST', () => mockResponse(null, { status: 201 })],
    [c => c.url.includes('/ai_credits?user_id=eq') && c.method === 'GET', () => mockResponse([row])],
  ]);
  const raw = JSON.stringify(skuEvent({ sku: 'sprint' }));
  const res = await call({ action: 'webhook', body: raw, headers: { 'stripe-signature': signWebhook(raw) } });
  assert.equal(res.statusCode, 200);

  // Fulfillment idempotency claim is keyed on the SESSION id (shared with confirm).
  const claims = calls.filter(c => c.url.includes('/stripe_events_processed') && c.method === 'POST').map(c => JSON.parse(c.body));
  assert.ok(claims.some(c => c.event_id === 'evt_1'), 'event-level idempotency row');
  assert.ok(claims.some(c => c.event_id === 'fulfill_cs_live_1'), 'session-level fulfillment claim');

  const patch = calls.find(c => c.url.includes(`/ai_credits?user_id=eq.${UID}`) && c.method === 'PATCH');
  assert.ok(patch, 'grants via an ai_credits PATCH');
  const patched = JSON.parse(patch.body);
  assert.equal(patched.purchased_credits, 35, 'adds 30 on top of the existing 5 purchased');
  assert.equal(patched.pro, undefined, 'one-time purchase must NEVER set the permanent pro flag');
  assert.equal(patched.balance, undefined, 'credits go to purchased_credits, never the daily-reset balance');
  const until = Date.parse(patched.pro_until);
  assert.ok(until > Date.now() + 6.9 * 86400e3 && until < Date.now() + 7.1 * 86400e3, 'pro_until ≈ now + 7 days');

  const ledger = calls.find(c => c.url.includes('/credit_transactions') && c.method === 'POST' && String(c.body).includes('purchase_sprint'));
  assert.ok(ledger, 'writes a +30 purchase ledger row');
  assert.equal(JSON.parse(ledger.body).delta, 30);
});

test('webhook fulfills credits20 for a user with NO credit row: welcome + 20 purchased, no pro_until', async () => {
  const calls = installFetch([
    [c => c.url.includes('/stripe_events_processed') && c.method === 'POST', () => mockResponse(null, { status: 201 })],
    [c => c.url.includes('/ai_credits?user_id=eq') && c.method === 'GET', () => mockResponse([])],
    [c => c.url.includes('/ai_credits') && c.method === 'POST', () => mockResponse(null, { status: 201 })],
  ]);
  const raw = JSON.stringify(skuEvent({ sku: 'credits20', id: 'evt_2', sessionId: 'cs_live_2' }));
  const res = await call({ action: 'webhook', body: raw, headers: { 'stripe-signature': signWebhook(raw) } });
  assert.equal(res.statusCode, 200);

  const ins = calls.find(c => c.url.includes('/ai_credits') && c.method === 'POST');
  assert.ok(ins, 'creates the credit row');
  const inserted = JSON.parse(ins.body);
  assert.equal(inserted.purchased_credits, 20);
  assert.equal(inserted.balance, 10, 'preserves the welcome bonus gateAI would have granted lazily');
  assert.equal(inserted.pro, false);
  assert.equal(inserted.pro_until, undefined, 'credits20 grants no Pro window');
});

test('webhook duplicate fulfillment (claim already exists) grants nothing twice', async () => {
  const calls = installFetch([
    // Event-level row inserts fine; the SESSION-level fulfillment claim already exists → 409.
    [c => c.url.includes('/stripe_events_processed') && c.method === 'POST' && String(c.body).includes('fulfill_'), () => mockResponse(null, { ok: false, status: 409 })],
    [c => c.url.includes('/stripe_events_processed') && c.method === 'POST', () => mockResponse(null, { status: 201 })],
    [c => c.url.includes('/ai_credits?user_id=eq') && c.method === 'GET', () => mockResponse([{ user_id: UID, balance: 1, purchased_credits: 35 }])],
  ]);
  const raw = JSON.stringify(skuEvent({ sku: 'sprint', id: 'evt_3', sessionId: 'cs_live_1' }));
  const res = await call({ action: 'webhook', body: raw, headers: { 'stripe-signature': signWebhook(raw) } });
  assert.equal(res.statusCode, 200);
  assert.equal(calls.some(c => c.url.includes('/ai_credits') && (c.method === 'PATCH' || c.method === 'POST')), false, 'no second grant');
  assert.equal(calls.some(c => c.url.includes('/credit_transactions')), false, 'no second ledger row');
});

test('webhook fulfillment failure releases both claims and 500s so Stripe redelivers', async () => {
  const calls = installFetch([
    [c => c.url.includes('/stripe_events_processed') && c.method === 'POST', () => mockResponse(null, { status: 201 })],
    [c => c.url.includes('/stripe_events_processed') && c.method === 'DELETE', () => mockResponse(null, { status: 204 })],
    [c => c.url.includes('/ai_credits?user_id=eq') && c.method === 'GET', () => mockResponse([{ user_id: UID, balance: 1, purchased_credits: 0 }])],
    [c => c.url.includes('/ai_credits') && c.method === 'PATCH', () => mockResponse(null, { ok: false, status: 500 })],
  ]);
  const raw = JSON.stringify(skuEvent({ sku: 'sprint', id: 'evt_4', sessionId: 'cs_live_4' }));
  const res = await call({ action: 'webhook', body: raw, headers: { 'stripe-signature': signWebhook(raw) } });
  assert.equal(res.statusCode, 500, 'non-2xx so Stripe retries the delivery');
  const deletes = calls.filter(c => c.url.includes('/stripe_events_processed') && c.method === 'DELETE');
  assert.ok(deletes.some(c => c.url.includes('fulfill_cs_live_4')), 'session claim released');
  assert.ok(deletes.some(c => c.url.includes('evt_4')), 'event claim released');
});

// ── WEBHOOK: subscription lifecycle unchanged ────────────────────────────────────────────

test('webhook subscription checkout (no sku) still sets pro=true', async () => {
  const calls = installFetch([
    [c => c.url.includes('/stripe_events_processed') && c.method === 'POST', () => mockResponse(null, { status: 201 })],
    [c => c.url.includes('/ai_credits?user_id=eq') && c.method === 'PATCH', () => mockResponse(null, { status: 204 })],
  ]);
  const raw = JSON.stringify({ id: 'evt_5', type: 'checkout.session.completed', data: { object: { id: 'cs_sub', mode: 'subscription', subscription: 'sub_1', customer: 'cus_9', metadata: { uid: UID } } } });
  const res = await call({ action: 'webhook', body: raw, headers: { 'stripe-signature': signWebhook(raw) } });
  assert.equal(res.statusCode, 200);
  const proPatch = calls.find(c => c.url.includes('/ai_credits?user_id=eq') && c.method === 'PATCH' && String(c.body).includes('"pro":true'));
  assert.ok(proPatch, 'subscription checkout flips pro on');
});

test('webhook subscription.updated trialing→pro on, canceled→pro off (trial lifecycle)', async () => {
  for (const [status, expected] of [['trialing', '"pro":true'], ['canceled', '"pro":false']]) {
    const calls = installFetch([
      [c => c.url.includes('/stripe_events_processed') && c.method === 'POST', () => mockResponse(null, { status: 201 })],
      [c => c.url.includes('/ai_credits?user_id=eq') && c.method === 'PATCH', () => mockResponse(null, { status: 204 })],
    ]);
    const raw = JSON.stringify({ id: `evt_${status}`, type: 'customer.subscription.updated', data: { object: { id: 'sub_1', status, metadata: { uid: UID } } } });
    const res = await call({ action: 'webhook', body: raw, headers: { 'stripe-signature': signWebhook(raw) } });
    assert.equal(res.statusCode, 200);
    assert.ok(calls.some(c => c.method === 'PATCH' && String(c.body).includes(expected)), `${status} → ${expected}`);
  }
});

test('webhook trial_will_end is acknowledged without any entitlement write', async () => {
  const calls = installFetch([
    [c => c.url.includes('/stripe_events_processed') && c.method === 'POST', () => mockResponse(null, { status: 201 })],
  ]);
  const raw = JSON.stringify({ id: 'evt_twe', type: 'customer.subscription.trial_will_end', data: { object: { id: 'sub_1', trial_end: 123, metadata: { uid: UID } } } });
  const res = await call({ action: 'webhook', body: raw, headers: { 'stripe-signature': signWebhook(raw) } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.jsonBody.received, true);
  assert.equal(calls.some(c => c.url.includes('/ai_credits')), false, 'no entitlement change');
});

// ── CONFIRM: one-time sessions fulfill on the return page too ────────────────────────────

test('confirm fulfills a paid one-time session (idempotent with the webhook)', async () => {
  const calls = installFetch([
    [c => c.url.includes('/v1/checkout/sessions/'), () => mockResponse({ id: 'cs_ret', mode: 'payment', payment_status: 'paid', status: 'complete', customer: 'cus_9', metadata: { uid: UID, user_id: UID, sku: 'credits20' } })],
    [c => c.url.includes('/stripe_events_processed') && c.method === 'POST', () => mockResponse(null, { status: 201 })],
    [c => c.url.includes('/ai_credits?user_id=eq') && c.method === 'GET', () => mockResponse([{ user_id: UID, balance: 0, purchased_credits: 0 }])],
  ]);
  const res = await call({ action: 'confirm', body: { session_id: 'cs_ret' }, headers: auth() });
  assert.equal(res.statusCode, 200);
  assert.equal(res.jsonBody.ok, true);
  assert.equal(res.jsonBody.sku, 'credits20');
  const patch = calls.find(c => c.url.includes(`/ai_credits?user_id=eq.${UID}`) && c.method === 'PATCH');
  assert.equal(JSON.parse(patch.body).purchased_credits, 20);
});

test('confirm refuses a session owned by a different user', async () => {
  installFetch([
    [c => c.url.includes('/v1/checkout/sessions/'), () => mockResponse({ id: 'cs_x', mode: 'payment', payment_status: 'paid', metadata: { uid: 'someone-else', sku: 'sprint' } })],
  ]);
  const res = await call({ action: 'confirm', body: { session_id: 'cs_x' }, headers: auth() });
  assert.equal(res.statusCode, 403);
});

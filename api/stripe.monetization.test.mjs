// Contract tests for Operation 50% monetization (7-day no-card trial + one-time SKUs).
// The api/stripe.js handler is exercised end-to-end with mocked Stripe + Supabase REST
// layers so the REAL contracts are asserted:
//   - checkout: only the sellable one-time SKUs (interview, pass30); an old {plan} request is refused
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

// Owner decision 2026-10-25: the 30-day Job Search Pass replaced monthly/yearly Pro and the trial.
test('checkout without a sku (an old {plan} request) is refused — no subscription, no trial, no Stripe call', async () => {
  for (const body of [{ plan: 'monthly' }, { plan: 'yearly' }, {}]) {
    const calls = installFetch([[c => c.url.includes('/ai_credits?'), () => mockResponse([])]]);
    const res = await call({ action: 'checkout', body, headers: auth() });
    assert.equal(res.statusCode, 400);
    assert.equal(res.jsonBody.retired, 'subscription');
    assert.match(res.jsonBody.error, /no longer sells subscriptions/);
    assert.equal(calls.some(c => c.url.includes('api.stripe.com')), false, 'Stripe is never asked for a session');
  }
});

test('checkout (sku=pass30) is $19.99 once, never renews, and records checkout_started with its surface', async () => {
  const calls = installFetch([
    [c => c.url.includes('/v1/checkout/sessions'), () => mockResponse({ id: 'cs_p', url: 'https://stripe/pass' })],
    [c => c.url.includes('/ai_credits?'), () => mockResponse([])],
  ]);
  const res = await call({ action: 'checkout', body: { sku: 'pass30', surface: 'pricing' }, headers: auth() });
  assert.equal(res.statusCode, 200);
  assert.equal(res.jsonBody.url, 'https://stripe/pass');
  const form = new URLSearchParams(calls.find(c => c.url.includes('/v1/checkout/sessions')).body);
  assert.equal(form.get('mode'), 'payment');
  assert.equal(form.get('line_items[0][price_data][unit_amount]'), '1999');
  assert.equal(form.get('line_items[0][price_data][product_data][name]'), 'Seen Job Search Pass');
  assert.equal(form.get('line_items[0][price_data][product_data][description]'), '30 days of everything in Seen Pro. One-time — never renews.');
  assert.equal(form.get('line_items[0][price_data][recurring][interval]'), null);
  assert.equal(form.get('subscription_data[trial_period_days]'), null);
  assert.equal(form.get('metadata[sku]'), 'pass30');
  assert.equal(form.get('metadata[surface]'), 'pricing');
  assert.match(form.get('success_url'), /^https:\/\/seenjobs\.io\/pricing\?upgraded=1&purchase=pass30&session_id=\{CHECKOUT_SESSION_ID\}$/);
  const ev = calls.find(c => c.url.includes('/rest/v1/funnel_events') && c.method === 'POST');
  assert.ok(ev, 'a checkout_started funnel row');
  assert.deepEqual(JSON.parse(ev.body), { user_id: UID, event: 'checkout_started', company: null, surface: 'pricing', sku: 'pass30' });
});

test('checkout (sku=pass30) from a tracker card returns to that card', async () => {
  const calls = installFetch([
    [c => c.url.includes('/v1/checkout/sessions'), () => mockResponse({ id: 'cs_q', url: 'https://stripe/pass' })],
    [c => c.url.includes('/ai_credits?'), () => mockResponse([])],
  ]);
  await call({ action: 'checkout', body: { sku: 'pass30', surface: 'tracker_prep', application_id: 'app_9', company: 'Walmart', role: 'Cashier' }, headers: auth() });
  const form = new URLSearchParams(calls.find(c => c.url.includes('/v1/checkout/sessions')).body);
  assert.equal(form.get('success_url'), 'https://seenjobs.io/tracker?prep=app_9&purchase=pass30&session_id={CHECKOUT_SESSION_ID}');
  assert.equal(form.get('cancel_url'), 'https://seenjobs.io/tracker?prep=app_9');
  assert.equal(form.get('metadata[company]'), 'Walmart');
  assert.equal(form.get('line_items[0][price_data][product_data][name]'), 'Seen Job Search Pass', 'the pass is not named after one company');
});

test('checkout ignores an unknown surface instead of storing it', async () => {
  const calls = installFetch([
    [c => c.url.includes('/v1/checkout/sessions'), () => mockResponse({ id: 'cs_r', url: 'https://stripe/x' })],
    [c => c.url.includes('/ai_credits?'), () => mockResponse([])],
  ]);
  await call({ action: 'checkout', body: { sku: 'interview', surface: '<script>' }, headers: auth() });
  const form = new URLSearchParams(calls.find(c => c.url.includes('/v1/checkout/sessions')).body);
  assert.equal(form.get('metadata[surface]'), null);
});

// ── CHECKOUT: one-time SKUs (mode: payment, inline price_data) ──────────────────────────

test('checkout (sku=interview) is $9.99, carries the card, and returns to that tracker card', async () => {
  const calls = installFetch([
    [c => c.url.includes('/v1/checkout/sessions'), () => mockResponse({ id: 'cs_2', url: 'https://stripe/pay' })],
    [c => c.url.includes('/ai_credits?'), () => mockResponse([])],
  ]);
  const res = await call({ action: 'checkout', body: { sku: 'interview', application_id: 'app_12<script>', company: 'Ross Stores', role: 'Assistant Store Manager' }, headers: auth() });
  assert.equal(res.statusCode, 200);

  const form = new URLSearchParams(calls.find(c => c.url.includes('/v1/checkout/sessions')).body);
  assert.equal(form.get('mode'), 'payment');
  assert.equal(form.get('metadata[sku]'), 'interview');
  assert.equal(form.get('metadata[user_id]'), UID);
  assert.equal(form.get('metadata[uid]'), UID);
  assert.equal(form.get('line_items[0][price_data][unit_amount]'), '999');
  assert.equal(form.get('metadata[application_id]'), 'app_12script', 'only id characters survive');
  assert.equal(form.get('metadata[company]'), 'Ross Stores');
  assert.match(form.get('line_items[0][price_data][product_data][name]'), /Interview Prep — Ross Stores/);
  assert.match(form.get('success_url'), /^https:\/\/seenjobs\.io\/tracker\?prep=app_12script&purchase=interview&session_id=\{CHECKOUT_SESSION_ID\}$/);
  assert.equal(form.get('cancel_url'), 'https://seenjobs.io/tracker?prep=app_12script');
  // A one-time payment must never carry subscription/trial params.
  assert.equal(form.get('subscription_data[trial_period_days]'), null);
});

test('checkout (sku=credits20) is refused — the Credit Pack is no longer sold', async () => {
  const calls = installFetch([[c => c.url.includes('/ai_credits?'), () => mockResponse([])]]);
  const res = await call({ action: 'checkout', body: { sku: 'credits20' }, headers: auth() });
  assert.equal(res.statusCode, 400);
  assert.equal(calls.some(c => c.url.includes('api.stripe.com')), false);
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

test('webhook fulfills interview: pro_until ~14d, no credits, NOT the pro flag', async () => {
  const row = { user_id: UID, balance: 1, purchased_credits: 5, daily_earned: 0, pro: false, pro_until: null, stripe_customer_id: 'cus_9' };
  const calls = installFetch([
    [c => c.url.includes('/stripe_events_processed') && c.method === 'POST', () => mockResponse(null, { status: 201 })],
    [c => c.url.includes('/ai_credits?user_id=eq') && c.method === 'GET', () => mockResponse([row])],
  ]);
  const raw = JSON.stringify(skuEvent({ sku: 'interview' }));
  const res = await call({ action: 'webhook', body: raw, headers: { 'stripe-signature': signWebhook(raw) } });
  assert.equal(res.statusCode, 200);

  // Fulfillment idempotency claim is keyed on the SESSION id (shared with confirm).
  const claims = calls.filter(c => c.url.includes('/stripe_events_processed') && c.method === 'POST').map(c => JSON.parse(c.body));
  assert.ok(claims.some(c => c.event_id === 'evt_1'), 'event-level idempotency row');
  assert.ok(claims.some(c => c.event_id === 'fulfill_cs_live_1'), 'session-level fulfillment claim');

  const patch = calls.find(c => c.url.includes(`/ai_credits?user_id=eq.${UID}`) && c.method === 'PATCH');
  assert.ok(patch, 'grants via an ai_credits PATCH');
  const patched = JSON.parse(patch.body);
  assert.equal(patched.purchased_credits, 5, 'Interview Prep adds no credits (Pro is unlimited for its window)');
  assert.equal(patched.pro, undefined, 'one-time purchase must NEVER set the permanent pro flag');
  assert.equal(patched.balance, undefined, 'credits go to purchased_credits, never the daily-reset balance');
  const until = Date.parse(patched.pro_until);
  assert.ok(until > Date.now() + 13.9 * 86400e3 && until < Date.now() + 14.1 * 86400e3, 'pro_until ≈ now + 14 days');

  const ledger = calls.find(c => c.url.includes('/credit_transactions') && c.method === 'POST' && String(c.body).includes('purchase_interview'));
  assert.ok(ledger, 'writes a purchase ledger row (the funnel counts purchases from it)');
  assert.equal(JSON.parse(ledger.body).delta, 0);
});

// ── Job Search Pass fulfilment: the 30 days paid for come AFTER any Pro time already left ──────
function proRowFetch(row, extra = []) {
  return installFetch([
    ...extra,
    [c => c.url.includes('/stripe_events_processed') && c.method === 'POST', () => mockResponse(null, { status: 201 })],
    [c => c.url.includes('/ai_credits?user_id=eq') && c.method === 'GET', () => mockResponse([row])],
  ]);
}
const passEvent = (o = {}) => {
  const e = skuEvent({ sku: 'pass30', id: o.id || 'evt_pass', sessionId: o.sessionId || 'cs_pass' });
  e.data.object.metadata.surface = 'tracker_prep';
  e.data.object.metadata.company = 'Walmart';
  return e;
};

test('webhook fulfills pass30: 30 days added after the Pro time already left; no pro flag; ledger + checkout_completed', async () => {
  const existing = new Date(Date.now() + 10 * 86400e3).toISOString();
  const calls = proRowFetch({ user_id: UID, balance: 1, purchased_credits: 2, daily_earned: 0, pro: false, pro_until: existing, stripe_customer_id: 'cus_9' });
  const raw = JSON.stringify(passEvent());
  const res = await call({ action: 'webhook', body: raw, headers: { 'stripe-signature': signWebhook(raw) } });
  assert.equal(res.statusCode, 200);
  const patch = calls.find(c => c.url.includes(`/ai_credits?user_id=eq.${UID}`) && c.method === 'PATCH');
  assert.ok(patch, 'grants via an ai_credits PATCH');
  assert.ok(patch.url.includes(`pro_until=eq.${encodeURIComponent(existing)}`), 'compare-and-set on the pro_until it read');
  const patched = JSON.parse(patch.body);
  assert.equal(patched.pro, undefined, 'a one-time purchase never sets the permanent pro flag');
  assert.equal(patched.purchased_credits, 2, 'the pass adds no credits');
  assert.equal(Date.parse(patched.pro_until), Date.parse(existing) + 30 * 86400e3, 'GREATEST(pro_until, now) + 30 days');
  const ledger = calls.find(c => c.url.includes('/credit_transactions') && c.method === 'POST');
  assert.equal(JSON.parse(ledger.body).reason, 'purchase_pass30');
  const done = calls.filter(c => c.url.includes('/funnel_events') && c.method === 'POST').map(c => JSON.parse(c.body));
  assert.deepEqual(done, [{ user_id: UID, event: 'checkout_completed', company: 'Walmart', surface: 'tracker_prep', sku: 'pass30' }]);
});

test('webhook fulfills pass30 with no Pro time left: now + 30 days', async () => {
  const calls = proRowFetch({ user_id: UID, balance: 1, purchased_credits: 0, pro: false, pro_until: new Date(Date.now() - 86400e3).toISOString() });
  const raw = JSON.stringify(passEvent({ id: 'evt_pass2', sessionId: 'cs_pass2' }));
  await call({ action: 'webhook', body: raw, headers: { 'stripe-signature': signWebhook(raw) } });
  const until = Date.parse(JSON.parse(calls.find(c => c.url.includes('/ai_credits?user_id=eq') && c.method === 'PATCH').body).pro_until);
  assert.ok(until > Date.now() + 29.9 * 86400e3 && until < Date.now() + 30.1 * 86400e3);
});

test('pass30 is fulfilled once: the webhook after the return-page confirm grants nothing', async () => {
  const calls = installFetch([
    [c => c.url.includes('/stripe_events_processed') && c.method === 'POST' && String(c.body).includes('fulfill_'), () => mockResponse(null, { ok: false, status: 409 })],
    [c => c.url.includes('/stripe_events_processed') && c.method === 'POST', () => mockResponse(null, { status: 201 })],
  ]);
  const raw = JSON.stringify(passEvent({ id: 'evt_pass3', sessionId: 'cs_pass3' }));
  const res = await call({ action: 'webhook', body: raw, headers: { 'stripe-signature': signWebhook(raw) } });
  assert.equal(res.statusCode, 200);
  assert.equal(calls.some(c => c.url.includes('/ai_credits') && c.method !== 'GET'), false, 'no second grant');
  assert.equal(calls.some(c => c.url.includes('/funnel_events')), false, 'no second checkout_completed');
});

test('confirm fulfills a paid pass30 session on the return page', async () => {
  const calls = installFetch([
    [c => c.url.includes('/v1/checkout/sessions/'), () => mockResponse({ id: 'cs_pr', mode: 'payment', payment_status: 'paid', status: 'complete', customer: 'cus_9', metadata: { uid: UID, user_id: UID, sku: 'pass30' } })],
    [c => c.url.includes('/stripe_events_processed') && c.method === 'POST', () => mockResponse(null, { status: 201 })],
    [c => c.url.includes('/ai_credits?user_id=eq') && c.method === 'GET', () => mockResponse([{ user_id: UID, balance: 0, purchased_credits: 0, pro_until: null }])],
  ]);
  const res = await call({ action: 'confirm', body: { session_id: 'cs_pr' }, headers: auth() });
  assert.equal(res.statusCode, 200);
  assert.deepEqual([res.jsonBody.ok, res.jsonBody.sku], [true, 'pass30']);
  const patch = calls.find(c => c.url.includes('/ai_credits?user_id=eq') && c.method === 'PATCH');
  assert.ok(patch.url.includes('pro_until=is.null'));
});

test('interview keeps migration 044: GREATEST(pro_until, now + 14) — a second prep never stacks', async () => {
  const existing = new Date(Date.now() + 10 * 86400e3).toISOString();
  const calls = proRowFetch({ user_id: UID, balance: 1, purchased_credits: 0, pro: false, pro_until: existing });
  const raw = JSON.stringify(skuEvent({ sku: 'interview', id: 'evt_int2', sessionId: 'cs_int2' }));
  await call({ action: 'webhook', body: raw, headers: { 'stripe-signature': signWebhook(raw) } });
  const until = Date.parse(JSON.parse(calls.find(c => c.url.includes('/ai_credits?user_id=eq') && c.method === 'PATCH').body).pro_until);
  assert.ok(until > Date.now() + 13.9 * 86400e3 && until < Date.now() + 14.1 * 86400e3);
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
  const raw = JSON.stringify(skuEvent({ sku: 'interview', id: 'evt_3', sessionId: 'cs_live_1' }));
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
  const raw = JSON.stringify(skuEvent({ sku: 'interview', id: 'evt_4', sessionId: 'cs_live_4' }));
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
    [c => c.url.includes('/v1/checkout/sessions/'), () => mockResponse({ id: 'cs_x', mode: 'payment', payment_status: 'paid', metadata: { uid: 'someone-else', sku: 'interview' } })],
  ]);
  const res = await call({ action: 'confirm', body: { session_id: 'cs_x' }, headers: auth() });
  assert.equal(res.statusCode, 403);
});

// ── PORTAL: Settings "Manage billing" — return_url is an internal path on the request origin ──────

test('portal returns to the internal path it was given, on the request origin, and refuses open redirects', async () => {
  for (const [ret, expected] of [['/profile#plan', 'https://seenjobs.io/profile#plan'], ['//evil.example', 'https://seenjobs.io/pricing'], ['https://evil.example/x', 'https://seenjobs.io/pricing'], [undefined, 'https://seenjobs.io/pricing']]) {
    const calls = installFetch([
      [c => c.url.includes('/ai_credits?') , () => mockResponse([{ stripe_customer_id: 'cus_1' }])],
      [c => c.url.includes('/v1/billing_portal/sessions'), () => mockResponse({ url: 'https://billing.stripe.com/s/1' })],
    ]);
    const res = await call({ action: 'portal', body: { return: ret }, headers: { ...auth(), origin: 'https://seenjobs.io' } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonBody.url, 'https://billing.stripe.com/s/1');
    const form = new URLSearchParams(calls.find(c => c.url.includes('/v1/billing_portal/sessions')).body);
    assert.equal(form.get('customer'), 'cus_1');
    assert.equal(form.get('return_url'), expected, `return=${ret}`);
  }
});

test('portal with no Stripe customer says so instead of pretending a portal opened', async () => {
  installFetch([
    [c => c.url.includes('/ai_credits?'), () => mockResponse([{ stripe_customer_id: null }])],
    [c => c.url.includes('api.stripe.com/v1/customers?'), () => mockResponse({ data: [] })],
  ]);
  const res = await call({ action: 'portal', body: { return: '/profile#plan' }, headers: auth() });
  assert.equal(res.statusCode, 200);
  assert.equal(res.jsonBody.url, null);
  assert.equal(res.jsonBody.no_customer, true);
});

// Tests for employer checkout fulfillment (Operation 50%, Engine E4).
// Run: node --test lib/server/employerFulfillment.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMPLOYER_SKUS, isEmployerSku, employerPrice } from './employerSkus.js';
import { employerSkuFromSession, isEmployerSession, fulfillEmployerCheckout } from './employerFulfillment.js';

const ENV = { SUPABASE_URL: 'https://x.supabase.co', SERVICE_KEY: 'k' };
const baseSession = (over = {}) => ({
  id: 'cs_test_1', payment_status: 'paid',
  metadata: { kind: 'employer', employer_sku: 'featured30', company: 'Acme', email: 'hr@acme.com', target: 'https://acme.com/job/1' },
  customer_details: { email: 'hr@acme.com' },
  ...over,
});

test('locked SKU prices + helpers', () => {
  assert.equal(EMPLOYER_SKUS.featured30.amount_cents, 7900);
  assert.equal(EMPLOYER_SKUS.verified90.amount_cents, 24900);
  assert.equal(employerPrice('featured30'), '$79');
  assert.equal(employerPrice('verified90'), '$249');
  assert.equal(isEmployerSku('featured30'), true);
  assert.equal(isEmployerSku('nope'), false);
});

test('session classification', () => {
  assert.equal(employerSkuFromSession(baseSession()), 'featured30');
  assert.equal(isEmployerSession(baseSession()), true);
  assert.equal(isEmployerSession({ metadata: { sku: 'interview' } }), false); // consumer SKU, not employer
  assert.equal(isEmployerSession({ metadata: { kind: 'employer', employer_sku: 'bogus' } }), false);
});

test('unpaid session is not fulfilled', async () => {
  const r = await fulfillEmployerCheckout(baseSession({ payment_status: 'unpaid' }), ENV);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'not_paid');
});

test('paid session inserts once (new), then reports duplicate on redelivery', async () => {
  const calls = [];
  // First insert returns a row (new); second returns [] (ignore-duplicates conflict).
  let first = true;
  global.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), body: opts.body });
    if (String(url).includes('/employer_purchases')) {
      const rows = first ? [{ id: 1 }] : [];
      first = false;
      return { ok: true, async json() { return rows; } };
    }
    return { ok: true, async json() { return {}; } }; // resend / anything else
  };

  const r1 = await fulfillEmployerCheckout(baseSession(), ENV);
  assert.equal(r1.ok, true);
  assert.equal(r1.duplicate, false);
  const insert = calls.find(c => c.url.includes('/employer_purchases'));
  assert.ok(insert, 'inserts an employer_purchases row');
  assert.match(insert.body, /"stripe_session_id":"cs_test_1"/);
  assert.match(insert.body, /"amount_cents":7900/);

  const r2 = await fulfillEmployerCheckout(baseSession(), ENV);
  assert.equal(r2.ok, true);
  assert.equal(r2.duplicate, true, 'redelivery is idempotent');
});

test('featured purchase auto-applies the perk (employer_perks) + flags fulfilled', async () => {
  const calls = [];
  let firstInsert = true;
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    calls.push({ url: u, method: opts.method || 'GET', body: opts.body });
    // employer_purchases INSERT (POST with on_conflict) → new row the first time.
    if (u.includes('/employer_purchases') && (opts.method || 'POST') === 'POST') {
      const rows = firstInsert ? [{ id: 7 }] : [];
      firstInsert = false;
      return { ok: true, async json() { return rows; } };
    }
    return { ok: true, async json() { return {}; } }; // perk upsert / status patch / resend
  };

  const r = await fulfillEmployerCheckout(baseSession(), ENV); // featured30
  assert.equal(r.ok, true);
  assert.equal(r.featured_applied, true, 'featured is applied on payment');

  const perk = calls.find(c => c.url.includes('/employer_perks'));
  assert.ok(perk, 'writes an employer_perks row');
  assert.match(perk.body, /"featured_until"/);
  assert.match(perk.body, /"company":"acme"/); // company-keyed, lowercased

  const patch = calls.find(c => c.url.includes('/employer_purchases') && c.method === 'PATCH');
  assert.ok(patch, 'flips the purchase to fulfilled');
  assert.match(patch.body, /"status":"fulfilled"/);
});

test('verified purchase does NOT auto-apply a perk (stays a reviewed commitment)', async () => {
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    calls.push({ url: u, method: opts.method || 'GET' });
    if (u.includes('/employer_purchases') && (opts.method || 'POST') === 'POST') {
      return { ok: true, async json() { return [{ id: 9 }]; } };
    }
    return { ok: true, async json() { return {}; } };
  };

  const verifiedSession = baseSession({
    metadata: { kind: 'employer', employer_sku: 'verified90', company: 'Acme', email: 'hr@acme.com' },
  });
  const r = await fulfillEmployerCheckout(verifiedSession, ENV);
  assert.equal(r.ok, true);
  assert.equal(r.featured_applied, false, 'verified is never auto-granted');
  assert.equal(calls.some(c => c.url.includes('/employer_perks')), false, 'no perk write for verified');
});

// security audit 2026-11-01: the buyer types company / target into checkout metadata; the owner
// email must escape them and only link an http(s) target.
test('owner email escapes buyer metadata and never links a non-http target', async () => {
  const sent = [];
  process.env.RESEND_KEY = 'test-key';
  process.env.OWNER_EMAIL = 'owner@seenjobs.io';
  try {
    global.fetch = async (url, opts = {}) => {
      const u = String(url);
      if (u.startsWith('https://api.resend.com/')) { sent.push(JSON.parse(opts.body)); return { ok: true, async json() { return {}; } }; }
      if (u.includes('/employer_purchases') && (opts.method || 'POST') === 'POST') return { ok: true, async json() { return [{ id: 9 }]; } };
      return { ok: true, async json() { return {}; } };
    };
    await fulfillEmployerCheckout(baseSession({ id: 'cs_x1', metadata: { kind: 'employer', employer_sku: 'verified90', company: '<img src=x onerror=alert(1)>', target: 'javascript:alert(1)' } }), ENV);
    await fulfillEmployerCheckout(baseSession({ id: 'cs_x2', metadata: { kind: 'employer', employer_sku: 'verified90', company: 'Acme', target: 'https://acme.com/j?a=1" onclick="x' } }), ENV);
    assert.equal(sent.length, 2);
    assert.ok(!sent[0].html.includes('<img'), 'company is escaped');
    assert.ok(!/href="javascript:/i.test(sent[0].html), 'no javascript: link');
    assert.ok(sent[1].html.includes('href="https://acme.com/j?a=1%22%20onclick=%22x"'), sent[1].html);
  } finally { delete process.env.RESEND_KEY; delete process.env.OWNER_EMAIL; }
});

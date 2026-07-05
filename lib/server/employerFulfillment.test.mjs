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
  assert.equal(isEmployerSession({ metadata: { sku: 'sprint' } }), false); // consumer SKU, not employer
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

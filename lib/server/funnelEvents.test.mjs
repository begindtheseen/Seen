import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { FUNNEL_EVENTS, CLIENT_EVENTS, LEGACY_EVENTS, OFFER_SURFACES, FUNNEL_SKUS, funnelRow, recordFunnelEvent } from './funnelEvents.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const migration = readFileSync(path.join(root, 'supabase', 'migrations', '20261025160000_funnel_steps.sql'), 'utf8');

test('the migration allows exactly the names, surfaces and SKUs the code writes', () => {
  const list = (re) => [...(migration.match(re)?.[1] || '').matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);
  assert.deepEqual(list(/CHECK \(event IN \(([\s\S]*?)\)\)/), FUNNEL_EVENTS);
  assert.deepEqual(list(/surface IN \(([^)]*)\)/), OFFER_SURFACES);
  assert.deepEqual(list(/sku IN \(([^)]*)\)/), FUNNEL_SKUS);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS surface text/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS sku text/);
  assert.doesNotMatch(migration, /\bDROP TABLE\b|\bDELETE\b|\bUPDATE\b|NOT NULL/, 'additive only');
});

test('browsers can post offer and view steps, never checkout or build steps', () => {
  for (const e of ['checkout_started', 'checkout_completed', 'prep_built']) {
    assert.ok(!CLIENT_EVENTS.includes(e));
    assert.equal(funnelRow({ event: e }, { client: true }), null);
    assert.ok(funnelRow({ event: e }));
  }
  for (const e of ['pricing_view', 'offer_shown', 'offer_clicked', 'prep_preview_shown', ...LEGACY_EVENTS.filter((x) => x !== 'prep_built')]) {
    assert.ok(funnelRow({ event: e }, { client: true }), e);
  }
  assert.equal(funnelRow({ event: 'nope' }), null);
});

test('unknown surfaces and SKUs are dropped, the company is cleaned', () => {
  assert.deepEqual(funnelRow({ event: 'offer_shown', surface: 'evil', sku: 'free_money', company: ' Walmart\n' }), { user_id: null, event: 'offer_shown', company: 'Walmart', surface: null, sku: null });
  assert.deepEqual(funnelRow({ event: 'offer_clicked', surface: 'pricing', sku: 'pass30', user_id: 'u1' }), { user_id: 'u1', event: 'offer_clicked', company: null, surface: 'pricing', sku: 'pass30' });
});

function db(results) {
  const calls = [];
  const fn = async (p, opts) => { calls.push({ p, body: JSON.parse(opts.body) }); const ok = results.shift(); return { ok, status: ok ? 201 : 400 }; };
  return { fn, calls };
}

test('after the migration: one insert carrying surface and sku', async () => {
  const { fn, calls } = db([true]);
  assert.equal(await recordFunnelEvent(fn, funnelRow({ event: 'offer_shown', surface: 'company_page', sku: 'interview', company: 'Walmart' })), true);
  assert.deepEqual(calls.map((c) => c.body), [{ user_id: null, event: 'offer_shown', company: 'Walmart', surface: 'company_page', sku: 'interview' }]);
});

test('before the migration: the tracker card offer still counts under its old name; other new steps quietly do not', async () => {
  const card = db([false, true]);
  assert.equal(await recordFunnelEvent(card.fn, funnelRow({ event: 'offer_clicked', surface: 'tracker_prep', sku: 'interview', company: 'Target' })), true);
  assert.deepEqual(card.calls[1].body, { user_id: null, event: 'prep_offer_clicked', company: 'Target' });

  const pricing = db([false]);
  assert.equal(await recordFunnelEvent(pricing.fn, funnelRow({ event: 'offer_shown', surface: 'pricing' })), false);
  assert.equal(pricing.calls.length, 1, 'no retry for a step the old table cannot hold');

  const legacy = db([false, true]);
  assert.equal(await recordFunnelEvent(legacy.fn, funnelRow({ event: 'guest_email_shown', company: 'Kohl’s' })), false, 'a plain legacy row that failed is not retried identically');
  assert.equal(legacy.calls.length, 1);
});

test('a failing database never throws', async () => {
  assert.equal(await recordFunnelEvent(async () => { throw new Error('down'); }, funnelRow({ event: 'pricing_view' })), false);
  assert.equal(await recordFunnelEvent(async () => null, null), false);
});

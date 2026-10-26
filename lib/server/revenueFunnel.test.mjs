import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRevenueFunnel, impliedMonthly, rate } from './revenueFunnel.js';

// recording: funnel_events exists (migration 20261025120000); steps: its surface/sku columns exist (20261025160000).
function fakeDb({ recording = true, steps = true, counts = {}, tracked = [], buyers = [] } = {}) {
  const calls = [];
  const db = async (path) => {
    calls.push(path);
    const table = path.split('?')[0];
    if (table === 'funnel_events' && !recording) return { ok: false, status: 404, headers: { get: () => null } };
    if (table === 'funnel_events' && !steps && path.includes('select=surface,sku')) return { ok: false, status: 400, headers: { get: () => null } };
    if (table === 'applications' && path.includes('select=user_id')) return { ok: true, json: async () => tracked };
    if (table === 'credit_transactions' && path.includes('select=user_id')) return { ok: true, json: async () => buyers };
    // Longest matching key wins, so 'event=eq.offer_shown&surface=eq.pricing' beats 'event=eq.offer_shown'.
    const key = Object.keys(counts).filter((k) => path.includes(k)).sort((a, b) => b.length - a.length)[0];
    const n = key ? counts[key] : 0;
    return { ok: true, headers: { get: (h) => (h === 'content-range' ? `0-0/${n}` : null) }, json: async () => [] };
  };
  return { db, calls };
}

test('rate and impliedMonthly are plain arithmetic on counts', () => {
  assert.equal(rate(3, 10), 30);
  assert.equal(rate(1, 0), null);
  const m = impliedMonthly({ interviews: 20, shown: 20, clicked: 5, purchases: 2, days: 30 });
  assert.equal(m.interviews_per_month, 20);
  assert.equal(m.take_rate_pct, 10);
  assert.equal(m.dollars, 19.98);
  assert.equal(impliedMonthly({ interviews: 5, shown: 0, clicked: 0, purchases: 0, days: 30 }), null);
});

test('funnel counts every step, both products in dollars, and the offer by page', async () => {
  const { db } = fakeDb({
    counts: {
      'event=eq.prep_offer_shown': 30, 'event=eq.prep_offer_clicked': 6, 'event=eq.prep_built': 3,
      'event=eq.offer_shown&surface=eq.tracker_prep': 10, 'event=eq.offer_clicked&surface=eq.tracker_prep': 2,
      'event=eq.offer_shown&surface=eq.pricing': 40, 'event=eq.offer_clicked&surface=eq.pricing': 4,
      'event=eq.offer_shown&surface=eq.company_page': 100, 'event=eq.offer_clicked&surface=eq.company_page': 1,
      'event=eq.pricing_view': 55, 'event=eq.prep_preview_shown': 9, 'event=eq.checkout_started': 8, 'event=eq.checkout_completed': 6,
      'reason=eq.purchase_interview': 4, 'reason=eq.purchase_pass30': 2, 'reason=eq.purchase_credits20': 1,
      'profiles?': 12, 'stage=in.': 10, 'event=eq.guest_email_shown': 50, 'event=eq.guest_email_given': 5, 'ai_credits?': 3,
    },
    tracked: [{ user_id: 'a' }, { user_id: 'a' }, { user_id: 'b' }],
    buyers: [{ user_id: 'a' }, { user_id: 'a' }, { user_id: 'c' }],
  });
  const r = await loadRevenueFunnel(db, { days: 30 });
  assert.equal(r.recording, true);
  assert.equal(r.recording_steps, true);
  const step = (k) => r.steps.find((s) => s.key === k).n;
  assert.equal(step('tracked'), 2, 'distinct users');
  assert.equal(step('prep_offer_shown'), 40, 'old name (30) + new tracker_prep rows (10)');
  assert.equal(step('prep_offer_clicked'), 8);
  assert.equal(step('pricing_view'), 55);
  assert.equal(step('prep_preview_shown'), 9);
  assert.equal(step('checkout_started'), 8);
  assert.equal(step('checkout_completed'), 6);
  assert.equal(step('prep_purchases'), 4);
  assert.equal(step('pass_purchases'), 2);
  assert.equal(r.revenue.interview_prep, 39.96);
  assert.equal(r.revenue.job_search_pass, 39.98);
  assert.equal(r.revenue.credit_pack, 4.99);
  assert.equal(r.revenue.total, 84.93);
  assert.equal(r.revenue.paying_customers, 2, 'distinct buyers in the window');
  assert.equal(r.revenue.legacy_subscriptions_marked_pro, 3);
  assert.equal(r.revenue.paying_subscribers_now, undefined, 'trials and comps are never reported as paying');
  assert.deepEqual(r.surfaces.find((x) => x.surface === 'pricing'), { surface: 'pricing', shown: 40, clicked: 4 });
  assert.deepEqual(r.surfaces.find((x) => x.surface === 'company_page'), { surface: 'company_page', shown: 100, clicked: 1 });
  assert.equal(r.rates.offer_click, 20);
  assert.equal(r.rates.checkout, 50);
  assert.equal(r.rates.checkout_completion, 75);
  assert.equal(r.rates.email, 10);
  assert.ok(r.implied.dollars > 0);
});

test('paying customers come only from purchases: a no-card trial or a comp (no purchase row) is not counted', async () => {
  const { db, calls } = fakeDb({ counts: { 'ai_credits?': 5 }, buyers: [] });
  const r = await loadRevenueFunnel(db, { days: 30 });
  assert.equal(r.revenue.paying_customers, 0);
  assert.equal(r.revenue.legacy_subscriptions_marked_pro, 5, 'shown on its own line, never as revenue');
  assert.ok(calls.some((p) => p.startsWith('credit_transactions?select=user_id&reason=in.(purchase_interview,purchase_pass30,purchase_credits20)')));
});

test('before migration 20261025160000 the new steps read null while the old ones still count', async () => {
  const { db } = fakeDb({ steps: false, counts: { 'event=eq.prep_offer_shown': 7, 'event=eq.pricing_view': 99 } });
  const r = await loadRevenueFunnel(db, { days: 30 });
  assert.equal(r.recording, true);
  assert.equal(r.recording_steps, false);
  assert.equal(r.steps.find((s) => s.key === 'prep_offer_shown').n, 7);
  assert.equal(r.steps.find((s) => s.key === 'pricing_view').n, null);
  assert.ok(r.surfaces.every((x) => x.shown === null && x.clicked === null));
});

test('before migration 20261025120000 the event steps read null, never 0', async () => {
  const { db } = fakeDb({ recording: false, counts: { 'profiles?': 3 } });
  const r = await loadRevenueFunnel(db, { days: 7 });
  assert.equal(r.recording, false);
  assert.equal(r.steps.find((s) => s.key === 'prep_offer_shown').n, null);
  assert.equal(r.steps.find((s) => s.key === 'signups').n, 3);
  assert.equal(r.implied, null);
});

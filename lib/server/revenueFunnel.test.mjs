import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRevenueFunnel, impliedMonthly, rate } from './revenueFunnel.js';

function fakeDb({ recording = true, counts = {}, tracked = [] } = {}) {
  const calls = [];
  const db = async (path) => {
    calls.push(path);
    const table = path.split('?')[0];
    if (table === 'funnel_events' && !recording) return { ok: false, status: 404, headers: { get: () => null } };
    if (table === 'applications' && path.includes('select=user_id')) return { ok: true, json: async () => tracked };
    const key = Object.keys(counts).find((k) => path.includes(k));
    const n = key ? counts[key] : 0;
    return { ok: true, headers: { get: (h) => (h === 'content-range' ? `0-0/${n}` : null) }, json: async () => [] };
  };
  return { db, calls };
}

test('rate and impliedMonthly are plain arithmetic on counts', () => {
  assert.equal(rate(3, 10), 30);
  assert.equal(rate(1, 0), null);
  const m = impliedMonthly({ interviews: 20, shown: 20, clicked: 5, prepPurchases: 2, days: 30 });
  assert.equal(m.interviews_per_month, 20);
  assert.equal(m.take_rate_pct, 10);
  assert.equal(m.dollars, 19.98);
  assert.equal(impliedMonthly({ interviews: 5, shown: 0, clicked: 0, prepPurchases: 0, days: 30 }), null);
});

test('funnel counts every step and reports purchases in dollars', async () => {
  const { db } = fakeDb({
    counts: { 'event=eq.prep_offer_shown': 40, 'event=eq.prep_offer_clicked': 8, 'event=eq.prep_built': 3, 'reason=eq.purchase_interview': 4, 'reason=eq.purchase_credits20': 1, 'profiles?': 12, 'stage=in.': 10, 'event=eq.guest_email_shown': 50, 'event=eq.guest_email_given': 5, 'ai_credits?': 2 },
    tracked: [{ user_id: 'a' }, { user_id: 'a' }, { user_id: 'b' }],
  });
  const r = await loadRevenueFunnel(db, { days: 30 });
  assert.equal(r.recording, true);
  const step = (k) => r.steps.find((s) => s.key === k).n;
  assert.equal(step('tracked'), 2, 'distinct users');
  assert.equal(step('prep_purchases'), 4);
  assert.equal(r.revenue.interview_prep, 39.96);
  assert.equal(r.revenue.credit_pack, 4.99);
  assert.equal(r.rates.offer_click, 20);
  assert.equal(r.rates.checkout, 50);
  assert.equal(r.rates.email, 10);
  assert.ok(r.implied.dollars > 0);
});

test('before the migration the event steps read null, never 0', async () => {
  const { db } = fakeDb({ recording: false, counts: { 'profiles?': 3 } });
  const r = await loadRevenueFunnel(db, { days: 7 });
  assert.equal(r.recording, false);
  assert.equal(r.steps.find((s) => s.key === 'prep_offer_shown').n, null);
  assert.equal(r.steps.find((s) => s.key === 'signups').n, 3);
  assert.equal(r.implied, null);
});

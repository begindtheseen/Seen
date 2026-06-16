// Tests for the company scoring engine. Run: node --test api/_utils/companyScore.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calcOverallScore, calcWaste, tenureAdjustment, scoreConfidence, fuseScore, MIN_TENURE_SAMPLE,
  parseMonthIndex, aggregateTenure,
} from './companyScore.js';

test('base formula matches the historical _calcScore', () => {
  // Re-implements the original formula to lock parity.
  const ref = (rr, gr, wait, cnt) => Math.max(0, Math.min(100, Math.round(
    50 + rr * 40 + gr * -30 + Math.min(wait / 60, 1) * -15 + Math.log(cnt + 1) * 5)));
  for (const [rr, gr, wait, cnt] of [[0.8, 0.06, 8, 47], [0.08, 0.86, 52, 1240], [0.5, 0.5, 30, 0]]) {
    assert.equal(calcOverallScore(rr, gr, wait, cnt), ref(rr, gr, wait, cnt));
  }
});

test('waste formula matches the historical _calcWaste', () => {
  assert.equal(calcWaste(0.86, 5, 0.2), Math.round(0.86 * 60 + 0.2 * 25 + 15));
  assert.equal(calcWaste(0.1, 2, 0), Math.round(0.1 * 60));
});

test('no tenure data → fused score equals the base formula (no regression)', () => {
  const r = fuseScore({ responseRate: 0.08, ghostRate: 0.86, avgWaitDays: 52, reportCount: 1240 });
  assert.equal(r.overall_score, r.base_score);
  assert.equal(r.tenure_adjustment, 0);
  assert.equal(r.signals.tenure_applied, false);
});

test('tenure is gated by minimum sample', () => {
  assert.equal(tenureAdjustment(60, MIN_TENURE_SAMPLE - 1), 0); // too few samples
  assert.ok(tenureAdjustment(60, 10) > 0); // 5y tenure, full sample → bonus
});

test('long tenure boosts, short tenure penalizes, both bounded ±8', () => {
  const longT = tenureAdjustment(60, 10);   // 5 years
  const shortT = tenureAdjustment(8, 10);    // 8 months
  assert.ok(longT > 0 && longT <= 8);
  assert.ok(shortT < 0 && shortT >= -8);
});

test('tenure strength scales with sample size', () => {
  const few = tenureAdjustment(60, 5);
  const many = tenureAdjustment(60, 20);
  assert.ok(many >= few);
});

test('fuseScore applies tenure on top of base, clamped to 0–100', () => {
  const r = fuseScore({ responseRate: 0.8, ghostRate: 0.05, avgWaitDays: 8, reportCount: 50, avgTenureMonths: 60, tenureSample: 12 });
  assert.equal(r.overall_score, Math.max(0, Math.min(100, r.base_score + r.tenure_adjustment)));
  assert.ok(r.tenure_adjustment > 0);
  assert.equal(r.signals.tenure_applied, true);
});

test('confidence rises with reports + tenure, decays when stale', () => {
  const thin = scoreConfidence({ reportCount: 1, tenureSample: 0 });
  const rich = scoreConfidence({ reportCount: 20, tenureSample: 12 });
  assert.ok(rich > thin);
  assert.equal(rich, 1);
  const stale = scoreConfidence({ reportCount: 20, tenureSample: 12, dataAgeDays: 540 });
  assert.ok(stale < rich);
});

test('thin data is flagged not sufficient; rich data is sufficient', () => {
  assert.equal(fuseScore({ reportCount: 1 }).sufficient, false);
  assert.equal(fuseScore({ reportCount: 20, tenureSample: 12 }).sufficient, true);
});

test('confidence labels bucket correctly', () => {
  assert.equal(fuseScore({ reportCount: 20, tenureSample: 12 }).confidence_label, 'high');
  assert.equal(fuseScore({ reportCount: 0 }).confidence_label, 'low');
});

test('parseMonthIndex handles common résumé date formats', () => {
  assert.equal(parseMonthIndex('2020'), 2020 * 12);
  assert.equal(parseMonthIndex('Jan 2020'), 2020 * 12);
  assert.equal(parseMonthIndex('Jun 2021'), 2021 * 12 + 5);
  assert.equal(parseMonthIndex('03/2019'), 2019 * 12 + 2);
  assert.equal(parseMonthIndex('Present'), null);
  assert.equal(parseMonthIndex(''), null);
});

test('aggregateTenure averages months per company with sample counts', () => {
  const norm = (c) => (c || '').toLowerCase().trim();
  const rows = [
    { company: 'Stripe', start_date: '2018', end_date: '2022' },      // 48mo
    { company: 'stripe', start_date: 'Jan 2020', end_date: 'Jan 2021' }, // 12mo
    { company: 'Meta', start_date: '2021', end_date: 'Present' },     // open-ended
    { company: 'X', start_date: 'garbage', end_date: 'also bad' },    // skipped
  ];
  const out = aggregateTenure(rows, norm, { now: new Date('2023-01-15').getTime() });
  assert.equal(out.stripe.sample, 2);
  assert.equal(out.stripe.avg_tenure_months, 30); // (48 + 12) / 2
  assert.equal(out.meta.sample, 1);
  assert.ok(out.meta.avg_tenure_months >= 20); // ~24 months to Jan 2023
  assert.ok(!('x' in out)); // unparseable rows dropped
});

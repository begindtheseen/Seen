import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wilsonInterval, wilsonLowerBound } from './wilson.js';

const near = (a, b, eps = 0.02) => Math.abs(a - b) <= eps;

test('n<=0 → full uncertainty [0,1]', () => {
  assert.deepEqual(wilsonInterval(0, 0), { lower: 0, upper: 1, n: 0 });
  assert.deepEqual(wilsonInterval(5, -3), { lower: 0, upper: 1, n: 0 });
});

test('small-n high rate is heavily discounted vs large-n', () => {
  // 2/2 = 100% raw, but Wilson lower ≈ 0.34; 40/50 = 80% raw, Wilson lower ≈ 0.67.
  const lowSmall = wilsonLowerBound(2, 2);
  const lowLarge = wilsonLowerBound(40, 50);
  assert.ok(near(lowSmall, 0.34), `2/2 lower ${lowSmall}`);
  assert.ok(near(lowLarge, 0.67), `40/50 lower ${lowLarge}`);
  // The gaming-resistance property: a "perfect" tiny sample ranks BELOW a strong large sample.
  assert.ok(lowSmall < lowLarge);
});

test('interval brackets the point estimate and stays in [0,1]', () => {
  const { lower, upper } = wilsonInterval(30, 100);
  assert.ok(lower < 0.30 && 0.30 < upper);
  assert.ok(lower >= 0 && upper <= 1);
  // more data → tighter interval
  const wide = wilsonInterval(3, 10);
  const tight = wilsonInterval(300, 1000);
  assert.ok((wide.upper - wide.lower) > (tight.upper - tight.lower));
});

test('clamps counts: pos capped at n, negatives floored', () => {
  const iv = wilsonInterval(999, 10); // pos > n → treated as 10/10
  assert.ok(iv.upper === 1 || iv.upper > 0.7);
  assert.equal(wilsonInterval(-5, 10).lower, 0);
});

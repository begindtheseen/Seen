// Modifiers move listings, never hide them. Run: node --test lib/jobs/searchModifiers.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modifierBoost, hourlyTop, hasModifiers, modifierLabels } from './searchModifiers.js';

test('stated pay reads as an hourly top figure', () => {
  assert.equal(hourlyTop('$19.90/hr'), 19.9);
  assert.equal(hourlyTop('$23.00 - $25.00 per hour'), 25);
  assert.ok(Math.abs(hourlyTop('$45,000 - $55,000 a year') - 26.44) < 0.01);
  assert.equal(hourlyTop(''), null);
  assert.equal(hourlyTop('Competitive'), null);
});

test('each modifier moves the listings that say it up and the ones that contradict it down', () => {
  const pt = { title: 'Cashier - Part Time', type: 'Part-time' };
  const ft = { title: 'Cashier (Full-Time)', type: 'Full-time' };
  assert.ok(modifierBoost(pt, { partTime: true }) > 0);
  assert.ok(modifierBoost(ft, { partTime: true }) < 0);
  assert.ok(modifierBoost({ title: 'Junior Marketing Associate' }, { entry: true }) > 0);
  assert.ok(modifierBoost({ title: 'Senior Marketing Manager' }, { entry: true }) < 0);
  assert.ok(modifierBoost({ title: 'Overnight Stocker' }, { night: true }) > 0);
  assert.ok(modifierBoost({ title: 'Cashier', salary: '$21/hr' }, { payMin: 20 }) > 0);
  assert.ok(modifierBoost({ title: 'Cashier', salary: '$15/hr' }, { payMin: 20 }) < 0);
  assert.equal(modifierBoost({ title: 'Cashier' }, { payMin: 20 }), 0, 'no stated pay: not moved');
  assert.equal(modifierBoost(pt, null), 0);
});

test('labels and presence', () => {
  assert.equal(hasModifiers({ remote: true }), false, 'remote is a filter, not a ranking nudge');
  assert.equal(hasModifiers({ partTime: true }), true);
  assert.deepEqual(modifierLabels({ partTime: true, night: true, payMin: 20 }), ['part-time', 'night shift', '$20+/hr']);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickRenewalReminders } from './renewalReminders.js';

const DAY = 86400000;
const NOW = 1_700_000_000_000;
const inDays = (n) => new Date(NOW + n * DAY).toISOString();

test('empty / malformed input yields nothing', () => {
  assert.deepEqual(pickRenewalReminders(null, NOW), []);
  assert.deepEqual(pickRenewalReminders([{ company: 'Acme' }], NOW), []);
});

test('reminds only for perks lapsing within the window, not lapsed or far-off', () => {
  const perks = [
    { company: 'Soon', featured_until: inDays(3) },     // within 7d → remind
    { company: 'FarOff', featured_until: inDays(20) },  // outside window → skip
    { company: 'Lapsed', featured_until: inDays(-2) },  // already expired → skip (pre-expiry only)
  ];
  const out = pickRenewalReminders(perks, NOW, 7);
  assert.equal(out.length, 1);
  assert.equal(out[0].company, 'Soon');
  assert.equal(out[0].daysLeft, 3);
  assert.equal(out[0].reminderKey, inDays(3));
});

test('soonest-expiring perk drives the key; lists all expiring perks', () => {
  const perks = [{ company: 'Multi', verified_until: inDays(6), sponsor_until: inDays(2) }];
  const out = pickRenewalReminders(perks, NOW, 7);
  assert.equal(out.length, 1);
  assert.equal(out[0].reminderKey, inDays(2)); // sponsor expires first
  assert.equal(out[0].daysLeft, 2);
  assert.deepEqual(out[0].items.map(i => i.kind), ['sponsor', 'verified']);
});

test('idempotent: already reminded for this period is skipped, but a renewal re-arms it', () => {
  const already = [{ company: 'Done', featured_until: inDays(3), renewal_reminded_until: inDays(3) }];
  assert.deepEqual(pickRenewalReminders(already, NOW, 7), []);

  // Renewed to a later date → key changes → eligible again once it re-enters the window.
  const renewed = [{ company: 'Done', featured_until: inDays(5), renewal_reminded_until: inDays(3) }];
  const out = pickRenewalReminders(renewed, NOW, 7);
  assert.equal(out.length, 1);
  assert.equal(out[0].reminderKey, inDays(5));
});

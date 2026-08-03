import { test } from 'node:test';
import assert from 'node:assert/strict';
import { perkStatus, EXPIRING_WINDOW_DAYS } from './perkStatus.js';

const DAY = 86400000;
const NOW = 1_700_000_000_000;
const inDays = (n) => new Date(NOW + n * DAY).toISOString();

test('none when never purchased / malformed', () => {
  const r = perkStatus(null, NOW);
  assert.equal(r.featured.state, 'none');
  assert.equal(r.verified.state, 'none');
  assert.equal(r.anyRenewable, false);
  assert.equal(perkStatus({ featured_until: 'garbage' }, NOW).featured.state, 'none');
});

test('active perk (well in the future) is not renewable', () => {
  const r = perkStatus({ featured_until: inDays(20), verified_until: inDays(60) }, NOW);
  assert.equal(r.featured.state, 'active');
  assert.equal(r.featured.daysLeft, 20);
  assert.equal(r.verified.state, 'active');
  assert.equal(r.anyRenewable, false);
});

test('expiring within the window flips anyRenewable', () => {
  const r = perkStatus({ featured_until: inDays(3) }, NOW);
  assert.equal(r.featured.state, 'expiring');
  assert.equal(r.featured.daysLeft, 3);
  assert.equal(r.anyRenewable, true);
  // boundary: exactly the window is still "expiring"
  assert.equal(perkStatus({ featured_until: inDays(EXPIRING_WINDOW_DAYS) }, NOW).featured.state, 'expiring');
  // one day past the window is "active"
  assert.equal(perkStatus({ featured_until: inDays(EXPIRING_WINDOW_DAYS + 1) }, NOW).featured.state, 'active');
});

test('expired perk is renewable and reports a non-positive daysLeft', () => {
  const r = perkStatus({ verified_until: inDays(-2) }, NOW);
  assert.equal(r.verified.state, 'expired');
  assert.ok(r.verified.daysLeft <= 0);
  assert.equal(r.anyRenewable, true);
});

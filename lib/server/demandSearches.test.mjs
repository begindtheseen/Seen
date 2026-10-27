// The searches people ran, kept fresh by the refresh cron. Run: node --test lib/server/demandSearches.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickDemandSearches } from './demandSearches.js';

const NOW = Date.parse('2026-10-27T12:00:00Z');
const at = (hoursAgo) => new Date(NOW - hoursAgo * 3600_000).toISOString();

test('most-searched pairs first, places resolved, roles read, junk and fresh pairs skipped', () => {
  const rows = [
    { query: 'cashier', location: 'phoenix, az', pulled_at: at(30) },
    { query: 'cashier', location: 'phoenix az', pulled_at: at(50) },
    { query: 'part time cashir', location: 'Phoenix, Arizona', pulled_at: at(70) },
    { query: 'valet', location: 'anahiem ca', pulled_at: at(40) },
    { query: 'host', location: 'anahiem ca', pulled_at: at(3) }, // a person's search refreshed it 3 hours ago
    { query: 'see', location: 'cerritos, ca', pulled_at: at(40) },
    { query: ', subscribers .', location: 'chicago, il', pulled_at: at(40) },
    { query: 'warehouse', location: 'xyzzy town', pulled_at: at(40) }, // an unreadable place
    { query: 'backend engineer', location: '', pulled_at: at(40) }, // nationwide
    { query: 'data entry', location: 'remote', pulled_at: at(40) },
  ];
  const out = pickDemandSearches(rows, { now: NOW, limit: 8 });
  assert.deepEqual(out[0], { what: 'cashier', where: 'Phoenix, AZ', searches: 3 });
  const keys = out.map((o) => `${o.what} @ ${o.where}`);
  assert.ok(keys.includes('valet @ Anaheim, CA'));
  assert.ok(keys.includes('data entry @ Remote'));
  for (const bad of ['host @ Anaheim, CA', 'see @ Cerritos, CA']) assert.ok(!keys.includes(bad), bad);
  assert.ok(!keys.some((k) => /subscribers|backend engineer|warehouse/.test(k)), keys.join(', '));
});

test('pairs the catalog already covers this run are left to the catalog', () => {
  const rows = [{ query: 'cashier', location: 'Phoenix, AZ', pulled_at: at(30) }, { query: 'barista', location: 'Phoenix, AZ', pulled_at: at(30) }];
  const out = pickDemandSearches(rows, { now: NOW, exclude: [{ what: 'cashier', where: 'Phoenix, AZ' }] });
  assert.deepEqual(out.map((o) => o.what), ['barista']);
});

// Run: node --test lib/server/indeedPresets.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPresets, maintenanceSearches, demandSearches, isoWeek } from './indeedPresets.js';
import { JOB_SEARCH_GROUPS } from './jobSearchCatalog.js';

test('maintenance: 2 searches from EVERY niche, a different slice each week, every search covered in 10 weeks', () => {
  const w = maintenanceSearches(new Date('2026-10-20T12:00:00Z'));
  assert.equal(w.week, 43);
  assert.equal(w.searches.length, JOB_SEARCH_GROUPS.length * 2);
  assert.deepEqual([...new Set(w.searches.map((s) => s.niche))], JOB_SEARCH_GROUPS.map((g) => g.label));
  const next = maintenanceSearches(new Date('2026-10-27T12:00:00Z'));
  assert.notDeepEqual(next.searches, w.searches, 'the rotation moves weekly');
  const seen = new Set();
  for (let k = 0; k < 10; k++) for (const s of maintenanceSearches(new Date(Date.UTC(2026, 9, 20 + 7 * k))).searches) seen.add(`${s.query}|${s.location}`);
  assert.equal(seen.size, 260, 'ten weekly runs cover every niche search');
  assert.equal(isoWeek(new Date('2026-01-01T00:00:00Z')), 1);
});

test('demand: real searches only (2+), most searched first, at their most-searched location, state codes upper-case', () => {
  const rows = [
    { query: 'Warehouse Worker', location: 'boise, id', result_count: 70 }, { query: 'warehouse  worker', location: 'Boise, ID', result_count: 72 },
    { query: 'warehouse worker', location: 'tulsa', result_count: 5 },
    { query: 'Dollar Tree', location: 'hemet', result_count: 0 }, { query: 'dollar tree', location: '', result_count: 0 },
    { query: 'seen jobs', location: '', result_count: 30 }, { query: 'seen jobs', location: '', result_count: 30 },
    { query: 'welder', location: 'tulsa', result_count: 40 },
  ];
  const d = demandSearches(rows);
  assert.deepEqual(d.map((x) => x.query), ['Warehouse Worker', 'Dollar Tree'], 'single searches and searches for Seen itself are not demand');
  assert.deepEqual(d[0], { query: 'Warehouse Worker', location: 'Boise, ID', searches: 3, avg_results: 49 });
  assert.equal(d[1].location, 'Hemet');
  const p = buildPresets(rows, new Date('2026-10-20T12:00:00Z'));
  assert.deepEqual(p.thin.searches.map((x) => x.query), ['Dollar Tree'], 'thin = demand that returned under 10 results');
  assert.equal(p.niches.length, 13);
  assert.deepEqual(p.niches[0].searches[0], { query: 'Registered Nurse', location: 'Los Angeles, CA' });
});

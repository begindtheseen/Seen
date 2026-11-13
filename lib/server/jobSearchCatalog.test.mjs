// The niche list is shared by the job-refresh cron and the Indeed presets. The cron batches it by
// index, so moving it into this module must not change a single search or its order.
// Run: node --test lib/server/jobSearchCatalog.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { JOB_SEARCH_GROUPS, JOB_SEARCHES } from './jobSearchCatalog.js';

test('the cron list is unchanged: the first 260 searches in 13 niches, same order as before the move', () => {
  // The 260 searches that existed before 2026-11-13 hold their exact positions (the cron batches by index).
  const hash = createHash('sha256').update(JSON.stringify(JOB_SEARCHES.slice(0, 260).map((s) => [s.what, s.where]))).digest('hex');
  assert.equal(hash, '9e0d31fa3d3df0922b030e8b95e07c63b60820b964613631e71ffb65faaee7aa');
  assert.deepEqual(JOB_SEARCH_GROUPS.slice(0, 13).map((g) => g.id).at(-1), 'education-services');
  assert.deepEqual(JOB_SEARCHES[0], { what: 'Registered Nurse', where: 'Los Angeles, CA' });
  assert.equal(new Set(JOB_SEARCH_GROUPS.map((g) => g.id)).size, JOB_SEARCH_GROUPS.length, 'niche ids are unique');
  for (const g of JOB_SEARCH_GROUPS) assert.ok(g.label && g.searches.length, g.id);
});

test('2026-11-13: oilfield entry + trades apprentice searches appended at the END (24), each niche ≤20', () => {
  assert.equal(JOB_SEARCH_GROUPS.length, 15);
  assert.equal(JOB_SEARCHES.length, 284);
  assert.deepEqual(JOB_SEARCH_GROUPS.slice(13).map((g) => [g.id, g.searches.length]), [['oilfield-entry', 14], ['trades-apprentice', 10]]);
  assert.deepEqual(JOB_SEARCHES[260], { what: 'Floorhand', where: 'Midland, TX' });
  for (const g of JOB_SEARCH_GROUPS) assert.ok(g.searches.length <= 20, `${g.id}: the 10-week Indeed rotation covers ≤20 per niche`);
  assert.equal(new Set(JOB_SEARCHES.map((s) => `${s.what}|${s.where}`)).size, JOB_SEARCHES.length, 'no search repeats');
});

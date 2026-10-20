// The niche list is shared by the job-refresh cron and the Indeed presets. The cron batches it by
// index, so moving it into this module must not change a single search or its order.
// Run: node --test lib/server/jobSearchCatalog.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { JOB_SEARCH_GROUPS, JOB_SEARCHES } from './jobSearchCatalog.js';

test('the cron list is unchanged: 260 searches in 13 niches, same order as before the move', () => {
  assert.equal(JOB_SEARCH_GROUPS.length, 13);
  assert.equal(JOB_SEARCHES.length, 260);
  const hash = createHash('sha256').update(JSON.stringify(JOB_SEARCHES.map((s) => [s.what, s.where]))).digest('hex');
  assert.equal(hash, '9e0d31fa3d3df0922b030e8b95e07c63b60820b964613631e71ffb65faaee7aa');
  assert.deepEqual(JOB_SEARCHES[0], { what: 'Registered Nurse', where: 'Los Angeles, CA' });
  assert.equal(new Set(JOB_SEARCH_GROUPS.map((g) => g.id)).size, 13, 'niche ids are unique');
  for (const g of JOB_SEARCH_GROUPS) assert.ok(g.label && g.searches.length, g.id);
});

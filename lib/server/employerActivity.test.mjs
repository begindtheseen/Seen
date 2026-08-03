import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shapeApplyActivity } from './employerActivity.js';

const DAY = 86400000;
const NOW = 1_700_000_000_000; // fixed clock for deterministic windows
const at = (daysAgo, over = {}) => ({ role: 'Engineer', city: 'Austin', created_at: new Date(NOW - daysAgo * DAY).toISOString(), ...over });

test('empty / non-array input → zeroed shape', () => {
  const r = shapeApplyActivity([], NOW);
  assert.deepEqual(r, { total: 0, last7: 0, last30: 0, byRole: [], recent: [], activeRoles: 0 });
  assert.equal(shapeApplyActivity(null, NOW).total, 0);
  assert.equal(shapeApplyActivity(undefined, NOW).total, 0);
});

test('7/30-day windows count correctly', () => {
  const events = [at(1), at(3), at(10), at(20), at(40)];
  const r = shapeApplyActivity(events, NOW);
  assert.equal(r.total, 5);
  assert.equal(r.last7, 2);   // 1d, 3d
  assert.equal(r.last30, 4);  // 1,3,10,20 (40 is outside)
});

test('per-role breakdown is grouped, counted, and sorted by volume', () => {
  const events = [
    at(1, { role: 'Engineer' }), at(2, { role: 'Engineer' }), at(3, { role: 'Engineer' }),
    at(1, { role: 'Designer' }),
    at(2, { role: '' }), // blank → "Unspecified role"
  ];
  const r = shapeApplyActivity(events, NOW);
  assert.equal(r.activeRoles, 3);
  assert.equal(r.byRole[0].role, 'Engineer');
  assert.equal(r.byRole[0].count, 3);
  assert.equal(r.byRole[0].count7, 3);
  assert.ok(r.byRole.some(x => x.role === 'Unspecified role'));
});

test('recent list is newest-first, capped, and NEVER exposes identity fields', () => {
  const events = Array.from({ length: 20 }, (_, i) => at(i, { user_id: 'secret-uid', role: `Role ${i}` }));
  const r = shapeApplyActivity(events, NOW);
  assert.equal(r.recent.length, 15); // capped
  assert.equal(r.recent[0].role, 'Role 0'); // newest first
  // privacy: only role/city/created_at ever surface
  for (const row of r.recent) {
    assert.deepEqual(Object.keys(row).sort(), ['city', 'created_at', 'role']);
    assert.equal('user_id' in row, false);
  }
});

test('malformed created_at does not crash windows/sort', () => {
  const r = shapeApplyActivity([{ role: 'X', created_at: 'not-a-date' }, at(1)], NOW);
  assert.equal(r.total, 2);
  assert.equal(r.last7, 1); // only the valid recent one counts
});

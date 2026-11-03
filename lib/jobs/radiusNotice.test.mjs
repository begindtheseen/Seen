// Run: node --test lib/jobs/radiusNotice.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { radiusNotice, leadIds } from './radiusNotice.js';

const rows = (n, p = 'a') => Array.from({ length: n }, (_, i) => ({ id: `${p}${i}` }));

test('radiusNotice: the "Only N within" line, and the same-rows line on a radius change', () => {
  const base = { q: 'team lead', loc: 'Phoenix', radius: '25', total: 60 };
  assert.equal(radiusNotice({ ...base, inRadius: 6 }), 'Only 6 within 25 mi of Phoenix — the rest are further away or remote');
  assert.equal(radiusNotice({ ...base, inRadius: 0 }), 'No team lead jobs within 25 mi of Phoenix — showing the nearest and remote ones');
  assert.equal(radiusNotice({ ...base, inRadius: 60 }), null, 'everything inside → nothing to say');
  assert.equal(radiusNotice({ ...base, inRadius: null }), null);
  // The common path: 25 → 50 mi, identical leading rows.
  const ids = leadIds(rows(60));
  const prev = { key: 'team lead|Phoenix', radius: '25', ids };
  assert.equal(radiusNotice({ ...base, radius: '50', inRadius: 60, prev, ids }),
    'Same listings lead at 50 mi as at 25 mi — nothing closer turned up between 25 and 50 miles of Phoenix.');
  // Different rows, a different title, the same radius, or an "Only N" line → no same-rows line.
  assert.equal(radiusNotice({ ...base, radius: '50', inRadius: 60, prev, ids: leadIds(rows(60, 'b')) }), null);
  assert.equal(radiusNotice({ ...base, q: 'cashier', radius: '50', inRadius: 60, prev, ids }), null);
  assert.equal(radiusNotice({ ...base, radius: '25', inRadius: 60, prev, ids }), null);
  assert.equal(radiusNotice({ ...base, radius: '50', inRadius: 10, prev, ids }), 'Only 10 within 50 mi of Phoenix — the rest are further away or remote');
  // Never for a remote search, no place, no rows, or a fallback page that carries its own label.
  assert.equal(radiusNotice({ ...base, loc: '', inRadius: 6 }), null);
  assert.equal(radiusNotice({ ...base, loc: 'remote', inRadius: 6 }), null);
  assert.equal(radiusNotice({ ...base, radius: '0', inRadius: 6 }), null);
  assert.equal(radiusNotice({ ...base, total: 0, inRadius: 0 }), null);
  assert.equal(radiusNotice({ ...base, inRadius: 6, fallback: 'unrelated' }), null);
  assert.equal(leadIds(rows(3)), 'a0,a1,a2');
  assert.equal(leadIds(rows(20)).split(',').length, 12);
});

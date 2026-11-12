// The matched-jobs rail's kept answer (lib/server/railCache.js): what it depends on, and when it is answered.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { railSignature, railCacheState, REFRESH_MS, MAX_AGE_MS } from './railCache.js';

const base = { resumeUpdatedAt: '2026-11-01T00:00:00Z', city: 'Phoenix, AZ', applications: [{ created_at: '2026-11-10T00:00:00Z' }] };

test('the signature moves with the résumé, the city and the applications — and not with letter case or spacing of the city', () => {
  const s = railSignature(base);
  assert.notEqual(railSignature({ ...base, resumeUpdatedAt: '2026-11-12T00:00:00Z' }), s);
  assert.notEqual(railSignature({ ...base, city: 'Mesa, AZ' }), s);
  assert.notEqual(railSignature({ ...base, applications: [...base.applications, { created_at: '2026-11-12T00:00:00Z' }] }), s);
  assert.equal(railSignature({ ...base, city: '  phoenix, az ' }), s);
});

test('fresh is answered, stale is answered and rebuilt, a different signature or an old copy is rebuilt first', () => {
  const now = Date.parse('2026-11-12T12:00:00Z');
  const sig = railSignature(base);
  const at = (msAgo) => ({ payload: { ok: true }, sig, builtAt: now - msAgo });
  assert.equal(railCacheState(at(60_000), sig, now), 'fresh');
  assert.equal(railCacheState(at(REFRESH_MS + 1000), sig, now), 'stale');
  assert.equal(railCacheState(at(MAX_AGE_MS + 1000), sig, now), 'rebuild');
  assert.equal(railCacheState({ ...at(60_000), sig: 'other' }, sig, now), 'rebuild');
  assert.equal(railCacheState(null, sig, now), 'rebuild');
  assert.equal(railCacheState(at(-60_000), sig, now), 'rebuild', 'a copy dated in the future is not trusted');
});

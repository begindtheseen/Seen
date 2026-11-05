// Ingestion fills missing coordinates from the location text so radius search can measure the row.
// Run: node --test lib/server/jobSources.coords.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { fillCoords, upsertJobs } = await import('./jobSources.js');

test('fillCoords: places a coordinate-less row from its text', () => {
  const r = fillCoords({ title: 'Cashier', location: 'Tempe, AZ' });
  assert.ok(Math.abs(r.lat - 33.415) < 0.01 && Math.abs(r.lng + 111.909) < 0.01, JSON.stringify(r));
  const z = fillCoords({ location: 'Austin, TX 78701', lat: null, lng: null });
  assert.ok(Math.abs(z.lat - 30.27) < 0.02);
});

test('fillCoords: never replaces coordinates a source gave', () => {
  const row = { location: 'Tempe, AZ', lat: 33.1, lng: -111.5 };
  assert.equal(fillCoords(row), row);
});

test('fillCoords: (0,0) is not a coordinate — the text decides', () => {
  const r = fillCoords({ location: 'Mesa, AZ', lat: 0, lng: 0 });
  assert.ok(r.lat > 33 && r.lat < 34);
});

test('fillCoords: remote, state-only and non-US rows stay NULL, with both keys present', () => {
  for (const location of ['Remote', 'Arizona', 'Remote - Texas', 'London, UK', 'La Roca del Valles, Barcelona', '']) {
    const r = fillCoords({ location });
    assert.equal(r.lat, null, location);
    assert.equal(r.lng, null, location);
    assert.ok('lat' in r && 'lng' in r);
  }
});

test('upsertJobs posts the filled coordinates, one shape for the batch', async () => {
  const posts = [];
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('/rest/v1/companies')) return { ok: true, status: 200, async json() { return [{ id: 'c1', name: 'Acme' }]; } };
    const rows = JSON.parse(opts.body);
    posts.push(rows);
    return { ok: true, status: 201, async json() { return rows.map((r, i) => ({ id: `id-${i}`, ...r })); } };
  };
  const base = { company: 'Acme', description: 'x'.repeat(200), source: 'Greenhouse' };
  await upsertJobs([
    { ...base, title: 'A', location: 'Phoenix, AZ', apply_url: 'https://e.com/a' }, // no lat/lng keys at all
    { ...base, title: 'B', location: 'Remote', apply_url: 'https://e.com/b' },
    { ...base, title: 'C', location: 'Mesa, AZ', apply_url: 'https://e.com/c', lat: 33.4, lng: -111.8 },
  ], 'https://db.example', 'k');
  assert.equal(posts.length, 1, 'one request: every row has the same keys');
  const [a, b, c] = posts[0];
  assert.ok(Math.abs(a.lat - 33.448) < 0.01 && Math.abs(a.lng + 112.074) < 0.01);
  assert.equal(b.lat, null);
  assert.deepEqual([c.lat, c.lng], [33.4, -111.8]);
});

// Radius search places every row — its own coordinates, else its location text through the vendored
// US places table (lib/geo/usPlaces.js) — and measures it from the searched place. Coordinate-less
// rows in a nearby town are inside the radius; a row naming only a state never is.
// Run: node --test api/jobs.radius.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://db.example';
process.env.SUPABASE_SERVICE_KEY = 'service-key';

const NOW = new Date(Date.now() + 86_400_000).toISOString();
let n = 0;
const job = (location, lat = null, lng = null, extra = {}) => ({
  id: `20000000-0000-0000-0000-${String(++n).padStart(12, '0')}`, title: 'Cashier', company: `Store ${n}`, location, lat, lng,
  apply_url: `https://example.com/${n}`, description: 'cashier job at the front registers', search_query: 'cashier',
  expires_at: NOW, created_at: new Date().toISOString(), score: 60, ...extra,
});
const ROWS = [
  job('Tempe, AZ'), // no coords, ~9 mi from downtown Phoenix
  job('Mesa, AZ 85201'), // no coords, ZIP inside Mesa
  job('Tucson, AZ'), // no coords, ~108 mi
  job('Arizona', 34.17, -111.93), // state-only text with the state's middle as coords
  job('Glendale, AZ', 33.54, -112.19), // own coords
  job('Remote'), // no place
  job('Austin, TX'), // no coords, other state
  job('Remote - Texas', null, null, { title: 'Cashier (remote)' }),
];

const urls = [];
globalThis.fetch = async (url) => {
  const u = String(url);
  urls.push(decodeURIComponent(u));
  if (u.includes('/rest/v1/jobs')) return new Response(JSON.stringify(ROWS), { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (u.includes('geocode_cache')) return new Response(JSON.stringify([{ lat: 33.3, lng: -111.98 }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
  return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
};
const { default: handler, rowPoint } = await import('./jobs.js');

function call(body) {
  const res = { code: 200, body: null, setHeader() {}, status(c) { this.code = c; return this; }, json(o) { this.body = o; return this; }, end() { return this; } };
  return handler({ method: 'POST', body, headers: { 'x-forwarded-for': `10.9.${Math.floor(Math.random() * 200)}.1` }, query: {}, socket: { remoteAddress: '10.0.0.1' } }, res).then(() => res);
}
const flags = (res) => Object.fromEntries(res.body.jobs.map((j) => [j.location, j.in_radius]));

test('Phoenix, 25 mi: coordinate-less nearby towns are in the radius; far towns and state-only rows are not', async () => {
  urls.length = 0;
  const res = await call({ query: 'cashier', location: 'Phoenix, AZ', radius: '25', db_only: true });
  assert.equal(res.code, 200);
  const f = flags(res);
  assert.equal(f['Tempe, AZ'], true);
  assert.equal(f['Mesa, AZ 85201'], true);
  assert.equal(f['Glendale, AZ'], true);
  assert.equal(f['Tucson, AZ'], false);
  assert.equal(f['Arizona'], false, 'a whole state is never inside a city radius');
  assert.equal(f['Austin, TX'], false);
  assert.equal(res.body.in_radius, 3);
  assert.equal(res.body.radius, 25);
  assert.equal(res.body.location, 'Phoenix, AZ');
  // In-radius rows lead the page.
  const firstOut = res.body.jobs.findIndex((j) => j.in_radius === false);
  assert.ok(res.body.jobs.slice(firstOut).every((j) => j.in_radius === false), res.body.jobs.map((j) => `${j.location}:${j.in_radius}`).join(' | '));
  // A known place needs no geocoder round trip.
  assert.ok(!urls.some((u) => u.includes('geocode_cache') || u.includes('nominatim')), 'no geocode request for a known place');
});

test('a 10 mi radius is measured, not guessed: Tempe in, Mesa out', async () => {
  const res = await call({ query: 'cashier', location: 'Phoenix, AZ', radius: '10', db_only: true });
  const f = flags(res);
  assert.equal(f['Tempe, AZ'], true);
  assert.equal(f['Mesa, AZ 85201'], false); // ZIP 85201's point is ~15 mi from downtown Phoenix
});

test('a whole-state search filters by state, scoped in the DB by the state in the text', async () => {
  urls.length = 0;
  const res = await call({ query: 'cashier', location: 'Texas', radius: '25', db_only: true });
  const f = flags(res);
  assert.equal(f['Austin, TX'], true);
  assert.equal(f['Remote - Texas'], true);
  assert.equal(f['Tempe, AZ'], false);
  const pool = urls.filter((u) => u.includes('/rest/v1/jobs') && u.includes('or=(location.ilike.*_ tx,'));
  assert.ok(pool.length > 0, 'pool reads carry the state clause');
  assert.ok(!urls.some((u) => u.includes('lat.gte.')), 'no bounding box around the middle of Texas');
});

test('remote (radius 0) is unchanged: only listings that say remote', async () => {
  const res = await call({ query: 'cashier', location: 'Phoenix, AZ', radius: '0', db_only: true });
  assert.equal(res.body.location, 'remote');
  const inR = res.body.jobs.filter((j) => j.in_radius).map((j) => j.location).sort();
  assert.deepEqual(inR, ['Remote', 'Remote - Texas']);
});

test('a place the table does not know still goes to the geocoder', async () => {
  urls.length = 0;
  await call({ query: 'cashier', location: 'Ahwatukee Foothills Village', radius: '25', db_only: true });
  assert.ok(urls.some((u) => u.includes('geocode_cache')), 'fell back to geocodeLocation');
});

test('rowPoint: own coords, else the placed text; state-only and non-US rows have none', () => {
  assert.deepEqual(rowPoint({ lat: 33.5, lng: -112.1, location: 'Phoenix, AZ' }), { lat: 33.5, lng: -112.1 });
  assert.equal(rowPoint({ location: 'Tempe, AZ' }).name, 'Tempe');
  assert.equal(rowPoint({ location: 'Arizona', lat: 34.17, lng: -111.93 }), null);
  assert.equal(rowPoint({ location: 'La Roca del Valles, Barcelona' }), null);
  assert.equal(rowPoint({ location: 'Remote', lat: 0, lng: 0 }), null);
});

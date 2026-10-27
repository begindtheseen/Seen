// The search reads what the person meant (audit 2026-10-27): a misspelt role and place, an acronym, a state on its own,
// a search of only modifiers. The database is mocked; the assertions are on the reads the handler makes and on what it
// answers. Run: node --test api/jobs.understanding.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://db.example';
process.env.SUPABASE_SERVICE_KEY = 'service-key';
process.env.ADZUNA_APP_ID = 'id';
process.env.ADZUNA_APP_KEY = 'key';

const NOW = new Date(Date.now() + 86_400_000).toISOString();
let n = 0;
const R = (title, company, location, lat, lng, extra = {}) => ({ id: `20000000-0000-0000-0000-${String(++n).padStart(12, '0')}`, title, company, location, lat, lng, apply_url: `https://example.com/${n}`, description: `${title} job`, expires_at: NOW, created_at: new Date().toISOString(), score: 60, ...extra });
const ROWS = [
  R('Cashier', 'Jetro', 'Anaheim, Orange County', 33.84, -117.91),
  R('Cashier', 'Kroger', 'Dallas, Texas', 32.78, -96.8),
  R('Cashier - Part Time', 'Fry\'s', 'Tucson, Pima County', 32.22, -110.97, { type: 'Part-time' }),
  R('Registered Nurse (RN) - Med Surg', 'Banner Health', 'Phoenix, AZ', 33.45, -112.07),
  R('Learning and Development Specialist', 'Marketech International', 'Phoenix, AZ', 33.45, -112.07),
  R('Warehouse Associate - Full Time', 'DoorDash', 'Phoenix, Maricopa County', 33.45, -112.07, { type: 'Full-time' }),
  R('Barista - Part Time', 'Starbucks', 'Phoenix, Maricopa County', 33.46, -112.06, { type: 'Part-time' }),
  R('Cashier', 'Walmart', 'Los Angeles, CA', 34.05, -118.24),
];
const reads = [];
let nominatim = 0;
globalThis.fetch = async (url) => {
  const u = decodeURIComponent(String(url));
  if (u.includes('nominatim')) { nominatim++; return new Response('[]', { status: 200 }); }
  if (u.includes('/rest/v1/jobs')) {
    reads.push(u);
    // a crude stand-in for the filters: the role word in the read must appear in the title; the browse read returns all
    const m = u.match(/title\.ilike\.\*([^*]+)\*/) || u.match(/title=imatch\.\(\^\|\[\^\/\$0-9a-z\]\)([^(]+)\(/);
    const word = m ? m[1].replace(/\\/g, '').toLowerCase() : null;
    const rows = word ? ROWS.filter((r) => r.title.toLowerCase().includes(word)) : (u.includes('availability_status=eq.active') ? ROWS : []);
    return new Response(JSON.stringify(rows), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
};
const { default: handler } = await import('./jobs.js');
function call(body) {
  const res = { code: 200, body: null, setHeader() {}, status(c) { this.code = c; return this; }, json(o) { this.body = o; return this; }, end() { return this; } };
  return handler({ method: 'POST', body: { radius: '25', db_only: true, ...body }, headers: { 'x-forwarded-for': `10.8.${Math.floor(Math.random() * 200)}.1` }, query: {} }, res).then(() => res);
}

test('"cashir · Anahiem ca": the role and the place are corrected, said so, and searched as Anaheim', async () => {
  reads.length = 0; nominatim = 0;
  const res = await call({ query: 'cashir', location: 'Anahiem ca' });
  assert.equal(res.code, 200);
  const it = res.body.interpreted;
  assert.equal(it.query, 'cashier');
  assert.deepEqual(it.corrections, [{ from: 'cashir', to: 'cashier' }]);
  assert.equal(it.location, 'Anaheim, CA');
  assert.equal(it.location_corrected, true);
  assert.equal(it.location_typed, 'Anahiem ca');
  assert.equal(nominatim, 0, 'a known city needs no geocoder call');
  assert.ok(reads.some((u) => u.includes('title.ilike.*cashier*')), 'the pool reads the corrected word');
  const first = res.body.jobs[0];
  assert.equal(first.location, 'Anaheim, Orange County');
  assert.equal(first.in_radius, true);
  // downtown Los Angeles is 24 miles from Anaheim — inside a 25-mile search; Dallas and Tucson are not
  assert.ok(res.body.jobs.filter((j) => j.in_radius).every((j) => /Anaheim|Los Angeles/.test(j.location)), 'only rows near Anaheim are in the radius');
  assert.equal(res.body.jobs.find((j) => /Dallas/.test(j.location))?.in_radius, false);
});

test('"exact" keeps the words as typed', async () => {
  const res = await call({ query: 'cashir', location: 'Phoenix, AZ', exact: true });
  assert.equal(res.body.interpreted.query, 'cashir');
  assert.equal(res.body.interpreted.corrections, undefined);
});

test('"RN" reads whole-word titles and never ranks a company whose name contains the letters', async () => {
  reads.length = 0;
  const res = await call({ query: 'RN', location: 'Phoenix, AZ' });
  assert.ok(reads.some((u) => u.includes('title=imatch.')), 'a short word is read as a whole word');
  const titles = res.body.jobs.map((j) => j.title);
  assert.equal(titles[0], 'Registered Nurse (RN) - Med Surg');
  assert.ok(!titles.includes('Learning and Development Specialist'), 'Marketech International is not an RN match');
});

test('"cashier · Arizona" searches the whole state, not 25 miles around its middle', async () => {
  reads.length = 0;
  const res = await call({ query: 'cashier', location: 'Arizona' });
  assert.equal(res.body.interpreted.location, 'Arizona');
  assert.ok(reads.some((u) => u.includes('location.ilike."*, AZ*"') && u.includes('location.ilike.*arizona*')), 'the state scope names the state');
  const tucson = res.body.jobs.find((j) => /Tucson/.test(j.location));
  const la = res.body.jobs.find((j) => /Los Angeles/.test(j.location));
  assert.equal(tucson?.in_radius, true, 'Tucson is in Arizona');
  assert.notEqual(la?.in_radius, true, 'Los Angeles is not');
});

test('"part time · Phoenix": a browse of what is near, part-time first, no title search for "part time"', async () => {
  reads.length = 0;
  const res = await call({ query: 'part time', location: 'Phoenix, AZ' });
  assert.equal(res.body._src, 'db-browse');
  assert.equal(res.body.interpreted.browse, true);
  assert.deepEqual(res.body.interpreted.modifiers, ['part-time']);
  assert.ok(!reads.some((u) => u.includes('*part time*')), 'no literal "part time" read');
  const local = res.body.jobs.filter((j) => j.in_radius);
  assert.ok(local.length >= 2);
  assert.match(local[0].title, /Part Time/, 'the part-time listing leads');
});

test('"nurse jobs in tucson" with an empty location box searches nurses in Tucson', async () => {
  const res = await call({ query: 'nurse jobs in tucson', location: '' });
  assert.equal(res.body.interpreted.query, 'nurse');
  assert.equal(res.body.interpreted.location, 'Tucson, AZ');
  assert.equal(res.body.interpreted.location_from_query, true);
});

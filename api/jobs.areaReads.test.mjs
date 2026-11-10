// rule-accepts ⇒ read-finds: every listing the area ranking accepts (lib/server/areaSearch.js rankArea, given ALL
// rows) is fetched by the handler's own database reads and paged out, with the total equal. Runs the real handler
// against the shared PostgREST stand-in (lib/server/admin/testing/fakeRest.mjs: ilike with `\` escapes, or=(),
// id ranges, the 1,000-row cap) over 2,000+ synthetic rows written in every location form the reader supports.
// Set AREA_CORPUS=<path to a JSON array of {location,…}> to add a real corpus. Run: node --test api/jobs.areaReads.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createFakeRest } from '../lib/server/admin/testing/fakeRest.mjs';
import { geocodePlace, placesWithin } from '../lib/geo/usPlaces.js';
import { placeSearch } from '../lib/geo/radius.js';

process.env.SUPABASE_URL = 'https://db.example';
process.env.SUPABASE_SERVICE_KEY = 'service-key';
delete process.env.ADZUNA_APP_ID; delete process.env.ADZUNA_APP_KEY;

const CENTRES = ['Los Angeles, CA', 'Chicago, IL', 'New York, NY', 'Houston, TX', 'Phoenix, AZ', 'Edison, NJ', 'Bozeman, MT', 'Atlanta, GA',
  'Seattle, WA', 'Riverside, CA', 'Baltimore, MD', 'Kingman, AZ'];
const RADII = [10, 25, 50, 100];
const FULL = { AL: 'Alabama', AZ: 'Arizona', CA: 'California', GA: 'Georgia', IL: 'Illinois', IN: 'Indiana', MD: 'Maryland', MT: 'Montana', NJ: 'New Jersey', NY: 'New York', TX: 'Texas', WA: 'Washington', VA: 'Virginia', DC: 'District of Columbia', PA: 'Pennsylvania', CT: 'Connecticut', WI: 'Wisconsin', OR: 'Oregon', ID: 'Idaho', NV: 'Nevada', UT: 'Utah', SC: 'South Carolina', NC: 'North Carolina', TN: 'Tennessee', AL_: '', DE: 'Delaware', MA: 'Massachusetts', MI: 'Michigan', WY: 'Wyoming', NM: 'New Mexico', CO: 'Colorado', OK: 'Oklahoma', LA: 'Louisiana', AR: 'Arkansas', MS: 'Mississippi', MO: 'Missouri', KS: 'Kansas', NE: 'Nebraska', IA: 'Iowa', MN: 'Minnesota', ND: 'North Dakota', SD: 'South Dakota', KY: 'Kentucky', OH: 'Ohio', WV: 'West Virginia', NH: 'New Hampshire', VT: 'Vermont', ME: 'Maine', RI: 'Rhode Island', FL: 'Florida', HI: 'Hawaii', AK: 'Alaska' };
// Real "<town>, <County>" pairs and neighbourhood + county lines (Adzuna style), around the centres.
const COUNTY_LINES = ['Glendale, Los Angeles County', 'Corona, Riverside County', 'Bell Gardens, Los Angeles County', 'Pico Heights, Los Angeles County',
  'Palms, Los Angeles County', 'Stock Yards, Cook County', 'Cicero, Cook County', 'Houston, Harris County', 'Spring Valley, Harris County',
  'Tempe, Maricopa County', 'Anthem, Maricopa County', "Mechanicsville, St. Mary's County", "Upper Marlboro, Prince George's County",
  'Laurel, Prince George\'s County', 'Ontario, San Bernardino County', 'Moreno Valley, Riverside County', 'Somewhere, Riverside County',
  'Albuquerque, Bernalillo County', 'Edison, Middlesex County', 'Yonkers, Westchester County', 'Kent, King County', 'Decatur, DeKalb County'];
const FORMS = [
  (p) => `${p.name}, ${p.state}`, (p) => `${p.name} ${p.state}`, (p) => `${p.name}, ${FULL[p.state] || p.state}`,
  (p) => `US > ${FULL[p.state] || p.state} > ${p.name}`, (p) => `${p.state} - ${p.name}`, (p) => `US-${p.state}-${p.name}`,
  (p) => `${p.name}, ${p.state}, USA`, (p) => `${p.name}, ${FULL[p.state] || p.state}, United States`, (p) => `${p.name}, ${p.state} (Hybrid)`,
  (p) => `${p.name}, ${p.state}/Remote`, (p) => `Austin, TX; ${p.name}, ${p.state}`, (p) => `${p.name}, ${p.state} or Remote`,
  (p) => `Remote - ${p.name}, ${p.state}`, (p) => (p.pop >= 200000 ? `Greater ${p.name} Area` : `${p.name}, ${p.state}`),
  (p) => `Hybrid - ${p.name}, ${p.state}`, (p) => `${p.name.toUpperCase()}, ${p.state}`,
];
const uuid = (s) => { const h = createHash('md5').update(s).digest('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`; };
const FUT = new Date(Date.now() + 7 * 864e5).toISOString();
const ROWS = [];
let n = 0;
const add = (location, extra = {}) => ROWS.push({
  id: uuid(`row${n}`), title: `Role ${n % 17}`, company: `Employer ${n++}`, location, lat: null, lng: null, type: 'Full-time',
  created_at: new Date(Date.now() - (n % 40) * 864e5).toISOString(), expires_at: FUT, salary: null, source: 'Greenhouse',
  apply_url: `https://boards.example.com/${n}`, description: 'Work.', score: 60, waste_score: 20, is_employer_posted: false, ...extra,
});
for (const c of CENTRES) {
  const g = geocodePlace(c);
  const near = placesWithin(g, 120, { limit: 100000, minPop: 0 }).filter((p, i) => p.pop > 1500 || (p.pop === 0 && i % 3 === 0));
  for (let i = 0; i < 170; i++) {
    const p = near[(i * 7919) % near.length];
    const loc = FORMS[i % FORMS.length](p);
    const coords = i % 9 === 0 ? { lat: p.lat + 0.01, lng: p.lng - 0.01 } : {};
    add(loc, coords);
  }
}
for (const l of COUNTY_LINES) for (let k = 0; k < 4; k++) add(l);
// Forms the read once missed (round 4): "Saint" / "St." spellings, a Census name with a parenthesis, a named site,
// ZIP-only lines, a town just past the edge in tenths.
for (const l of ['Saint John, IN', 'St. Charles, IL', 'Mt. Prospect, IL', 'Mount Prospect, Illinois', 'Woodside, NY', 'Astoria, NY',
  'San Buenaventura (Ventura), California, United States', 'Ventura, CA', 'US > Texas > Bunker Hill Village', 'US-CA-Downey', 'Renton, WA',
  'Liberty, Texas', 'Austell, Georgia, United States', 'US > Pennsylvania > Bangor']) for (let k = 0; k < 2; k++) add(l);
for (const l of ['85004', 'Phoenix, AZ 85004', '90012', 'Chicago 60601', 'Remote', 'United States', 'Arizona', 'Toronto, ON', 'Remote - European Region']) add(l);
if (process.env.AREA_CORPUS) for (const r of JSON.parse(readFileSync(process.env.AREA_CORPUS, 'utf8'))) add(r.location || '', { title: r.title, company: r.company });

const rest = createFakeRest({ tables: { jobs: ROWS } });
globalThis.fetch = (url, init) => rest.fetch ? rest.fetch(url, init) : rest.fetchImpl(url, init);
const { default: handler } = await import('./jobs.js');
const { rankArea, _clearAreaCache } = await import('../lib/server/areaSearch.js');
const { isSeedListing } = await import('../lib/server/jobPriority.js');

function call(body) {
  const res = { code: 200, body: null, setHeader() {}, status(c) { this.code = c; return this; }, json(o) { this.body = o; return this; }, end() { return this; } };
  return handler({ method: 'POST', body, headers: { 'x-forwarded-for': '10.3.3.3' }, query: {}, socket: {} }, res).then(() => res);
}

test(`rule-accepts ⇒ read-finds: ${CENTRES.length} places × ${RADII.length} radii over ${ROWS.length} rows`, async () => {
  assert.ok(ROWS.length >= 2000, `${ROWS.length} rows`);
  const misses = [];
  for (const place of CENTRES) {
    const area = placeSearch(place);
    for (const r of RADII) {
      _clearAreaCache();
      const want = rankArea(ROWS, area, r, { includeRemote: false, exclude: isSeedListing }).list.map((x) => x.row.id);
      const got = [];
      let cursor = null, total = null;
      for (let i = 0; i < 200; i++) {
        const res = await call({ query: '', location: place, radius: String(r), cursor });
        assert.equal(res.code, 200, JSON.stringify(res.body));
        assert.equal(res.body.complete, true, `${place} ${r}: the read finished`);
        total = res.body.total;
        got.push(...res.body.jobs.map((j) => j.id));
        if (!res.body.has_more) break;
        cursor = res.body.next_cursor;
      }
      const g = new Set(got);
      const missing = want.filter((id) => !g.has(id));
      if (missing.length || total !== want.length || got.length !== want.length) {
        misses.push(`${place} @${r}: rule ${want.length}, handler total ${total}, paged ${got.length}; not read: ${missing.slice(0, 6).map((id) => ROWS.find((x) => x.id === id).location).join(' | ')}`);
      }
    }
  }
  assert.deepEqual(misses, []);
});

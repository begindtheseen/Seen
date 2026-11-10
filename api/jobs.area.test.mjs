// Location-only search ("all the jobs in an area"): a place and no title. Fake PostgREST that honours the
// filters the area read sends (bounding box, imatch, id ranges, the 1,000-row cap, id=in) over a 2,500-row
// pool around Phoenix. No network. Run: node --test api/jobs.area.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { distanceMiles, geocodePlace } from '../lib/geo/usPlaces.js';

process.env.SUPABASE_URL = 'https://db.example';
process.env.SUPABASE_SERVICE_KEY = 'service-key';
delete process.env.ADZUNA_APP_ID; delete process.env.ADZUNA_APP_KEY;

const FUTURE = new Date(Date.now() + 7 * 86_400_000).toISOString();
const DAY = 86_400_000;
// Deterministic pseudo-random ids spread over the whole uuid space (so id-range splitting is exercised).
let seed = 7;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
let idN = 0;
const uuid = () => { const h = createHash('md5').update(`row-${idN++}`).digest('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`; };

const TOWNS = [
  ['Phoenix, AZ', 0.3], ['Tempe, AZ', 0.1], ['Mesa, AZ 85201', 0.08], ['Scottsdale, AZ', 0.08], ['Glendale, AZ', 0.06],
  ['Chandler, AZ', 0.06], ['Gilbert, Arizona', 0.04], ['US > Arizona > Peoria', 0.03], ['Surprise, AZ', 0.03],
  ['Buckeye, AZ', 0.03], ['Tucson, AZ', 0.06], ['Flagstaff, AZ', 0.02], ['Arizona', 0.02], ['Remote', 0.02],
  ['Remote - Phoenix, AZ', 0.01], ['Phoenix, AZ (Hybrid)', 0.01], ['Austin, TX; Tempe, AZ', 0.01], ['Toronto, ON', 0.01],
  ['Casa Grande, AZ', 0.02], ['Phoenix', 0.01],
];
const pickTown = () => { let x = rnd(), acc = 0; for (const [t, w] of TOWNS) { acc += w; if (x <= acc) return t; } return 'Phoenix, AZ'; };
const ROLES = ['Cashier', 'Registered Nurse', 'Senior Software Engineer', 'Warehouse Associate', 'Entry Level Teller', 'Line Cook', 'Store Manager'];
const POOL = [];
for (let i = 0; i < 2500; i++) {
  const location = pickTown();
  const withCoords = rnd() < 0.15 && !/Remote|Arizona$|Toronto|;/.test(location);
  const g = withCoords ? geocodePlace(location) : null;
  POOL.push({
    id: uuid(), title: ROLES[i % ROLES.length], company: `Employer ${i}`, location,
    lat: g ? g.lat + (rnd() - 0.5) * 0.02 : null, lng: g ? g.lng + (rnd() - 0.5) * 0.02 : null,
    type: i % 5 === 0 ? 'Part-time' : 'Full-time', created_at: new Date(Date.now() - Math.floor(rnd() * 40) * DAY - i * 1000).toISOString(),
    salary: i % 3 === 0 ? '$18 - $22/hour' : null, source: 'Greenhouse', apply_url: `https://boards.example.com/${i}`,
    description: 'Real work.', score: 60, waste_score: 20, expires_at: FUTURE, is_employer_posted: false,
  });
}
assert.equal(new Set(POOL.map((r) => r.id)).size, POOL.length, 'fixture ids are unique');
POOL.push({ ...POOL[0], id: uuid(), company: 'Seen Jobs', apply_url: 'https://seenjobs.io', location: 'Phoenix, AZ' }); // a seed row, never served

// ── fake PostgREST ──
const reqs = [];
function pg(u) {
  const p = u.searchParams;
  let rows = POOL.slice();
  for (const [k, v] of p.entries()) {
    if (k === 'expires_at') rows = rows.filter((r) => r.expires_at > v.slice(3));
    else if (k === 'lat' || k === 'lng') {
      const [op, val] = [v.slice(0, v.indexOf('.')), v.slice(v.indexOf('.') + 1)];
      if (op === 'is') rows = rows.filter((r) => (val === 'null' ? r[k] == null : r[k] != null));
      else rows = rows.filter((r) => r[k] != null && (op === 'gte' ? r[k] >= Number(val) : r[k] <= Number(val)));
    } else if (k === 'or') {
      const terms = v.slice(1, -1).split(',').map((t) => t.replace(/^location\.ilike\./, ''));
      const res = terms.map((t) => new RegExp(`^${t.split('').map((c) => (c === '*' ? '.*' : c === '_' ? '.' : c.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))).join('')}$`, 'is'));
      rows = rows.filter((r) => res.some((re) => re.test(r.location || '')));
    } else if (k === 'location' && v.startsWith('imatch.')) {
      const re = new RegExp(v.slice(7), 'i');
      rows = rows.filter((r) => re.test(r.location || ''));
    } else if (k === 'id') {
      if (v.startsWith('gte.')) rows = rows.filter((r) => r.id >= v.slice(4));
      else if (v.startsWith('lt.')) rows = rows.filter((r) => r.id < v.slice(3));
      else if (v.startsWith('in.(')) { const s = new Set(v.slice(4, -1).split(',')); rows = rows.filter((r) => s.has(r.id)); }
    }
  }
  return rows.slice(0, Math.min(1000, Number(p.get('limit')) || 1000));
}
const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } });
globalThis.fetch = async (url) => {
  const u = new URL(String(url));
  if (u.hostname !== 'db.example') throw new Error(`no network: ${u.hostname}`);
  if (u.pathname === '/rest/v1/jobs') { reqs.push(u); return json(pg(u)); }
  return json([]);
};
const { default: handler } = await import('./jobs.js');
const { _clearAreaCache } = await import('../lib/server/areaSearch.js');
function call(body) {
  const res = { code: 200, body: null, setHeader() {}, status(c) { this.code = c; return this; }, json(o) { this.body = o; return this; }, end() { return this; } };
  return handler({ method: 'POST', body, headers: { 'x-forwarded-for': `10.7.${Math.floor(Math.random() * 200)}.1` }, query: {}, socket: { remoteAddress: '10.0.0.1' } }, res).then(() => res);
}
async function all(body) {
  const pages = [];
  let cursor = null;
  for (let i = 0; i < 100; i++) {
    const r = await call({ ...body, cursor });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    pages.push(r.body);
    if (!r.body.has_more) break;
    cursor = r.body.next_cursor;
    assert.ok(cursor, 'a page with more carries a cursor');
  }
  return { pages, rows: pages.flatMap((p) => p.jobs), total: pages[0].total };
}
const PHX = geocodePlace('Phoenix, AZ');
// The truth, computed independently: every pool row with a place (own coords, else ANY place its text names)
// within the radius, not remote, not foreign, not the seed.
const placesOf = (r) => {
  if (r.lat != null) return [{ lat: r.lat, lng: r.lng }];
  return String(r.location).split(/;/).map((s) => geocodePlace(s)).filter((g) => g && !g.stateOnly);
};
const truth = (miles, center = PHX) => POOL.filter((r) => r.company !== 'Seen Jobs' && !/remote/i.test(r.location) && !/toronto/i.test(r.location)
  && placesOf(r).some((p) => Math.round(distanceMiles(center, p) * 10) / 10 <= miles)); // the distance as shown (tenths)

test('a place and no title is a valid search: every row in the radius, total = rows paged, nearest first, no repeats', async () => {
  _clearAreaCache();
  const { pages, rows, total } = await all({ query: '', location: 'Phoenix, AZ', radius: '25' });
  const want = truth(25);
  assert.equal(pages[0].mode, 'area');
  const got = new Set(rows.map((j) => j.id));
  const missing = want.filter((r) => !got.has(r.id));
  assert.equal(total, want.length, `the total is the number of rows in the radius; missing e.g. ${missing.slice(0, 5).map((r) => `${r.location}@${r.lat}`).join(' | ')}`);
  assert.equal(rows.length, total, 'paging reaches the last row');
  assert.equal(new Set(rows.map((j) => j.id)).size, rows.length, 'no row repeats across pages');
  assert.deepEqual(new Set(rows.map((j) => j.id)), new Set(want.map((r) => r.id)), 'exactly the rows in the radius');
  assert.ok(pages.length >= 20, `${pages.length} pages of 60`);
  for (let i = 1; i < rows.length; i++) assert.ok((rows[i - 1].distance_miles ?? 1e9) <= (rows[i].distance_miles ?? 1e9), `nearest first at ${i}`);
  for (const j of rows) assert.ok(j.distance_miles == null || j.distance_miles <= 25, `${j.location} at ${j.distance_miles} mi`);
  assert.ok(!rows.some((j) => /remote/i.test(j.location)), 'remote rows are off by default');
  assert.ok(!rows.some((j) => j.company === 'Seen Jobs'));
  assert.ok(rows.some((j) => j.location === 'Austin, TX; Tempe, AZ'), 'a multi-place listing is in range when any place is');
  assert.ok(!rows.some((j) => j.location === 'Arizona'), 'a state-only row is never inside a city radius');
  assert.equal(pages[0].area.label, 'Phoenix, AZ');
  assert.equal(pages[0].radius, 25);
  assert.ok(pages[0].remote_total > 0, 'remote rows tied to the area are counted apart');
  assert.equal(pages[0].complete, true);
  // The read went past the 1,000-row cap by id range, never one capped page.
  assert.ok(reqs.some((u) => u.searchParams.getAll('id').some((v) => v.startsWith('gte.'))), 'split by id range');
});

test('widening 10 → 25 → 50 → 100 never drops a row', async () => {
  _clearAreaCache();
  let prev = null;
  for (const r of ['10', '25', '50', '100']) {
    const { rows, total } = await all({ query: '', location: 'Phoenix, AZ', radius: r });
    const ids = new Set(rows.map((j) => j.id));
    assert.equal(total, truth(Number(r)).length, `${r} mi total`);
    if (prev) for (const id of prev) assert.ok(ids.has(id), `${r} mi holds every row of the smaller radius`);
    prev = ids;
  }
});

test('newest first is a stable order that also pages to the end', async () => {
  const { rows, total } = await all({ query: '', location: 'Phoenix, AZ', radius: '25', sort: 'recent' });
  assert.equal(rows.length, total);
  assert.equal(new Set(rows.map((j) => j.id)).size, total);
  for (let i = 1; i < rows.length; i++) assert.ok(Date.parse(rows[i - 1].posted_at) >= Date.parse(rows[i].posted_at), `newest first at ${i}`);
});

test('filters run before the count: type, level, pay, posted', async () => {
  const part = await all({ query: '', location: 'Phoenix, AZ', radius: '25', type: 'Part-time' });
  assert.ok(part.total > 0 && part.rows.every((j) => j.type === 'Part-time'));
  assert.equal(part.rows.length, part.total);
  assert.equal(part.total, truth(25).filter((r) => r.type === 'Part-time').length);
  const pay = await all({ query: '', location: 'Phoenix, AZ', radius: '25', pay: true });
  assert.ok(pay.total > 0 && pay.rows.every((j) => j.salary));
  const senior = await all({ query: '', location: 'Phoenix, AZ', radius: '25', level: 'senior' });
  assert.ok(senior.total > 0 && senior.rows.every((j) => /senior|manager/i.test(j.title) || j.level === 'Senior'), senior.rows.slice(0, 3).map((j) => j.title).join());
  const week = await all({ query: '', location: 'Phoenix, AZ', radius: '25', posted: '7' });
  assert.ok(week.rows.every((j) => Date.parse(j.posted_at) >= Date.now() - 7 * DAY));
  assert.equal(week.rows.length, week.total);
});

test('the remote toggle adds the remote listings tied to the area, labelled', async () => {
  const off = await call({ query: '', location: 'Phoenix, AZ', radius: '25' });
  const on = await all({ query: '', location: 'Phoenix, AZ', radius: '25', include_remote: true });
  assert.equal(on.total, off.body.total + off.body.remote_total);
  const remote = on.rows.filter((j) => j.remote);
  assert.equal(remote.length, off.body.remote_total);
  assert.ok(remote.every((j) => /remote/i.test(j.location)));
  assert.ok(!on.rows.some((j) => j.location === 'Remote'), 'a remote row with no place is not "in" Phoenix');
});

test('a ZIP is centred on its own area; a suburb on its town', async () => {
  const z = await call({ query: '', location: '85004', radius: '10' });
  assert.equal(z.body.area.zip, '85004');
  assert.match(z.body.area.label, /^85004 \(Phoenix, AZ\)$/);
  const t = await call({ query: '', location: 'Tempe', radius: '10' });
  assert.equal(t.body.area.label, 'Tempe, AZ');
  assert.ok(t.body.jobs[0].distance_miles <= 1, 'the nearest row to Tempe is in Tempe');
});

test('a whole state lists every row placed in that state, state-only rows included', async () => {
  const { rows, total, pages } = await all({ query: '', location: 'Arizona', radius: '25' });
  assert.equal(pages[0].area.kind, 'state');
  assert.equal(pages[0].mode, 'state', 'nothing downstream reads a state search as a radius');
  assert.equal(pages[0].radius, null);
  assert.equal(rows.length, total);
  assert.ok(rows.some((j) => j.location === 'Arizona'));
  assert.ok(rows.some((j) => j.location === 'Flagstaff, AZ'));
  assert.ok(!rows.some((j) => /toronto|^remote$/i.test(j.location)));
});

test('a place Seen cannot place: a plain message and suggestions, never a list', async () => {
  const typo = await call({ query: '', location: 'Pheonix', radius: '25' });
  assert.equal(typo.body.jobs.length, 0);
  assert.equal(typo.body.total, 0);
  assert.deepEqual(typo.body.unplaced.suggestions.slice(0, 1), ['Phoenix, AZ']);
  assert.match(typo.body.message, /couldn’t find a US place called “Pheonix”/);
  const abroad = await call({ query: '', location: 'Toronto, ON', radius: '25' });
  assert.equal(abroad.body.jobs.length, 0);
  assert.equal(abroad.body.unplaced.reason, 'non_us');
  const remote = await call({ query: '', location: 'Phoenix, AZ', radius: '0' });
  assert.equal(remote.body.need_title, true);
  assert.equal(remote.body.jobs.length, 0);
  const empty = await call({ query: '', location: '', radius: '25' });
  assert.equal(empty.code, 400);
});

test('an area with nothing says so and offers the next radius up with its count', async () => {
  _clearAreaCache();
  const r = await call({ query: '', location: 'Wickenburg, AZ', radius: '10' });
  assert.equal(r.body.total, 0);
  assert.equal(r.body.wider.radius, 25);
  assert.equal(r.body.wider.total, truth(25, geocodePlace('Wickenburg, AZ')).length);
});

test('no live third-party pull for an untitled search', async () => {
  const seen = [];
  const prev = globalThis.fetch;
  globalThis.fetch = async (url) => { seen.push(new URL(String(url)).hostname); return prev(url); };
  try { await call({ query: '', location: 'Mesa, AZ', radius: '25' }); } finally { globalThis.fetch = prev; }
  assert.ok(seen.every((h) => h === 'db.example'), seen.join());
});

test('titled search is unchanged: still the relevance path', async () => {
  const r = await call({ query: 'cashier', location: 'Phoenix, AZ', radius: '25', db_only: true });
  assert.equal(r.code, 200);
  assert.notEqual(r.body.mode, 'area');
  assert.ok(r.body.jobs.length > 0);
});

test('load: at most 4 reads in flight, a capped number of reads, and a partial answer says so', async () => {
  _clearAreaCache();
  const { readAreaRows, _inFlight } = await import('../lib/server/areaSearch.js');
  let peak = 0, reads = 0;
  const slow = async (path) => {
    reads++;
    peak = Math.max(peak, _inFlight());
    await new Promise((r) => setTimeout(r, 30));
    return pg(new URL(`https://db.example/rest/v1/${path}`));
  };
  const area = { kind: 'point', lat: PHX.lat, lng: PHX.lng, name: 'Phoenix', state: 'AZ' };
  const full = await readAreaRows({ db: slow, area, miles: 100 });
  assert.ok(peak <= 4, `peak in flight ${peak}`);
  assert.equal(full.complete, true);
  assert.equal(full.reads, reads);
  // A tiny budget: the answer comes back in time, says it is not complete, and the read finishes behind it.
  _clearAreaCache();
  let finished = null;
  const t0 = Date.now();
  const part = await readAreaRows({ db: slow, area, miles: 100, budgetMs: 20, waitUntil: (p) => { finished = p; } });
  assert.ok(Date.now() - t0 < 500);
  assert.equal(part.complete, false);
  assert.equal(part.pending, true);
  await finished;
  const again = await readAreaRows({ db: slow, area, miles: 100 });
  assert.equal(again.cached, true, 'the background read filled the cache');
  assert.equal(again.rows.length, full.rows.length);
});


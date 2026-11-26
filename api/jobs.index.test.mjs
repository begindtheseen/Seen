// jobs.index.test.mjs — the in-memory job index (lib/server/jobIndex) answers every search read the database did:
// the same searches, run once against the PostgREST stand-in and once against the index built from the same rows,
// serve the same listings in the same order, and with the index loaded no `ilike` read reaches the database.
// (Fixture and stand-in copied from jobs.pool.test.mjs.) Run: node --test api/jobs.index.test.mjs
//
// From jobs.pool.test.mjs: the search's candidate pool is STABLE: every pool read is ordered, the title reads are capped apart from
// the provenance (search_query) reads, so widening a radius only adds rows, two loads of one URL agree, a
// Remote search shows one row per role (not one per city in the title), the signed-in searcher's own
// industry leads among equal title matches, and no path prints a sub-wage pay line (round 3, 2026-11-03).
// A small PostgREST stand-in that honours ilike / or= / and() / limit / order; no network.
// Run: node --test api/jobs.pool.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

process.env.SUPABASE_URL = 'https://db.example';
process.env.SUPABASE_SERVICE_KEY = 'service-key';
process.env.SUPABASE_JWT_SECRET = 'test-jwt-secret';
delete process.env.ADZUNA_APP_ID; delete process.env.ADZUNA_APP_KEY;

const FUTURE = new Date(Date.now() + 86_400_000).toISOString();
let n = 0;
const id = () => `20000000-0000-0000-0000-${String(++n).padStart(12, '0')}`;
const row = (title, company, location, lat, lng, extra = {}) => ({
  id: id(), title, company, location, lat, lng, apply_url: `https://example.com/${n}`, source: 'Greenhouse',
  description: `${title} at ${company}.`, search_query: null, expires_at: FUTURE, created_at: '2026-11-01T00:00:00Z', score: 60, ...extra,
});
// Phoenix 33.4484,-112.074. Tempe ~9 mi, Scottsdale ~11 mi, Mesa ~15 mi, Chandler ~17 mi, Casa Grande ~45 mi.
const TEMPE = [33.4255, -111.94], SCOTTSDALE = [33.4942, -111.9261], MESA = [33.4152, -111.8315], CHANDLER = [33.3062, -111.8413], CASA = [32.8795, -111.7574], PHX = [33.4484, -112.074];
// 150 rows our aggregation stamped search_query="team lead" that are NOT team-lead titles, all 11–17 mi out —
// inside a 25-mile box, outside a 10-mile one. Listed FIRST so an unordered, shared cap reads them first.
const NOISE = Array.from({ length: 150 }, (_, i) => {
  const [lat, lng] = i % 3 === 0 ? SCOTTSDALE : i % 3 === 1 ? MESA : CHANDLER;
  return row(`Tax Manager ${i}`, `Gpac ${i}`, i % 3 === 0 ? 'Scottsdale, AZ' : i % 3 === 1 ? 'Mesa, AZ' : 'Chandler, AZ', lat, lng, { search_query: 'team lead', score: 65 });
});
const WALMART = { description: "Position Summary What you'll do Assists management with the supervision of associates in the club store." };
const TEAM_LEADS = [
  row('Underwriting Operations Team Lead', 'Jencap', 'Phoenix, AZ', ...PHX, { score: 88, description: 'Why Jencap? We are one of the largest wholesale insurance intermediaries in the United States.' }),
  row('(USA) Member Team Lead', 'Walmart', 'Tempe, Maricopa County', ...TEMPE, { score: 62, salary: '$46k–$62k/yr', ...WALMART }),
  row('Specialty Sales Team Leader- (Tempe, AZ)', 'Target', 'Tempe, Maricopa County', ...TEMPE, { score: 67 }),
  row('Patient Services Team Lead (PRQ)', 'Sonora Quest Laboratories', 'Mesa, Maricopa County', ...MESA, { score: 50, description: 'Phlebotomy. Patient services in the laboratory.' }),
  row("061 - AJ's Fine Foods Bistro Asst. Team Lead", 'Bashas', 'Mesa, Maricopa County', ...MESA, { score: 46 }),
  row('Front Line Team Lead - Nutrition Manufacturing', 'Abbott', 'Casa Grande, Pinal County', ...CASA, { score: 62 }),
];
const SEED = row('Team Lead', 'Seen Jobs', 'Phoenix, AZ', ...PHX, { score: 99, apply_url: 'https://Seenjobs.io', is_employer_posted: true });
// A remote role posted once per city in the title, plus two copies abroad and one other remote role.
const SPEECHIFY = ['Cleveland, OH, USA', 'Atlanta, GA, USA', 'Baltimore, MD, USA', 'Boise, ID, USA', 'Athens, Greece', 'Braga, Portugal', 'Malmö, Sweden', 'Košice, Slovakia', 'Gdańsk, Poland']
  .map((c) => row(`Team Lead, Android Core Product - ${c}`, 'Speechify', 'Remote', null, null, { score: 90, description: 'Fully remote role.' }));
const HARBOR = row('Team Lead, Legal Conflicts Managed Services', 'Harbor', 'Remote, United States', null, null, { score: 79, description: 'Remote.' });
const SUBWAGE = row('Server', 'Diner', 'Phoenix, AZ', ...PHX, { salary: '$2/hr', score: 50 });
const CORPUS = [...NOISE, ...TEAM_LEADS, SEED, ...SPEECHIFY, HARBOR, SUBWAGE];

// ── a PostgREST stand-in ─────────────────────────────────────────────────────────────────────
const ilike = (pat) => new RegExp(`^${String(pat).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/_/g, '.')}$`, 'i');
function splitTop(s) { // "a,b,and(c,d)" → ["a","b","and(c,d)"]
  const out = []; let depth = 0, cur = '';
  for (const ch of s) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch; }
  if (cur) out.push(cur);
  return out;
}
function cond(expr) { // "col.op.value" | "and(...)" | "or(...)"
  const m = expr.match(/^(and|or)\((.*)\)$/);
  if (m) { const parts = splitTop(m[2]).map(cond); return m[1] === 'and' ? (r) => parts.every((f) => f(r)) : (r) => parts.some((f) => f(r)); }
  const [col, op, ...rest] = expr.split('.'); const val = rest.join('.');
  if (op === 'ilike') { const re = ilike(val); return (r) => re.test(String(r[col] ?? '')); }
  if (op === 'gte') return (r) => r[col] != null && Number(r[col]) >= Number(val);
  if (op === 'lte') return (r) => r[col] != null && Number(r[col]) <= Number(val);
  if (op === 'gt') return (r) => String(r[col] ?? '') > val;
  if (op === 'eq') return (r) => String(r[col] ?? '') === val;
  if (op === 'not' && rest[0] === 'is') return (r) => r[col] != null;
  return () => true;
}
const urls = [];
let fitReads = 0;
globalThis.fetch = async (url) => {
  const u = new URL(String(url));
  urls.push(decodeURIComponent(u.pathname + u.search));
  const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (u.pathname === '/rest/v1/jobs') {
    if (u.searchParams.get('employer_user_id')) return json([]);
    let rows = CORPUS;
    for (const [k, v] of u.searchParams) {
      if (['select', 'limit', 'order', 'offset'].includes(k)) continue;
      if (k === 'or' || k === 'and') rows = rows.filter(cond(`${k}${v}`));
      else rows = rows.filter(cond(`${k}.${v}`));
    }
    const order = u.searchParams.get('order');
    if (order) {
      const keys = order.split(',').map((o) => o.split('.'));
      rows = [...rows].sort((a, b) => { for (const [col, dir] of keys) { const x = a[col] ?? -Infinity, y = b[col] ?? -Infinity; if (x !== y) return (x < y ? -1 : 1) * (dir === 'desc' ? -1 : 1); } return 0; });
    }
    const limit = Number(u.searchParams.get('limit')) || 1000;
    return json(rows.slice(0, limit));
  }
  if (u.pathname === '/rest/v1/resume_skills') { fitReads++; return json([{ top_titles: ['Team Lead', 'Department Supervisor'], function: 'other' }]); }
  if (u.pathname === '/rest/v1/profiles') return json([{ industry: 'retail' }]);
  return json([]);
};
const { default: handler } = await import('./jobs.js');
const { _setIndexForTest, _clearIndexForTest } = await import('../lib/server/jobIndex/index.js');
function call(body, headers = {}) {
  const res = { code: 200, body: null, setHeader() {}, status(c) { this.code = c; return this; }, json(o) { this.body = o; return this; }, end() { return this; } };
  return handler({ method: 'POST', body, headers: { 'x-forwarded-for': `10.9.${Math.floor(Math.random() * 200)}.1`, ...headers }, query: {}, socket: { remoteAddress: '10.0.0.1' } }, res).then(() => res);
}
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function jwt(sub) {
  const head = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, exp: Math.floor(Date.now() / 1000) + 3600 })}`;
  return `${head}.${createHmac('sha256', process.env.SUPABASE_JWT_SECRET).update(head).digest('base64url')}`;
}
const related = (res) => res.body.jobs.filter((j) => j.related !== false && j.in_radius !== false).map((j) => `${j.title} · ${j.company}`);


const SEARCHES = [
  { query: 'team lead', location: 'Phoenix', radius: '10', db_only: true },
  { query: 'team lead', location: 'Phoenix', radius: '25', db_only: true },
  { query: 'team lead', location: 'Phoenix', radius: '50', db_only: true },
  { query: 'team lead', location: '', radius: '0', db_only: true },
  { query: 'walmart', location: 'Phoenix', radius: '25', db_only: true },
  { query: 'server', location: 'Phoenix, AZ', radius: '25', db_only: true },
  { query: 'tax manager', location: 'Arizona', radius: '25', db_only: true },
  { query: '', location: 'Phoenix, AZ', radius: '25' },
  { query: '', location: 'Phoenix, AZ', radius: '10', sort: 'recent' },
];
const view = (res) => (res.body.jobs || []).map((j) => `${j.id}|${j.title}|${j.in_radius}|${j.related}|${j.salary || ''}`);
const ilikeReads = () => urls.filter((u) => u.startsWith('/rest/v1/jobs') && /ilike/.test(u));

test('the index serves the same listings, in the same order, as the database for every search', async () => {
  process.env.JOB_INDEX = 'off';
  _clearIndexForTest();
  const viaDb = [];
  for (const s of SEARCHES) { const r = await call(s); assert.equal(r.code, 200, JSON.stringify(r.body).slice(0, 200)); viaDb.push(r); }

  process.env.JOB_INDEX = 'on';
  // The index holds every column but the posting (the postings are read by id, as before).
  _setIndexForTest(CORPUS.map(({ description, ...rest }) => rest));
  // The first search starts placing the index's rows for the area search (in the background); let it finish.
  await call(SEARCHES[0]);
  await new Promise((r) => setTimeout(r, 300));
  urls.length = 0;
  const viaIndex = [];
  for (const s of SEARCHES) { const r = await call(s); assert.equal(r.code, 200, JSON.stringify(r.body).slice(0, 200)); viaIndex.push(r); }
  for (let i = 0; i < SEARCHES.length; i++) {
    assert.ok(viaDb[i].body.jobs.length > 0 || SEARCHES[i].query === 'nothing', `search ${i} found rows`);
    assert.deepEqual(view(viaIndex[i]), view(viaDb[i]), `search ${JSON.stringify(SEARCHES[i])}`);
    assert.equal(viaIndex[i].body.in_radius, viaDb[i].body.in_radius);
    if (viaDb[i].body.total != null) assert.equal(viaIndex[i].body.total, viaDb[i].body.total);
  }
  // Every posting served is the full text the database holds.
  const descs = new Map(CORPUS.map((r) => [r.id, r.description]));
  for (const r of viaIndex) for (const j of r.body.jobs) if (descs.has(j.id) && j.description != null) assert.equal(j.description, descs.get(j.id));
  // With the index loaded, no text-matching read reaches the database (only postings by id).
  assert.deepEqual(ilikeReads().filter((u) => !/[?&]id=in\./.test(u)), []);
  _clearIndexForTest();
  delete process.env.JOB_INDEX;
});

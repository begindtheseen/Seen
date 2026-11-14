// What a title search says about itself (api/jobs.js searchContext → lib/jobs/searchContext.js): the family titles it
// also showed, the stated pay on its matches, and — for a thin place search — where the matches are instead. All from
// rows the search already read: the reads a search makes are the same shapes as before (no `description` outside a
// by-id fetch, no OR past 15 patterns). A small PostgREST stand-in; no network.
// Run: node --test api/jobs.context.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://db.example';
process.env.SUPABASE_SERVICE_KEY = 'service-key';
delete process.env.ADZUNA_APP_ID; delete process.env.ADZUNA_APP_KEY;

const FUTURE = new Date(Date.now() + 86_400_000).toISOString();
let n = 0;
const id = () => `30000000-0000-0000-0000-${String(++n).padStart(12, '0')}`;
const row = (title, location, extra = {}) => ({
  id: id(), title, company: `Crew ${n}`, location, lat: null, lng: null, apply_url: `https://example.com/${n}`, source: 'Greenhouse',
  description: `${title}. Entry level, will train.`, search_query: null, expires_at: FUTURE, created_at: '2026-11-01T00:00:00Z', score: 60, ...extra,
});
const times = (k, f) => Array.from({ length: k }, (_, i) => f(i));
const CORPUS = [
  ...times(6, (i) => row('Floorhand', i % 2 ? 'Midland, TX' : 'Odessa, TX', { salary: `$${22 + i}–$${28 + i}/hr` })),
  ...times(3, () => row('Floor Hand - Workover', 'Williston, ND', { salary: '$25/hr' })),
  ...times(2, () => row('Derrickhand', 'Watford City, ND')),
  ...times(4, (i) => row('Roustabout', 'Hobbs, NM', { salary: `$${20 + i}/hr` })),
  row('Rig Hand', 'Remote'),
  row('Barista', 'Boise, ID'),
];

const ilike = (pat) => new RegExp(`^${String(pat).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/_/g, '.')}$`, 'i');
function splitTop(s) { const out = []; let depth = 0, cur = ''; for (const ch of s) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch; } if (cur) out.push(cur); return out; }
function cond(expr) {
  const m = expr.match(/^(and|or)\((.*)\)$/);
  if (m) { const parts = splitTop(m[2]).map(cond); return m[1] === 'and' ? (r) => parts.every((f) => f(r)) : (r) => parts.some((f) => f(r)); }
  const [col, op, ...rest] = expr.split('.'); const val = rest.join('.');
  if (op === 'ilike') { const re = ilike(val); return (r) => re.test(String(r[col] ?? '')); }
  if (op === 'gte') return (r) => r[col] != null && Number(r[col]) >= Number(val);
  if (op === 'lte') return (r) => r[col] != null && Number(r[col]) <= Number(val);
  if (op === 'gt') return (r) => String(r[col] ?? '') > val;
  if (op === 'eq') return (r) => String(r[col] ?? '') === val;
  if (op === 'in') { const set = new Set(val.replace(/^\(|\)$/g, '').split(',')); return (r) => set.has(String(r[col])); }
  return () => true;
}
const urls = [];
globalThis.fetch = async (url) => {
  const u = new URL(String(url));
  urls.push(decodeURIComponent(u.pathname + u.search));
  const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (u.pathname === '/rest/v1/jobs') {
    if (u.searchParams.get('employer_user_id') || u.searchParams.get('is_employer_posted')) return json([]);
    let rows = CORPUS;
    for (const [k, v] of u.searchParams) {
      if (['select', 'limit', 'order', 'offset'].includes(k)) continue;
      rows = rows.filter(k === 'or' || k === 'and' ? cond(`${k}${v}`) : cond(`${k}.${v}`));
    }
    const limit = Number(u.searchParams.get('limit')) || 1000;
    return json(rows.slice(0, limit));
  }
  return json([]);
};
const { default: handler } = await import('./jobs.js');
function call(body) {
  const res = { code: 200, body: null, setHeader() {}, status(c) { this.code = c; return this; }, json(o) { this.body = o; return this; }, end() { return this; } };
  return handler({ method: 'POST', body, headers: { 'x-forwarded-for': `10.7.${Math.floor(Math.random() * 200)}.1` }, query: {}, socket: { remoteAddress: '10.0.0.1' } }, res).then(() => res);
}

test('a thin place search says where the matches are, from the corpus fill it already read', async () => {
  urls.length = 0;
  const res = await call({ query: 'floorhand', location: 'Boise, ID', radius: '100', db_only: true });
  assert.equal(res.code, 200);
  assert.equal(res.body.fallback, 'outside_radius');
  // Roustabout rows are floorhand matches (one oilfield family — the page lists them as matches too); the Derrickhand
  // rows are not among the terms the search reads, so they are not counted: a count is of rows the search read.
  assert.deepEqual(res.body.elsewhere.map((c) => [c.place, c.count]), [['Midland, TX', 6], ['Hobbs, NM', 4], ['Williston, ND', 3]]);
  assert.ok(res.body.elsewhere.every((c) => c.miles > 500));
  assert.equal(res.body.elsewhere_partial, undefined, 'no read came back full');
  // the reads are the search's usual ones: no posting outside a by-id fetch, no OR past 15 patterns
  // (the employer-posted pool — Seen's own employers' posts, cached per instance — is a separate, older read)
  for (const u of urls.filter((x) => x.startsWith('/rest/v1/jobs') && !x.includes('employer_user_id'))) {
    const sel = (u.split('select=')[1] || '').split('&')[0];
    if (/description/.test(sel)) assert.match(u, /[?&]id=in\./, `a posting read by id only: ${u}`);
    for (const m of u.matchAll(/[?&]or=\((.*?)\)(?:&|$)/g)) assert.ok(m[1].split(',').length <= 15, u);
  }
});

test('a full search carries the family titles it showed and the stated pay — never `elsewhere`', async () => {
  const res = await call({ query: 'roustabout', location: '', radius: '25', db_only: true });
  assert.equal(res.code, 200);
  assert.ok(res.body.also_searched.includes('Floorhand'), JSON.stringify(res.body.also_searched));
  assert.ok(!res.body.also_searched.some((t) => /roustabout/i.test(t)));
  const p = res.body.pay_summary;
  assert.equal(p.unit, 'hr');
  assert.equal(p.stated, res.body.jobs.filter((j) => j.related !== false && /\/hr$/.test(j.salary || '')).length);
  assert.ok(p.low >= 20 && p.high <= 33, JSON.stringify(p));
  assert.equal(res.body.elsewhere, undefined);
});

test('a search with no family and no stated pay adds nothing', async () => {
  const res = await call({ query: 'barista', location: 'Boise, ID', radius: '25', db_only: true });
  assert.equal(res.code, 200);
  assert.equal(res.body.also_searched, undefined);
  assert.equal(res.body.pay_summary, undefined);
});

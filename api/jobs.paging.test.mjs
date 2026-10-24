// Search paging ("Show 60 more"), per-row `related` (a match vs another opening) and Seen's own seed
// rows (audit 2026-10-24: M9, H9, M14). Fake PostgREST that honours `limit`; no network.
// Run: node --test api/jobs.paging.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://db.example';
process.env.SUPABASE_SERVICE_KEY = 'service-key';
delete process.env.ADZUNA_APP_ID; delete process.env.ADZUNA_APP_KEY;

const FUTURE = new Date(Date.now() + 86_400_000).toISOString();
const id = (n) => `20000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const base = { location: 'Phoenix, AZ', lat: 33.45, lng: -112.07, expires_at: FUTURE, created_at: new Date().toISOString(), search_query: 'pharmacy technician', description: 'Fill prescriptions and help patients at the counter.' };
// 150 real pharmacy technicians, 5 facilities "technicians" that only share a word, and the seed row.
const CORPUS = [
  ...Array.from({ length: 150 }, (_, i) => ({ ...base, id: id(i + 1), title: `Pharmacy Technician ${i + 1}`, company: `Pharmacy ${i + 1}`, apply_url: `https://example.com/p${i + 1}`, score: 90 - (i % 40) })),
  ...Array.from({ length: 5 }, (_, i) => ({ ...base, id: id(500 + i), title: 'Environmental Services & Facilities Technician', company: `Hospital ${i}`, apply_url: `https://example.com/f${i}`, score: 95, search_query: 'technician' })),
  { ...base, id: id(900), title: 'Pharmacy Technician', company: 'Seen Jobs', apply_url: 'https://Seenjobs.io', score: 99, is_employer_posted: true },
];
const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } });
globalThis.fetch = async (url) => {
  const u = new URL(String(url));
  if (u.pathname === '/rest/v1/jobs') {
    if (u.searchParams.get('employer_user_id')) return json([]);
    const limit = Number(u.searchParams.get('limit')) || 1000;
    return json(CORPUS.slice(0, limit));
  }
  if (u.pathname === '/rest/v1/geocode_cache') return json([{ lat: 33.45, lng: -112.07 }]);
  return json([]);
};
const { default: handler } = await import('./jobs.js');
function call(body) {
  const res = { code: 200, body: null, setHeader() {}, status(c) { this.code = c; return this; }, json(o) { this.body = o; return this; }, end() { return this; } };
  return handler({ method: 'POST', body, headers: { 'x-forwarded-for': `10.9.${Math.floor(Math.random() * 200)}.1` }, query: {}, socket: { remoteAddress: '10.0.0.1' } }, res).then(() => res);
}

test('page one: 60 rows, has_more, matches first, the facilities "technicians" flagged as other openings', async () => {
  const res = await call({ query: 'pharmacy technician', location: 'Phoenix, AZ', radius: '25' });
  assert.equal(res.code, 200, JSON.stringify(res.body));
  assert.equal(res.body.jobs.length, 60);
  assert.equal(res.body.has_more, true);
  assert.equal(res.body.offset, 0);
  for (const j of res.body.jobs) assert.equal(j.related, /^Pharmacy Technician/.test(j.title), j.title);
  assert.ok(!res.body.jobs.some((j) => j.company === 'Seen Jobs'), 'the seed row is never served');
});

test('offset 60 / 120: the next distinct slices; the last page says has_more:false', async () => {
  const p1 = await call({ query: 'pharmacy technician', location: 'Phoenix, AZ', radius: '25' });
  const ids1 = p1.body.jobs.map((j) => j.id);
  const p2 = await call({ query: 'pharmacy technician', location: 'Phoenix, AZ', radius: '25', offset: 60, exclude: ids1 });
  const p3 = await call({ query: 'pharmacy technician', location: 'Phoenix, AZ', radius: '25', offset: 120, exclude: [...ids1, ...p2.body.jobs.map((j) => j.id)] });
  assert.equal(p2.body._src, 'db-page');
  assert.equal(p2.body.jobs.length, 60);
  assert.equal(p2.body.has_more, true);
  const ids = new Set([...p1.body.jobs, ...p2.body.jobs].map((j) => j.id));
  assert.equal(ids.size, 120, 'no row repeats across pages');
  assert.ok(p3.body.jobs.length > 0 && p3.body.jobs.length <= 60);
  assert.equal(new Set([...p1.body.jobs, ...p2.body.jobs, ...p3.body.jobs].map((j) => j.id)).size, 120 + p3.body.jobs.length, 'page three repeats nothing either');
  assert.equal(p3.body.has_more, false);
  assert.equal(p3.body.topup ?? null, null, 'a later page never starts a live pull');
  const all = [...p1.body.jobs, ...p2.body.jobs, ...p3.body.jobs];
  assert.ok(!all.some((j) => j.company === 'Seen Jobs'));
});

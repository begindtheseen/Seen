// Public reads as cacheable GETs (lib/server/publicRead.js): a GET with ?type= reaches the same handler
// branch as the POST body, carries the CDN cache header, and can never reach a write action.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://fake.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'service-key';
delete process.env.ANTHROPIC_KEY;

const FUTURE = new Date(Date.now() + 7 * 86_400_000).toISOString();
const REPORTS = [
  { id: 'r1', company_name: 'sheetz', role: 'store team member', outcome: 'interview', platform: 'Seen', created_at: '2026-10-20T10:00:00Z', location_id: null },
  { id: 'r2', company_name: 'sheetz distribution services', role: 'driver', outcome: 'ghosted', platform: 'Seen', created_at: '2026-10-19T10:00:00Z', location_id: null },
];
let calls = [];
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  const method = (init.method || 'GET').toUpperCase();
  calls.push({ path: u.pathname, search: u.search, method });
  assert.equal(u.hostname, 'fake.supabase.co');
  if (u.pathname === '/rest/v1/rpc/increment_rate_limit') return new Response('1', { status: 200, headers: { 'content-type': 'application/json' } });
  assert.equal(method, 'GET', `a public read must never write: ${method} ${u.pathname}`);
  if (u.pathname === '/rest/v1/employer_perks') return Response.json([{ featured_until: FUTURE, verified_until: null }]);
  if (u.pathname === '/rest/v1/reports') return Response.json(REPORTS);
  if (u.pathname === '/rest/v1/company_locations') return Response.json([]);
  return Response.json([]);
};

const handler = (await import('./reports.js')).default;
async function run({ method = 'GET', query = {}, body = undefined }) {
  calls = [];
  const res = { statusCode: 200, headers: {}, body: null, setHeader(k, v) { this.headers[k.toLowerCase()] = String(v); }, status(c) { this.statusCode = c; return this; }, json(o) { this.body = o; return this; }, end(s) { this.body = s; return this; } };
  await handler({ method, body, query, headers: { 'x-real-ip': '203.0.113.5' }, socket: { remoteAddress: '203.0.113.5' } }, res);
  return res;
}

test('GET ?type=perk answers exactly what the POST does, with the CDN cache header', async () => {
  const get = await run({ query: { type: 'perk', name: 'Sheetz' } });
  const post = await run({ method: 'POST', body: { action: 'employer_perk', name: 'Sheetz' } });
  assert.equal(get.statusCode, 200);
  assert.deepEqual(get.body, { featured: true, verified: false });
  assert.deepEqual(get.body, post.body);
  assert.equal(get.headers['cache-control'], 'public, s-maxage=300, stale-while-revalidate=600');
});

test('GET ?type=list reads the reports once (no companies / company_id follow-up), filters to the same company, caches for a minute', async () => {
  const get = await run({ query: { type: 'list', company: 'sheetz', city: '' } });
  assert.equal(get.statusCode, 200);
  assert.deepEqual(get.body.reports.map((r) => r.id), ['r1'], '"sheetz distribution services" is not Sheetz');
  assert.equal(get.body.total, 1);
  const reads = calls.filter((c) => c.method === 'GET');
  assert.deepEqual(reads.map((c) => c.path), ['/rest/v1/reports'], 'one read: the former companies + company_id merge is gone');
  assert.match(reads[0].search, /company_name=ilike\.\*sheetz\*/);
  assert.equal(get.headers['cache-control'], 'public, s-maxage=60, stale-while-revalidate=600');
  const post = await run({ method: 'POST', body: { company: 'sheetz', city: '' } });
  assert.deepEqual(post.body, get.body);
});

test('a GET can never reach a write or an unlisted action — it falls to the legacy GET contract (400)', async () => {
  for (const query of [{ type: 'submit', name: 'x' }, { type: 'quick_submit' }, { type: 'feed' }, { action: 'submit' }, {}]) {
    const r = await run({ query });
    assert.equal(r.statusCode, 400, JSON.stringify(query));
    assert.ok(!calls.some((c) => c.method !== 'GET' && c.path !== '/rest/v1/rpc/increment_rate_limit'), 'nothing written');
    assert.ok(!calls.some((c) => c.path === '/rest/v1/reports' && c.method !== 'GET'));
  }
  const legacy = await run({ query: { type: 'industry' } });
  assert.equal(legacy.statusCode, 200, 'the pre-existing GET ?type=industry benchmark path is untouched');
  assert.ok(legacy.body.benchmarks);
});

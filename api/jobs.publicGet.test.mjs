// api/jobs.js: only the two company-page reads are served as GETs (lib/server/publicRead.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://fake.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'service-key';
process.env.ADZUNA_APP_ID = 'id';
process.env.ADZUNA_APP_KEY = 'key';
delete process.env.SUPABASE_JWT_SECRET;

let calls = [];
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  const method = (init.method || 'GET').toUpperCase();
  calls.push({ path: u.pathname, search: u.search, method });
  if (u.pathname === '/rest/v1/rpc/increment_rate_limit') return new Response('1', { status: 200, headers: { 'content-type': 'application/json' } });
  assert.equal(u.hostname, 'fake.supabase.co');
  assert.equal(method, 'GET', `a public read must never write: ${method} ${u.pathname}`);
  return Response.json([]);
};
const handler = (await import('./jobs.js')).default;
async function run({ method = 'GET', query = {}, body = undefined }) {
  calls = [];
  const res = { statusCode: 200, headers: {}, body: null, setHeader(k, v) { this.headers[k.toLowerCase()] = String(v); }, status(c) { this.statusCode = c; return this; }, json(o) { this.body = o; return this; }, end(s) { this.body = s; return this; } };
  await handler({ method, body, query, headers: { 'x-real-ip': '203.0.113.5' }, socket: { remoteAddress: '203.0.113.5' } }, res);
  return res;
}

test('GET ?action=listing_signals is routed like the POST and carries the cache header', async () => {
  const get = await run({ query: { action: 'listing_signals', company: 'SpaceX' } });
  assert.equal(get.statusCode, 200);
  assert.equal(get.body.ok, true);
  assert.equal(get.body.signals.rated, false, 'no open posts in the stub → honest unrated answer');
  assert.ok(calls.some((c) => c.path === '/rest/v1/jobs' && /company=ilike\.\*spacex\*/.test(c.search)), 'reads the company posts');
  assert.equal(get.headers['cache-control'], 'public, s-maxage=600, stale-while-revalidate=1800');
  const post = await run({ method: 'POST', body: { action: 'listing_signals', company: 'SpaceX' } });
  // The handler memoizes signals per instance for 30 min, so the second call is marked _src:'cache' — same data.
  const { _src: _a, ...postBody } = post.body; const { _src: _b, ...getBody } = get.body;
  assert.deepEqual(postBody, getBody);
});

test('every other GET is still refused (405): search and user-specific reads stay POST', async () => {
  for (const query of [{ action: 'recommended' }, { action: 'get_by_id', id: 'x' }, { query: 'nurse', location: 'Dallas' }, { action: 'listing_signals' }, {}]) {
    const r = await run({ query });
    assert.equal(r.statusCode, 405, JSON.stringify(query));
    assert.equal(calls.length, 0, 'refused before any database call');
  }
});

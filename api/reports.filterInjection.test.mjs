// Names a visitor sends can never add PostgREST parameters or act as wildcards (security audit
// 2026-11-01, lib/server/pgrest.js). batch_scores built its in.(…) list without URL-encoding, so a
// raw `&` in a name added parameters (e.g. a wider select) to a service-key read.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://fake.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'service-key';

let calls = [];
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  calls.push({ path: u.pathname, params: [...u.searchParams], method: (init.method || 'GET').toUpperCase() });
  if (u.pathname === '/rest/v1/rpc/increment_rate_limit') return new Response('1', { status: 200, headers: { 'content-type': 'application/json' } });
  return Response.json([]);
};

const handler = (await import('./reports.js')).default;
async function run(body) {
  calls = [];
  const res = { statusCode: 200, headers: {}, body: null, setHeader(k, v) { this.headers[k.toLowerCase()] = String(v); }, status(c) { this.statusCode = c; return this; }, json(o) { this.body = o; return this; }, end(s) { this.body = s; return this; } };
  await handler({ method: 'POST', body, query: {}, headers: { 'x-real-ip': '203.0.113.9' }, socket: { remoteAddress: '203.0.113.9' } }, res);
  return res;
}

const EVIL = 'acme%22)&select=*,reports(*)&limit=100000&x=("';

test('batch_scores: a name cannot add parameters to the company_scores read', async () => {
  const r = await run({ action: 'batch_scores', names: ['walmart', EVIL] });
  assert.equal(r.statusCode, 200);
  const read = calls.find((c) => c.path === '/rest/v1/company_scores' && c.params.some(([k]) => k === 'company_name'));
  assert.ok(read, 'the scores were read');
  const keys = read.params.map(([k]) => k);
  assert.deepEqual(keys.filter((k) => k === 'select'), ['select']);
  assert.ok(!keys.includes('x') && keys.filter((k) => k === 'limit').length === 1);
  const list = read.params.find(([k]) => k === 'company_name')[1];
  assert.equal(list, 'in.("walmart","acme%22)&select=*,reports(*)&limit=100000&x=(")');
  assert.ok(!read.params.find(([k]) => k === 'select')[1].includes('reports('));
});

test('ghost_surges: names stay inside one quoted list', async () => {
  await run({ action: 'ghost_surges', names: ['target', 'x"),or=(id.gt.0'] });
  const read = calls.find((c) => c.path === '/rest/v1/reports');
  const keys = read.params.map(([k]) => k);
  assert.ok(!keys.includes('or'), 'no injected or=');
  assert.equal(read.params.find(([k]) => k === 'company_name')[1], 'in.("target","x),or=(id.gt.0")');
});

test('company score lookup: a * in the name is not a wildcard', async () => {
  await run({ action: 'resolve', query: 'a*' });
  const alias = calls.find((c) => c.path === '/rest/v1/company_aliases');
  assert.equal(alias.params.find(([k]) => k === 'alias')[1], 'ilike.a_');
});

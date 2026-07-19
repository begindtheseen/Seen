// Endpoint routing / validation / load-smoke tests for api/company-reddit.js.
// Network-free: env is unset so no Reddit call and no Supabase call is made (both paths
// degrade gracefully). Importing the handler at all is itself the load smoke test — an
// unresolved import here would red the gate (the phantom-import failure class).
// Run: node --test api/company-reddit.endpoint.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Ensure no DB/network is reachable from these tests.
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_KEY;

const handler = (await import('./company-reddit.js')).default;

function mockReq({ method = 'POST', body = {}, query = {}, headers = {} } = {}) {
  return { method, body, query, headers, socket: { remoteAddress: '127.0.0.1' } };
}
function mockRes() {
  const res = { statusCode: 0, headers: {}, body: undefined, ended: false };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { res.body = o; res.ended = true; return res; };
  res.end = () => { res.ended = true; return res; };
  return res;
}

test('handler is a function (load smoke — imports resolve)', () => {
  assert.equal(typeof handler, 'function');
});

test('OPTIONS preflight → 200 with CORS headers', async () => {
  const res = mockRes();
  await handler(mockReq({ method: 'OPTIONS' }), res);
  assert.equal(res.statusCode, 200);
  assert.ok(res.headers['access-control-allow-methods'].includes('POST'));
});

test('POST lookup with an invalid company → 400 (before any network)', async () => {
  const res = mockRes();
  await handler(mockReq({ body: { company: 'unknown' } }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.ok, false);
});

test('GET lookup with no company → 400', async () => {
  const res = mockRes();
  await handler(mockReq({ method: 'GET', body: undefined, query: {} }), res);
  assert.equal(res.statusCode, 400);
});

test('dispute with an invalid reason → 400', async () => {
  const res = mockRes();
  await handler(mockReq({ body: { action: 'dispute', company: 'Acme', reason: 'nope', detail: 'this is long enough detail' } }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.ok, false);
});

test('valid dispute with no DB configured → 503 (graceful, never crashes)', async () => {
  const res = mockRes();
  await handler(mockReq({ body: { action: 'dispute', company: 'Acme', reason: 'not_us', detail: 'This is a different company entirely.' } }), res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.ok, false);
});

test('string body is parsed (Vercel raw-body shape)', async () => {
  const res = mockRes();
  await handler(mockReq({ body: JSON.stringify({ company: 'n/a' }) }), res);
  assert.equal(res.statusCode, 400);   // "n/a" is a blocked placeholder → validation 400, proves parse worked
});

// The health read is how a deployment is checked for its shipped data files (vercel.json includeFiles cannot be
// proven locally). It must be true here, must answer false per data set rather than throw, and must not reach the
// database or the rate limiter — it is called on production after a deploy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { knowledgeHealth } from './knowledgeHealth.js';

test('every shipped data set answers a real lookup', () => {
  const h = knowledgeHealth();
  assert.deepEqual(h.checks, { occupations: true, military: true, work_families: true, synonyms: true, trade_talk: true, activities: true, places: true, zip_codes: true });
  assert.equal(h.ok, true);
  assert.match(h.engine_version, /^seenfit-\d+\.\d+\.\d+$/);
});

test('GET /api/optimizer?health=1 answers without a database call or a rate-limit row', async () => {
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (u) => { calls.push(String(u)); throw new Error('no network in the health read'); };
  const env = { u: process.env.SUPABASE_URL, k: process.env.SUPABASE_SERVICE_KEY };
  process.env.SUPABASE_URL = 'https://db.invalid'; process.env.SUPABASE_SERVICE_KEY = 'x';
  try {
    const { default: handler } = await import('../../api/optimizer.js');
    const out = { status: 0, body: null, headers: {} };
    const res = {
      setHeader(k, v) { out.headers[k.toLowerCase()] = v; },
      status(s) { out.status = s; return res; },
      json(b) { out.body = b; return res; },
      end() { return res; },
    };
    await handler({ method: 'GET', url: '/api/optimizer?health=1', query: { health: '1' }, headers: {} }, res);
    assert.equal(out.status, 200);
    assert.equal(out.body.ok, true);
    assert.equal(out.headers['cache-control'], 'no-store');
    assert.deepEqual(calls, []);
    // a GET without the flag is still not a way in
    const out2 = { status: 0 };
    const res2 = { setHeader() {}, status(s) { out2.status = s; return res2; }, json() { return res2; }, end() { return res2; } };
    await handler({ method: 'GET', url: '/api/optimizer', query: {}, headers: {} }, res2).catch(() => {});
    assert.notEqual(out2.status, 200);
  } finally {
    globalThis.fetch = realFetch;
    if (env.u == null) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = env.u;
    if (env.k == null) delete process.env.SUPABASE_SERVICE_KEY; else process.env.SUPABASE_SERVICE_KEY = env.k;
  }
});

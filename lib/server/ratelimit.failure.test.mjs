// What the rate limiter does when its shared counter (Supabase increment_rate_limit) is down,
// and which bucket a request lands in. Run: node --test lib/server/ratelimit.failure.test.mjs
//
// H6: expensive endpoints refuse (503) instead of waving traffic through; cheap endpoints fall
// back to an in-memory counter that still enforces the limit. M5: signed-in requests are
// limited per user, anonymous ones per IP.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  rateLimit, applyRateLimit, isFailClosedEndpoint, _resetMemoryCounters,
} from './ratelimit.js';

const SAVED = { ...process.env };
const realFetch = global.fetch;

beforeEach(() => {
  _resetMemoryCounters();
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_KEY = 'svc';
  delete process.env.SUPABASE_JWT_SECRET;
});
afterEach(() => {
  global.fetch = realFetch;
  for (const k of Object.keys(process.env)) if (!(k in SAVED)) delete process.env[k];
  Object.assign(process.env, SAVED);
});

const req = (headers = {}) => ({ method: 'POST', headers: { 'x-real-ip': '203.0.113.9', ...headers } });

function makeRes() {
  const r = { statusCode: 200, body: null, headers: {} };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (o) => { r.body = o; return r; };
  r.end = () => r;
  return r;
}

function makeJwt(sub, secret) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = enc({ alg: 'HS256', typ: 'JWT' });
  const body = enc({ sub, exp: Math.floor(Date.now() / 1000) + 3600 });
  const sig = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

const downFetch = async () => { throw new Error('connect ECONNREFUSED'); };

test('expensive endpoints are classified fail-closed; cheap ones are not', () => {
  for (const e of ['resume-scanner', 'resume-anything', 'job-insights', 'parse-resume', 'email-analysis', 'apply', 'import-listing', 'fetch-location-jobs', 'admin-login']) {
    assert.equal(isFailClosedEndpoint(e), true, e);
  }
  for (const e of ['job-search', 'job-read', 'benchmarks', 'demand', 'user-sync', 'company-score']) {
    assert.equal(isFailClosedEndpoint(e), false, e);
  }
});

test('counter down: a paid AI endpoint is refused, not waved through', async () => {
  global.fetch = downFetch;
  const r = await rateLimit(req(), 'resume-scanner');
  assert.equal(r.allowed, false);
  assert.equal(r.unavailable, true);
});

test('counter down: applyRateLimit answers 503 for a fail-closed endpoint', async () => {
  global.fetch = downFetch;
  const res = makeRes();
  const stop = await applyRateLimit(req(), res, 'import-listing');
  assert.equal(stop, true);
  assert.equal(res.statusCode, 503);
  assert.equal(res.headers['retry-after'], '30');
});

test('counter returns HTTP 500: still refused for fail-closed endpoints', async () => {
  global.fetch = async () => ({ ok: false, status: 500, json: async () => null });
  const r = await rateLimit(req(), 'job-insights');
  assert.equal(r.unavailable, true);
  assert.equal(r.allowed, false);
});

test('counter down: a cheap endpoint is still capped by the in-memory fallback', async () => {
  global.fetch = downFetch;
  const limit = (await rateLimit(req(), 'benchmarks')).limit; // 40/hour
  let allowed = 1;
  for (let i = 1; i < limit + 5; i++) {
    if ((await rateLimit(req(), 'benchmarks')).allowed) allowed++;
  }
  assert.equal(allowed, limit, 'exactly `limit` requests pass, the rest are blocked');
  const after = await rateLimit(req(), 'benchmarks');
  assert.equal(after.allowed, false);
  assert.equal(after.fallback, 'memory');
  assert.ok(!after.unavailable, 'cheap endpoints answer 429 when over, never 503');
});

test('in-memory fallback keys per bucket: another IP is unaffected', async () => {
  global.fetch = downFetch;
  for (let i = 0; i < 50; i++) await rateLimit(req(), 'benchmarks');
  const other = await rateLimit(req({ 'x-real-ip': '198.51.100.1' }), 'benchmarks');
  assert.equal(other.allowed, true);
});

test('no DB configured: closed for paid endpoints, memory-capped for cheap ones', async () => {
  delete process.env.SUPABASE_URL;
  global.fetch = async () => { throw new Error('must not be called'); };
  assert.equal((await rateLimit(req(), 'parse-resume')).unavailable, true);
  const cheap = await rateLimit(req(), 'demand');
  assert.equal(cheap.allowed, true);
  assert.equal(cheap.fallback, 'memory');
});

test('counter up: the DB count decides, and the key is per-IP for anonymous callers', async () => {
  const bodies = [];
  global.fetch = async (url, opts) => {
    bodies.push(JSON.parse(opts.body));
    return { ok: true, status: 200, json: async () => 11 };
  };
  const r = await rateLimit(req(), 'resume-scanner'); // limit 10
  assert.equal(r.allowed, false);
  assert.equal(r.count, 11);
  assert.match(bodies[0].p_key, /^ip:203\.0\.113\.9:resume-scanner:\d+$/);
  assert.equal(bodies[0].p_ttl_seconds, 3600);
});

test('signed-in caller is limited per USER by default (M5), not per shared IP', async () => {
  process.env.SUPABASE_JWT_SECRET = 'jwt-secret';
  const bodies = [];
  global.fetch = async (url, opts) => { bodies.push(JSON.parse(opts.body)); return { ok: true, status: 200, json: async () => 1 }; };
  await rateLimit(req({ authorization: `Bearer ${makeJwt('user-123', 'jwt-secret')}` }), 'resume-coach');
  assert.match(bodies[0].p_key, /^user:user-123:resume-coach:\d+$/);
});

test('custom window + limit (admin login: 5 per 15 minutes)', async () => {
  const bodies = [];
  global.fetch = async (url, opts) => { bodies.push(JSON.parse(opts.body)); return { ok: true, status: 200, json: async () => 6 }; };
  const r = await rateLimit(req(), 'admin-login', { bucketKey: 'ip:203.0.113.9', windowSec: 900, limit: 5 });
  assert.equal(r.allowed, false);
  assert.equal(r.limit, 5);
  assert.equal(bodies[0].p_ttl_seconds, 900);
});

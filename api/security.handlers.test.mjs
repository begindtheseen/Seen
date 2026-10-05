// Handler-level checks for the security hardening pass: each test calls the real exported
// handler with a mocked Supabase/REST layer, so the request → auth → response path is exercised
// end to end. Run: node --test api/security.handlers.test.mjs

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac, scryptSync } from 'node:crypto';
import { _resetMemoryCounters } from '../lib/server/ratelimit.js';

const SAVED = { ...process.env };
const realFetch = global.fetch;
const JWT_SECRET = 'test-jwt-secret';

beforeEach(() => {
  _resetMemoryCounters();
  process.env.SUPABASE_URL = 'https://db.example';
  process.env.SUPABASE_SERVICE_KEY = 'svc-key';
  process.env.SUPABASE_JWT_SECRET = JWT_SECRET;
  delete process.env.CRON_SECRET;
});
afterEach(() => {
  global.fetch = realFetch;
  for (const k of Object.keys(process.env)) if (!(k in SAVED)) delete process.env[k];
  Object.assign(process.env, SAVED);
});

const { default: importListing } = await import('./import-listing.js');
const { default: adminStats } = await import('./admin-stats.js');
const { default: refreshStaleJobs } = await import('./refresh-stale-jobs.js');
const { default: employerRenewals } = await import('./employer-renewals.js');
const { default: companySignals } = await import('./company-signals.js');
const { default: refreshJobs } = await import('./refresh-jobs.js');

function makeRes() {
  const r = { statusCode: 200, body: null, headers: {}, headersSent: false };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (o) => { r.body = o; r.headersSent = true; return r; };
  r.end = () => { r.headersSent = true; return r; };
  return r;
}
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body), headers: { get: () => null } });

function makeJwt(sub) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = enc({ alg: 'HS256', typ: 'JWT' });
  const body = enc({ sub, email: `${sub}@example.com`, exp: Math.floor(Date.now() / 1000) + 3600 });
  const sig = createHmac('sha256', JWT_SECRET).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

// Records every outbound call; the rate-limit counter answers 1 (well under any limit).
function installFetch(route = () => null) {
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    calls.push({ url: u, method: opts.method || 'GET', body: opts.body, headers: opts.headers || {} });
    if (u.includes('/rpc/increment_rate_limit')) return json(1);
    const r = route(u, opts);
    if (r) return r;
    if (u.includes('/auth/v1/user')) return json({ message: 'invalid' }, 401);
    return json([]);
  };
  return calls;
}

// ── import-listing: signed-in users only ──────────────────────────────────────

test('import-listing POST without a token is refused before any page is fetched', async () => {
  const calls = installFetch();
  const res = makeRes();
  await importListing({ method: 'POST', url: '/api/import-listing', headers: { 'x-real-ip': '1.2.3.4' }, body: { url: 'https://boards.greenhouse.io/acme/jobs/1' } }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.auth_required, true);
  assert.deepEqual(calls.filter(c => !c.url.includes('increment_rate_limit')).map(c => c.url), [], 'no outbound fetch, no DB write');
});

test('import-listing POST with a forged/expired token is refused', async () => {
  installFetch();
  const res = makeRes();
  await importListing({ method: 'POST', url: '/api/import-listing', headers: { authorization: 'Bearer not.a.jwt' }, body: { url: 'https://boards.greenhouse.io/acme/jobs/1' } }, res);
  assert.equal(res.statusCode, 401);
});

test('import-listing GET dry-run is also signed-in only', async () => {
  installFetch();
  const res = makeRes();
  await importListing({ method: 'GET', url: '/api/import-listing?dry=1&url=https%3A%2F%2Fexample.com%2Fjob', headers: {} }, res);
  assert.equal(res.statusCode, 401);
});

test('import-listing with a valid session passes auth and reaches validation', async () => {
  const calls = installFetch();
  const res = makeRes();
  await importListing({ method: 'POST', url: '/api/import-listing', headers: { authorization: `Bearer ${makeJwt('user-1')}` }, body: { url: 'not a url' } }, res);
  assert.equal(res.statusCode, 400, 'auth passed; the bad URL is what stopped it');
  const rl = calls.find(c => c.url.includes('increment_rate_limit'));
  assert.match(JSON.parse(rl.body).p_key, /^user:user-1:import-listing:/, 'limited per user');
});

test('import-listing refuses (503) instead of running when the rate-limit counter is down', async () => {
  global.fetch = async () => { throw new Error('db down'); };
  const res = makeRes();
  await importListing({ method: 'POST', url: '/api/import-listing', headers: { authorization: `Bearer ${makeJwt('user-1')}` }, body: { url: 'https://example.com/job' } }, res);
  assert.equal(res.statusCode, 503);
});

// ── admin sessions: only the digest is stored ─────────────────────────────────

test('admin login stores SHA-256(token), returns the raw token, and the raw token authenticates', async () => {
  const salt = 'abcd';
  const password = 'correct horse';
  const account = { id: 7, username: 'boss', role: 'super_admin', is_active: true, salt, password_hash: scryptSync(password, salt, 64).toString('hex') };
  let stored = null;
  const calls = installFetch((u, opts) => {
    if (u.includes('/admin_accounts?select=id')) return json([{ id: 7 }]);
    if (u.includes('/admin_accounts?username=eq.')) return json([account]);
    if (u.endsWith('/admin_sessions') && opts.method === 'POST') { stored = JSON.parse(opts.body); return json(null, 201); }
    if (u.includes('/admin_sessions?token=eq.')) {
      const presented = u.split('token=eq.')[1].split('&')[0];
      return json(stored && presented === stored.token ? [{ ...stored }] : []);
    }
    return null;
  });

  const res = makeRes();
  await adminStats({ method: 'POST', headers: { 'x-real-ip': '9.9.9.9' }, body: { action: 'admin_login', username: 'boss', password } }, res);
  assert.equal(res.statusCode, 200);
  const raw = res.body.token;
  assert.match(raw, /^[0-9a-f]{64}$/);
  assert.equal(stored.token, createHash('sha256').update(raw).digest('hex'), 'table holds the digest');
  assert.notEqual(stored.token, raw);

  // The raw token (what the browser holds) works; the stored digest (what a table dump yields) does not.
  const ok = makeRes();
  await adminStats({ method: 'POST', headers: { 'x-admin-token': raw }, body: { action: 'admin_logout' } }, ok);
  assert.equal(ok.statusCode, 200);
  const stolen = makeRes();
  await adminStats({ method: 'POST', headers: { 'x-admin-token': stored.token }, body: { action: 'admin_logout' } }, stolen);
  assert.equal(stolen.statusCode, 401);

  // The login limiter is keyed on the trusted client IP, in a 15-minute window.
  const rl = calls.find(c => c.url.includes('increment_rate_limit'));
  const rlBody = JSON.parse(rl.body);
  assert.match(rlBody.p_key, /^ip:9\.9\.9\.9:admin-login:/);
  assert.equal(rlBody.p_ttl_seconds, 900);
});

test('admin login is refused when the login limiter cannot be reached', async () => {
  global.fetch = async (u) => {
    if (String(u).includes('increment_rate_limit')) throw new Error('db down');
    return json([]);
  };
  const res = makeRes();
  await adminStats({ method: 'POST', headers: {}, body: { action: 'admin_login', username: 'x', password: 'y' } }, res);
  assert.equal(res.statusCode, 503);
});

test('a spoofed X-Forwarded-For does not mint a fresh admin-login bucket', async () => {
  const calls = installFetch((u) => (u.includes('/admin_accounts') ? json([]) : null));
  for (const xff of ['10.0.0.1', '10.0.0.2']) {
    await adminStats({ method: 'POST', headers: { 'x-real-ip': '9.9.9.9', 'x-forwarded-for': xff }, body: { action: 'admin_login', username: 'x', password: 'y' } }, makeRes());
  }
  const keys = calls.filter(c => c.url.includes('increment_rate_limit')).map(c => JSON.parse(c.body).p_key.split(':admin-login:')[0]);
  assert.deepEqual(keys, ['ip:9.9.9.9', 'ip:9.9.9.9']);
});

// ── cron routes ───────────────────────────────────────────────────────────────

test('refresh-stale-jobs no longer runs for an anonymous caller when CRON_SECRET is unset', async () => {
  const calls = installFetch();
  const res = makeRes();
  await refreshStaleJobs({ method: 'POST', url: '/api/refresh-stale-jobs', headers: {} }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(calls.length, 0);
});

test('employer-renewals requires the scheduler or an admin (it emails customers)', async () => {
  installFetch();
  for (const req of [
    { method: 'GET', url: '/api/employer-renewals?cron=1', query: { cron: '1' }, headers: {} },
    { method: 'POST', url: '/api/employer-renewals', headers: {} },
  ]) {
    const res = makeRes();
    await employerRenewals(req, res);
    assert.equal(res.statusCode, 401, req.method);
  }
  // The scheduler still gets through (CRON_SECRET unset → Vercel's cron header).
  const ok = makeRes();
  await employerRenewals({ method: 'GET', url: '/api/employer-renewals', headers: { 'x-vercel-cron': '1' } }, ok);
  assert.equal(ok.statusCode, 200);
});

test('with CRON_SECRET set, a forged x-vercel-cron header cannot start the SEC ingest', async () => {
  process.env.CRON_SECRET = 'cron-secret-value';
  const calls = installFetch();
  const res = makeRes();
  await companySignals({ method: 'GET', url: '/api/company-signals', query: {}, headers: { 'x-vercel-cron': '1' } }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(calls.length, 0);
});

test('refresh-jobs: forged cron header refused when CRON_SECRET is set; admin session checked by digest', async () => {
  process.env.CRON_SECRET = 'cron-secret-value';
  const calls = installFetch();
  const res = makeRes();
  await refreshJobs({ method: 'GET', url: '/api/refresh-jobs', headers: { 'x-vercel-cron': '1' } }, res);
  assert.equal(res.statusCode, 401);

  const res2 = makeRes();
  await refreshJobs({ method: 'POST', url: '/api/refresh-jobs?secret=cron-secret-value', headers: {} }, res2);
  assert.equal(res2.statusCode, 401, 'a secret in the URL is not accepted');

  const res3 = makeRes();
  await refreshJobs({ method: 'POST', url: '/api/refresh-jobs', headers: { 'x-admin-token': 'raw-admin' } }, res3);
  assert.equal(res3.statusCode, 401, 'unknown admin session');
  const lookup = calls.find(c => c.url.includes('/admin_sessions?token=eq.'));
  assert.ok(lookup.url.includes(createHash('sha256').update('raw-admin').digest('hex')));
  assert.ok(!lookup.url.includes('raw-admin'));
});

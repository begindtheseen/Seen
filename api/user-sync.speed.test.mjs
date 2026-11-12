// /api/user-sync speed contract (2026-11-12, owner: "Saving settings takes a long time then fails"):
//  - a write (save_profile) waits ONE hop for its gates (IP limit, per-user write limit, session check run together),
//    then its one upsert — never a second serial rate-limit trip;
//  - a database that does not answer is an honest 503 in seconds, never the 15 s function limit;
//  - load_profile names its columns and never ships the server-only job_keys.
// Run: node --test api/user-sync.speed.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createFakeRest } from '../lib/server/admin/testing/fakeRest.mjs';
import { resetSessionCache } from '../lib/server/supabaseJwt.js';

process.env.SUPABASE_URL = 'https://db.test';
process.env.SUPABASE_SERVICE_KEY = 'service';
process.env.SUPABASE_JWT_SECRET = 'jwt-secret';
const { default: handler } = await import('./user-sync.js');

const UID = '22222222-2222-4222-8222-222222222222';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const head = b64({ alg: 'HS256', typ: 'JWT' });
const pay = b64({ sub: UID, exp: Math.floor(Date.now() / 1000) + 3600 });
const TOKEN = `${head}.${pay}.${createHmac('sha256', 'jwt-secret').update(`${head}.${pay}`).digest('base64url')}`;

function install({ hopMs = 30, hang = null } = {}) {
  resetSessionCache();
  const rest = createFakeRest({
    tables: { profiles: [{ id: UID, name: 'Pat', city: 'Phoenix, AZ', experience: 'mid', resume_text: 'Pat\nCashier at Fry\'s 2019–2023', job_keys: { v: 10, big: 'x'.repeat(5000) }, job_keys_updated_at: '2026-11-10T00:00:00Z' }] },
    rpcs: { increment_rate_limit: () => 1 },
  });
  const timeline = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = new URL(url);
    const start = Date.now();
    const done = (r) => { timeline.push({ path: `${opts.method || 'GET'} ${u.pathname}`, start, end: Date.now() }); return r; };
    if (hang && u.pathname.includes(hang)) {
      return new Promise((_, reject) => opts.signal?.addEventListener('abort', () => reject(Object.assign(new Error('timed out'), { name: 'TimeoutError' }))));
    }
    await new Promise((r) => setTimeout(r, hopMs));
    if (u.pathname === '/auth/v1/user') return done(Response.json({ id: UID }));
    return done(await rest.fetch(String(url), opts));
  };
  return { rest, timeline };
}
function call(body) {
  const res = { statusCode: 200, body: null, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(o) { this.body = o; return this; }, end() { return this; } };
  return handler({ method: 'POST', body, headers: { authorization: `Bearer ${TOKEN}`, 'x-real-ip': '10.9.9.9' }, socket: {} }, res).then(() => res);
}

test('save_profile: the gates are one hop (both rate limits beside the session check), then one upsert', async () => {
  const { rest, timeline } = install({ hopMs: 30 });
  const t0 = Date.now();
  const r = await call({ action: 'save_profile', profile: { city: 'Mesa, AZ', experience: 'senior' } });
  const ms = Date.now() - t0;
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.ok, true);
  assert.equal(rest.tables.profiles[0].city, 'Mesa, AZ');
  const rpcs = timeline.filter((t) => t.path.endsWith('/rpc/increment_rate_limit'));
  assert.equal(rpcs.length, 2, 'IP limit + per-user write limit');
  const upsert = timeline.find((t) => t.path === 'POST /rest/v1/profiles');
  const firstHopEnd = Math.max(...timeline.filter((t) => t !== upsert).map((t) => t.end));
  for (const t of rpcs) assert.ok(t.start < firstHopEnd - 20 || t.start - t0 < 20, 'every gate starts at once, not after another');
  assert.ok(upsert.start >= firstHopEnd - 1, 'the write waits for the gates');
  assert.ok(ms < 30 * 3 + 60, `two round trips, not three (${ms} ms at 30 ms a call)`);
});

test('a hung database answers 503 "took too long" in seconds, not at the 15 s limit', async () => {
  install({ hopMs: 0, hang: '/rest/v1/profiles' });
  const keep = setInterval(() => {}, 100);
  const t0 = Date.now();
  const r = await call({ action: 'load_profile' }).finally(() => clearInterval(keep));
  assert.equal(r.statusCode, 503);
  assert.match(r.body.error, /took too long/);
  assert.ok(Date.now() - t0 < 8000, `${Date.now() - t0} ms`);
});

test('load_profile names its columns and never ships job_keys', async () => {
  const { rest } = install({ hopMs: 0 });
  const r = await call({ action: 'load_profile' });
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.profile.city, 'Phoenix, AZ');
  assert.ok(r.body.profile.resume_text, 'the résumé text the résumé tools read is kept');
  assert.ok(!('job_keys' in r.body.profile) && !('job_keys_updated_at' in r.body.profile));
  const read = rest.log.find((e) => e.path === '/rest/v1/profiles' && e.method === 'GET');
  assert.match(read.url, /select=id,name,/);
});

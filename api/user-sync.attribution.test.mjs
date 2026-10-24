// record_attribution through the REAL api/user-sync.js handler (locally signed token + in-memory
// PostgREST): every field is cleaned and clamped again on the server, the account's age comes from the
// auth server, the first record wins, a missing table is a silent "not ready", and delete_account removes
// the row.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

process.env.SUPABASE_URL = 'https://db.test';
process.env.SUPABASE_SERVICE_KEY = 'service';
process.env.SUPABASE_JWT_SECRET = 'jwt-secret';
delete process.env.STRIPE_SECRET_KEY;
const { default: userSync } = await import('./user-sync.js');
const { installFakePostgrest } = await import('../lib/server/fakePostgrest.test-helper.mjs');
const { attributionRow } = await import('../lib/server/signupAttribution.js');

const DAY = 86400e3;
const ME = '44444444-4444-4444-8444-444444444444';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function tokenFor(sub) {
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const pay = b64({ sub, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${head}.${pay}.${createHmac('sha256', 'jwt-secret').update(`${head}.${pay}`).digest('base64url')}`;
}
function call(body, sub = ME) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200, setHeader() {}, status(c) { this.statusCode = c; return this; },
      json(b) { resolve({ status: this.statusCode, body: b }); return this; }, end() { resolve({ status: this.statusCode }); },
    };
    userSync({ method: 'POST', url: '/api/user-sync', query: {}, headers: { authorization: `Bearer ${tokenFor(sub)}`, origin: 'https://seenjobs.io', 'x-real-ip': '1.2.3.4' }, body }, res);
  });
}
const user = (ageDays) => ({ [ME]: { id: ME, created_at: new Date(Date.now() - ageDays * DAY).toISOString() } });
const touch = (over = {}) => ({
  landing_path: '/company/walmart', referrer_host: 'www.reddit.com', utm_source: 'reddit', utm_medium: null,
  utm_campaign: 'ghost', utm_content: null, utm_term: null, ref_code: 'abcd2345',
  first_seen_at: new Date(Date.now() - 2 * DAY).toISOString(), ...over,
});

test('a new account records its first touch once, cleaned and clamped', async () => {
  const users = user(1);
  const f = installFakePostgrest({ authUsers: users });
  const r = await call({
    action: 'record_attribution',
    first_touch: touch({ landing_path: '/company/walmart?email=me@x.com', referrer_host: 'WWW.REDDIT.COM', utm_campaign: `ghost\u0000${'x'.repeat(400)}`, ref_code: 'BAD!', evil: 'dropped', user_id: 'someone-else' }),
    last_touch: touch({ landing_path: '/pricing', referrer_host: 'chatgpt.com', utm_source: null, ref_code: null, ip: '1.2.3.4' }),
  });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, recorded: true, final: true });
  assert.equal(f.t.signup_attribution.length, 1);
  const row = f.t.signup_attribution[0];
  assert.equal(row.user_id, ME, 'the signed-in account, never a client-sent id');
  assert.equal(row.landing_path, '/company/walmart');
  assert.equal(row.referrer_host, 'www.reddit.com');
  assert.equal(row.utm_campaign.length, 200);
  assert.ok(!row.utm_campaign.includes('\u0000'));
  assert.equal(row.ref_code, null);
  assert.equal(row.evil, undefined);
  assert.equal(row.last_touch.landing_path, '/pricing');
  assert.equal(row.last_touch.ip, undefined);
  assert.equal(row.account_created_at, users[ME].created_at, 'copied from the auth server');
  // A second device / second load: the first record wins.
  const again = await call({ action: 'record_attribution', first_touch: touch({ landing_path: '/jobs', first_seen_at: new Date(Date.now() - 3 * DAY).toISOString() }) });
  assert.deepEqual(again.body, { ok: true, recorded: false, reason: 'already_recorded', final: true });
  assert.equal(f.t.signup_attribution.length, 1);
  assert.equal(f.t.signup_attribution[0].landing_path, '/company/walmart');
});

test('an account older than 7 days is not a sign-up from this touch: nothing stored, the browser forgets it', async () => {
  const f = installFakePostgrest({ authUsers: user(8) });
  const r = await call({ action: 'record_attribution', first_touch: touch({ first_seen_at: new Date(Date.now() - 9 * DAY).toISOString() }) });
  assert.deepEqual(r.body, { ok: false, reason: 'too_old', final: true });
  assert.equal((f.t.signup_attribution || []).length, 0);
});

test('a touch that only began after the account existed is refused for good; a garbage touch too', async () => {
  const f = installFakePostgrest({ authUsers: user(3) });
  const late = await call({ action: 'record_attribution', first_touch: touch({ first_seen_at: new Date(Date.now() - DAY).toISOString() }) });
  assert.deepEqual(late.body, { ok: false, reason: 'after_signup', final: true });
  const bad = await call({ action: 'record_attribution', first_touch: { landing_path: 'https://evil.com/' } });
  assert.deepEqual(bad.body, { ok: false, reason: 'invalid', final: true });
  const none = await call({ action: 'record_attribution' });
  assert.equal(none.body.reason, 'invalid');
  assert.equal((f.t.signup_attribution || []).length, 0);
});

test('the account age comes from the auth server; an unreadable account keeps the touch for later', async () => {
  installFakePostgrest({ authUsers: {} });
  const r = await call({ action: 'record_attribution', first_touch: touch(), account_created_at: new Date().toISOString() });
  assert.deepEqual(r.body, { ok: false, reason: 'failed', final: false });
});

test('before the migration: a silent "not ready", kept for a later try, never an error', async () => {
  const f = installFakePostgrest({ authUsers: user(1), missing: ['signup_attribution'] });
  const r = await call({ action: 'record_attribution', first_touch: touch() });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: false, reason: 'not_ready', final: false });
  assert.equal(f.t.signup_attribution, undefined);
});

test('delete_account deletes the attribution row', async () => {
  const f = installFakePostgrest({ authUsers: user(1), tables: { ai_credits: [{ user_id: ME, balance: 1 }] } });
  await call({ action: 'record_attribution', first_touch: touch() });
  assert.equal(f.t.signup_attribution.length, 1);
  const r = await call({ action: 'delete_account' });
  assert.equal(r.status, 200);
  assert.equal(f.t.signup_attribution.length, 0);
  assert.ok(f.log.includes(`DELETE /rest/v1/signup_attribution?user_id=eq.${ME}`));
});

test('attributionRow (pure): 7-day boundary and clock slack', () => {
  const now = Date.UTC(2026, 9, 24);
  const created = new Date(now - 7 * DAY + 60e3).toISOString();
  assert.ok(attributionRow(ME, { first_touch: touch({ first_seen_at: new Date(now - 8 * DAY).toISOString() }) }, { accountCreatedAt: created, nowMs: now }).row);
  assert.equal(attributionRow(ME, { first_touch: touch() }, { accountCreatedAt: new Date(now - 7 * DAY - 60e3).toISOString(), nowMs: now }).error, 'too_old');
  // Seen within the hour after the account was created (device clock skew) still counts.
  const c2 = now - DAY;
  assert.ok(attributionRow(ME, { first_touch: touch({ first_seen_at: new Date(c2 + 30 * 60e3).toISOString() }) }, { accountCreatedAt: new Date(c2).toISOString(), nowMs: now }).row);
});

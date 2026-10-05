// Who may run a scheduled job (lib/server/cronAuth.js) and how admin session tokens are checked
// (lib/server/adminSession.js). Run: node --test lib/server/cronAuth.test.mjs

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { isCronAuthorized, hasCronSecret, isCronOrAdmin, secretsEqual } from './cronAuth.js';
import { hashAdminToken, findAdminSession } from './adminSession.js';

const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; });

const NO_SECRET = {};
const WITH_SECRET = { CRON_SECRET: 's3cret-value' };

test('CRON_SECRET unset: the Vercel cron header is accepted (status quo, keeps crons running)', () => {
  assert.equal(isCronAuthorized({ headers: { 'x-vercel-cron': '1' } }, NO_SECRET), true);
  assert.equal(isCronAuthorized({ headers: {} }, NO_SECRET), false);
  assert.equal(isCronAuthorized({ headers: { 'x-vercel-cron': 'true' } }, NO_SECRET), false);
});

test('CRON_SECRET set: the header alone is refused; the secret is required', () => {
  assert.equal(isCronAuthorized({ headers: { 'x-vercel-cron': '1' } }, WITH_SECRET), false);
  // What Vercel actually sends for a cron when CRON_SECRET is configured:
  assert.equal(isCronAuthorized({ headers: { 'x-vercel-cron': '1', authorization: 'Bearer s3cret-value' } }, WITH_SECRET), true);
  assert.equal(isCronAuthorized({ headers: { authorization: 'bearer s3cret-value' } }, WITH_SECRET), true);
  assert.equal(isCronAuthorized({ headers: { 'x-cron-secret': 's3cret-value' } }, WITH_SECRET), true);
  assert.equal(isCronAuthorized({ headers: { authorization: 'Bearer wrong' } }, WITH_SECRET), false);
  assert.equal(isCronAuthorized({ headers: { authorization: 's3cret-value' } }, WITH_SECRET), false, 'needs the Bearer scheme');
});

test('the secret is never read from the query string (URLs land in request logs)', () => {
  const req = { url: '/api/refresh-jobs?secret=s3cret-value', query: { secret: 's3cret-value' }, headers: {} };
  assert.equal(hasCronSecret(req, WITH_SECRET), false);
  assert.equal(isCronAuthorized(req, WITH_SECRET), false);
});

test('an empty secret never matches an empty header', () => {
  assert.equal(hasCronSecret({ headers: { authorization: 'Bearer ' } }, { CRON_SECRET: '' }), false);
  assert.equal(secretsEqual('', ''), false);
  assert.equal(secretsEqual('abc', 'abc'), true);
  assert.equal(secretsEqual('abc', 'abcd'), false);
});

test('hashAdminToken is SHA-256 hex and never the raw token', () => {
  const t = 'a'.repeat(64);
  assert.equal(hashAdminToken(t), createHash('sha256').update(t).digest('hex'));
  assert.notEqual(hashAdminToken(t), t);
  assert.match(hashAdminToken(t), /^[0-9a-f]{64}$/);
});

test('findAdminSession looks up the digest, not the raw token, and enforces expiry', async () => {
  const raw = 'raw-admin-token-123';
  const urls = [];
  let row = { expires_at: new Date(Date.now() + 3600e3).toISOString() };
  global.fetch = async (url) => { urls.push(String(url)); return { ok: true, json: async () => [row] }; };
  const opts = { SUPABASE_URL: 'https://db.example', SERVICE_KEY: 'svc' };

  assert.ok(await findAdminSession(raw, opts));
  assert.ok(urls[0].includes(`token=eq.${hashAdminToken(raw)}`));
  assert.ok(!urls[0].includes(raw), 'raw token never leaves the process');

  row = { expires_at: new Date(Date.now() - 1000).toISOString() };
  assert.equal(await findAdminSession(raw, opts), null, 'expired session refused');

  assert.equal(await findAdminSession('', opts), null);
  global.fetch = async () => { throw new Error('down'); };
  assert.equal(await findAdminSession(raw, opts), null, 'lookup failure is a refusal');
});

test('isCronOrAdmin: scheduler, then a live admin session; anonymous refused', async () => {
  const env = { ...WITH_SECRET, SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_KEY: 'svc' };
  global.fetch = async (url) => {
    const ok = String(url).includes(`token=eq.${hashAdminToken('good-admin')}`);
    return { ok: true, json: async () => (ok ? [{ expires_at: new Date(Date.now() + 3600e3).toISOString() }] : []) };
  };
  assert.equal(await isCronOrAdmin({ headers: { authorization: 'Bearer s3cret-value' } }, { env }), true);
  assert.equal(await isCronOrAdmin({ headers: { 'x-admin-token': 'good-admin' } }, { env }), true);
  assert.equal(await isCronOrAdmin({ headers: { 'x-admin-token': 'bad-admin' } }, { env }), false);
  assert.equal(await isCronOrAdmin({ headers: { 'x-vercel-cron': '1' } }, { env }), false);
  assert.equal(await isCronOrAdmin({ headers: {} }, { env }), false);
});

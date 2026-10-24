// lib/server/supabaseJwt.js — the user id comes from the token itself: HS256 with the project secret,
// ES256 against the project's JWKS (fetched once per warm instance), and only then /auth/v1/user.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, generateKeyPairSync, sign } from 'node:crypto';
import { decodeJwt, verifyHs256, verifyWithJwks, resolveUid, resetJwksCache } from './supabaseJwt.js';

const URL_ = 'https://proj.supabase.co';
const UID = '22222222-2222-4222-8222-222222222222';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = () => 1_800_000_000_000; // fixed clock
const exp = Math.floor(now() / 1000) + 3600;

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'kid-1', alg: 'ES256', use: 'sig' };
function es256(payload, kid = 'kid-1', key = privateKey) {
  const h = b64({ alg: 'ES256', typ: 'JWT', kid });
  const p = b64(payload);
  const sig = sign('sha256', Buffer.from(`${h}.${p}`), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return `${h}.${p}.${sig}`;
}
function hs256(payload, secret) {
  const h = b64({ alg: 'HS256', typ: 'JWT' });
  const p = b64(payload);
  return `${h}.${p}.${createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url')}`;
}
function fetcher(keys = [jwk]) {
  const calls = [];
  const f = async (url) => {
    calls.push(url);
    if (url.endsWith('/.well-known/jwks.json')) return Response.json({ keys });
    if (url.endsWith('/auth/v1/user')) return Response.json({ id: UID });
    return new Response(null, { status: 404 });
  };
  return { f, calls };
}

test('HS256: valid, expired and tampered tokens', () => {
  const good = hs256({ sub: UID, exp, role: 'authenticated' }, 's3cret');
  assert.equal(verifyHs256(good, 's3cret', now).sub, UID);
  assert.equal(verifyHs256(good, 'other', now), null);
  assert.equal(verifyHs256(hs256({ sub: UID, exp: exp - 7200 }, 's3cret'), 's3cret', now), null, 'expired');
  assert.equal(verifyHs256(hs256({ role: 'anon', exp }, 's3cret'), 's3cret', now), null, 'the anon key has no sub');
  assert.equal(decodeJwt('nope'), null);
});

test('ES256 via JWKS: verified locally, the key set is fetched once, a forged token is refused', async () => {
  resetJwksCache();
  const { f, calls } = fetcher();
  const tok = es256({ sub: UID, exp, role: 'authenticated' });
  const a = await verifyWithJwks(tok, URL_, { fetchImpl: f, now });
  assert.equal(a.sub, UID);
  const b = await verifyWithJwks(tok, URL_, { fetchImpl: f, now });
  assert.equal(b.sub, UID);
  assert.equal(calls.length, 1, 'JWKS fetched once for two verifications');
  // Another key pair signing the same claims: wrong signature.
  const other = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey;
  assert.equal(await verifyWithJwks(es256({ sub: UID, exp }, 'kid-1', other), URL_, { fetchImpl: f, now }), null);
  // Expired, and no sub.
  assert.equal(await verifyWithJwks(es256({ sub: UID, exp: exp - 7200 }), URL_, { fetchImpl: f, now }), null);
  assert.equal(await verifyWithJwks(es256({ exp, role: 'anon' }), URL_, { fetchImpl: f, now }), null);
});

test('ES256 via JWKS: an unknown kid re-fetches at most once a minute', async () => {
  resetJwksCache();
  const { f, calls } = fetcher();
  let t = now();
  const clock = () => t;
  assert.equal(await verifyWithJwks(es256({ sub: UID, exp }, 'kid-9'), URL_, { fetchImpl: f, now: clock }), null);
  assert.equal(await verifyWithJwks(es256({ sub: UID, exp }, 'kid-9'), URL_, { fetchImpl: f, now: clock }), null);
  assert.equal(calls.length, 1, 'no refetch storm inside the minute');
  t += 61_000;
  assert.equal(await verifyWithJwks(es256({ sub: UID, exp }, 'kid-9'), URL_, { fetchImpl: f, now: clock }), null);
  assert.equal(calls.length, 2, 'one refetch after the minute');
});

test('resolveUid: hs256 → jwks → auth API, in that order, and the network is not touched when a local check passes', async () => {
  resetJwksCache();
  const { f, calls } = fetcher();
  const opts = { supabaseUrl: URL_, serviceKey: 'svc', jwtSecret: 's3cret', fetchImpl: f, now };
  assert.deepEqual(await resolveUid(hs256({ sub: UID, exp }, 's3cret'), opts), { uid: UID, via: 'hs256' });
  assert.equal(calls.length, 0);
  assert.deepEqual(await resolveUid(es256({ sub: UID, exp }), opts), { uid: UID, via: 'jwks' });
  assert.ok(calls.every((u) => u.endsWith('/jwks.json')));
  // A token this process cannot verify (unknown kid, JWKS says no) still reaches the auth API.
  const n = calls.length;
  assert.deepEqual(await resolveUid(es256({ sub: UID, exp }, 'kid-unknown'), opts), { uid: UID, via: 'auth_api' });
  assert.ok(calls.slice(n).some((u) => u.endsWith('/auth/v1/user')));
  assert.equal(await resolveUid('', opts), null);
});

test('resolveUid: a JWKS outage falls through to the auth API, never a lock-out', async () => {
  resetJwksCache();
  const calls = [];
  const f = async (url) => { calls.push(url); if (url.endsWith('/jwks.json')) throw new Error('ECONNRESET'); return Response.json({ id: UID }); };
  assert.deepEqual(await resolveUid(es256({ sub: UID, exp }), { supabaseUrl: URL_, serviceKey: 'svc', jwtSecret: '', fetchImpl: f, now }), { uid: UID, via: 'auth_api' });
});

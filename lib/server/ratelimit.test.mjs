import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { resolveRateBucket } from './ratelimit.js';

// Fabricate a real HS256 Supabase-style JWT so the LOCAL verify path is exercised.
const SECRET = 'test-secret';
function makeJwt({ sub, exp = Math.floor(Date.now() / 1000) + 3600 }, secret = SECRET) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = enc({ alg: 'HS256', typ: 'JWT' });
  const body = enc({ sub, exp });
  const sig = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

const reqWith = (headers) => ({ headers, socket: { remoteAddress: '9.9.9.9' } });

test('signed-in user gets a per-USER bucket (shared IPs stop starving each other)', () => {
  const jwt = makeJwt({ sub: 'user-abc' });
  const b = resolveRateBucket(reqWith({ authorization: `Bearer ${jwt}`, 'x-forwarded-for': '1.2.3.4' }), SECRET);
  assert.equal(b.kind, 'user');
  assert.equal(b.key, 'user:user-abc');
});

test('two users on the SAME IP get DIFFERENT buckets', () => {
  const a = resolveRateBucket(reqWith({ authorization: `Bearer ${makeJwt({ sub: 'u1' })}`, 'x-forwarded-for': '1.2.3.4' }), SECRET);
  const b = resolveRateBucket(reqWith({ authorization: `Bearer ${makeJwt({ sub: 'u2' })}`, 'x-forwarded-for': '1.2.3.4' }), SECRET);
  assert.notEqual(a.key, b.key);
});

test('anonymous / no token → IP bucket', () => {
  const b = resolveRateBucket(reqWith({ 'x-forwarded-for': '1.2.3.4, 10.0.0.1' }), SECRET);
  assert.equal(b.kind, 'ip');
  assert.equal(b.key, 'ip:1.2.3.4'); // off-Vercel fallback: first hop of x-forwarded-for
});

test('x-real-ip (Vercel-trusted) wins over a client-forged x-forwarded-for', () => {
  // In prod Vercel sets x-real-ip to the true client IP; an attacker rotating x-forwarded-for
  // must NOT be able to mint fresh buckets, so the bucket key must come from x-real-ip.
  const b = resolveRateBucket(reqWith({ 'x-real-ip': '203.0.113.7', 'x-forwarded-for': 'evil, 1.2.3.4' }), SECRET);
  assert.equal(b.kind, 'ip');
  assert.equal(b.key, 'ip:203.0.113.7');
});

test('forged/expired tokens fall back to the IP bucket — a bad signature never mints a bucket', () => {
  const forged = makeJwt({ sub: 'attacker' }, 'wrong-secret');
  assert.equal(resolveRateBucket(reqWith({ authorization: `Bearer ${forged}`, 'x-forwarded-for': '1.2.3.4' }), SECRET).kind, 'ip');
  const expired = makeJwt({ sub: 'user-abc', exp: Math.floor(Date.now() / 1000) - 10 });
  assert.equal(resolveRateBucket(reqWith({ authorization: `Bearer ${expired}`, 'x-forwarded-for': '1.2.3.4' }), SECRET).kind, 'ip');
});

test('no jwt secret configured → IP bucket (never crashes)', () => {
  const jwt = makeJwt({ sub: 'user-abc' });
  const b = resolveRateBucket(reqWith({ authorization: `Bearer ${jwt}`, 'x-forwarded-for': '1.2.3.4' }), undefined);
  assert.equal(b.kind, 'ip');
});

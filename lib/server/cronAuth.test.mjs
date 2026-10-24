import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isVercelCron, hasCronSecret, hasAdminSession } from './cronAuth.js';

const S = 'sekret';
test("Vercel's Bearer header is a cron; the spoofable x-vercel-cron header is not", () => {
  assert.equal(isVercelCron({ headers: { authorization: `Bearer ${S}` } }, S), true);
  assert.equal(isVercelCron({ headers: { 'x-vercel-cron': '1' } }, S), false);
  assert.equal(isVercelCron({ headers: { authorization: 'Bearer wrong' } }, S), false);
  assert.equal(isVercelCron({ headers: { authorization: `Bearer ${S}` } }, ''), false, 'no secret → fail closed');
  assert.equal(isVercelCron({ headers: new Headers({ authorization: `Bearer ${S}` }) }, S), true, 'fetch-style Headers');
});

test('manual runs: Bearer, x-cron-secret or ?secret=', () => {
  assert.equal(hasCronSecret({ headers: { 'x-cron-secret': S } }, S), true);
  assert.equal(hasCronSecret({ headers: {}, query: { secret: S } }, S), true);
  assert.equal(hasCronSecret({ headers: {}, url: `/api/x?secret=${S}` }, S), true);
  assert.equal(hasCronSecret({ headers: { 'x-vercel-cron': '1' } }, S), false);
  assert.equal(hasCronSecret({ headers: {}, query: { secret: S } }, undefined), false);
});

test('admin session: a live token only', async () => {
  const live = new Date(Date.now() + 3600e3).toISOString(), dead = new Date(Date.now() - 1).toISOString();
  const f = (exp) => async () => ({ ok: true, json: async () => (exp ? [{ expires_at: exp }] : []) });
  const req = { headers: { 'x-admin-token': 't' } };
  assert.equal(await hasAdminSession(req, { url: 'https://db', key: 'k', fetchImpl: f(live) }), true);
  assert.equal(await hasAdminSession(req, { url: 'https://db', key: 'k', fetchImpl: f(dead) }), false);
  assert.equal(await hasAdminSession(req, { url: 'https://db', key: 'k', fetchImpl: f(null) }), false);
  assert.equal(await hasAdminSession({ headers: {} }, { url: 'https://db', key: 'k', fetchImpl: f(live) }), false);
});

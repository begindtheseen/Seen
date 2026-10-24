// lib/pendingSignup.js — the verify screen's memory of the signup it waits on (never the password).
import test from 'node:test';
import assert from 'node:assert/strict';
import { savePendingSignup, readPendingSignup, clearPendingSignup, isEmailThrottle, signupConfirmed, PENDING_SIGNUP_KEY, PENDING_SIGNUP_TTL_MS } from './pendingSignup.js';

const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }; };
const ID = '22222222-2222-4222-8222-222222222222';

test('stores address + id + type, never a password; a throttled repeat (no id) keeps the earlier id', () => {
  const s = mem();
  savePendingSignup({ email: ' Jordan@Example.TEST ', uid: ID, type: 'seeker', password: 'secret' }, s, 1000);
  assert.ok(!s.m.get(PENDING_SIGNUP_KEY).includes('secret'));
  assert.deepEqual(readPendingSignup(s, 2000), { email: 'jordan@example.test', uid: ID, type: 'seeker', at: 1000 });
  savePendingSignup({ email: 'jordan@example.test', uid: undefined }, s, 3000);
  assert.equal(readPendingSignup(s, 3000).uid, ID, 'same address: the id survives a signUp that returned no user');
  savePendingSignup({ email: 'other@example.test', uid: undefined }, s, 4000);
  assert.equal(readPendingSignup(s, 4000).uid, null, 'a different address never inherits it');
});

test('expires with the link, survives garbage, clears', () => {
  const s = mem();
  savePendingSignup({ email: 'a@b.c', uid: ID }, s, 0);
  assert.equal(readPendingSignup(s, PENDING_SIGNUP_TTL_MS + 1), null);
  s.setItem(PENDING_SIGNUP_KEY, '{not json'); assert.equal(readPendingSignup(s), null);
  savePendingSignup({ email: 'a@b.c', uid: ID }, s); clearPendingSignup(s); assert.equal(readPendingSignup(s), null);
});

test('isEmailThrottle recognises Supabase\'s "For security purposes" answer only', () => {
  assert.ok(isEmailThrottle({ status: 429, code: 'over_email_send_rate_limit', message: 'For security purposes, you can only request this after 25 seconds.' }));
  assert.ok(isEmailThrottle({ message: 'For security purposes, you can only request this after 9 seconds.' }));
  assert.ok(!isEmailThrottle({ status: 422, message: 'Password should be at least 8 characters' }));
  assert.ok(!isEmailThrottle(null));
});

test('signupConfirmed: true/false from the server, null when it cannot answer, no call for a bad id', async () => {
  const calls = [];
  const f = (answer) => async (url, o) => { calls.push([url, JSON.parse(o.body)]); return answer };
  assert.equal(await signupConfirmed(ID, f(Response.json({ confirmed: true }))), true);
  assert.equal(await signupConfirmed(ID, f(Response.json({ confirmed: false }))), false);
  assert.equal(await signupConfirmed(ID, f(new Response('', { status: 429 }))), null);
  assert.equal(await signupConfirmed(ID, async () => { throw new Error('offline') }), null);
  const n = calls.length;
  assert.equal(await signupConfirmed('nope', f(Response.json({ confirmed: true }))), null);
  assert.equal(calls.length, n);
  assert.deepEqual(calls[0], ['/api/signup-status', { id: ID }]);
});

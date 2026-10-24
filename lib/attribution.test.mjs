// lib/attribution.js — the device's first touch: what is kept, what is never kept, when `last` moves.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  captureTouch, readTouchState, markTouchDone, pendingTouchPayload, cleanTouch, cleanPath, cleanHost, cleanValue,
  externalReferrerHost, FIRST_TOUCH_KEY, SESSION_TOUCH_KEY, TOUCH_TTL_MS,
} from './attribution.js';

const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }; };
const T0 = Date.UTC(2026, 9, 24, 18, 0, 0);
const page = (over = {}) => ({ pathname: '/', search: '', referrer: '', host: 'seenjobs.io', ...over });

test('first page view keeps the first touch: path only, referrer host only, utm tags, the invite code', () => {
  const ls = mem(), ss = mem();
  captureTouch(page({ pathname: '/company/walmart', search: '?utm_source=reddit&utm_campaign=ghost%20index&ref=abcd2345&q=private+thing&email=a@b.c', referrer: 'https://www.reddit.com/r/recruitinghell/comments/xyz/some_title/?share=1' }), ls, ss, T0);
  const s = readTouchState(ls, T0);
  assert.deepEqual(s.first, {
    landing_path: '/company/walmart', referrer_host: 'www.reddit.com',
    utm_source: 'reddit', utm_medium: null, utm_campaign: 'ghost index', utm_content: null, utm_term: null,
    ref_code: 'abcd2345', first_seen_at: new Date(T0).toISOString(),
  });
  assert.equal(s.last, null);
  const raw = ls.m.get(FIRST_TOUCH_KEY);
  for (const leak of ['private', 'email', 'a@b.c', 'comments', 'share=1', '?']) assert.ok(!raw.includes(leak), `never stored: ${leak}`);
  assert.equal(ss.m.get(SESSION_TOUCH_KEY), '1');
});

test('the first touch is kept; later visits never replace it', () => {
  const ls = mem(), ss = mem();
  captureTouch(page({ pathname: '/agencies', referrer: 'https://www.google.com/' }), ls, ss, T0);
  captureTouch(page({ pathname: '/pricing', search: '?utm_source=tiktok', referrer: 'https://www.tiktok.com/' }), ls, mem(), T0 + 3600e3);
  const s = readTouchState(ls, T0 + 3600e3);
  assert.equal(s.first.landing_path, '/agencies');
  assert.equal(s.first.referrer_host, 'www.google.com');
  assert.equal(s.last.landing_path, '/pricing');
  assert.equal(s.last.utm_source, 'tiktok');
});

test('last touch moves only on a new session from another site, or on a tagged link', () => {
  const ls = mem(), ss = mem();
  captureTouch(page({ pathname: '/' }), ls, ss, T0);
  // Same session, internal navigation / no tags: nothing changes.
  captureTouch(page({ pathname: '/jobs', referrer: 'https://seenjobs.io/' }), ls, ss, T0 + 1000);
  assert.equal(readTouchState(ls, T0).last, null);
  // Same session, another site but no tags: not a new session → unchanged.
  captureTouch(page({ pathname: '/faq', referrer: 'https://www.bing.com/' }), ls, ss, T0 + 2000);
  assert.equal(readTouchState(ls, T0).last, null);
  // Same session, a tagged link: updated.
  captureTouch(page({ pathname: '/data', search: '?utm_source=newsletter' }), ls, ss, T0 + 3000);
  assert.equal(readTouchState(ls, T0).last.landing_path, '/data');
  // New session, direct (no referrer, no tags): unchanged.
  captureTouch(page({ pathname: '/lists/x' }), ls, mem(), T0 + 4000);
  assert.equal(readTouchState(ls, T0).last.landing_path, '/data');
  // New session from another site: updated.
  captureTouch(page({ pathname: '/company/target', referrer: 'https://chatgpt.com/' }), ls, mem(), T0 + 5000);
  assert.equal(readTouchState(ls, T0).last.referrer_host, 'chatgpt.com');
});

test('Seen itself, payment and sign-in hops are never "the site that sent you"', () => {
  for (const r of ['https://seenjobs.io/jobs', 'https://www.seenjobs.io/', 'https://checkout.stripe.com/c/pay/cs_1', 'https://abc.supabase.co/auth/v1/verify', 'https://accounts.google.com/', 'https://seen-git-x.vercel.app/']) {
    assert.equal(externalReferrerHost(r, 'seenjobs.io'), null, r);
  }
  assert.equal(externalReferrerHost('https://news.ycombinator.com/item?id=1', 'seenjobs.io'), 'news.ycombinator.com');
  assert.equal(externalReferrerHost('not a url', 'seenjobs.io'), null);
  assert.equal(externalReferrerHost('', 'seenjobs.io'), null);
});

test('the invite code is read with lib/referral.js rules (malformed codes are dropped)', () => {
  const ls = mem();
  captureTouch(page({ search: '?ref=NOTACODE!' }), ls, mem(), T0);
  assert.equal(readTouchState(ls, T0).first.ref_code, null);
  const ls2 = mem();
  captureTouch(page({ search: '?ref=ABCD2345' }), ls2, mem(), T0);
  assert.equal(readTouchState(ls2, T0).first.ref_code, 'abcd2345');
});

test('expires after 90 days; garbage is dropped; blocked storage never throws', () => {
  const ls = mem();
  captureTouch(page({ pathname: '/jobs' }), ls, mem(), T0);
  assert.ok(readTouchState(ls, T0 + TOUCH_TTL_MS - 1));
  assert.equal(readTouchState(ls, T0 + TOUCH_TTL_MS + 1), null);
  assert.equal(ls.m.has(FIRST_TOUCH_KEY), false);
  ls.setItem(FIRST_TOUCH_KEY, '{nope'); assert.equal(readTouchState(ls, T0), null);
  const broken = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('SecurityError'); }, removeItem() { throw new Error('x'); } };
  assert.doesNotThrow(() => captureTouch(page(), broken, broken, T0));
});

test('after the server answered: only a "done" marker stays, nothing is resent, no new first touch is captured', () => {
  const ls = mem(), ss = mem();
  captureTouch(page({ pathname: '/company/walmart', search: '?utm_source=reddit' }), ls, ss, T0);
  assert.ok(pendingTouchPayload(ls, T0));
  markTouchDone(ls, T0 + 1000);
  assert.deepEqual(JSON.parse(ls.m.get(FIRST_TOUCH_KEY)), { v: 1, done: T0 + 1000 });
  assert.equal(pendingTouchPayload(ls, T0 + 2000), null);
  captureTouch(page({ pathname: '/dashboard' }), ls, mem(), T0 + 5000);
  assert.equal(pendingTouchPayload(ls, T0 + 5000), null);
  assert.ok(!ls.m.get(FIRST_TOUCH_KEY).includes('walmart'));
});

test('cleaning: paths, hosts and values are validated and clamped to 200', () => {
  assert.equal(cleanPath('/company/walmart?x=1#y'), '/company/walmart');
  assert.equal(cleanPath('//evil.com/x'), null);
  assert.equal(cleanPath('https://seenjobs.io/'), null);
  assert.equal(cleanPath('/a b'), null);
  assert.equal(cleanPath('/' + 'a'.repeat(400)).length, 200);
  assert.equal(cleanHost('WWW.Google.COM'), 'www.google.com');
  assert.equal(cleanHost('localhost'), null);
  assert.equal(cleanHost('a..b'), null);
  assert.equal(cleanHost('evil.com/path'), null);
  assert.equal(cleanValue('  reddit\u0000\n\tads  '), 'reddit ads');
  assert.equal(cleanValue('x'.repeat(500)).length, 200);
  assert.equal(cleanValue('​\u0007'), null);
  assert.equal(cleanTouch({ landing_path: 'nope' }), null);
  assert.deepEqual(Object.keys(cleanTouch({ landing_path: '/', extra: 'dropped', ip: '1.2.3.4' })).sort(),
    ['first_seen_at', 'landing_path', 'ref_code', 'referrer_host', 'utm_campaign', 'utm_content', 'utm_medium', 'utm_source', 'utm_term']);
});

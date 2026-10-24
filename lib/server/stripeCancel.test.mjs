import test from 'node:test';
import assert from 'node:assert/strict';
import { cancelLiveSubscriptions } from './stripeCancel.js';

function fakeStripe({ subs = [], listStatus = 200, cancelStatus = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    const u = new URL(url); calls.push({ method: opts.method || 'GET', path: u.pathname, auth: opts.headers?.Authorization });
    if (u.hostname !== 'api.stripe.com') return new Response(null, { status: 404 });
    if ((opts.method || 'GET') === 'GET') return listStatus === 200 ? Response.json({ data: subs }) : new Response('x', { status: listStatus });
    return cancelStatus === 200 ? Response.json({ status: 'canceled' }) : new Response('x', { status: cancelStatus });
  };
  return { fetchImpl, calls };
}

test('cancels every live subscription immediately and leaves ended ones alone', async () => {
  const { fetchImpl, calls } = fakeStripe({ subs: [{ id: 'sub_a', status: 'active' }, { id: 'sub_t', status: 'trialing' }, { id: 'sub_c', status: 'canceled' }, { id: 'sub_p', status: 'past_due' }] });
  const out = await cancelLiveSubscriptions({ customerId: 'cus_1', stripeKey: 'sk_test', fetchImpl });
  assert.deepEqual(out, { ok: true, cancelled: ['sub_a', 'sub_t', 'sub_p'] });
  assert.deepEqual(calls.filter((c) => c.method === 'DELETE').map((c) => c.path), ['/v1/subscriptions/sub_a', '/v1/subscriptions/sub_t', '/v1/subscriptions/sub_p']);
  assert.ok(calls.every((c) => c.auth === 'Bearer sk_test'));
});

test('no customer → nothing to do; no key or a Stripe failure → not ok', async () => {
  assert.deepEqual(await cancelLiveSubscriptions({ customerId: null, stripeKey: 'sk' }), { ok: true, cancelled: [] });
  assert.equal((await cancelLiveSubscriptions({ customerId: 'cus_1', stripeKey: '' })).ok, false);
  assert.equal((await cancelLiveSubscriptions({ customerId: 'cus_1', stripeKey: 'sk', fetchImpl: fakeStripe({ listStatus: 500 }).fetchImpl })).ok, false);
  const partial = await cancelLiveSubscriptions({ customerId: 'cus_1', stripeKey: 'sk', fetchImpl: fakeStripe({ subs: [{ id: 'sub_a', status: 'active' }], cancelStatus: 402 }).fetchImpl });
  assert.equal(partial.ok, false);
  assert.match(partial.error, /cancel_402/);
});

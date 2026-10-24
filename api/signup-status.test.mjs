// api/signup-status.js — the verify screen's "confirmed yet?" poll answers ONLY a boolean for a user id.
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://db.test';
process.env.SUPABASE_SERVICE_KEY = 'service';
const { default: handler } = await import('./signup-status.js');

const ID = '22222222-2222-4222-8222-222222222222';
function install(users) {
  const calls = [];
  globalThis.fetch = async (url) => {
    const u = new URL(url); calls.push(u.pathname);
    if (u.pathname.includes('/rpc/')) return Response.json(1);
    const m = u.pathname.match(/^\/auth\/v1\/admin\/users\/(.+)$/);
    if (m) { const usr = users[decodeURIComponent(m[1])]; return usr ? Response.json(usr) : Response.json({ msg: 'User not found' }, { status: 404 }); }
    return new Response(null, { status: 500 });
  };
  return calls;
}
const call = (body, method = 'POST') => new Promise((resolve) => {
  const res = { statusCode: 200, setHeader() {}, status(c) { this.statusCode = c; return this; }, json(b) { resolve({ status: this.statusCode, body: b }); return this; }, end() { resolve({ status: this.statusCode }); } };
  handler({ method, headers: { origin: 'https://seenjobs.io' }, body }, res);
});

test('unconfirmed → false, confirmed → true, and nothing else about the account is returned', async () => {
  install({ [ID]: { id: ID, email: 'a@b.c', email_confirmed_at: null, user_metadata: { name: 'J' } } });
  assert.deepEqual(await call({ id: ID }), { status: 200, body: { confirmed: false } });
  install({ [ID]: { id: ID, email: 'a@b.c', email_confirmed_at: '2026-10-24T00:00:00Z' } });
  assert.deepEqual(await call({ id: ID }), { status: 200, body: { confirmed: true } });
});

test('an unknown id (an obfuscated repeat signup, a deleted user) is "not yet", never a 404', async () => {
  install({});
  assert.deepEqual(await call({ id: ID }), { status: 200, body: { confirmed: false } });
});

test('a non-UUID id never reaches the auth API; GET is refused', async () => {
  const calls = install({});
  assert.equal((await call({ id: 'a@b.c' })).status, 400);
  assert.equal((await call({ id: '../users' })).status, 400);
  assert.ok(!calls.some((p) => p.startsWith('/auth/')));
  assert.equal((await call({}, 'GET')).status, 405);
});

// The two owner-approved fixes through the real handler (2026-10-24):
//  1. a new account keeps its welcome bonus whichever credit event creates its row, and earning never
//     lowers a balance;
//  2. delete_account cancels live Stripe subscriptions BEFORE deleting anything, and deletes nothing
//     when that cannot be confirmed.
// Same locally signed token + in-memory PostgREST as user-sync.edit.test.mjs; Stripe is faked by host.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

process.env.SUPABASE_URL = 'https://db.test';
process.env.SUPABASE_SERVICE_KEY = 'service';
process.env.SUPABASE_JWT_SECRET = 'jwt-secret';
const { default: handler } = await import('./user-sync.js');
const { WELCOME_CREDITS } = await import('../lib/server/creditRules.js');
const { pacificDate } = await import('../lib/time/pacific.js');

const UID = '44444444-4444-4444-8444-444444444444';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const head = b64({ alg: 'HS256', typ: 'JWT' });
const pay = b64({ sub: UID, exp: Math.floor(Date.now() / 1000) + 3600 });
const TOKEN = `${head}.${pay}.${createHmac('sha256', 'jwt-secret').update(`${head}.${pay}`).digest('base64url')}`;

function install(seed = {}, { stripe = {} } = {}) {
  const t = { ai_credits: [], credit_transactions: [], answered_questions: [], ...structuredClone(seed) };
  const log = [];
  const match = (row, u) => [...u.searchParams.entries()].every(([k, v]) => {
    if (['select', 'order', 'limit', 'on_conflict'].includes(k)) return true;
    const [op, ...rest] = v.split('.'); const val = rest.join('.'); const cell = row[k] == null ? null : String(row[k]);
    if (op === 'eq') return cell === val;
    if (op === 'gte') return cell != null && cell >= val;
    return true;
  });
  globalThis.fetch = async (url, opts = {}) => {
    const u = new URL(url); const m = opts.method || 'GET';
    log.push(`${m} ${u.hostname}${u.pathname}`);
    if (u.hostname === 'api.stripe.com') {
      if (stripe.fail) return new Response('nope', { status: 500 });
      if (m === 'GET') return Response.json({ data: stripe.subs || [] });
      return Response.json({ status: 'canceled' });
    }
    if (u.pathname.includes('/rpc/')) return Response.json(1);
    if (u.pathname.includes('/storage/') || u.pathname.includes('/auth/')) return Response.json([]);
    const name = u.pathname.split('/').pop();
    const rows = t[name] || (t[name] = []);
    if (stripe.creditsReadFails && name === 'ai_credits' && m === 'GET') return new Response('down', { status: 503 });
    const body = opts.body ? JSON.parse(opts.body) : null;
    if (m === 'GET') return Response.json(rows.filter((r) => match(r, u)));
    if (m === 'PATCH') { for (const r of rows.filter((r) => match(r, u))) Object.assign(r, body); return new Response(null, { status: 204 }); }
    if (m === 'DELETE') { for (let i = rows.length - 1; i >= 0; i--) if (match(rows[i], u)) rows.splice(i, 1); return new Response(null, { status: 204 }); }
    if (m === 'POST') {
      const prefer = opts.headers?.Prefer || '';
      if (name === 'ai_credits' && rows.some((r) => r.user_id === body.user_id)) {
        if (/ignore-duplicates/.test(prefer)) return Response.json([], { status: 201 });
        return new Response('dup', { status: 409 });
      }
      if (name === 'answered_questions' && rows.some((r) => r.user_id === body.user_id && r.question_key === body.question_key)) return new Response(null, { status: 409 });
      rows.push({ ...body, created_at: new Date().toISOString() });
      return Response.json([body], { status: 201 });
    }
    return new Response(null, { status: 405 });
  };
  return { t, log };
}

function call(body) {
  return new Promise((resolve) => {
    const res = { statusCode: 200, setHeader() {}, status(c) { this.statusCode = c; return this; }, json(b) { resolve({ status: this.statusCode, body: b }); return this; }, end() { resolve({ status: this.statusCode }); } };
    handler({ method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, origin: 'https://seenjobs.io' }, body }, res);
  });
}

test('earn_credit on a brand-new account creates the welcome row and keeps the 10', async () => {
  const { t } = install();
  const r = await call({ action: 'earn_credit', jid: 'job-1' });
  assert.equal(t.ai_credits.length, 1);
  assert.equal(t.ai_credits[0].balance, WELCOME_CREDITS, 'the balance the chip showed is not taken away');
  assert.equal(r.body.balance, WELCOME_CREDITS);
  assert.equal(r.body.reason, 'balance_cap', 'already above the free cap → no earn, no loss');
  assert.deepEqual(t.credit_transactions.map((x) => x.reason), ['welcome_bonus']);
});

test('earn_credit never lowers a welcome balance and still earns below the cap', async () => {
  const today = pacificDate();
  const { t } = install({ ai_credits: [{ user_id: UID, balance: 9, daily_earned: 0, last_reset: today, pro: false }] });
  const r1 = await call({ action: 'earn_credit', jid: 'job-1' });
  assert.equal(t.ai_credits[0].balance, 9, 'was min(10, 6) = 6 before the fix');
  assert.equal(r1.body.ok, false);
  t.ai_credits[0].balance = 2;
  const r2 = await call({ action: 'earn_credit', jid: 'job-2' });
  assert.equal(r2.body.ok, true);
  assert.equal(t.ai_credits[0].balance, 3);
  assert.equal(t.credit_transactions.filter((x) => x.reason === 'track_application').length, 1);
});

test('submit_answer on a brand-new account: welcome row, answer stored, no phantom credit', async () => {
  const { t } = install();
  const r = await call({ action: 'submit_answer', question_key: 'ghost|walmart', answer: 'Still waiting' });
  assert.equal(r.body.ok, true);
  assert.equal(r.body.credited, false);
  assert.equal(r.body.balance, WELCOME_CREDITS);
  assert.equal(t.answered_questions.length, 1);
  assert.deepEqual(t.credit_transactions.map((x) => x.reason), ['welcome_bonus']);
});

test('delete_account cancels live Stripe subscriptions before deleting anything', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test';
  const { t, log } = install(
    { ai_credits: [{ user_id: UID, balance: 1, stripe_customer_id: 'cus_1' }], applications: [{ id: 'a1', user_id: UID }] },
    { stripe: { subs: [{ id: 'sub_live', status: 'active' }, { id: 'sub_old', status: 'canceled' }] } },
  );
  const r = await call({ action: 'delete_account' });
  assert.equal(r.status, 200);
  const cancelAt = log.indexOf('DELETE api.stripe.com/v1/subscriptions/sub_live');
  const firstDbDelete = log.findIndex((l) => l.startsWith('DELETE db.test'));
  assert.ok(cancelAt >= 0, 'the live subscription is cancelled');
  assert.ok(!log.includes('DELETE api.stripe.com/v1/subscriptions/sub_old'), 'an ended one is left alone');
  assert.ok(cancelAt < firstDbDelete, 'billing is cancelled before any row is deleted');
  assert.equal(t.applications.length, 0);
});

test('delete_account deletes nothing when Stripe cannot confirm the cancellation', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test';
  const { t, log } = install(
    { ai_credits: [{ user_id: UID, balance: 1, stripe_customer_id: 'cus_1' }], applications: [{ id: 'a1', user_id: UID }] },
    { stripe: { fail: true } },
  );
  const r = await call({ action: 'delete_account' });
  assert.equal(r.status, 502);
  assert.match(r.body.error, /nothing was deleted/);
  assert.equal(log.filter((l) => l.startsWith('DELETE db.test')).length, 0);
  assert.equal(t.applications.length, 1);
});

test('delete_account with no Stripe customer never calls Stripe; a failed billing read deletes nothing', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test';
  const a = install({ ai_credits: [{ user_id: UID, balance: 1 }] });
  assert.equal((await call({ action: 'delete_account' })).status, 200);
  assert.equal(a.log.filter((l) => l.includes('api.stripe.com')).length, 0);
  const b = install({ applications: [{ id: 'a1', user_id: UID }] }, { stripe: { creditsReadFails: true } });
  const r = await call({ action: 'delete_account' });
  assert.equal(r.status, 503);
  assert.equal(b.t.applications.length, 1);
});

// update_application through the real handler: the tracker card's Edit (company, role, location,
// platform, applied-on) reaches the row, stays scoped to the signed-in user, and never blanks the
// company or role. Same locally-signed token + in-memory PostgREST as user-sync.inbox.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

process.env.SUPABASE_URL = 'https://db.test';
process.env.SUPABASE_SERVICE_KEY = 'service';
process.env.SUPABASE_JWT_SECRET = 'jwt-secret';
const { default: handler } = await import('./user-sync.js');

const UID = '22222222-2222-4222-8222-222222222222';
const APP = '33333333-3333-4333-8333-333333333333';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const head = b64({ alg: 'HS256', typ: 'JWT' });
const pay = b64({ sub: UID, exp: Math.floor(Date.now() / 1000) + 3600 });
const TOKEN = `${head}.${pay}.${createHmac('sha256', 'jwt-secret').update(`${head}.${pay}`).digest('base64url')}`;

function install() {
  const t = { applications: [{ id: APP, user_id: UID, company_name: 'Walmrat', role: 'Cashier', city: 'Phoenix, AZ', platform: 'Direct', status: 'active', stage: 'Applied', events: [], applied_at: '2026-10-20T19:00:00.000Z' }] };
  const patches = [];
  const match = (row, u) => [...u.searchParams.entries()].every(([k, v]) => {
    if (['select', 'order', 'limit', 'on_conflict'].includes(k)) return true;
    const [op, ...rest] = v.split('.'); const val = rest.join('.'); const cell = row[k] == null ? null : String(row[k]);
    return op === 'eq' ? cell === val : true;
  });
  globalThis.fetch = async (url, opts = {}) => {
    const u = new URL(url);
    if (u.pathname.includes('/rpc/')) return Response.json(1); // the write rate-limit counter
    const name = u.pathname.split('/').pop();
    const rows = t[name] || (t[name] = []);
    const body = opts.body ? JSON.parse(opts.body) : null;
    const m = opts.method || 'GET';
    if (m === 'GET') return Response.json(rows.filter((r) => match(r, u)));
    const represent = /return=representation/.test(String((opts.headers || {}).Prefer || ''));
    if (m === 'PATCH') { patches.push({ url: u.pathname + u.search, body }); const hit = rows.filter((r) => match(r, u)); for (const r of hit) Object.assign(r, body); return represent ? Response.json(hit) : new Response(null, { status: 204 }); }
    if (m === 'POST') { rows.push({ ...body }); return Response.json([body], { status: 201 }); }
    return new Response(null, { status: 405 });
  };
  return { t, patches };
}

function call(body) {
  return new Promise((resolve) => {
    const res = { statusCode: 200, setHeader() {}, status(c) { this.statusCode = c; return this; }, json(b) { resolve({ status: this.statusCode, body: b }); return this; }, end() { resolve({ status: this.statusCode }); } };
    handler({ method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, origin: 'https://seenjobs.io' }, body }, res);
  });
}

test('Edit: company / role / location / platform / appliedAt land on the row as their DB columns', async () => {
  const { t, patches } = install();
  const applied = Date.parse('2026-10-18T19:00:00.000Z');
  const r = await call({ action: 'update_application', id: APP, changes: { company: ' Walmart ', role: 'Cashier', location: 'Tempe, AZ', platform: 'Indeed', appliedAt: applied } });
  assert.deepEqual(r.body, { ok: true });
  assert.equal(patches.length, 1);
  assert.match(patches[0].url, new RegExp(`id=eq\\.${APP}&user_id=eq\\.${UID}`), 'scoped to the signed-in user');
  const row = t.applications[0];
  assert.equal(row.company_name, 'Walmart');
  assert.equal(row.city, 'Tempe, AZ');
  assert.equal(row.platform, 'Indeed');
  assert.equal(row.applied_at, '2026-10-18T19:00:00.000Z');
  assert.equal(row.stage, 'Applied');
  assert.equal(row.status, 'active');
  assert.equal(patches[0].body.company, undefined, 'client field names are mapped, not passed through');
});

test('a blank company or role, a bad date, and unknown keys are ignored — the row keeps what it had', async () => {
  const { t, patches } = install();
  const r = await call({ action: 'update_application', id: APP, changes: { company: '  ', role: '', appliedAt: 'not a date', employer_stage: 'Hired', user_id: 'someone-else' } });
  assert.deepEqual(r.body, { ok: true });
  assert.equal(patches.length, 0, 'nothing allowed → no PATCH');
  assert.equal(t.applications[0].company_name, 'Walmrat');
  assert.equal(t.applications[0].user_id, UID);
});

test('a future applied-on date is dropped; stage moves still work alongside an edit', async () => {
  const { t, patches } = install();
  await call({ action: 'update_application', id: APP, changes: { stage: 'Interview', appliedAt: Date.now() + 10 * 86400000 } });
  assert.equal(patches.length, 1);
  assert.equal(t.applications[0].stage, 'Interview');
  assert.equal(t.applications[0].applied_at, '2026-10-20T19:00:00.000Z');
});

test('a client-local app_ id is reported as not synced, never PATCHed', async () => {
  const { patches } = install();
  const r = await call({ action: 'update_application', id: 'app_1700000000000', changes: { company: 'Target' } });
  assert.deepEqual(r.body, { ok: false, reason: 'not_synced' });
  assert.equal(patches.length, 0);
});

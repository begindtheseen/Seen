// The user's Inbox Autopilot controls through the real api/user-sync.js handler: a locally signed
// HS256 token, global fetch stubbed with an in-memory PostgREST. Proves scoping to the signed-in user,
// UUID checks on client ids, "not set up yet" before the migration, and the assign/share flows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

process.env.SUPABASE_URL = 'https://db.test';
process.env.SUPABASE_SERVICE_KEY = 'service';
process.env.SUPABASE_JWT_SECRET = 'jwt-secret';
const { default: handler } = await import('./user-sync.js');

const UID = '22222222-2222-4222-8222-222222222222';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const head = b64({ alg: 'HS256', typ: 'JWT' });
const pay = b64({ sub: UID, exp: Math.floor(Date.now() / 1000) + 3600 });
const TOKEN = `${head}.${pay}.${createHmac('sha256', 'jwt-secret').update(`${head}.${pay}`).digest('base64url')}`;

function install({ tables = true } = {}) {
  const t = { inbox_addresses: [], inbox_events: [], applications: [] };
  const match = (row, u) => [...u.searchParams.entries()].every(([k, v]) => {
    if (['select', 'order', 'limit', 'on_conflict'].includes(k)) return true;
    const [op, ...rest] = v.split('.'); const val = rest.join('.'); const cell = row[k] == null ? null : String(row[k]);
    if (op === 'eq') return cell === val;
    if (op === 'in') return val.replace(/^\(|\)$/g, '').split(',').includes(cell);
    return true;
  });
  globalThis.fetch = async (url, opts = {}) => {
    const u = new URL(url);
    if (u.pathname.includes('/rpc/')) return Response.json(1);
    const name = u.pathname.split('/').pop();
    if (!tables && name.startsWith('inbox_')) return Response.json({ message: 'relation does not exist' }, { status: 404 });
    const rows = t[name] || (t[name] = []);
    const body = opts.body ? JSON.parse(opts.body) : null;
    const m = opts.method || 'GET';
    if (m === 'GET') return Response.json(rows.filter((r) => match(r, u)));
    if (m === 'POST') { const row = { ...body }; rows.push(row); return Response.json([row], { status: 201 }); }
    const represent = /return=representation/.test(String((opts.headers || {}).Prefer || ''));
    if (m === 'PATCH') { const hit = rows.filter((r) => match(r, u)); for (const r of hit) Object.assign(r, body); return represent ? Response.json(hit) : new Response(null, { status: 204 }); }
    if (m === 'DELETE') { const hit = rows.filter((r) => match(r, u)); t[name] = rows.filter((r) => !match(r, u)); return represent ? Response.json(hit) : new Response(null, { status: 204 }); }
    return new Response(null, { status: 405 });
  };
  return t;
}

function call(body) {
  return new Promise((resolve) => {
    const res = { statusCode: 200, setHeader() {}, status(c) { this.statusCode = c; return this; }, json(b) { resolve({ status: this.statusCode, body: b }); return this; }, end() { resolve({ status: this.statusCode }); } };
    handler({ method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, origin: 'https://seenjobs.io' }, body }, res);
  });
}

test('before the migration every inbox action answers "not set up yet"', async () => {
  install({ tables: false });
  assert.deepEqual((await call({ action: 'inbox_status' })).body, { ready: false });
  assert.deepEqual((await call({ action: 'inbox_enable' })).body, { ready: false });
});

test('enable → a private address; pause; new address replaces the old one; disable clears it all', async () => {
  const t = install();
  assert.deepEqual((await call({ action: 'inbox_status' })).body, { ready: true, enabled: false });
  const on = (await call({ action: 'inbox_enable' })).body;
  assert.equal(on.enabled, true);
  assert.match(on.address, /^track-[a-z2-9]{12}@seenjobs\.io$/);
  assert.equal(t.inbox_addresses[0].user_id, UID);
  assert.equal((await call({ action: 'inbox_pause', paused: true })).body.paused, true);
  const fresh = (await call({ action: 'inbox_new_address' })).body;
  assert.notEqual(fresh.address, on.address);
  t.inbox_events.push({ id: 'x', user_id: UID, state: 'applied' });
  const off = (await call({ action: 'inbox_disable' })).body;
  assert.equal(off.enabled, false);
  assert.equal(t.inbox_addresses.length + t.inbox_events.length, 0);
});

test('assign puts an unplaced interview email on the chosen card; share records the answer once', async () => {
  const t = install();
  await call({ action: 'inbox_enable' });
  const APP = '33333333-3333-4333-8333-333333333333', EV = '44444444-4444-4444-8444-444444444444';
  t.applications.push({ id: APP, user_id: UID, company_name: 'Ramp', role: 'AE', status: 'active', stage: 'Applied', events: [], applied_at: '2026-10-01T00:00:00Z' });
  t.inbox_events.push({ id: EV, user_id: UID, state: 'unplaced', kind: 'interview', received_at: '2026-10-21T17:00:00Z', vendor: null });
  const r = await call({ action: 'inbox_assign', id: EV, application_id: APP });
  assert.equal(r.body.ok, true);
  assert.equal(t.applications[0].stage, 'Interview');
  assert.deepEqual([t.inbox_events[0].state, t.inbox_events[0].application_id, t.inbox_events[0].share_state], ['applied', APP, 'ask']);
  assert.equal((await call({ action: 'inbox_share', id: EV, choice: 'declined' })).body.ok, true);
  assert.equal(t.inbox_events[0].share_state, 'declined');
});

test('client ids are UUID-checked; another user\'s rows are never touched', async () => {
  const t = install();
  assert.equal((await call({ action: 'inbox_assign', id: 'x', application_id: 'y' })).status, 400);
  assert.equal((await call({ action: 'inbox_share', id: "1' or 1=1" })).status, 400);
  t.inbox_events.push({ id: '55555555-5555-4555-8555-555555555555', user_id: 'someone-else', state: 'unplaced', kind: 'interview' });
  t.applications.push({ id: '66666666-6666-4666-8666-666666666666', user_id: UID, company_name: 'Ramp', role: '', status: 'active', stage: 'Applied', events: [] });
  const r = await call({ action: 'inbox_assign', id: '55555555-5555-4555-8555-555555555555', application_id: '66666666-6666-4666-8666-666666666666' });
  assert.equal(r.body.ok, false);
  assert.equal(t.inbox_events[0].state, 'unplaced');
});

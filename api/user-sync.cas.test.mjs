// add_application is idempotent on the tracker's own id and update_application is compare-and-set on
// updated_at (audit 3, 2026-10-24, H4: a 504'd stage change ran late and overwrote a newer write; one
// add produced two rows). Real handler, locally-signed token, in-memory PostgREST that honours eq /
// gte / lt filters, PATCH representation and ON CONFLICT DO NOTHING — in both schema states (before
// and after migration 20261024130000 adds applications.client_id).
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

let seq = 0;
const newId = () => `44444444-4444-4444-8444-${String(++seq).padStart(12, '0')}`;

/** @param {{ clientIdColumn: boolean }} opts */
function install({ clientIdColumn }) {
  const t = { applications: [] };
  const log = [];
  const match = (row, u) => [...u.searchParams.entries()].every(([k, v]) => {
    if (['select', 'order', 'limit', 'on_conflict', 'offset'].includes(k)) return true;
    const [op, ...rest] = v.split('.'); const val = rest.join('.');
    const cell = row[k] == null ? null : (k.endsWith('_at') ? new Date(row[k]).getTime() : String(row[k]));
    const cmp = k.endsWith('_at') ? new Date(val).getTime() : val;
    if (op === 'eq') return cell === cmp;
    if (op === 'gte') return cell != null && cell >= cmp;
    if (op === 'lt') return cell != null && cell < cmp;
    return true;
  });
  globalThis.fetch = async (url, opts = {}) => {
    const u = new URL(url);
    if (u.pathname.includes('/rpc/')) return Response.json(1);
    const name = u.pathname.split('/').pop();
    const m = opts.method || 'GET';
    log.push({ m, path: u.pathname + u.search });
    if (name !== 'applications') return m === 'GET' ? Response.json([]) : new Response(null, { status: 204 });
    const rows = t.applications;
    const body = opts.body ? JSON.parse(opts.body) : null;
    const usesClientId = u.searchParams.has('client_id') || u.searchParams.get('on_conflict')?.includes('client_id') || (body && 'client_id' in body);
    if (!clientIdColumn && usesClientId) return Response.json({ code: 'PGRST204', message: "Could not find the 'client_id' column of 'applications' in the schema cache" }, { status: 400 });
    if (m === 'GET') return Response.json(rows.filter((r) => match(r, u)));
    if (m === 'PATCH') {
      const hit = rows.filter((r) => match(r, u));
      for (const r of hit) Object.assign(r, body);
      return Response.json(hit);
    }
    if (m === 'POST') {
      const prefer = String((opts.headers || {}).Prefer || '');
      if (body.client_id && rows.some((r) => r.user_id === body.user_id && r.client_id === body.client_id)) {
        if (prefer.includes('ignore-duplicates')) return Response.json([], { status: 201 });
        return Response.json({ code: '23505', message: 'duplicate key value violates unique constraint' }, { status: 409 });
      }
      const row = { id: newId(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...body };
      rows.push(row);
      return Response.json([row], { status: 201 });
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

const now = Date.now();
const application = () => ({ id: 'app_' + now, company: 'OldCo', role: 'Analyst', location: 'Phoenix, AZ', platform: 'Direct', stage: 'Applied', status: 'active', appliedAt: now - 5000, updatedAt: now, events: [{ id: 'ev_' + now, type: 'application_submitted', date: now - 5000, source: 'user', confidence: 'low' }] });

test('two different applications are two rows (idempotency never merges distinct adds)', async () => {
  const { t } = install({ clientIdColumn: true });
  await call({ action: 'add_application', application: application() });
  await call({ action: 'add_application', application: { ...application(), id: 'app_' + (now + 1), role: 'Senior Analyst' } });
  assert.equal(t.applications.length, 2);
});

test('a concurrent duplicate swallowed by the unique index still answers with the winning row', async () => {
  const { t } = install({ clientIdColumn: true });
  // Pre-seed the row as if the other request won the race between our GET and our POST.
  t.applications.push({ id: APP, user_id: UID, client_id: 'app_' + now, company_name: 'Other', role: 'x', applied_at: new Date(now - 9e6).toISOString(), created_at: new Date(now - 9e6).toISOString(), updated_at: new Date().toISOString(), events: [] });
  const r = await call({ action: 'add_application', application: application() });
  assert.equal(r.status, 200);
  assert.equal(r.body.id, APP);
  assert.equal(t.applications.length, 1);
});

function seedRow(t, updatedAt) {
  const row = { id: APP, user_id: UID, company_name: 'OldCo', role: 'Analyst', city: '', platform: 'Direct', status: 'active', stage: 'Applied', events: [{ id: 'ev_1', type: 'application_submitted', date: now - 40 * 86400000, source: 'user', confidence: 'low' }], applied_at: new Date(now - 40 * 86400000).toISOString(), created_at: new Date(now - 40 * 86400000).toISOString(), updated_at: new Date(updatedAt).toISOString() };
  t.applications.push(row);
  return row;
}

test('a fresh update (updatedAt matches the row) lands and returns the new updated_at', async () => {
  const { t } = install({ clientIdColumn: true });
  seedRow(t, now - 60000);
  const r = await call({ action: 'update_application', id: APP, updatedAt: now - 60000, changes: { stage: 'Phone Screen', events: [{ id: 'ev_1', type: 'application_submitted', date: now - 40 * 86400000, source: 'user', confidence: 'low' }, { id: 'ev_2', type: 'response_received', date: now, source: 'user', confidence: 'low', trust_weight: 1 }] } });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(t.applications[0].stage, 'Phone Screen');
  assert.ok(new Date(r.body.updated_at).getTime() > now - 60000, 'a new token');
  assert.deepEqual(r.body.anomalies, []);
});

test('a stale update (the row moved on since the client read it) is refused with 409 + the current row', async () => {
  const { t } = install({ clientIdColumn: true });
  const row = seedRow(t, now - 1000); // another device wrote at now-1000
  row.stage = 'Offer';
  const r = await call({ action: 'update_application', id: APP, updatedAt: now - 60000, changes: { stage: 'Applied' } });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'stale');
  assert.equal(r.body.application.stage, 'Offer', 'the client gets the row as it is now');
  assert.equal(t.applications[0].stage, 'Offer', 'nothing was overwritten');
});

test('the microsecond case: a row updated_at with microseconds still matches the client\'s millisecond token', async () => {
  const { t } = install({ clientIdColumn: true });
  const row = seedRow(t, now - 60000);
  row.updated_at = new Date(now - 60000).toISOString().replace('Z', '456+00:00'); // Postgres-style µs
  const r = await call({ action: 'update_application', id: APP, updatedAt: now - 60000, changes: { stage: 'Viewed' } });
  assert.equal(r.status, 200);
  assert.equal(t.applications[0].stage, 'Viewed');
});

test('an update to a deleted application is 410, never a silent ok', async () => {
  install({ clientIdColumn: true });
  const r = await call({ action: 'update_application', id: APP, updatedAt: now, changes: { role: 'Role-B' } });
  assert.equal(r.status, 410);
});

test('an update without updatedAt (older client) is unconditional, as before', async () => {
  const { t } = install({ clientIdColumn: true });
  seedRow(t, now - 1000);
  const r = await call({ action: 'update_application', id: APP, changes: { stage: 'Interview' } });
  assert.equal(r.status, 200);
  assert.equal(t.applications[0].stage, 'Interview');
});

test('an offer recorded on day 0 comes back flagged impossible_timeline (the card shows the hint)', async () => {
  const { t } = install({ clientIdColumn: true });
  const row = seedRow(t, now - 60000);
  row.applied_at = new Date(now - 3600000).toISOString();
  const r = await call({ action: 'update_application', id: APP, updatedAt: now - 60000, changes: { stage: 'Offer', events: [...row.events, { id: 'ev_o', type: 'offer_received', date: now, source: 'user', confidence: 0, trust_weight: 0, anomaly_flags: ['impossible_timeline'] }] } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.anomalies, ['impossible_timeline']);
});

test('events are stored shape-checked, capped at 100 with the first and newest kept', async () => {
  const { t } = install({ clientIdColumn: true });
  seedRow(t, now - 60000);
  const many = Array.from({ length: 130 }, (_, i) => ({ id: 'e' + i, type: i === 0 ? 'application_submitted' : 'check_snoozed', date: now - (130 - i) * 1000, source: 'user', confidence: 'low', data: { day: 7, until: now } }));
  const r = await call({ action: 'update_application', id: APP, updatedAt: now - 60000, changes: { events: many } });
  assert.equal(r.status, 200);
  const stored = t.applications[0].events;
  assert.equal(stored.length, 100);
  assert.equal(stored[0].id, 'e0');
  assert.equal(stored[99].id, 'e129');
  assert.deepEqual(stored[99].data, { day: 7, until: now });
});

// Last on purpose: the handler remembers "no client_id column" for 10 minutes (module state), so the
// pre-migration variant must not run before the tests that need the column.
for (const clientIdColumn of [false]) {
  test(`the same add_application sent twice makes ONE row (client_id column ${clientIdColumn ? 'present' : 'absent'})`, async () => {
    const { t } = install({ clientIdColumn });
    const a = await call({ action: 'add_application', application: application() });
    const b = await call({ action: 'add_application', application: application() });
    assert.equal(a.status, 200); assert.equal(b.status, 200);
    assert.equal(t.applications.length, 1, 'one row');
    assert.equal(b.body.id, a.body.id, 'the retry answers with the row the first call made');
    assert.equal(b.body.existing, true);
    assert.ok(a.body.updated_at, 'the client gets the row\'s updated_at as its compare-and-set token');
    if (clientIdColumn) assert.equal(t.applications[0].client_id, 'app_' + now);
    else assert.equal('client_id' in t.applications[0], false);
  });
}


// add_application through the real handler with the payload "✓ Yes, I applied" sends
// (lib/stores/listingApplication → AppStore.add): the row keeps the listing's full title, location,
// id, link and platform. Same locally-signed token + in-memory PostgREST as user-sync.edit.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { applicationFromListing } from '../lib/stores/listingApplication.ts';

process.env.SUPABASE_URL = 'https://db.test';
process.env.SUPABASE_SERVICE_KEY = 'service';
process.env.SUPABASE_JWT_SECRET = 'jwt-secret';
const { default: handler } = await import('./user-sync.js');

const UID = '22222222-2222-4222-8222-222222222222';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const head = b64({ alg: 'HS256', typ: 'JWT' });
const pay = b64({ sub: UID, exp: Math.floor(Date.now() / 1000) + 3600 });
const TOKEN = `${head}.${pay}.${createHmac('sha256', 'jwt-secret').update(`${head}.${pay}`).digest('base64url')}`;

function install() {
  const t = { applications: [] };
  globalThis.fetch = async (url, opts = {}) => {
    const u = new URL(url);
    if (u.pathname.includes('/rpc/')) return Response.json(1);
    const name = u.pathname.split('/').pop();
    const rows = t[name] || (t[name] = []);
    const body = opts.body ? JSON.parse(opts.body) : null;
    if ((opts.method || 'GET') === 'POST') { const row = { id: '33333333-3333-4333-8333-333333333333', ...body }; rows.push(row); return Response.json([row], { status: 201 }); }
    return Response.json(rows);
  };
  return t;
}
function call(body) {
  return new Promise((resolve) => {
    const res = { statusCode: 200, setHeader() {}, status(c) { this.statusCode = c; return this; }, json(b) { resolve({ status: this.statusCode, body: b }); return this; }, end() { resolve({ status: this.statusCode }); } };
    handler({ method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, origin: 'https://seenjobs.io' }, body }, res);
  });
}

test('the listing the audit applied to lands as one row with every field it had', async () => {
  const t = install();
  const listing = { id: 'j_6c1f', title: 'Cosmetics Cashier', company: 'Walmart', location: 'Glendale, Maricopa County', apply_url: 'https://careers.walmart.com/us/jobs/WD1234' };
  const now = Date.now();
  // Exactly what AppStore.add posts: the pre-fill plus the client id/timestamps/initial event.
  const application = { ...applicationFromListing(listing), id: 'app_' + now, appliedAt: now, updatedAt: now, events: [{ id: 'ev_' + now, type: 'application_submitted', date: now, source: 'user', confidence: 'low' }] };
  const r = await call({ action: 'add_application', application });
  assert.equal(r.status, 200);
  assert.equal(r.body.id, '33333333-3333-4333-8333-333333333333');
  const row = t.applications[0];
  assert.equal(row.user_id, UID);
  assert.equal(row.role, 'Cosmetics Cashier');
  assert.equal(row.city, 'Glendale, Maricopa County');
  assert.equal(row.company_name, 'Walmart');
  assert.equal(row.job_id, 'j_6c1f');
  assert.equal(row.job_url, listing.apply_url);
  assert.equal(row.platform, 'Direct');
  assert.equal(row.stage, 'Applied');
  assert.equal(row.status, 'active');
  assert.equal(row.applied_at, new Date(now).toISOString());
  assert.equal(row.events.length, 1);
});

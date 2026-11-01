// Job alerts through the real api/user-sync.js handler: a locally signed HS256 token and an
// in-memory email_prefs. Proves scoping to the signed-in user, server-side validation, "off" = the
// job-match unsubscribe column, and { ready: false } before the migration.
// Run: node --test api/user-sync.jobAlerts.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { existsSync } from 'node:fs';

process.env.SUPABASE_URL = 'https://db.test';
process.env.SUPABASE_SERVICE_KEY = 'service';
process.env.SUPABASE_JWT_SECRET = 'jwt-secret';
const { default: handler } = await import('./user-sync.js');

const UID = '22222222-2222-4222-8222-222222222222';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const head = b64({ alg: 'HS256', typ: 'JWT' });
const pay = b64({ sub: UID, exp: Math.floor(Date.now() / 1000) + 3600 });
const TOKEN = `${head}.${pay}.${createHmac('sha256', 'jwt-secret').update(`${head}.${pay}`).digest('base64url')}`;
const NEW_COLS = ['job_match_mode', 'job_alerts'];

function install({ columns = true, resume = true } = {}) {
  const t = { email_prefs: [], writes: [] };
  globalThis.fetch = async (url, opts = {}) => {
    const u = new URL(url);
    if (u.pathname.includes('/rpc/')) return Response.json(1);
    const name = u.pathname.split('/').pop();
    const m = opts.method || 'GET';
    if (name === 'profiles') return Response.json(resume ? [{ id: UID }] : []);
    if (name !== 'email_prefs') return Response.json([]);
    const missing = { code: '42703', message: 'column does not exist' };
    if (m === 'GET') {
      if (!columns && NEW_COLS.some((c) => (u.searchParams.get('select') || '').includes(c))) return Response.json(missing, { status: 400 });
      const id = (u.searchParams.get('user_id') || '').replace(/^eq\./, '');
      return Response.json(t.email_prefs.filter((r) => r.user_id === id));
    }
    if (m === 'POST') {
      const body = JSON.parse(opts.body);
      if (!columns && NEW_COLS.some((c) => c in body)) return Response.json({ code: 'PGRST204', message: 'no column' }, { status: 400 });
      t.writes.push(body);
      const row = t.email_prefs.find((r) => r.user_id === body.user_id);
      if (row) Object.assign(row, body);
      else t.email_prefs.push({ job_match_opt_out: false, job_match_mode: 'resume', job_alerts: [], ...body });
      return new Response(null, { status: 201 });
    }
    return new Response(null, { status: 405 });
  };
  return t;
}

function call(body, token = TOKEN) {
  return new Promise((resolve) => {
    const res = { statusCode: 200, setHeader() {}, status(c) { this.statusCode = c; return this; }, json(b) { resolve({ status: this.statusCode, body: b }); return this; }, end() { resolve({ status: this.statusCode }); } };
    handler({ method: 'POST', headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), origin: 'https://seenjobs.io' }, body }, res);
  });
}

const REMOTE = { keywords: 'Customer Service', place: 'Remote' };

test('before the migration both actions answer { ready: false }; no token is a 401', async () => {
  install({ columns: false });
  assert.deepEqual((await call({ action: 'job_alerts_get' })).body, { ready: false });
  assert.deepEqual((await call({ action: 'job_alerts_save', mode: 'alerts', alerts: [REMOTE] })).body, { ready: false });
  assert.equal((await call({ action: 'job_alerts_get' }, null)).status, 401);
});

test('get with no row: résumé matches, no alerts, the limits', async () => {
  install();
  const r = (await call({ action: 'job_alerts_get' })).body;
  assert.deepEqual(r, { ready: true, mode: 'resume', saved_mode: 'resume', alerts: [], has_resume: true, max: 5, radii: [10, 25, 50, 100] });
});

test('save alerts mode → stored for THIS user, cleaned; off keeps the alerts and the mode', async () => {
  const t = install();
  const r = await call({ action: 'job_alerts_save', mode: 'alerts', alerts: [{ ...REMOTE, keywords: '  Customer   Service  ' }], user_id: 'someone-else' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.mode, 'alerts');
  assert.deepEqual(r.body.alerts, [{ keywords: 'Customer Service', place: 'Remote', remote: true, miles: null, lat: null, lng: null }]);
  assert.equal(t.writes[0].user_id, UID);
  assert.equal(t.writes[0].job_match_opt_out, false);
  const off = (await call({ action: 'job_alerts_save', mode: 'off', alerts: r.body.alerts })).body;
  assert.equal(off.mode, 'off');
  assert.equal(off.saved_mode, 'alerts');
  assert.equal(off.alerts.length, 1);
  assert.equal(t.email_prefs[0].job_match_opt_out, true, 'off is the unsubscribe column');
  assert.equal('job_match_mode' in t.writes[1], false);
  const back = (await call({ action: 'job_alerts_save', mode: 'resume', alerts: off.alerts })).body;
  assert.equal(back.mode, 'resume');
  assert.equal(t.email_prefs[0].job_match_opt_out, false);
});

test('validation: mode, list, count, empty alerts mode, words', async () => {
  const t = install();
  assert.equal((await call({ action: 'job_alerts_save', mode: 'everything', alerts: [] })).status, 400);
  assert.equal((await call({ action: 'job_alerts_save', mode: 'alerts' })).status, 400);
  assert.equal((await call({ action: 'job_alerts_save', mode: 'alerts', alerts: [] })).status, 400);
  const six = Array.from({ length: 6 }, (_, i) => ({ keywords: `role ${i}`, place: 'Remote' }));
  assert.equal((await call({ action: 'job_alerts_save', mode: 'alerts', alerts: six })).status, 400);
  const bad = await call({ action: 'job_alerts_save', mode: 'alerts', alerts: [REMOTE, { keywords: ' ', place: 'Remote' }] });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.index, 1);
  assert.equal(bad.body.field, 'keywords');
  assert.equal(t.writes.length, 0, 'nothing is written for a refused save');
});

test('a local alert: geocoded by lib/geo/usPlaces.js when present, an honest 503 when not; bad radius refused', async () => {
  install();
  const present = existsSync(new URL('../lib/geo/usPlaces.js', import.meta.url));
  const r = await call({ action: 'job_alerts_save', mode: 'alerts', alerts: [{ keywords: 'cashier', place: 'Phoenix, AZ', miles: 25 }] });
  if (!present) { assert.equal(r.status, 503); return; }
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.alerts[0].remote, false);
  assert.equal(r.body.alerts[0].miles, 25);
  assert.match(r.body.alerts[0].place, /Phoenix/);
  assert.ok(Number.isFinite(r.body.alerts[0].lat));
  const far = await call({ action: 'job_alerts_save', mode: 'alerts', alerts: [{ keywords: 'cashier', place: 'Phoenix, AZ', miles: 30 }] });
  assert.equal(far.status, 400);
  assert.equal(far.body.field, 'miles');
  const nowhere = await call({ action: 'job_alerts_save', mode: 'alerts', alerts: [{ keywords: 'cashier', place: 'Qqqzzx', miles: 25 }] });
  assert.equal(nowhere.status, 400);
  assert.equal(nowhere.body.field, 'place');
});

// Every writer of the canonical résumé, and every application change, rewrites profiles.job_keys
// (lib/server/jobKeys.js rebuildJobKeys) — through the real api/user-sync.js handler and an in-memory PostgREST.
// Writers: save_resume, clear_resume (with and without the saved-résumés table), resume_create /
// resume_set_default / resume_delete (lib/server/resumes.js writeMirror), add_application, remove_application.
// Run: node --test api/user-sync.jobKeys.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';

process.env.SUPABASE_URL = 'https://db.test';
process.env.SUPABASE_SERVICE_KEY = 'service';
process.env.SUPABASE_JWT_SECRET = 'jwt-secret';
const { default: handler } = await import('./user-sync.js');
const { _resetJobKeysProbe } = await import('../lib/server/jobKeys.js');

const UID = '55555555-5555-4555-8555-555555555555';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const head = b64({ alg: 'HS256', typ: 'JWT' });
const pay = b64({ sub: UID, exp: Math.floor(Date.now() / 1000) + 3600 });
const TOKEN = `${head}.${pay}.${createHmac('sha256', 'jwt-secret').update(`${head}.${pay}`).digest('base64url')}`;

const CASHIER = `Denise Carter\nMesa, AZ\n\nEXPERIENCE\nCashier — Fry's Food Stores, Mesa, AZ | Jun 2021 – Present\n• Ring up 300+ customers a shift on a busy front end and balance the drawer.\n• Process returns, coupons, WIC and EBT; train new cashiers.\n`;
const COOK = `Marcus Bell\nDenver, CO\n\nEXPERIENCE\nLine Cook — Snooze an A.M. Eatery, Denver, CO | Apr 2022 – Present\n• Work the grill and flat-top station on a 400-cover brunch service.\n• Prep sauces and proteins to par and keep the station to health code.\n`;

function match(row, key, v) {
  const val = row[key];
  if (v === 'is.null') return val == null;
  if (v === 'not.is.null') return val != null;
  if (v.startsWith('eq.')) return String(val) === v.slice(3);
  if (v.startsWith('gte.')) return String(val) >= v.slice(4);
  return true;
}
const CONTROL = new Set(['select', 'order', 'limit', 'on_conflict']);

function install({ resumesTable = false, profile = {} } = {}) {
  _resetJobKeysProbe();
  const t = { profiles: [{ id: UID, ...profile }], applications: [], seen_applications: [], resumes: [], ai_credits: [], keyWrites: [] };
  globalThis.fetch = async (url, opts = {}) => {
    const u = new URL(url);
    if (u.pathname.includes('/rpc/')) return Response.json(1);
    const name = u.pathname.split('/').pop();
    const m = opts.method || 'GET';
    if (name === 'resumes' && !resumesTable) return Response.json({ code: 'PGRST205', message: 'Could not find the table' }, { status: 404 });
    const list = t[name];
    if (!Array.isArray(list)) return Response.json([]);
    const filters = [...u.searchParams.entries()].filter(([k]) => !CONTROL.has(k));
    const hit = (r) => filters.every(([k, v]) => match(r, k, v));
    const pick = (r) => { const sel = u.searchParams.get('select'); return !sel || sel === '*' ? { ...r } : Object.fromEntries(sel.split(',').map((k) => [k, r[k] ?? null])); };
    if (m === 'GET') { const lim = Number(u.searchParams.get('limit')) || 1000; return Response.json(list.filter(hit).slice(0, lim).map(pick)); }
    if (m === 'POST') {
      const row = JSON.parse(opts.body);
      if (name === 'profiles') { const cur = list.find((r) => r.id === row.id); if (cur) Object.assign(cur, row); else list.push(row); return new Response(null, { status: 201 }); }
      const full = { id: randomUUID(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...row };
      list.push(full);
      return Response.json([pick(full)], { status: 201 });
    }
    if (m === 'PATCH') {
      const patch = JSON.parse(opts.body);
      if (name === 'profiles' && 'job_keys' in patch) t.keyWrites.push(patch.job_keys);
      const targets = list.filter(hit);
      targets.forEach((r) => Object.assign(r, patch));
      return /return=minimal/.test(opts.headers?.Prefer || '') ? new Response(null, { status: 204 }) : Response.json(targets.map(pick));
    }
    if (m === 'DELETE') { const gone = list.filter(hit); t[name] = list.filter((r) => !hit(r)); return Response.json(gone.map(pick)); }
    return new Response(null, { status: 405 });
  };
  return t;
}
function call(payload) {
  return new Promise((resolve) => {
    const res = { statusCode: 200, setHeader() {}, status(c) { this.statusCode = c; return this; }, json(b) { resolve({ status: this.statusCode, body: b }); return this; }, end() { resolve({ status: this.statusCode }); } };
    handler({ method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, origin: 'https://seenjobs.io' }, body: payload }, res);
  });
}
const occsOf = (k) => (k ? k.occupations.map((o) => o.occupation) : null);

test('save_resume rewrites the keys; a new résumé rewrites them again; clear_resume clears them (no saved-résumés table)', async () => {
  const t = install();
  assert.equal((await call({ action: 'save_resume', text: CASHIER, fileName: 'a.pdf', wordCount: 40 })).status, 200);
  assert.deepEqual(occsOf(t.keyWrites.at(-1)), ['cashier']);
  assert.equal((await call({ action: 'save_resume', text: COOK })).status, 200);
  assert.deepEqual(occsOf(t.keyWrites.at(-1)), ['cook'], 'every résumé update changes the keys');
  assert.equal((await call({ action: 'clear_resume' })).status, 200);
  assert.equal(t.keyWrites.at(-1), null, 'no résumé → keys cleared');
});

test('saved-résumés library: create (as the default), set_default and delete rewrite the keys through the profiles mirror', async () => {
  const t = install({ resumesTable: true });
  const c = await call({ action: 'resume_create', name: 'Store', text: CASHIER });
  assert.equal(c.status, 200, JSON.stringify(c.body));
  assert.deepEqual(occsOf(t.keyWrites.at(-1)), ['cashier']);
  // A second résumé (Pro) is not the default: the keys do not move until it is made the default.
  t.ai_credits.push({ user_id: UID, pro_until: new Date(Date.now() + 86400000).toISOString() });
  const c2 = await call({ action: 'resume_create', name: 'Kitchen', text: COOK });
  assert.equal(c2.status, 200, JSON.stringify(c2.body));
  const before = t.keyWrites.length;
  const cook = t.resumes.find((r) => r.name === 'Kitchen');
  assert.equal((await call({ action: 'resume_set_default', id: cook.id })).status, 200);
  assert.ok(t.keyWrites.length > before);
  assert.deepEqual(occsOf(t.keyWrites.at(-1)), ['cook']);
  assert.equal((await call({ action: 'resume_delete', id: cook.id })).status, 200);
  assert.deepEqual(occsOf(t.keyWrites.at(-1)), ['cashier'], 'the remaining résumé takes over, and so do its keys');
});

test('add_application and remove_application rewrite the keys (recent applications are part of them)', async () => {
  const t = install({ profile: { resume_text: CASHIER } });
  const a = await call({ action: 'add_application', application: { company: 'Dutch Bros', role: 'Barista', status: 'active', stage: 'Applied' } });
  assert.equal(a.status, 200, JSON.stringify(a.body));
  const k = t.keyWrites.at(-1);
  assert.deepEqual(k.applied.map((x) => [x.occupation, x.company]), [['barista', 'Dutch Bros']]);
  const id = t.applications[0].id;
  assert.equal((await call({ action: 'remove_application', id })).status, 200);
  assert.deepEqual(t.keyWrites.at(-1).applied, []);
});

test('before the job_keys migration the writers still succeed and write nothing', async () => {
  const t = install();
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    if (String(url).includes('select=job_keys&limit=1')) return Response.json({ code: '42703', message: 'column profiles.job_keys does not exist' }, { status: 400 });
    return real(url, opts);
  };
  assert.equal((await call({ action: 'save_resume', text: CASHIER })).status, 200);
  assert.equal(t.keyWrites.length, 0);
  globalThis.fetch = real;
});

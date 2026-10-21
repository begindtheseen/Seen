// End-to-end through the real handler: a fake PostgREST (in memory) + a fake Resend Receiving API.
// Nothing touches the network. Proves: webhook → read by id → tracker card; replay is a no-op; the hourly
// catch-up finds what no webhook delivered; mail for other seenjobs.io addresses is ignored; a send-only
// key is reported plainly; the Gmail confirmation code reaches the user's address row.
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://db.test';
process.env.SUPABASE_SERVICE_KEY = 'service';
process.env.RESEND_KEY = 're_test';
const { default: handler } = await import('./inbox-email.js');

const UID = '11111111-1111-4111-8111-111111111111';
const TOKEN = 'abcdefghjkmn';

function fakeDb() {
  const t = { inbox_addresses: [{ user_id: UID, token: TOKEN, paused: false, received_count: 0, last_received_at: null, forwarding_confirm: null }], inbox_events: [], applications: [] };
  let n = 0;
  const match = (row, params) => {
    for (const [k, v] of params) {
      if (['select', 'order', 'limit', 'on_conflict', 'offset'].includes(k)) continue;
      const [op, ...rest] = v.split('.'); const val = rest.join('.');
      const cell = row[k] == null ? null : String(row[k]);
      if (op === 'eq' && cell !== val) return false;
      if (op === 'in') { const list = val.replace(/^\(|\)$/g, '').split(',').map((s) => s.replace(/^"|"$/g, '')); if (!list.includes(cell)) return false; }
      if (op === 'lt' && !(cell < decodeURIComponent(val))) return false;
    }
    return true;
  };
  async function f(url, opts = {}) {
    const u = new URL(url);
    if (u.hostname === 'api.resend.com') return resend(u);
    const table = u.pathname.split('/').pop();
    const params = [...u.searchParams.entries()];
    const rows = t[table];
    if (!rows) return new Response('{}', { status: 404 });
    const method = opts.method || 'GET';
    const body = opts.body ? JSON.parse(opts.body) : null;
    if (method === 'GET') return Response.json(rows.filter((r) => match(r, params)).slice(0, Number(u.searchParams.get('limit')) || 1000));
    if (method === 'POST') {
      const items = Array.isArray(body) ? body : [body];
      const out = [];
      for (const it of items) {
        if (table === 'inbox_events' && rows.some((r) => r.provider_email_id === it.provider_email_id)) continue; // ignore-duplicates
        const row = { id: `${table}-${++n}`, created_at: new Date().toISOString(), ...it };
        if (table === 'inbox_events' && row.id) row.id = `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
        rows.push(row); out.push(row);
      }
      return Response.json(out, { status: 201 });
    }
    if (method === 'PATCH') { for (const r of rows.filter((r) => match(r, params))) Object.assign(r, body); return new Response(null, { status: 204 }); }
    if (method === 'DELETE') { t[table] = rows.filter((r) => !match(r, params)); return new Response(null, { status: 204 }); }
    return new Response('{}', { status: 405 });
  }
  const mail = new Map();
  let forbid = false;
  function resend(u) {
    if (forbid) return Response.json({ name: 'restricted_api_key', message: 'This API key is restricted to only send emails' }, { status: 401 });
    const m = u.pathname.match(/^\/emails\/receiving\/(.+)$/);
    if (m) return mail.has(m[1]) ? Response.json(mail.get(m[1])) : Response.json({ message: 'not found' }, { status: 404 });
    if (u.pathname === '/emails/receiving') return Response.json({ object: 'list', has_more: false, data: [...mail.values()].reverse().map(({ id, to, from, created_at, subject }) => ({ id, to, from, created_at, subject })) });
    return new Response('{}', { status: 404 });
  }
  return { f, t, mail, forbid: () => { forbid = true; } };
}

function call(db, { method = 'POST', body, query = {}, headers = {} }) {
  return new Promise((resolve) => {
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(b) { resolve({ status: this.statusCode, body: b }); return this; } };
    handler({ method, body, query, headers }, res, { fetch: db.f, rateLimit: async () => ({ allowed: true }) });
  });
}

const forwarded = (id, subject, text, from = 'Stripe <no-reply@us.greenhouse-mail.io>') => ({
  id, object: 'email', from, to: ['brandon@gmail.com'], received_for: [`track-${TOKEN}@seenjobs.io`],
  created_at: '2026-10-21T17:00:00.000Z', subject, text, html: null, headers: {}, authentication: { dkim: 'pass' },
});

test('webhook → the email is read by id → a tracker card exists; only facts are stored', async () => {
  const db = fakeDb();
  db.mail.set('e-0001-aaaa', forwarded('e-0001-aaaa', 'Thank you for applying to Stripe!', 'We have received your application for the Account Executive position.'));
  const r = await call(db, { body: { type: 'email.received', data: { email_id: 'e-0001-aaaa' } } });
  assert.deepEqual([r.status, r.body.state], [200, 'applied']);
  assert.equal(db.t.applications.length, 1);
  const a = db.t.applications[0];
  assert.deepEqual([a.user_id, a.company_name, a.role, a.platform, a.status, a.stage], [UID, 'Stripe', 'Account Executive', 'Greenhouse', 'active', 'Applied']);
  const ev = db.t.inbox_events[0];
  assert.deepEqual([ev.state, ev.kind, ev.company, ev.application_id], ['applied', 'application_received', 'Stripe', a.id]);
  for (const k of Object.keys(ev)) assert.ok(!['text', 'html', 'subject', 'body'].includes(k), `no ${k} stored`);
  assert.equal(db.t.inbox_addresses[0].received_count, 1);
});

test('the same webhook twice changes nothing the second time', async () => {
  const db = fakeDb();
  db.mail.set('e-0002-aaaa', forwarded('e-0002-aaaa', 'Thank you for applying to Stripe!', 'We have received your application.'));
  await call(db, { body: { type: 'email.received', data: { email_id: 'e-0002-aaaa' } } });
  const again = await call(db, { body: { type: 'email.received', data: { email_id: 'e-0002-aaaa' } } });
  assert.equal(again.body.state, 'duplicate');
  assert.equal(db.t.applications.length, 1);
});

test('a rejection later closes that card and asks before adding it to the grade', async () => {
  const db = fakeDb();
  db.mail.set('e-0003-aaaa', forwarded('e-0003-aaaa', 'Thank you for applying to Stripe!', 'We have received your application for the Account Executive position.'));
  db.mail.set('e-0004-aaaa', forwarded('e-0004-aaaa', 'Your application to Stripe', 'After careful consideration, we have decided to move forward with other candidates.'));
  await call(db, { body: { type: 'email.received', data: { email_id: 'e-0003-aaaa' } } });
  await call(db, { body: { type: 'email.received', data: { email_id: 'e-0004-aaaa' } } });
  assert.equal(db.t.applications.length, 1);
  assert.deepEqual([db.t.applications[0].status, db.t.applications[0].stage], ['rejected', 'Rejected']);
  assert.equal(db.t.inbox_events.find((e) => e.kind === 'rejection').share_state, 'ask');
});

test('the hourly catch-up processes what no webhook delivered, and ignores other seenjobs.io mail', async () => {
  const db = fakeDb();
  db.mail.set('e-0005-aaaa', forwarded('e-0005-aaaa', 'Interview Invitation - Ramp', 'We would like to schedule a phone screen with you.', 'Ramp Recruiting <talent@ramp.com>'));
  db.mail.set('e-0006-aaaa', { ...forwarded('e-0006-aaaa', 'hello', 'hi'), received_for: ['hello@seenjobs.io'], to: ['hello@seenjobs.io'] });
  const unauth = await call(db, { method: 'GET' });
  assert.equal(unauth.status, 401);
  const r = await call(db, { method: 'GET', headers: { 'x-vercel-cron': '1' } });
  assert.equal(r.body.ok, true);
  assert.deepEqual(r.body.results, { applied: 1, not_ours: 1 });
  assert.equal(db.t.applications[0].stage, 'Phone Screen');
  const again = await call(db, { method: 'GET', headers: { 'x-vercel-cron': '1' } });
  assert.equal(again.body.processed, 0, 'a second run has nothing left');
});

test('Gmail forwarding confirmation: the code lands on the address row for the setup screen', async () => {
  const db = fakeDb();
  db.mail.set('e-0007-aaaa', forwarded('e-0007-aaaa', '(#987654321) Gmail Forwarding Confirmation - Receive Mail from brandon@gmail.com',
    'Confirmation code: 987654321\nhttps://mail-settings.google.com/mail/vf-%5Babc%5D-def', 'Gmail Team <forwarding-noreply@google.com>'));
  const r = await call(db, { body: { type: 'email.received', data: { email_id: 'e-0007-aaaa' } } });
  assert.equal(r.body.state, 'forwarding_confirm');
  assert.equal(db.t.inbox_addresses[0].forwarding_confirm.code, '987654321');
  assert.equal(db.t.applications.length, 0);
});

test('a send-only Resend key is named plainly and the email is left for a retry', async () => {
  const db = fakeDb();
  db.forbid();
  const r = await call(db, { body: { type: 'email.received', data: { email_id: 'e-0008-aaaa' } } });
  assert.equal(r.body.state, 'resend_forbidden');
  assert.equal(db.t.inbox_events.length, 0, 'the claim was released');
  const check = await call(db, { method: 'GET', query: { check: '1' } });
  assert.deepEqual([check.body.ready, check.body.resend_read], [true, 'forbidden']);
});

test('a paused address records nothing; a bad id or other event type is refused', async () => {
  const db = fakeDb();
  db.t.inbox_addresses[0].paused = true;
  db.mail.set('e-0009-aaaa', forwarded('e-0009-aaaa', 'Thank you for applying to Stripe!', 'We have received your application.'));
  assert.equal((await call(db, { body: { type: 'email.received', data: { email_id: 'e-0009-aaaa' } } })).body.state, 'paused');
  assert.equal(db.t.applications.length, 0);
  assert.equal((await call(db, { body: { type: 'email.received', data: { email_id: 'x;drop' } } })).status, 400);
  assert.equal((await call(db, { body: { type: 'email.sent', data: {} } })).body.ignored, 'email.sent');
});

test('a webhook for an email Resend never received leaves no row behind', async () => {
  const db = fakeDb();
  const r = await call(db, { body: { type: 'email.received', data: { email_id: 'e-9999-zzzz' } } });
  assert.equal(r.body.state, 'unknown_email');
  assert.equal(db.t.inbox_events.length, 0);
});

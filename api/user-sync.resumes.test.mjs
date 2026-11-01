// Saved résumés through the real api/user-sync.js handler: a locally signed HS256 token and an in-memory
// PostgREST (resumes, profiles, ai_credits). Proves the cap by Pro status, scoping to the signed-in user,
// the profiles mirror of the default, default promotion on delete, and the missing-table fallback.
// Run: node --test api/user-sync.resumes.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';

process.env.SUPABASE_URL = 'https://db.test';
process.env.SUPABASE_SERVICE_KEY = 'service';
process.env.SUPABASE_JWT_SECRET = 'jwt-secret';
const { default: handler } = await import('./user-sync.js');

const UID = '33333333-3333-4333-8333-333333333333';
const OTHER = '44444444-4444-4444-8444-444444444444';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const head = b64({ alg: 'HS256', typ: 'JWT' });
const pay = b64({ sub: UID, exp: Math.floor(Date.now() / 1000) + 3600 });
const TOKEN = `${head}.${pay}.${createHmac('sha256', 'jwt-secret').update(`${head}.${pay}`).digest('base64url')}`;

const body = (who) => `${who}\nWarehouse Lead at Ross Stores 2019 - Present\n- Led a team of twelve associates through peak season receiving and shipping every week.\n- Cut mispicks by a third with a daily cycle count and a clear handoff board for every shift.\n`;
const A = body('Resume A'), B = body('Resume B'), C = body('Resume C');

function match(row, key, v) {
  const val = row[key];
  if (v === 'is.null') return val == null;
  if (v === 'not.is.null') return val != null;
  if (v.startsWith('eq.')) return String(val) === v.slice(3);
  if (v.startsWith('neq.')) return String(val) !== v.slice(4);
  return true;
}
const CONTROL = new Set(['select', 'order', 'limit', 'on_conflict']);

function install({ table = true, pro = false, profile = null, rows = [] } = {}) {
  let clock = Date.parse('2026-10-01T00:00:00Z');
  const tick = () => new Date(clock += 60_000).toISOString();
  const t = {
    resumes: rows.map((r) => ({ file_name: null, word_count: null, created_at: tick(), updated_at: tick(), ...r })),
    profiles: profile ? [{ id: UID, ...profile }] : [],
    ai_credits: pro ? [{ user_id: UID, pro: false, pro_until: new Date(Date.now() + 86400000).toISOString() }] : [],
    calls: [],
  };
  const oneDefault = () => {
    const seen = new Set();
    for (const r of t.resumes) if (r.is_default) { if (seen.has(r.user_id)) return false; seen.add(r.user_id); }
    return true;
  };
  globalThis.fetch = async (url, opts = {}) => {
    const u = new URL(url);
    if (u.pathname.includes('/rpc/')) return Response.json(1);
    const name = u.pathname.split('/').pop();
    const m = opts.method || 'GET';
    t.calls.push(`${m} ${name}?${u.searchParams.toString()}`);
    if (name === 'resumes' && !table) return Response.json({ code: 'PGRST205', message: 'Could not find the table' }, { status: 404 });
    const list = t[name];
    if (!list) return Response.json([]);
    const filters = [...u.searchParams.entries()].filter(([k]) => !CONTROL.has(k));
    const hit = (r) => filters.every(([k, v]) => match(r, k, v));
    const minimal = /return=minimal/.test(opts.headers?.Prefer || '');
    const pick = (r) => {
      const sel = u.searchParams.get('select');
      if (!sel || sel === '*') return { ...r };
      return Object.fromEntries(sel.split(',').map((k) => [k, r[k]]));
    };
    if (m === 'GET') {
      let out = list.filter(hit);
      if (u.searchParams.get('order') === 'updated_at.desc') out = [...out].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
      const lim = Number(u.searchParams.get('limit')) || out.length;
      return Response.json(out.slice(0, lim).map(pick));
    }
    if (m === 'POST') {
      const row = JSON.parse(opts.body);
      if (name === 'profiles') {
        const cur = list.find((r) => r.id === row.id);
        if (cur) Object.assign(cur, row); else list.push(row);
        return new Response(null, { status: 201 });
      }
      const full = { id: randomUUID(), created_at: tick(), updated_at: tick(), ...row };
      list.push(full);
      if (!oneDefault()) { list.pop(); return Response.json({ code: '23505', message: 'duplicate key' }, { status: 409 }); }
      return Response.json([pick(full)], { status: 201 });
    }
    if (m === 'PATCH') {
      const patch = JSON.parse(opts.body);
      const targets = list.filter(hit);
      const before = targets.map((r) => ({ ...r }));
      targets.forEach((r) => Object.assign(r, patch));
      if (name === 'resumes' && !oneDefault()) { targets.forEach((r, i) => Object.assign(r, before[i])); return Response.json({ code: '23505' }, { status: 409 }); }
      return minimal ? new Response(null, { status: 204 }) : Response.json(targets.map(pick));
    }
    if (m === 'DELETE') {
      t[name] = list.filter((r) => !hit(r));
      return new Response(null, { status: 204 });
    }
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
const profileOf = (t) => t.profiles.find((p) => p.id === UID);

test('before the migration: every résumé action answers ready:false; save_resume and clear_resume keep the single résumé', async () => {
  const t = install({ table: false });
  const l = await call({ action: 'resumes_list' });
  assert.equal(l.status, 200);
  assert.deepEqual(l.body, { ready: false, pro: false, max: 1 });
  assert.equal((await call({ action: 'resume_create', text: A })).body.ready, false);
  const s = await call({ action: 'save_resume', text: A, fileName: 'a.pdf', wordCount: 40 });
  assert.equal(s.status, 200);
  assert.equal(profileOf(t).resume_text, A);
  assert.equal((await call({ action: 'clear_resume' })).status, 200);
  assert.equal(profileOf(t).resume_text, null);
});

test('free: the résumé on file becomes the default row; a second one is refused with the upsell', async () => {
  const t = install({ profile: { resume_text: A, resume_file_name: 'a.pdf', resume_word_count: 40 } });
  const l = await call({ action: 'resumes_list' });
  assert.equal(l.body.ready, true);
  assert.equal(l.body.count, 1);
  assert.equal(l.body.resumes[0].name, 'My résumé');
  assert.equal(l.body.resumes[0].is_default, true);
  assert.equal(l.body.resumes[0].usable, true);
  assert.equal('text' in l.body.resumes[0], false);
  const c = await call({ action: 'resume_create', name: 'Retail', text: B });
  assert.equal(c.status, 403);
  assert.equal(c.body.reason, 'cap');
  assert.equal(c.body.upsell, true);
  assert.match(c.body.error, /Pro keeps up to 5/);
  assert.equal(t.resumes.length, 1, 'nothing inserted');
});

test('Pro: up to 5; a new one is not the default and leaves the mirror alone; set_default rewrites the mirror', async () => {
  const t = install({ pro: true, profile: { resume_text: A } });
  await call({ action: 'resumes_list' });
  const c = await call({ action: 'resume_create', name: '  Retail\nroles ', text: B, file_name: 'b.pdf', word_count: 41 });
  assert.equal(c.status, 200, JSON.stringify(c.body));
  assert.equal(c.body.count, 2);
  const made = c.body.resumes.find((r) => r.id === c.body.id);
  assert.equal(made.name, 'Retail roles');
  assert.equal(made.is_default, false);
  assert.equal(made.usable, true);
  assert.equal(profileOf(t).resume_text, A, 'the mirror still holds the default');
  for (const x of [C, C, C]) assert.equal((await call({ action: 'resume_create', text: x })).status, 200);
  const sixth = await call({ action: 'resume_create', text: C });
  assert.equal(sixth.status, 403);
  assert.match(sixth.body.error, /5 of 5/);

  const g = await call({ action: 'resume_get', id: c.body.id });
  assert.equal(g.body.resume.text, B.trim(), 'stored trimmed');
  const d = await call({ action: 'resume_set_default', id: c.body.id });
  assert.equal(d.status, 200);
  assert.equal(d.body.resumes[0].id, c.body.id, 'the default lists first');
  assert.equal(t.resumes.filter((r) => r.user_id === UID && r.is_default).length, 1);
  assert.equal(profileOf(t).resume_text, B.trim());
  assert.equal(profileOf(t).resume_file_name, 'b.pdf');
  assert.equal(profileOf(t).resume_word_count, 41);
});

test('another account’s résumé: get, rename, delete and set_default all answer 404 and touch nothing', async () => {
  const theirs = { id: randomUUID(), user_id: OTHER, name: 'Theirs', resume_text: C, is_default: true };
  const t = install({ pro: true, rows: [{ id: randomUUID(), user_id: UID, name: 'Mine', resume_text: A, is_default: true }, theirs] });
  for (const action of ['resume_get', 'resume_rename', 'resume_delete', 'resume_set_default']) {
    const r = await call({ action, id: theirs.id, name: 'Pwned' });
    assert.equal(r.status, 404, action);
  }
  const still = t.resumes.find((r) => r.id === theirs.id);
  assert.deepEqual({ name: still.name, is_default: still.is_default }, { name: 'Theirs', is_default: true });
  assert.equal((await call({ action: 'resume_get', id: 'not-a-uuid' })).status, 400);
  assert.ok(t.calls.filter((c) => c.includes(' resumes?')).every((c) => c.includes(`user_id=eq.${UID}`) || c.startsWith('POST')), 'every query is scoped to the caller');
});

test('delete: the default hands over to the most recently updated other one (mirror follows); the last clears the mirror', async () => {
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  const t = install({ pro: true, profile: { resume_text: A }, rows: [
    { id: ids[0], user_id: UID, name: 'A', resume_text: A, is_default: true, updated_at: '2026-10-01T00:00:00Z' },
    { id: ids[1], user_id: UID, name: 'B', resume_text: B, is_default: false, updated_at: '2026-10-20T00:00:00Z' },
    { id: ids[2], user_id: UID, name: 'C', resume_text: C, is_default: false, updated_at: '2026-10-10T00:00:00Z' },
  ] });
  const d = await call({ action: 'resume_delete', id: ids[0] });
  assert.equal(d.status, 200);
  assert.equal(d.body.count, 2);
  assert.equal(d.body.resumes[0].id, ids[1]);
  assert.equal(d.body.resumes[0].is_default, true);
  assert.equal(profileOf(t).resume_text, B);
  await call({ action: 'resume_delete', id: ids[2] });
  await call({ action: 'resume_delete', id: ids[1] });
  assert.equal(t.resumes.length, 0);
  assert.equal(profileOf(t).resume_text, null);
});

test('Pro lapsed: everything stays saved; only the default is usable; adding is refused; rename still works', async () => {
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  const t = install({ pro: false, rows: ids.map((id, i) => ({ id, user_id: UID, name: `R${i}`, resume_text: [A, B, C][i], is_default: i === 1 })) });
  const l = await call({ action: 'resumes_list' });
  assert.equal(l.body.count, 3);
  assert.deepEqual(l.body.resumes.map((r) => r.usable), [true, false, false]);
  assert.equal(l.body.resumes[0].id, ids[1]);
  const c = await call({ action: 'resume_create', text: A });
  assert.equal(c.status, 403);
  assert.match(c.body.error, /stay saved/);
  assert.equal((await call({ action: 'resume_get', id: ids[0] })).body.resume.text, A, 'still viewable');
  assert.equal((await call({ action: 'resume_rename', id: ids[0], name: 'Old one' })).status, 200);
  assert.equal(t.resumes.find((r) => r.id === ids[0]).name, 'Old one');
  assert.equal(t.resumes.length, 3, 'nothing deleted');
});

test('save_resume replaces the DEFAULT row and the mirror; unreadable text is refused before any write', async () => {
  const ids = [randomUUID(), randomUUID()];
  const t = install({ pro: true, profile: { resume_text: A }, rows: [
    { id: ids[0], user_id: UID, name: 'A', resume_text: A, is_default: true },
    { id: ids[1], user_id: UID, name: 'B', resume_text: B, is_default: false },
  ] });
  const s = await call({ action: 'save_resume', text: C, fileName: 'c.pdf', wordCount: 42 });
  assert.equal(s.status, 200);
  assert.equal(t.resumes.find((r) => r.id === ids[0]).resume_text, C);
  assert.equal(t.resumes.find((r) => r.id === ids[1]).resume_text, B, 'the other résumé is untouched');
  assert.equal(profileOf(t).resume_text, C);
  const bad = await call({ action: 'save_resume', text: '#$% ^&* 12 '.repeat(60) });
  assert.equal(bad.status, 400);
  assert.equal(profileOf(t).resume_text, C);
  // clear_resume = the default goes, the other one takes over
  assert.equal((await call({ action: 'clear_resume' })).status, 200);
  assert.equal(t.resumes.length, 1);
  assert.equal(t.resumes[0].is_default, true);
  assert.equal(profileOf(t).resume_text, B);
});

test('save_resume with no rows yet creates the default row from the file name', async () => {
  const t = install({});
  assert.equal((await call({ action: 'save_resume', text: A, fileName: 'Jordan_Avery.pdf', wordCount: 40 })).status, 200);
  assert.equal(t.resumes.length, 1);
  assert.equal(t.resumes[0].name, 'Jordan Avery');
  assert.equal(t.resumes[0].is_default, true);
  assert.equal(t.resumes[0].user_id, UID);
});

// Contract test for the brain gateway's ACCESS AUDIT (public.brain_access).
//
// WHY THIS EXISTS: cloud Claude sessions reach the vault through api/brain.js holding only
// BRAIN_API_URL + BRAIN_API_TOKEN, and until now a read left NO trace anywhere — a session could pull
// every note in the brain invisibly. Every authenticated op now appends exactly one brain_access row so
// the activity shows up live in the Chronos Mac app.
//
// The load-bearing properties, all asserted below:
//   1. ONE row per op — reads included, no dedupe/sampling (a read op used to be pure and silent).
//   2. FIRE-AND-FORGET — a failing, or even a permanently hanging, audit insert must not change the
//      op's status code, body, or latency. The hang test fails (rather than hangs) if someone `await`s it.
//   3. TRUTHFUL ok/ms — the row is written after the outcome is known, so a 400/500 logs ok:false.
//   4. args CARRIES IDENTIFIERS ONLY — never note bodies, fact objects, or the bearer token.
//
// Mocked Supabase REST layer throughout; nothing here touches the live brain or the network.
// Run: node --test api/brain.access.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

const TOKEN = 'test-brain-token';
process.env.BRAIN_API_TOKEN = TOKEN;
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-service-key';

const { default: handler } = await import('./brain.js');

function mockResponse(body, { ok = true, status = 200 } = {}) {
  return {
    ok, status,
    async json() { return body; },
    async text() { return typeof body === 'string' ? body : JSON.stringify(body); },
    headers: { get() { return null; } },
  };
}

// Records every REST call and answers the brain_* routes the gateway actually uses.
// `access` controls how the brain_access insert behaves: ok | http-500 | reject | hang.
function installFetch({ access = 'ok', notesRead = 'ok', delayMs = 0 } = {}) {
  const calls = [];
  global.fetch = async (url, init = {}) => {
    const u = String(url);
    const method = (init.method || 'GET').toUpperCase();
    let body = null;
    try { body = init.body ? JSON.parse(init.body) : null; } catch { body = init.body; }
    calls.push({ url: u, method, body });

    // --- the audit insert (must never be able to affect the op) ---
    if (u.includes('/brain_access')) {
      if (access === 'reject') throw new Error('audit: network unreachable');
      if (access === 'http-500') return mockResponse('permission denied for table brain_access', { ok: false, status: 500 });
      if (access === 'hang') return new Promise(() => {}); // never settles
      return mockResponse('', { status: 201 });
    }

    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    if (method === 'POST') return mockResponse('', { status: 201 }); // note/fact/timeline upserts, api_errors

    if (u.includes('brain_notes?select=path,content')) {
      if (notesRead === 'fail') return mockResponse('relation does not exist', { ok: false, status: 500 });
      return mockResponse([{ path: 'claude-observations.md', content: '---\ntitle: obs\n---\nbody\n' }]);
    }
    if (u.includes('brain_notes?select=content')) return mockResponse([]);       // fresh note → scaffold
    if (u.includes('brain_notes?select=path')) return mockResponse([{ path: 'a.md' }, { path: 'b.md' }]);
    if (u.includes('brain_facts?select=note')) return mockResponse([{ note: 'a.md' }]);
    if (u.includes('brain_timeline?select=id')) return mockResponse([{ id: 1 }, { id: 2 }, { id: 3 }]);
    return mockResponse([]);
  };
  return calls;
}

function makeRes() {
  const r = { statusCode: 200, jsonBody: null };
  r.setHeader = () => {}; r.status = (c) => { r.statusCode = c; return r; }; r.json = (o) => { r.jsonBody = o; return r; }; r.end = () => r;
  return r;
}

const post = (body, { token = TOKEN, method = 'POST' } = {}) => ({ method, headers: { authorization: `Bearer ${token}` }, body });
const flush = () => new Promise((r) => setImmediate(r));
const auditRows = (calls) => calls.filter((c) => c.url.includes('/brain_access') && c.method === 'POST').flatMap((c) => c.body);

async function call(body, opts = {}) {
  const res = makeRes();
  await handler(post(body, opts), res);
  await flush(); // let the un-awaited audit insert be issued
  return res;
}

// ---------------------------------------------------------------------------
// (a) reads are audited at all — the whole point of the change
// ---------------------------------------------------------------------------

for (const op of ['notes', 'counts']) {
  test(`read op "${op}" inserts ONE audit row with mode 'read' and the default actor`, async () => {
    const calls = installFetch();
    const res = await call({ op });

    assert.equal(res.statusCode, 200, 'the op itself still succeeds');
    assert.equal(res.jsonBody.ok, true);

    const rows = auditRows(calls);
    assert.equal(rows.length, 1, 'exactly one brain_access row');
    const row = rows[0];
    assert.equal(row.op, op);
    assert.equal(row.mode, 'read');
    assert.equal(row.by, 'claude:cloud-session', 'no `by` in the body → the cloud-session default');
    assert.equal(row.ok, true);
    assert.equal(typeof row.ms, 'number');
    assert.ok(row.ms >= 0);
    assert.equal(row.args, null, 'for a read the op name is the whole story');
    assert.equal(row.at, undefined, 'timestamp comes from the DB default, not the caller');
  });
}

test('one op = one row: three identical reads are NOT deduped or sampled', async () => {
  const calls = installFetch();
  await call({ op: 'notes' });
  await call({ op: 'notes' });
  await call({ op: 'notes' });
  assert.equal(auditRows(calls).length, 3);
});

test('ms reflects the real elapsed time of the op', async () => {
  const calls = installFetch({ delayMs: 25 });
  await call({ op: 'notes' });
  assert.ok(auditRows(calls)[0].ms >= 10, 'a 25ms store call must not be logged as ~0ms');
});

// ---------------------------------------------------------------------------
// (b) writes are audited as writes, with `by` passed through
// ---------------------------------------------------------------------------

test("record_fact inserts mode 'write' and passes `by` through", async () => {
  const calls = installFetch();
  const res = await call({
    op: 'record_fact',
    by: 'claude:cloud-session-4f21',
    fact: { subject: 'Seen brain gateway', predicate: 'audits', object: 'every op incl. reads' },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.jsonBody.ok, true);
  assert.equal(res.jsonBody.written, 1, 'the fact was really written');

  const rows = auditRows(calls);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].op, 'record_fact');
  assert.equal(rows[0].mode, 'write');
  assert.equal(rows[0].by, 'claude:cloud-session-4f21');
  assert.equal(rows[0].args, 'Seen brain gateway · audits', 'subject · predicate');
  assert.equal(rows[0].ok, true);
});

test("append_timeline inserts mode 'write' with the heading as args", async () => {
  const calls = installFetch();
  const res = await call({ op: 'append_timeline', heading: 'Gateway audit shipped', text: 'body text', by: 'claude:mac' });

  assert.equal(res.statusCode, 200);
  assert.equal(res.jsonBody.ok, true);
  const rows = auditRows(calls);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].mode, 'write');
  assert.equal(rows[0].op, 'append_timeline');
  assert.equal(rows[0].by, 'claude:mac');
  assert.equal(rows[0].args, 'Gateway audit shipped');
});

// ---------------------------------------------------------------------------
// (c) fire-and-forget: an audit failure changes NOTHING about the op
// ---------------------------------------------------------------------------

for (const access of ['http-500', 'reject']) {
  test(`an audit-insert failure (${access}) does not change the op's response`, async () => {
    const errs = [];
    const realError = console.error;
    console.error = (...a) => errs.push(a.join(' '));
    try {
      const calls = installFetch({ access });

      const read = await call({ op: 'counts' });
      assert.equal(read.statusCode, 200, 'read still 200 with a broken audit table');
      assert.deepEqual(read.jsonBody, { ok: true, counts: { notes: 2, facts: 1, episodes: 3 } });

      const write = await call({
        op: 'record_fact',
        fact: { subject: 'audit', predicate: 'is', object: 'best-effort' },
      });
      assert.equal(write.statusCode, 200, 'write still 200 with a broken audit table');
      assert.equal(write.jsonBody.ok, true);
      assert.equal(write.jsonBody.written, 1, 'the fact was still persisted');

      // The op's own REST work happened regardless of the audit outcome.
      assert.ok(calls.some((c) => c.method === 'POST' && c.url.includes('/brain_notes')), 'the note upsert still ran');
      assert.equal(auditRows(calls).length, 2, 'both inserts were attempted');
    } finally {
      console.error = realError;
    }
    assert.ok(errs.some((l) => l.includes('[brain-access]')), 'the failure is surfaced on the console, not swallowed silently');
  });
}

test('the audit insert is never awaited — a permanently hanging insert cannot hang the op', async () => {
  installFetch({ access: 'hang' });
  const res = makeRes();
  const outcome = await Promise.race([
    handler(post({ op: 'notes' }), res).then(() => 'returned'),
    new Promise((r) => { const t = setTimeout(() => r('timed-out'), 1000); if (t.unref) t.unref(); }),
  ]);
  assert.equal(outcome, 'returned', 'handler must not block on the audit insert');
  assert.equal(res.statusCode, 200);
  assert.equal(res.jsonBody.ok, true);
});

// ---------------------------------------------------------------------------
// (d) args never carries content or credentials
// ---------------------------------------------------------------------------

test('args carries identifiers only — never note bodies, fact objects, or the bearer token', async () => {
  const SECRET = 'PRIVATE-VAULT-BODY-a1b2c3-must-never-be-logged';

  let calls = installFetch();
  await call({
    op: 'append_timeline',
    heading: 'Session 14:02',
    text: `Long private entry: ${SECRET} — several paragraphs of vault content.`,
    by: 'claude:cloud-session',
  });
  let row = auditRows(calls)[0];
  assert.equal(row.args, 'Session 14:02', 'the heading, not the entry body');
  assert.ok(!JSON.stringify(row).includes(SECRET), 'timeline body must not reach the audit row');
  assert.ok(!JSON.stringify(row).includes(TOKEN), 'the bearer token must never reach the audit row');

  calls = installFetch();
  await call({
    op: 'record_fact',
    fact: { subject: 'Chronos vault', predicate: 'contains', object: SECRET, source: SECRET },
    note: `notes/${SECRET}.md`,
  });
  row = auditRows(calls)[0];
  assert.equal(row.args, 'Chronos vault · contains', 'subject · predicate only — not the object');
  assert.ok(!JSON.stringify(row).includes(SECRET), 'fact object / source / note path must not reach the audit row');
  assert.ok(!JSON.stringify(row).includes(TOKEN));
});

test('a hostile oversized identifier is capped, so the insert can never fail on length', async () => {
  const calls = installFetch();
  await call({
    op: 'record_fact',
    by: 'b'.repeat(5000),
    fact: { subject: 's'.repeat(5000), predicate: 'p'.repeat(5000), object: 'x' },
  });
  const row = auditRows(calls)[0];
  assert.ok(row.args.length <= 300, `args capped, got ${row.args.length}`);
  assert.ok(row.by.length <= 200, `by capped, got ${row.by.length}`);
});

// ---------------------------------------------------------------------------
// Truthful ok:false — failures must be visible, not logged as clean successes
// ---------------------------------------------------------------------------

test('a rejected op (400 bad params) is audited with ok:false', async () => {
  const calls = installFetch();
  const res = await call({ op: 'record_fact', fact: { subject: 'a', predicate: 'b' } }); // no object

  assert.equal(res.statusCode, 400);
  const rows = auditRows(calls);
  assert.equal(rows.length, 1, 'a rejected op is still one row');
  assert.equal(rows[0].op, 'record_fact');
  assert.equal(rows[0].mode, 'write');
  assert.equal(rows[0].ok, false);
});

test('a thrown op (500) is audited with ok:false', async () => {
  const calls = installFetch({ notesRead: 'fail' });
  const res = await call({ op: 'notes' });

  assert.equal(res.statusCode, 500);
  assert.equal(res.jsonBody.ok, false);
  const rows = auditRows(calls);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].op, 'notes');
  assert.equal(rows[0].mode, 'read');
  assert.equal(rows[0].ok, false);
});

test('an unknown op is audited too, so a misconfigured client is visible', async () => {
  let calls = installFetch();
  let res = await call({ op: 'drop_everything' });
  assert.equal(res.statusCode, 400);
  let row = auditRows(calls)[0];
  assert.equal(row.op, 'drop_everything');
  assert.equal(row.mode, 'read', 'an unrecognised op mutates nothing');
  assert.equal(row.ok, false);

  calls = installFetch();
  res = await call({});
  assert.equal(res.statusCode, 400);
  row = auditRows(calls)[0];
  assert.equal(row.op, '(none)', 'op is NOT NULL — a missing op is recorded explicitly');
  assert.equal(row.ok, false);
});

// ---------------------------------------------------------------------------
// Unauthenticated traffic is NOT audited (an open door would let anyone fill the table)
// ---------------------------------------------------------------------------

test('a request with a bad token is rejected and writes no audit row', async () => {
  const calls = installFetch();
  const res = await call({ op: 'notes' }, { token: 'wrong-token' });
  assert.equal(res.statusCode, 401);
  assert.equal(auditRows(calls).length, 0);
});

test('a non-POST request writes no audit row', async () => {
  const calls = installFetch();
  const res = await call({ op: 'notes' }, { method: 'GET' });
  assert.equal(res.statusCode, 405);
  assert.equal(auditRows(calls).length, 0);
});

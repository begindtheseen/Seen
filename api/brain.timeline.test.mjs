// Contract test for the brain gateway's append_timeline op — ATOMICITY and the md5 dedupe key.
//
// WHY THIS EXISTS: append_timeline used to write the note to brain_notes FIRST and mirror the row into
// brain_timeline SECOND. The mirror's UNIQUE btree(date, heading, body) hit Postgres's ~2704-byte btree
// entry cap, so any body over ~2.7KB failed the mirror insert AFTER the note was durably written — the
// op returned ok:false with the note already in the vault, and a retry appended it twice. A cloud
// session hit this 3× on 2026-08-13 at 09:53–09:55Z.
//
// Two halves to the fix, both pinned below:
//   • migration 069 rekeys the mirror to UNIQUE(date, heading, body_md5) — md5 is fixed-width, so a body
//     of ANY size is indexable while exact duplicates are still rejected.
//   • brainStore.appendTimeline is MIRROR-FIRST, so a mirror failure leaves ZERO durable writes.
//
// The load-bearing properties, all asserted below:
//   1. An oversized (>2704-byte) body appends end-to-end — the size that used to break the op.
//   2. A mirror-insert failure returns ok:false AND writes nothing to brain_notes.
//   3. The on_conflict target is exactly `date,heading,body_md5`, and `body_md5` NEVER appears in the
//      row payload (it is a STORED GENERATED column — PostgREST 400s if you send it).
//   4. Retry after a failed op appends the note exactly once, and a retry of an op that already
//      succeeded does not stack a second copy.
//
// Mocked Supabase REST layer throughout; nothing here touches the live brain or the network.
// Run: node --test api/brain.timeline.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, scryptSync } from 'node:crypto';

const TOKEN = 'test-brain-token';
const CLIENT_TOKEN = 'chr_test_client_credential_not_a_real_secret';
const CLIENT_SALT = '0123456789abcdef0123456789abcdef';
const CLIENT_ROW = {
  id: 'client_test', name: 'test-client', scopes: ['read', 'write'], salt: CLIENT_SALT,
  lookup: createHash('sha256').update(CLIENT_TOKEN).digest('hex'),
  verifier: scryptSync(CLIENT_TOKEN, CLIENT_SALT, 32).toString('hex'),
  created_at: '2026-08-14T00:00:00.000Z', expires_at: null, revoked_at: null, last_used_at: null,
};
process.env.BRAIN_API_TOKEN = TOKEN;
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-service-key';

const { default: handler } = await import('./brain.js');

// The exact cap that made the old key unusable: a btree entry may not exceed 2704 bytes.
const BTREE_CAP = 2704;

function mockResponse(body, { ok = true, status = 200 } = {}) {
  return {
    ok, status,
    async json() { return body; },
    async text() { return typeof body === 'string' ? body : JSON.stringify(body); },
    headers: { get() { return null; } },
  };
}

// Mock REST layer with a STATEFUL brain_notes store, so "did the note get written / written twice?"
// is answerable the way it is in prod (read-modify-write against whatever is actually persisted).
//
// `mirror` controls the brain_timeline insert: ok | oversize | http-500.
//   'oversize' reproduces the real production failure — reject only when the body exceeds the btree cap
//   AND the request is keyed on the raw body, which is exactly what the old constraint did.
// `note` controls the brain_notes upsert: ok | http-500.
function installFetch({ mirror = 'ok', note = 'ok', notes = new Map() } = {}) {
  const calls = [];
  global.fetch = async (url, init = {}) => {
    const u = String(url);
    const method = (init.method || 'GET').toUpperCase();
    let body = null;
    try { body = init.body ? JSON.parse(init.body) : null; } catch { body = init.body; }
    calls.push({ url: u, method, body, headers: init.headers || {} });

    if (u.includes('/brain_access')) return mockResponse('', { status: 201 }); // audit: not under test here
    if (u.includes('/brain_clients')) {
      if (method === 'GET') return mockResponse([CLIENT_ROW]);
      return mockResponse('', { status: 204 });
    }

    // --- the brain_timeline mirror insert ---
    if (u.includes('/brain_timeline') && method === 'POST') {
      const row = Array.isArray(body) ? body[0] : body;
      if (mirror === 'http-500') return mockResponse('mirror exploded', { ok: false, status: 500 });
      if (mirror === 'oversize' && u.includes('on_conflict=date,heading,body')
          && !u.includes('body_md5') && Buffer.byteLength(row.body || '') > BTREE_CAP) {
        return mockResponse(
          `index row size 3208 exceeds btree version 4 maximum ${BTREE_CAP} for index "brain_timeline_date_heading_body_key"`,
          { ok: false, status: 500 },
        );
      }
      return mockResponse('', { status: 201 });
    }

    // --- the canonical brain_notes upsert (stateful) ---
    if (u.startsWith('https://example.supabase.co/rest/v1/brain_notes') && method === 'POST') {
      if (note === 'http-500') return mockResponse('note write failed', { ok: false, status: 500 });
      for (const r of (Array.isArray(body) ? body : [body])) notes.set(r.path, r.content);
      return mockResponse('', { status: 201 });
    }

    if (u.includes('brain_notes?select=content')) {
      const m = u.match(/path=eq\.([^&]+)/);
      const path = m ? decodeURIComponent(m[1]) : '';
      return mockResponse(notes.has(path) ? [{ content: notes.get(path) }] : []);
    }

    if (method === 'POST') return mockResponse('', { status: 201 }); // api_errors etc.
    return mockResponse([]);
  };
  return { calls, notes };
}

function makeRes() {
  const r = { statusCode: 200, jsonBody: null };
  r.setHeader = () => {}; r.status = (c) => { r.statusCode = c; return r; }; r.json = (o) => { r.jsonBody = o; return r; }; r.end = () => r;
  return r;
}

const post = (body, { token = TOKEN, clientToken = CLIENT_TOKEN, method = 'POST' } = {}) => ({
  method, headers: { authorization: `Bearer ${token}`, 'x-chronos-client-token': clientToken }, body,
});
const flush = () => new Promise((r) => setImmediate(r));

async function call(body, opts = {}) {
  const res = makeRes();
  await handler(post({ by: 'test-client', ...body }, opts), res);
  await flush(); // let the un-awaited audit insert be issued
  return res;
}

const timelinePosts = (calls) => calls.filter((c) => c.url.includes('/brain_timeline') && c.method === 'POST');
const notePosts = (calls) => calls.filter((c) => c.url.includes('/brain_notes') && c.method === 'POST');
const occurrences = (haystack, needle) => haystack.split(needle).length - 1;

// ---------------------------------------------------------------------------
// (a) an oversized body — the exact input that used to break the op — now works end-to-end
// ---------------------------------------------------------------------------

test('a body far over the 2704-byte btree cap appends successfully end-to-end', async () => {
  const { calls, notes } = installFetch({ mirror: 'oversize' });
  const big = 'x'.repeat(5000); // the size verified against prod
  assert.ok(Buffer.byteLength(big) > BTREE_CAP, 'fixture must actually exceed the cap');

  const res = await call({ op: 'append_timeline', date: '2026-08-13', heading: 'Big session', text: big });

  assert.equal(res.statusCode, 200);
  assert.equal(res.jsonBody.ok, true);
  assert.equal(res.jsonBody.note, 'timeline/2026-08-13.md');
  assert.equal(res.jsonBody.heading, 'Big session');
  assert.equal(res.jsonBody.appended, true);

  // Both halves landed: the mirror row AND the canonical note.
  assert.equal(timelinePosts(calls).length, 1, 'the mirror row was inserted');
  assert.equal(notePosts(calls).length, 1, 'the note was written');
  assert.ok(notes.get('timeline/2026-08-13.md').includes(big), 'the full body is in the note');
});

test('the mirror row payload carries the raw body — no truncation, no size guard', async () => {
  const { calls } = installFetch();
  const big = 'y'.repeat(9000);
  const res = await call({ op: 'append_timeline', heading: 'Unbounded', text: big });

  assert.equal(res.jsonBody.ok, true, 'no body-size guard rejects a large episode');
  const row = timelinePosts(calls)[0].body[0];
  assert.equal(row.body, big, 'the body is mirrored verbatim, not clipped to fit an index');
});

// ---------------------------------------------------------------------------
// (b) a failed op leaves ZERO durable writes — the partial-write bug itself
// ---------------------------------------------------------------------------

test('mirror-insert failure returns ok:false AND never touches brain_notes', async () => {
  const { calls, notes } = installFetch({ mirror: 'http-500' });
  const res = await call({ op: 'append_timeline', date: '2026-08-13', heading: 'Doomed', text: 'body text' });

  assert.equal(res.statusCode, 500);
  assert.equal(res.jsonBody.ok, false);
  assert.equal(notePosts(calls).length, 0, 'THE BUG: the note must not be written when the mirror fails');
  assert.equal(notes.size, 0, 'nothing durable survives a failed op');
});

test('ordering is mirror-BEFORE-note, so there is no window where the note is ahead of the mirror', async () => {
  const { calls } = installFetch();
  await call({ op: 'append_timeline', heading: 'Ordering', text: 'body' });

  const seq = calls.filter((c) => c.method === 'POST' && (c.url.includes('/brain_timeline') || c.url.includes('/brain_notes')))
    .map((c) => (c.url.includes('/brain_timeline') ? 'mirror' : 'note'));
  assert.deepEqual(seq, ['mirror', 'note'], 'the mirror insert must be the first durable write');
});

// ---------------------------------------------------------------------------
// (c) pin the conflict target — nobody may revert to the uncappable raw-body key
// ---------------------------------------------------------------------------

test('the brain_timeline on_conflict target is exactly date,heading,body_md5', async () => {
  const { calls } = installFetch();
  await call({ op: 'append_timeline', heading: 'Key pin', text: 'body' });

  const url = timelinePosts(calls)[0].url;
  const target = new URL(url).searchParams.get('on_conflict');
  assert.equal(target, 'date,heading,body_md5',
    'the mirror must conflict on md5(body) — a raw-body btree key cannot index bodies over 2704 bytes');
  assert.ok(!/on_conflict=date,heading,body(&|$)/.test(url), 'the old uncappable key must be gone');
});

test('body_md5 is NEVER sent in the row payload (generated column — PostgREST would 400)', async () => {
  const { calls } = installFetch();
  await call({ op: 'append_timeline', heading: 'Generated col', text: 'body' });

  for (const row of timelinePosts(calls)[0].body) {
    assert.ok(!('body_md5' in row), 'body_md5 is GENERATED ALWAYS — sending it is rejected by PostgREST');
    assert.deepEqual(Object.keys(row).sort(), ['body', 'date', 'heading']);
  }
});

test('the mirror insert stays ignore-duplicates, so a converging retry is not an error', async () => {
  const { calls } = installFetch();
  await call({ op: 'append_timeline', heading: 'Dedupe', text: 'body' });

  const prefer = timelinePosts(calls)[0].headers.prefer;
  assert.match(prefer, /resolution=ignore-duplicates/,
    're-inserting an identical episode must be a silent no-op, not a 409 — that is what makes a retry converge');
});

// ---------------------------------------------------------------------------
// (d) retries converge — the duplicate-note risk the partial write created
// ---------------------------------------------------------------------------

test('retry after a failed op appends the note exactly once', async () => {
  const notes = new Map();

  // Attempt 1: mirror fails → nothing durable.
  const first = installFetch({ mirror: 'http-500', notes });
  let res = await call({ op: 'append_timeline', date: '2026-08-13', heading: 'Retry me', text: 'the entry body' });
  assert.equal(res.jsonBody.ok, false);
  assert.equal(notePosts(first.calls).length, 0);
  assert.equal(notes.size, 0);

  // Attempt 2 (naive retry, same payload): now succeeds.
  const second = installFetch({ notes });
  res = await call({ op: 'append_timeline', date: '2026-08-13', heading: 'Retry me', text: 'the entry body' });
  assert.equal(res.jsonBody.ok, true);
  assert.equal(notePosts(second.calls).length, 1);

  const content = notes.get('timeline/2026-08-13.md');
  assert.equal(occurrences(content, '## Retry me'), 1, 'the episode appears exactly once, not twice');
  assert.equal(occurrences(content, 'the entry body'), 1);
});

test('a retry of an op that already succeeded does not stack a second copy', async () => {
  const notes = new Map();

  const first = installFetch({ notes });
  let res = await call({ op: 'append_timeline', date: '2026-08-13', heading: 'Already in', text: 'same body' });
  assert.equal(res.jsonBody.appended, true);
  assert.equal(notePosts(first.calls).length, 1);

  // Same payload again — e.g. the caller never saw the first response and retried.
  const second = installFetch({ notes });
  res = await call({ op: 'append_timeline', date: '2026-08-13', heading: 'Already in', text: 'same body' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.jsonBody.ok, true);
  assert.equal(res.jsonBody.appended, false, 'reported as already-present, not as a fresh append');
  assert.equal(notePosts(second.calls).length, 0, 'no redundant note upsert');

  const content = notes.get('timeline/2026-08-13.md');
  assert.equal(occurrences(content, '## Already in'), 1, 'still exactly one copy of the episode');
});

test('an idempotent retry repairs legacy type-less timeline frontmatter', async () => {
  const date = '2026-08-13';
  const notes = new Map([[
    `timeline/${date}.md`,
    `---\ntitle: ${date}\ndate: ${date}\ntags: [timeline]\n---\n\n## Legacy\n\nsame body\n`,
  ]]);
  const { calls } = installFetch({ notes });
  const res = await call({ op: 'append_timeline', date, heading: 'Legacy', text: 'same body' });

  assert.equal(res.statusCode, 200);
  assert.equal(res.jsonBody.appended, false);
  assert.equal(res.jsonBody.repaired, true);
  assert.equal(notePosts(calls).length, 1, 'the canonical header repair is persisted');
  const content = notes.get(`timeline/${date}.md`);
  assert.match(content, /^type: daily$/m);
  assert.equal(occurrences(content, '## Legacy'), 1, 'the episode remains idempotent');
});

test('a note-write failure after the mirror landed converges on retry (the acceptable direction)', async () => {
  const notes = new Map();

  // Mirror lands, note write fails → op reports failure, mirror row is already durable.
  const first = installFetch({ note: 'http-500', notes });
  let res = await call({ op: 'append_timeline', date: '2026-08-13', heading: 'Half in', text: 'body' });
  assert.equal(res.jsonBody.ok, false);
  assert.equal(timelinePosts(first.calls).length, 1, 'the mirror row landed');
  assert.equal(notes.size, 0, 'the note did not');

  // Retry: the mirror insert is a dedupe no-op, the note write is redone → converged.
  const second = installFetch({ notes });
  res = await call({ op: 'append_timeline', date: '2026-08-13', heading: 'Half in', text: 'body' });
  assert.equal(res.jsonBody.ok, true);
  assert.equal(occurrences(notes.get('timeline/2026-08-13.md'), '## Half in'), 1);
});

// ---------------------------------------------------------------------------
// distinct episodes still append normally (the dedupe guard must not over-match)
// ---------------------------------------------------------------------------

test('two different episodes on the same date both land in the one note', async () => {
  const notes = new Map();

  installFetch({ notes });
  await call({ op: 'append_timeline', date: '2026-08-13', heading: 'First', text: 'body one' });
  installFetch({ notes });
  const res = await call({ op: 'append_timeline', date: '2026-08-13', heading: 'Second', text: 'body two' });

  assert.equal(res.jsonBody.appended, true, 'a genuinely new episode is not mistaken for a duplicate');
  const content = notes.get('timeline/2026-08-13.md');
  assert.equal(occurrences(content, '## First'), 1);
  assert.equal(occurrences(content, '## Second'), 1);
  assert.ok(content.indexOf('## First') < content.indexOf('## Second'), 'appended in order');
});

test('the same heading with a DIFFERENT body is a new episode, not a duplicate', async () => {
  const notes = new Map();

  installFetch({ notes });
  await call({ op: 'append_timeline', date: '2026-08-13', heading: 'Session', text: 'first pass' });
  installFetch({ notes });
  const res = await call({ op: 'append_timeline', date: '2026-08-13', heading: 'Session', text: 'second pass' });

  assert.equal(res.jsonBody.appended, true);
  const content = notes.get('timeline/2026-08-13.md');
  assert.equal(occurrences(content, '## Session'), 2, 'both passes are recorded');
  assert.equal(occurrences(content, 'first pass'), 1);
  assert.equal(occurrences(content, 'second pass'), 1);
});

test('a fresh date scaffolds the note frontmatter, then appends the episode', async () => {
  const { notes } = installFetch();
  await call({ op: 'append_timeline', date: '2026-09-01', heading: 'Day one', text: 'body' });

  const content = notes.get('timeline/2026-09-01.md');
  assert.ok(content.startsWith('---\ntitle: 2026-09-01\ntype: daily\ndate: 2026-09-01\ntags: [timeline]\n---\n'), content.slice(0, 100));
  assert.ok(content.includes('\n## Day one\n\nbody\n'));
});

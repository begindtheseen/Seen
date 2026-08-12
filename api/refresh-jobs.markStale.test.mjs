// markStaleJobs must HIDE stale listings, not just relabel them — and it must survive its own
// backlog while doing it.
//
// User search gates on `expires_at > now()`, never on availability_status. The old sweep set only
// the status, so 12,899 rows sat 'stale' with a future expires_at and stayed in results — the admin
// stale counts read correctly while clearing them changed nothing a user could see.
//
// Fixing that surfaced the next failure. The sweep runs as `service_role`, which has no rolconfig
// of its own and inherits `authenticator`'s statement_timeout of 8s. Rewriting the whole matching
// set in ONE statement is not merely slow past a few thousand rows, it is impossible: Postgres
// cancels it with 57014 and writes nothing. Production logged exactly that on every run —
//   markStaleJobs stale-backfill failed: 500 {"code":"57014",...,"statement timeout"}
// — over a 12,983-row repair, so the rows the step existed to hide were never hidden.

import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-service-key';

const { markStaleJobs } = await import('./refresh-jobs.js');

const stepOf = (u) =>
  u.includes('availability_status=eq.active') ? 'stale'
    : u.includes('availability_status=eq.stale') ? 'stale-backfill'
      : 'expired';

const idsIn = (u) => {
  const m = /[?&]id=in\.\(([^)]*)\)/.exec(u);
  return m && m[1] ? m[1].split(',') : [];
};

// Fake table: each step has a backlog of matching rows. A GET hands back a page of ids (bounded by
// the caller's own limit), a PATCH removes exactly the ids it names — so a step drains only if the
// code actually pages through it.
function installFetch({ backlog = {}, failOn = null, failStatus = 400, failBody = 'violates check constraint', delayMs = 0 } = {}) {
  const calls = [];
  const remaining = { stale: 0, 'stale-backfill': 0, expired: 0, ...backlog };
  let nextId = 1;
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    const method = opts.method || 'GET';
    const step = stepOf(u);
    calls.push({ url: u, method, step, body: opts.body ? JSON.parse(opts.body) : null, ids: idsIn(u) });
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    if (failOn && method === 'PATCH' && u.includes(failOn)) {
      return { ok: false, status: failStatus, headers: new Map(), async text() { return failBody; } };
    }
    if (method === 'GET') {
      const limit = Number(new URL(u, 'https://x').searchParams.get('limit')) || 200;
      const n = Math.min(limit, remaining[step]);
      const rows = Array.from({ length: n }, () => ({ id: `id-${nextId++}` }));
      return { ok: true, status: 200, headers: new Map(), async json() { return rows; } };
    }
    const n = idsIn(u).length;
    remaining[step] = Math.max(0, remaining[step] - n);
    return { ok: true, status: 204, headers: new Map([['content-range', `*/${n}`]]), async text() { return ''; } };
  };
  return { calls, remaining };
}

const patches = (calls) => calls.filter((c) => c.method === 'PATCH');
const ONE_EACH = { stale: 1, 'stale-backfill': 1, expired: 1 };

test('every stale transition also expires the row so it leaves the search', async () => {
  const { calls } = installFetch({ backlog: ONE_EACH });
  await markStaleJobs('https://db.test', 'key');
  const p = patches(calls);
  assert.equal(p.length, 3, `expected 3 sweep steps, got ${p.length}`);
  for (const c of p) {
    assert.ok(c.body.expires_at, `${c.url} must set expires_at`);
    assert.ok(new Date(c.body.expires_at).getTime() <= Date.now() + 1000, 'expires_at is now or past');
  }
});

test('the 7-day step marks stale AND hides', async () => {
  const { calls } = installFetch({ backlog: ONE_EACH });
  await markStaleJobs('https://db.test', 'key');
  const step = patches(calls).find((c) => c.url.includes('availability_status=eq.active') && c.url.includes('last_seen_at=lt.'));
  assert.ok(step, 'has an active→stale step');
  assert.equal(step.body.availability_status, 'stale');
  assert.ok(step.body.expires_at);
});

test('already-stale rows with a future expires_at are repaired', async () => {
  // Without this the 12,899 existing rows are unreachable: the 7-day step only matches `active`.
  const { calls } = installFetch({ backlog: ONE_EACH });
  await markStaleJobs('https://db.test', 'key');
  const backfill = patches(calls).find((c) => c.url.includes('availability_status=eq.stale') && c.url.includes('expires_at=gt.'));
  assert.ok(backfill, 'has a backfill step for rows already marked stale');
  assert.ok(backfill.body.expires_at);
});

test('employer-posted listings are never swept', async () => {
  const { calls } = installFetch({ backlog: ONE_EACH });
  await markStaleJobs('https://db.test', 'key');
  for (const c of patches(calls)) {
    assert.ok(c.url.includes('is_employer_posted=eq.false'), `${c.url} must exclude employer listings`);
  }
});

test('steps run sequentially, not raced', async () => {
  // The 14-day query matches in.(active,stale) while the 7-day query flips active→stale; run
  // together they race on the same rows.
  const { calls } = installFetch({ backlog: ONE_EACH });
  await markStaleJobs('https://db.test', 'key');
  const p = patches(calls);
  const expiredIdx = p.findIndex((c) => c.body.availability_status === 'expired');
  const staleIdx = p.findIndex((c) => c.body.availability_status === 'stale');
  assert.ok(staleIdx >= 0 && expiredIdx > staleIdx, 'expire step runs after the stale step');
});

test('a rejected write is logged, and the sweep still completes', async () => {
  // A bare fetch does not throw on 4xx; an unchecked response hides a failed sweep entirely.
  const errors = [];
  const origError = console.error;
  console.error = (...a) => errors.push(a.join(' '));
  try {
    const { calls } = installFetch({ backlog: ONE_EACH, failOn: 'availability_status=eq.active' });
    const out = await markStaleJobs('https://db.test', 'key');
    assert.ok(errors.some((e) => /markStaleJobs stale failed: 400/.test(e)), `expected a logged failure, got ${JSON.stringify(errors)}`);
    assert.equal(patches(calls).length, 3, 'one failed step does not abort the rest');
    assert.equal(out.complete, false, 'a failed step must not report a complete sweep');
  } finally { console.error = origError; }
});

// ── The 8s statement-timeout class ────────────────────────────────────────────────────────────

test('no single statement is asked to rewrite the whole backlog', async () => {
  // This is the regression that mattered: one PATCH over 12,983 rows cannot finish inside
  // service_role's inherited 8s statement_timeout, so it wrote nothing, every run, forever.
  const { calls, remaining } = installFetch({ backlog: { 'stale-backfill': 12983 } });
  const out = await markStaleJobs('https://db.test', 'key');
  const p = patches(calls).filter((c) => c.step === 'stale-backfill');
  assert.ok(p.length > 1, 'a backlog larger than one chunk must be split across statements');
  for (const c of p) {
    assert.ok(c.ids.length > 0, 'every PATCH names the exact ids it rewrites');
    assert.ok(c.ids.length <= 200, `chunk of ${c.ids.length} exceeds the bound`);
  }
  assert.equal(remaining['stale-backfill'], 0, 'the backlog is fully drained');
  assert.equal(out.steps['stale-backfill'], 12983, 'and the sweep reports what it actually wrote');
  assert.equal(out.complete, true);
});

test('each chunk still carries the step filter, so a row that stopped matching is not rewritten', async () => {
  const { calls } = installFetch({ backlog: { 'stale-backfill': 500 } });
  await markStaleJobs('https://db.test', 'key');
  for (const c of patches(calls).filter((x) => x.step === 'stale-backfill')) {
    assert.ok(c.url.includes('availability_status=eq.stale'), 'id list alone is not the filter');
    assert.ok(c.url.includes('is_employer_posted=eq.false'));
  }
});

test('a backlog too big for one run stops on the deadline and says so', async () => {
  // Ingestion must not starve behind a one-off repair. The step resumes on the next run.
  const { calls } = installFetch({ backlog: { 'stale-backfill': 50000 }, delayMs: 2 });
  const out = await markStaleJobs('https://db.test', 'key', { deadline: Date.now() + 60 });
  assert.equal(out.complete, false, 'an unfinished sweep must not claim completeness');
  assert.ok(out.swept > 0, 'it still made progress');
  assert.ok(patches(calls).length < 250, 'it stopped early rather than running to the chunk cap');
});

test('a step that matches rows but writes none stops instead of spinning', async () => {
  // Without this the loop re-selects the same page until it burns the whole handler budget.
  const warns = [];
  const origWarn = console.warn;
  console.warn = (...a) => warns.push(a.join(' '));
  try {
    const calls = [];
    global.fetch = async (url, opts = {}) => {
      const u = String(url);
      const method = opts.method || 'GET';
      calls.push({ url: u, method });
      if (method === 'GET') return { ok: true, status: 200, headers: new Map(), async json() { return [{ id: 'stuck-1' }]; } };
      return { ok: true, status: 204, headers: new Map([['content-range', '*/0']]), async text() { return ''; } };
    };
    const out = await markStaleJobs('https://db.test', 'key');
    assert.equal(out.swept, 0);
    assert.equal(out.complete, false);
    assert.ok(calls.filter((c) => c.method === 'PATCH').length <= 3, 'one no-op PATCH per step, then stop');
    assert.ok(warns.some((w) => /wrote 0/.test(w)), `expected a no-progress warning, got ${JSON.stringify(warns)}`);
  } finally { console.warn = origWarn; }
});

test('a statement timeout on one step is reported and does not abort the others', async () => {
  const errors = [];
  const origError = console.error;
  console.error = (...a) => errors.push(a.join(' '));
  try {
    const { calls } = installFetch({
      backlog: ONE_EACH,
      failOn: 'availability_status=eq.stale&expires_at=gt.',
      failStatus: 500,
      failBody: '{"code":"57014","message":"canceling statement due to statement timeout"}',
    });
    const out = await markStaleJobs('https://db.test', 'key');
    assert.ok(errors.some((e) => /stale-backfill failed: 500.*57014/.test(e)), `expected the timeout logged, got ${JSON.stringify(errors)}`);
    assert.ok(patches(calls).some((c) => c.step === 'expired'), 'the expire step still runs');
    assert.equal(out.complete, false);
  } finally { console.error = origError; }
});

test('a step with nothing to do costs one select and no writes', async () => {
  const { calls } = installFetch({ backlog: {} });
  const out = await markStaleJobs('https://db.test', 'key');
  assert.equal(patches(calls).length, 0);
  assert.equal(calls.filter((c) => c.method === 'GET').length, 3, 'one probe per step');
  assert.equal(out.swept, 0);
  assert.equal(out.complete, true, 'nothing to sweep is a complete sweep');
});

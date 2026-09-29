// The stale-job protocol driver: loops public.sweep_stale_jobs until the backlog is drained, the
// budget runs out, or the database refuses. Offline — fetch is injected.
//
// The regression these guard: every earlier stale path failed SILENTLY against prod's 8s
// statement_timeout (an unchecked unbounded DELETE, an unbounded admin PATCH that "succeeded" with
// nothing written), which let 95,505 stale rows — 67% of `jobs` — pile up by 2026-09-29.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runStaleSweep } from './staleSweep.js';

// Fake database: `backlog` rows remain; each call deletes up to p_batch. A call larger than
// `timeoutAbove` is cancelled with Postgres' statement-timeout error, like prod.
function fakeDb({ backlog = 0, timeoutAbove = Infinity, failWith = null, staled = 0 } = {}) {
  const calls = [];
  let left = backlog;
  let toStale = staled;
  const fetchImpl = async (url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push({ url, body, headers: opts.headers });
    if (failWith) return { ok: false, status: failWith.status, async text() { return failWith.text; } };
    if (body.p_batch > timeoutAbove) {
      return { ok: false, status: 500, async text() { return '{"code":"57014","message":"canceling statement due to statement timeout"}'; } };
    }
    const s = Math.min(toStale, Math.min(body.p_batch, 500)); toStale -= s;
    const d = Math.min(left, body.p_batch); left -= d;
    return { ok: true, status: 200, async json() {
      return { mode: body.p_mode, batch: body.p_batch, staled: s, deleted: d, retained: 0, more: d >= body.p_batch || s >= Math.min(body.p_batch, 500) };
    } };
  };
  return { fetchImpl, calls, left: () => left };
}

test('drains the whole backlog through the RPC and reports it', async () => {
  const db = fakeDb({ backlog: 3500 });
  const out = await runStaleSweep({ url: 'https://db.test', key: 'k', mode: 'all', batch: 1000, fetchImpl: db.fetchImpl });
  assert.equal(out.ok, true);
  assert.equal(out.complete, true);
  assert.equal(out.deleted, 3500);
  assert.equal(db.left(), 0);
  assert.equal(out.calls, 4, '1000+1000+1000+500 — stops once a call reports more:false');
  assert.equal(db.calls[0].url, 'https://db.test/rest/v1/rpc/sweep_stale_jobs');
  assert.deepEqual(db.calls[0].body, { p_mode: 'all', p_batch: 1000 });
  assert.equal(db.calls[0].headers.Authorization, 'Bearer k');
});

test('a clean corpus costs exactly one call', async () => {
  const db = fakeDb({ backlog: 0 });
  const out = await runStaleSweep({ url: 'https://db.test', key: 'k', fetchImpl: db.fetchImpl });
  assert.equal(out.calls, 1);
  assert.equal(out.complete, true);
  assert.equal(out.mode, 'scheduled', 'the default mode is the age-based lifecycle, not delete-everything');
});

test('a statement timeout halves the batch instead of failing the sweep', async () => {
  const db = fakeDb({ backlog: 900, timeoutAbove: 300 });
  const out = await runStaleSweep({ url: 'https://db.test', key: 'k', batch: 1000, minBatch: 100, fetchImpl: db.fetchImpl });
  assert.equal(out.ok, true);
  assert.equal(out.complete, true);
  assert.equal(out.deleted, 900);
  assert.equal(out.batch, 250, '1000 → 500 → 250, then it fits');
});

test('a timeout at the minimum batch is reported, never swallowed', async () => {
  const db = fakeDb({ backlog: 900, timeoutAbove: 50 });
  const out = await runStaleSweep({ url: 'https://db.test', key: 'k', batch: 400, minBatch: 100, fetchImpl: db.fetchImpl });
  assert.equal(out.ok, false);
  assert.match(out.error, /57014/);
  assert.equal(out.complete, false);
});

test('any other database error is reported with its status', async () => {
  const db = fakeDb({ failWith: { status: 404, text: 'Could not find the function public.sweep_stale_jobs' } });
  const out = await runStaleSweep({ url: 'https://db.test', key: 'k', fetchImpl: db.fetchImpl });
  assert.equal(out.ok, false);
  assert.match(out.error, /HTTP 404: Could not find the function/);
  assert.equal(out.calls, 1, 'a non-timeout error is not retried');
});

test('stops at the deadline and says the backlog is not finished', async () => {
  const db = fakeDb({ backlog: 1_000_000 });
  const out = await runStaleSweep({ url: 'https://db.test', key: 'k', batch: 1000, deadline: Date.now() - 1, fetchImpl: db.fetchImpl });
  assert.equal(out.calls, 0);
  assert.equal(out.complete, false, 'an unfinished sweep never claims to be complete');
});

test('keeps looping while only the stale-marking step has more work', async () => {
  const db = fakeDb({ backlog: 0, staled: 1200 });
  const out = await runStaleSweep({ url: 'https://db.test', key: 'k', batch: 1000, fetchImpl: db.fetchImpl });
  assert.equal(out.staled, 1200);
  assert.equal(out.complete, true);
});

test('a thrown fetch becomes ok:false, not an exception', async () => {
  const out = await runStaleSweep({ url: 'https://db.test', key: 'k', fetchImpl: async () => { throw new Error('fetch failed'); } });
  assert.equal(out.ok, false);
  assert.equal(out.error, 'fetch failed');
});

test('missing credentials fail fast without a request', async () => {
  let called = false;
  const out = await runStaleSweep({ url: '', key: '', fetchImpl: async () => { called = true; } });
  assert.equal(out.ok, false);
  assert.equal(called, false);
});

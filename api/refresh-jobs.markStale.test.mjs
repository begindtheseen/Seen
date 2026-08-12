// markStaleJobs must HIDE stale listings, not just relabel them.
//
// User search gates on `expires_at > now()`, never on availability_status. The old sweep set only
// the status, so 12,899 rows sat 'stale' with a future expires_at and stayed in results — the admin
// stale counts read correctly while clearing them changed nothing a user could see.

import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-service-key';

const { markStaleJobs } = await import('./refresh-jobs.js');

function installFetch({ failOn = null } = {}) {
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    calls.push({ url: u, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null, at: calls.length });
    if (failOn && u.includes(failOn)) {
      return { ok: false, status: 400, async text() { return 'violates check constraint'; } };
    }
    return { ok: true, status: 204, async text() { return ''; } };
  };
  return calls;
}

const patches = (calls) => calls.filter((c) => c.method === 'PATCH');

test('every stale transition also expires the row so it leaves the search', async () => {
  const calls = installFetch();
  await markStaleJobs('https://db.test', 'key');
  const p = patches(calls);
  assert.ok(p.length >= 3, `expected 3 sweep steps, got ${p.length}`);
  for (const c of p) {
    assert.ok(c.body.expires_at, `${c.url} must set expires_at`);
    assert.ok(new Date(c.body.expires_at).getTime() <= Date.now() + 1000, 'expires_at is now or past');
  }
});

test('the 7-day step marks stale AND hides', async () => {
  const calls = installFetch();
  await markStaleJobs('https://db.test', 'key');
  const step = patches(calls).find((c) => c.url.includes('availability_status=eq.active') && c.url.includes('last_seen_at=lt.'));
  assert.ok(step, 'has an active→stale step');
  assert.equal(step.body.availability_status, 'stale');
  assert.ok(step.body.expires_at);
});

test('already-stale rows with a future expires_at are repaired', async () => {
  // Without this the 12,899 existing rows are unreachable: the 7-day step only matches `active`.
  const calls = installFetch();
  await markStaleJobs('https://db.test', 'key');
  const backfill = patches(calls).find((c) => c.url.includes('availability_status=eq.stale') && c.url.includes('expires_at=gt.'));
  assert.ok(backfill, 'has a backfill step for rows already marked stale');
  assert.ok(backfill.body.expires_at);
});

test('employer-posted listings are never swept', async () => {
  const calls = installFetch();
  await markStaleJobs('https://db.test', 'key');
  for (const c of patches(calls)) {
    assert.ok(c.url.includes('is_employer_posted=eq.false'), `${c.url} must exclude employer listings`);
  }
});

test('steps run sequentially, not raced', async () => {
  // The 14-day query matches in.(active,stale) while the 7-day query flips active→stale; run
  // together they race on the same rows.
  const calls = installFetch();
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
    const calls = installFetch({ failOn: 'availability_status=eq.active' });
    await markStaleJobs('https://db.test', 'key');
    assert.ok(errors.some((e) => /markStaleJobs stale failed: 400/.test(e)), `expected a logged failure, got ${JSON.stringify(errors)}`);
    assert.ok(patches(calls).length >= 3, 'one failed step does not abort the rest');
  } finally { console.error = origError; }
});

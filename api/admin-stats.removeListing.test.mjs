// Contract tests for the `remove_listing` admin action.
//
// `delete_listing` was fixed and test-locked; `remove_listing` is a SEPARATE action that was
// missed and kept writing availability_status:'removed'. jobs_availability_status_check allows
// only active/stale/expired/unknown, so every one of those PATCHes was rejected with a 400 — and
// because the handler's `db` is a bare fetch that does not throw on 4xx and the result was
// discarded, it went on to write an audit-log row and return ok:true for a removal that never
// happened. The admin UI reported success; the listing stayed live.

import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-service-key';

const { default: handler } = await import('./admin-stats.js');

const UUID = 'a1b2c3d4-e5f6-4a7b-8c9d-0123456789ab';

function mockResponse(body, { ok = true, status = 200 } = {}) {
  return {
    ok, status,
    async json() { return body; },
    async text() { return typeof body === 'string' ? body : JSON.stringify(body); },
    headers: { get() { return null; } },
  };
}

// `jobPatch` lets a test simulate the database REJECTING the write, which is what actually
// happened in production before this fix.
function installFetch(role, { jobPatch = null } = {}) {
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    const method = opts.method || 'GET';
    calls.push({ url: u, method, body: opts.body });
    if (u.includes('/admin_sessions?token=eq')) {
      return mockResponse([{ expires_at: new Date(Date.now() + 3600e3).toISOString(), role, admin_id: 'admin-1' }]);
    }
    if (jobPatch && u.includes('/jobs?id=eq') && method === 'PATCH') return jobPatch;
    return mockResponse(null, { ok: true, status: 204 });
  };
  return calls;
}

function makeRes() {
  const r = { statusCode: 200, jsonBody: null, headers: {} };
  r.setHeader = () => {};
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (o) => { r.jsonBody = o; return r; };
  r.end = () => r;
  return r;
}

async function callRemove({ role = 'super_admin', job_id = UUID, jobPatch = null, omitJobId = false } = {}) {
  const calls = installFetch(role, { jobPatch });
  const body = omitJobId ? { action: 'remove_listing' } : { action: 'remove_listing', job_id };
  const req = { method: 'POST', headers: { 'x-admin-token': 'tok', origin: '' }, body };
  const res = makeRes();
  await handler(req, res);
  return { res, calls };
}

test('remove_listing writes a CHECK-valid status, never the rejected "removed"', async () => {
  const { res, calls } = await callRemove();
  assert.equal(res.statusCode, 200);
  assert.equal(res.jsonBody.ok, true);

  const patch = calls.find((c) => c.url.includes('/jobs?id=eq') && c.method === 'PATCH');
  assert.ok(patch, 'issues a jobs PATCH');
  assert.doesNotMatch(patch.body, /"removed"/, 'must never write the constraint-violating "removed"');
  assert.match(patch.body, /"availability_status":"expired"/);
});

test('remove_listing expires the row so it actually leaves the search', async () => {
  // Search gates on expires_at > now(), NOT availability_status — without this the listing
  // would be relabelled and still shown, which is the state 12,899 'stale' rows are in.
  const { calls } = await callRemove();
  const patch = JSON.parse(calls.find((c) => c.url.includes('/jobs?id=eq') && c.method === 'PATCH').body);
  assert.ok(patch.expires_at, 'sets expires_at');
  assert.ok(new Date(patch.expires_at).getTime() <= Date.now() + 1000, 'expires_at is now or past');
  assert.ok(patch.last_checked_at, 'records when it was checked');
});

test('remove_listing reports failure instead of claiming success', async () => {
  // The core regression: a rejected PATCH used to be swallowed and still return ok:true.
  const rejected = mockResponse('{"code":"23514","message":"violates check constraint"}', { ok: false, status: 400 });
  const { res, calls } = await callRemove({ jobPatch: rejected });
  assert.equal(res.statusCode, 502);
  assert.equal(res.jsonBody.ok, undefined);
  assert.match(String(res.jsonBody.error), /Could not remove listing/);
  assert.equal(calls.some((c) => c.url.includes('/admin_audit_log')), false,
    'must NOT audit-log a removal that the database refused');
});

test('remove_listing audit-logs only on success', async () => {
  const { calls } = await callRemove();
  const audit = calls.find((c) => c.url.includes('/admin_audit_log') && c.method === 'POST');
  assert.ok(audit, 'writes an audit-log row when the write succeeded');
  assert.match(audit.body, /"action":"remove_listing"/);
});

test('remove_listing still enforces role and argument gating', async () => {
  const denied = await callRemove({ role: 'moderator' });
  assert.equal(denied.res.statusCode, 403);
  assert.equal(denied.calls.some((c) => c.url.includes('/jobs?id=eq') && c.method === 'PATCH'), false);

  const missing = await callRemove({ omitJobId: true });
  assert.equal(missing.res.statusCode, 400);
});

// Contract tests for the `delete_listing` admin action (reported-listings investigation).
// The handler is exercised end-to-end with a mocked Supabase REST layer so the real
// frontend→API→DB contract is asserted: auth/role gating, the jobs soft-delete PATCH, and
// the availability-reports DELETE (which clears the queue without hitting the status CHECK).

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
    async text() { return JSON.stringify(body); },
    headers: { get() { return null; } },
  };
}

// Installs a fetch mock that records every DB call and returns canned rows. `role` sets the
// role on the verified admin session.
function installFetch(role) {
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    const method = opts.method || 'GET';
    calls.push({ url: u, method, body: opts.body });
    if (u.includes('/admin_sessions?token=eq')) {
      return mockResponse([{ expires_at: new Date(Date.now() + 3600e3).toISOString(), role, admin_id: 'admin-1' }]);
    }
    // The ephemeral-delete path reads the report's client snapshot to recover the apply_url it
    // suppresses. Return a snapshot row for that specific GET.
    if (u.includes('/job_availability_reports?job_id=eq') && u.includes('select=apply_url') && method === 'GET') {
      return mockResponse([{ apply_url: 'https://example.com/job/123', title: 'Warehouse Associate', company: 'Aerotek' }]);
    }
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

async function callDelete({ role = 'super_admin', job_id = UUID, token = 'tok', omitJobId = false } = {}) {
  const calls = installFetch(role);
  const body = omitJobId ? { action: 'delete_listing' } : { action: 'delete_listing', job_id };
  const req = { method: 'POST', headers: { 'x-admin-token': token, origin: '' }, body };
  const res = makeRes();
  await handler(req, res);
  return { res, calls };
}

test('delete_listing soft-deletes the job and clears its reports', async () => {
  const { res, calls } = await callDelete({ job_id: UUID });
  assert.equal(res.statusCode, 200);
  assert.equal(res.jsonBody.ok, true);
  assert.equal(res.jsonBody.soft_deleted, true);

  const jobPatch = calls.find(c => c.url.includes('/jobs?id=eq') && c.method === 'PATCH');
  assert.ok(jobPatch, 'issues a jobs PATCH');
  // Must EXPIRE the listing: 'expired' is the only CHECK-valid status ('removed' would 400),
  // and setting expires_at=now() is what actually drops it from the user search (which gates
  // on expires_at>now, not availability_status).
  assert.match(jobPatch.body, /"availability_status":"expired"/, 'uses a CHECK-valid status, not the invalid "removed"');
  assert.doesNotMatch(jobPatch.body, /"removed"/, 'never writes the constraint-violating "removed"');
  const patched = JSON.parse(jobPatch.body);
  assert.ok(patched.expires_at, 'sets expires_at so the listing actually leaves the search');
  assert.ok(new Date(patched.expires_at).getTime() <= Date.now() + 1000, 'expires_at is now/past → excluded by expires_at>now filter');

  const reportDelete = calls.find(c => c.url.includes('/job_availability_reports?job_id=eq') && c.method === 'DELETE');
  assert.ok(reportDelete, 'deletes the availability reports');

  const audit = calls.find(c => c.url.includes('/admin_audit_log') && c.method === 'POST');
  assert.ok(audit, 'writes an audit-log row');
  assert.match(audit.body, /"action":"delete_listing"/);
});

test('delete_listing on an ephemeral (non-uuid) id suppresses by apply_url and clears reports, no job PATCH', async () => {
  const { res, calls } = await callDelete({ job_id: 'j_1no2squ' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.jsonBody.soft_deleted, false);
  // No jobs-table PATCH (ephemeral id would 400 on uuid parse).
  assert.equal(calls.some(c => c.url.includes('/jobs?id=eq') && c.method === 'PATCH'), false);
  // It suppresses the listing by the apply_url recovered from the report snapshot, so a
  // re-search can't resurface it.
  const suppress = calls.find(c => c.url.includes('/suppressed_listings') && c.method === 'POST');
  assert.ok(suppress, 'inserts a suppressed_listings row');
  assert.match(suppress.body, /https:\/\/example\.com\/job\/123/);
  assert.equal(res.jsonBody.suppressed, true);
  // And clears the availability reports so the queue empties.
  assert.ok(calls.find(c => c.url.includes('/job_availability_reports?job_id=eq') && c.method === 'DELETE'));
});

test('delete_listing is forbidden for moderators', async () => {
  const { res } = await callDelete({ role: 'moderator' });
  assert.equal(res.statusCode, 403);
});

test('delete_listing requires a job_id', async () => {
  const { res } = await callDelete({ omitJobId: true });
  assert.equal(res.statusCode, 400);
});

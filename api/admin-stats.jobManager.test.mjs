// Run: node --test api/admin-stats.jobManager.test.mjs
// The job manager actions (jobs_browse / job_detail / job_update / job_restore) against a fake PostgREST.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
const { default: handler } = await import('./admin-stats.js');

const ID = '3f2c1a9e-1b2c-4d5e-8f90-123456789abc';
const res = (status, body, headers = {}) => ({ ok: status < 400, status, async json() { return body; }, async text() { return JSON.stringify(body); }, headers: { get: (k) => headers[String(k).toLowerCase()] ?? null } });
const session = (role = 'super_admin') => [{ expires_at: new Date(Date.now() + 3600e3).toISOString(), role, admin_id: 1 }];

function fakeDb({ role, rows = {} } = {}) {
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    const u = new URL(String(url)); const table = u.pathname.split('/').pop(); const method = opts.method || 'GET';
    calls.push({ table, method, search: decodeURIComponent(u.search), body: opts.body ? JSON.parse(opts.body) : null, prefer: opts.headers?.Prefer });
    if (table === 'admin_sessions') return res(200, session(role));
    if (table === 'jobs' && method === 'GET') return res(200, rows.jobs ?? [], { 'content-range': `0-0/${rows.total ?? 1}` });
    if (table === 'jobs' && method === 'PATCH') return res(200, [{ id: ID, ...JSON.parse(opts.body) }]);
    if (['saved_jobs', 'applications', 'seen_applications', 'job_availability_reports'].includes(table)) return res(200, [], { 'content-range': `*/${table === 'saved_jobs' ? 2 : 0}` });
    if (table === 'suppressed_listings' && method === 'GET') return res(200, [{ reason: 'admin_removed', created_at: '2026-10-20T00:00:00Z' }]);
    if (table === 'suppressed_listings' && method === 'DELETE') return res(200, [{ apply_url: 'https://x.example/1' }]);
    return res(200, []);
  };
  return calls;
}
async function call(body) {
  const out = {};
  const r = { status(c) { out.code = c; return this; }, json(p) { out.payload = p; return this; }, setHeader() { return this; }, end() { return this; } };
  await handler({ method: 'POST', headers: { 'x-admin-token': 'tok' }, body, query: {} }, r);
  return out;
}

test('jobs_browse: one keyset page with the exact total and the next cursor', async () => {
  const jobs = Array.from({ length: 50 }, (_, i) => ({ id: ID, title: `Job ${i}`, created_at: '2026-10-21T07:00:00.123456+00:00' }));
  const calls = fakeDb({ rows: { jobs, total: 79985 } });
  const out = await call({ action: 'jobs_browse', filters: { q: 'welder', since: '24h' } });
  assert.equal(out.code, 200);
  assert.equal(out.payload.total, 79985);
  assert.equal(out.payload.jobs.length, 50);
  assert.deepEqual(out.payload.next, { at: '2026-10-21T07:00:00.123456+00:00', id: ID });
  const read = calls.find((c) => c.table === 'jobs');
  assert.equal(read.prefer, 'count=exact');
  assert.match(read.search, /title\.ilike\."\*welder\*"/);
});

test('job_detail: the full row, who holds it, its history and suppression', async () => {
  fakeDb({ rows: { jobs: [{ id: ID, title: 'Welder', apply_url: 'https://x.example/1', expires_at: new Date(Date.now() + 864e5).toISOString() }] } });
  const out = await call({ action: 'job_detail', job_id: ID });
  assert.equal(out.code, 200);
  assert.equal(out.payload.job.title, 'Welder');
  assert.equal(out.payload.on_site, true);
  assert.deepEqual(out.payload.holders.map((h) => [h.table, h.count]), [['saved_jobs', 2], ['applications', 0], ['seen_applications', 0], ['job_availability_reports', 0]]);
  assert.equal(out.payload.suppressed.reason, 'admin_removed');
  assert.equal((await call({ action: 'job_detail', job_id: 'j_123' })).code, 400);
});

test('job_update: validated fields only, prior values audited, moderators refused', async () => {
  const calls = fakeDb({ rows: { jobs: [{ title: 'Weldr', salary_min: null }] } });
  const out = await call({ action: 'job_update', job_id: ID, patch: { title: 'Welder', salary_min: 52000 } });
  assert.equal(out.code, 200);
  assert.deepEqual(out.payload.changed, ['title', 'salary_min']);
  const patch = calls.find((c) => c.table === 'jobs' && c.method === 'PATCH');
  assert.equal(patch.body.title, 'Welder');
  assert.ok(patch.body.edited_at);
  const audit = calls.find((c) => c.table === 'admin_audit_log');
  assert.deepEqual(audit.body.metadata, { prior: { title: 'Weldr', salary_min: null }, patch: { title: 'Welder', salary_min: 52000 } });
  const bad = await call({ action: 'job_update', job_id: ID, patch: { is_employer_posted: true } });
  assert.equal(bad.code, 400);
  fakeDb({ role: 'moderator' });
  assert.equal((await call({ action: 'job_update', job_id: ID, patch: { title: 'X' } })).code, 403);
});

test('job_restore: active for 14 days, apply link un-suppressed, audited', async () => {
  const calls = fakeDb({ rows: { jobs: [{ availability_status: 'expired', expires_at: '2026-10-20T00:00:00Z', apply_url: 'https://x.example/1' }] } });
  const out = await call({ action: 'job_restore', job_id: ID });
  assert.equal(out.code, 200);
  const patch = calls.find((c) => c.table === 'jobs' && c.method === 'PATCH');
  assert.equal(patch.body.availability_status, 'active');
  assert.ok(calls.some((c) => c.table === 'suppressed_listings' && c.method === 'DELETE'));
  const audit = calls.find((c) => c.table === 'admin_audit_log');
  assert.equal(audit.body.metadata.prior.availability_status, 'expired');
});

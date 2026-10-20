// Contract for the admin "Clear stale" action (purge_stale_jobs): it must tell the client how many
// clearable stale rows are LEFT (same definition the dashboard alert counts), so the client can loop
// until they're gone instead of claiming "cleared" while 14,700 rows remain (prod 2026-10-17).

import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-service-key';

const { default: handler } = await import('./admin-stats.js');
const { STALE_CLEARABLE_FILTER, STALE_KEPT_FILTER } = await import('../lib/server/staleSweep.js');

function mockResponse(body, { ok = true, status = 200, range = null } = {}) {
  return {
    ok, status,
    async json() { return body; },
    async text() { return JSON.stringify(body); },
    headers: { get(h) { return h.toLowerCase() === 'content-range' ? range : null; } },
  };
}

function makeRes() {
  const r = { statusCode: 200, jsonBody: null };
  r.setHeader = () => {};
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (o) => { r.jsonBody = o; return r; };
  r.end = () => r;
  return r;
}

async function callPurge({ role = 'super_admin', sweepResults }) {
  const calls = [];
  let i = 0;
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    calls.push({ url: u, method: opts.method || 'GET', body: opts.body });
    if (u.includes('/admin_sessions?token=eq')) {
      return mockResponse([{ expires_at: new Date(Date.now() + 3600e3).toISOString(), role, admin_id: 'admin-1' }]);
    }
    if (u.includes('/rpc/sweep_stale_jobs')) return mockResponse(sweepResults[Math.min(i++, sweepResults.length - 1)]);
    if (u.includes(`/jobs?${STALE_CLEARABLE_FILTER}`)) return mockResponse([], { range: '0-0/10700' });
    if (u.includes(`/jobs?${STALE_KEPT_FILTER}`)) return mockResponse([], { range: '0-0/2' });
    return mockResponse(null, { status: 204 });
  };
  const res = makeRes();
  await handler({ method: 'POST', headers: { 'x-admin-token': 'tok', origin: '' }, body: { action: 'purge_stale_jobs' } }, res);
  return { res, calls };
}

test('purge_stale_jobs runs mode "all" and returns remaining + kept counts with the dashboard definition', async () => {
  const { res, calls } = await callPurge({ sweepResults: [{ staled: 0, deleted: 1000, retained: 0, more: true }, { staled: 0, deleted: 0, retained: 0, more: false }] });
  assert.equal(res.statusCode, 200);
  const sweep = calls.find((c) => c.url.includes('/rpc/sweep_stale_jobs'));
  assert.equal(JSON.parse(sweep.body).p_mode, 'all');
  assert.equal(res.jsonBody.ok, true);
  assert.equal(res.jsonBody.remaining, 10700);
  assert.equal(res.jsonBody.kept, 2);
  assert.equal(res.jsonBody.deleted, 1000);
});

test('the clearable definition excludes employer-posted rows and kept expired rows', () => {
  assert.match(STALE_CLEARABLE_FILTER, /availability_status=eq\.stale/);
  assert.match(STALE_CLEARABLE_FILTER, /is_employer_posted=eq\.false/);
  assert.match(STALE_KEPT_FILTER, /availability_status=eq\.expired/);
  assert.match(STALE_KEPT_FILTER, /is_employer_posted=eq\.false/);
});

test('moderators cannot purge', async () => {
  const { res, calls } = await callPurge({ role: 'moderator', sweepResults: [{ deleted: 0, more: false }] });
  assert.equal(res.statusCode, 403);
  assert.ok(!calls.some((c) => c.url.includes('/rpc/sweep_stale_jobs')));
});

// The per-click budget must fit inside the function limit with one worst-case batch (8s
// statement_timeout) and the post-sweep counts/audit to spare — the 15s-limit / 6s+8s budget that
// timed out in prod on 2026-10-19 fails this test.
test('purge budget + one worst-case batch + overhead fits inside the admin-stats maxDuration', async () => {
  const { readFileSync } = await import('node:fs');
  const { PURGE_BUDGET_MS, PURGE_BATCH } = await import('./admin-stats.js');
  const max = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')).functions['api/admin-stats.js'].maxDuration;
  assert.ok(PURGE_BUDGET_MS + 8_000 + 4_000 <= max * 1000, `${PURGE_BUDGET_MS}ms budget + 12s does not fit in ${max}s`);
  assert.ok(PURGE_BATCH <= 500, 'one batch must stay well under the 8s statement_timeout');
});

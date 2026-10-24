import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchAdminJobsCounts, fallbackPaths, FIELDS, RPC_NAME } from './adminJobsCounts.js';

const base = { supabaseUrl: 'https://x.supabase.co', serviceKey: 'k', todayISO: '2026-10-24T07:00:00.000Z', overdueISO: '2026-10-09T01:00:00.000Z' };

test('one RPC call answers all seven counts (no fallback requests)', async () => {
  const calls = []; const dbCalls = [];
  const fetchImpl = async (url, init) => { calls.push([url, init.method, JSON.parse(init.body)]); return new Response(JSON.stringify({ total: 83035, active: 81964, added_today: 1200, stale_or_expired: 1071, stale_clearable: 1000, expired_kept: 71, stale_overdue: 3 }), { status: 200 }); };
  const out = await fetchAdminJobsCounts({ ...base, fetchImpl, db: async (p) => { dbCalls.push(p); return new Response(null, { status: 200 }); } });
  assert.equal(out.source, 'rpc');
  assert.deepEqual([out.total, out.active, out.added_today, out.stale_or_expired, out.stale_clearable, out.expired_kept, out.stale_overdue], [83035, 81964, 1200, 1071, 1000, 71, 3]);
  assert.equal(calls.length, 1);
  assert.match(calls[0][0], new RegExp(`/rest/v1/rpc/${RPC_NAME}$`));
  assert.deepEqual(calls[0][2], { p_today: base.todayISO, p_overdue: base.overdueISO });
  assert.equal(dbCalls.length, 0, 'the exact counts must not run when the RPC answered');
});

test('before the migration (404) the seven exact HEAD counts run, same filters as the old dashboard', async () => {
  const dbCalls = [];
  const counts = { total: 83035, active: 81964, added_today: 10, stale_or_expired: 5, stale_clearable: 4, expired_kept: 1, stale_overdue: 0 };
  const paths = fallbackPaths(base);
  const db = async (p, opts) => {
    dbCalls.push([p, opts.method, opts.headers.Prefer]);
    const k = Object.keys(paths).find((key) => paths[key] === p);
    return new Response(null, { status: 206, headers: { 'content-range': `0-0/${counts[k]}` } });
  };
  const out = await fetchAdminJobsCounts({ ...base, fetchImpl: async () => new Response('{"message":"not found"}', { status: 404 }), db });
  assert.equal(out.source, 'exact');
  for (const k of FIELDS) assert.equal(out[k], counts[k], k);
  assert.equal(dbCalls.length, 7);
  assert.ok(dbCalls.every(([, m, prefer]) => m === 'HEAD' && prefer === 'count=exact'));
  assert.ok(paths.stale_clearable.includes('availability_status=eq.stale&is_employer_posted=eq.false'));
  assert.ok(paths.stale_overdue.includes(`last_seen_at=lt.${encodeURIComponent(base.overdueISO)}`));
});

test('a malformed RPC answer (missing field) is not trusted — falls back; a failed fallback read is null, never 0', async () => {
  const db = async (p) => (p.startsWith('jobs?select=id') ? new Response(null, { status: 206, headers: { 'content-range': '0-0/42' } }) : new Response(null, { status: 500 }));
  const out = await fetchAdminJobsCounts({ ...base, fetchImpl: async () => new Response(JSON.stringify({ total: 1 }), { status: 200 }), db });
  assert.equal(out.source, 'exact');
  assert.equal(out.total, 42);
  assert.equal(out.active, null);
});

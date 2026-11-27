// GET /api/job-index builds a shard ONLY from the slim search table (job_search): production 2026-11-26 showed that
// building shards from jobs saturates the database. Run: node --test api/job-index.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://db.example';
process.env.SUPABASE_SERVICE_KEY = 'service-key';
const { default: handler } = await import('./job-index.js');
const { indexToken } = await import('../lib/server/jobIndex/index.js');
const { _setSearchTableForTest } = await import('../lib/server/searchTable.js');
const { FORMAT } = await import('../lib/server/jobIndex/shard.js');

let mirror = [];
const paths = [];
globalThis.fetch = async (url) => {
  const u = new URL(String(url));
  paths.push(u.pathname);
  const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (u.pathname === '/rest/v1/job_search') return json(u.searchParams.get('limit') === '1' && u.searchParams.get('select') === 'id' ? mirror.slice(0, 1) : mirror);
  if (u.pathname === '/rest/v1/jobs') return json([{ id: '00000000-0000-0000-0000-000000000001', title: 'from jobs' }]);
  return json([]);
};
const call = () => new Promise((resolve) => {
  const res = { code: 200, h: {}, setHeader(k, v) { this.h[k] = v; }, status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b, h: this.h }); return this; }, end() { resolve({ code: this.code }); return this; } };
  handler({ method: 'GET', query: { shard: '0', v: String(FORMAT), k: indexToken() }, headers: {} }, res);
});

test('no slim table → 503, and jobs is never read', async () => {
  mirror = []; _setSearchTableForTest(null); paths.length = 0;
  const r = await call();
  assert.equal(r.code, 503);
  assert.equal(r.body.error, 'search_table_missing');
  assert.equal(r.h['Cache-Control'], 'no-store');
  assert.ok(!paths.includes('/rest/v1/jobs'), paths.join(' '));
});

test('with the slim table → the shard is built from job_search and cached at the edge', async () => {
  mirror = [{ id: '00000000-0000-0000-0000-000000000002', title: 'from job_search', expires_at: '2030-01-01T00:00:00+00:00' }];
  _setSearchTableForTest(null); paths.length = 0;
  const r = await call();
  assert.equal(r.code, 200);
  assert.ok(paths.filter((p) => p === '/rest/v1/job_search').length >= 2, paths.join(' '));
  assert.ok(!paths.includes('/rest/v1/jobs'), paths.join(' '));
  assert.match(r.h['Cache-Control'], /s-maxage=900/);
  assert.equal(r.body.rows.length, 1);
});

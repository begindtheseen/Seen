// Which table answers a light listings read: the slim job_search copy once it exists and holds rows, else jobs; a read
// that needs a jobs-only column always stays on jobs. Run: node --test lib/server/searchTable.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ensureSearchTable, routeJobsPath, _setSearchTableForTest } from './searchTable.js';

const reply = (status, body) => async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('probe: rows → job_search; an empty table, a 404 or a network error → jobs', async () => {
  for (const [f, want] of [[reply(200, [{ id: 'x' }]), 'job_search'], [reply(200, []), 'jobs'], [reply(404, { code: 'PGRST205' }), 'jobs'], [async () => { throw new Error('down'); }, 'jobs']]) {
    _setSearchTableForTest(null);
    globalThis.fetch = f;
    assert.equal(await ensureSearchTable('https://db.example', {}), want);
  }
});

test('routing: light reads move, reads of description / * / jobs-only columns stay, nothing moves while it is not live', () => {
  _setSearchTableForTest(true);
  assert.equal(routeJobsPath('jobs?title=ilike.*nurse*&expires_at=gt.2026-11-26&order=score.desc.nullslast,id.asc&limit=200&select=id,title,company').split('?')[0], 'job_search');
  assert.equal(routeJobsPath(`jobs?select=id,title&lat=is.null&or=${encodeURIComponent('(location.ilike.*austin*,location.ilike.*round rock*)')}&id=gte.00000000-0000-0000-0000-000000000000&limit=1000`).split('?')[0], 'job_search');
  assert.equal(routeJobsPath('jobs?id=in.(a,b)&select=id,description'), 'jobs?id=in.(a,b)&select=id,description');
  assert.equal(routeJobsPath('jobs?select=*&limit=1'), 'jobs?select=*&limit=1');
  assert.equal(routeJobsPath('jobs?employer_user_id=not.is.null&select=id'), 'jobs?employer_user_id=not.is.null&select=id');
  assert.equal(routeJobsPath('jobs?availability_status=eq.active&select=id'), 'jobs?availability_status=eq.active&select=id');
  assert.equal(routeJobsPath('profiles?id=eq.1&select=id'), 'profiles?id=eq.1&select=id');
  _setSearchTableForTest(false);
  assert.equal(routeJobsPath('jobs?title=ilike.*nurse*&select=id'), 'jobs?title=ilike.*nurse*&select=id');
  process.env.SEARCH_TABLE = 'off';
  _setSearchTableForTest(true);
  assert.equal(routeJobsPath('jobs?title=ilike.*nurse*&select=id'), 'jobs?title=ilike.*nurse*&select=id');
  delete process.env.SEARCH_TABLE;
  _setSearchTableForTest(null);
});

// search_daily storage against a stubbed PostgREST. Run: node --test lib/server/searchData.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildUpsertPayload, storeSearchRecords, readSearchRows, searchFreshness, pruneSearchRows, isMissingTable } from './searchData.js';

const rec = (over = {}) => ({ date: '2026-10-22', source: 'google', query: 'does amazon ghost', page: 'https://seenjobs.io/company/amazon', clicks: 2, impressions: 40, ctr: 0.05, position: 9.1, ...over });
const res = (status, body = []) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });

test('upsert payload: one row per key (Postgres refuses a batch hitting a key twice), same input → same rows', () => {
  const a = buildUpsertPayload([rec(), rec({ impressions: 41, clicks: 3 }), rec({ page: '' }), rec({ source: 'bing' })], 'T');
  assert.equal(a.length, 3);
  assert.equal(a.find((r) => r.source === 'google' && r.page).impressions, 41, 'the larger provider total wins; never summed');
  assert.deepEqual(buildUpsertPayload([rec(), rec({ page: '' })], 'T'), buildUpsertPayload([rec(), rec({ page: '' })], 'T'), 'idempotent');
  assert.deepEqual(Object.keys(a[0]).sort(), ['clicks', 'ctr', 'date', 'fetched_at', 'impressions', 'page', 'position', 'query', 'source']);
  assert.equal(buildUpsertPayload([{ date: '', source: 'google', query: 'x' }, null]).length, 0);
});

test('store: chunks, on_conflict on the unique key, merge-duplicates', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return res(201); };
  const records = Array.from({ length: 5 }, (_, i) => rec({ query: `q${i}` }));
  const r = await storeSearchRecords({ url: 'https://sb', key: 'k', records, fetchImpl, chunk: 2 });
  assert.deepEqual(r, { ok: true, written: 5, chunks: 3 });
  assert.equal(calls[0].url, 'https://sb/rest/v1/search_daily?on_conflict=date,source,query,page');
  assert.match(calls[0].init.headers.Prefer, /resolution=merge-duplicates/);
  assert.equal(JSON.parse(calls[2].init.body).length, 1);
});

test('missing table (before the migration): store, read, freshness and prune all no-op and say so', async () => {
  const missing = async () => res(404, { code: 'PGRST205', message: "Could not find the table 'public.search_daily' in the schema cache" });
  assert.deepEqual(await storeSearchRecords({ url: 'https://sb', key: 'k', records: [rec()], fetchImpl: missing }), { ok: true, written: 0, chunks: 1, missingTable: true });
  assert.deepEqual(await readSearchRows({ url: 'https://sb', key: 'k', since: '2026-09-01', fetchImpl: missing }), { ok: true, rows: [], missingTable: true });
  assert.equal((await searchFreshness({ url: 'https://sb', key: 'k', fetchImpl: missing })).missingTable, true);
  assert.equal((await pruneSearchRows({ url: 'https://sb', key: 'k', fetchImpl: missing })).missingTable, true);
  assert.equal(await isMissingTable(res(400, { code: '42P01', message: 'relation "public.search_daily" does not exist' })), true);
  assert.equal(await isMissingTable(res(400, { message: 'invalid input syntax' })), false);
});

test('a real write failure is a failure', async () => {
  const r = await storeSearchRecords({ url: 'https://sb', key: 'k', records: [rec()], fetchImpl: async () => res(500) });
  assert.equal(r.ok, false);
});

test('read: keyset pages on id past the 1,000-row cap', async () => {
  const all = Array.from({ length: 2300 }, (_, i) => ({ id: i + 1, ...rec({ query: `q${i}` }) }));
  const seen = [];
  const fetchImpl = async (u) => {
    seen.push(u);
    const after = Number(new URL(u).searchParams.get('id').replace('gt.', ''));
    return res(200, all.filter((r) => r.id > after).slice(0, 1000));
  };
  const r = await readSearchRows({ url: 'https://sb', key: 'k', since: '2026-09-20', filter: 'page=eq.x', fetchImpl });
  assert.equal(r.rows.length, 2300);
  assert.equal(seen.length, 3);
  assert.match(seen[0], /date=gte\.2026-09-20&page=eq\.x&id=gt\.0&order=id\.asc&limit=1000/);
});

test('freshness: newest date per source; prune deletes before the Pacific cutoff', async () => {
  const f = await searchFreshness({ url: 'https://sb', key: 'k', fetchImpl: async (u) => res(200, u.includes('source=eq.google') ? [{ date: '2026-10-22' }] : []) });
  assert.deepEqual(f, { google: '2026-10-22', bing: null });
  let del;
  await pruneSearchRows({ url: 'https://sb', key: 'k', now: new Date('2026-10-24T13:20:00Z'), keepDays: 10, fetchImpl: async (u, init) => { del = { u, m: init.method }; return res(204); } });
  assert.deepEqual(del, { u: 'https://sb/rest/v1/search_daily?date=lt.2026-10-14', m: 'DELETE' });
});

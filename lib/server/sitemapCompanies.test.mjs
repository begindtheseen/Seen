import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchAllCompanyNames } from './sitemapCompanies.js';

function fakeDb(total, cap = 1000) {
  const calls = [];
  const fetchImpl = async (u) => {
    const q = new URL(u).searchParams;
    const limit = Math.min(Number(q.get('limit')), cap);
    const offset = Number(q.get('offset'));
    calls.push(offset);
    const rows = [];
    for (let i = offset; i < Math.min(offset + limit, total); i++) rows.push({ company_name: `Co ${i}` });
    return { ok: true, json: async () => rows };
  };
  return { fetchImpl, calls };
}

test('reads past the 1,000-row server cap', async () => {
  const { fetchImpl, calls } = fakeDb(1736);
  const names = await fetchAllCompanyNames({ url: 'https://db.example', key: 'k', fetchImpl });
  assert.equal(names.length, 1736);
  assert.deepEqual(calls, [0, 1000]);
});

test('an exact multiple of the page size ends on the empty page', async () => {
  const { fetchImpl, calls } = fakeDb(2000);
  const names = await fetchAllCompanyNames({ url: 'https://db.example', key: 'k', fetchImpl });
  assert.equal(names.length, 2000);
  assert.deepEqual(calls, [0, 1000, 2000]);
});

test('a failed page keeps what was read; no credentials reads nothing', async () => {
  let n = 0;
  const fetchImpl = async () => (n++ === 0
    ? { ok: true, json: async () => Array.from({ length: 1000 }, (_, i) => ({ company_name: `C${i}` })) }
    : { ok: false, json: async () => ({}) });
  assert.equal((await fetchAllCompanyNames({ url: 'https://db.example', key: 'k', fetchImpl })).length, 1000);
  assert.deepEqual(await fetchAllCompanyNames({ url: '', key: 'k', fetchImpl }), []);
});

test('blank and duplicate names are dropped', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => [{ company_name: 'Acme' }, { company_name: ' acme ' }, { company_name: '' }, {}] });
  assert.deepEqual(await fetchAllCompanyNames({ url: 'https://db.example', key: 'k', fetchImpl }), ['Acme']);
});

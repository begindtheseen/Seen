// resolveOrCreateCompany (api/_utils/reportWrite.js). Run: node --test api/_utils/reportWrite.resolve.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveOrCreateCompany } from './reportWrite.js';

test('an exact name match wins before the 20-row first-word search, so no duplicate is created', async () => {
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    const u = decodeURIComponent(String(url)); calls.push({ u, method: opts.method || 'GET' });
    if (u.includes('name=ilike.Home Depot&')) return { ok: true, status: 200, async json() { return [{ id: 'hd-1', name: 'Home Depot' }]; } };
    if (u.includes('name=ilike.*Home*')) return { ok: true, status: 200, async json() { return Array.from({ length: 20 }, (_, i) => ({ id: `h${i}`, name: `Home Thing ${i}` })); } };
    throw new Error(`unexpected ${opts.method || 'GET'} ${u}`);
  };
  assert.equal(await resolveOrCreateCompany('https://db', {}, 'Home Depot'), 'hd-1');
  assert.ok(!calls.some((c) => c.method === 'POST'), 'nothing inserted');
});

test('a genuinely new company is inserted asking for the row back, and an empty reply cannot throw', async () => {
  let prefer = null;
  global.fetch = async (url, opts = {}) => {
    if ((opts.method || 'GET') === 'POST') { prefer = opts.headers.Prefer; return { ok: true, status: 201, async json() { throw new SyntaxError('Unexpected end of JSON input'); } }; }
    return { ok: true, status: 200, async json() { return []; } };
  };
  assert.equal(await resolveOrCreateCompany('https://db', { apikey: 'k' }, 'Brand New Co'), null);
  assert.equal(prefer, 'return=representation');
});

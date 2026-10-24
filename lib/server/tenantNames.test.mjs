// Run: node --test lib/server/tenantNames.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadTenantNames, withTenantName, applyTenantNames, resetTenantNamesCache } from './tenantNames.js';

const json = (rows) => ({ ok: true, json: async () => rows });

test('loadTenantNames: pages under the 1,000-row cap, keeps only names that are more than the slug, caches', async () => {
  resetTenantNamesCache();
  const page1 = Array.from({ length: 1000 }, (_, i) => ({ tenant: `t${i}`, company_name: `t${i}` }));
  page1[3] = { tenant: 'plscareers', company_name: 'PLS Financial Services' };
  page1[4] = { tenant: 'stripe', company_name: 'Stripe' };
  page1[5] = { tenant: 'aloyoga', company_name: 'aloyoga' };
  const page2 = [{ tenant: 'tactilemedical', company_name: 'Tactile Medical' }];
  let calls = 0;
  const fetchImpl = async (url) => { calls++; return json(/offset=0/.test(String(url)) ? page1 : page2); };
  const map = await loadTenantNames('https://db', {}, { fetchImpl, now: 1_000 });
  assert.equal(calls, 2);
  assert.equal(map.get('plscareers'), 'PLS Financial Services');
  assert.equal(map.get('stripe'), 'Stripe', 'case alone makes it a name a person chose');
  assert.equal(map.has('aloyoga'), false);
  assert.equal(map.get('tactilemedical'), 'Tactile Medical');
  assert.equal(map.size, 3);
  await loadTenantNames('https://db', {}, { fetchImpl, now: 2_000 });
  assert.equal(calls, 2, 'cached within the TTL');
  // A failed read keeps the last good map.
  const failing = async () => ({ ok: false, json: async () => null });
  const again = await loadTenantNames('https://db', {}, { fetchImpl: failing, now: 1_000 + 11 * 60_000 });
  assert.equal(again.get('plscareers'), 'PLS Financial Services');
});

test('withTenantName: renames a row still stored under its slug; leaves real names and unknown slugs alone', () => {
  const map = new Map([['plscareers', 'PLS Financial Services'], ['lucidmotors', 'Lucid Motors']]);
  assert.deepEqual(withTenantName({ company: 'plscareers', ats_tenant: 'plscareers', title: 'CSR' }, map), { company: 'PLS Financial Services', company_slug: 'plscareers', ats_tenant: 'plscareers', title: 'CSR' });
  assert.equal(withTenantName({ company: 'lucidmotors' }, map).company, 'Lucid Motors', 'the slug alone is a key too (older rows)');
  assert.equal(withTenantName({ company: 'PLS Financial Services', ats_tenant: 'plscareers' }, map).company, 'PLS Financial Services');
  assert.equal(withTenantName({ company: 'Walmart', ats_tenant: null }, map).company, 'Walmart');
  assert.equal(withTenantName({ company: 'karllagerfeld', ats_tenant: 'karllagerfeld' }, map).company, 'karllagerfeld', 'no registry name → unchanged (display reads the slug)');
  assert.deepEqual(applyTenantNames([{ company: 'plscareers' }], new Map()), [{ company: 'plscareers' }]);
  assert.deepEqual(applyTenantNames(null, map), []);
});

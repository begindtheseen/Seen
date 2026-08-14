import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cloudConfigured, fetchNotes, gatewayConfigured, gatewaySelected } from './brainCloud.js';

const KEYS = [
  'BRAIN_API_URL', 'BRAIN_API_TOKEN', 'BRAIN_CLIENT_TOKEN', 'BRAIN_CLIENT',
  'SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'SUPABASE_SERVICE_ROLE_KEY',
];

async function withEnvironment(values, run) {
  const before = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
  const originalFetch = global.fetch;
  for (const key of KEYS) delete process.env[key];
  Object.assign(process.env, values);
  try { await run(); }
  finally {
    for (const key of KEYS) {
      if (before[key] === undefined) delete process.env[key];
      else process.env[key] = before[key];
    }
    global.fetch = originalFetch;
  }
}

test('partial gateway configuration fails closed even when direct service credentials exist', async () => {
  await withEnvironment({
    BRAIN_API_URL: 'https://gateway.example/api/brain', BRAIN_API_TOKEN: 'outer-test',
    SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_KEY: 'service-test',
  }, async () => {
    let calls = 0;
    global.fetch = async () => { calls += 1; throw new Error('must not fetch'); };
    assert.equal(gatewaySelected(), true);
    assert.equal(gatewayConfigured(), false);
    assert.equal(cloudConfigured(), false);
    await assert.rejects(fetchNotes(), /gateway configuration incomplete.*BRAIN_CLIENT_TOKEN.*BRAIN_CLIENT/);
    assert.equal(calls, 0, 'neither gateway nor direct store may run');
  });
});

test('complete gateway configuration uses the gateway transport', async () => {
  await withEnvironment({
    BRAIN_API_URL: 'https://gateway.example/api/brain', BRAIN_API_TOKEN: 'outer-test',
    BRAIN_CLIENT_TOKEN: 'client-test', BRAIN_CLIENT: 'codex',
    SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_KEY: 'service-test',
  }, async () => {
    const calls = [];
    global.fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, notes: [] }) };
    };
    assert.equal(cloudConfigured(), true);
    assert.deepEqual(await fetchNotes(), []);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://gateway.example/api/brain');
    assert.equal(calls[0].init.headers['x-chronos-client-token'], 'client-test');
    assert.deepEqual(JSON.parse(calls[0].init.body), { op: 'notes', by: 'codex' });
  });
});

test('any client identity value selects the gateway and incomplete configuration fails closed', async () => {
  await withEnvironment({
    BRAIN_CLIENT: 'claude-seenjobs',
    SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_KEY: 'service-test',
  }, async () => {
    let calls = 0;
    global.fetch = async () => { calls += 1; throw new Error('must not fetch'); };
    assert.equal(gatewaySelected(), true);
    assert.equal(cloudConfigured(), false);
    await assert.rejects(fetchNotes(), /gateway configuration incomplete.*BRAIN_API_URL.*BRAIN_API_TOKEN.*BRAIN_CLIENT_TOKEN/);
    assert.equal(calls, 0, 'partial identity config cannot fall back to service-role access');
  });
});

test('direct-only configuration remains available to the trusted Mac transport', async () => {
  await withEnvironment({ SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_KEY: 'service-test' }, async () => {
    const urls = [];
    global.fetch = async (url) => {
      urls.push(String(url));
      return { ok: true, status: 200, text: async () => '[]' };
    };
    assert.equal(gatewaySelected(), false);
    assert.equal(cloudConfigured(), true);
    assert.deepEqual(await fetchNotes(), []);
    assert.match(urls[0], /^https:\/\/db\.example\/rest\/v1\/brain_notes/);
  });
});

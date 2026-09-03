import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'test-service-key';

const calls = [];
const response = (body = null) => ({
  ok: true,
  async text() { return body == null ? '' : JSON.stringify(body); },
});

global.fetch = async (url, opts = {}) => {
  const call = { url: String(url), method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null };
  calls.push(call);
  return response();
};

const { putNote } = await import('./brainStore.js');

const noteWith = (facts) => `---
title: test
facts:
${facts.map((f) => `  - id: ${f.id}
    subject: ${f.subject}
    predicate: ${f.predicate}
    object: ${f.object}`).join('\n') || '  []'}
---
`;

test('putNote replaces the canonical note and exact fact mirror through one atomic RPC', async () => {
  calls.length = 0;

  await putNote('knowledge/test.md', noteWith([
    { id: 'keep', subject: 'Seen', predicate: 'state', object: 'healthy' },
    { id: 'added', subject: 'Chronos', predicate: 'state', object: 'healthy' },
  ]));

  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'POST');
  assert.ok(calls[0].url.endsWith('/rpc/brain_replace_note'));
  assert.equal(calls[0].body.p_path, 'knowledge/test.md');
  assert.deepEqual(calls[0].body.p_facts.map((f) => f.id), ['keep', 'added']);
});

test('putNote with no facts sends an empty exact replacement', async () => {
  calls.length = 0;

  await putNote('knowledge/empty.md', `---
title: empty
facts: []
---
`);

  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.endsWith('/rpc/brain_replace_note'));
  assert.deepEqual(calls[0].body.p_facts, []);
});

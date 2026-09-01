import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'test-service-key';

const calls = [];
let oldFacts = [];

const response = (body = null) => ({
  ok: true,
  async text() { return body == null ? '' : JSON.stringify(body); },
});

global.fetch = async (url, opts = {}) => {
  const call = { url: String(url), method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null };
  calls.push(call);
  if (call.url.includes('brain_facts?select=id&note=eq.')) return response(oldFacts);
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

test('putNote upserts current facts before deleting stale mirror rows', async () => {
  calls.length = 0;
  oldFacts = [{ id: 'keep' }, { id: 'removed' }];

  await putNote('knowledge/test.md', noteWith([
    { id: 'keep', subject: 'Seen', predicate: 'state', object: 'healthy' },
    { id: 'added', subject: 'Chronos', predicate: 'state', object: 'healthy' },
  ]));

  const noteWrite = calls.findIndex((c) => c.method === 'POST' && c.url.endsWith('/brain_notes'));
  const factWrite = calls.findIndex((c) => c.method === 'POST' && c.url.includes('/brain_facts?on_conflict=note,id'));
  const staleDelete = calls.findIndex((c) => c.method === 'DELETE' && c.url.includes('id=eq.removed'));

  assert.ok(noteWrite >= 0);
  assert.ok(factWrite > noteWrite, 'current mirror facts land after the canonical note');
  assert.ok(staleDelete > factWrite, 'stale subtraction happens only after current facts are durable');
  assert.equal(calls.some((c) => c.method === 'DELETE' && c.url.includes('id=eq.keep')), false);
  assert.deepEqual(calls[factWrite].body.map((f) => f.id), ['keep', 'added']);
});

test('putNote with no facts deletes every previously mirrored fact', async () => {
  calls.length = 0;
  oldFacts = [{ id: 'old-a' }, { id: 'old-b' }];

  await putNote('knowledge/empty.md', `---
title: empty
facts: []
---
`);

  const deletes = calls.filter((c) => c.method === 'DELETE');
  assert.equal(calls.some((c) => c.method === 'POST' && c.url.includes('/brain_facts?on_conflict=')), false);
  assert.equal(deletes.length, 2);
  assert.ok(deletes.some((c) => c.url.includes('id=eq.old-a')));
  assert.ok(deletes.some((c) => c.url.includes('id=eq.old-b')));
});

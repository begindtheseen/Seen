import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wellFormed } from './lib/batch.mjs';

test('wellFormed: a lone surrogate from a mid-emoji slice becomes U+FFFD, everywhere in the request', () => {
  const cut = '👍 ok'.slice(0, 1); // lone high surrogate
  const req = { custom_id: 'a', params: { messages: [{ role: 'user', content: `job text ${cut}` }], max_tokens: 5 } };
  const out = wellFormed([req]);
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(out)));
  assert.equal(out[0].params.messages[0].content, 'job text �');
  assert.equal(out[0].params.max_tokens, 5);
  assert.equal(wellFormed('👍 fine'), '👍 fine');
});

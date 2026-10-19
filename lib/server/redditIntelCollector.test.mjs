import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyRawRedditExcerpt, flattenRedditRead, unwrapOpenCli } from './redditIntelCollector.js';

test('only first-person hiring statements become applicant reports', () => {
  assert.deepEqual(classifyRawRedditExcerpt('I completed the final round and never heard back.'), { kind: 'applicant_outcome', outcome: 'ghosted', sentiment: 'negative' });
  assert.deepEqual(classifyRawRedditExcerpt('They ghost applicants all the time.'), { kind: 'public_commentary', sentiment: 'mixed' });
});

test('employee experience stays separate from hiring outcomes', () => {
  assert.equal(classifyRawRedditExcerpt('I worked there and my manager was helpful.').kind, 'employee_review');
});

test('read output is flattened and OpenCLI envelopes unwrap', () => {
  assert.deepEqual(flattenRedditRead({ url: 'https://reddit.com/x', text: 'post', replies: [{ text: 'comment' }] }), [{ url: 'https://reddit.com/x', text: 'post' }, { url: 'https://reddit.com/x', text: 'comment' }]);
  assert.deepEqual(unwrapOpenCli({ ok: true, data: [{ id: 'a' }] }), [{ id: 'a' }]);
});

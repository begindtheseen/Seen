import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderBriefingData } from './memory-status.mjs';

test('cloud briefing renderer consumes the bounded server response without raw notes', () => {
  const text = renderBriefingData({
    since: '2026-08-13',
    counts: { notes: 63, currentFacts: 193, openThreads: 2 },
    changed: { added: [{ subject: 'Seen', predicate: 'users_total', object: '9' }], invalidated: [] },
    openThreads: [{ title: 'Finish query surface', priority: 'high', status: 'open' }],
    contradictions: [],
    lowConfidence: [],
  }, '2026-08-14');
  assert.match(text, /63 notes · 193 current facts · 2 open threads/);
  assert.match(text, /Changed since 2026-08-13/);
  assert.match(text, /Seen users_total → 9/);
  assert.match(text, /Finish query surface/);
});

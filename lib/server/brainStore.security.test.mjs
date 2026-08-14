import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertNotePath, isForbiddenLegacySource } from './brainStore.js';

test('note paths are bounded vault-relative identifiers, never prose or traversal', () => {
  assert.equal(assertNotePath('claude-observations.md'), 'claude-observations.md');
  assert.equal(assertNotePath('knowledge/seen'), 'knowledge/seen.md');
  for (const value of ['', '../outside.md', 'knowledge/../../outside.md', 'a sentence with spaces']) {
    assert.throws(() => assertNotePath(value), /brain write rejected/);
  }
});

test('provider and generated Claude session labels are forbidden but role principals remain valid', () => {
  for (const value of ['claude', 'claude-session', 'claude-session-abc', 'claude:cloud-session-abc']) {
    assert.equal(isForbiddenLegacySource(value), true, value);
  }
  assert.equal(isForbiddenLegacySource('claude-brain'), false);
  assert.equal(isForbiddenLegacySource('claude-seenjobs'), false);
});

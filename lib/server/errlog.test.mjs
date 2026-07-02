// errlog contract: returns a short correlation ref, captures stacks, and never throws.
// Run: node --test lib/server/errlog.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { logError } from './errlog.js';

// No SUPABASE_* env here → the DB write is skipped, so these run offline with no network.
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_KEY;
delete process.env.ERRLOG_WEBHOOK_URL;

test('returns an 8-hex correlation ref', () => {
  const ref = logError('unit', 'something broke', { action: 'x' });
  assert.match(ref, /^[0-9a-f]{8}$/);
});

test('accepts an Error and never throws (offline)', () => {
  let ref;
  assert.doesNotThrow(() => { ref = logError('unit', new Error('boom'), { method: 'POST' }); });
  assert.match(ref, /^[0-9a-f]{8}$/);
});

test('distinct calls get distinct refs', () => {
  const a = logError('unit', 'a');
  const b = logError('unit', 'b');
  assert.notEqual(a, b);
});

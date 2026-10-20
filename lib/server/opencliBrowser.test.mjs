// Run: node --test lib/server/opencliBrowser.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOpenCliBrowser } from './opencliBrowser.js';

test('the flag form (OpenCLI 2.x) is used when it works', async () => {
  const calls = [];
  const b = createOpenCliBrowser({ session: 's1', run: async (a) => { calls.push(a); return { ok: 1 }; } });
  await b.open('https://example.com/');
  await b.eval('1+1');
  assert.deepEqual(calls, [['browser', 'open', 'https://example.com/', '--session', 's1'], ['browser', 'eval', '1+1', '--session', 's1']]);
  assert.equal(b.form, 'flag');
});

test('an OpenCLI that wants the session after `browser` (1.8) is retried once in that form and remembered', async () => {
  const calls = [];
  const b = createOpenCliBrowser({ session: 's1', run: async (a) => {
    calls.push(a);
    if (a[1] !== 's1') throw new Error('Command failed: opencli browser open — error: `opencli browser` commands require a <session> positional');
    return { ok: 1 };
  } });
  await b.open('https://example.com/');
  await b.close();
  assert.deepEqual(calls.slice(1), [['browser', 's1', 'open', 'https://example.com/'], ['browser', 's1', 'close']]);
  assert.equal(b.form, 'positional');
});

test('a real failure (not a usage error) is not retried in another form', async () => {
  let n = 0;
  const b = createOpenCliBrowser({ run: async () => { n++; throw new Error('Browser Bridge disconnected'); } });
  await assert.rejects(b.open('https://example.com/'), /disconnected/);
  assert.equal(n, 1);
});

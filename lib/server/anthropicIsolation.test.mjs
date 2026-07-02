// Tests: Anthropic isolation guards in api/reports.js (COMMIT 5).
// Run: node --test lib/server/anthropicIsolation.test.mjs
//
// Confirms (a) core paths never REQUIRE Anthropic — anthropicUsable is false without a key,
// with no network call — and (b) the admin/cron guard recognizes cron + shared-secret callers
// and rejects anonymous ones.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { anthropicUsable, isAdminOrCron } from '../../api/reports.js';

test('anthropicUsable is false (no network) when no key is configured', async () => {
  const savedKey = process.env.ANTHROPIC_KEY;
  const savedAlt = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    // Passing a bogus URL proves no fetch happens — the missing key short-circuits to false.
    const usable = await anthropicUsable('http://127.0.0.1:1/never', 'k');
    assert.equal(usable, false);
  } finally {
    if (savedKey !== undefined) process.env.ANTHROPIC_KEY = savedKey;
    if (savedAlt !== undefined) process.env.ANTHROPIC_API_KEY = savedAlt;
  }
});

test('isAdminOrCron accepts the Vercel cron header', async () => {
  const ok = await isAdminOrCron({ headers: { 'x-vercel-cron': '1' } }, null, null);
  assert.equal(ok, true);
});

test('isAdminOrCron accepts a matching CRON_SECRET', async () => {
  const saved = process.env.CRON_SECRET;
  process.env.CRON_SECRET = 'test-secret';
  try {
    const ok = await isAdminOrCron({ headers: { 'x-cron-secret': 'test-secret' } }, null, null);
    assert.equal(ok, true);
    const bad = await isAdminOrCron({ headers: { 'x-cron-secret': 'wrong' } }, null, null);
    assert.equal(bad, false);
  } finally {
    if (saved === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = saved;
  }
});

test('isAdminOrCron rejects an anonymous caller (no headers, no db)', async () => {
  const ok = await isAdminOrCron({ headers: {} }, null, null);
  assert.equal(ok, false);
});

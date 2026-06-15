// Unit test for the rate-limit wrapper's fail-open behavior.
// The limiter is Supabase-backed; with no store configured it must allow traffic
// through (fail open) rather than block users on infra gaps.

import assert from 'node:assert/strict'
import { test, afterEach } from 'node:test'

import { rateLimit } from '../lib/security/rateLimit.ts'

const KEYS = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY']
const saved: Record<string, string | undefined> = {}
for (const k of KEYS) saved[k] = process.env[k]

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

test('fails open (allowed) when the rate-limit store is not configured', async () => {
  delete process.env.SUPABASE_URL
  delete process.env.SUPABASE_SERVICE_KEY
  const result = await rateLimit({ method: 'GET', headers: {} }, 'demand')
  assert.equal(result.allowed, true)
  assert.equal(typeof result.limit, 'number')
  assert.ok(result.limit > 0)
})

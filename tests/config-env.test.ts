// Unit tests for centralized environment access.

import assert from 'node:assert/strict'
import { test, afterEach } from 'node:test'

import {
  requireEnv,
  optionalEnv,
  publicEnv,
  serverEnv,
  requireSupabaseServer,
} from '../lib/config/env.ts'

const TOUCHED = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', '__WAGYU_TEST__']
const saved: Record<string, string | undefined> = {}
for (const k of TOUCHED) saved[k] = process.env[k]

afterEach(() => {
  for (const k of TOUCHED) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

test('requireEnv returns a present value and throws when missing', () => {
  process.env.__WAGYU_TEST__ = 'present'
  assert.equal(requireEnv('__WAGYU_TEST__'), 'present')
  delete process.env.__WAGYU_TEST__
  assert.throws(() => requireEnv('__WAGYU_TEST__'), /Missing required environment variable/)
})

test('optionalEnv returns undefined for empty/missing', () => {
  delete process.env.__WAGYU_TEST__
  assert.equal(optionalEnv('__WAGYU_TEST__'), undefined)
  process.env.__WAGYU_TEST__ = ''
  assert.equal(optionalEnv('__WAGYU_TEST__'), undefined)
})

test('publicEnv exposes browser-safe Supabase config (with fallback)', () => {
  assert.equal(typeof publicEnv.supabaseUrl, 'string')
  assert.ok(publicEnv.supabaseUrl.startsWith('https://'))
  assert.ok(publicEnv.supabaseAnonKey.length > 0)
})

test('serverEnv accessors read lazily from process.env', () => {
  process.env.SUPABASE_URL = 'https://test.supabase.co'
  assert.equal(serverEnv.supabaseUrl(), 'https://test.supabase.co')
  delete process.env.SUPABASE_URL
  assert.equal(serverEnv.supabaseUrl(), undefined)
})

test('requireSupabaseServer returns config when set, throws when missing', () => {
  process.env.SUPABASE_URL = 'https://test.supabase.co'
  process.env.SUPABASE_SERVICE_KEY = 'service-key'
  assert.deepEqual(requireSupabaseServer(), {
    url: 'https://test.supabase.co',
    serviceKey: 'service-key',
  })
  delete process.env.SUPABASE_SERVICE_KEY
  assert.throws(() => requireSupabaseServer(), /Missing required environment variable/)
})

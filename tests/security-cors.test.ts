// Unit tests for the shared CORS helper.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { applyCors, handlePreflight, ALLOWED_ORIGINS } from '../lib/security/cors.ts'

function makeRes() {
  const headers: Record<string, string | number | readonly string[]> = {}
  let status = 0
  let ended = false
  const res = {
    status(code: number) {
      status = code
      return res
    },
    json() {},
    send() {},
    end() {
      ended = true
    },
    setHeader(name: string, value: string | number | readonly string[]) {
      headers[name] = value
    },
  }
  return {
    res,
    headers,
    get status() {
      return status
    },
    get ended() {
      return ended
    },
  }
}

test('echoes an allowed production origin', () => {
  const ctx = makeRes()
  applyCors({ method: 'GET', headers: { origin: 'https://seenjobs.io' } }, ctx.res)
  assert.equal(ctx.headers['Access-Control-Allow-Origin'], 'https://seenjobs.io')
  assert.equal(ctx.headers['Vary'], 'Origin')
})

test('falls back to the canonical origin for a disallowed origin', () => {
  const ctx = makeRes()
  applyCors({ method: 'GET', headers: { origin: 'https://evil.example.com' } }, ctx.res)
  assert.equal(ctx.headers['Access-Control-Allow-Origin'], ALLOWED_ORIGINS[0])
})

test('allows localhost dev origins', () => {
  const ctx = makeRes()
  applyCors({ method: 'GET', headers: { origin: 'http://localhost:3000' } }, ctx.res)
  assert.equal(ctx.headers['Access-Control-Allow-Origin'], 'http://localhost:3000')
})

test('uses * when there is no Origin header', () => {
  const ctx = makeRes()
  applyCors({ method: 'GET', headers: {} }, ctx.res)
  assert.equal(ctx.headers['Access-Control-Allow-Origin'], '*')
})

test('applies custom methods/headers options', () => {
  const ctx = makeRes()
  applyCors({ method: 'GET', headers: {} }, ctx.res, {
    methods: 'GET, POST, OPTIONS',
    headers: 'Content-Type, X-Admin-Token',
  })
  assert.equal(ctx.headers['Access-Control-Allow-Methods'], 'GET, POST, OPTIONS')
  assert.equal(ctx.headers['Access-Control-Allow-Headers'], 'Content-Type, X-Admin-Token')
})

test('handlePreflight answers OPTIONS with 200 and reports handled', () => {
  const ctx = makeRes()
  const handled = handlePreflight({ method: 'OPTIONS', headers: {} }, ctx.res)
  assert.equal(handled, true)
  assert.equal(ctx.status, 200)
  assert.equal(ctx.ended, true)
})

test('handlePreflight passes non-OPTIONS through (returns false)', () => {
  const ctx = makeRes()
  const handled = handlePreflight({ method: 'GET', headers: {} }, ctx.res)
  assert.equal(handled, false)
  assert.equal(ctx.ended, false)
})

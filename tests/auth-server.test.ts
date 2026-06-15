// Unit tests for the centralized server-side auth helpers.
// Covers: missing auth rejected, invalid/expired/tampered tokens rejected, valid
// auth accepted, the Supabase /auth/v1/user fallback, and the security invariant
// that identity comes from the verified token — never from the request body.

import assert from 'node:assert/strict'
import { test, afterEach } from 'node:test'
import { createHmac } from 'node:crypto'

import { verifySupabaseJwt, resolveIdentity, requireUser } from '../lib/auth/server.ts'
import { ApiError } from '../lib/api/errors.ts'

const SECRET = 'test-jwt-secret'

function b64url(input: string): string {
  return Buffer.from(input).toString('base64url')
}

// Mint an HS256 Supabase-style JWT for testing.
function signJwt(payload: Record<string, unknown>, secret = SECRET): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = b64url(JSON.stringify(payload))
  const sig = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url')
  return `${header}.${body}.${sig}`
}

const future = Math.floor(Date.now() / 1000) + 3600
const past = Math.floor(Date.now() / 1000) - 3600

const ENV = ['SUPABASE_JWT_SECRET', 'SUPABASE_URL', 'SUPABASE_SERVICE_KEY']
const saved: Record<string, string | undefined> = {}
for (const k of ENV) saved[k] = process.env[k]
const realFetch = globalThis.fetch

afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  globalThis.fetch = realFetch
})

// ── verifySupabaseJwt ─────────────────────────────────────────────────────────

test('verifySupabaseJwt accepts a valid token and returns the payload', () => {
  const token = signJwt({ sub: 'user-123', email: 'a@b.co', exp: future })
  const payload = verifySupabaseJwt(token, SECRET)
  assert.equal(payload?.sub, 'user-123')
  assert.equal(payload?.email, 'a@b.co')
})

test('verifySupabaseJwt rejects a tampered signature', () => {
  const token = signJwt({ sub: 'user-123', exp: future })
  const tampered = token.slice(0, -3) + 'xyz'
  assert.equal(verifySupabaseJwt(tampered, SECRET), null)
})

test('verifySupabaseJwt rejects a token signed with the wrong secret', () => {
  const token = signJwt({ sub: 'user-123', exp: future }, 'other-secret')
  assert.equal(verifySupabaseJwt(token, SECRET), null)
})

test('verifySupabaseJwt rejects an expired token', () => {
  const token = signJwt({ sub: 'user-123', exp: past })
  assert.equal(verifySupabaseJwt(token, SECRET), null)
})

test('verifySupabaseJwt rejects a malformed token', () => {
  assert.equal(verifySupabaseJwt('not.a.jwt', SECRET), null)
  assert.equal(verifySupabaseJwt('only-one-part', SECRET), null)
})

// ── resolveIdentity ───────────────────────────────────────────────────────────

test('resolveIdentity returns null identity when no bearer token is present', async () => {
  process.env.SUPABASE_JWT_SECRET = SECRET
  const id = await resolveIdentity({ method: 'POST', headers: {} })
  assert.deepEqual(id, { uid: null, email: null })
})

test('resolveIdentity resolves uid/email from a locally-verified JWT (fast path)', async () => {
  process.env.SUPABASE_JWT_SECRET = SECRET
  // Fail the test loudly if the local fast path makes a network call.
  globalThis.fetch = (async () => {
    throw new Error('fast path must not hit the network')
  }) as unknown as typeof fetch
  const token = signJwt({ sub: 'user-abc', email: 'x@y.co', exp: future })
  const id = await resolveIdentity({
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
  })
  assert.deepEqual(id, { uid: 'user-abc', email: 'x@y.co' })
})

test('resolveIdentity falls back to /auth/v1/user when no JWT secret is set', async () => {
  delete process.env.SUPABASE_JWT_SECRET
  process.env.SUPABASE_URL = 'https://test.supabase.co'
  process.env.SUPABASE_SERVICE_KEY = 'service-key'
  let calledUrl = ''
  globalThis.fetch = (async (url: string) => {
    calledUrl = url
    return { ok: true, json: async () => ({ id: 'user-remote', email: 'r@s.co' }) }
  }) as unknown as typeof fetch

  const id = await resolveIdentity({
    method: 'POST',
    headers: { authorization: 'Bearer opaque-token' },
  })
  assert.equal(id.uid, 'user-remote')
  assert.equal(id.email, 'r@s.co')
  assert.ok(calledUrl.endsWith('/auth/v1/user'))
})

test('resolveIdentity ignores a user_id supplied in the request body', async () => {
  process.env.SUPABASE_JWT_SECRET = SECRET
  const token = signJwt({ sub: 'real-user', exp: future })
  const id = await resolveIdentity({
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: { user_id: 'attacker-controlled' },
  })
  // Identity comes from the verified token, NOT the body.
  assert.equal(id.uid, 'real-user')
})

// ── requireUser ───────────────────────────────────────────────────────────────

test('requireUser throws 401 when unauthenticated', async () => {
  process.env.SUPABASE_JWT_SECRET = SECRET
  await assert.rejects(
    () => requireUser({ method: 'POST', headers: {} }),
    (err: unknown) => {
      assert.ok(err instanceof ApiError)
      assert.equal(err.status, 401)
      return true
    },
  )
})

test('requireUser returns the uid for a valid token', async () => {
  process.env.SUPABASE_JWT_SECRET = SECRET
  const token = signJwt({ sub: 'user-ok', email: 'o@k.co', exp: future })
  const result = await requireUser({
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
  })
  assert.equal(result.uid, 'user-ok')
  assert.equal(result.email, 'o@k.co')
})

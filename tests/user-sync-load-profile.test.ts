// Parity test for the migrated `load_profile` action in api/user-sync.js.
//
// Proves that routing load_profile through the foundation layer (requireUser +
// createServiceDb + the profile service) leaves the response shape byte-for-byte
// identical to the original inline implementation: { profile: rows[0] || null }.
//
// Everything is exercised through the real handler with a locally-minted HS256
// JWT and a mocked global fetch (no network). The fast local-verify path is used
// (SUPABASE_JWT_SECRET set), so auth must NOT hit /auth/v1/user.

import assert from 'node:assert/strict'
import { test, afterEach } from 'node:test'
import { createHmac } from 'node:crypto'

import handler from '../api/user-sync.js'

const SECRET = 'test-jwt-secret'
const UID = 'user-parity-123'

function b64url(input: string): string {
  return Buffer.from(input).toString('base64url')
}

function signJwt(payload: Record<string, unknown>, secret = SECRET): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = b64url(JSON.stringify(payload))
  const sig = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url')
  return `${header}.${body}.${sig}`
}

// Minimal req/res doubles matching the subset of the Node serverless surface the
// handler uses.
interface FakeRes {
  statusCode: number
  body: unknown
  ended: boolean
  headers: Record<string, unknown>
  status(code: number): FakeRes
  json(b: unknown): void
  send(b: unknown): void
  end(b?: unknown): void
  setHeader(name: string, value: unknown): void
}

function makeRes(): FakeRes {
  const res: FakeRes = {
    statusCode: 0,
    body: undefined,
    ended: false,
    headers: {},
    status(code: number) {
      res.statusCode = code
      return res
    },
    json(b: unknown) {
      res.body = b
      res.ended = true
    },
    send(b: unknown) {
      res.body = b
      res.ended = true
    },
    end(b?: unknown) {
      if (b !== undefined) res.body = b
      res.ended = true
    },
    setHeader(name: string, value: unknown) {
      res.headers[name] = value
    },
  }
  return res
}

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

function configureEnv(): void {
  process.env.SUPABASE_JWT_SECRET = SECRET
  process.env.SUPABASE_URL = 'https://test.supabase.co'
  process.env.SUPABASE_SERVICE_KEY = 'service-key'
}

// Route mocked fetch by URL: the IP rate-limit RPC, the auth fallback (must not
// be called), and the profiles REST read.
function installFetch(profileRows: unknown, calls: string[]): void {
  globalThis.fetch = (async (url: string) => {
    calls.push(url)
    if (url.includes('/rpc/increment_rate_limit')) {
      return { ok: true, json: async () => 1 } // count=1 ≤ 500 → allowed
    }
    if (url.includes('/auth/v1/user')) {
      throw new Error('auth fallback must not run when SUPABASE_JWT_SECRET is set')
    }
    if (url.includes('/rest/v1/profiles')) {
      return { ok: true, json: async () => profileRows }
    }
    throw new Error(`unexpected fetch: ${url}`)
  }) as unknown as typeof fetch
}

function makeReq(token: string) {
  return {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'x-forwarded-for': '203.0.113.7' },
    body: { action: 'load_profile' },
    socket: { remoteAddress: '203.0.113.7' },
  }
}

test('load_profile returns { profile: row } unchanged through the migrated route', async () => {
  configureEnv()
  const calls: string[] = []
  const profileRow = { id: UID, name: 'Ada', city: 'NYC' }
  installFetch([profileRow], calls)

  const token = signJwt({ sub: UID, email: 'a@b.co', exp: Math.floor(Date.now() / 1000) + 3600 })
  const res = makeRes()
  await handler(makeReq(token) as never, res as never)

  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body, { profile: profileRow })
  // Ownership: the profiles query is scoped to the authenticated uid.
  assert.ok(calls.some((u) => u.includes(`profiles?id=eq.${UID}`)))
  // Fast path: identity resolved locally, no /auth/v1/user round-trip.
  assert.ok(!calls.some((u) => u.includes('/auth/v1/user')))
})

test('load_profile returns { profile: null } when no row exists', async () => {
  configureEnv()
  const calls: string[] = []
  installFetch([], calls)

  const token = signJwt({ sub: UID, exp: Math.floor(Date.now() / 1000) + 3600 })
  const res = makeRes()
  await handler(makeReq(token) as never, res as never)

  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body, { profile: null })
})

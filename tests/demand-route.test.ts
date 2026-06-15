// Integration tests for the migrated GET /api/demand route boundary.
// Exercises the foundation wiring (CORS, dispatch, env-gated read, response
// helper) end to end with a mocked global fetch. The admin POST path is not
// exercised here — it is unchanged by this migration.

import assert from 'node:assert/strict'
import { test, beforeEach, afterEach } from 'node:test'

import handler from '../api/demand.ts'

interface MockRes {
  statusCode: number
  body: unknown
  ended: boolean
  headers: Record<string, string | number | readonly string[]>
  status(code: number): MockRes
  json(payload: unknown): void
  end(payload?: unknown): void
  setHeader(name: string, value: string | number | readonly string[]): void
}

function makeRes(): MockRes {
  return {
    statusCode: 0,
    body: undefined,
    ended: false,
    headers: {},
    status(code) {
      this.statusCode = code
      return this
    },
    json(payload) {
      this.body = payload
    },
    end() {
      this.ended = true
    },
    setHeader(name, value) {
      this.headers[name] = value
    },
  }
}

const ENV_KEYS = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_KEY']
let savedEnv: Record<string, string | undefined> = {}
const realFetch = globalThis.fetch

beforeEach(() => {
  savedEnv = {}
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k]
    delete process.env[k]
  }
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
  globalThis.fetch = realFetch
})

test('OPTIONS preflight returns 200 and CORS headers, without dispatching', async () => {
  const res = makeRes()
  await handler({ method: 'OPTIONS', headers: { origin: 'https://seenjobs.io' } }, res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.ended, true)
  assert.equal(res.headers['Access-Control-Allow-Origin'], 'https://seenjobs.io')
  assert.equal(res.headers['Access-Control-Allow-Methods'], 'GET, POST, OPTIONS')
})

test('unsupported method returns 405', async () => {
  const res = makeRes()
  await handler({ method: 'PUT', headers: {} }, res)
  assert.equal(res.statusCode, 405)
})

test('GET groups demand_data and preserves the response shape + cache header', async () => {
  process.env.SUPABASE_URL = 'https://example.supabase.co'
  process.env.SUPABASE_ANON_KEY = 'anon-key'
  globalThis.fetch = (async () => ({
    ok: true,
    json: async () => [
      {
        city: 'Austin, TX',
        urg: 'hot',
        src: 'BLS',
        role_title: 'SWE',
        niche: 'Tech',
        level: 'Mid',
        count: 100,
        di: 80,
        note: 'n',
        updated_at: '2026-01-05',
        bls_period: '2025-M12',
      },
    ],
  })) as unknown as typeof fetch

  const res = makeRes()
  await handler({ method: 'GET', headers: { origin: 'https://seenjobs.io' } }, res)

  assert.equal(res.statusCode, 200)
  assert.equal(res.headers['Cache-Control'], 'public, max-age=21600, stale-while-revalidate=86400')
  assert.deepEqual(res.body, {
    ok: true,
    demand: [
      {
        city: 'Austin, TX',
        urg: 'hot',
        src: 'BLS',
        jobs: [{ t: 'SWE', n: 'Tech', l: 'Mid', count: 100, di: 80, note: 'n' }],
      },
    ],
    generated_at: '2026-01-05',
    bls_period: '2025-M12',
    row_count: 1,
  })
})

test('GET degrades to an empty 200 payload when Supabase is not configured', async () => {
  const res = makeRes()
  await handler({ method: 'GET', headers: {} }, res)
  assert.equal(res.statusCode, 200)
  const body = res.body as { ok: boolean; demand: unknown[]; generated_at: string }
  assert.equal(body.ok, true)
  assert.deepEqual(body.demand, [])
  assert.equal(typeof body.generated_at, 'string')
  assert.equal('bls_period' in body, false)
})

test('GET degrades to an empty 200 payload when the upstream read fails', async () => {
  process.env.SUPABASE_URL = 'https://example.supabase.co'
  process.env.SUPABASE_ANON_KEY = 'anon-key'
  globalThis.fetch = (async () => ({
    ok: false,
    json: async () => ({}),
  })) as unknown as typeof fetch

  const res = makeRes()
  await handler({ method: 'GET', headers: {} }, res)
  assert.equal(res.statusCode, 200)
  const body = res.body as { ok: boolean; demand: unknown[] }
  assert.deepEqual(body.demand, [])
})

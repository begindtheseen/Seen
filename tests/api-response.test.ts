// Unit tests for the shared API response helpers.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ok, created, noContent, sendJson, fail } from '../lib/api/response.ts'
import { BadRequestError, InternalError } from '../lib/api/errors.ts'

interface Recorded {
  status: number
  body: unknown
  ended: boolean
}

function makeRes() {
  const rec: Recorded = { status: 0, body: undefined, ended: false }
  const res = {
    status(code: number) {
      rec.status = code
      return res
    },
    json(body: unknown) {
      rec.body = body
    },
    send(body: unknown) {
      rec.body = body
    },
    end() {
      rec.ended = true
    },
    setHeader() {},
  }
  return { res, rec }
}

test('ok sends 200 with the payload', () => {
  const { res, rec } = makeRes()
  ok(res, { hello: 'world' })
  assert.equal(rec.status, 200)
  assert.deepEqual(rec.body, { hello: 'world' })
})

test('created sends 201', () => {
  const { res, rec } = makeRes()
  created(res, { id: 1 })
  assert.equal(rec.status, 201)
})

test('noContent sends 204 and ends without a body', () => {
  const { res, rec } = makeRes()
  noContent(res)
  assert.equal(rec.status, 204)
  assert.equal(rec.ended, true)
  assert.equal(rec.body, undefined)
})

test('sendJson honors an arbitrary status', () => {
  const { res, rec } = makeRes()
  sendJson(res, 207, { multi: true })
  assert.equal(rec.status, 207)
  assert.deepEqual(rec.body, { multi: true })
})

test('fail maps an ApiError to its status and exposed body', () => {
  const { res, rec } = makeRes()
  fail(res, new BadRequestError('email required', 'invalid_field'))
  assert.equal(rec.status, 400)
  assert.deepEqual(rec.body, { error: 'email required', code: 'invalid_field' })
})

test('fail hides 5xx internals', () => {
  const { res, rec } = makeRes()
  fail(res, new InternalError('db connection string leaked'))
  assert.equal(rec.status, 500)
  assert.deepEqual(rec.body, { error: 'Internal server error' })
})

test('fail wraps an unknown throwable as a hidden 500', () => {
  const { res, rec } = makeRes()
  fail(res, new Error('boom with secret detail'))
  assert.equal(rec.status, 500)
  assert.deepEqual(rec.body, { error: 'Internal server error' })
})

// Foundation tests for the typed API error layer.
// Run with: npm test  (Node's built-in test runner + TS type stripping)

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  ApiError,
  BadRequestError,
  UnauthorizedError,
  InternalError,
  toApiError,
} from '../lib/api/errors.ts'

test('4xx errors expose their message to the client', () => {
  const err = new BadRequestError('email is required', 'invalid_field')
  assert.equal(err.status, 400)
  assert.equal(err.expose, true)
  assert.deepEqual(err.toBody(), { error: 'email is required', code: 'invalid_field' })
})

test('UnauthorizedError defaults to 401', () => {
  const err = new UnauthorizedError()
  assert.equal(err.status, 401)
  assert.equal(err.toBody().error, 'Unauthorized')
})

test('5xx errors never leak their internal message', () => {
  const err = new InternalError('Postgres connection string is invalid')
  assert.equal(err.status, 500)
  assert.equal(err.expose, false)
  assert.equal(err.toBody().error, 'Internal server error')
})

test('toApiError wraps unknown throwables as a hidden 500', () => {
  const wrapped = toApiError(new Error('boom: secret stack detail'))
  assert.ok(wrapped instanceof ApiError)
  assert.equal(wrapped.status, 500)
  assert.equal(wrapped.toBody().error, 'Internal server error')
})

test('toApiError passes ApiError instances through unchanged', () => {
  const original = new BadRequestError('bad')
  assert.equal(toApiError(original), original)
})

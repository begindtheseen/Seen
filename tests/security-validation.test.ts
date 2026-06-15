// Unit tests for the shared, dependency-free validation helpers.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  parseJsonBody,
  requireString,
  optionalString,
  requireOneOf,
  requireNumber,
  assert as assertValid,
} from '../lib/security/validation.ts'
import { ApiError } from '../lib/api/errors.ts'

function expectBadRequest(fn: () => unknown, codeContains?: string) {
  assert.throws(fn, (err: unknown) => {
    assert.ok(err instanceof ApiError)
    assert.equal(err.status, 400)
    if (codeContains) assert.equal(err.code, codeContains)
    return true
  })
}

test('parseJsonBody handles object, JSON string, and garbage', () => {
  assert.deepEqual(parseJsonBody({ a: 1 }), { a: 1 })
  assert.deepEqual(parseJsonBody('{"a":1}'), { a: 1 })
  assert.deepEqual(parseJsonBody('not json'), {})
  assert.deepEqual(parseJsonBody(undefined), {})
  assert.deepEqual(parseJsonBody(42), {})
})

test('requireString trims and enforces min/max', () => {
  assert.equal(requireString('  hi  ', 'name'), 'hi')
  expectBadRequest(() => requireString(123, 'name'), 'invalid_field')
  expectBadRequest(() => requireString('a', 'name', { min: 2 }), 'invalid_field')
  expectBadRequest(() => requireString('abcdef', 'name', { max: 3 }), 'invalid_field')
})

test('optionalString returns undefined for empty/null/undefined', () => {
  assert.equal(optionalString(undefined, 'x'), undefined)
  assert.equal(optionalString(null, 'x'), undefined)
  assert.equal(optionalString('', 'x'), undefined)
  assert.equal(optionalString('  v  ', 'x'), 'v')
})

test('requireOneOf accepts allowed values and rejects others', () => {
  assert.equal(requireOneOf('monthly', 'plan', ['monthly', 'yearly'] as const), 'monthly')
  expectBadRequest(() => requireOneOf('weekly', 'plan', ['monthly', 'yearly'] as const))
})

test('requireNumber coerces and enforces bounds', () => {
  assert.equal(requireNumber('5', 'n'), 5)
  assert.equal(requireNumber(5, 'n'), 5)
  expectBadRequest(() => requireNumber('abc', 'n'))
  expectBadRequest(() => requireNumber(1, 'n', { min: 2 }))
  expectBadRequest(() => requireNumber(9, 'n', { max: 8 }))
})

test('assert throws a 400 on a falsy condition', () => {
  expectBadRequest(() => assertValid(false, 'must be present', 'missing'), 'missing')
  // truthy condition does not throw
  assertValid(true, 'ok')
})

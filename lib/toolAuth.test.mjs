// UX audit F2: an expired session is never shown as "out of credits".
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { needsSignIn, outOfCredits, signInHereHref } from './toolAuth.js'

test('today’s 401 shape (credits_required on a 401) reads as a sign-in problem, not a paywall', () => {
  const body = { error: 'Sign in to use AI features', credits_required: true }
  assert.equal(needsSignIn(401, body), true)
  assert.equal(outOfCredits(401, body), false)
})

test('the server’s signin_required reads as sign-in whatever the status', () => {
  assert.equal(needsSignIn(401, { error: 'signin_required' }), true)
  assert.equal(needsSignIn(403, { error: 'signin_required' }), true)
  assert.equal(outOfCredits(403, { error: 'signin_required', credits_required: true }), false)
})

test('a 402, or credits_required without a sign-in problem, is out of credits', () => {
  assert.equal(outOfCredits(402, { error: 'no_credits' }), true)
  assert.equal(outOfCredits(200, { credits_required: true }), true)
  assert.equal(outOfCredits(403, { pro_required: true }), true)
  assert.equal(outOfCredits(200, { what_they_want: [] }), false)
})

test('the sign-in link returns to the exact page and query', () => {
  assert.equal(signInHereHref({ pathname: '/jobs', search: '?q=cashier&job=abc' }), `/login?return=${encodeURIComponent('/jobs?q=cashier&job=abc')}`)
  assert.equal(signInHereHref({ pathname: '/jobs/123', search: '' }), `/login?return=${encodeURIComponent('/jobs/123')}`)
})

// The micro-survey's "may it show here, now?" rules + the tracker's quiet window.
// Run: node --test lib/microSurveyGate.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { microSurveyGate, SKIP_PREFIXES } from './microSurveyGate.ts'

const base = { pathname: '/tracker', notFound: false, quiet: false, shownToday: false }

test('shows on an ordinary page when nothing blocks it', () => {
  assert.equal(microSurveyGate(base), 'ok')
  assert.equal(microSurveyGate({ ...base, pathname: '/company/walmart' }), 'ok')
  assert.equal(microSurveyGate({ ...base, pathname: '/jobs?q=cashier' }), 'ok')
})

test('never on the 404 page, whatever its path', () => {
  assert.equal(microSurveyGate({ ...base, pathname: '/nope', notFound: true }), 'not_found')
  assert.equal(microSurveyGate({ ...base, pathname: '/tracker', notFound: true }), 'not_found')
})

test('never on the landing page, auth flows, pricing, contact, employers, admin', () => {
  assert.equal(microSurveyGate({ ...base, pathname: '/' }), 'landing')
  for (const p of ['/login', '/login?return=%2Fjobs', '/signup', '/reset', '/reset/confirm', '/pricing', '/contact', '/employers/dashboard', '/admin']) {
    assert.equal(microSurveyGate({ ...base, pathname: p }), 'skipped_route', p)
  }
  assert.ok(SKIP_PREFIXES.includes('/reset') && SKIP_PREFIXES.includes('/contact'), 'the two routes the audit named are in the list')
  // A prefix never swallows a different page that merely starts with the same letters.
  assert.equal(microSurveyGate({ ...base, pathname: '/contacts-import' }), 'ok')
})

test('never within the quiet window after a delete / withdraw / outcome, and never twice a day', () => {
  assert.equal(microSurveyGate({ ...base, quiet: true }), 'quiet')
  assert.equal(microSurveyGate({ ...base, shownToday: true }), 'shown_today')
  // the quiet window outranks the daily slot (a cancelled pop does not spend the slot)
  assert.equal(microSurveyGate({ ...base, quiet: true, shownToday: true }), 'quiet')
})

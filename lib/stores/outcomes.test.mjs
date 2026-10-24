// One definition of "the company responded" for the dashboard and tracker (audit 3 M2).
import test from 'node:test'
import assert from 'node:assert/strict'
import { responded, hadInterview, rated, responseRate, realOutcomes } from './outcomes.ts'

const ev = (type, extra = {}) => ({ id: type, type, date: 1, source: 'user', confidence: 'low', ...extra })
const app = (status, stage, events = []) => ({ status, stage, events: [ev('application_submitted'), ...events] })

test('a reverted stage click (superseded response) is NOT a response; a check-in "Got a response" is', () => {
  assert.equal(responded(app('active', 'Applied', [ev('response_received', { anomaly_flags: ['superseded'], trust_weight: 0 })])), false)
  assert.equal(responded(app('active', 'Viewed', [ev('response_received')])), true)
  assert.equal(responded(app('active', 'Applied')), false)
  assert.equal(responded(app('active', 'Phone Screen')), true, 'a stage past Viewed implies a response')
  assert.equal(responded(app('rejected', 'Applied')), true, 'a rejection is a response')
  assert.equal(responded(app('ghosted', 'Applied')), false)
})

test('withdrawn is out of the denominator (the audit: 1/4 = 25% with a withdrawn card counted)', () => {
  const apps = [app('active', 'Applied'), app('active', 'Applied'), app('active', 'Viewed', [ev('response_received')]), app('withdrawn', 'Applied', [ev('withdrawn')])]
  assert.equal(rated(apps).length, 3)
  assert.equal(responseRate(apps), 33)
  assert.equal(responseRate([app('withdrawn', 'Applied')]), null)
  assert.equal(responseRate([]), null)
})

test('interviews and real outcomes', () => {
  assert.equal(hadInterview(app('active', 'Interview', [ev('interview_received')])), true)
  assert.equal(hadInterview(app('active', 'Applied', [ev('interview_received', { anomaly_flags: ['superseded'] })])), false)
  assert.equal(hadInterview(app('hired', 'Offer')), true)
  assert.equal(realOutcomes([app('hired', 'Offer'), app('withdrawn', 'Applied'), app('ghosted', 'Applied'), app('active', 'Applied')]), 2)
})

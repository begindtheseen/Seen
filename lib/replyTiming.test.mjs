// Run: node --test lib/replyTiming.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { replyTiming, MIN_TIMED_REPORTS, REPORT_WHEN_YOU_HEAR } from './replyTiming.ts'

test('Amazon (avg_wait_days 30): the stored average, said plainly', () => {
  const t = replyTiming(30, [])
  assert.equal(t.known, true)
  assert.equal(t.days, 30)
  assert.equal(t.line, 'Typical wait to hear back: 30 days, from the reports that name a time.')
  assert.equal(t.short, '30d typical wait')
})

test('Walmart (avg_wait_days null, no report names a time): no number at all', () => {
  const t = replyTiming(null, [null, undefined, 0])
  assert.equal(t.known, false)
  assert.equal(t.days, null)
  assert.equal(t.line, 'Not enough timing data yet.')
  assert.doesNotMatch(t.line + t.short, /\d/)
  assert.match(REPORT_WHEN_YOU_HEAR, /hear back/)
})

test('reports with wait_days are used only from 5 of them, as a median', () => {
  assert.equal(MIN_TIMED_REPORTS, 5)
  const four = replyTiming(null, [3, 7, 10, 40])
  assert.equal(four.known, false)
  assert.equal(four.line, 'Not enough timing data yet — 4 of the 5 reports needed name how long the reply took.')
  const five = replyTiming(null, [3, 7, 10, 40, 400, 12]) // 400 is out of range → 5 usable
  assert.equal(five.known, true)
  assert.equal(five.basis, 'reports')
  assert.equal(five.days, 10)
  assert.equal(five.n, 5)
  assert.equal(replyTiming(undefined, [2, 4, 6, 8, 10, 12]).days, 7)
})

test('a zero or junk average is not a number to show', () => {
  assert.equal(replyTiming(0).known, false)
  assert.equal(replyTiming(Number.NaN).known, false)
  assert.equal(replyTiming(1).line, 'Typical wait to hear back: 1 day, from the reports that name a time.')
})

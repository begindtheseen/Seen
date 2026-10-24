// Check-in answers and snoozes as events on the application (audit 3 H3) and the one question a
// card is asked (M7). California calendar (lib/time/pacific.js).
import test from 'node:test'
import assert from 'node:assert/strict'
import { checkAnsweredEvent, checkSnoozedEvent, answeredFromEvents, snoozedUntilFromEvents, pickDueCheck, checkLabel, eventId, CHECK_ANSWERED } from './checkEvents.ts'

const NOW = Date.parse('2026-10-23T17:00:00Z') // 10:00 PT
const DAY = 86400000
const app = (daysAgo, events = [], status = 'active') => ({ id: 'a1', company: 'OldCo', role: 'Analyst', stage: 'Applied', status, appliedAt: NOW - daysAgo * DAY, updatedAt: NOW, events })
const due = (a, answered = new Set(), snooze = () => null) => pickDueCheck(a, answered, snooze, NOW)

test('an answer is a check_answered event that names its milestone; it is read back as answered', () => {
  const e = checkAnsweredEvent('response_check', { got_response: true }, 8, NOW)
  assert.equal(e.type, CHECK_ANSWERED)
  assert.deepEqual(e.data, { check: 'response_check', day: 7, days_elapsed: 8, got_response: true })
  assert.deepEqual([...answeredFromEvents([e])], ['response_check'])
  assert.deepEqual([...answeredFromEvents([{ ...e, data: { check: 'bogus' } }])], [])
})

test('"Later" is a check_snoozed event; the latest future until wins; a past one is not a snooze', () => {
  const a = checkSnoozedEvent('response_check', NOW + DAY, NOW)
  const b = checkSnoozedEvent('response_check', NOW + 2 * DAY, NOW)
  assert.deepEqual(a.data, { check: 'response_check', day: 7, until: NOW + DAY })
  assert.equal(snoozedUntilFromEvents([a, b], 'response_check', NOW), NOW + 2 * DAY)
  assert.equal(snoozedUntilFromEvents([a], 'interview_check', NOW), null)
  assert.equal(snoozedUntilFromEvents([a], 'response_check', NOW + 3 * DAY), null)
})

test('one question per card, in schedule order; a snoozed one holds the card', () => {
  assert.equal(due(app(3)), null, 'nothing before day 7')
  assert.equal(due(app(8)).checkType, 'response_check')
  assert.equal(due(app(15)).checkType, 'response_check', 'day 14 waits for day 7')
  assert.equal(due(app(15), new Set(['response_check'])).checkType, 'interview_check')
  assert.equal(due(app(8), new Set(), () => NOW + DAY), null)
  assert.equal(due(app(8, [], 'ghosted')), null, 'only open applications are asked')
})

test('from day 30 ONLY the final-outcome question is asked (never "Day 399 · Did they respond?")', () => {
  const d = due(app(31))
  assert.equal(d.checkType, 'outcome_check')
  assert.equal(due(app(399)).checkType, 'outcome_check')
  assert.equal(due(app(31), new Set(['outcome_check'])), null, '"Still active" ends the schedule; the day-7/14 questions are moot')
})

test('the label is the milestone, with the card age only when it differs', () => {
  assert.equal(checkLabel({ day: 7, daysElapsed: 7 }), 'Day 7 check-in')
  assert.equal(checkLabel({ day: 30, daysElapsed: 31 }), 'Day 30 check-in · day 31')
})

test('event ids are unique and short', () => {
  const ids = new Set(Array.from({ length: 200 }, () => eventId('chk')))
  assert.equal(ids.size, 200)
  for (const id of ids) assert.ok(id.length <= 40 && id.startsWith('chk_'))
})

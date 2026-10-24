// The 7 / 14 / 30-day check-in schedule as the tracker card states it ("Next check-in Oct 30 —
// did they respond to your application?"). Runs on Node's own type stripping (.ts imports).
import test from 'node:test'
import assert from 'node:assert/strict'
import { nextCheck, nextCheckLine, daysSince, formatCheckDate, DAY_MS } from './checkSchedule.ts'

// 2026-10-23 10:00 PT (17:00 UTC)
const NOW = Date.parse('2026-10-23T17:00:00Z')

test('a fresh application: next check is the day-7 response check, due on the 7th California day', () => {
  const n = nextCheck(NOW, [], NOW)
  assert.equal(n.type, 'response_check')
  assert.equal(n.day, 7)
  assert.equal(new Date(n.dueAt).toISOString(), '2026-10-30T07:00:00.000Z', 'midnight PT (PDT) on Oct 30')
  assert.equal(n.due, false)
  assert.equal(n.q, 'did they respond to your application?')
  assert.equal(nextCheckLine(NOW, [], NOW), 'Next check-in Oct 30 — did they respond to your application?')
})

test('once the response check is answered the next one is day 14, then day 30, then nothing', () => {
  assert.equal(nextCheck(NOW, ['response_check'], NOW).day, 14)
  assert.equal(nextCheck(NOW, ['response_check', 'interview_check'], NOW).day, 30)
  assert.equal(nextCheck(NOW, ['response_check', 'interview_check', 'outcome_check'], NOW), null)
  assert.equal(nextCheckLine(NOW, ['response_check', 'interview_check', 'outcome_check'], NOW), null)
})

test('a check that is already due has no "next" line — the card asks the question instead', () => {
  const applied = NOW - 8 * DAY_MS
  const n = nextCheck(applied, [], NOW)
  assert.equal(n.due, true)
  assert.equal(nextCheckLine(applied, [], NOW), null)
  // answered late: day 14 is still 6 days away
  assert.equal(nextCheckLine(applied, ['response_check'], NOW), `Next check-in ${formatCheckDate(applied + 14 * DAY_MS, NOW)} — did they schedule any interviews?`)
})

test('dates are the Pacific calendar day (an evening PT apply is not "tomorrow" in UTC)', () => {
  // 2026-10-23 23:30 PT = 2026-10-24 06:30 UTC → day 7 is Oct 30 PT (Oct 31 UTC)
  const applied = Date.parse('2026-10-24T06:30:00Z')
  assert.equal(formatCheckDate(applied + 7 * DAY_MS, NOW), 'Oct 30')
  // a different year carries the year
  assert.equal(formatCheckDate(Date.parse('2027-01-02T20:00:00Z'), NOW), 'Jan 2, 2027')
})

test('daysSince counts California calendar days and never goes negative', () => {
  assert.equal(daysSince(NOW, NOW), 0)
  assert.equal(daysSince(NOW - 6.9 * DAY_MS, NOW), 7, '6.9 × 24 h back from 10:00 PT lands on the 7th calendar day before')
  assert.equal(daysSince(NOW - 7 * DAY_MS, NOW), 7)
  assert.equal(daysSince(NOW + DAY_MS, NOW), 0)
  // Applied 23:30 PT; next morning 09:00 PT is Day 1 (the 24-hour arithmetic said Day 0 until 23:30).
  assert.equal(daysSince(Date.parse('2026-10-24T06:30:00Z'), Date.parse('2026-10-24T16:00:00Z')), 1)
})

test('a check comes due with the Day count: Day 7 at midnight PT, however late in the day the application went in', () => {
  const lateApply = Date.parse('2026-10-24T06:30:00Z') // Oct 23, 23:30 PT
  const n = nextCheck(lateApply, [], Date.parse('2026-10-30T15:00:00Z')) // Oct 30, 08:00 PT
  assert.equal(n.due, true)
  assert.equal(daysSince(lateApply, Date.parse('2026-10-30T15:00:00Z')), 7)
  assert.equal(new Date(n.dueAt).toISOString(), '2026-10-30T07:00:00.000Z')
  // The evening before it is Day 6 and the card still says "Next check-in Oct 30".
  assert.equal(nextCheckLine(lateApply, [], Date.parse('2026-10-30T05:00:00Z')), 'Next check-in Oct 30 — did they respond to your application?')
})

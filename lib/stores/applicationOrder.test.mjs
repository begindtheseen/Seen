// Tracker list order / filter / page size and the dashboard pipeline pick (audit 3 M11, M3).
import test from 'node:test'
import assert from 'node:assert/strict'
import { sortApplications, filterApplications, attentionRank, pastWindow, REFERENCE_WINDOW_DAYS, PAGE_SIZE } from './applicationOrder.ts'

const NOW = Date.parse('2026-10-23T17:00:00Z')
const DAY = 86400000
const app = (id, daysAgo, status = 'active', extra = {}) => ({ id, company: id.toUpperCase() + ' Corp', role: 'Analyst', location: 'Phoenix, AZ', platform: 'Direct', stage: 'Applied', status, appliedAt: NOW - daysAgo * DAY, updatedAt: NOW - daysAgo * DAY, ...extra })

test('needs-attention order: due check-ins, then quiet (past 21 days), then open oldest first, then finished newest first', () => {
  const apps = [app('new0', 0), app('new1', 1), app('due8', 8), app('quiet25', 25), app('hired', 3, 'hired'), app('ghost', 40, 'ghosted'), app('open5', 5)]
  const order = sortApplications(apps, 'attention', new Set(['due8']), NOW).map(a => a.id)
  assert.deepEqual(order, ['due8', 'quiet25', 'open5', 'new1', 'new0', 'hired', 'ghost'])
})

test('the audit case: 16 Day-0 cards no longer bury the Day-31 card at the bottom', () => {
  const apps = [...Array.from({ length: 16 }, (_, i) => app('b' + i, 0)), app('oldco', 31)]
  assert.equal(sortApplications(apps, 'attention', new Set(['oldco']), NOW)[0].id, 'oldco')
  assert.equal(sortApplications(apps, 'attention', new Set(), NOW)[0].id, 'oldco', 'quiet even with no check due')
})

test('newest / oldest by applied date', () => {
  const apps = [app('a', 5), app('b', 1), app('c', 9)]
  assert.deepEqual(sortApplications(apps, 'newest', new Set(), NOW).map(a => a.id), ['b', 'a', 'c'])
  assert.deepEqual(sortApplications(apps, 'oldest', new Set(), NOW).map(a => a.id), ['c', 'a', 'b'])
})

test('text filter over company, role, location, platform, stage and status; blank = all', () => {
  const apps = [app('walmart', 1), app('target', 2, 'withdrawn', { role: 'Cashier', location: 'Mesa' }), app('oldco', 3, 'active', { stage: 'Interview' })]
  assert.deepEqual(filterApplications(apps, '  wal ').map(a => a.id), ['walmart'])
  assert.deepEqual(filterApplications(apps, 'mesa').map(a => a.id), ['target'])
  assert.deepEqual(filterApplications(apps, 'INTERVIEW').map(a => a.id), ['oldco'])
  assert.deepEqual(filterApplications(apps, 'withdrawn').map(a => a.id), ['target'])
  assert.equal(filterApplications(apps, '').length, 3)
  assert.equal(PAGE_SIZE, 10)
})

test('past the window: the company average ×1.4 when known, else the 21-day reference (worded as a reference)', () => {
  assert.equal(REFERENCE_WINDOW_DAYS, 21)
  assert.deepEqual(pastWindow(app('x', 31), null, NOW), { past: true, reference: true, days: 31, window: 21 })
  assert.equal(pastWindow(app('x', 20), null, NOW).past, false)
  assert.deepEqual(pastWindow(app('x', 31), 25, NOW), { past: false, reference: false, days: 31, window: 35 })
  assert.equal(pastWindow(app('x', 40, 'hired'), null, NOW).past, false, 'only open applications')
  assert.equal(attentionRank(app('x', 22), new Set(), 'x', NOW), 1)
})

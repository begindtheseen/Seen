// Today's adapter: a number that could not be read is null ("couldn't read"), never 0 (audit defect 18,
// §3.8 #5), empty queues fold into one line, and a malformed answer never crashes the screen.
// Run: node --test components/admin2/sections/today/today.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readToday, emptyLine, money } from './adapter.ts'

const OK = {
  ok: true, as_of: '2026-11-10T17:41:00Z', degraded: false, failed: [],
  stats: { listings_live: 136865, listings_stale: 20982, reports_24h: 122, signups_24h: 3, revenue_7d_cents: 4997 },
  queues: [
    { key: 'held_reports', label: 'Held reports', count: 13, section: 'review', filter: { kind: 'held' } },
    { key: 'reddit_disputes', label: 'Reddit disputes', count: 0, section: 'review' },
    { key: 'employer_claims', label: 'Employer claims', count: 0, section: 'review' },
    { key: 'account_clusters', label: 'Account clusters', count: 2, section: 'people' },
  ],
  system: { ok: true, line: 'All 14 scheduled jobs ran on time.' },
}

test('a clean overview: waiting queues in order, zero queues folded, nothing degraded', () => {
  const v = readToday(OK)
  assert.equal(v.degraded, false)
  assert.deepEqual(v.waiting.map((q) => q.key), ['held_reports', 'account_clusters'])
  assert.deepEqual(v.waiting[0].filter, { kind: 'held' })
  assert.equal(emptyLine(v.empty), 'Nothing waiting in Reddit disputes and Employer claims.')
  assert.equal(v.system.ok, true)
})

test('null and missing numbers stay null (couldn’t read) and mark the view degraded', () => {
  const v = readToday({ ...OK, degraded: true, failed: ['signups_24h', 'data_issues'], stats: { ...OK.stats, signups_24h: null, revenue_7d_cents: undefined },
    queues: [...OK.queues, { key: 'data_issues', label: 'Data issues', count: null, section: 'review' }] })
  assert.equal(v.stats.signups_24h, null); assert.equal(v.stats.revenue_7d_cents, null)
  assert.equal(v.degraded, true)
  assert.deepEqual(v.failedLabels, ['new sign-ups', 'data issues'])
  assert.ok(v.waiting.some((q) => q.key === 'data_issues' && q.count === null), 'an unreadable queue is shown, not folded as empty')
  const silent = readToday({ ...OK, degraded: false, stats: { ...OK.stats, reports_24h: null } })
  assert.equal(silent.degraded, true, 'a null number is degraded even if the server forgot to say so')
})

test('a malformed answer reads as unknown, never throws', () => {
  for (const raw of [null, undefined, 'x', {}, { stats: 'no', queues: 'no', system: null }, { queues: [null, { key: 7 }] }]) {
    const v = readToday(raw)
    assert.equal(v.stats.listings_live, null)
    assert.equal(v.system.ok, null)
    assert.match(v.system.line, /could not be read/)
  }
  assert.equal(readToday({ stats: { listings_live: -5, reports_24h: Number.NaN } }).stats.listings_live, null)
})

test('"ok" with no runs recorded reads as unknown, never "on time"', () => {
  const v = readToday({ ...OK, system: { ok: true, line: 'No cron reports its runs yet (17 scheduled).' } })
  assert.equal(v.system.ok, null)
  assert.equal(readToday(OK).system.ok, true)
})

test('money and the fold line read as a person would say them', () => {
  assert.equal(money(4997), '$49.97'); assert.equal(money(0), '$0.00'); assert.equal(money(123456789), '$1,234,567.89')
  assert.equal(emptyLine([{ label: 'Data issues' }]), 'Nothing waiting in Data issues.')
  assert.equal(emptyLine([{ label: 'A' }, { label: 'B' }, { label: 'C' }]), 'Nothing waiting in A, B and C.')
  assert.equal(emptyLine([]), '')
})

// People / Companies / System adapters: Pro reads as a window in California days, a picked date ends at
// that California day's last second, ledger and cluster words are plain, a company's evidence says what it
// counts, cron schedules read as words in California time, flags tell the truth about on/off.
// Run: node --test components/admin2/sections/people/people.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { proLine, endOfPacificDay, readUserDetail, ledgerWords, signupWords, readAttribution, readCluster, signalWords, userSub } from './adapter.ts'
import { companyLine, displayName, evidence, readCompanyDetail, readDupeGroups } from '../companies/adapter.ts'
import { cronOneInWords, cronInWords, cronState, readCron, cronSummary, readFlags, flagIsOn, flagStateWords, dangerConsequence, readRevenue, readActivity, canOpen } from '../system/adapter.ts'

const now = Date.parse('2026-11-10T20:00:00Z')

test('Pro is a window: until / ended / never / an old flag', () => {
  assert.equal(proLine({ pro_until: '2026-11-24T07:59:59Z', pro_active: true, comped: false }, now), 'Pro until Nov 23, 2026')
  assert.equal(proLine({ pro_until: '2026-10-02T12:00:00Z', pro_active: false, comped: false }, now), 'Pro ended Oct 2, 2026')
  assert.equal(proLine({ pro_until: null, pro_active: false, comped: false }, now), 'Never Pro')
  assert.match(proLine({ pro_until: null, pro_active: true, comped: true }, now), /old lifetime grant/)
})

test('a picked California day ends at its last second, across both clock changes', () => {
  assert.equal(endOfPacificDay('2026-07-04'), '2026-07-05T06:59:59.000Z') // PDT
  assert.equal(endOfPacificDay('2026-12-24'), '2026-12-25T07:59:59.000Z') // PST
  assert.equal(endOfPacificDay('2026-11-01'), '2026-11-02T07:59:59.000Z') // the day the clocks go back
  assert.equal(endOfPacificDay('nope'), null)
})

test('an account and its ledger read plainly; an unread balance says so', () => {
  const u = readUserDetail({ rows: [{ id: 'u1', email: 'jo@x.com', created_at: '2026-11-02T18:00:00Z', balance: null, pro_active: false, ledger: [{ delta: 5, reason: 'admin_grant', created_at: 'x' }, { delta: -1, reason: 'spend', created_at: 'y' }], applications: 3, reports: null }] })
  assert.equal(u.balance, null); assert.equal(u.reports, null); assert.equal(u.applications, 3)
  assert.equal(ledgerWords(u.ledger[0]), '+5 Granted by an admin')
  assert.equal(ledgerWords(u.ledger[1]), '−1 Used')
  assert.match(userSub(u), /balance couldn’t be read/)
  assert.equal(readUserDetail({ rows: [] }), null)
})

test('sign-up sources: not recorded yet is said, groups keep what they count', () => {
  assert.equal(readAttribution({ report: { ok: true, ready: false, days: 30 } }).ready, false)
  const a = readAttribution({ total: { signups: 9, tracked: 3, pro_or_trial: 1, paid: null }, by_landing: [{ key: 'company', label: 'A company page', signups: 5, tracked: 2, pro_or_trial: 1, paid: null }], by_utm_source: [{ key: '(none)', signups: 9 }] })
  assert.equal(a.total.signups, 9); assert.equal(a.total.paid, null)
  assert.deepEqual(a.groups.map((g) => g.title), ['First page they landed on'])
})

test('clusters: emails when the server sends them, signals in words', () => {
  const c = readCluster({ id: 12, user_ids: ['a', 'b'], users: [{ id: 'a', email: 'a@x' }, { id: 'b', email: null }], signals: ['ip:1.2.3.4'], risk_score: 40, status: 'suspected' })
  assert.equal(c.users[0].email, 'a@x'); assert.equal(c.users[1].email, null); assert.equal(c.id, '12')
  assert.equal(signalWords('ip:1.2.3.4'), 'Signed in from the same address (1.2.3.4)')
})

test('companies: names, lines and evidence that say what they count', () => {
  assert.equal(displayName('home depot'), 'Home Depot'); assert.equal(displayName('SpaceX'), 'SpaceX')
  assert.equal(companyLine({ id: '1', name: 'x', overall_score: 63.2, report_count: 412, ghost_rate: 0.31, response_rate: 0.54 }), 'Score 63 · 412 applicant accounts counted · 31% ghosted · 54% heard back')
  const d = readCompanyDetail({ rows: [{ name: 'acme', score: { overall_score: 70, first_party_report_count: 4, report_count: 9, mention_count: null }, reports_total: 12, held: null, merges: [], perks: null }] })
  const ev = evidence(d)
  assert.equal(ev.find((e) => e.label === 'Online mentions').value, null)
  assert.equal(ev.find((e) => e.label === 'Held for review').value, null)
  assert.ok(ev.every((e) => e.what.length > 10))
  const g = readDupeGroups({ rows: [{ key: 'acme', auto: true, companies: [{ id: 1, name: 'acme' }, { id: 2, name: 'acme inc' }] }, { key: 'solo', companies: [{ id: 3, name: 'x' }] }], total: 1774 })
  assert.equal(g.groups.length, 1); assert.equal(g.total, 1774)
})

test('cron schedules read as words in California time', () => {
  const ref = new Date('2026-11-10T12:00:00Z') // PST
  assert.equal(cronOneInWords('0 15 * * *', ref), 'Every day at 7:00 AM')
  assert.equal(cronOneInWords('35 * * * *', ref), 'Every hour at :35')
  assert.equal(cronOneInWords('0 8 * * 1', ref), 'Every Monday at 12:00 AM')
  assert.equal(cronOneInWords('0 2,14 * * *', ref), 'Every day at 6:00 AM and 6:00 PM')
  assert.equal(cronOneInWords('0 */4 * * *', ref), 'Every 4 hours')
  assert.equal(cronOneInWords('0 3 1 * *', ref), 'On day 1 of each month at 7:00 PM')
  assert.equal(cronInWords('0 15 * * *; 35 * * * *', ref), 'Every day at 7:00 AM; Every hour at :35')
  assert.equal(cronOneInWords('weird', ref), 'weird')
  assert.equal(cronInWords('0 2 * * *; 0 14 * * *', ref), 'Every day at 6:00 AM and 6:00 PM')
})

test('cron rows: unknown stays "No run recorded yet", overdue is bad, the summary never says on time without a record', () => {
  const unknown = readCron({ name: 'company-signals', schedule: '0 8 * * 1', last_run: null, last_result: 'unknown', overdue: false })
  assert.equal(cronState(unknown).word, 'No run recorded yet')
  assert.equal(cronState(readCron({ name: 'r', last_result: 'ok', overdue: true })).word, 'Overdue')
  assert.match(cronSummary([unknown]), /None of the 1 scheduled jobs records its runs yet/)
  assert.match(cronSummary([unknown, readCron({ name: 'r', last_result: 'ok' })]), /^1 of 2 scheduled jobs record their runs and none of those is late\. 1 record nothing yet\.$/)
})

test('flags: on/off as the reader decides; the credit flag unset means free for everyone', () => {
  const { flags, unread } = readFlags({ rows: [
    { flag_name: 'ai_credit_system_enabled', status: null, exists: false, dangerous: true, readers: ['lib/server/credits.js:128'] },
    { flag_name: 'seenfit_engine_enabled', status: 'beta_users', exists: true, readers: ['api/optimizer.js:75'] },
    { flag_name: 'humanproof_enabled', status: 'off', exists: true },
  ], unread: ['job_refresh_enabled'] })
  assert.equal(flagIsOn(flags[0]), false, 'no row = the credit gate is bypassed (credits.js)')
  assert.match(flagStateWords(flags[0]), /^Off — not set/)
  assert.equal(flagIsOn(flags[1]), true)
  assert.match(flagStateWords(flags[1]), /treats as on for everyone/)
  assert.equal(flagIsOn(flags[2]), false)
  assert.equal(dangerConsequence(flags[0], false), 'Everyone gets paid features free until you turn it back on.')
  assert.deepEqual(unread, ['job_refresh_enabled'])
})

test('revenue and the activity log', () => {
  const r = readRevenue({ rows: [{ days: 30, total_cents: null, consumer: [{ sku: 'interview', name: 'Interview Prep', count: 2, cents: 1998 }], employer_cents: 0, source: 'credit_transactions…' }] })
  assert.equal(r.total, null); assert.equal(r.consumer[0].cents, 1998)
  const a = readActivity({ id: 2103, at: 'x', action: 'review_held', target_kind: 'bulk', target_id: null, summary: 'Approved 288', undoable: true })
  assert.equal(a.id, '2103'); assert.equal(canOpen(a), false)
  assert.equal(canOpen(readActivity({ id: 1, target_kind: 'job', target_id: 'j1' })), true)
})

test('the ledger carries the grant reason and who; the sign-up source reads as words; earned/spent null stays null', () => {
  const u = readUserDetail({ rows: [{ id: 'u1', ledger: [{ delta: 5, reason: 'admin_grant', note: 'refund for a bad prep', by: 'owner', created_at: 'x' }], credits_earned: null, credits_spent: 12, signup_source: { landing_path: '/company/walmart', referrer_host: 'google.com', utm_source: null } }] })
  assert.equal(ledgerWords(u.ledger[0]), '+5 Granted by an admin — “refund for a bad prep” by owner')
  assert.equal(u.earned, null); assert.equal(u.spent, 12)
  assert.match(signupWords(u.signup), /^First page \/company\/walmart from google\.com\.$/)
  assert.match(signupWords(null), /^Not recorded/)
})

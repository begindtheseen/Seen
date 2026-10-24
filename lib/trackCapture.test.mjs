// Run: node --test lib/trackCapture.test.mjs
// "When did you apply?" → appliedAt, the check-in emails the cron really sends, and the guest's
// application carried through sign-up without ever being created twice.
import test from 'node:test'
import assert from 'node:assert/strict'
import { APPLIED_CHOICES, appliedAtFromChoice, earliestAppliedDay, checkinEmailPlan, milestoneForAge, nextCronRun, joinDays, pendingFromGuestApps, pendingToCreate, cleanPending, applicationFromPending } from './trackCapture.ts'
import { pacificDate } from './time/pacific.js'
import { dueMilestone, milestoneForAge as serverMilestone } from './server/outcomeEmails.js'

const DAY = 86400e3
// 2026-10-24 10:00 PT (17:00 UTC)
const NOW = Date.parse('2026-10-24T17:00:00Z')
// 2026-10-24 23:30 PT — already Oct 25 in UTC
const LATE = Date.parse('2026-10-25T06:30:00Z')

test('each choice maps to a California day; today keeps the clock, other days are noon PT', () => {
  assert.deepEqual(APPLIED_CHOICES.map(c => c.value), ['today', 'days', 'week', 'weeks', 'date'])
  assert.equal(appliedAtFromChoice('today', null, NOW), NOW)
  const cases = { days: '2026-10-22', week: '2026-10-17', weeks: '2026-10-10' }
  for (const [choice, day] of Object.entries(cases)) {
    const t = appliedAtFromChoice(choice, null, NOW)
    assert.equal(pacificDate(new Date(t)), day, choice)
    assert.equal(new Date(t).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', hour12: false }), '12', `${choice} is noon PT`)
  }
  // late evening in California: "today" is still Oct 24 and a week ago is Oct 17, not the UTC day
  assert.equal(pacificDate(new Date(appliedAtFromChoice('today', null, LATE))), '2026-10-24')
  assert.equal(pacificDate(new Date(appliedAtFromChoice('week', null, LATE))), '2026-10-17')
})

test('a picked date is used as is; future, malformed and over-a-year-old dates are refused', () => {
  assert.equal(pacificDate(new Date(appliedAtFromChoice('date', '2026-09-30', NOW))), '2026-09-30')
  assert.equal(appliedAtFromChoice('date', '2026-10-24', NOW), NOW) // today keeps the clock
  assert.equal(appliedAtFromChoice('date', '2026-10-25', NOW), null)
  assert.equal(appliedAtFromChoice('date', '10/01/2026', NOW), null)
  assert.equal(appliedAtFromChoice('date', null, NOW), null)
  assert.equal(earliestAppliedDay(NOW), '2025-10-24')
  assert.equal(appliedAtFromChoice('date', '2025-10-23', NOW), null)
  assert.equal(appliedAtFromChoice('nope', null, NOW), null)
})

test('milestoneForAge is the cron\'s own rule', () => {
  for (let age = -2; age < 45; age++) assert.equal(milestoneForAge(age), serverMilestone(age), `age ${age}`)
  assert.equal(milestoneForAge(null), null)
  assert.equal(nextCronRun(Date.parse('2026-10-24T14:59:00Z')), Date.parse('2026-10-24T15:00:00Z'))
  assert.equal(nextCronRun(Date.parse('2026-10-24T15:00:01Z')), Date.parse('2026-10-25T15:00:00Z'))
})

test('applied today: emails on day 7, 14 and 30, on the cron\'s schedule', () => {
  const plan = checkinEmailPlan(NOW, NOW)
  assert.deepEqual(plan.map(p => p.day), [7, 14, 30])
  assert.deepEqual(plan.map(p => new Date(p.at).toISOString()), ['2026-11-01T15:00:00.000Z', '2026-11-08T15:00:00.000Z', '2026-11-24T15:00:00.000Z'])
  assert.equal(joinDays(plan), 'Nov 1, Nov 8 and Nov 24')
})

test('a backdated application never gets a day-7 email it is already past; the first one waits a week', () => {
  // applied 9 days ago, tracked now: the row is eligible after 7 days (age 16) → the day-14 email, then day 30
  const applied = NOW - 9 * DAY
  const plan = checkinEmailPlan(applied, NOW)
  assert.deepEqual(plan.map(p => p.day), [14, 30])
  assert.ok(plan[0].at > NOW + 7 * DAY)
  // applied 3 weeks ago → age 28 at the first eligible run: the day-14 email, then day 30
  assert.deepEqual(checkinEmailPlan(NOW - 21 * DAY, NOW).map(p => p.day), [14, 30])
  // applied 25 days ago → age 32 at the first eligible run: one email, the day-30 question
  assert.deepEqual(checkinEmailPlan(NOW - 25 * DAY, NOW).map(p => p.day), [30])
  // applied 40 days ago → still one email (the cron sends day 30 once)
  assert.deepEqual(checkinEmailPlan(NOW - 40 * DAY, NOW).map(p => p.day), [30])
})

test('the plan agrees with the server\'s dueMilestone at every send', () => {
  for (const back of [0, 1, 2, 5, 7, 9, 13, 14, 20, 29, 30, 60]) {
    const applied = NOW - back * DAY
    for (const p of checkinEmailPlan(applied, NOW)) {
      const due = dueMilestone({ status: 'active', applied_at: new Date(applied).toISOString() }, p.at)
      assert.equal(due, p.day, `applied ${back}d ago, send at ${new Date(p.at).toISOString()}`)
      assert.ok(p.at - NOW > 7 * DAY, 'the cron only reads rows created more than 7 days ago')
    }
  }
})

const guest = (id, company, role, appliedAt, extra = {}) => ({ id, company, role, appliedAt, status: 'active', stage: 'Applied', events: [], updatedAt: appliedAt, ...extra })

test('pendingFromGuestApps carries this device\'s guest applications only, newest first, capped', () => {
  const apps = [
    guest('app_1761300000000', 'Walmart', 'Cashier', NOW - 2 * DAY),
    guest('app_1761300000001', 'Target', 'Stocker', NOW),
    guest('7aa38128-ec49-4d29-85b2-4d907c4fe713', 'Amazon', 'Picker', NOW), // an account row
    guest('app_1761300000002', 'Costco', 'Cashier', NOW, { status: 'rejected' }),
    guest('bad id', 'X', 'Y', NOW),
  ]
  const p = pendingFromGuestApps(apps)
  assert.deepEqual(p.map(x => x.company), ['Target', 'Walmart'])
  assert.deepEqual(Object.keys(p[0]).sort(), ['applied_at', 'company', 'id', 'role'])
  const many = Array.from({ length: 9 }, (_, i) => guest(`app_17613000000${10 + i}`, `Co ${i}`, 'Role', NOW - i * DAY))
  assert.equal(pendingFromGuestApps(many).length, 5)
})

test('pendingToCreate: created once on first sign-in — matched by client id or company + role + California day', () => {
  const p1 = { id: 'app_1761300000000', company: 'Walmart', role: 'Cashier', applied_at: new Date(NOW - 7 * DAY).toISOString() }
  const p2 = { id: 'app_1761300000001', company: 'Target', role: 'Stocker', applied_at: new Date(NOW).toISOString() }
  // a new device: the account has nothing → both are created
  assert.deepEqual(pendingToCreate([p1, p2], []).map(p => p.id), [p1.id, p2.id])
  // the same browser already uploaded Walmart (the account row has a uuid, same name/role/day, any case/spacing)
  const synced = [{ id: '7aa38128-ec49-4d29-85b2-4d907c4fe713', company: 'walmart ', role: 'CASHIER', appliedAt: NOW - 7 * DAY + 3600e3 }]
  assert.deepEqual(pendingToCreate([p1, p2], synced).map(p => p.id), [p2.id])
  // still on the device under its client id → not created again
  assert.deepEqual(pendingToCreate([p1], [{ id: p1.id, company: 'Walmart', role: 'Cashier', appliedAt: NOW }]), [])
  // the same company + role on a DIFFERENT day is a different application
  assert.equal(pendingToCreate([p1], [{ id: 'x', company: 'Walmart', role: 'Cashier', appliedAt: NOW }]).length, 1)
  // a repeated entry inside the metadata is created once; junk is ignored
  assert.equal(pendingToCreate([p1, { ...p1 }, { ...p1, id: 'app_1761300000009' }, null, 'x', { id: 'nope' }], []).length, 1)
  assert.deepEqual(pendingToCreate(null, []), [])
})

test('cleanPending / applicationFromPending shape what reaches AppStore.add', () => {
  assert.equal(cleanPending({ id: 'app_1761300000000', company: ' Walmart ', role: 'Cashier', applied_at: 'nope' }), null)
  const p = cleanPending({ id: 'app_1761300000000', company: ' Walmart  Inc ', role: 'Cashier', applied_at: '2026-10-17T19:00:00Z' })
  assert.deepEqual(p, { id: 'app_1761300000000', company: 'Walmart Inc', role: 'Cashier', applied_at: '2026-10-17T19:00:00.000Z' })
  const a = applicationFromPending(p)
  assert.equal(a.id, 'app_1761300000000')
  assert.equal(a.appliedAt, Date.parse('2026-10-17T19:00:00Z'))
  assert.equal(a.status, 'active')
})

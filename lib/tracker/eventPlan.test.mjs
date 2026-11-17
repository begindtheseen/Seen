// Run: node --test lib/tracker/eventPlan.test.mjs
// "I'm going" on the tracker: the plan, where it stands, the answer, and which email is due.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { eventStartClock, planEvent, plannedEvent, eventAnswer, eventAnsweredEvent, eventStage, eventEmailDue, EVENT_ANSWERS, dayIn } from './eventPlan.js'

const ev = { label: 'Hiring day', next: '2026-11-19', time: '11 AM–5 PM', where: '1919 Camelback Road, Phoenix, AZ 85016', virtual: false }
// 11:00 Phoenix (UTC-7) on Nov 19 = 18:00Z
const AT = '2026-11-19T18:00:00.001Z'
const app = (extra = {}) => ({ id: 'a1', status: 'active', stage: 'Applied', events: [{ type: 'application_submitted', date: 1 }, planEvent(ev, AT, 'job-1', 2)], ...extra })
const pt = (s) => Date.parse(s) // instants

test('the start of the hours, as a 24-hour clock', () => {
  assert.equal(eventStartClock('11 AM–5 PM'), '11:00')
  assert.equal(eventStartClock('10:30 AM–5 PM'), '10:30')
  assert.equal(eventStartClock('2–4 PM'), '14:00')
  assert.equal(eventStartClock('5:30–8 PM'), '17:30')
  assert.equal(eventStartClock('11–2 PM'), '11:00', 'a start after the end is the morning')
  assert.equal(eventStartClock('12–4 PM'), '12:00')
  assert.equal(eventStartClock('8 AM–12 PM'), '08:00')
  assert.equal(eventStartClock(null), '')
  assert.equal(eventStartClock('Thursdays'), '')
})

test('the plan rides on the tracker\'s interview date, with what the posting said', () => {
  const p = plannedEvent(app())
  assert.deepEqual(p, { at: AT, label: 'Hiring day', time: '11 AM–5 PM', where: '1919 Camelback Road, Phoenix, AZ 85016', virtual: false })
  const e = planEvent(ev, AT, 'job-1', 5)
  assert.equal(e.type, 'interview_scheduled')
  assert.equal(e.data.kind, 'hiring_event')
  assert.ok(JSON.stringify(e.data).length < 2000, 'fits the server\'s event-data cap')
  // A later interview date the person set by hand replaces the plan.
  const later = app({ events: [...app().events, { type: 'interview_scheduled', date: 9, data: { at: '2026-11-25T20:00:00.001Z' } }] })
  assert.equal(plannedEvent(later), null)
})

test('where it stands, by the calendar day', () => {
  assert.equal(eventStage(app(), pt('2026-11-17T20:00:00Z')), 'upcoming')
  assert.equal(eventStage(app(), pt('2026-11-19T20:00:00Z')), 'today')
  assert.equal(eventStage(app(), pt('2026-11-20T16:00:00Z')), 'ask')
  const answered = app({ events: [...app().events, eventAnsweredEvent('nothing', 10)] })
  assert.equal(eventAnswer(answered), 'nothing')
  assert.equal(eventStage(answered, pt('2026-11-20T16:00:00Z')), 'answered')
  assert.equal(eventStage(app({ status: 'withdrawn' }), pt('2026-11-20T16:00:00Z')), null)
  assert.equal(eventStage({ status: 'active', events: [] }), null)
})

test('emails: the day before, then "how did it go?" for three days unless answered', () => {
  assert.equal(eventEmailDue(app(), pt('2026-11-18T15:00:00Z')), 'eve') // 7 AM Pacific, Nov 18
  assert.equal(eventEmailDue(app(), pt('2026-11-17T15:00:00Z')), null)
  assert.equal(eventEmailDue(app(), pt('2026-11-19T15:00:00Z')), null, 'nothing on the day itself')
  assert.equal(eventEmailDue(app(), pt('2026-11-20T15:00:00Z')), 'after')
  assert.equal(eventEmailDue(app(), pt('2026-11-22T15:00:00Z')), 'after')
  assert.equal(eventEmailDue(app(), pt('2026-11-23T15:00:00Z')), null, 'stops after three days')
  assert.equal(eventEmailDue(app({ events: [...app().events, eventAnsweredEvent('offer', 10)] }), pt('2026-11-20T15:00:00Z')), null)
  assert.equal(eventEmailDue(app({ status: 'hired' }), pt('2026-11-20T15:00:00Z')), null)
})

test('each answer moves the card the way it says', () => {
  assert.deepEqual(EVENT_ANSWERS.offer.changes, { stage: 'Offer' })
  assert.deepEqual(EVENT_ANSWERS.interviewed.changes, { stage: 'Interview' })
  assert.deepEqual(EVENT_ANSWERS.nothing.changes, {})
  assert.deepEqual(EVENT_ANSWERS.didnt_go.changes, { status: 'withdrawn' }, 'not going is the person\'s move, never a report against the company')
})

test('days are read on the Pacific clock by default', () => {
  assert.equal(dayIn('2026-11-20T06:30:00Z'), '2026-11-19')
  assert.equal(dayIn('2026-11-20T06:30:00Z', 'UTC'), '2026-11-20')
})

test('the tracker card\'s role from an event listing\'s title', async () => {
  const { roleFromEventTitle: r } = await import('./eventPlan.js')
  assert.equal(r('Certified Nurse Aide Hiring Event- Thursday, November 19th, 2026', 'Carmel Richmond'), 'Certified Nurse Aide')
  assert.equal(r('Graham Packaging | Walk-In Interviews | Thursday, Nov 19th from 2PM - 4PM', 'Graham Packaging', 'Walk-in interviews'), 'Walk-in interviews')
  assert.equal(r('Nordstrom Hiring Day - Thursday, November 19, 2026, 11 AM - 5 PM – Last Chance Phoenix', 'Nordstrom', 'Hiring day'), 'Last Chance Phoenix')
  assert.equal(r('PCT Certified-HIRING EVENT NOVEMBER 17TH AND 18TH', 'U.S. Renal Care'), 'PCT Certified')
  assert.equal(r('Open House Hiring Event- Warehouse Workers & Clerks', 'Penske'), 'Warehouse Workers & Clerks')
  assert.equal(r('Caregiver/CNA Hiring Event', 'BrightSpring Health Services'), 'Caregiver/CNA')
  assert.equal(r('Hiring Day!', 'Windsor Communities', 'Hiring day'), 'Hiring day')
  assert.equal(r('Front Desk Agent ("Agente de Recepcion")', 'Azul Hospitality'), 'Front Desk Agent ("Agente de Recepcion")')
})

// Run: node --test lib/jobs/hiringEvents.test.mjs
// The hiring-event reader on real postings from Seen's corpus (lib/jobs/fixtures/hiringEvents.json, read 2026-11-15)
// and on the sentences that would otherwise read wrong.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseHiringEvent, upcomingHiringEvent, eventDateLabel, listingHiringEvent } from './hiringEvents.js'

const corpus = JSON.parse(readFileSync(new URL('./fixtures/hiringEvents.json', import.meta.url), 'utf8'))
const byTitle = (start) => {
  const r = corpus.find((x) => x.title.startsWith(start))
  assert.ok(r, `fixture missing: ${start}`)
  return r
}
const NOW = new Date('2026-11-15T18:00:00Z') // Sunday, Nov 15 2026, Pacific

test('a dated event with its hours and an address with a ZIP', () => {
  const e = parseHiringEvent(byTitle('Nordstrom Hiring Day'))
  assert.equal(e.label, 'Hiring day')
  assert.deepEqual(e.dates, ['2026-11-19'])
  assert.equal(e.time, '11 AM–5 PM')
  assert.equal(e.where, '1919 Camelback Road, Phoenix, AZ 85016')
  assert.equal(e.walkIn, true)
  assert.equal(eventDateLabel(e), 'Thu, Nov 19')
})

test('two days written as "NOVEMBER 17TH AND 18TH" and "11/12 & 11/17"', () => {
  assert.deepEqual(parseHiringEvent(byTitle('PCT Certified-HIRING EVENT')).dates, ['2026-11-17', '2026-11-18'])
  const goat = parseHiringEvent(byTitle('HIRING EVENT 11/12 & 11/17'))
  assert.deepEqual(goat.dates, ['2026-11-12', '2026-11-17'])
  assert.equal(goat.rsvp, true)
  assert.equal(goat.walkIn, true)
  assert.equal(eventDateLabel(goat), 'Nov 12 & 17')
})

test('a stale weekday line in the title loses to the body that agrees with the calendar', () => {
  // Title: "Saturday, October 21"; body: "on Saturday, November 21st" (a Saturday in 2026).
  const e = parseHiringEvent(byTitle('Manufacturing Technician Hiring Event'))
  assert.deepEqual(e.dates, ['2026-11-21'])
  assert.equal(e.inviteOnly, true)
  assert.equal(e.time, null, 'a shift schedule elsewhere in the posting is not the event hours')
})

test('walk-in interviews and weekly open interviews', () => {
  const w = parseHiringEvent(byTitle('Graham Packaging | Walk-In Interviews'))
  assert.equal(w.kind, 'walk_in')
  assert.deepEqual(w.dates, ['2026-11-19'])
  assert.equal(w.time, '2–4 PM')
  const o = upcomingHiringEvent(byTitle('Nurse Aide - CNA / STNA - Open Interviews'), NOW)
  assert.equal(o.recurring, 'Thursdays')
  assert.equal(o.next, '2026-11-19')
  assert.equal(o.time, '10 AM–4:30 PM')
  assert.equal(eventDateLabel(o), 'Thursdays')
})

test('virtual events say so', () => {
  assert.equal(parseHiringEvent(byTitle('Virtual Hiring Event - Fulfillment Center Supervisors')).virtual, true)
  assert.equal(parseHiringEvent(byTitle('L3Harris Engineering Hiring Event 12/2')).virtual, true)
})

test('an event only in the body, with an invitation, counts', () => {
  const e = parseHiringEvent(byTitle('Front Desk Agent ("Agente de Recepcion")'))
  assert.equal(e.label, 'Job fair')
  assert.deepEqual(e.dates, ['2026-10-28'])
  assert.equal(e.where, '21001 N. Tatum Blvd., Phoenix, AZ 85050')
})

test('not events: duty lines, booth follow-up forms, a form title, "walk-in" services, no date', () => {
  for (const t of ['Recruiting Coordinator', 'Field Claims Supervisor', '2026 NES Optics', 'Gotion College Career Fair', 'KCC Career Fair',
    'Odessa Career Fair', 'Job Fair Application', 'UCI Career Fair', 'Walk-In Retail Associate', 'Peer Specialist I - Walk-in Crisis Center',
    'Full Time Mental Health Clinician Urgent Care Walk-In', 'Hiring Event Associate Banker']) {
    assert.equal(parseHiringEvent(byTitle(t)), null, t)
  }
})

test('a posting whose event dates have passed is not upcoming', () => {
  assert.equal(upcomingHiringEvent(byTitle('Silverado Senior Living Encinitas'), NOW), null) // Nov 11
  assert.equal(upcomingHiringEvent(byTitle('📢 Apply Today! Security Career Fair! – Fort Worth'), NOW), null) // Oct 22
  // Two dates, one passed: only the coming one stays.
  const goat = upcomingHiringEvent(byTitle('HIRING EVENT 11/12 & 11/17'), NOW)
  assert.deepEqual(goat.dates, ['2026-11-17'])
  assert.equal(goat.next, '2026-11-17')
  // Today counts (Pacific day).
  assert.ok(upcomingHiringEvent(byTitle('Nordstrom Hiring Day'), new Date('2026-11-19T23:00:00Z')))
})

test('an event dated before the posting went up is not carried into next year', () => {
  // Posted 2026-10-27 for "Thursday, August 13th" — August 13, 2027 is a Friday and 9+ months on: no event.
  assert.equal(parseHiringEvent(byTitle('Potomac Social Tavern Hiring Event')), null)
  // Posted 2026-07-19 for "Wednesday, March 25th" — March 25, 2027 is a Thursday: no event.
  assert.equal(parseHiringEvent(byTitle('Hiring Event - Software Engineers')), null)
})

test('synthetic sentences: year inference, numbers that are not dates, plain duties', () => {
  const ev = (title, description, created_at = '2026-11-14T00:00:00Z') => parseHiringEvent({ title, description, created_at })
  assert.deepEqual(ev('Warehouse Hiring Event - Jan 8', 'Join us for our hiring event!').dates, ['2027-01-08'], 'a January date posted in November is next year')
  assert.equal(ev('Warehouse Associate', 'Coordinate hiring event logistics with the recruiting team on 11/20.'), null)
  assert.equal(ev('Security Officer', 'Work 24/7 coverage. Our job fair team attends 3/4 of local events.'), null)
  assert.deepEqual(ev('Warehouse Associate', 'We are hosting a hiring event on Friday, November 20 from 9am-1pm at 100 Main St, Mesa, AZ 85201. Walk-ins welcome.').dates, ['2026-11-20'])
  assert.equal(ev('Warehouse Associate', 'We are hosting a hiring event on Friday, November 20 from 9am-1pm at 100 Main St, Mesa, AZ 85201.').time, '9 AM–1 PM')
})

test('the search row carries only what the card and the drawer need, or null', () => {
  const row = listingHiringEvent(byTitle('Nordstrom Hiring Day'), NOW)
  assert.deepEqual(Object.keys(row).sort(), ['dates', 'inviteOnly', 'kind', 'label', 'next', 'onTheSpot', 'recurring', 'rsvp', 'time', 'virtual', 'walkIn', 'where'].sort())
  assert.equal(listingHiringEvent({ title: 'Cashier', description: 'Ring up customers.', created_at: '2026-11-14T00:00:00Z' }, NOW), null)
})

test('the fixture set reads as it was judged by hand (no surprises on the whole corpus)', () => {
  let events = 0
  for (const r of corpus) {
    const e = parseHiringEvent(r)
    if (!e) continue
    events++
    for (const d of e.dates) assert.match(d, /^2026-(?:1[0-2])-\d{2}$/, `${r.title}: ${d}`)
    if (e.where) assert.match(e.where, /\b[A-Z]{2},?\s+\d{5}$/, `${r.title}: ${e.where}`)
    if (e.time) assert.match(e.time, /^\d{1,2}(?::\d{2})?(?: [AP]M)?–\d{1,2}(?::\d{2})? [AP]M$/, `${r.title}: ${e.time}`)
  }
  assert.ok(events >= 40, `events read: ${events}`)
})

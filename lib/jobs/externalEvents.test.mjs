// Run: node --test lib/jobs/externalEvents.test.mjs
// External hiring events: every parser on a real answer saved from its source on 2026-11-17
// (lib/jobs/fixtures/externalEvents/), what counts as a general fair, apprenticeship windows on the Pacific clock,
// and which guide each row lands on (the guides' own position vocabulary).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  decodeEntities, plainText, readDate, clockRange, readClockRange, classifyFair, fairLabel, fairRow,
  parseTribeEvents, parseEddEvents, parseMarylandFairs, parseWestVirginiaFairs, parseCareerForceEvents,
  parseNyAnnouncements, parseNyAnnouncement, nyTradeOf, windowRow, windowState, windowLabel, windowDateLabel,
  upcomingExternal, externalBelongs, STALE_WINDOW_DAYS,
} from './externalEvents.js'
import { eventStartClock } from '../tracker/eventPlan.js'
import { CONTENT } from '../start/registry.js'

const F = (n) => readFileSync(new URL(`./fixtures/externalEvents/${n}`, import.meta.url), 'utf8')
const J = (n) => JSON.parse(F(n))
const WINDOWS = JSON.parse(readFileSync(new URL('./data/apprenticeshipWindows.json', import.meta.url), 'utf8')).windows
const NOW = new Date('2026-11-17T20:00:00Z') // Tue Nov 17, 2026, noon Pacific
const L = (f) => CONTENT[f].listings

test('text helpers: entities decoded once, dates need a year, hours read as the tracker reads them', () => {
  assert.equal(decodeEntities('Fish &amp;amp; Chips &#8211; &#x2014; &rsquo;'), 'Fish &amp; Chips – — ’')
  assert.equal(plainText('<p>Hiring <b>Event</b></p><script>x()</script>'), 'Hiring Event')
  assert.equal(readDate('Thursday December 3, 2026 10 a.m.'), '2026-12-03')
  assert.equal(readDate('Date: 12/02/2026'), '2026-12-02')
  assert.equal(readDate('11/9/26'), '2026-11-09')
  assert.equal(readDate('November 18'), '', 'a date without a year is never guessed here')
  assert.equal(readDate('February 30, 2027'), '')
  assert.equal(clockRange('10:00', '14:00'), '10 AM–2 PM')
  assert.equal(clockRange('10:30', '12:00'), '10:30 AM–12 PM')
  assert.equal(readClockRange('4 p.m. - 6 p.m.'), '4 PM–6 PM')
  assert.equal(readClockRange('10 a.m.-12 p.m.'), '10 AM–12 PM')
  assert.equal(readClockRange('3:00 PM to 5:00 PM'), '3 PM–5 PM')
  // "I'm going" reads the start time from exactly this format.
  assert.equal(eventStartClock(clockRange('10:30', '12:00')), '10:30')
  assert.equal(eventStartClock(readClockRange('4 p.m. - 6 p.m.')), '16:00')
})

test('what a fair is: general fairs, one employer\'s events, field fairs, workshops about fairs', () => {
  const g = (t, place = '') => classifyFair(t, { place })
  for (const t of ['Fredericksburg: Multi-Employer Hiring Event', 'Workforce Wednesday Virtual Job Fair', 'Congressman Marc Veasey 11th Annual Job Fair', 'Job Fair/Hiring Event', 'Hiring Red, White, & You! Statewide Hiring Event', "Spring '27 Job Fair", 'Mini Job Fair at RochesterWorks (12/3)'])
    assert.equal(g(t)?.general, true, t)
  assert.equal(g('Sacramento Job Fair', 'Sacramento, CA').general, true, 'a fair named for its own town')
  assert.equal(g('Cottonwood Area Career Fair 2027', 'Cottonwood, MN').general, true)
  for (const t of ['Randstad Hiring Event', 'HIRING EVENT: Material Handlers', 'Job Fair with Housing Authority of City of Austin', '3M New Ulm Job Fair', 'USPS Job Fair – Charlottesville VA', 'AtWork Job Fair'])
    assert.equal(g(t)?.general, false, `${t} is one organisation's event`)
  for (const t of ['Healthcare Job Fair', 'Skipwith Academy to Host Childcare Job Fair', 'Monroe Community Hospital Monthly Job Fair!', 'IT Job Fair', 'Meet the Employers Hiring Event & CDL Exploration'])
    assert.equal(g(t)?.general, false, `${t} is a field fair`)
  assert.equal(g('Make it count: Regional Job Fair')?.general, true, 'the word "it" is not IT')
  for (const t of ['Navigating a Job Fair', 'Job Fair Prep Class', 'Community Connections Resource Fair', 'Resume Workshop', 'Board of Directors Meeting'])
    assert.equal(g(t), null, `${t} is not a hiring event`)
  assert.equal(g('Fredericksburg: Multi-Employer Hiring Event').many, true)
  assert.equal(g('Workforce Wednesday Virtual Job Fair').many, false, '"many employers" only when the title says so')
})

test('The Events Calendar JSON (Virginia Works, WFS Dallas, Idaho DOL, WFS North Texas): hiring events only, with place, hours and the agency page', () => {
  const va = parseTribeEvents(J('tribe-virginiaworks.json'), { source: 'va', sourceName: 'Virginia Works', state: 'VA' })
  assert.ok(va.length >= 15, `Virginia Works lists ${va.length}`)
  const fred = va.find((r) => /Fredericksburg: Multi-Employer/.test(r.title))
  assert.equal(fred.event.next, '2026-11-19')
  assert.equal(fred.event.time, '10 AM–2 PM')
  assert.equal(fred.location, 'Fredericksburg, VA')
  assert.ok(fred.external.general && fred.external.many)
  assert.equal(fairLabel(fred), 'Job fair · many employers · Virginia Works')
  assert.match(fred.url, /^https:\/\/virginiaworks\.gov\/event\//)
  const virt = va.find((r) => /Workforce Wednesday Virtual Job Fair/.test(r.title))
  assert.equal(virt.event.virtual, true)
  assert.equal(virt.location, 'Virtual · Virginia')
  assert.ok(va.every((r) => r.external.type === 'fair' && /^\d{4}-\d{2}-\d{2}$/.test(r.event.next) && r.external.src))
  const dal = parseTribeEvents(J('tribe-wfsdallas.json'), { source: 'dal', sourceName: 'Workforce Solutions Greater Dallas', state: 'TX' })
  assert.deepEqual(dal.map((r) => r.title).sort(), ['Midway Hiring Event', 'Opportunity Center Job Fair', 'Randstad Hiring Event'])
  assert.match(dal.find((r) => r.title === 'Randstad Hiring Event').roles, /Warehouse|Material Handler/i, 'the roles the event hires for, from its own text')
  const ntx = parseTribeEvents(J('tribe-ntx.json'), { source: 'ntx', sourceName: 'Workforce Solutions North Texas', state: 'TX' })
  assert.ok(ntx.some((r) => r.title === 'HIRING EVENT: Material Handlers' && r.location === 'Vernon, TX'))
  const id = parseTribeEvents(J('tribe-idaho.json'), { source: 'id', sourceName: 'Idaho Department of Labor', state: 'ID' })
  assert.ok(id.length >= 3 && id.every((r) => / ID$/.test(r.location)))
  // A calendar of workshops (including "Navigating a Job Fair") has no hiring event.
  assert.equal(parseTribeEvents(J('tribe-csfl-central.json'), { source: 'c', sourceName: 'CareerSource Central Florida', state: 'FL' }).length, 0)
})

test('state pages: California EDD (workshops only today), Maryland, West Virginia, CareerForce Minnesota', () => {
  const edd = parseEddEvents(F('edd.html'), { source: 'edd', sourceName: 'California EDD' })
  assert.equal(edd.length, 0, 'every EDD card on 2026-11-17 was a workshop or orientation')
  const fake = '<li class="card card-default event-card" data-date="12/09/2026 10:00:00 AM" data-location="modesto" data-type="in-person" data-name="Stanislaus County Job Fair" data-full-text="Register at CalJOBS"><a class="main-link" href="/en/jobs_and_training/Job_Fairs_and_Workshops/20261209--job-fair/"></a><time datetime="12/09/2026 10:00" ></time><time datetime="12/09/2026 14:00" ></time></li>'
  const [one] = parseEddEvents(fake, { source: 'edd', sourceName: 'California EDD' })
  assert.equal(one.location, 'Modesto, CA')
  assert.equal(one.event.time, '10 AM–2 PM')
  assert.equal(one.url, 'https://edd.ca.gov/en/jobs_and_training/Job_Fairs_and_Workshops/20261209--job-fair/')

  const md = parseMarylandFairs(F('maryland.html'), { source: 'md', sourceName: 'Maryland Department of Labor', src: 'https://labor.md.gov/employment/jobfairs.shtml' })
  const lanham = md.find((r) => /Doctors Community Medical Center/.test(r.title))
  assert.equal(lanham.event.next, '2026-11-18')
  assert.equal(lanham.event.time, '4 PM–6 PM')
  assert.equal(lanham.location, 'Lanham, MD')
  assert.equal(lanham.external.general, false, 'a nursing hiring event is a field event')
  const carroll = md.filter((r) => /Carroll County/.test(r.title))
  assert.ok(carroll.some((r) => r.event.next === '2026-12-03' && r.event.virtual && r.external.general))

  const wv = parseWestVirginiaFairs(F('westvirginia.html'), { source: 'wv', sourceName: 'WorkForce West Virginia', src: 'https://workforcewv.org/job-seeker/find-a-job/job-fairs/' })
  assert.ok(wv.length >= 6)
  assert.ok(!wv.some((r) => /Resource Fair/.test(r.title)), 'a resource fair is not a hiring event')
  assert.ok(wv.some((r) => /Statewide Monthly Virtual Job Fair/.test(r.title) && r.event.virtual && r.external.general))
  assert.ok(wv.every((r) => /^https:\/\/workforcewv\.org\//.test(r.url)), 'each row links its flyer or the page')

  const mn = parseCareerForceEvents(F('careerforce-mn.html'), { source: 'mn', sourceName: 'CareerForce Minnesota' })
  const forest = mn.find((r) => r.location === 'Forest Lake, MN')
  assert.equal(forest.title, 'Job Fair/Hiring Event')
  assert.equal(forest.event.time, '1 PM–3 PM')
  assert.ok(mn.every((r) => /^https:\/\/careerforce\.mn\.gov\/events\//.test(r.url)))
  assert.ok(!mn.some((r) => /Learn about employment/.test(r.title)), 'an information session is not a hiring event')
})

test('New York DOL apprenticeship announcements: windows with official dates, the city from the announcement', () => {
  const list = parseNyAnnouncements(F('nydol-list.html'))
  assert.equal(list.length, 10)
  const nas = list[0]
  assert.equal(nas.title, 'North Atlantic States Carpenters Training Fund')
  assert.equal(nas.opens, '2026-11-09')
  assert.equal(nas.closes, '2027-11-07')
  assert.deepEqual(nas.regions, ['Central New York', 'Southern Tier'])
  assert.ok(list.some((x) => x.closed && /Operating Engineers Local 825/.test(x.title)))
  assert.equal(nyTradeOf(nas.title), 'carpentry')
  assert.equal(nyTradeOf('JAC IBEW Electrical Local # 3'), 'electrical')
  assert.equal(nyTradeOf('Bricklayers & Allied Craftworkers Local # 3'), '', 'a trade the guides do not cover is not listed')
  const d = parseNyAnnouncement(F('nydol-detail.html'))
  assert.equal(d.city, 'Syracuse, NY')
  assert.match(d.how, /Applications are available online/)
})

test('apprenticeship windows: open, upcoming, closed, monthly rules — and the words on the strip', () => {
  const today = '2026-11-17'
  const row = (id) => windowRow(WINDOWS.find((w) => w.id === id))
  assert.equal(windowState(row('ibew102-2026-12-01'), today).status, 'upcoming')
  assert.equal(windowLabel(row('ibew102-2026-12-01'), today), 'Applications open Tue, Dec 1 only')
  assert.equal(windowLabel(row('bostonjatc-2027'), today), 'Applications open Jan 4–29')
  assert.equal(windowDateLabel(row('bostonjatc-2027'), today), 'Opens Jan 4')
  assert.equal(windowLabel(row('ua41-2026-h2'), today), 'Applications open · closes Dec 31')
  assert.equal(windowDateLabel(row('ua41-2026-h2'), today), 'Closes Dec 31')
  assert.equal(windowLabel(row('fsejatc-2027'), today), 'Applications open · closes Jan 31')
  assert.equal(windowLabel(row('ua375-2026-12-08'), today), 'Applications open year-round · next deadline Dec 8')
  assert.equal(windowLabel(row('csejatc-2027'), today), 'Applications open Jan 1')
  assert.equal(windowState(row('ua375-2026-12-08'), '2026-12-09').status, 'closed', 'past its printed deadline, it drops')
  // "The first 7 days of each month"
  const kc = row('kcjatc124-monthly')
  assert.deepEqual(windowState(kc, today), { status: 'upcoming', opens: '2026-12-01', closes: '2026-12-07', next: '2026-12-01' })
  assert.equal(windowState(kc, '2026-12-03').status, 'open')
  assert.equal(windowLabel(kc, '2026-12-03'), 'Applications open · closes Dec 7')
  assert.equal(windowState(kc, '2026-12-20').opens, '2027-01-01')
  // "The first Wednesday of the month": Dec 2, 2026 and Jan 6, 2027 are Wednesdays.
  const pf = row('pf597-monthly')
  assert.equal(windowState(pf, today).opens, '2026-12-02')
  assert.equal(windowState(pf, '2026-12-02').status, 'open')
  assert.equal(windowState(pf, '2026-12-03').opens, '2027-01-06')
  assert.ok(WINDOWS.every((w) => /^https?:\/\//.test(w.src) && w.checked && w.program && w.place && w.trade), 'every window names its page and when it was checked')
})

test('the Pacific clock: past fairs and closed windows drop off; a window with no printed close goes stale after its check', () => {
  const fair = fairRow({ source: 's', sourceName: 'Agency', state: 'TX', title: 'Regional Job Fair', date: '2026-11-17', place: 'Dallas, TX', src: 'https://x.test/e' })
  // 2026-11-18 07:30 UTC is still Nov 17 in California: today's fair stays.
  assert.equal(upcomingExternal([fair], new Date('2026-11-18T07:30:00Z')).length, 1)
  assert.equal(upcomingExternal([fair], new Date('2026-11-18T08:30:00Z')).length, 0)
  const windows = WINDOWS.map(windowRow)
  const now = upcomingExternal(windows, NOW)
  assert.ok(now.length >= 12)
  assert.ok(now.every((r, i) => i === 0 || now[i - 1].event.next <= r.event.next), 'soonest first')
  assert.equal(now.find((r) => r.id === 'appr:ua41-2026-h2').event.next, '2026-12-31', 'an open window sorts by its close')
  const later = upcomingExternal(windows, new Date('2027-01-15T20:00:00Z'))
  assert.ok(!later.some((r) => r.id === 'appr:ua41-2026-h2'))
  // Memphis prints only its opening (Dec 7, 2026): listed until STALE_WINDOW_DAYS after the check on 2026-11-17.
  assert.ok(upcomingExternal(windows, new Date('2027-02-01T20:00:00Z')).some((r) => r.id === 'appr:memphisjatc-2026-12-07'))
  assert.ok(!upcomingExternal(windows, new Date('2027-03-01T20:00:00Z')).some((r) => r.id === 'appr:memphisjatc-2026-12-07'), `stale after ${STALE_WINDOW_DAYS} days`)
})

test('which guide shows what: windows by trade, field fairs by the guide\'s words, general fairs near a place on field guides only', () => {
  const today = '2026-11-17'
  const row = (id) => windowRow(WINDOWS.find((w) => w.id === id))
  assert.ok(externalBelongs(L('trades'), row('bostonjatc-2027'), 'all', '', today))
  assert.ok(externalBelongs(L('trades'), row('bostonjatc-2027'), 'electrician', '', today))
  assert.ok(!externalBelongs(L('trades'), row('bostonjatc-2027'), 'plumber', '', today))
  assert.ok(externalBelongs(L('trades'), row('ua396-2026-27'), 'pipefitter', '', today))
  assert.ok(externalBelongs(L('trades'), row('smw91-2027'), 'hvac', '', today))
  for (const g of ['cdl', 'healthcare', 'warehouse', 'it', 'oilfield', 'spacex', 'tesla']) assert.ok(!externalBelongs(L(g), row('bostonjatc-2027'), 'all', '', today), g)

  const ntx = parseTribeEvents(J('tribe-ntx.json'), { source: 'ntx', sourceName: 'Workforce Solutions North Texas', state: 'TX' })
  const handlers = ntx.find((r) => r.title === 'HIRING EVENT: Material Handlers')
  assert.ok(externalBelongs(L('warehouse'), handlers, 'all', '', today), 'a material-handler hiring event is a warehouse event')
  assert.ok(!externalBelongs(L('it'), handlers, 'all', 'Vernon, TX', today), 'one employer\'s warehouse event is not general')
  const md = parseMarylandFairs(F('maryland.html'), { source: 'md', sourceName: 'Maryland Department of Labor', src: 'https://labor.md.gov/x' })
  const nursing = md.find((r) => /Nursing Hiring Event/.test(r.title))
  assert.ok(!externalBelongs(L('trades'), nursing, 'all', 'Lanham, MD', today))

  const va = parseTribeEvents(J('tribe-virginiaworks.json'), { source: 'va', sourceName: 'Virginia Works', state: 'VA' })
  const general = va.find((r) => /Fredericksburg: Multi-Employer/.test(r.title))
  for (const g of ['trades', 'oilfield', 'cdl', 'healthcare', 'warehouse', 'it']) {
    assert.ok(externalBelongs(L(g), general, 'all', 'Fredericksburg, VA', today), `${g} shows a general fair near the place`)
    assert.ok(!externalBelongs(L(g), general, 'all', '', today), `${g}: no place, no general fair`)
  }
  for (const g of ['spacex', 'tesla']) assert.ok(!externalBelongs(L(g), general, 'all', 'Fredericksburg, VA', today), `${g} is a company guide`)
})

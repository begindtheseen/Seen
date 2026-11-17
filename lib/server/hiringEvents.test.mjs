// Run: node --test lib/server/hiringEvents.test.mjs
// The hiring-events read behind each start guide's strip: the load rules it keeps on `jobs`, what it returns, and
// the place filter. Postgres is a stub that answers like PostgREST from the real event postings in the fixture.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { readUpcomingEvents, readHiringEventsAnswer, eventsFrom, eventsNear, EVENT_TITLE_PATTERNS, _resetHiringEventsCache } from './hiringEvents.js'
import { _resetExternalEventsCache } from './externalEvents.js'
import { eventBelongs } from '../start/listingFilters.js'
import { CONTENT } from '../start/registry.js'
import { jobsReadFromQuery, publicCacheControl } from './publicRead.js'

const corpus = JSON.parse(readFileSync(new URL('../jobs/fixtures/hiringEvents.json', import.meta.url), 'utf8'))
const NOW = new Date('2026-11-15T18:00:00Z')

function stubDb() {
  const calls = []
  globalThis.fetch = async (url) => {
    const u = new URL(url)
    calls.push(u)
    const select = u.searchParams.get('select')
    const ids = (u.searchParams.get('id') || '').replace(/^in\.\(|\)$/g, '').split(',').filter(Boolean)
    const rows = ids.length
      ? corpus.filter((r) => ids.includes(r.id)).map((r) => ({ id: r.id, description: r.description }))
      : corpus.map(({ description, ...light }) => { void description; return light })
    void select
    return new Response(JSON.stringify(rows), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return calls
}
beforeEach(() => { _resetHiringEventsCache(); _resetExternalEventsCache() })

test('one light title read under the trigram limit, then postings by id — never a body scan', async () => {
  const calls = stubDb()
  await readUpcomingEvents({ supabaseUrl: 'https://db.test', serviceKey: 'k', now: NOW })
  const [first, ...rest] = calls
  assert.ok(EVENT_TITLE_PATTERNS.length <= 15, 'at most ~15 OR patterns on a request path')
  assert.doesNotMatch(first.searchParams.get('select'), /description/, 'the title read never selects the posting text')
  assert.match(first.searchParams.get('or'), /title\.ilike\.\*hiring event\*/)
  assert.doesNotMatch(first.search, /description=ilike/)
  assert.ok(rest.length >= 1 && rest.every((u) => /^in\.\(/.test(u.searchParams.get('id'))), 'posting text only by id')
  // cached: a second read within 10 minutes sends nothing
  const before = calls.length
  await readUpcomingEvents({ supabaseUrl: 'https://db.test', serviceKey: 'k', now: NOW })
  assert.equal(calls.length, before)
})

test('only upcoming events, soonest first, each listed once, and the posting text never leaves the server', async () => {
  stubDb()
  const events = await readUpcomingEvents({ supabaseUrl: 'https://db.test', serviceKey: 'k', now: NOW })
  assert.ok(events.length >= 10, `upcoming events: ${events.length}`)
  for (let i = 1; i < events.length; i++) assert.ok(events[i - 1].event.next <= events[i].event.next)
  for (const e of events) {
    assert.ok(e.event.next >= '2026-11-15', `${e.title}: ${e.event.next}`)
    assert.equal(e.description, undefined)
  }
  // Graham Packaging posted the same walk-in day twice (two company spellings): kept as separate employers' rows only
  // when the employer differs; the exact same employer+title+date shows once.
  const carmel = events.filter((e) => /Certified Nurse Aide Hiring Event/.test(e.title))
  assert.equal(carmel.length, 2, 'two titles (one with "(Staten Island)") are two rows')
  const dup = eventsFrom([...corpus, ...corpus], NOW)
  assert.equal(dup.length, eventsFrom(corpus, NOW).length, 'a repeated posting is listed once')
})

test('near a place: within the radius by the listing\'s own location; an unknown place keeps nothing', () => {
  const events = eventsFrom(corpus, NOW)
  const phx = eventsNear(events, 'Phoenix, AZ', '25')
  assert.ok(phx.some((e) => e.company === 'Nordstrom'))
  assert.ok(phx.every((e) => /AZ|Arizona|Phoenix|Maricopa|Paradise Valley/i.test(e.location)), phx.map((e) => e.location).join(' / '))
  assert.equal(eventsNear(events, 'Boise, ID', '25').length, 0)
  assert.equal(eventsNear(events, 'zzzz qqqq', '25').length, 0)
  assert.equal(eventsNear(events, '', '25').length, events.length)
})

test('each guide gets its own field\'s events; a position chip narrows them; nursing and security stay out', () => {
  const events = eventsFrom(corpus, NOW)
  const of = (field, pos = 'all') => events.filter((e) => eventBelongs(CONTENT[field].listings, e, pos)).map((e) => e.company)
  assert.ok(of('healthcare').includes('U.S. Renal Care'), 'PCT hiring event → healthcare')
  assert.ok(of('healthcare').includes('Carmel Richmond'), 'CNA hiring event → healthcare')
  assert.ok(!of('healthcare').includes('VitalCaring Group'), 'an RN/LPN clinical event is not a no-degree healthcare event')
  assert.ok(of('warehouse').includes('GOAT Group'), 'a fulfillment-center event → warehouse (its roles, not its title)')
  assert.ok(of('warehouse').includes('Penske Truck Leasing'))
  for (const f of Object.keys(CONTENT)) if (CONTENT[f].listings && f !== 'security') assert.ok(!of(f).includes('Marksman Security LLC'), `security events are not on ${f}`)
  if (CONTENT.security?.listings) assert.ok(of('security').includes('Marksman Security LLC'), 'a security hiring event is on the security guide')
  assert.ok(of('healthcare', 'patient-care-tech').includes('U.S. Renal Care'))
  assert.ok(!of('healthcare', 'patient-care-tech').includes('Carmel Richmond'), 'the PCT chip shows PCT events only')
})

test('GET /api/jobs?action=hiring_events is a public read cached at the edge', () => {
  assert.deepEqual(jobsReadFromQuery({ action: 'hiring_events', loc: 'Phoenix, AZ', r: '50' }), { action: 'hiring_events', location: 'Phoenix, AZ', radius: '50' })
  assert.deepEqual(jobsReadFromQuery({ action: 'hiring_events' }), { action: 'hiring_events', location: '', radius: '50' })
  assert.match(publicCacheControl('hiring_events'), /s-maxage=600/)
})

test('the whole answer: posting events and external ones (state fairs, apprenticeship windows), each near the place; one half failing leaves the other', async () => {
  // Before the external table exists (PostgREST 404 PGRST205) the external half is the checked-in files.
  globalThis.fetch = async (url) => {
    const u = new URL(url)
    if (u.pathname.endsWith('/external_hiring_events')) return new Response(JSON.stringify({ code: 'PGRST205' }), { status: 404 })
    const ids = (u.searchParams.get('id') || '').replace(/^in\.\(|\)$/g, '').split(',').filter(Boolean)
    const rows = ids.length ? corpus.filter((r) => ids.includes(r.id)).map((r) => ({ id: r.id, description: r.description })) : corpus.map(({ description, ...light }) => { void description; return light })
    return new Response(JSON.stringify(rows), { status: 200 })
  }
  const all = await readHiringEventsAnswer({ supabaseUrl: 'https://db.test', serviceKey: 'k', now: NOW })
  assert.ok(all.events.length >= 10)
  assert.ok(all.external.some((r) => r.external.type === 'apprenticeship'))
  assert.match(all.external_from, /^snapshot/)
  assert.equal(all.partial, false)
  const boston = await readHiringEventsAnswer({ supabaseUrl: 'https://db.test', serviceKey: 'k', location: 'Boston, MA', radius: '25', now: NOW })
  assert.ok(boston.external.some((r) => r.id === 'appr:bostonjatc-2027'))
  assert.ok(boston.external.every((r) => r.external.state === 'MA' || r.lat != null))
  // The listings read failing leaves the external half standing.
  _resetHiringEventsCache(); _resetExternalEventsCache()
  globalThis.fetch = async (url) => (new URL(url).pathname.endsWith('/jobs') ? new Response('boom', { status: 500 }) : new Response(JSON.stringify({ code: 'PGRST205' }), { status: 404 }))
  const half = await readHiringEventsAnswer({ supabaseUrl: 'https://db.test', serviceKey: 'k', now: NOW })
  assert.deepEqual(half.events, [])
  assert.ok(half.external.length > 0)
  assert.equal(half.partial, true)
})

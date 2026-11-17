// Run: node --test lib/server/externalEvents.test.mjs
// The external hiring-events read (one indexed table read, cached; a missing table falls back to the checked-in
// files silently), the place filter, robots.txt, and the cron's fetch over real saved answers.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  robotsAllows, robotsDelay, readExternalEvents, externalNear, refreshExternalEvents, tableRecord, fileRows,
  _resetExternalEventsCache, SOURCES, TABLE,
} from './externalEvents.js'
import { fairRow, windowRow } from '../jobs/externalEvents.js'

const F = (n) => readFileSync(new URL(`../jobs/fixtures/externalEvents/${n}`, import.meta.url), 'utf8')
const NOW = new Date('2026-11-17T20:00:00Z')
const UA = 'SeenJobsBot/1.0 (+https://seenjobs.io/methods)'
beforeEach(() => _resetExternalEventsCache())

const json = (body, status = 200) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

test('robots.txt: the `*` group (or our own), longest rule wins, wildcards; another bot\'s rules and delay never apply', () => {
  const wp = 'User-agent: *\nDisallow: /wp-admin/*\nDisallow: *post_type=tribe_events*\nDisallow: *paged=*\nAllow: /event/*\n\nUser-agent: ClaudeBot\nDisallow: /\nCrawl-delay: 30\n'
  assert.equal(robotsAllows(wp, UA, '/wp-json/tribe/events/v1/events?per_page=50&page=2&start_date=2026-11-17'), true)
  assert.equal(robotsAllows(wp, UA, '/?post_type=tribe_events'), false)
  assert.equal(robotsDelay(wp, UA), 0, 'a crawl-delay written for another bot is not ours')
  const anyQuery = 'User-agent: *\nDisallow: /*?\nCrawl-delay: 3\n'
  assert.equal(robotsAllows(anyQuery, UA, '/wp-json/tribe/events/v1/events?per_page=50'), false, 'DurhamWorks forbids every query string')
  assert.equal(robotsDelay(anyQuery, UA), 3)
  const ours = 'User-agent: *\nAllow: /\n\nUser-agent: SeenJobsBot\nDisallow: /events\n'
  assert.equal(robotsAllows(ours, UA, '/events?x=1'), false, 'a group naming us wins over *')
  assert.equal(robotsAllows('User-agent: *\nDisallow: /a\nAllow: /a/b\n', UA, '/a/b/c'), true, 'the longer rule wins')
  assert.equal(robotsAllows('User-agent: *\nDisallow:\n', UA, '/x'), true)
  assert.equal(robotsAllows('', UA, '/x'), true)
})

test('a missing table is "no rows", silently: the snapshot and the curated windows are served, one read, no `jobs`', async () => {
  const calls = []
  const fetchImpl = async (url) => { calls.push(new URL(url)); return json({ code: 'PGRST205', message: "Could not find the table 'public.external_hiring_events'" }, 404) }
  const a = await readExternalEvents({ supabaseUrl: 'https://db.test', serviceKey: 'k', now: NOW, fetchImpl })
  assert.equal(a.from, 'snapshot (no table)')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].pathname, `/rest/v1/${TABLE}`)
  assert.equal(calls[0].searchParams.get('or'), '(ends_on.gte.2026-11-17,ends_on.is.null)', 'an indexed date read')
  assert.equal(calls[0].searchParams.get('select'), 'payload')
  const { windows, snapshot } = fileRows()
  assert.ok(snapshot.length > 0 && windows.length >= 12)
  assert.ok(a.rows.some((r) => r.external.type === 'fair'))
  assert.ok(a.rows.some((r) => r.id === 'appr:bostonjatc-2027'))
  assert.ok(a.rows.every((r) => r.event.next >= '2026-11-17'), 'nothing past')
  // Cached for 10 minutes: a second read makes no call.
  await readExternalEvents({ supabaseUrl: 'https://db.test', serviceKey: 'k', now: NOW, fetchImpl })
  assert.equal(calls.length, 1)
})

test('the table, when it has rows, replaces the snapshot; empty or unreachable falls back', async () => {
  const mine = fairRow({ source: 'tx', sourceName: 'Workforce Solutions Greater Dallas', state: 'TX', title: 'Regional Job Fair', date: '2026-12-01', place: 'Dallas, TX', src: 'https://www.wfsdallas.com/event/x/' })
  let a = await readExternalEvents({ supabaseUrl: 'https://db.test', serviceKey: 'k', now: NOW, fetchImpl: async () => json([{ payload: mine }]) })
  assert.equal(a.from, 'table')
  assert.equal(a.rows.filter((r) => r.external.type === 'fair').length, 1)
  assert.ok(a.rows.some((r) => r.external.type === 'apprenticeship'), 'curated windows always ride along')
  _resetExternalEventsCache()
  a = await readExternalEvents({ supabaseUrl: 'https://db.test', serviceKey: 'k', now: NOW, fetchImpl: async () => json([]) })
  assert.equal(a.from, 'snapshot (table empty)')
  _resetExternalEventsCache()
  a = await readExternalEvents({ supabaseUrl: 'https://db.test', serviceKey: 'k', now: NOW, fetchImpl: async () => { throw new Error('down') } })
  assert.equal(a.from, 'snapshot (table unreachable)')
  assert.ok(a.rows.length > 0)
})

test('near a place: radius from the row\'s coordinates or town; a virtual fair counts for its state; a typed state keeps its rows', () => {
  const mk = (title, place, state, extra = {}) => ({ ...fairRow({ source: 's', sourceName: 'Agency', state, title, date: '2026-12-01', place, src: 'https://x.test/e', ...extra }) })
  const dallas = mk('Dallas Job Fair', 'Dallas, TX', 'TX')
  const worth = mk('Fort Worth Job Fair', 'Fort Worth, TX', 'TX')
  const austin = mk('Austin Job Fair', 'Austin, TX', 'TX')
  const vaVirtual = mk('Virtual Job Fair', '', 'VA', { virtual: true })
  const rows = [dallas, worth, austin, vaVirtual]
  assert.deepEqual(externalNear(rows, 'Dallas, TX', '50').map((r) => r.title), ['Dallas Job Fair', 'Fort Worth Job Fair'])
  assert.deepEqual(externalNear(rows, 'Richmond, VA', '25').map((r) => r.title), ['Virtual Job Fair'])
  assert.deepEqual(externalNear(rows, 'Texas', '50').map((r) => r.title), ['Dallas Job Fair', 'Fort Worth Job Fair', 'Austin Job Fair'])
  assert.deepEqual(externalNear(rows, 'Qwxzv Nowhere', '50'), [], 'an unknown place keeps nothing')
  assert.equal(externalNear(rows, '', '50').length, 4, 'no place keeps all (the strip decides)')
  const boston = windowRow({ id: 'b', program: 'Boston JATC', trade: 'electrical', place: 'Boston, MA', state: 'MA', opens: '2027-01-04', closes: '2027-01-29', src: 'https://x.test' })
  assert.equal(externalNear([boston], 'Cambridge, MA', '25').length, 1)
  assert.equal(externalNear([boston], 'Hartford, CT', '25').length, 0)
})

test('the cron fetch: real saved answers, robots respected, a failing source never stops the others', async () => {
  const pick = (ids) => SOURCES.filter((s) => ids.includes(s.id))
  const seen = []
  const fetchImpl = async (url) => {
    const u = new URL(url)
    seen.push(u)
    if (u.pathname === '/robots.txt') {
      if (u.hostname === 'www.labor.idaho.gov') return new Response('User-agent: *\nDisallow: /wp-json/\n', { status: 200, headers: { 'content-type': 'text/plain' } })
      return new Response('User-agent: *\nDisallow: /wp-admin/\n', { status: 200, headers: { 'content-type': 'text/plain' } })
    }
    if (u.hostname === 'virginiaworks.gov') return json(F('tribe-virginiaworks.json'))
    if (u.hostname === 'www.wfsdallas.com') return new Response('busy', { status: 503 })
    if (u.hostname === 'labor.md.gov') return new Response(F('maryland.html'), { status: 200, headers: { 'content-type': 'text/html' } })
    if (u.hostname === 'workforcewv.org') return new Response(F('westvirginia.html'), { status: 200, headers: { 'content-type': 'text/html' } })
    if (u.hostname === 'dol.ny.gov' && u.pathname.startsWith('/apprenticeship')) return new Response(F('nydol-list.html'), { status: 200, headers: { 'content-type': 'text/html' } })
    if (u.hostname === 'dol.ny.gov') return new Response(F('nydol-detail.html'), { status: 200, headers: { 'content-type': 'text/html' } })
    return new Response('?', { status: 404 })
  }
  const { rows, summary } = await refreshExternalEvents({ fetchImpl, now: NOW, sources: pick(['va-virginiaworks', 'tx-wfs-dallas', 'id-labor', 'md-labor', 'wv-workforce', 'ny-dol-apprenticeship']), budgetMs: 20_000 })
  assert.equal(summary['va-virginiaworks'].ok, true)
  assert.ok(summary['va-virginiaworks'].kept >= 15)
  assert.deepEqual([summary['tx-wfs-dallas'].ok, summary['tx-wfs-dallas'].error], [false, 'HTTP 503'])
  assert.match(summary['id-labor'].error, /robots/, 'a path robots.txt forbids is never fetched')
  assert.ok(!seen.some((u) => u.hostname === 'www.labor.idaho.gov' && u.pathname.startsWith('/wp-json')))
  assert.ok(summary['md-labor'].ok && summary['wv-workforce'].ok)
  assert.ok(summary['ny-dol-apprenticeship'].kept >= 1)
  const nas = rows.find((r) => r.external.type === 'apprenticeship' && /Carpenters/.test(r.title) && r.external.closes === '2027-11-07')
  assert.equal(nas.location, 'Syracuse, NY')
  assert.ok(nas.lat != null, 'placed for the radius')
  assert.ok(rows.every((r) => r.event.next >= '2026-11-17'), 'only rows still ahead are kept')
  assert.ok(rows.filter((r) => r.external.type === 'fair' && !r.event.virtual).every((r) => r.lat != null), 'every in-person fair is placed')
  const rec = tableRecord(nas, NOW.toISOString())
  assert.deepEqual([rec.kind, rec.source, rec.starts_on, rec.ends_on, rec.state], ['apprenticeship', 'ny-dol-apprenticeship', '2026-11-09', '2027-11-07', 'NY'])
  assert.equal(rec.payload, nas)
})

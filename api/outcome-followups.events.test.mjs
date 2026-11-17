// Run: node --test api/outcome-followups.events.test.mjs
// The daily email job's hiring-event pass ("I'm going" — lib/tracker/eventPlan.js): the reminder the day before,
// "How did it go?" the day after, each sent once (the ledger claim), never to an opted-out person or an answered card.
import { test, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { planEvent, eventAnsweredEvent, EVENT_EVE_DAY, EVENT_AFTER_DAY } from '../lib/tracker/eventPlan.js'

process.env.SUPABASE_URL = 'https://db.test'
process.env.SUPABASE_SERVICE_KEY = 'svc'
process.env.RESEND_KEY = 're_test'
process.env.CRON_SECRET = 'cron'
let handler
before(async () => { handler = (await import('./outcome-followups.js')).default })

const AT = '2026-11-19T18:00:00.001Z' // Thu Nov 19, 11 AM Phoenix
const ev = { label: 'Hiring day', time: '11 AM–5 PM', where: '1919 Camelback Road, Phoenix, AZ 85016' }
const eventApp = (extra = {}) => ({ id: '11111111-1111-4111-8111-111111111111', user_id: 'u1', company_name: 'Nordstrom', role: 'Last Chance Phoenix', status: 'active', created_at: '2026-11-16T00:00:00Z', events: [planEvent(ev, AT, 'job-1', 1)], ...extra })

let state
beforeEach(() => { state = { eventApps: [eventApp()], claims: new Set(), sent: [], optOut: [] } })
globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(url)
  const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } })
  if (u.hostname === 'api.resend.com') { state.sent.push(JSON.parse(opts.body)); return json({ id: 'em_1' }) }
  if (u.pathname.startsWith('/auth/v1/admin/users/')) return json({ email: 'person@example.com' })
  if (u.pathname === '/rest/v1/email_prefs') return json(state.optOut.map((user_id) => ({ user_id })))
  if (u.pathname === '/rest/v1/outcome_email_log') {
    if ((opts.method || 'GET') === 'DELETE') return new Response(null, { status: 204 })
    const b = JSON.parse(opts.body)
    const key = `${b.application_id}|${b.milestone_day}`
    if (state.claims.has(key)) return json({ code: '23505' }, 409)
    state.claims.add(key)
    return new Response(null, { status: 201 })
  }
  if (u.pathname === '/rest/v1/applications') {
    if (u.searchParams.get('events')) {
      assert.match(decodeURIComponent(u.searchParams.get('events')), /^cs\.\[\{"type":"interview_scheduled","data":\{"kind":"hiring_event"\}\}\]$/)
      return json(state.eventApps)
    }
    return json([]) // no day-7/14/30 candidates in these tests
  }
  throw new Error(`unexpected fetch ${url}`)
}

async function run(nowIso) {
  const realNow = Date.now
  Date.now = () => Date.parse(nowIso)
  try {
    let out
    const res = { status() { return this }, json(b) { out = b; return this } }
    await handler({ headers: { authorization: 'Bearer cron' }, query: {} }, res)
    return out
  } finally { Date.now = realNow }
}

test('the day before: one reminder with the day, hours and place; never twice', async () => {
  const out = await run('2026-11-18T15:00:00Z') // 7 AM Pacific, Nov 18
  assert.equal(out.events.sent, 1)
  assert.equal(state.sent.length, 1)
  assert.equal(state.sent[0].subject, 'Tomorrow: Hiring day at Nordstrom')
  assert.match(state.sent[0].text, /Thu, Nov 19 · 11 AM–5 PM · 1919 Camelback Road, Phoenix, AZ 85016/)
  assert.match(state.sent[0].text, /\/tracker\?app=11111111-1111-4111-8111-111111111111/)
  assert.ok(state.claims.has(`${eventApp().id}|${EVENT_EVE_DAY}`))
  await run('2026-11-18T15:00:00Z')
  assert.equal(state.sent.length, 1, 'the ledger claim stops a second send')
})

test('the day after: "How did it go?"; not once it is answered; not to an opted-out person', async () => {
  const out = await run('2026-11-20T15:00:00Z')
  assert.equal(out.events.sent, 1)
  assert.equal(state.sent[0].subject, 'How did the hiring day at Nordstrom go?')
  assert.ok(state.claims.has(`${eventApp().id}|${EVENT_AFTER_DAY}`))

  state = { ...state, claims: new Set(), sent: [], eventApps: [eventApp({ events: [planEvent(ev, AT, 'job-1', 1), eventAnsweredEvent('nothing', 2)] })] }
  assert.equal((await run('2026-11-20T15:00:00Z')).events.sent, 0)

  state = { ...state, claims: new Set(), sent: [], eventApps: [eventApp()], optOut: ['u1'] }
  assert.equal((await run('2026-11-20T15:00:00Z')).events.sent, 0)
})

test('nothing on the event day itself, or before the eve', async () => {
  assert.equal((await run('2026-11-19T15:00:00Z')).events.sent, 0)
  assert.equal((await run('2026-11-16T15:00:00Z')).events.sent, 0)
})

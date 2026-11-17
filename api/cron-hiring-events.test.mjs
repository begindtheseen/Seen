// Run: node --test api/cron-hiring-events.test.mjs
// The external hiring-events refresh: who may run it, a dry run, what it writes (upsert by id; a source that answered
// replaces its rows, a source that failed keeps them), and a missing table.
import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import handler from './cron-hiring-events.js'

const F = (n) => readFileSync(new URL(`../lib/jobs/fixtures/externalEvents/${n}`, import.meta.url), 'utf8')
const realFetch = globalThis.fetch
let db

function stub({ table = true } = {}) {
  db = []
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url))
    if (u.hostname === 'db.test') {
      db.push({ method: init.method || 'GET', path: u.pathname, search: u.search, body: init.body ? JSON.parse(init.body) : null })
      if (!table && u.pathname.includes('external_hiring_events')) return new Response(JSON.stringify({ code: 'PGRST205' }), { status: 404 })
      return new Response(init.method === 'DELETE' ? '[]' : '', { status: init.method === 'POST' ? 201 : 200 })
    }
    if (u.pathname === '/robots.txt') return new Response('User-agent: *\nDisallow: /wp-admin/\n', { status: 200, headers: { 'content-type': 'text/plain' } })
    if (u.hostname === 'virginiaworks.gov') return new Response(F('tribe-virginiaworks.json'), { status: 200, headers: { 'content-type': 'application/json' } })
    if (u.hostname === 'workforcewv.org') return new Response(F('westvirginia.html'), { status: 200, headers: { 'content-type': 'text/html' } })
    return new Response('unavailable', { status: 503 })
  }
}
const run = (req) => new Promise((resolve) => {
  const res = { statusCode: 200, status(c) { this.statusCode = c; return this }, setHeader() { return this }, json(b) { resolve({ status: this.statusCode, body: b }); return this } }
  handler({ method: 'GET', query: {}, headers: {}, ...req }, res)
})

beforeEach(() => { process.env.CRON_SECRET = 'cron-secret'; process.env.SUPABASE_URL = 'https://db.test'; process.env.SUPABASE_SERVICE_KEY = 'svc' })
afterEach(() => { globalThis.fetch = realFetch })

test('cron only: the Bearer secret or a manual secret; x-vercel-cron proves nothing', async () => {
  stub()
  assert.equal((await run({ headers: { 'x-vercel-cron': '1' } })).status, 401)
  assert.equal((await run({ headers: { authorization: 'Bearer wrong' } })).status, 401)
  assert.equal(db.length, 0)
})

test('a dry run fetches every source and answers what each returned, writing nothing', async () => {
  stub()
  const { status, body } = await run({ headers: { 'x-cron-secret': 'cron-secret' }, query: { dry: '1' } })
  assert.equal(status, 200)
  assert.equal(body.dry, true)
  assert.ok(body.summary['va-virginiaworks'].ok && body.summary['va-virginiaworks'].kept > 0)
  assert.equal(body.summary['tx-wfs-dallas'].ok, false)
  assert.equal(body.partial, true)
  assert.equal(db.filter((c) => c.path.includes('external_hiring_events')).length, 0)
})

test('writes: one upsert by id, then each ANSWERING source\'s unseen rows removed; a failed source keeps its rows', async () => {
  stub()
  const { status, body } = await run({ headers: { authorization: 'Bearer cron-secret' } })
  assert.equal(status, 200)
  assert.equal(body.table, 'ok')
  const writes = db.filter((c) => c.path.includes('external_hiring_events'))
  const up = writes.find((c) => c.method === 'POST')
  assert.equal(up.search, '?on_conflict=id')
  assert.ok(up.body.length === body.events && up.body.every((r) => r.id && r.kind && r.source && r.payload && r.src && r.fetched_at))
  const deletes = writes.filter((c) => c.method === 'DELETE').map((c) => decodeURIComponent(c.search))
  assert.ok(deletes.some((q) => q.startsWith('?source=eq.va-virginiaworks&fetched_at=lt.')))
  assert.ok(!deletes.some((q) => q.includes('source=eq.tx-wfs-dallas')), 'a source that failed this run keeps its rows')
  assert.ok(deletes.some((q) => /^\?ends_on=lt\.\d{4}-\d{2}-\d{2}$/.test(q)), 'old rows are cleared')
})

test('before the migration: the run still answers, `table: missing`', async () => {
  stub({ table: false })
  const { status, body } = await run({ headers: { 'x-cron-secret': 'cron-secret' } })
  assert.equal(status, 200)
  assert.equal(body.table, 'missing')
  assert.ok(body.events > 0)
})

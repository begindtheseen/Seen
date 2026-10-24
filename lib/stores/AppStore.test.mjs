// AppStore's edit / delete path as the tracker's Edit and Delete buttons use it: the local record
// changes, the account sync (`update_application` / `remove_application`) is AWAITED, and an edit
// never manufactures a hiring event. Node strips the .ts types; a tiny resolve hook stands in for
// the browser-only `../sync` module and resolves the store's extensionless relative imports.
import test from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'

const hook = `
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
export async function resolve(spec, ctx, next) {
  if (spec === '../sync' || spec === './sync') return { url: 'data:text/javascript,' + encodeURIComponent(
    'export async function _sync(action, payload = {}) { globalThis.__syncCalls.push({ action, ...payload }); return globalThis.__syncReply(action, payload) }\\n' +
    'export async function _syncRaw(action, payload = {}) { globalThis.__syncCalls.push({ action, ...payload }); const r = globalThis.__syncRawReply ? await globalThis.__syncRawReply(action, payload) : null; if (r) return r; const body = await globalThis.__syncReply(action, payload); return { ok: body != null, status: body != null ? 200 : 0, body } }'), shortCircuit: true }
  if (spec.startsWith('.') && !/\\.[a-z]+$/i.test(spec) && ctx.parentURL) {
    const base = new URL(spec, ctx.parentURL)
    if (existsSync(fileURLToPath(base) + '.ts')) return { url: base.href + '.ts', shortCircuit: true }
  }
  return next(spec, ctx)
}`
register('data:text/javascript,' + encodeURIComponent(hook), import.meta.url)

// A localStorage the store can use.
const mem = new Map()
globalThis.localStorage = {
  getItem: k => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: k => mem.delete(k),
}
globalThis.__syncCalls = []
globalThis.__syncReply = () => ({ ok: true })

const { AppStore, EDITABLE_KEYS } = await import('./AppStore.ts')

const ID = '11111111-1111-4111-8111-111111111111'
const NOW = Date.parse('2026-10-23T17:00:00Z')
function seed() {
  mem.clear(); globalThis.__syncCalls.length = 0
  localStorage.setItem('seen_applications_v1', JSON.stringify([{
    id: ID, company: 'Walmrat', role: 'Cashier', location: 'Phoenix, AZ', platform: 'Direct', stage: 'Applied', status: 'active',
    appliedAt: NOW - 3 * 86400000, updatedAt: NOW, events: [{ id: 'ev_init', type: 'application_submitted', date: NOW - 3 * 86400000, source: 'user', confidence: 'low' }],
  }]))
}

test('EDITABLE_KEYS names exactly what Edit may change', () => {
  assert.deepEqual([...EDITABLE_KEYS], ['company', 'role', 'location', 'platform', 'appliedAt'])
})

test('Edit: the local record changes, the sync is awaited with the same fields, no event is added', async () => {
  seed()
  let resolved = false
  globalThis.__syncReply = async () => { await new Promise(r => setTimeout(r, 15)); resolved = true; return { ok: true } }
  const applied = NOW - 5 * 86400000
  await AppStore.update(ID, { company: 'Walmart', appliedAt: applied, platform: 'Indeed' }, true)
  assert.equal(resolved, true, 'update() must await the PATCH — an un-awaited one let the reload revert it')
  const [a] = AppStore.loadSync()
  assert.equal(a.company, 'Walmart')
  assert.equal(a.platform, 'Indeed')
  assert.equal(a.appliedAt, applied)
  assert.equal(a.stage, 'Applied')
  assert.equal(a.status, 'active')
  assert.equal(a.events.length, 1, 'a correction is not a hiring event')
  const call = globalThis.__syncCalls.find(c => c.action === 'update_application')
  assert.equal(call.id, ID)
  assert.equal(call.changes.company, 'Walmart')
  assert.equal(call.changes.appliedAt, applied)
  assert.equal(call.changes.platform, 'Indeed')
  assert.equal(call.changes.status, undefined)
})

test('a stage move still records its event (the edit path did not change that)', async () => {
  seed(); globalThis.__syncReply = () => ({ ok: true })
  await AppStore.update(ID, { stage: 'Interview' }, true)
  const [a] = AppStore.loadSync()
  assert.equal(a.stage, 'Interview')
  assert.ok(a.events.some(e => e.type === 'interview_received'))
})

test('Delete: the card is gone locally and remove_application is awaited (nothing is reported)', async () => {
  seed()
  let resolved = false
  globalThis.__syncReply = async () => { await new Promise(r => setTimeout(r, 15)); resolved = true; return { ok: true } }
  await AppStore.remove(ID, true)
  assert.equal(resolved, true)
  assert.deepEqual(AppStore.loadSync(), [])
  assert.deepEqual(globalThis.__syncCalls.map(c => c.action), ['remove_application'])
})

test('404 from the server (removed on another device / not this account): the local copy is dropped, no error', async () => {
  // update_application answers 410 under compare-and-set; a 404 (older server) means the same thing.
  seed(); globalThis.__syncRawReply = async () => ({ ok: false, status: 404, body: { ok: false, reason: 'not_found' } })
  const r = await AppStore.update(ID, { stage: 'Interview' }, true)
  assert.equal(r.status, 'gone')
  assert.deepEqual(AppStore.loadSync(), [], 'the stale local row is gone — the reload shows the truth')
  seed()
  const d = await AppStore.remove(ID, true)
  assert.deepEqual(d, { ok: true, reason: 'not_found' }, 'already gone on the server is the state the person asked for')
  assert.deepEqual(AppStore.loadSync(), [])
  globalThis.__syncRawReply = null
})

test('a successful update/remove reports ok; a network failure reports failed/offline and keeps the local change', async () => {
  seed(); globalThis.__syncReply = () => ({ ok: true })
  assert.equal((await AppStore.update(ID, { stage: 'Interview' }, true)).status, 'ok')
  assert.deepEqual(await AppStore.remove(ID, true), { ok: true })
  seed(); globalThis.__syncReply = () => null
  assert.equal((await AppStore.update(ID, { stage: 'Interview' }, true)).status, 'failed')
  assert.equal(AppStore.loadSync()[0].stage, 'Interview')
  assert.equal(AppStore.loadSync()[0].unsynced, true)
  assert.deepEqual(await AppStore.remove(ID, true), { ok: false, reason: 'offline' })
  globalThis.__syncReply = () => ({ ok: true })
})

test('signed out: edits stay on the device and nothing is synced', async () => {
  seed(); globalThis.__syncReply = () => ({ ok: true })
  await AppStore.update(ID, { role: 'Cashier (part-time)' }, false)
  assert.equal(AppStore.loadSync()[0].role, 'Cashier (part-time)')
  assert.equal(globalThis.__syncCalls.length, 0)
})

// ── audit 3 (2026-10-24) H4/H5/L5: compare-and-set, queued writes, honest failure states ──────────
const raw = (status, body, delay = 0) => async () => { if (delay) await new Promise(r => setTimeout(r, delay)); return { ok: status >= 200 && status < 300, status, body } }
const T0 = '2026-10-23T17:00:00.000Z'

test('update sends the last-seen updated_at and adopts the new one; a second quick tap waits and sends THAT token', async () => {
  seed()
  let n = 0
  globalThis.__syncRawReply = async (action) => {
    if (action !== 'update_application') return null
    n++
    await new Promise(r => setTimeout(r, n === 1 ? 30 : 1))
    return { ok: true, status: 200, body: { ok: true, updated_at: new Date(NOW + n * 1000).toISOString(), anomalies: [] } }
  }
  const [a, b] = await Promise.all([AppStore.update(ID, { stage: 'Viewed' }, true), AppStore.update(ID, { stage: 'Phone Screen' }, true)])
  assert.equal(a.status, 'ok'); assert.equal(b.status, 'ok')
  const calls = globalThis.__syncCalls.filter(c => c.action === 'update_application')
  assert.equal(calls[0].updatedAt, NOW, 'first write carries the token the record was loaded with')
  assert.equal(calls[1].updatedAt, NOW + 1000, 'second write carries the token the first one received')
  assert.equal(calls[1].changes.stage, 'Phone Screen')
  const [rec] = AppStore.loadSync()
  assert.equal(rec.stage, 'Phone Screen'); assert.equal(rec.updatedAt, NOW + 2000); assert.equal(rec.unsynced, false)
  globalThis.__syncRawReply = null
})

test('409: another device got there first — the account row replaces this copy (status stale)', async () => {
  seed()
  globalThis.__syncRawReply = raw(409, { error: 'stale', application: { id: ID, company_name: 'Walmart', role: 'Role-B', city: 'Phoenix, AZ', platform: 'Direct', stage: 'Interview', status: 'active', applied_at: T0, updated_at: '2026-10-24T01:00:00.000Z', events: [] } })
  const r = await AppStore.update(ID, { role: 'Role-A' }, true)
  assert.equal(r.status, 'stale')
  assert.equal(r.server.role, 'Role-B')
  const [rec] = AppStore.loadSync()
  assert.equal(rec.role, 'Role-B'); assert.equal(rec.stage, 'Interview'); assert.equal(rec.updatedAt, Date.parse('2026-10-24T01:00:00.000Z'))
  globalThis.__syncRawReply = null
})

test('410: the application was deleted elsewhere — it leaves this device too (status gone)', async () => {
  seed()
  globalThis.__syncRawReply = raw(410, { error: 'gone' })
  const r = await AppStore.update(ID, { role: 'Role-A' }, true)
  assert.equal(r.status, 'gone')
  assert.deepEqual(AppStore.loadSync(), [])
  globalThis.__syncRawReply = null
})

test('504: the stage change is kept on this device, flagged unsynced, and the next load resends it with the ORIGINAL token', async () => {
  seed()
  globalThis.__syncRawReply = raw(504, null)
  const r = await AppStore.update(ID, { stage: 'Interview' }, true)
  assert.equal(r.status, 'failed')
  let [rec] = AppStore.loadSync()
  assert.equal(rec.stage, 'Interview', 'never silently reverted')
  assert.equal(rec.unsynced, true)
  assert.equal(AppStore.syncState(rec, true), 'unsynced')
  assert.equal(rec.updatedAt, NOW, 'the token is still the one the account last gave')
  globalThis.__syncCalls.length = 0
  globalThis.__syncRawReply = async (action) => action === 'update_application' ? { ok: true, status: 200, body: { ok: true, updated_at: '2026-10-24T02:00:00.000Z' } } : null
  globalThis.__syncReply = (action) => action === 'load' ? { applications: [{ id: ID, company_name: 'Walmrat', role: 'Cashier', city: 'Phoenix, AZ', platform: 'Direct', stage: 'Applied', status: 'active', applied_at: T0, updated_at: new Date(NOW).toISOString(), events: [] }] } : { ok: true }
  const apps = await AppStore.load(true)
  const resend = globalThis.__syncCalls.find(c => c.action === 'update_application')
  assert.equal(resend.updatedAt, NOW)
  assert.equal(resend.changes.stage, 'Interview')
  assert.equal(apps[0].stage, 'Interview'); assert.ok(!apps[0].unsynced)
  ;[rec] = AppStore.loadSync()
  assert.equal(rec.updatedAt, Date.parse('2026-10-24T02:00:00.000Z'))
  globalThis.__syncRawReply = null; globalThis.__syncReply = () => ({ ok: true })
})

test('a duplicate add (double submit / the same listing twice) sends nothing and leaves ONE card', async () => {
  mem.clear(); globalThis.__syncCalls.length = 0
  globalThis.__syncRawReply = raw(200, { id: '55555555-5555-4555-8555-555555555555', updated_at: T0 })
  const one = await AppStore.add({ id: 'app_1792805049974', company: 'OldCo', role: 'Analyst', appliedAt: NOW }, true)
  const two = await AppStore.add({ id: 'app_1792805049975', company: 'oldco', role: 'ANALYST', appliedAt: NOW }, true)
  assert.equal(one.synced, true); assert.equal(two.duplicate, true); assert.equal(two.id, one.id)
  assert.equal(AppStore.loadSync().length, 1)
  assert.equal(globalThis.__syncCalls.filter(c => c.action === 'add_application').length, 1)
  globalThis.__syncRawReply = null
})

test('a failed add keeps the card with its client id (unsynced); Retry sends the same id and adopts the row', async () => {
  mem.clear(); globalThis.__syncCalls.length = 0
  globalThis.__syncRawReply = raw(504, null)
  const r = await AppStore.add({ id: 'app_1792805049974', company: 'OldCo', role: 'Analyst', appliedAt: NOW }, true)
  assert.equal(r.synced, false)
  assert.equal(AppStore.syncState(AppStore.loadSync()[0], true), 'unsynced')
  globalThis.__syncRawReply = raw(200, { id: '55555555-5555-4555-8555-555555555555', updated_at: T0, existing: true })
  const again = await AppStore.retry('app_1792805049974', true)
  assert.equal(again.status, 'ok')
  const adds = globalThis.__syncCalls.filter(c => c.action === 'add_application')
  assert.equal(adds[1].application.id, 'app_1792805049974', 'the same client id — the server is idempotent on it')
  assert.equal(AppStore.loadSync()[0].id, '55555555-5555-4555-8555-555555555555')
  globalThis.__syncRawReply = null
})

test('a backwards stage move supersedes the events above it (kept, weight 0) and records stage_corrected', async () => {
  seed(); globalThis.__syncReply = () => ({ ok: true })
  await AppStore.update(ID, { stage: 'Phone Screen' }, false)
  await AppStore.update(ID, { stage: 'Viewed' }, false)
  let [a] = AppStore.loadSync()
  assert.ok(a.events.some(e => e.type === 'response_received' && !(e.anomaly_flags || []).includes('superseded')), 'Phone Screen → Viewed keeps the response')
  await AppStore.update(ID, { stage: 'Applied' }, false)
  ;[a] = AppStore.loadSync()
  const resp = a.events.find(e => e.type === 'response_received')
  assert.ok(resp.anomaly_flags.includes('superseded')); assert.equal(resp.trust_weight, 0)
  const cor = a.events.filter(e => e.type === 'stage_corrected')
  assert.equal(cor.length, 2)
  assert.deepEqual([cor[1].data.from, cor[1].data.to], ['Viewed', 'Applied'])
  assert.deepEqual(cor[1].data.superseded, [resp.id])
  // Moving forward again records a NEW live response rather than reviving the superseded one.
  await AppStore.update(ID, { stage: 'Phone Screen' }, false)
  ;[a] = AppStore.loadSync()
  assert.equal(a.events.filter(e => e.type === 'response_received').length, 2)
})

test('an offer on day 0 is recorded with impossible_timeline and the result says so (the card hint)', async () => {
  mem.clear()
  localStorage.setItem('seen_applications_v1', JSON.stringify([{ id: ID, company: 'X', role: 'Y', stage: 'Applied', status: 'active', appliedAt: Date.now() - 3600000, updatedAt: NOW, events: [] }]))
  const r = await AppStore.update(ID, { stage: 'Offer' }, false)
  assert.deepEqual(r.anomalies, ['impossible_timeline'])
  const offer = AppStore.loadSync()[0].events.find(e => e.type === 'offer_received')
  assert.deepEqual(offer.anomaly_flags, ['impossible_timeline']); assert.equal(offer.trust_weight, 0)
})

test('check-in markers and ensureEvent ride the same update_application call', async () => {
  seed()
  globalThis.__syncRawReply = raw(200, { ok: true, updated_at: T0 })
  const marker = { id: 'chk_1', type: 'check_answered', date: NOW, source: 'user', confidence: 'medium', data: { check: 'response_check', day: 7, got_response: true } }
  await AppStore.update(ID, { stage: 'Viewed' }, true, { markers: [marker], ensureEvent: 'response_received' })
  const call = globalThis.__syncCalls.find(c => c.action === 'update_application')
  assert.deepEqual(call.changes.events.map(e => e.type), ['application_submitted', 'response_received', 'check_answered'])
  assert.equal(call.changes.stage, 'Viewed')
  globalThis.__syncRawReply = null
})

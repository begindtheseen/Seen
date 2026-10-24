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

test('signed out: edits stay on the device and nothing is synced', async () => {
  seed(); globalThis.__syncReply = () => ({ ok: true })
  await AppStore.update(ID, { role: 'Cashier (part-time)' }, false)
  assert.equal(AppStore.loadSync()[0].role, 'Cashier (part-time)')
  assert.equal(globalThis.__syncCalls.length, 0)
})

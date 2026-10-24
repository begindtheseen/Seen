// lib/sync.ts: concurrent identical READS share one in-flight request; WRITES are never shared (two
// update_application calls are two sends — AppStore's per-application queue orders them); a 404 / 409 /
// 410 comes back with its status and body, not folded into a failure. Node strips the .ts types; a
// resolve hook stands in for the browser-only supabase client and the session-expired toast.
import test from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'

const hook = `
export async function resolve(spec, ctx, next) {
  if (spec === './supabase') return { url: 'data:text/javascript,' + encodeURIComponent(
    'export const supabase = { auth: { getSession: async () => ({ data: { session: { access_token: "tok" } } }) } }'), shortCircuit: true }
  if (spec === './sessionExpired') return { url: 'data:text/javascript,' + encodeURIComponent(
    'export async function handleSessionExpired() { globalThis.__expired = (globalThis.__expired || 0) + 1 }'), shortCircuit: true }
  return next(spec, ctx)
}`
register('data:text/javascript,' + encodeURIComponent(hook), import.meta.url)

const sent = []
let reply = () => Response.json({ ok: true })
globalThis.fetch = async (_url, opts) => {
  sent.push(JSON.parse(opts.body))
  await new Promise(r => setTimeout(r, 10))
  return reply(JSON.parse(opts.body))
}
const { _sync, _syncRaw } = await import('./sync.ts')

test('two identical reads at the same moment share ONE request; a later read is sent again', async () => {
  sent.length = 0
  const [a, b] = await Promise.all([_sync('load'), _sync('load')])
  assert.deepEqual(a, { ok: true }); assert.deepEqual(b, { ok: true })
  assert.equal(sent.length, 1)
  await _sync('load')
  assert.equal(sent.length, 2, 'in-flight only — nothing is cached once answered')
})

test('writes are never de-duplicated, even when identical', async () => {
  sent.length = 0
  await Promise.all([
    _syncRaw('update_application', { id: 'x', updatedAt: 1, changes: { stage: 'Interview' } }),
    _syncRaw('update_application', { id: 'x', updatedAt: 1, changes: { stage: 'Interview' } }),
    _sync('remove_application', { id: 'x' }),
    _sync('remove_application', { id: 'x' }),
  ])
  assert.equal(sent.length, 4)
})

test('404 / 409 / 410 keep their status and body; _sync folds them to null; only 401 expires the session', async () => {
  globalThis.__expired = 0
  for (const status of [404, 409, 410]) {
    reply = () => Response.json({ error: 'x', status }, { status })
    const r = await _syncRaw('update_application', { id: 'x', changes: {} })
    assert.deepEqual(r, { ok: false, status, body: { error: 'x', status } })
    assert.equal(await _sync('update_application', { id: 'x', changes: {} }), null)
  }
  assert.equal(globalThis.__expired, 0)
  reply = () => Response.json({ error: 'Invalid token' }, { status: 401 })
  await _sync('load_profile')
  assert.equal(globalThis.__expired, 1)
  reply = () => Response.json({ ok: true })
})

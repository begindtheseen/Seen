// Guest saves never import into an account by themselves (CLAUDE.md "Sign-out data isolation"): a job
// saved while signed out is tagged, set aside at sign-in (stashGuestSaves), left out of the account's
// list by load(), and reaches the account ONLY through adoptGuestSaves (the Keep button) — via the same
// save_job action a tap on the heart uses. Node strips the .ts types; the resolve hook stands in for the
// browser-only ../sync module (the same arrangement as AppStore.test.mjs).
import test from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'

const hook = `
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
export async function resolve(spec, ctx, next) {
  if (spec === '../sync' || spec === './sync') return { url: 'data:text/javascript,' + encodeURIComponent(
    'export async function _sync(action, payload = {}) { globalThis.__syncCalls.push({ action, ...payload }); return globalThis.__syncReply(action, payload) }'), shortCircuit: true }
  if (spec.startsWith('.') && !/\\.[a-z]+$/i.test(spec) && ctx.parentURL) {
    const base = new URL(spec, ctx.parentURL)
    if (existsSync(fileURLToPath(base) + '.ts')) return { url: base.href + '.ts', shortCircuit: true }
  }
  return next(spec, ctx)
}`
register('data:text/javascript,' + encodeURIComponent(hook), import.meta.url)

const mem = new Map()
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  key: (i) => [...mem.keys()][i] ?? null,
  get length() { return mem.size },
}
globalThis.window = { dispatchEvent() { return true } }
globalThis.__syncCalls = []
globalThis.__syncReply = async (action) => (action === 'load' ? { saved_jobs: [{ job_id: 'acct-1', company: 'Acme', role: 'Clerk', saved_at: '2026-11-01T00:00:00Z' }] } : { ok: true })

const { SavedJobsStore } = await import('./SavedJobs.ts')
const job = (id) => ({ id, title: `Role ${id}`, company: `Co ${id}`, location: 'Phoenix, AZ', score: 70, apply_url: `https://example.com/${id}` })
const reset = () => { mem.clear(); globalThis.__syncCalls.length = 0 }

test('a save while signed out is tagged guest and sends nothing', () => {
  reset()
  SavedJobsStore.save(job('g1'), false)
  SavedJobsStore.save(job('g2'), false)
  assert.equal(globalThis.__syncCalls.length, 0)
  assert.deepEqual(SavedJobsStore.loadSync().map((s) => [s.job_id, s.guest]), [['g2', true], ['g1', true]])
  assert.equal(SavedJobsStore.isSaved('g1'), true)
})

test('sign-in sets guest saves aside: not in the list, not uploaded, offered once', async () => {
  reset()
  SavedJobsStore.save(job('g1'), false)
  SavedJobsStore.save(job('g2'), false)
  assert.equal(SavedJobsStore.stashGuestSaves(), 2)
  assert.equal(SavedJobsStore.stashGuestSaves(), 0, 'a second sign-in event finds nothing new to ask about')
  assert.deepEqual(SavedJobsStore.loadSync(), [])
  assert.deepEqual(SavedJobsStore.guestSaves().map((s) => s.job_id), ['g2', 'g1'])
  const list = await SavedJobsStore.load(true)
  assert.deepEqual(list.map((s) => s.job_id), ['acct-1'], 'the account list is the account list')
  assert.deepEqual(globalThis.__syncCalls.map((c) => c.action), ['load'], 'load never uploads a guest save')
  assert.equal(SavedJobsStore.isSaved('g1'), false)
})

test('load(true) itself sets a guest save aside if it runs before the sign-in handler did', async () => {
  reset()
  SavedJobsStore.save(job('g1'), false)
  await SavedJobsStore.load(true)
  assert.deepEqual(SavedJobsStore.loadSync().map((s) => s.job_id), ['acct-1'])
  assert.deepEqual(SavedJobsStore.guestSaves().map((s) => s.job_id), ['g1'])
  assert.deepEqual(globalThis.__syncCalls.map((c) => c.action), ['load'])
})

test('Keep sends each held job through save_job and adds it to the list; a refused one stays held', async () => {
  reset()
  SavedJobsStore.save(job('g1'), false)
  SavedJobsStore.save(job('g2'), false)
  SavedJobsStore.stashGuestSaves()
  await SavedJobsStore.load(true)
  globalThis.__syncCalls.length = 0
  globalThis.__syncReply = async (action, payload) => (action === 'save_job' && payload.job.id === 'g1' ? null : { ok: true })
  const r = await SavedJobsStore.adoptGuestSaves()
  assert.deepEqual(r, { kept: 1, failed: 1 })
  const sent = globalThis.__syncCalls.filter((c) => c.action === 'save_job').map((c) => c.job)
  assert.deepEqual(sent.map((j) => j.id), ['g2', 'g1'])
  assert.equal(sent[0].co, 'Co g2'); assert.equal(sent[0].title, 'Role g2'); assert.equal(sent[0].apply_url, 'https://example.com/g2')
  assert.deepEqual(SavedJobsStore.loadSync().map((s) => [s.job_id, s.guest]), [['g2', undefined], ['acct-1', undefined]])
  assert.deepEqual(SavedJobsStore.guestSaves().map((s) => s.job_id), ['g1'])
})

test('a save while signed in is untagged and goes to the account at once', () => {
  reset()
  SavedJobsStore.save(job('a1'), true)
  assert.deepEqual(SavedJobsStore.loadSync().map((s) => [s.job_id, s.guest]), [['a1', undefined]])
  assert.deepEqual(globalThis.__syncCalls.map((c) => c.action), ['save_job'])
  assert.equal(SavedJobsStore.stashGuestSaves(), 0)
})

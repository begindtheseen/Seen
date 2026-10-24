// lib/quietWindow: markQuiet() opens a 2-minute window that inQuietWindow() reports, in sessionStorage.
import test from 'node:test'
import assert from 'node:assert/strict'

const mem = new Map()
globalThis.sessionStorage = { getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k) }
const fired = []
globalThis.CustomEvent = class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail } }
globalThis.window = { dispatchEvent: e => { fired.push(e); return true } }

const { markQuiet, inQuietWindow, quietUntil, QUIET_MS, QUIET_EVENT } = await import('./quietWindow.ts')

test('a delete / withdraw / outcome opens a two-minute quiet window and announces it', () => {
  mem.clear(); fired.length = 0
  const t0 = Date.parse('2026-10-23T17:00:00Z')
  assert.equal(inQuietWindow(t0), false)
  markQuiet(t0)
  assert.equal(QUIET_MS, 120000)
  assert.equal(quietUntil(), t0 + QUIET_MS)
  assert.equal(inQuietWindow(t0 + 1), true)
  assert.equal(inQuietWindow(t0 + QUIET_MS - 1), true)
  assert.equal(inQuietWindow(t0 + QUIET_MS), false)
  assert.equal(fired.length, 1)
  assert.equal(fired[0].type, QUIET_EVENT)
  assert.equal(fired[0].detail.until, t0 + QUIET_MS)
})

test('a later action extends the window; garbage in storage reads as "not quiet"', () => {
  const t0 = Date.parse('2026-10-23T17:00:00Z')
  markQuiet(t0); markQuiet(t0 + 60000)
  assert.equal(quietUntil(), t0 + 60000 + QUIET_MS)
  mem.set('seen_quiet_until', 'nope')
  assert.equal(inQuietWindow(t0), false)
})

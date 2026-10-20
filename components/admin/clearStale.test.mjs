// Admin "Clear stale" must drain the WHOLE backlog in one click. Regression (prod 2026-10-17): the
// client made one call, the server could only clear ~3–4k rows inside its 15s limit, the toast said
// "more queued for the next run" — but the cron never drains the 7–14d window — so 14,700 stale
// rows and the alert stayed. Run: node --test components/admin/clearStale.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clearStaleUntilDone, clearStaleMessage } from './clearStale.ts'

// Fake purge endpoint: each call clears up to `perCall` of `backlog`; `kept` rows are never removable.
function fakeServer({ backlog, perCall = 4000, kept = 2, failOnCall = 0, zeroProgress = false }) {
  let left = backlog
  const calls = []
  const fetchImpl = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body), token: opts.headers['X-Admin-Token'] })
    if (failOnCall && calls.length === failOnCall) {
      return { ok: false, status: 500, async json() { return { error: 'Failed to clear stale listings', detail: 'sweep_stale_jobs HTTP 500' } } }
    }
    const d = zeroProgress ? 0 : Math.min(left, perCall); left -= d
    return { ok: true, status: 200, async json() {
      return { ok: true, deleted: d, retained: 0, staled: 0, removed: d, complete: left === 0, remaining: left, kept, ms: 6000 }
    } }
  }
  return { fetchImpl, calls, left: () => left }
}

test('loops purge_stale_jobs until the server reports complete — one click clears all 14,700', async () => {
  const s = fakeServer({ backlog: 14700 })
  const progress = []
  const r = await clearStaleUntilDone('tok', { fetchImpl: s.fetchImpl, onProgress: (p) => progress.push(p) })
  assert.equal(s.left(), 0)
  assert.equal(r.ok, true)
  assert.equal(r.complete, true)
  assert.equal(r.cleared, 14700)
  assert.equal(r.remaining, 0)
  assert.equal(r.rounds, 4)
  assert.deepEqual(progress.map((p) => p.remaining), [10700, 6700, 2700, 0])
  for (const c of s.calls) { assert.equal(c.url, '/api/admin-stats'); assert.equal(c.body.action, 'purge_stale_jobs'); assert.equal(c.token, 'tok') }
  assert.equal(clearStaleMessage(r), 'cleared 14,700 stale · 2 kept for saved/applied links')
})

test('stops at the round cap and says exactly how many are left — never "cleared" while rows remain', async () => {
  const s = fakeServer({ backlog: 14700 })
  const r = await clearStaleUntilDone('tok', { fetchImpl: s.fetchImpl, maxRounds: 2 })
  assert.equal(r.complete, false)
  assert.equal(r.cleared, 8000)
  assert.equal(r.remaining, 6700)
  assert.match(clearStaleMessage(r), /6,700 still left — click again/)
})

test('a failure mid-run keeps the rows already cleared and reports the error', async () => {
  const s = fakeServer({ backlog: 14700, failOnCall: 3 })
  const r = await clearStaleUntilDone('tok', { fetchImpl: s.fetchImpl })
  assert.equal(r.ok, true)
  assert.equal(r.cleared, 8000)
  assert.equal(r.complete, false)
  assert.match(r.error, /HTTP 500/)
  assert.match(clearStaleMessage(r), /cleared 8,000 stale.*stopped/)
})

test('a failure on the first call is a failure', async () => {
  const s = fakeServer({ backlog: 100, failOnCall: 1 })
  const r = await clearStaleUntilDone('tok', { fetchImpl: s.fetchImpl })
  assert.equal(r.ok, false)
  assert.match(clearStaleMessage(r), /^clear failed: sweep_stale_jobs HTTP 500/)
})

test('a round that makes no progress stops the loop instead of spinning 40 times', async () => {
  const s = fakeServer({ backlog: 500, zeroProgress: true })
  const r = await clearStaleUntilDone('tok', { fetchImpl: s.fetchImpl })
  assert.equal(s.calls.length, 1)
  assert.equal(r.complete, false)
})

test('respects the time budget', async () => {
  let t = 0
  const s = fakeServer({ backlog: 1e9, perCall: 1 })
  const fetchImpl = async (...a) => { t += 10_000; return s.fetchImpl(...a) }
  const r = await clearStaleUntilDone('tok', { fetchImpl, now: () => t, budgetMs: 30_000 })
  assert.equal(r.rounds, 3)
  assert.equal(r.complete, false)
})

// Prod 2026-10-19 23:00: Vercel killed a purge round at its 15s limit ("Task timed out after 15
// seconds"), the browser got a non-JSON 504, and the button said "clear failed" although every batch
// committed before the cut-off was saved. A lost round is retried; an explicit server error is not.
test('a timed-out round (504, non-JSON) is retried and the clear still completes', async () => {
  let left = 9000; let n = 0
  const fetchImpl = async () => {
    n++
    if (n === 2) return { ok: false, status: 504, async json() { throw new Error('not json') } }
    const d = Math.min(left, 4000); left -= d
    return { ok: true, status: 200, async json() { return { ok: true, deleted: d, retained: 0, staled: 0, complete: left === 0, remaining: left, kept: 1 } } }
  }
  const r = await clearStaleUntilDone('tok', { fetchImpl })
  assert.equal(r.ok, true)
  assert.equal(r.complete, true)
  assert.equal(r.remaining, 0)
  assert.equal(r.lostRounds, 1)
  assert.match(clearStaleMessage(r), /1 round timed out and retried \(work saved\)/)
})

test('a dropped connection on the first round is retried, not reported as a failed clear', async () => {
  let n = 0
  const fetchImpl = async () => {
    if (++n === 1) throw new Error('Failed to fetch')
    return { ok: true, status: 200, async json() { return { ok: true, deleted: 132, retained: 0, staled: 0, complete: true, remaining: 0, kept: 1 } } }
  }
  const r = await clearStaleUntilDone('tok', { fetchImpl })
  assert.equal(r.ok, true); assert.equal(r.cleared, 132); assert.equal(r.lostRounds, 1)
})

test('three lost rounds in a row stop with the real error — no endless retry', async () => {
  const fetchImpl = async () => ({ ok: false, status: 504, async json() { return {} } })
  const r = await clearStaleUntilDone('tok', { fetchImpl })
  assert.equal(r.rounds, 3)
  assert.equal(r.ok, true, 'rounds may have committed work before timing out')
  assert.match(clearStaleMessage(r), /stopped: HTTP 504/)
})

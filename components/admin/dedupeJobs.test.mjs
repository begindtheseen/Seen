// Admin "Remove dupes" must remove EVERY duplicate in one press (owner 2026-10-20: "It never clears out
// everything the first press of a button"). Run: node --test components/admin/dedupeJobs.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dedupeJobsUntilDone, dedupeMessage } from './dedupeJobs.ts'

function fakeServer({ dupes, perCall = 1500, protectedCount = 3, lose = [] }) {
  let left = dupes; let n = 0
  const calls = []
  const fetchImpl = async (url, opts) => {
    n++; calls.push(JSON.parse(opts.body))
    if (lose.includes(n)) return { ok: false, status: 504, async json() { throw new Error('not json') } }
    const d = Math.min(left, perCall); left -= d
    return { ok: true, status: 200, async json() { return { ok: true, deleted: d, remaining: left, complete: left === 0, protected: protectedCount, groups: 9, total: 27668 } } }
  }
  return { fetchImpl, calls, left: () => left }
}

test('one press repeats dedupe_jobs until the server says complete', async () => {
  const s = fakeServer({ dupes: 4000 })
  const seen = []
  const r = await dedupeJobsUntilDone('tok', { fetchImpl: s.fetchImpl, onProgress: (p) => seen.push(p.remaining) })
  assert.equal(s.left(), 0)
  assert.equal(r.complete, true)
  assert.equal(r.deleted, 4000)
  assert.deepEqual(seen, [2500, 1000, 0])
  assert.ok(s.calls.every((c) => c.action === 'dedupe_jobs'))
  assert.equal(dedupeMessage(r), '✓ Removed 4,000 duplicate listings · 3 kept (employer-posted or saved/applied by a user)')
})

test('a timed-out round is retried and the press still finishes', async () => {
  const s = fakeServer({ dupes: 3000, lose: [2] })
  const r = await dedupeJobsUntilDone('tok', { fetchImpl: s.fetchImpl })
  assert.equal(r.complete, true); assert.equal(r.deleted, 3000); assert.equal(r.lostRounds, 1)
})

test('nothing to remove reads as such; an unfinished press says how many are left', async () => {
  const none = await dedupeJobsUntilDone('tok', { fetchImpl: fakeServer({ dupes: 0, protectedCount: 0 }).fetchImpl })
  assert.equal(dedupeMessage(none), '✓ No duplicates to remove')
  const capped = await dedupeJobsUntilDone('tok', { fetchImpl: fakeServer({ dupes: 4000 }).fetchImpl, maxRounds: 1 })
  assert.equal(capped.complete, false)
  assert.match(dedupeMessage(capped), /^… Removed 1,500 .* 2,500 still left — press again/)
})

test('an explicit server error on the first round is a failure, not "removed 0"', async () => {
  const fetchImpl = async () => ({ ok: false, status: 500, async json() { return { error: 'Failed to remove duplicates', detail: 'could not read saved_jobs (HTTP 500) — nothing was deleted' } } })
  const r = await dedupeJobsUntilDone('tok', { fetchImpl })
  assert.equal(r.ok, false)
  assert.match(dedupeMessage(r), /^✗ remove failed: could not read saved_jobs/)
})

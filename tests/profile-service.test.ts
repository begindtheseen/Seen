// Unit tests for the profile service (load_profile extraction).
// Focus: ownership — the query is scoped to the uid passed in (which the route
// must source from verified auth), and the response shape matches the original
// user-sync `load_profile` action exactly: { profile: rows[0] || null }.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { loadProfile } from '../lib/profile/service.ts'
import type { ServiceDb } from '../lib/supabase/admin.ts'

// Build a fake ServiceDb that records the path and returns a canned response.
function fakeDb(rows: unknown, ok = true): { db: ServiceDb; paths: string[] } {
  const paths: string[] = []
  const db = ((path: string) => {
    paths.push(path)
    return Promise.resolve({
      ok,
      json: async () => rows,
    } as Response)
  }) as ServiceDb
  return { db, paths }
}

test('queries the profiles row scoped to the given uid', async () => {
  const { db, paths } = fakeDb([{ id: 'user-1', name: 'Ada' }])
  await loadProfile(db, 'user-1')
  assert.equal(paths.length, 1)
  assert.equal(paths[0], 'profiles?id=eq.user-1&limit=1')
})

test('ownership: a different uid produces a different scoped query', async () => {
  const { db, paths } = fakeDb([])
  await loadProfile(db, 'user-XYZ')
  assert.ok(paths[0].includes('id=eq.user-XYZ'))
  assert.ok(!paths[0].includes('user-1'))
})

test('returns { profile: firstRow } when a row exists', async () => {
  const { db } = fakeDb([{ id: 'user-1', name: 'Ada' }])
  const result = await loadProfile(db, 'user-1')
  assert.deepEqual(result, { profile: { id: 'user-1', name: 'Ada' } })
})

test('returns { profile: null } when no row exists', async () => {
  const { db } = fakeDb([])
  const result = await loadProfile(db, 'user-1')
  assert.deepEqual(result, { profile: null })
})

test('returns { profile: null } when the DB read fails', async () => {
  const { db } = fakeDb(null, false)
  const result = await loadProfile(db, 'user-1')
  assert.deepEqual(result, { profile: null })
})

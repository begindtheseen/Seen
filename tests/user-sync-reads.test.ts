// Unit tests for the user-sync read-only services (get_employment, get_recent_cos).
// Focus: ownership — the query is scoped to the uid passed in (sourced from
// verified auth in the route) — and the exact response shape is preserved.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { getEmployment } from '../lib/profile/service.ts'
import { getRecentCompanies } from '../lib/companies/service.ts'
import type { ServiceDb } from '../lib/supabase/admin.ts'

function fakeDb(rows: unknown, ok = true): { db: ServiceDb; paths: string[] } {
  const paths: string[] = []
  const db = ((path: string) => {
    paths.push(path)
    return Promise.resolve({ ok, json: async () => rows } as Response)
  }) as ServiceDb
  return { db, paths }
}

// ── getEmployment ──────────────────────────────────────────────────────────────

test('getEmployment queries resume_employment scoped to the uid', async () => {
  const { db, paths } = fakeDb([{ company: 'Acme' }])
  await getEmployment(db, 'user-1')
  assert.equal(paths[0], 'resume_employment?user_id=eq.user-1&order=id.desc&limit=15')
})

test('getEmployment ownership: a different uid changes the scoped query', async () => {
  const { db, paths } = fakeDb([])
  await getEmployment(db, 'user-ZZZ')
  assert.ok(paths[0].includes('user_id=eq.user-ZZZ'))
  assert.ok(!paths[0].includes('user-1'))
})

test('getEmployment returns { employment: rows } and [] on failure', async () => {
  const rows = [{ company: 'Acme', title: 'Eng' }]
  assert.deepEqual(await getEmployment(fakeDb(rows).db, 'u'), { employment: rows })
  assert.deepEqual(await getEmployment(fakeDb(null, false).db, 'u'), { employment: [] })
})

// ── getRecentCompanies ──────────────────────────────────────────────────────────

test('getRecentCompanies queries user_recent_cos scoped to the uid', async () => {
  const { db, paths } = fakeDb([{ company_name: 'Acme' }])
  await getRecentCompanies(db, 'user-1')
  assert.equal(paths[0], 'user_recent_cos?user_id=eq.user-1&order=viewed_at.desc&limit=6')
})

test('getRecentCompanies ownership: a different uid changes the scoped query', async () => {
  const { db, paths } = fakeDb([])
  await getRecentCompanies(db, 'user-ZZZ')
  assert.ok(paths[0].includes('user_id=eq.user-ZZZ'))
  assert.ok(!paths[0].includes('user-1'))
})

test('getRecentCompanies returns { recent: rows } and [] on failure', async () => {
  const rows = [{ company_name: 'Acme' }]
  assert.deepEqual(await getRecentCompanies(fakeDb(rows).db, 'u'), { recent: rows })
  assert.deepEqual(await getRecentCompanies(fakeDb(null, false).db, 'u'), { recent: [] })
})

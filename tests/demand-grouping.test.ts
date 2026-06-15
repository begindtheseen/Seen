// Unit tests for the public GET /api/demand grouping logic.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { groupDemandRows, type DemandRow } from '../lib/demand/grouping.ts'

const rows: DemandRow[] = [
  {
    city: 'Austin, TX',
    urg: 'hot',
    src: 'BLS JOLTS',
    role_title: 'Software Engineer',
    niche: 'Tech / Software',
    level: 'Mid level',
    count: 1200,
    di: 88,
    note: 'note A',
    updated_at: '2026-01-02T00:00:00Z',
    bls_period: '2025-M12',
  },
  {
    city: 'Austin, TX',
    urg: 'hot',
    src: 'BLS JOLTS',
    role_title: 'Data Analyst',
    niche: 'Tech / Software',
    level: 'Mid level',
    count: 800,
    di: 81,
    note: null,
    updated_at: '2026-01-05T00:00:00Z',
    bls_period: '2025-M12',
  },
  {
    city: 'Miami, FL',
    urg: 'warm',
    src: 'BLS JOLTS',
    role_title: 'Registered Nurse',
    niche: 'Healthcare',
    level: 'Mid level',
    count: 600,
    di: 70,
    note: 'note C',
    updated_at: '2026-01-01T00:00:00Z',
    bls_period: '2025-M12',
  },
]

test('groups rows by city and preserves order of first appearance', () => {
  const result = groupDemandRows(rows)
  assert.equal(result.demand.length, 2)
  assert.deepEqual(
    result.demand.map((c) => c.city),
    ['Austin, TX', 'Miami, FL'],
  )
  assert.equal(result.demand[0].jobs.length, 2)
  assert.equal(result.demand[1].jobs.length, 1)
})

test('maps each row into the compact job shape and coerces null note to empty string', () => {
  const result = groupDemandRows(rows)
  assert.deepEqual(result.demand[0].jobs[0], {
    t: 'Software Engineer',
    n: 'Tech / Software',
    l: 'Mid level',
    count: 1200,
    di: 88,
    note: 'note A',
  })
  // second Austin row had note: null -> ''
  assert.equal(result.demand[0].jobs[1].note, '')
})

test('surfaces the newest updated_at, first bls_period, and total row count', () => {
  const result = groupDemandRows(rows)
  assert.equal(result.generated_at, '2026-01-05T00:00:00Z')
  assert.equal(result.bls_period, '2025-M12')
  assert.equal(result.row_count, 3)
})

test('returns nulls for generated_at/bls_period on empty input', () => {
  const result = groupDemandRows([])
  assert.deepEqual(result, {
    demand: [],
    generated_at: null,
    bls_period: null,
    row_count: 0,
  })
})

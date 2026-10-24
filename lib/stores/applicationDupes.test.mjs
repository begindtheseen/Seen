// "Clear dupes" rule: open duplicates only, OLDEST kept (original date + events), case/space-insensitive.
import test from 'node:test'
import assert from 'node:assert/strict'
import { splitOpenDuplicates } from './applicationDupes.ts'

const D = Date.parse('2026-10-20T19:00:00Z')
const app = (id, company, role, status, daysAgo) => ({ id, company, role, status, appliedAt: D - daysAgo * 86400000 })

test('two open applications for the same company + role: the NEWER one is the duplicate (the original keeps its date and events)', () => {
  const r = splitOpenDuplicates([app('a', 'Walmart', 'Cashier', 'active', 3), app('b', ' walmart ', 'CASHIER', 'active', 1)])
  assert.deepEqual(r.removed.map(a => a.id), ['b'])
  assert.deepEqual(r.kept.map(a => a.id), ['a'])
})

test('a finished application at the same company is history, not a duplicate; different roles are distinct', () => {
  const r = splitOpenDuplicates([
    app('old', 'Target', 'Guest Advocate', 'rejected', 200),
    app('now', 'Target', 'Guest Advocate', 'active', 2),
    app('other', 'Target', 'Cashier', 'active', 1),
  ])
  assert.equal(r.removed.length, 0)
  assert.equal(r.kept.length, 3)
})

test('one or zero applications never produce a duplicate (the tracker hides the button)', () => {
  assert.equal(splitOpenDuplicates([]).removed.length, 0)
  assert.equal(splitOpenDuplicates([app('only', 'Chipotle', 'Crew Member', 'active', 0)]).removed.length, 0)
})

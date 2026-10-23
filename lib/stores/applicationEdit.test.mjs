// The add / edit form contract: what reaches AppStore.add / AppStore.update ("Edit" on a card).
import test from 'node:test'
import assert from 'node:assert/strict'
import { emptyForm, formFromApplication, validateForm, toNewApplication, editChanges, appliedAtFromDay, todayPacific } from './applicationEdit.ts'
import { pacificDate } from '../time/pacific.js'

// 2026-10-23 10:00 PT
const NOW = Date.parse('2026-10-23T17:00:00Z')

test('the add form defaults to today on the California calendar, applied via Direct', () => {
  const f = emptyForm(NOW)
  assert.equal(f.appliedOn, '2026-10-23')
  assert.equal(f.platform, 'Direct')
  // 2026-10-23 23:30 PT is still Oct 23 (it is Oct 24 in UTC)
  assert.equal(todayPacific(Date.parse('2026-10-24T06:30:00Z')), '2026-10-23')
})

test('applied today keeps the real clock time; an earlier day becomes noon PT of that day', () => {
  assert.equal(appliedAtFromDay('2026-10-23', NOW), NOW)
  const t = appliedAtFromDay('2026-10-20', NOW)
  assert.equal(new Date(t).toISOString(), '2026-10-20T19:00:00.000Z') // noon PDT
  assert.equal(pacificDate(new Date(t)), '2026-10-20')
  // a winter day (PST) is also noon PT
  assert.equal(new Date(appliedAtFromDay('2026-01-15', NOW)).toISOString(), '2026-01-15T20:00:00.000Z')
  // garbage → now (never NaN)
  assert.equal(appliedAtFromDay('nope', NOW), NOW)
})

test('validation: company and role required, no future dates', () => {
  const f = { ...emptyForm(NOW), company: 'Target', role: 'Cashier' }
  assert.equal(validateForm(f, NOW), null)
  assert.match(validateForm({ ...f, company: ' ' }, NOW), /Company/)
  assert.match(validateForm({ ...f, role: '' }, NOW), /Role/)
  assert.match(validateForm({ ...f, appliedOn: '2026-10-24' }, NOW), /future/)
  assert.match(validateForm({ ...f, appliedOn: '' }, NOW), /day you applied/)
})

test('toNewApplication trims and starts at Applied / active', () => {
  const a = toNewApplication({ company: ' Target ', role: ' Cashier ', location: '', platform: '', appliedOn: '2026-10-20' }, NOW)
  assert.deepEqual(a, { company: 'Target', role: 'Cashier', location: '', platform: 'Direct', appliedAt: appliedAtFromDay('2026-10-20', NOW), stage: 'Applied', status: 'active' })
})

test('editChanges sends only what changed — a no-op Save is {}', () => {
  const prev = { company: 'Walmart', role: 'Cashier', location: 'Phoenix, AZ', platform: 'Direct', appliedAt: NOW - 3 * 86400000 }
  const f = formFromApplication(prev)
  assert.deepEqual(f, { company: 'Walmart', role: 'Cashier', location: 'Phoenix, AZ', platform: 'Direct', appliedOn: '2026-10-20' })
  assert.deepEqual(editChanges(prev, f, NOW), {})
  assert.deepEqual(editChanges(prev, { ...f, company: 'Target' }, NOW), { company: 'Target' })
  const moved = editChanges(prev, { ...f, appliedOn: '2026-10-18', platform: 'Indeed' }, NOW)
  assert.equal(moved.platform, 'Indeed')
  assert.equal(pacificDate(new Date(moved.appliedAt)), '2026-10-18')
  assert.equal('company' in moved, false)
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { deleteConfirmReady, deleteBlockedBySubscription, DELETE_CONSEQUENCES, DELETE_CONFIRM_WORD } from './accountDelete.js'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(path.join(root, p), 'utf8')

test('the typed confirmation must be the exact word', () => {
  assert.equal(deleteConfirmReady('DELETE'), true)
  assert.equal(deleteConfirmReady('  DELETE '), true)
  assert.equal(deleteConfirmReady('delete'), false)
  assert.equal(deleteConfirmReady('DELET'), false)
  assert.equal(deleteConfirmReady(''), false)
  assert.equal(deleteConfirmReady(null), false)
  assert.equal(DELETE_CONFIRM_WORD, 'DELETE')
})

test('a live subscription blocks deletion until it is set to cancel (the server never cancels Stripe)', () => {
  assert.equal(deleteBlockedBySubscription(null), false)
  assert.equal(deleteBlockedBySubscription({ status: 'active', cancel_at_period_end: false }), true)
  assert.equal(deleteBlockedBySubscription({ status: 'trialing', cancel_at_period_end: false }), true)
  assert.equal(deleteBlockedBySubscription({ status: 'past_due', cancel_at_period_end: false }), true)
  assert.equal(deleteBlockedBySubscription({ status: 'active', cancel_at_period_end: true }), false)
  assert.equal(deleteBlockedBySubscription({ status: 'canceled', cancel_at_period_end: false }), false)
  // pin the fact the rule rests on: delete_account touches no Stripe endpoint
  const sync = read('api/user-sync.js')
  const start = sync.indexOf("if (action === 'delete_account')")
  const block = sync.slice(start, sync.indexOf('\n  if (action ===', start + 10))
  assert.ok(start > 0 && block.length > 200)
  assert.doesNotMatch(block, /stripe/i, 'delete_account now talks to Stripe — update the dialog rule and this test')
})

test('the consequences list names paid items and that reports stay published', () => {
  const joined = DELETE_CONSEQUENCES.join(' ')
  assert.match(joined, /purchased/)
  assert.match(joined, /none of it is refunded/)
  assert.match(joined, /Reports you submitted stay published/)
})

test('Settings uses the dialog, not window.confirm, for deletion', () => {
  const profile = read('app/profile/page.tsx')
  assert.doesNotMatch(profile, /confirm\('This permanently deletes/)
  assert.match(profile, /<DeleteAccountDialog/)
  const dialog = read('components/profile/DeleteAccountDialog.tsx')
  assert.match(dialog, /deleteConfirmReady\(/)
  assert.match(dialog, /deleteBlockedBySubscription\(/)
  assert.match(dialog, /DELETE_CONSEQUENCES/)
})

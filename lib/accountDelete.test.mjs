import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { deleteConfirmReady, deletionCancelsSubscription, SUBSCRIPTION_CANCEL_NOTICE, DELETE_CONSEQUENCES, DELETE_CONFIRM_WORD } from './accountDelete.js'

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

test('deletion says it cancels a live subscription, and the server really does cancel it first', () => {
  assert.equal(deletionCancelsSubscription(null), false)
  assert.equal(deletionCancelsSubscription({ status: 'active', cancel_at_period_end: false }), true)
  assert.equal(deletionCancelsSubscription({ status: 'trialing', cancel_at_period_end: false }), true)
  assert.equal(deletionCancelsSubscription({ status: 'active', cancel_at_period_end: true }), true)
  assert.equal(deletionCancelsSubscription({ status: 'canceled', cancel_at_period_end: false }), false)
  assert.match(SUBSCRIPTION_CANCEL_NOTICE, /not refunded/)
  // pin the fact the notice rests on: delete_account cancels Stripe BEFORE its first row delete
  const sync = read('api/user-sync.js')
  const start = sync.indexOf("if (action === 'delete_account')")
  const block = sync.slice(start, sync.indexOf('\n  if (action ===', start + 10))
  assert.ok(start > 0 && block.length > 200)
  const cancelAt = block.indexOf('cancelLiveSubscriptions(')
  assert.ok(cancelAt > 0, 'delete_account must cancel live subscriptions')
  assert.ok(cancelAt < block.indexOf("method: 'DELETE'"), 'and do it before deleting anything')
})

test('the consequences list names paid items and that reports stay published', () => {
  const joined = DELETE_CONSEQUENCES.join(' ')
  assert.match(joined, /purchased/)
  assert.match(joined, /none of it is refunded/)
  assert.match(joined, /Reports you submitted stay published/)
  assert.match(joined, /cancelled immediately/)
})

test('Settings uses the dialog, not window.confirm, for deletion', () => {
  const profile = read('app/profile/page.tsx')
  assert.doesNotMatch(profile, /confirm\('This permanently deletes/)
  assert.match(profile, /<DeleteAccountDialog/)
  const dialog = read('components/profile/DeleteAccountDialog.tsx')
  assert.match(dialog, /deleteConfirmReady\(/)
  assert.match(dialog, /deletionCancelsSubscription\(/)
  assert.match(dialog, /SUBSCRIPTION_CANCEL_NOTICE/)
  assert.match(dialog, /DELETE_CONSEQUENCES/)
})

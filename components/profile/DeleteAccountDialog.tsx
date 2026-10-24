'use client'

// "Delete my account" — built on THE danger-confirm shell (components/DangerConfirmDialog: solid
// #0e111c surface, focus trap, Escape/backdrop = keep), not a native confirm(). It lists exactly what
// delete_account removes (lib/accountDelete.js) and requires the word DELETE typed. When a Seen Pro
// subscription is live it says, before the user confirms, that deletion cancels it immediately (the
// server does that first and deletes nothing if it cannot) — it never blocks on the subscription.

import { useState } from 'react'
import DangerConfirmDialog from '@/components/DangerConfirmDialog'
import { DELETE_CONFIRM_WORD, DELETE_CONSEQUENCES, SUBSCRIPTION_CANCEL_NOTICE, deleteConfirmReady, deletionCancelsSubscription } from '@/lib/accountDelete.js'

export type SubscriptionSummary = { status: string; cancel_at_period_end: boolean } | null

export default function DeleteAccountDialog({ email, subscription, onConfirm, onClose }: {
  email: string
  /** The live Stripe subscription summary from Settings, or null when there is none. */
  subscription: SubscriptionSummary
  onConfirm: () => Promise<void>
  onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const cancelsSubscription = deletionCancelsSubscription(subscription)

  // The shell only calls this once DELETE is typed (deleteConfirmReady) and nothing is running.
  async function go() {
    if (busy) return
    setBusy(true); setErr('')
    try { await onConfirm() } catch { setErr('Deletion did not go through — nothing was removed. Try again or email hello@seenjobs.io.'); setBusy(false) }
  }

  return (
    <DangerConfirmDialog
      testId="delete-account-dialog"
      confirmTestId="delete-account-confirm"
      eyebrow="Danger zone"
      title={`Delete ${email || 'this account'} for good?`}
      maxWidth={440}
      confirmLabel="Delete my account permanently"
      busyLabel="Deleting…"
      cancelLabel="Keep my account"
      typeToConfirm={DELETE_CONFIRM_WORD}
      matchesTyped={deleteConfirmReady}
      busy={busy}
      error={err}
      onConfirm={go}
      onCancel={onClose}
    >
      <p style={{ fontSize: '.78rem', color: 'var(--sub)', lineHeight: 1.6, margin: '0 0 .5rem' }}>This removes, with no undo:</p>
      <ul style={{ margin: '0 0 .8rem', paddingLeft: '1.1rem' }}>
        {DELETE_CONSEQUENCES.map(c => <li key={c} style={{ fontSize: '.76rem', color: 'var(--sub)', lineHeight: 1.55, marginBottom: '.25rem' }}>{c}</li>)}
      </ul>
      {cancelsSubscription && (
        <div role="note" style={{ background: 'rgba(245,158,11,.08)', border: '1px solid rgba(245,158,11,.3)', borderRadius: 10, padding: '.7rem .85rem', marginBottom: '.9rem', fontSize: '.76rem', color: 'var(--sub)', lineHeight: 1.55 }}>
          {SUBSCRIPTION_CANCEL_NOTICE}
        </div>
      )}
    </DangerConfirmDialog>
  )
}

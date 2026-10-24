'use client'

// "Delete my account" — built on THE danger-confirm shell (components/DangerConfirmDialog: solid
// #0e111c surface, focus trap, Escape/backdrop = keep), not a native confirm(). It lists exactly what
// delete_account removes (lib/accountDelete.js), requires the word DELETE typed, and refuses to run
// while a Seen Pro subscription is still live, because the server deletes the Seen account without
// cancelling Stripe.

import { useState } from 'react'
import DangerConfirmDialog from '@/components/DangerConfirmDialog'
import { DELETE_CONFIRM_WORD, DELETE_CONSEQUENCES, deleteConfirmReady, deleteBlockedBySubscription } from '@/lib/accountDelete.js'

export type SubscriptionSummary = { status: string; cancel_at_period_end: boolean } | null

export default function DeleteAccountDialog({ email, subscription, onConfirm, onClose, onManageBilling }: {
  email: string
  /** The live Stripe subscription summary from Settings, or null when there is none. */
  subscription: SubscriptionSummary
  onConfirm: () => Promise<void>
  onClose: () => void
  /** Scrolls to / opens the cancel control in Plan & billing. */
  onManageBilling: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const blocked = deleteBlockedBySubscription(subscription)

  async function go() {
    if (busy || blocked) return
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
      confirmDisabled={blocked}
      busy={busy}
      error={err}
      onConfirm={go}
      onCancel={onClose}
    >
      <p style={{ fontSize: '.78rem', color: 'var(--sub)', lineHeight: 1.6, margin: '0 0 .5rem' }}>This removes, with no undo:</p>
      <ul style={{ margin: '0 0 .8rem', paddingLeft: '1.1rem' }}>
        {DELETE_CONSEQUENCES.map(c => <li key={c} style={{ fontSize: '.76rem', color: 'var(--sub)', lineHeight: 1.55, marginBottom: '.25rem' }}>{c}</li>)}
      </ul>
      {blocked && (
        <div role="alert" style={{ background: 'rgba(245,158,11,.08)', border: '1px solid rgba(245,158,11,.3)', borderRadius: 10, padding: '.7rem .85rem', marginBottom: '.9rem' }}>
          <div style={{ fontSize: '.78rem', color: 'var(--white)', fontWeight: 600, marginBottom: '.2rem' }}>Cancel your Seen Pro membership first.</div>
          <div style={{ fontSize: '.75rem', color: 'var(--sub)', lineHeight: 1.55 }}>
            Deleting the account does not cancel billing with Stripe, so a live membership would keep renewing with no account behind it. Cancel it in Plan &amp; billing (you keep Pro to the end of the paid period), then come back here.
          </div>
          <button type="button" onClick={onManageBilling} style={{ marginTop: '.6rem', minHeight: 44, padding: '.5rem .9rem', background: 'none', border: '1px solid rgba(245,158,11,.45)', color: '#fbbf24', borderRadius: 8, fontFamily: 'var(--mono)', fontSize: '.75rem', cursor: 'pointer' }}>
            Go to Plan &amp; billing →
          </button>
        </div>
      )}
    </DangerConfirmDialog>
  )
}

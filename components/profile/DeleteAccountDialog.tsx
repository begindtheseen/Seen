'use client'

// "Delete my account" — the app's dialog pattern (solid #0e111c surface over a dimmed page, see
// CreditConfirmDialog), not a native confirm(). It lists exactly what delete_account removes
// (lib/accountDelete.js) and requires the word DELETE typed. When a Seen Pro subscription is live it
// says, before the user confirms, that deletion cancels it immediately (the server does that first and
// deletes nothing if it cannot).

import { useEffect, useState } from 'react'
import ModalPortal from '@/components/ModalPortal'
import { DELETE_CONFIRM_WORD, DELETE_CONSEQUENCES, SUBSCRIPTION_CANCEL_NOTICE, deleteConfirmReady, deletionCancelsSubscription } from '@/lib/accountDelete.js'

export type SubscriptionSummary = { status: string; cancel_at_period_end: boolean } | null

export default function DeleteAccountDialog({ email, subscription, onConfirm, onClose }: {
  email: string
  /** The live Stripe subscription summary from Settings, or null when there is none. */
  subscription: SubscriptionSummary
  onConfirm: () => Promise<void>
  onClose: () => void
}) {
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const cancelsSubscription = deletionCancelsSubscription(subscription)
  const ready = deleteConfirmReady(typed)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, busy])

  async function go() {
    if (!ready || busy) return
    setBusy(true); setErr('')
    try { await onConfirm() } catch { setErr('Deletion did not go through — nothing was removed. Try again or email hello@seenjobs.io.'); setBusy(false) }
  }

  const mono: React.CSSProperties = { fontFamily: 'var(--mono)', fontSize: '.6rem', lineHeight: 1.6 }

  return (
    <ModalPortal>
      <div role="dialog" aria-modal="true" aria-labelledby="delete-account-title" data-testid="delete-account-dialog"
        style={{ position: 'fixed', inset: 0, zIndex: 9950, background: 'rgba(0,0,0,.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
        onClick={() => { if (!busy) onClose() }}>
        <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 440, background: '#0e111c', border: '1px solid rgba(239,68,68,.35)', borderRadius: 16, padding: '1.15rem 1.2rem 1rem', boxShadow: '0 30px 80px rgba(0,0,0,.7)' }}>
          <div style={{ ...mono, fontSize: '.52rem', textTransform: 'uppercase', letterSpacing: '.1em', color: '#f87185', marginBottom: '.5rem' }}>Danger zone</div>
          <div id="delete-account-title" style={{ fontFamily: 'var(--display)', fontSize: '1rem', fontWeight: 800, color: 'var(--white)', lineHeight: 1.3, marginBottom: '.45rem' }}>
            Delete {email || 'this account'} for good?
          </div>
          <p style={{ fontSize: '.78rem', color: 'var(--sub)', lineHeight: 1.6, margin: '0 0 .5rem' }}>This removes, with no undo:</p>
          <ul style={{ margin: '0 0 .8rem', paddingLeft: '1.1rem' }}>
            {DELETE_CONSEQUENCES.map(c => <li key={c} style={{ fontSize: '.76rem', color: 'var(--sub)', lineHeight: 1.55, marginBottom: '.25rem' }}>{c}</li>)}
          </ul>

          {cancelsSubscription && (
            <div role="note" style={{ background: 'rgba(245,158,11,.08)', border: '1px solid rgba(245,158,11,.3)', borderRadius: 10, padding: '.7rem .85rem', marginBottom: '.9rem', fontSize: '.76rem', color: 'var(--sub)', lineHeight: 1.55 }}>
              {SUBSCRIPTION_CANCEL_NOTICE}
            </div>
          )}
          <label style={{ display: 'block', marginBottom: '.9rem' }}>
            <span style={{ ...mono, color: 'var(--dim)', display: 'block', marginBottom: '.35rem' }}>Type {DELETE_CONFIRM_WORD} to confirm</span>
            <input
              value={typed}
              onChange={e => setTyped(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') go() }}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              aria-label={`Type ${DELETE_CONFIRM_WORD} to confirm`}
              placeholder={DELETE_CONFIRM_WORD}
              style={{ width: '100%', boxSizing: 'border-box', background: 'var(--surface)', border: '1.5px solid var(--line2)', borderRadius: 8, padding: '.65rem .85rem', color: 'var(--white)', fontFamily: 'var(--mono)', fontSize: '.85rem', letterSpacing: '.12em', outline: 'none' }}
            />
          </label>

          {err && <div role="alert" style={{ ...mono, color: '#f87185', marginBottom: '.7rem' }}>{err}</div>}

          <div style={{ display: 'flex', gap: '.5rem', flexDirection: 'column' }}>
            <button
              type="button"
              onClick={go}
              disabled={!ready || busy}
              data-testid="delete-account-confirm"
              style={{ width: '100%', padding: '.75rem 1rem', background: ready ? 'linear-gradient(135deg,#ef4444 0%,#b91c1c 100%)' : 'rgba(239,68,68,.15)', color: ready ? '#fff' : 'rgba(255,255,255,.45)', border: 'none', borderRadius: 10, fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.86rem', cursor: ready && !busy ? 'pointer' : 'not-allowed' }}
            >
              {busy ? 'Deleting…' : 'Delete my account permanently'}
            </button>
            <button type="button" onClick={onClose} disabled={busy} style={{ width: '100%', padding: '.6rem 1rem', background: 'none', border: '1px solid var(--line2)', color: 'var(--muted)', borderRadius: 10, fontFamily: 'var(--mono)', fontSize: '.7rem', cursor: 'pointer' }}>
              Keep my account
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  )
}

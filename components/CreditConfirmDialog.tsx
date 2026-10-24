'use client'

// The one-time "This uses 1 of your N credits" confirmation shown before the FIRST paid AI
// action on an account/device (lib/creditConfirm.ts remembers the answer). Solid surface
// (#0e111c — never translucent over content, per the 2026-10-19 overlay rule), sits above
// every drawer/modal, and reads the live balance so N is never a guess.

import { useEffect, useRef, useState } from 'react'
import { useFocusTrap } from '@/lib/hooks/useFocusTrap'
import { useAuth } from '@/lib/auth'
import { aiHeaders } from '@/lib/aiHeaders'
import { creditCostLabel, dailyResetLabel } from '@/lib/creditRules'
import { markCreditUseConfirmed } from '@/lib/creditConfirm'
import ModalPortal from '@/components/ModalPortal'

export default function CreditConfirmDialog({ cost = 1, action, onConfirm, onCancel }: {
  cost?: number
  /** What the credit buys, e.g. "optimize your résumé for this job". */
  action: string
  onConfirm: () => void
  onCancel: () => void
}) {
  const { user } = useAuth()
  const [balance, setBalance] = useState<number | null>(null)
  const [pro, setPro] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  useFocusTrap(boxRef, true)

  useEffect(() => {
    let cancelled = false
    aiHeaders()
      .then(h => fetch('/api/user-sync', { method: 'POST', headers: h, body: JSON.stringify({ action: 'get_credits' }) }))
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled && d) { setBalance(typeof d.balance === 'number' ? d.balance : null); setPro(!!d.pro) } })
      .catch(() => { /* balance stays unknown — the copy degrades to "your credits" */ })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const label = creditCostLabel(cost)
  const headline = pro
    ? 'Pro — no credit is used'
    : balance != null
      ? `This uses ${cost} of your ${balance} credit${balance === 1 ? '' : 's'}.`
      : `This uses ${label}.`

  return (
    <ModalPortal>
      <div role="dialog" aria-modal="true" aria-labelledby="credit-confirm-title" data-testid="credit-confirm"
        style={{ position: 'fixed', inset: 0, zIndex: 9950, background: 'rgba(0,0,0,.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
        onClick={onCancel}>
        <div ref={boxRef} onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 380, background: '#0e111c', border: '1px solid var(--line2)', borderRadius: 16, padding: '1.15rem 1.2rem 1rem', boxShadow: '0 30px 80px rgba(0,0,0,.7)' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--dim)', marginBottom: '.5rem' }}>AI credit</div>
          <div id="credit-confirm-title" style={{ fontFamily: 'var(--display)', fontSize: '1rem', fontWeight: 800, color: 'var(--white)', lineHeight: 1.3, marginBottom: '.45rem' }}>{headline}</div>
          <p style={{ fontSize: '.78rem', color: 'var(--sub)', lineHeight: 1.6, margin: '0 0 .5rem' }}>
            {cost === 0 ? `We will ${action} for free.` : `It will ${action}. Every AI action costs ${label}; you will see the price on the button each time.`}
          </p>
          <p style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--muted)', lineHeight: 1.6, margin: '0 0 1rem' }}>
            {dailyResetLabel()} · purchased credits never reset · we only ask this once.
          </p>
          <div style={{ display: 'flex', gap: '.5rem', flexDirection: 'column' }}>
            <button
              type="button"
              onClick={() => { markCreditUseConfirmed(user?.id); onConfirm() }}
              style={{ width: '100%', padding: '.75rem 1rem', background: 'linear-gradient(135deg,#3b82f6 0%,#8b5cf6 100%)', color: '#fff', border: 'none', borderRadius: 10, fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.86rem', cursor: 'pointer' }}
            >
              {pro ? 'Continue' : `Use ${label}`}
            </button>
            <button type="button" onClick={onCancel} style={{ width: '100%', padding: '.6rem 1rem', background: 'none', border: '1px solid var(--line2)', color: 'var(--muted)', borderRadius: 10, fontFamily: 'var(--mono)', fontSize: '.7rem', cursor: 'pointer' }}>
              Not now
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  )
}

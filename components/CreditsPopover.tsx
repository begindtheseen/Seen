'use client'

// The credits chip's popover (components/Nav.tsx). Solid #0e111c (never translucent over
// content), anchored under the chip. Shows the balance, how the daily credit resets, what has
// been earned today, and the two ways to get more. All numbers come from /api/user-sync
// get_credits (balance = daily + purchased, daily_earned, max_daily_earn, welcome) and the
// credit constants — nothing hand-typed.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { FREE_DAILY_CREDITS, WELCOME_CREDITS, MAX_DAILY_EARN, CREDIT_RESET_LABEL, balanceExplanation } from '@/lib/creditRules'

export interface CreditInfo {
  balance: number
  daily_earned?: number | null
  max_daily_earn?: number | null
  /** true = no ai_credits row yet: the balance shown is the untouched welcome bonus. */
  welcome?: boolean
  /** Today's resetting part of the balance (ai_credits.balance) — null when the API predates it. */
  daily?: number | null
  /** Never-resetting purchased credits (ai_credits.purchased_credits). */
  purchased?: number | null
}

export default function CreditsPopover({ info, onClose, onEarn, onUpgrade }: {
  info: CreditInfo
  onClose: () => void
  /** Opens the earn-credits survey. */
  onEarn: () => void
  /** Opens the upgrade modal (zero balance). */
  onUpgrade: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  // The popover hangs from the chip's right edge. On a phone the chip sits mid-bar (bell, saved
  // and avatar follow it), so a right-anchored 280px panel would run off the LEFT edge; measure
  // once after mount and slide it right until it keeps a 12px gutter.
  const [shift, setShift] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const gutter = 12
    if (r.left < gutter) setShift(Math.round(gutter - r.left))
  }, [])

  useEffect(() => {
    const onDown = (e: MouseEvent | TouchEvent) => {
      const el = ref.current
      if (!el) return
      const t = e.target as Node
      // The chip itself toggles; anything else outside closes.
      if (!el.contains(t) && !(t instanceof Element && t.closest('[data-credits-chip]'))) onClose()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const earned = Math.max(0, Number(info.daily_earned) || 0)
  const earnCap = Number(info.max_daily_earn) || MAX_DAILY_EARN
  const zero = info.balance <= 0

  const row: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: '.75rem', fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--sub)', lineHeight: 1.5 }
  const val: React.CSSProperties = { color: 'var(--white)', fontWeight: 600, flexShrink: 0 }
  const link: React.CSSProperties = { flex: 1, textAlign: 'center', padding: '.5rem .6rem', borderRadius: 8, border: '1px solid var(--line2)', background: 'none', color: 'var(--white)', fontFamily: 'var(--mono)', fontSize: '.62rem', textDecoration: 'none', cursor: 'pointer' }

  return (
    <div ref={ref} role="dialog" aria-label="Your AI credits" data-testid="credits-popover"
      style={{ position: 'absolute', top: 'calc(100% + 8px)', right: -shift, width: 'min(280px, calc(100vw - 24px))', background: '#0e111c', border: '1px solid var(--line2)', borderRadius: 14, padding: '.95rem 1rem .9rem', boxShadow: '0 24px 60px rgba(0,0,0,.6)', zIndex: 1300, textAlign: 'left' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '.5rem', marginBottom: '.65rem' }}>
        <span style={{ fontFamily: 'var(--display)', fontSize: '1.5rem', fontWeight: 800, color: zero ? 'var(--red)' : 'var(--white)', lineHeight: 1 }}>{info.balance}</span>
        <span style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '.08em' }}>AI credit{info.balance === 1 ? '' : 's'} available</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '.3rem', paddingBottom: '.7rem', borderBottom: '1px solid var(--line)', marginBottom: '.7rem' }}>
        <div style={row}><span>Free daily credit</span><span style={val}>{FREE_DAILY_CREDITS} · resets at {CREDIT_RESET_LABEL}</span></div>
        <div style={row}><span>Earned today</span><span style={val}>{earned} of {earnCap}</span></div>
        {info.welcome && <div style={row}><span>Welcome bonus</span><span style={val}>{WELCOME_CREDITS} credits, unused</span></div>}
        <div style={row}><span>Purchased credits</span><span style={val}>never reset</span></div>
      </div>
      {/* The arithmetic, in one sentence from the same constants the server enforces (the audit saw
          "10 available · Free daily credit 1 · Welcome bonus 10" and could not tell how they add up). */}
      <p data-testid="credits-explain" style={{ fontFamily: 'var(--mono)', fontSize: '.56rem', color: 'var(--sub)', lineHeight: 1.6, margin: '0 0 .5rem' }}>
        {balanceExplanation({ balance: info.balance, daily: info.daily ?? null, purchased: info.purchased ?? 0, earned, welcome: !!info.welcome })}
      </p>
      <p style={{ fontFamily: 'var(--mono)', fontSize: '.56rem', color: 'var(--muted)', lineHeight: 1.6, margin: '0 0 .75rem' }}>
        Every AI action costs 1 credit and says so on its button. Résumé upload, company grades and the tracker are always free.
      </p>
      <div style={{ display: 'flex', gap: '.4rem' }}>
        <button type="button" onClick={() => { onClose(); zero ? onUpgrade() : onEarn() }} style={link}>{zero ? 'Top up →' : 'Earn credits →'}</button>
        <Link href="/pricing" onClick={onClose} style={link}>Pricing →</Link>
      </div>
    </div>
  )
}

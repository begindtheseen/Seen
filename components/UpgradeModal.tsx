'use client'

// The upgrade sheet — opened when a free account runs out of today's AI credit, presses a Pro-only tool
// (HumanProof, AI polish) or an upsell link. Same menu as /pricing (owner decisions 2026-10-25): the
// 30-day Job Search Pass and Interview Prep, both one-time and never renewing; no subscription, no trial.
// In a résumé-tool moment the pass leads (it is what removes the limit for the whole search); Interview
// Prep is the second line for someone with an interview coming up. Out of credits, the free path is
// named first: the credit comes back at midnight PT, or can be earned. Prices from lib/pricing.ts.

import { useEffect } from 'react'
import { useAuth } from '@/lib/auth'
import { FREE_DAILY_CREDITS, CREDIT_RESET_LABEL } from '@/lib/creditRules'
import { PREP, PASS, PREP_PRICE, PASS_PRICE, ONE_TIME_NOTE, PASS_INCLUDES, FREE_LINE } from '@/lib/pricing'
import { useCheckout } from '@/lib/useCheckout'
import { funnelEvent, type OfferSurface } from '@/lib/funnel'
import ModalPortal from '@/components/ModalPortal'

interface UpgradeModalProps {
  reason: 'credits' | 'pro' | 'generic'
  onClose: () => void
  /** The Pro-only tool that was pressed: "HumanProof" or "AI polish". */
  featureName?: string
  /** Where the sheet was opened from, for the funnel counters. A Pro-only tool's lock card by default. */
  surface?: OfferSurface
}

const CREDIT_WORD = FREE_DAILY_CREDITS === 1 ? 'credit' : 'credits'

// Honest, outcome-led — never "trick the ATS / beat the detector" framing.
function copyFor(reason: UpgradeModalProps['reason'], featureName?: string) {
  if (reason === 'credits') {
    return {
      headline: `You’ve used today’s free AI ${CREDIT_WORD}.`,
      sub: `It comes back at ${CREDIT_RESET_LABEL}, free. If you can’t wait, the ${PASS.name} removes the daily limit for ${PASS.pro_days} days.`,
    }
  }
  if (reason === 'pro') {
    if (featureName === 'HumanProof') {
      // Not "Your application is optimized" — this opens from pages where nothing was optimized.
      return { headline: 'Make your application sound real.', sub: `HumanProof comes with Pro access: the ${PASS.name}, or the ${PREP.pro_days} days that come with ${PREP.name}.` }
    }
    return {
      headline: featureName ? `Get ${featureName}` : 'This tool comes with Pro access',
      sub: `It comes with Pro access: the ${PASS.name}, or the ${PREP.pro_days} days that come with ${PREP.name}.`,
    }
  }
  return {
    headline: 'Pay once, only when it helps.',
    sub: `${FREE_LINE} When you want more, it is one payment that never renews.`,
  }
}

export default function UpgradeModal({ reason, onClose, featureName, surface }: UpgradeModalProps) {
  const { isLoggedIn } = useAuth()
  const where: OfferSurface = surface || (reason === 'pro' ? 'lock_card' : 'upgrade_modal')
  const { start, busy, error } = useCheckout(where, { isLoggedIn })

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])
  useEffect(() => { funnelEvent('offer_shown', { surface: where, once: `${where}_${reason}_${featureName || ''}` }) }, [where, reason, featureName])

  const { headline, sub } = copyFor(reason, featureName)
  const label: React.CSSProperties = { fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', color: 'var(--sub)', textAlign: 'center', margin: '.4rem 0 0' }

  return (
    <ModalPortal>
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,.9)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      data-testid="upgrade-modal"
    >
      <div role="dialog" aria-modal="true" aria-labelledby="upgrade-h" style={{ width: '100%', maxWidth: 480, background: 'var(--surface)', borderRadius: '18px 18px 0 0', border: '1px solid rgba(99,102,241,.25)', boxShadow: '0 -40px 120px rgba(0,0,0,.7)', overflowY: 'auto', maxHeight: '94dvh' }}>
        <div style={{ display: 'flex', justifyContent: 'center', padding: '.6rem 0 .2rem' }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--line2)' }} />
        </div>

        <div style={{ padding: '.75rem 1.25rem .5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '.75rem' }}>
          <div style={{ minWidth: 0 }}>
            <div id="upgrade-h" style={{ fontFamily: 'var(--display)', fontSize: 'var(--fs-lead)', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.02em', marginBottom: '.3rem', lineHeight: 1.25 }}>{headline}</div>
            <div style={{ fontFamily: 'var(--body)', fontSize: 'var(--fs-sm)', color: 'var(--sub)', lineHeight: 1.55 }}>{sub}</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', color: 'var(--dim)', cursor: 'pointer', fontSize: 'var(--fs-lead)', minWidth: 44, minHeight: 44, margin: '-.5rem -.6rem 0 0', flexShrink: 0 }}>✕</button>
        </div>

        <div style={{ padding: '0 1.25rem', paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom))' }}>
          {/* The Job Search Pass */}
          <div style={{ background: 'rgba(99,102,241,.07)', border: '1px solid rgba(99,102,241,.3)', borderRadius: 12, padding: '.9rem 1rem', marginTop: '.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '.5rem', flexWrap: 'wrap' }}>
              <span style={{ fontFamily: 'var(--display)', fontWeight: 800, fontSize: 'var(--fs-body)', color: 'var(--white)' }}>{PASS.name}</span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-sm)', color: '#c7d2fe' }}>{PASS_PRICE} · {PASS.pro_days} days of everything</span>
            </div>
            <ul style={{ listStyle: 'none', margin: '.55rem 0 .75rem', padding: 0 }}>
              {PASS_INCLUDES.slice(0, 3).map(f => (
                <li key={f} style={{ display: 'flex', gap: '.45rem', fontFamily: 'var(--body)', fontSize: 'var(--fs-meta)', color: 'var(--sub)', lineHeight: 1.45, marginBottom: '.3rem' }}><span style={{ color: '#818cf8' }}>✓</span>{f}</li>
              ))}
            </ul>
            <button type="button" onClick={() => void start('pass30')} disabled={busy !== null} data-testid="modal-buy-pass30"
              style={{ width: '100%', minHeight: 48, background: 'linear-gradient(135deg,#4f46e5,#7c3aed)', border: 'none', borderRadius: 10, fontFamily: 'var(--display)', fontWeight: 800, fontSize: 'var(--fs-ui)', color: '#fff', cursor: busy ? 'default' : 'pointer', opacity: busy && busy !== 'pass30' ? .6 : 1 }}>
              {busy === 'pass30' ? 'Opening checkout…' : `Get the ${PASS.name} · ${PASS_PRICE}`}
            </button>
            <p style={label}>{ONE_TIME_NOTE}</p>
          </div>

          {/* Interview Prep */}
          <div style={{ border: '1px solid rgba(16,185,129,.35)', borderRadius: 12, padding: '.8rem 1rem', marginTop: '.7rem' }}>
            <div style={{ fontFamily: 'var(--body)', fontSize: 'var(--fs-sm)', color: 'var(--text)', lineHeight: 1.5, marginBottom: '.55rem' }}>
              <b style={{ color: 'var(--white)' }}>Interview coming up?</b> {PREP.name} is {PREP_PRICE} for one interview — questions for the role and answers from your résumé. It also opens {PREP.pro_days} days of Pro.
            </div>
            <button type="button" onClick={() => void start('interview')} disabled={busy !== null} data-testid="modal-buy-interview"
              style={{ width: '100%', minHeight: 44, background: 'rgba(16,185,129,.12)', border: '1px solid rgba(16,185,129,.4)', borderRadius: 10, fontFamily: 'var(--display)', fontWeight: 800, fontSize: 'var(--fs-sm)', color: 'var(--green)', cursor: busy ? 'default' : 'pointer' }}>
              {busy === 'interview' ? 'Opening checkout…' : `Get ${PREP.name} · ${PREP_PRICE}`}
            </button>
            <p style={label}>{ONE_TIME_NOTE}</p>
          </div>

          {error && (
            <div role="alert" style={{ background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)', borderRadius: 8, padding: '.55rem .85rem', marginTop: '.75rem', fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', color: 'var(--red)', lineHeight: 1.5 }}>
              {error}
            </div>
          )}

          <p style={{ ...label, marginTop: '.85rem' }}>
            No subscription. See <a href="/pricing" style={{ color: 'var(--blue)' }}>everything that is free</a> · <a href="/terms#one-time" style={{ color: 'var(--blue)' }}>Terms</a>
          </p>

          {reason === 'credits' && (
            <div style={{ textAlign: 'center', marginTop: '.4rem' }}>
              <button type="button"
                onClick={() => { onClose(); window.dispatchEvent(new CustomEvent('seen:open-survey')) }}
                style={{ minHeight: 44, background: 'none', border: 'none', fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', color: 'var(--blue)', cursor: 'pointer', textDecoration: 'underline' }}>
                Or earn a free credit now with a quick survey →
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
    </ModalPortal>
  )
}

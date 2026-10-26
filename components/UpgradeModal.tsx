'use client'

// The upgrade sheet — opened when a free account runs out of today's AI credit, presses a Pro-only tool
// (HumanProof, unbranded downloads) or an upsell link. Same menu as /pricing (owner decisions 2026-10-25): the
// 30-day Job Search Pass and Interview Prep, both one-time and never renewing; no subscription, no trial.
// In a résumé-tool moment the pass leads (it is what removes the limit for the whole search); Interview
// Prep is the second line for someone with an interview coming up. Out of credits, the free path is
// named first: the credit comes back at midnight PT, or can be earned. Prices from lib/pricing.ts.
// Rendered through THE dialog (components/ui/Dialog: role=dialog, focus trap, Escape, solid surface;
// a bottom sheet on phones). One primary button: the pass. Interview Prep is the secondary action.

import { useEffect } from 'react'
import { useAuth } from '@/lib/auth'
import { FREE_DAILY_CREDITS, CREDIT_RESET_LABEL } from '@/lib/creditRules'
import { PREP, PASS, PREP_PRICE, PASS_PRICE, ONE_TIME_NOTE, PASS_INCLUDES, FREE_LINE } from '@/lib/pricing'
import { useCheckout } from '@/lib/useCheckout'
import { funnelEvent, type OfferSurface } from '@/lib/funnel'
import Dialog from '@/components/ui/Dialog'
import Button from '@/components/ui/Button'
import Icon from '@/components/ui/Icon'
import s from './UpgradeModal.module.css'

interface UpgradeModalProps {
  reason: 'credits' | 'pro' | 'generic'
  onClose: () => void
  /** The Pro-only tool that was pressed: "HumanProof" or "unbranded downloads". */
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

  useEffect(() => { funnelEvent('offer_shown', { surface: where, once: `${where}_${reason}_${featureName || ''}` }) }, [where, reason, featureName])

  const { headline, sub } = copyFor(reason, featureName)

  return (
    <Dialog open onClose={onClose} title={headline} description={sub}>
      <div data-testid="upgrade-modal">
        {/* The Job Search Pass */}
        <section className={s.pass} aria-label={PASS.name}>
          <div className={s.passHead}>
            <span className={s.passName}>{PASS.name}</span>
            <span className={s.passPrice}>{PASS_PRICE} · {PASS.pro_days} days of everything</span>
          </div>
          <ul className={s.list}>
            {PASS_INCLUDES.slice(0, 3).map(f => (
              <li key={f}><Icon name="check" size={14} className={s.tick} />{f}</li>
            ))}
          </ul>
          <Button variant="primary" size="lg" full onClick={() => void start('pass30')} disabled={busy !== null} data-testid="modal-buy-pass30">
            {busy === 'pass30' ? 'Opening checkout…' : `Get the ${PASS.name} · ${PASS_PRICE}`}
          </Button>
          <p className={s.note}>{ONE_TIME_NOTE}</p>
        </section>

        {/* Interview Prep */}
        <section className={s.prep} aria-label={PREP.name}>
          <p className={s.prepText}>
            <b>Interview coming up?</b> {PREP.name} is {PREP_PRICE} for one interview — questions for the role and answers from your résumé. It also opens {PREP.pro_days} days of Pro.
          </p>
          <Button variant="secondary" full onClick={() => void start('interview')} disabled={busy !== null} data-testid="modal-buy-interview">
            {busy === 'interview' ? 'Opening checkout…' : `Get ${PREP.name} · ${PREP_PRICE}`}
          </Button>
          <p className={s.note}>{ONE_TIME_NOTE}</p>
        </section>

        {error && <div role="alert" className={s.err}>{error}</div>}

        <p className={s.foot}>
          No subscription. See <a href="/pricing">everything that is free</a> · <a href="/terms#one-time">Terms</a>
        </p>

        {reason === 'credits' && (
          <div className={s.earn}>
            <Button variant="ghost" onClick={() => { onClose(); window.dispatchEvent(new CustomEvent('seen:open-survey')) }}>
              Or earn a free credit now with a quick survey →
            </Button>
          </div>
        )}
      </div>
    </Dialog>
  )
}

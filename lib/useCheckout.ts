'use client'

// ONE way to open a Stripe Checkout for Seen's two products (Interview Prep, the Job Search Pass), used
// by /pricing, the upgrade sheet, the lock cards and the tracker card. It:
//   • counts the press (offer_clicked, with its surface and sku — lib/funnel.ts);
//   • sends a guest to sign-up with the purchase named and resumed after (lib/signupIntent buySignupHref);
//   • opens ONE session per press: `disabled` only applies after a re-render, so a double tap created two
//     Stripe sessions (audit 2026-10-24) — the ref closes that gap synchronously;
//   • POSTs api/stripe.js action 'checkout' with {sku, surface, application_id?, company?, role?}; the
//     server records checkout_started and returns the Stripe URL.

import { useCallback, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { aiHeaders } from './aiHeaders'
import { buySignupHref } from './signupIntent.js'
import { funnelEvent, type OfferSurface } from './funnel'
import type { OfferSku } from './pricing'

export type CheckoutContext = { application_id?: string; company?: string; role?: string }

export function useCheckout(surface: OfferSurface, { isLoggedIn, guestHref }: { isLoggedIn: boolean; guestHref?: (sku: OfferSku) => string }) {
  const router = useRouter()
  const [busy, setBusy] = useState<OfferSku | null>(null)
  const [error, setError] = useState('')
  const inFlight = useRef(false)

  const start = useCallback(async (sku: OfferSku, ctx: CheckoutContext = {}) => {
    funnelEvent('offer_clicked', { surface, sku, company: ctx.company })
    if (!isLoggedIn) { router.push(guestHref ? guestHref(sku) : buySignupHref(sku)); return }
    if (inFlight.current) return
    inFlight.current = true
    setBusy(sku); setError('')
    try {
      const r = await fetch('/api/stripe?action=checkout', { method: 'POST', headers: await aiHeaders(), body: JSON.stringify({ sku, surface, ...ctx }) })
      const d = await r.json().catch(() => ({})) as { url?: string; error?: string }
      if (d.url) { window.location.href = d.url; return } // the ref stays set: this page is leaving
      setError(r.status === 503
        ? 'Payments are not switched on yet. During early launch every feature is unlocked, so there is nothing to buy.'
        : (d.error || 'Checkout is unavailable right now. Try again, or email hello@seenjobs.io.'))
    } catch {
      setError('Network error. Check your connection and try again.')
    }
    inFlight.current = false
    setBusy(null)
  }, [surface, isLoggedIn, guestHref, router])

  return { start, busy, error, setError }
}

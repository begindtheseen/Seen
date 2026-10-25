'use client'

// Browser side of the funnel counters (server: api/interview-prep.js action 'event' →
// lib/server/funnelEvents.js → public.funnel_events). One beacon per step; `once` keeps a step to one
// row per browser session (an offer seen on every re-render is still one "shown"). Never throws, never
// blocks the page. The same step also goes to PostHog when NEXT_PUBLIC_POSTHOG_KEY is set (lib/analytics).

import { aiHeaders } from './aiHeaders'
import { track } from './analytics'

export type FunnelEvent = 'pricing_view' | 'offer_shown' | 'offer_clicked' | 'prep_preview_shown' | 'guest_email_shown' | 'guest_email_given'
export type OfferSurface = 'tracker_prep' | 'company_page' | 'pricing' | 'upgrade_modal' | 'lock_card' | 'homepage'

export function funnelEvent(event: FunnelEvent, opts: { surface?: OfferSurface; sku?: string; company?: string; once?: string } = {}): void {
  if (typeof window === 'undefined') return
  if (opts.once) {
    const k = `seen_funnel_${event}_${opts.once}`
    try { if (sessionStorage.getItem(k)) return; sessionStorage.setItem(k, '1') } catch { /* private mode: count it */ }
  }
  track(event, { surface: opts.surface, sku: opts.sku, company: opts.company })
  aiHeaders()
    .then(h => fetch('/api/interview-prep', {
      method: 'POST', headers: h, keepalive: true,
      body: JSON.stringify({ action: 'event', event, surface: opts.surface, sku: opts.sku, company: opts.company }),
    }))
    .catch(() => {})
}

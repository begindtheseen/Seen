// ── Seen analytics wrapper (PostHog) ────────────────────────────────────────
// One tiny, stable API for the whole app: initAnalytics / track / identify / reset.
//
// Graceful no-op contract: when NEXT_PUBLIC_POSTHOG_KEY is unset (CI, previews,
// local dev with zero env config) every function silently does nothing — the app
// must build and behave identically with or without a key. Never throws.
//
// Privacy defaults:
//   - person_profiles: 'identified_only' — anonymous visitors don't get person rows
//   - respect_dnt: true — honors Do Not Track
//   - capture_pageview: false — App Router SPA navigations don't fire full page
//     loads, so AnalyticsProvider captures $pageview manually on pathname change.
//
// Client-only: every entry point guards typeof window, so accidental imports from
// server components/route handlers are harmless no-ops.

import posthog from 'posthog-js'

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com'

let initialized = false

function enabled(): boolean {
  return typeof window !== 'undefined' && !!KEY
}

/** Idempotent. Safe to call from anywhere; only the first call (with a key, in a
 *  browser) actually boots PostHog. */
export function initAnalytics(): void {
  if (!enabled() || initialized) return
  initialized = true
  try {
    posthog.init(KEY as string, {
      api_host: HOST,
      person_profiles: 'identified_only',
      respect_dnt: true,
      capture_pageview: false,
      capture_pageleave: true,
      autocapture: false,
    })
  } catch { /* analytics must never break the app */ }
}

/** Capture a product event. No-ops without a key. */
export function track(event: string, props?: Record<string, unknown>): void {
  if (!enabled()) return
  initAnalytics()
  try { posthog.capture(event, props) } catch { /* never throw */ }
}

/** Tie the current device to a signed-in user. Call on sign-in. */
export function identify(userId: string): void {
  if (!enabled() || !userId) return
  initAnalytics()
  try { posthog.identify(userId) } catch { /* never throw */ }
}

/** Drop the identity + device id. Call on sign-out so the next user on this
 *  device doesn't inherit the previous identity. */
export function reset(): void {
  if (!enabled() || !initialized) return
  try { posthog.reset() } catch { /* never throw */ }
}

/** Manual SPA pageview — used by AnalyticsProvider on App Router route changes. */
export function capturePageview(url: string): void {
  track('$pageview', { $current_url: url })
}

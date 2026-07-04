'use client'

// Analytics bootstrap for the App Router.
//   1. Boots PostHog once on mount (no-op when NEXT_PUBLIC_POSTHOG_KEY is unset).
//   2. Captures $pageview on every route change — useSearchParams() requires a
//      Suspense boundary in the App Router, hence the split PageviewTracker.
//   3. Mirrors auth state into analytics: identify(user.id) on sign-in, reset()
//      on sign-out. Reads useAuth() so lib/auth.tsx (and its load-bearing
//      sign-out data-isolation logic) stays untouched.
// Renders nothing.

import { Suspense, useEffect, useRef } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { useAuth } from '@/lib/auth'
import { initAnalytics, capturePageview, identify, reset } from '@/lib/analytics'

function PageviewTracker() {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  useEffect(() => {
    if (!pathname) return
    const qs = searchParams?.toString()
    capturePageview(window.location.origin + pathname + (qs ? `?${qs}` : ''))
  }, [pathname, searchParams])

  return null
}

function IdentityTracker() {
  const { user, ready } = useAuth()
  // Tracks the last id we told analytics about, so we only identify on a real
  // transition (null→id or id→other id) and only reset on a real sign-out (id→null).
  const lastIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!ready) return
    const id = user?.id || null
    if (id === lastIdRef.current) return
    if (id) identify(id)
    else reset()
    lastIdRef.current = id
  }, [user, ready])

  return null
}

export default function AnalyticsProvider() {
  useEffect(() => { initAnalytics() }, [])

  return (
    <>
      <IdentityTracker />
      <Suspense fallback={null}>
        <PageviewTracker />
      </Suspense>
    </>
  )
}

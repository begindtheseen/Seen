import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Domains actually used by SeenJobs:
// - fonts.googleapis.com / fonts.gstatic.com — Google Fonts
// - tmngmmofrplsldvlobfx.supabase.co — Supabase (auth, DB; wss: for Realtime —
//   Seen Live on the admin dashboard. The wss: entry is load-bearing on iOS:
//   WebKit throws a SYNCHRONOUS SecurityError from `new WebSocket()` when CSP
//   blocks it (Chrome fails async), which crashed /admin to the Next.js
//   "Application error" screen on every iPhone browser.)
// - us.i.posthog.com / us-assets.i.posthog.com — PostHog analytics (events go
//   to us.i; lazy feature bundles like session replay load from us-assets)
// - js.stripe.com / hooks.stripe.com — Stripe checkout widget
// - nominatim.openstreetmap.org — City autocomplete
// - api.anthropic.com is server-side only; never called from the browser
// - cdn.jsdelivr.net is NOT used
// Next.js DEV MODE only: the dev runtime (react-refresh / webpack eval sourcemaps)
// requires 'unsafe-eval'. Without it the client bundle throws EvalError before
// hydration, React effects never run, and the #intro-guard cover never lifts —
// every page renders as a black screen in local dev. Production builds need no
// eval, so the production CSP is byte-for-byte unchanged.
const DEV_SCRIPT = process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''

const CSP = [
  "default-src 'self'",
  // Scripts: self + Stripe (checkout widget injects scripts) + PostHog lazy bundles
  "script-src 'self' https://js.stripe.com https://us-assets.i.posthog.com 'unsafe-inline'" + DEV_SCRIPT,
  // Styles: self + Google Fonts
  "style-src 'self' https://fonts.googleapis.com 'unsafe-inline'",
  // Fonts: self + Google Fonts CDN
  "font-src 'self' https://fonts.gstatic.com",
  // Images: self + data URIs (canvas toDataURL)
  "img-src 'self' data: blob:",
  // XHR/fetch/WebSocket: self + Supabase (https + wss) + PostHog + Stripe + OpenStreetMap geocoder
  "connect-src 'self' https://tmngmmofrplsldvlobfx.supabase.co wss://tmngmmofrplsldvlobfx.supabase.co https://us.i.posthog.com https://us-assets.i.posthog.com https://api.stripe.com https://hooks.stripe.com https://nominatim.openstreetmap.org",
  // iframes: Stripe checkout opens in an iframe
  "frame-src https://js.stripe.com https://hooks.stripe.com",
  // No plugins
  "object-src 'none'",
  // Prevent base-tag hijacking
  "base-uri 'self'",
  // Forms submit only to self
  "form-action 'self'",
  // Block framing by other origins
  "frame-ancestors 'none'",
  // Force HTTPS for all subresource upgrades
  "upgrade-insecure-requests",
].join('; ')

export function middleware(req: NextRequest) {
  const res = NextResponse.next()
  const { pathname } = req.nextUrl

  // ── Security headers on every response ──────────────────────────────────────
  res.headers.set('Content-Security-Policy', CSP)
  res.headers.set('X-Frame-Options', 'DENY')
  res.headers.set('X-Content-Type-Options', 'nosniff')
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self), payment=(self)')
  res.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload')
  res.headers.set('Cross-Origin-Opener-Policy', 'same-origin-allow-popups')
  res.headers.set('Cross-Origin-Resource-Policy', 'same-origin')

  // ── Admin routes: strict no-cache to prevent stale CDN serving ───────────────
  if (pathname.startsWith('/admin')) {
    res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate')
    res.headers.set('Pragma', 'no-cache')
  }

  // ── Remove X-Powered-By if Next.js sets it anywhere ─────────────────────────
  res.headers.delete('X-Powered-By')

  return res
}

export const config = {
  // Run on all routes except Next.js internals and static assets
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.svg|favicon\\.ico).*)',
  ],
}

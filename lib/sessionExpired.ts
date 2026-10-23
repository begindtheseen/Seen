'use client'

/**
 * ONE place that reacts to a dead session.
 *
 * Two ways a signed-in session dies under the user:
 *   1. `/api/user-sync` answers 401 ("Invalid token") — the refresh token was revoked elsewhere
 *      (a global sign-out from another device) while this tab still holds an access token.
 *      lib/sync.ts calls `handleSessionExpired` on that status.
 *   2. supabase-js fails to refresh the token and emits SIGNED_OUT on its own. lib/auth.tsx tells
 *      the two apart with `markIntentionalSignOut` (set by every real sign-out button) and calls
 *      `handleSessionExpired` for the unintentional one.
 *
 * The handler fires ONCE: it clears the stale local session (scope 'local' — never the user's
 * other devices), pops the toast, remembers the message for the login page (a full navigation
 * drops in-page toasts) and routes to /login?return=<path>. A module flag + a sessionStorage
 * stamp keep it from looping when several requests 401 at once or /login itself re-renders.
 */
import { supabase } from './supabase'
import { notify } from './notify'

export const SESSION_EXPIRED_MESSAGE = 'Your session expired — sign in again'
/** sessionStorage key: the time (ms) the session was found dead. The login page shows the message
 *  while it is fresh (SESSION_EXPIRED_SHOW_MS) and clears it on a successful sign-in. A timestamp,
 *  not a consume-once flag: the protected page's own `!isLoggedIn` redirect soft-navigates to
 *  /login a beat before the hard redirect below, and both mounts must see it. */
export const SESSION_EXPIRED_FLAG = 'seen_session_expired'
export const SESSION_EXPIRED_SHOW_MS = 60_000
export function wasSessionExpiredRecently(): boolean {
  try {
    const at = Number(sessionStorage.getItem(SESSION_EXPIRED_FLAG) || 0)
    return at > 0 && Date.now() - at < SESSION_EXPIRED_SHOW_MS
  } catch { return false }
}
export function clearSessionExpiredNotice() {
  try { sessionStorage.removeItem(SESSION_EXPIRED_FLAG) } catch { /* ignore */ }
}
const STAMP_KEY = 'seen_session_expired_at'
const REARM_MS = 30_000
const TOAST_BEAT_MS = 1_200

let handling = false
let intentional = false

/** Call right before a user-initiated signOut so the auth listener does not treat it as expiry. */
export function markIntentionalSignOut() { intentional = true }
/** Consumed by the SIGNED_OUT listener; true exactly once per marked sign-out. */
export function consumeIntentionalSignOut(): boolean {
  const was = intentional
  intentional = false
  return was
}
/** A fresh sign-in re-arms the handler (the guard only exists to stop loops, not to go silent forever). */
export function resetSessionExpiredGuard() {
  handling = false
  try { sessionStorage.removeItem(STAMP_KEY) } catch { /* ignore */ }
}

function recentlyHandled(): boolean {
  try {
    const at = Number(sessionStorage.getItem(STAMP_KEY) || 0)
    return at > 0 && Date.now() - at < REARM_MS
  } catch { return false }
}

/** Pure routing decision — exported for the unit test. */
export function sessionExpiredRedirect(pathname: string, search = ''): string | null {
  if (pathname.startsWith('/login') || pathname.startsWith('/reset')) return null
  const here = `${pathname}${search || ''}`
  return `/login?return=${encodeURIComponent(here)}`
}

export async function handleSessionExpired(): Promise<void> {
  if (typeof window === 'undefined') return
  if (handling || recentlyHandled()) return
  handling = true
  try { sessionStorage.setItem(STAMP_KEY, String(Date.now())) } catch { /* ignore */ }

  // Drop the dead local session so the nav, tracker and every store agree the user is out —
  // local only: the other devices are not ours to touch here. The auth listener sees this
  // SIGNED_OUT as intentional and does not re-enter.
  markIntentionalSignOut()
  try { await supabase.auth.signOut({ scope: 'local' }) } catch { /* already gone */ }

  notify({ title: SESSION_EXPIRED_MESSAGE, sub: 'Taking you to sign in…', severity: 'warn', key: 'session-expired', duration: 6000 })

  const dest = sessionExpiredRedirect(window.location.pathname, window.location.search)
  if (!dest) { handling = false; return }
  try { sessionStorage.setItem(SESSION_EXPIRED_FLAG, String(Date.now())) } catch { /* ignore */ }
  // Let the toast land before the page changes; the login page repeats the message on arrival.
  await new Promise(r => setTimeout(r, TOAST_BEAT_MS))
  window.location.assign(dest)
}

// A tool call that comes back "sign in" is a dead or missing session — never "out of credits".
//
// UX audit F2 (2026-11-10): an expired token on the paid Optimize answered 401 with
// `credits_required: true`, and the sheet opened the paywall ("You've used today's free AI credit")
// for a person who had 3 credits. The server now answers `error: 'signin_required'` on a 401; until
// that ships everywhere, ANY 401 is treated the same way. Only a 402 — or credits_required / pro_required
// WITHOUT a sign-in problem — means "out of credits".
import { loginHref } from './safeHref.js'

export const SIGNIN_EXPIRED_TITLE = 'Your sign-in expired'
export const SIGNIN_EXPIRED_TEXT = 'Sign in again to continue. Nothing was charged, and you come back to this page.'

/**
 * The answer means the session is gone: a 401, or the server's `signin_required`.
 * @param {number} status
 * @param {{ error?: unknown } | null | undefined} [body]
 */
export function needsSignIn(status, body) {
  return status === 401 || (!!body && body.error === 'signin_required')
}

/**
 * A real "no credits left" answer — never a sign-in problem.
 * @param {number} status
 * @param {{ error?: unknown, credits_required?: unknown, pro_required?: unknown } | null | undefined} [body]
 */
export function outOfCredits(status, body) {
  if (needsSignIn(status, body)) return false
  return status === 402 || !!(body && (body.credits_required || body.pro_required))
}

/**
 * The sign-in link that returns to this exact place (path + query, so an open `?job=` survives).
 * @param {{ pathname: string, search?: string } | null} [loc]
 */
export function signInHereHref(loc) {
  const l = loc || (typeof window !== 'undefined' ? window.location : null)
  if (!l) return '/login'
  return loginHref(`${l.pathname}${l.search || ''}`)
}

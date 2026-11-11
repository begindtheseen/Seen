// Sign-in answers, read once (pure — core.test.mjs). The server (admin_login) answers:
//   200 { token, username, role }                      → signed in
//   401 "Invalid credentials" / "Account disabled"     → wrong details / disabled account
//   429 "Too many failed attempts — try again in 15 minutes" (account lock) or
//       "Too many login attempts — …" (address rate limit)   → locked, with the time if it is known
// The token is stored where the legacy admin reads it (sessionStorage `admin_token`), so /admin and
// /admin/legacy share one session.
import type { ApiResult } from './api.ts'

export const TOKEN_KEY = 'admin_token'
export const USER_KEY = 'admin_username'

export type LoginOutcome =
  | { kind: 'ok'; token: string; username: string }
  | { kind: 'wrong'; text: string }
  | { kind: 'disabled'; text: string }
  | { kind: 'locked'; text: string; until: Date | null }
  | { kind: 'error'; text: string }

function clock(d: Date): string {
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' })
}

export function readLogin(res: ApiResult<{ token?: string; username?: string }>, now: Date = new Date()): LoginOutcome {
  if (res.ok) {
    const token = typeof res.token === 'string' ? res.token : ''
    if (!token) return { kind: 'error', text: 'The server signed you in but sent no session. Try again.' }
    return { kind: 'ok', token, username: typeof res.username === 'string' && res.username ? res.username : 'Admin' }
  }
  const words = res.error || ''
  if (res.code === 'rate_limited' || /too many/i.test(words)) {
    const extra = res as unknown as { retry_after?: unknown; locked_until?: unknown }
    let until: Date | null = null
    if (typeof extra.locked_until === 'string' && !Number.isNaN(Date.parse(extra.locked_until))) until = new Date(extra.locked_until)
    else if (typeof extra.retry_after === 'number' && extra.retry_after > 0) until = new Date(now.getTime() + extra.retry_after * 1000)
    else {
      const m = words.match(/in (\d+) minutes?/i)
      if (m) until = new Date(now.getTime() + Number(m[1]) * 60_000)
    }
    const who = /login attempts/i.test(words) ? 'Too many sign-in attempts from this network' : 'Locked after too many wrong passwords'
    return { kind: 'locked', until, text: until ? `${who} — try again after ${clock(until)} (Pacific).` : `${who} — try again in a few minutes.` }
  }
  if (/disabled/i.test(words)) return { kind: 'disabled', text: 'This admin account is disabled.' }
  if (res.code === 'unauthorized' || /invalid credentials/i.test(words)) return { kind: 'wrong', text: "That username and password don't match. Five wrong tries lock the account for 15 minutes." }
  if (res.code === 'bad_request') return { kind: 'wrong', text: 'Enter both your username and your password.' }
  return { kind: 'error', text: words || "Couldn't sign in. Try again." }
}

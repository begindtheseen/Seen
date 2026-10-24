'use client'

// The sign-up ask at the moment of intent: a guest just tracked an application, so the one honest
// reason to give an email is right there ("a nudge on day 7 if they haven't replied"). One field, no
// password: Supabase emails a link (signInWithOtp creates the account on first use and sends the
// confirmation email; an existing account gets a sign-in link). The link comes back to `next`, and the
// application rides along in the sign-up's metadata (lib/pendingApplicationClient.ts) so it lands on
// the account even when the email is opened on another device or in a mail app's own browser.

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { safeNextPath } from '@/lib/signupIntent.js'
import { pendingApplicationsForSignup, PENDING_META_KEY } from '@/lib/pendingApplicationClient'
import { isEmailThrottle } from '@/lib/pendingSignup.js'
import { joinDays, shortDay, type CheckinEmail } from '@/lib/trackCapture'
import { REFERRAL_REWARD_PRO_DAYS, proDaysLabel } from '@/lib/creditRules'
import s from './track.module.css'

export default function CheckinEmailAsk({ company, plan, next, inviteWaiting = false, trackerLink = true }: {
  company: string
  plan: CheckinEmail[]
  /** Where the confirmation link returns (same-origin path; anything else falls back to /tracker). */
  next: string
  /** A friend's invite is waiting on this device: tracking one application is what pays it out. */
  inviteWaiting?: boolean
  trackerLink?: boolean
}) {
  const [email, setEmail] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [error, setError] = useState('')
  const co = company || 'them'
  const first = plan[0]

  async function send() {
    const addr = email.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) { setError('Enter a valid email address.'); return }
    setError(''); setState('sending')
    const dest = safeNextPath(next) || '/tracker'
    const { error: err } = await supabase.auth.signInWithOtp({
      email: addr,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: `${window.location.origin}${dest}`,
        // Read by the signup trigger (account_type, migration 052; role_type for the pre-052 one) and by
        // lib/pendingApplicationClient.ts on the first sign-in. Ignored for an account that already exists.
        data: { role_type: 'seeker', account_type: 'seeker', signup_intent: 'track', [PENDING_META_KEY]: pendingApplicationsForSignup() },
      },
    })
    if (err && !isEmailThrottle(err)) {
      setState('idle')
      setError('We couldn’t send the email right now. Try again in a moment.')
      return
    }
    // A throttled repeat means a link went out moments ago: that one still works.
    setState('sent')
  }

  if (state === 'sent') {
    return (
      <div data-testid="checkin-sent" aria-live="polite">
        <p className={s.ok}>Check your email.</p>
        <p className={s.sub} style={{ marginBottom: '.3rem' }}>
          We sent a link to <strong style={{ color: 'var(--white)' }}>{email.trim()}</strong>. Tap it to turn on your {co} check-ins. It brings you back here.
        </p>
        <div className={s.actions}>
          <button type="button" className={`${s.link} ${s.linkDim}`} onClick={() => { setState('idle'); setError('') }}>Use a different email</button>
        </div>
      </div>
    )
  }

  return (
    <div data-testid="checkin-ask">
      <p className={s.sub} style={{ color: 'var(--text)', marginBottom: '.6rem' }}>
        {first
          ? <>Want a nudge on {shortDay(first.at)} if {co} hasn&apos;t replied?</>
          : <>Want an email check-in if {co} hasn&apos;t replied?</>}
      </p>
      <form className={s.row} onSubmit={e => { e.preventDefault(); void send() }}>
        <label htmlFor="checkin-email" className="sr-only">Your email</label>
        <input
          id="checkin-email"
          type="email"
          inputMode="email"
          autoComplete="off"
          placeholder="you@email.com"
          className={s.input}
          value={email}
          onChange={e => setEmail(e.target.value)}
          data-testid="checkin-email"
        />
        <button type="submit" className={s.primary} disabled={state === 'sending'} data-testid="checkin-submit">
          {state === 'sending' ? 'Sending…' : 'Remind me'}
        </button>
      </form>
      {error && <p className={s.err} role="alert">{error}</p>}
      <p className={s.small}>
        No password needed. We&apos;ll email you one link to confirm{plan.length ? <>, then check in on {joinDays(plan)}</> : null}. Every email has a link to stop them.
      </p>
      {inviteWaiting && (
        <p className={s.small} style={{ color: 'var(--green)' }}>
          Your friend&apos;s invite counts: once your account tracks this application, you both get {proDaysLabel(REFERRAL_REWARD_PRO_DAYS)}.
        </p>
      )}
      {trackerLink && (
        <div className={s.actions}>
          <a href="/tracker" className={s.link}>Open your tracker →</a>
        </div>
      )}
    </div>
  )
}

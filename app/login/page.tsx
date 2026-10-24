'use client'

import { useState, useEffect, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { SESSION_EXPIRED_MESSAGE, clearSessionExpiredNotice, wasSessionExpiredRecently } from '@/lib/sessionExpired'
import { internalPath } from '@/lib/safeHref.js'
import { savePendingSignup, readPendingSignup, clearPendingSignup, markPendingSignin, isEmailThrottle, signupConfirmed } from '@/lib/pendingSignup.js'
import styles from './login.module.css'

// "Check your email" auto-detects the click: poll while the tab is visible, every 5 s, for at
// most 5 minutes (60 polls); "I verified my email →" stays as the manual fallback.
const VERIFY_POLL_MS = 5_000
const VERIFY_POLL_MAX = 60
// Sign-in: after this many wrong attempts in a row the button rests for the cooldown (client-side
// only — Supabase's own limits remain the real guard; this makes the slow-down visible instead of
// letting someone hammer the form with the same generic error, audit 2026-10-24 M4).
const SIGNIN_FAILS_BEFORE_COOLDOWN = 5
const SIGNIN_COOLDOWN_MS = 30_000
// The count and the cooldown survive a reload of this tab (sessionStorage) — a refresh is not a reset.
const SIGNIN_THROTTLE_KEY = 'seen_signin_throttle'
function readThrottle(): { fails: number; until: number } {
  try {
    const v = JSON.parse(sessionStorage.getItem(SIGNIN_THROTTLE_KEY) || 'null')
    if (v && typeof v.fails === 'number' && typeof v.until === 'number') return v
  } catch { /* blocked storage */ }
  return { fails: 0, until: 0 }
}
function writeThrottle(fails: number, until: number) {
  try { if (!fails && !until) sessionStorage.removeItem(SIGNIN_THROTTLE_KEY); else sessionStorage.setItem(SIGNIN_THROTTLE_KEY, JSON.stringify({ fails, until })) } catch { /* ignore */ }
}

/** Supabase's answer to a correct password on an unconfirmed address (`email_not_confirmed`, 400).
 *  Projects that return `invalid_credentials` for the same case cannot be told apart from a wrong
 *  password — see the resend hint on the generic error. */
function isUnconfirmedError(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false
  return err.code === 'email_not_confirmed' || /not confirmed/i.test(err.message || '')
}

type Step = 'who' | 'email' | 'password' | 'verify' | 'signin'

// Only ever redirect to an internal path — anything else (full URLs, protocol-relative
// '//evil.com') falls back to the dashboard so login can't be used as an open redirect. The ONE
// sanitizer is lib/safeHref.js internalPath (shared with every "sign in to continue" redirect).
const safeInternalPath = (p: string | null): string | null => internalPath(p)

function fieldStyle(focused: boolean) {
  return {
    width: '100%',
    background: 'var(--surface)',
    border: `1.5px solid ${focused ? 'var(--blue)' : 'var(--line2)'}`,
    borderRadius: 8,
    padding: '.72rem 1rem',
    color: 'var(--white)',
    fontFamily: 'var(--body)',
    fontSize: '.875rem',
    outline: 'none',
    caretColor: 'var(--blue)',
    transition: 'border-color .15s',
  } as React.CSSProperties
}

// Kill switch for NEW employer signups. Unset (or anything other than 'false') → enabled, the
// default. Set NEXT_PUBLIC_EMPLOYER_SIGNUP_ENABLED='false' to close the route: the Employer tile
// is hidden and /login?type=employer falls back to seeker signup with a note. This gates SIGNUP
// only — existing employers can still sign in and reach the portal.
const EMPLOYER_SIGNUP_ENABLED = process.env.NEXT_PUBLIC_EMPLOYER_SIGNUP_ENABLED !== 'false'

function LoginContent() {
  const router = useRouter()
  const params = useSearchParams()
  const { isLoggedIn, isEmployer } = useAuth()
  const cameAsEmployer = params.get('type') === 'employer'
  // Where to land after auth. Every signed-out deep link (/tracker, /dashboard, /profile …) arrives
  // with ?return= (lib/safeHref.js loginHref — the same parameter lib/sessionExpired.ts uses);
  // /pricing and the UpgradeModal pass ?next=. Both are read, both sanitized to an internal path, so
  // the user resumes what they were doing instead of landing on /dashboard.
  const explicitReturn = safeInternalPath(params.get('return')) || safeInternalPath(params.get('returnTo')) || safeInternalPath(params.get('next'))
  const returnTo = explicitReturn || '/dashboard'
  // Employers land on their portal unless the link that sent them here named a page (the claim card's
  // "I have one — sign in" returns to /employers#claim).
  const employerReturnTo = explicitReturn || '/employers/dashboard'
  // "Sign in as an employer →" / "Claim your company" link here with ?type=employer: the employer
  // role is already chosen, so the page opens on the account form for that role (not "Who are you?"
  // again — audit 2026-10-24 E-2). ?signup=1 opens the chooser; everything else is sign-in.
  const [step, setStep] = useState<Step>(
    EMPLOYER_SIGNUP_ENABLED && cameAsEmployer ? 'email' : params.get('signup') === '1' || cameAsEmployer ? 'who' : 'signin'
  )
  const [signupType, setSignupType] = useState<'seeker' | 'employer'>(EMPLOYER_SIGNUP_ENABLED && cameAsEmployer ? 'employer' : 'seeker')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [verifyEmail, setVerifyEmail] = useState('')
  // The id supabase-js returned from signUp — the verify poll asks the server whether THAT account is
  // confirmed (api/signup-status.js), so a click on another device is seen within one poll.
  const [verifyUid, setVerifyUid] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [focused, setFocused] = useState<string | null>(null)
  const [showPw, setShowPw] = useState(false)
  // Set by lib/sessionExpired.ts right before it routes here — the toast does not survive the
  // navigation, so the page itself says why the user is looking at a login form.
  const [expiredNotice, setExpiredNotice] = useState(false)
  // A one-line confirmation (resend sent, …) — in the page, never a native alert().
  const [notice, setNotice] = useState('')
  // Sign-in throttle state: consecutive failures and the moment the cooldown ends.
  const [signinFails, setSigninFails] = useState(0)
  const [cooldownUntil, setCooldownUntil] = useState(0)
  const [cooldownLeft, setCooldownLeft] = useState(0)
  // The address whose password was right but is not confirmed yet (M1) — shows the resend path.
  const [unconfirmedEmail, setUnconfirmedEmail] = useState('')
  const verifyPolls = useRef(0)

  // Tick the visible countdown while a cooldown is running.
  useEffect(() => {
    if (!cooldownUntil) return
    const tick = () => {
      const left = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000))
      setCooldownLeft(left)
      if (left === 0) { setCooldownUntil(0); setSigninFails(0); writeThrottle(0, 0); setError('') }
    }
    tick()
    const id = setInterval(tick, 500)
    return () => clearInterval(id)
  }, [cooldownUntil])
  const coolingDown = cooldownUntil > 0 && cooldownLeft > 0
  useEffect(() => {
    const t = readThrottle()
    if (t.until > Date.now()) { setSigninFails(t.fails); setCooldownUntil(t.until); setError('Too many attempts.') }
    else if (t.fails) setSigninFails(t.fails)
  }, [])

  useEffect(() => { setExpiredNotice(wasSessionExpiredRecently()) }, [])

  // A reload / back-navigation of the verify screen used to drop the person on the account form —
  // and a second "Create account" inside the email throttle window then failed with "For security
  // purposes…" (audit 2026-10-24 H3). This tab remembers the signup it is waiting on (address + id,
  // never the password) and comes back to the verify screen. Explicit employer links keep their form.
  useEffect(() => {
    if (cameAsEmployer) return
    const pending = readPendingSignup()
    if (!pending || pending.stage !== 'verify') return
    setEmail(pending.email); setVerifyEmail(pending.email); setVerifyUid(pending.uid)
    if (pending.type === 'employer' && EMPLOYER_SIGNUP_ENABLED) setSignupType('employer')
    setStep('verify')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    // Already signed in and hitting /login → bounce out. Employers land directly on their
    // dashboard (it shows the claim/activation checklist when they haven't claimed yet); seekers
    // resume returnTo.
    if (isLoggedIn) router.replace(isEmployer ? employerReturnTo : returnTo)
  }, [isLoggedIn, isEmployer, router, returnTo, employerReturnTo])

  function clearError() { setError('') }

  async function goToPassword() {
    if (!name.trim() || !email.trim()) { setError('Name and email are required.'); return }
    if (!email.includes('@')) { setError('Enter a valid email.'); return }
    clearError()
    setStep('password')
  }

  async function createAccount() {
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return }
    setLoading(true); clearError()
    // Kill switch: force seeker when employer signup is closed, even if state somehow says otherwise.
    const effectiveType = EMPLOYER_SIGNUP_ENABLED ? signupType : 'seeker'
    // Persist the intent under BOTH keys: account_type is the stable key the DB trigger (migration
    // 052) reads; role_type is kept for back-compat with the pre-052 trigger, so signup labels the
    // account correctly regardless of whether the migration has been applied yet.
    const meta: Record<string, string> = { name, role_type: effectiveType, account_type: effectiveType }
    // Route the EMAIL-CONFIRMATION link to the right place. Without emailRedirectTo, Supabase sends
    // the verify link to the project Site URL (the seeker homepage) — so a new employer who confirms
    // via the email link landed on the job-seeker front page instead of their portal. Employers →
    // their dashboard (which walks them through claiming + posting via the activation checklist);
    // seekers land on THEIR dashboard — the verify screen promises exactly that, and the homepage
    // with a signed-in nav read as "nothing happened" (audit 2026-10-23). Supabase honours a path on
    // the Site URL's own origin (the reset flow's ${origin}/reset proves it, verified 2026-10-23); any
    // OTHER origin — a Vercel preview — must be in Authentication → URL Configuration → Redirect
    // URLs, or the link is sent to the Site URL root (a preview signup's link came back as
    // redirect_to=https://seenjobs.io/).
    const verifyDest = effectiveType === 'employer' ? '/employers/dashboard' : '/dashboard'
    const { data: signed, error: err } = await supabase.auth.signUp({
      email,
      password,
      options: { data: meta, emailRedirectTo: `${window.location.origin}${verifyDest}` },
    })
    setLoading(false)
    if (err && !isEmailThrottle(err)) { setError(err.message); return }
    // A throttled signUp is a REPEAT of one that just sent the link (Supabase refuses a second email
    // to the same address inside its window): that link still works, so wait for it on the verify
    // screen instead of stranding the person on this form with "For security purposes…" (H3).
    if (err) setNotice('We sent your confirmation link a moment ago — open the newest email from Seen.')
    const addr = email.trim()
    savePendingSignup({ email: addr, uid: signed?.user?.id, type: effectiveType })
    const pending = readPendingSignup()
    setVerifyUid(pending && pending.email === addr.toLowerCase() ? pending.uid : (signed?.user?.id ?? null))
    setVerifyEmail(addr)
    setStep('verify')
  }

  // Fresh employer signups land on their dashboard (activation checklist guides them to claim +
  // post); seekers resume returnTo. (The kill switch forces seeker in createAccount, so signupType
  // is only 'employer' here when employer signup is open.)
  const afterVerify = () => router.replace(EMPLOYER_SIGNUP_ENABLED && signupType === 'employer' ? employerReturnTo : returnTo)

  /**
   * Has the email link been clicked?
   *  - 'in': this browser is signed in to the confirmed account (same device: the link signed it in;
   *    other device: the server said confirmed and the credentials typed a moment ago were used once).
   *  - 'confirmed': confirmed, but this tab cannot sign itself in (reloaded — the password is never
   *    stored — or the password was refused): the caller hands over to the sign-in form.
   *  - false: not yet.
   * Other device = the link tapped on a phone while this tab waits on a laptop: no session ever
   * reaches this browser, so getUser() alone can never see it. With the signUp id the server answers
   * (api/signup-status.js) on EVERY poll and sign-in is attempted only once the answer is yes. Without
   * an id (a throttled repeat signup that never got one) the credentials are retried, at most once per
   * 10 s (`withPassword` on every other poll), so the project's per-IP sign-in budget is not spent.
   */
  async function isVerified(withPassword: boolean): Promise<'in' | 'confirmed' | false> {
    const { data, error: err } = await supabase.auth.getUser()
    if (!err && data.user?.email_confirmed_at) return 'in'
    const addr = (verifyEmail || email).trim()
    if (verifyUid) {
      const confirmed = await signupConfirmed(verifyUid)
      if (confirmed !== true) return false
      if (!addr || !password) return 'confirmed'
      const { error: signErr } = await supabase.auth.signInWithPassword({ email: addr, password })
      return signErr ? 'confirmed' : 'in'
    }
    if (!withPassword || !addr || !password) return false
    const { error: signErr } = await supabase.auth.signInWithPassword({ email: addr, password })
    return signErr ? false : 'in'
  }

  /** The address is confirmed but this tab holds no session: the sign-in form, prefilled, says so. */
  function confirmedSignInHere() {
    clearPendingSignup()
    setEmail(verifyEmail || email); setPassword(''); setError('')
    setNotice('Your email is confirmed. Sign in with your password to continue.')
    setStep('signin')
  }

  function verified(result: 'in' | 'confirmed') {
    if (result === 'in') { clearPendingSignup(); clearSessionExpiredNotice(); afterVerify() }
    else confirmedSignInHere()
  }

  async function checkVerification() {
    setLoading(true); clearError()
    const result = await isVerified(true)
    setLoading(false)
    if (result) { verified(result); return }
    // No uid and no password (a restored tab that never got an id): the sign-in form is the honest
    // next step — it tells them to confirm first if they have not.
    if (!verifyUid && !password) { setEmail(verifyEmail || email); setStep('signin'); return }
    setError('Not confirmed yet — open the link in your email, then this page moves on by itself.')
  }

  // Auto-detect the click: on the same device the confirmation link signs this browser in
  // (supabase-js shares the session across tabs); from another device the server is asked (see
  // isVerified). Polls every 5 s while the tab is visible, at most 60 times; the button above remains.
  // One poll at a time: a slow answer never overlaps the next tick or a visibilitychange tick.
  useEffect(() => {
    if (step !== 'verify') return
    verifyPolls.current = 0
    let stopped = false
    let inFlight = false
    const tick = async () => {
      if (stopped || inFlight || document.visibilityState === 'hidden') return
      if (verifyPolls.current >= VERIFY_POLL_MAX) { stopped = true; return }
      verifyPolls.current++
      inFlight = true
      try {
        const result = await isVerified(verifyPolls.current % 2 === 0)
        if (result && !stopped) { stopped = true; verified(result) }
      } finally { inFlight = false }
    }
    const id = setInterval(tick, VERIFY_POLL_MS)
    document.addEventListener('visibilitychange', tick)
    return () => { stopped = true; clearInterval(id); document.removeEventListener('visibilitychange', tick) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, verifyUid])

  async function resendVerification(to?: string) {
    const addr = (to || email).trim()
    if (!addr) return
    setNotice('')
    const dest = EMPLOYER_SIGNUP_ENABLED && signupType === 'employer' ? '/employers/dashboard' : '/dashboard'
    const { error: err } = await supabase.auth.resend({ type: 'signup', email: addr, options: { emailRedirectTo: `${window.location.origin}${dest}` } })
    setError('')
    if (err) {
      // Supabase throttles resends ("…only request this after N seconds"): say that, not a generic failure.
      setError(/security purposes|rate limit|too many/i.test(err.message) ? err.message.replace(/^For security purposes, you can only request this after/i, 'You can ask for another email in') : 'Could not resend right now — try again in a moment.')
      return
    }
    setNotice(`Sent a fresh confirmation link to ${addr}. Open it on any device.`)
  }

  async function doSignIn() {
    if (coolingDown) return
    if (!email.trim() || !password.trim()) { setError('Email and password required.'); return }
    setLoading(true); clearError(); setNotice(''); setUnconfirmedEmail('')
    const { data, error: err } = await supabase.auth.signInWithPassword({ email, password })
    // A project that answers `invalid_credentials` for an unconfirmed address hides the real reason.
    // When THIS tab started the signup for this address, the server can say whether it is confirmed:
    // unconfirmed → the confirm-first message, whatever the password (it is the one thing to do next).
    let unconfirmed = isUnconfirmedError(err)
    if (err && !unconfirmed) {
      const pending = readPendingSignup()
      if (pending?.uid && pending.email === email.trim().toLowerCase()) unconfirmed = (await signupConfirmed(pending.uid)) === false
    }
    setLoading(false)
    if (err) {
      if (unconfirmed) {
        // The address has not been confirmed: that is the one thing to do next, so say it instead of
        // "wrong password" (which sent people to reset a working one; audit 2026-10-24 M1).
        setUnconfirmedEmail(email.trim())
        setError('')
        return
      }
      const fails = signinFails + 1
      setSigninFails(fails)
      if (fails >= SIGNIN_FAILS_BEFORE_COOLDOWN) {
        const until = Date.now() + SIGNIN_COOLDOWN_MS
        setCooldownUntil(until); writeThrottle(fails, until)
        setError(`Too many attempts — wait ${SIGNIN_COOLDOWN_MS / 1000} seconds, then try again. Forgot it? Use “Forgot password?” below.`)
        return
      }
      writeThrottle(fails, 0)
      setError('Incorrect email or password.')
      return
    }
    setSigninFails(0); writeThrottle(0, 0)
    clearPendingSignup()
    clearSessionExpiredNotice()
    // Route employers straight to their dashboard. Employer-ness comes from the account's own signup
    // metadata; the /dashboard guard is the safety net for any older account whose metadata predates
    // this. Sign-in is NOT gated by the kill switch — existing employers must still get in when closed.
    const m = (data.user?.user_metadata || {}) as Record<string, unknown>
    const isEmp = m.account_type === 'employer' || m.role_type === 'employer' || m.type === 'employer'
    router.replace(isEmp ? employerReturnTo : returnTo)
  }

  const btnStyle: React.CSSProperties = {
    width: '100%', padding: '.85rem',
    background: 'linear-gradient(135deg,#3b82f6 0%,#8b5cf6 100%)',
    color: '#fff', border: 'none', borderRadius: 8,
    fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.9rem',
    cursor: loading ? 'not-allowed' : 'pointer', marginBottom: '.75rem',
    boxShadow: '0 0 20px rgba(59,130,246,0.3)', opacity: loading ? 0.6 : 1,
  }

  const backBtn = (to: Step) => (
    <div style={{ marginBottom: '1rem' }}>
      <button type="button" className={styles.textBtn} onClick={() => { clearError(); setStep(to) }} aria-label="Back">
        ← back
      </button>
    </div>
  )

  // Password input with a show/hide toggle — the same control on signup and sign-in.
  const pwField = (id: string, opts: { autoComplete: 'new-password' | 'current-password'; placeholder: string; onEnter: () => void }) => (
    <div className={styles.pwWrap}>
      <input
        id={id}
        type={showPw ? 'text' : 'password'}
        autoComplete={opts.autoComplete}
        placeholder={opts.placeholder}
        value={password}
        onChange={e => setPassword(e.target.value)}
        style={fieldStyle(focused === id)}
        onFocus={() => setFocused(id)}
        onBlur={() => setFocused(null)}
        onKeyDown={e => e.key === 'Enter' && opts.onEnter()}
      />
      <button type="button" className={styles.pwToggle} onClick={() => setShowPw(v => !v)} aria-label={showPw ? 'Hide password' : 'Show password'} aria-pressed={showPw}>
        {showPw ? 'HIDE' : 'SHOW'}
      </button>
    </div>
  )

  const label = (text: string, htmlFor?: string) => (
    <label htmlFor={htmlFor} style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', textTransform: 'uppercase' as const, letterSpacing: '.08em', color: 'var(--dim)', display: 'block', marginBottom: '.35rem' }}>
      {text}
    </label>
  )

  // Signup role tiles. The Employer tile drops out when the kill switch closes employer signup,
  // leaving only the seeker path (and the grid collapses to a single column).
  const roleTiles = ([
    { type: 'seeker' as const, emoji: '🎯', label: 'Job Seeker', desc: 'Find real jobs, track applications, avoid getting ghosted' },
    { type: 'employer' as const, emoji: '🏢', label: 'Employer', desc: 'See your reputation, respond to applicants, post listings' },
  ]).filter(t => EMPLOYER_SIGNUP_ENABLED || t.type !== 'employer')

  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', marginBottom: '2rem', justifyContent: 'center' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--blue)', boxShadow: '0 0 10px rgba(59,130,246,0.6)', display: 'inline-block', animation: 'pulse 2s infinite' }} />
          <span style={{ fontFamily: 'var(--display)', fontSize: '1.3rem', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.02em' }}>Seen</span>
        </div>

        {expiredNotice && <div className={styles.notice} role="status">{SESSION_EXPIRED_MESSAGE}</div>}
        {notice && <div className={styles.notice} role="status" data-testid="login-notice">{notice}</div>}

        {/* Error — rendered INSIDE an always-present live region so assistive tech announces it the
            moment it appears (audit 2026-10-24: the message sat outside the empty role="alert"). */}
        <div role="alert" aria-live="assertive" aria-atomic="true">
          {error && (
            <div data-testid="login-error" style={{ background: 'var(--rdim)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 8, padding: '.72rem 1rem', fontFamily: 'var(--mono)', fontSize: '.72rem', color: 'var(--red)', marginBottom: '1rem', textAlign: 'center', lineHeight: 1.6 }}>
              {coolingDown ? `Too many attempts — try again in ${cooldownLeft}s. Forgot it? Use “Forgot password?” below.` : error}
            </div>
          )}
          {/* Correct password, unconfirmed address (M1): the fix is the link, not a new password. */}
          {unconfirmedEmail && step === 'signin' && (
            <div data-testid="login-unconfirmed" style={{ background: 'var(--bdim)', border: '1px solid var(--bmid)', borderRadius: 8, padding: '.72rem 1rem', fontFamily: 'var(--mono)', fontSize: '.75rem', color: 'var(--sub)', marginBottom: '1rem', textAlign: 'left', lineHeight: 1.65 }}>
              Confirm your email first — we sent the link to <strong style={{ color: 'var(--white)' }}>{unconfirmedEmail}</strong>. Open it on any device, then sign in here.{' '}
              <button type="button" className={styles.linkBtn} onClick={() => resendVerification(unconfirmedEmail)} style={{ fontSize: 'inherit' }}>Resend the link →</button>
            </div>
          )}
        </div>

        {/* ── STEP: WHO ── */}
        {step === 'who' && (
          <div>
            <div style={{ textAlign: 'center', marginBottom: '1.75rem' }}>
              <h1 style={{ fontFamily: 'var(--display)', fontSize: '1.5rem', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.025em', margin: '0 0 .35rem' }}>Who are you?</h1>
              <div style={{ fontSize: '.85rem', color: 'var(--sub)', fontWeight: 300 }}>Pick one to get started</div>
            </div>
            {!EMPLOYER_SIGNUP_ENABLED && cameAsEmployer && (
              <div style={{ background: 'var(--bdim)', border: '1px solid var(--bmid)', borderRadius: 8, padding: '.6rem .85rem', fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--sub)', marginBottom: '1.1rem', textAlign: 'center', lineHeight: 1.55 }}>
                Employer signups are currently closed. You can still create a job seeker account below.
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: roleTiles.length > 1 ? '1fr 1fr' : '1fr', gap: '.75rem', marginBottom: '1.25rem' }}>
              {roleTiles.map(t => (
                <button
                  key={t.type}
                  onClick={() => { setSignupType(t.type); setStep('email') }}
                  style={{
                    background: 'var(--surface)', border: '1.5px solid var(--line2)', borderRadius: 12,
                    padding: '1.5rem 1rem', cursor: 'pointer', textAlign: 'center',
                    transition: 'all .2s',
                  }}
                  onMouseOver={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--blue)'; (e.currentTarget as HTMLButtonElement).style.background = 'var(--bdim)' }}
                  onMouseOut={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--line2)'; (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface)' }}
                >
                  <div style={{ fontSize: '1.75rem', marginBottom: '.6rem' }}>{t.emoji}</div>
                  <div style={{ fontFamily: 'var(--display)', fontSize: '.9rem', fontWeight: 700, color: 'var(--white)', marginBottom: '.2rem' }}>{t.label}</div>
                  <div style={{ fontSize: '.72rem', color: 'var(--dim)', fontWeight: 300 }}>{t.desc}</div>
                </button>
              ))}
            </div>
            <div style={{ textAlign: 'center', fontSize: '.78rem', color: 'var(--muted)' }}>
              Already have an account?{' '}
              <button type="button" className={styles.linkBtn} onClick={() => { clearError(); setStep('signin') }}>
                Sign in →
              </button>
            </div>
          </div>
        )}

        {/* ── STEP: EMAIL ── */}
        {step === 'email' && (
          <div>
            {backBtn('who')}
            <h1 style={{ fontFamily: 'var(--display)', fontSize: '1.4rem', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.025em', margin: '0 0 .2rem' }}>
              {signupType === 'employer' ? 'Create your employer account' : 'Create your account'}
            </h1>
            <div style={{ fontSize: '.82rem', color: 'var(--sub)', fontWeight: 300, marginBottom: signupType === 'employer' ? '.6rem' : '1.5rem' }}>
              {signupType === 'employer' ? 'Then claim your company on the employers page — free.' : 'Free forever for job seekers'}
            </div>
            {signupType === 'employer' && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.6rem', flexWrap: 'wrap', background: 'var(--bdim)', border: '1px solid var(--bmid)', borderRadius: 8, padding: '.55rem .8rem', fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--sub)', marginBottom: '1.25rem' }}>
                <span>🏢 Employer account · a work email at your company&apos;s domain gets your claim approved instantly</span>
                <button type="button" className={styles.linkBtn} onClick={() => { setSignupType('seeker'); clearError() }} style={{ fontSize: '.62rem' }}>Not an employer?</button>
              </div>
            )}
            <div style={{ marginBottom: '.85rem' }}>
              {label('First name', 'su-name')}
              <input id="su-name" type="text" autoComplete="given-name" placeholder="What should we call you?" value={name} onChange={e => setName(e.target.value)} style={fieldStyle(focused === 'name')} onFocus={() => setFocused('name')} onBlur={() => setFocused(null)} />
            </div>
            <div style={{ marginBottom: '1.25rem' }}>
              {label('Email', 'su-email')}
              <input id="su-email" type="email" autoComplete="email" inputMode="email" placeholder="you@email.com" value={email} onChange={e => setEmail(e.target.value)} style={fieldStyle(focused === 'email')} onFocus={() => setFocused('email')} onBlur={() => setFocused(null)} onKeyDown={e => e.key === 'Enter' && goToPassword()} />
            </div>
            <button style={btnStyle} onClick={goToPassword} disabled={loading}>Continue →</button>
            <div style={{ textAlign: 'center', fontSize: '.78rem', color: 'var(--muted)' }}>
              Already have an account?{' '}
              <button type="button" className={styles.linkBtn} onClick={() => { clearError(); setStep('signin') }}>
                Sign in →
              </button>
            </div>
          </div>
        )}

        {/* ── STEP: PASSWORD ── */}
        {step === 'password' && (
          <div>
            {backBtn('email')}
            <h1 style={{ fontFamily: 'var(--display)', fontSize: '1.4rem', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.025em', margin: '0 0 .2rem' }}>Set a password</h1>
            <div style={{ fontSize: '.82rem', color: 'var(--sub)', fontWeight: 300, marginBottom: '1.5rem' }}>Make it something you&apos;ll remember</div>
            <div style={{ marginBottom: '1.25rem' }}>
              {label('Password', 'su-pw')}
              {pwField('su-pw', { autoComplete: 'new-password', placeholder: 'At least 8 characters', onEnter: createAccount })}
              <div style={{ height: 3, background: 'var(--line2)', borderRadius: 2, overflow: 'hidden', marginTop: '.5rem' }}>
                <div style={{
                  height: '100%', borderRadius: 2, transition: 'all .3s',
                  width: `${Math.min(100, password.length * 8)}%`,
                  background: password.length < 8 ? 'var(--red)' : password.length < 12 ? 'var(--amber)' : 'var(--green)',
                }} />
              </div>
            </div>
            <button style={btnStyle} onClick={createAccount} disabled={loading}>
              {loading ? 'Creating account...' : 'Create account →'}
            </button>
          </div>
        )}

        {/* ── STEP: VERIFY ── */}
        {step === 'verify' && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📬</div>
            <h1 style={{ fontFamily: 'var(--display)', fontSize: '1.4rem', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.025em', margin: '0 0 .5rem' }}>Check your email</h1>
            <div style={{ fontSize: '.85rem', color: 'var(--sub)', fontWeight: 300, lineHeight: 1.7, marginBottom: '1.25rem' }}>
              We sent a verification link to<br />
              <strong style={{ color: 'var(--white)' }}>{verifyEmail}</strong>
            </div>
            <div style={{ background: 'var(--bdim)', border: '1px solid var(--bmid)', borderRadius: 8, padding: '.85rem 1rem', fontFamily: 'var(--mono)', fontSize: '.68rem', color: 'var(--blue)', marginBottom: '1rem', lineHeight: 1.65, textAlign: 'left' }}>
              ✓ Open the link in your email<br />
              ✓ It signs you in and opens your dashboard<br />
              ✓ Left this tab open? It moves on by itself
            </div>
            <div className={styles.auto} aria-live="polite">Watching for your click — no need to refresh</div>
            <button style={btnStyle} onClick={checkVerification} disabled={loading}>
              {loading ? 'Checking...' : 'I verified my email →'}
            </button>
            <button type="button" onClick={() => resendVerification(verifyEmail)} style={{ width: '100%', minHeight: 44, padding: '.65rem', background: 'none', border: '1px solid var(--line2)', color: 'var(--sub)', borderRadius: 8, fontFamily: 'var(--body)', fontSize: '.8rem', cursor: 'pointer', marginBottom: '.5rem' }}>
              Resend verification email
            </button>
            <button type="button" className={`${styles.linkBtn} ${styles.linkDim}`} onClick={() => { clearPendingSignup(); setVerifyUid(null); setNotice(''); setEmail(''); setPassword(''); setStep('email') }}>
              Use a different email
            </button>
            <button type="button" className={`${styles.linkBtn} ${styles.linkDim}`} onClick={() => { markPendingSignin(); setVerifyUid(null); setNotice(''); clearError(); setEmail(verifyEmail); setPassword(''); setStep('signin') }}>
              Sign in instead
            </button>
          </div>
        )}

        {/* ── STEP: SIGN IN ── */}
        {step === 'signin' && (
          <div>
            {backBtn('who')}
            <h1 style={{ fontFamily: 'var(--display)', fontSize: '1.4rem', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.025em', margin: '0 0 .2rem' }}>Welcome back</h1>
            <div style={{ fontSize: '.82rem', color: 'var(--sub)', fontWeight: 300, marginBottom: '1.5rem' }}>Sign in to your account</div>
            <div style={{ marginBottom: '.85rem' }}>
              {label('Email', 'si-email')}
              <input id="si-email" type="email" autoComplete="email" inputMode="email" placeholder="you@email.com" value={email} onChange={e => setEmail(e.target.value)} style={fieldStyle(focused === 'siEmail')} onFocus={() => setFocused('siEmail')} onBlur={() => setFocused(null)} />
            </div>
            <div style={{ marginBottom: '.5rem' }}>
              {label('Password', 'si-pw')}
              {pwField('si-pw', { autoComplete: 'current-password', placeholder: '••••••••', onEnter: doSignIn })}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '.75rem' }}>
              {/* /reset is the working code-based flow (send code → verify → set password).
                  The old in-page step emailed a link that dead-ended on /dashboard. */}
              <button type="button" className={`${styles.linkBtn} ${styles.linkDim}`} onClick={() => router.push('/reset')}>
                Forgot password?
              </button>
            </div>
            <button style={{ ...btnStyle, cursor: loading || coolingDown ? 'not-allowed' : 'pointer', opacity: loading || coolingDown ? 0.6 : 1 }} onClick={doSignIn} disabled={loading || coolingDown} aria-disabled={loading || coolingDown}>
              {loading ? 'Signing in...' : coolingDown ? `Wait ${cooldownLeft}s` : 'Sign in →'}
            </button>
            {/* A project that answers `invalid_credentials` for an unconfirmed address cannot be told from a
                wrong password; the resend path is offered under the generic error so a new signup who
                skipped the email is not sent to reset a working password. Resend goes to anyone — no
                account enumeration. */}
            {error && !coolingDown && !unconfirmedEmail && (
              <div style={{ textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--muted)', marginBottom: '.75rem', lineHeight: 1.6 }}>
                Just signed up and never confirmed your email?{' '}
                <button type="button" className={`${styles.linkBtn} ${styles.linkDim}`} onClick={() => resendVerification()} style={{ fontSize: 'inherit' }}>Resend the confirmation link</button>
              </div>
            )}
            <div style={{ textAlign: 'center', fontSize: '.78rem', color: 'var(--muted)' }}>
              No account?{' '}
              <button type="button" className={styles.linkBtn} onClick={() => { clearError(); setStep('who') }}>
                Create one →
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginContent />
    </Suspense>
  )
}

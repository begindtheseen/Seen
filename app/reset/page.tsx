'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

const inp: React.CSSProperties = {
  width: '100%',
  background: 'var(--surface)',
  border: '1.5px solid var(--line2)',
  borderRadius: 8,
  padding: '.72rem 1rem',
  color: 'var(--white)',
  fontFamily: 'var(--body)',
  fontSize: 'var(--fs-ui)',
  outline: 'none',
  caretColor: 'var(--blue)',
  boxSizing: 'border-box',
}
const label: React.CSSProperties = { fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--dim)', display: 'block', marginBottom: '.35rem' }
const h1: React.CSSProperties = { fontFamily: 'var(--display)', fontSize: 'var(--fs-xl)', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.025em', margin: '0 0 .2rem' }
const sub: React.CSSProperties = { fontSize: 'var(--fs-sm)', color: 'var(--sub)', fontWeight: 300, marginBottom: '.5rem' }
const fine: React.CSSProperties = { fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', color: 'var(--muted)', lineHeight: 1.55, marginBottom: '1.5rem' }
const focusOn = (e: React.FocusEvent<HTMLInputElement>) => { e.target.style.borderColor = 'var(--blue)' }
const focusOff = (e: React.FocusEvent<HTMLInputElement>) => { e.target.style.borderColor = 'var(--line2)' }
const cta = (busy: boolean): React.CSSProperties => ({ width: '100%', padding: '.85rem', background: 'linear-gradient(135deg,#3b82f6 0%,#8b5cf6 100%)', color: '#fff', border: 'none', borderRadius: 8, fontFamily: 'var(--display)', fontWeight: 800, fontSize: 'var(--fs-ui)', cursor: busy ? 'not-allowed' : 'pointer', marginBottom: '.75rem', boxShadow: '0 0 20px rgba(59,130,246,0.3)', opacity: busy ? 0.7 : 1 })

/** The neutral answer to "send me a code" — the same words whether or not the address has an account
 *  (the raw Supabase error, "Signups not allowed for otp", told anyone which emails are registered;
 *  audit 2026-10-24, M2). */
const CODE_SENT_COPY = (email: string) => `If an account exists for ${email}, a code is on its way.`
const LINK_EXPIRED_COPY = 'That reset link has expired or was already used. Request a code below instead.'

/**
 * Two ways in, one page:
 *  - `set`: a recovery session is present — the emailed "Reset my password" link from Settings lands
 *    here as /reset#access_token=…&type=recovery, supabase-js consumes the hash and emits
 *    PASSWORD_RECOVERY, and the person sets the new password HERE. (Before 2026-10-24 the page ignored
 *    the hash and showed the email form: the Settings link flow dead-ended; audit H1.) A signed-in
 *    visitor with no link gets the same form — they can already change their password.
 *  - `code`: signed out, no link — email → 8-digit code → new password.
 */
type Mode = 'detecting' | 'code' | 'set'

export default function ResetPage() {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('detecting')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [newPass, setNewPass] = useState('')
  const [confirmPass, setConfirmPass] = useState('')
  const [step, setStep] = useState<1 | 2>(1)
  const [sending, setSending] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [msg, setMsg] = useState('')
  const [ok, setOk] = useState(false)

  useEffect(() => {
    let alive = true
    // supabase-js (detectSessionInUrl) reads the hash itself; we only look at it to know what to wait for.
    const params = new URLSearchParams((window.location.hash || '').replace(/^#/, ''))
    const linkError = params.get('error') || params.get('error_code')
    const isLink = params.get('type') === 'recovery' || params.has('access_token') || params.has('code')
    if (linkError) {
      // #error=access_denied&error_code=otp_expired&error_description=… — the link is dead; say so once.
      try { window.history.replaceState(window.history.state, '', window.location.pathname) } catch { /* ignore */ }
      setMsg(LINK_EXPIRED_COPY); setOk(false); setMode('code')
      return
    }
    // Once the link has become a session, the tokens leave the address bar (and the history entry):
    // supabase-js reads the hash but leaves it there, and it is a live credential for an hour.
    const dropHash = () => { if (isLink && window.location.hash) { try { window.history.replaceState(window.history.state, '', window.location.pathname) } catch { /* ignore */ } } }
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!alive) return
      if (event === 'PASSWORD_RECOVERY' || ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session && isLink)) {
        setEmail(session?.user?.email || '')
        setMode('set'); dropHash()
      }
    })
    // getSession awaits the client's own URL parsing, so a recovery link is already a session here.
    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return
      if (data.session) { setEmail(data.session.user.email || ''); setMode('set'); dropHash(); return }
      if (!isLink) { setMode('code'); return }
      // A link with no session after a moment: used twice, or expired — the code flow still works.
      setTimeout(() => { if (alive) setMode(m => { if (m === 'detecting') { setMsg(LINK_EXPIRED_COPY); setOk(false); return 'code' } return m }) }, 4000)
    }).catch(() => { if (alive) setMode('code') })
    return () => { alive = false; subscription.unsubscribe() }
  }, [])

  async function sendCode() {
    const em = email.trim()
    if (!em || !em.includes('@')) { setMsg('Enter a valid email.'); setOk(false); return }
    setSending(true)
    setMsg('')
    const { error } = await supabase.auth.signInWithOtp({ email: em, options: { shouldCreateUser: false } })
    setSending(false)
    // Only a throttle is worth reporting (it is about THIS request, not the account). Anything else —
    // including "no such user" — gets the one neutral answer; nothing about the error reaches the screen.
    if (error && (error.status === 429 || /security purposes|rate limit|too many/i.test(error.message))) {
      setMsg('Too many requests for this address — wait a minute, then try again.'); setOk(false); return
    }
    setStep(2)
  }

  async function verifyCode() {
    const c = code.trim()
    const np = newPass.trim()
    const cp = confirmPass.trim()
    if (!c || c.length < 6) { setMsg('Enter the code from your email.'); setOk(false); return }
    if (!np || np.length < 8) { setMsg('Password must be at least 8 characters.'); setOk(false); return }
    if (np !== cp) { setMsg("Passwords don't match."); setOk(false); return }
    setVerifying(true)
    setMsg('')
    let verified = false
    for (const type of ['magiclink', 'email', 'recovery'] as const) {
      const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: c, type })
      if (!error) { verified = true; break }
    }
    if (!verified) {
      setVerifying(false)
      setMsg('Invalid or expired code. Request a new one.')
      setOk(false)
      setCode('')
      return
    }
    const { error: passError } = await supabase.auth.updateUser({ password: np })
    setVerifying(false)
    if (passError) { setMsg(passError.message); setOk(false); return }
    setMsg('Password updated! Signing you in...')
    setOk(true)
    setTimeout(async () => {
      await supabase.auth.signInWithPassword({ email: email.trim(), password: np })
      router.push('/dashboard')
    }, 900)
  }

  /** The recovery-link / signed-in path: the session is already there, only the password changes. */
  async function setNewPassword() {
    const np = newPass.trim()
    const cp = confirmPass.trim()
    if (!np || np.length < 8) { setMsg('Password must be at least 8 characters.'); setOk(false); return }
    if (np !== cp) { setMsg("Passwords don't match."); setOk(false); return }
    setVerifying(true)
    setMsg('')
    const { error } = await supabase.auth.updateUser({ password: np })
    setVerifying(false)
    if (error) {
      // A signed-in visitor whose session is older than Supabase's "secure password change" window is
      // asked to re-prove it is them: the emailed code does exactly that, so hand over to it.
      if ((error as { code?: string }).code === 'reauthentication_needed' || /reauthenticat/i.test(error.message)) {
        setMsg('For your security, confirm it is you with a code we email you.'); setOk(false); setMode('code')
        return
      }
      // The recovery session can lapse (link opened long ago) — point at the code flow, not a dead end.
      const dead = /session|jwt|expired|not authenticated/i.test(error.message) || error.status === 401
      setMsg(dead ? LINK_EXPIRED_COPY : error.message); setOk(false)
      if (dead) setMode('code')
      return
    }
    setMsg('Password updated — taking you to your dashboard…')
    setOk(true)
    setNewPass(''); setConfirmPass('')
    setTimeout(() => router.replace('/dashboard'), 900)
  }

  const passwordFields = (onEnter: () => void) => (
    <>
      <div style={{ marginBottom: '.85rem' }}>
        <label style={label} htmlFor="rs-new">New password</label>
        <input id="rs-new" type="password" autoComplete="new-password" value={newPass} onChange={e => setNewPass(e.target.value)} onFocus={focusOn} onBlur={focusOff} placeholder="Min 8 characters" style={inp} />
      </div>
      <div style={{ marginBottom: '1.25rem' }}>
        <label style={label} htmlFor="rs-confirm">Confirm new password</label>
        <input id="rs-confirm" type="password" autoComplete="new-password" value={confirmPass} onChange={e => setConfirmPass(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') onEnter() }} onFocus={focusOn} onBlur={focusOff} placeholder="Confirm password" style={inp} />
      </div>
    </>
  )
  const message = msg && <div role="status" style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', color: ok ? 'var(--green)' : 'var(--red)', marginBottom: '.85rem', lineHeight: 1.6 }}>{msg}</div>

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '80px 1.5rem 1.5rem' }}>
      <div className="rise-in" style={{ width: '100%', maxWidth: 420 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', marginBottom: '2rem', justifyContent: 'center' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--blue)', boxShadow: '0 0 10px rgba(59,130,246,0.6)', display: 'inline-block' }} />
          <span style={{ fontFamily: 'var(--display)', fontSize: 'var(--fs-h3)', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.02em' }}>Seen</span>
        </div>

        {mode === 'detecting' && (
          <div data-testid="reset-detecting">
            <h1 style={h1}>One moment</h1>
            <div style={sub}>Checking your reset link…</div>
          </div>
        )}

        {mode === 'set' && (
          <div data-testid="reset-set">
            <h1 style={h1}>Set your new password</h1>
            <div style={sub}>{email ? <>For <span style={{ fontFamily: 'var(--mono)', color: 'var(--blue)' }}>{email}</span>.</> : 'Your reset link checked out.'} Choose a new password and you are back in.</div>
            <div style={fine}>Your other devices stay signed in until you sign them out (Settings → Sign out of all devices).</div>
            {passwordFields(setNewPassword)}
            {message}
            <button onClick={setNewPassword} disabled={verifying} style={cta(verifying)}>
              {verifying ? 'Saving...' : 'Save new password →'}
            </button>
            <div style={{ textAlign: 'center' }}>
              <Link href="/dashboard" style={{ color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', textDecoration: 'none' }}>
                Keep my current password
              </Link>
            </div>
          </div>
        )}

        {mode === 'code' && step === 1 && (
          <div data-testid="reset-email">
            <h1 style={h1}>Reset your password</h1>
            {/* This flow sends the sign-in-code email (supabase signInWithOtp → an 8-digit code, no link).
                Settings → Change password sends the OTHER email, a reset LINK, which lands on this page
                in `set` mode. Each screen says exactly what its own email contains and names the other
                path (audit 2026-10-23: the two screens read as if one of them were wrong). */}
            <div style={sub}>Enter your email and we&apos;ll send an 8-digit code — a code to type here, not a link.</div>
            <div style={fine}>Already signed in and prefer a link? Settings → Change password emails one instead.</div>
            <div style={{ marginBottom: '1.25rem' }}>
              <label style={label} htmlFor="rs-email">Email address</label>
              <input
                id="rs-email"
                type="email"
                autoComplete="email"
                inputMode="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') sendCode() }}
                onFocus={focusOn}
                onBlur={focusOff}
                placeholder="you@email.com"
                style={inp}
              />
            </div>
            {message}
            <button onClick={sendCode} disabled={sending} style={cta(sending)}>
              {sending ? 'Sending...' : 'Send code →'}
            </button>
            <div style={{ textAlign: 'center' }}>
              <Link href="/login" style={{ color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', textDecoration: 'none' }}>
                Back to sign in
              </Link>
            </div>
          </div>
        )}

        {mode === 'code' && step === 2 && (
          <div data-testid="reset-code">
            <h1 style={h1}>Enter your code</h1>
            <div style={{ ...sub, marginBottom: '.35rem' }}>{CODE_SENT_COPY(email.trim())}</div>
            <div style={fine}>An 8-digit code, not a link. It expires in 10 minutes. Nothing arrived? Check spam, or make sure this is the address you signed up with.</div>
            <div style={{ marginBottom: '.85rem' }}>
              <label style={label} htmlFor="rs-code">8-digit code</label>
              <input
                id="rs-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={8}
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                onFocus={focusOn}
                onBlur={focusOff}
                placeholder="12345678"
                style={{ ...inp, fontFamily: 'var(--mono)', fontSize: 'var(--fs-xl)', letterSpacing: '.2em', textAlign: 'center' }}
              />
            </div>
            {passwordFields(verifyCode)}
            {message}
            <button onClick={verifyCode} disabled={verifying} style={cta(verifying)}>
              {verifying ? 'Verifying...' : 'Update password →'}
            </button>
            <div style={{ textAlign: 'center' }}>
              <button
                onClick={() => { setStep(1); setCode(''); setMsg('') }}
                style={{ background: 'none', border: 'none', color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', cursor: 'pointer', minHeight: 44 }}
              >
                Resend code
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

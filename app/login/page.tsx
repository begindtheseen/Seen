'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'

type Step = 'who' | 'email' | 'password' | 'verify' | 'signin'

// Only ever redirect to an internal path — anything else (full URLs, protocol-relative
// '//evil.com') falls back to the dashboard so login can't be used as an open redirect.
function safeInternalPath(p: string | null): string | null {
  if (!p) return null
  if (!p.startsWith('/') || p.startsWith('//')) return null
  return p
}

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
  // Where to land after auth. /apply, /pricing and the UpgradeModal pass ?return= / ?next=
  // so the user resumes what they were doing — dumping everyone on /dashboard lost the
  // "did you apply?" context and the upgrade intent.
  const returnTo = safeInternalPath(params.get('return')) || safeInternalPath(params.get('next')) || '/dashboard'
  // "For employers →" links here with ?type=employer — open the chooser (not seeker sign-in).
  const [step, setStep] = useState<Step>(
    params.get('signup') === '1' || params.get('type') === 'employer' ? 'who' : 'signin'
  )
  const [signupType, setSignupType] = useState<'seeker' | 'employer'>(EMPLOYER_SIGNUP_ENABLED && cameAsEmployer ? 'employer' : 'seeker')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [verifyEmail, setVerifyEmail] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [focused, setFocused] = useState<string | null>(null)

  useEffect(() => {
    // Already signed in and hitting /login → bounce out. Employers go to the portal (the
    // /dashboard guard is the fallback if the profile hasn't resolved yet); seekers to returnTo.
    if (isLoggedIn) router.replace(isEmployer ? '/employers' : returnTo)
  }, [isLoggedIn, isEmployer, router, returnTo])

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
    const { error: err } = await supabase.auth.signUp({
      email,
      password,
      options: { data: meta },
    })
    setLoading(false)
    if (err) { setError(err.message); return }
    setVerifyEmail(email)
    setStep('verify')
  }

  async function checkVerification() {
    setLoading(true); clearError()
    const { data, error: err } = await supabase.auth.getUser()
    setLoading(false)
    if (err || !data.user) { setError('Not verified yet. Check your email.'); return }
    if (!data.user.email_confirmed_at) { setError('Still waiting on verification. Check your inbox.'); return }
    // Fresh employer signups land on the portal; seekers resume returnTo. (The kill switch forces
    // seeker in createAccount, so signupType is only 'employer' here when employer signup is open.)
    router.replace(EMPLOYER_SIGNUP_ENABLED && signupType === 'employer' ? '/employers' : returnTo)
  }

  async function resendVerification() {
    if (!email) return
    await supabase.auth.resend({ type: 'signup', email })
    setError('')
    alert('Verification email resent!')
  }

  async function doSignIn() {
    if (!email.trim() || !password.trim()) { setError('Email and password required.'); return }
    setLoading(true); clearError()
    const { data, error: err } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)
    if (err) { setError('Incorrect email or password.'); return }
    // Route employers to their portal. Employer-ness comes from the account's own signup metadata;
    // the /dashboard guard is the safety net for any older account whose metadata predates this.
    // Sign-in is NOT gated by the kill switch — existing employers must still get in when closed.
    const m = (data.user?.user_metadata || {}) as Record<string, unknown>
    const isEmp = m.account_type === 'employer' || m.role_type === 'employer' || m.type === 'employer'
    router.replace(isEmp ? '/employers' : returnTo)
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
    <button
      onClick={() => { clearError(); setStep(to) }}
      style={{ background: 'none', border: 'none', color: 'var(--dim)', fontFamily: 'var(--mono)', fontSize: '.68rem', cursor: 'pointer', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '.35rem' }}
    >
      ← back
    </button>
  )

  const label = (text: string) => (
    <label style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', textTransform: 'uppercase' as const, letterSpacing: '.08em', color: 'var(--dim)', display: 'block', marginBottom: '.35rem' }}>
      {text}
    </label>
  )

  // Signup role tiles. The Employer tile drops out when the kill switch closes employer signup,
  // leaving only the seeker path (and the grid collapses to a single column).
  const roleTiles = ([
    { type: 'seeker' as const, emoji: '🎯', label: 'Job Seeker', desc: 'Find real jobs, track applications, avoid getting ghosted' },
    { type: 'employer' as const, emoji: '🏢', label: 'Employer', desc: 'Manage your score, respond to reports, post listings' },
  ]).filter(t => EMPLOYER_SIGNUP_ENABLED || t.type !== 'employer')

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem', paddingTop: 80 }}>
      <div style={{ width: '100%', maxWidth: 420, animation: 'fadeUp .4s ease both' }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', marginBottom: '2rem', justifyContent: 'center' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--blue)', boxShadow: '0 0 10px rgba(59,130,246,0.6)', display: 'inline-block', animation: 'pulse 2s infinite' }} />
          <span style={{ fontFamily: 'var(--display)', fontSize: '1.3rem', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.02em' }}>Seen</span>
        </div>

        {/* Error */}
        {error && (
          <div style={{ background: 'var(--rdim)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 8, padding: '.72rem 1rem', fontFamily: 'var(--mono)', fontSize: '.72rem', color: 'var(--red)', marginBottom: '1rem', textAlign: 'center' }}>
            {error}
          </div>
        )}

        {/* ── STEP: WHO ── */}
        {step === 'who' && (
          <div>
            <div style={{ textAlign: 'center', marginBottom: '1.75rem' }}>
              <div style={{ fontFamily: 'var(--display)', fontSize: '1.5rem', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.025em', marginBottom: '.35rem' }}>Who are you?</div>
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
              <button onClick={() => { clearError(); setStep('signin') }} style={{ background: 'none', border: 'none', color: 'var(--blue)', fontSize: '.78rem', cursor: 'pointer', textDecoration: 'underline', fontFamily: 'var(--body)' }}>
                Sign in →
              </button>
            </div>
          </div>
        )}

        {/* ── STEP: EMAIL ── */}
        {step === 'email' && (
          <div>
            {backBtn('who')}
            <div style={{ fontFamily: 'var(--display)', fontSize: '1.4rem', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.025em', marginBottom: '.2rem' }}>Create your account</div>
            <div style={{ fontSize: '.82rem', color: 'var(--sub)', fontWeight: 300, marginBottom: '1.5rem' }}>Free forever for job seekers</div>
            <div style={{ marginBottom: '.85rem' }}>
              {label('First name')}
              <input type="text" placeholder="What should we call you?" value={name} onChange={e => setName(e.target.value)} style={fieldStyle(focused === 'name')} onFocus={() => setFocused('name')} onBlur={() => setFocused(null)} />
            </div>
            <div style={{ marginBottom: '1.25rem' }}>
              {label('Email')}
              <input type="email" placeholder="you@email.com" value={email} onChange={e => setEmail(e.target.value)} style={fieldStyle(focused === 'email')} onFocus={() => setFocused('email')} onBlur={() => setFocused(null)} onKeyDown={e => e.key === 'Enter' && goToPassword()} />
            </div>
            <button style={btnStyle} onClick={goToPassword} disabled={loading}>Continue →</button>
          </div>
        )}

        {/* ── STEP: PASSWORD ── */}
        {step === 'password' && (
          <div>
            {backBtn('email')}
            <div style={{ fontFamily: 'var(--display)', fontSize: '1.4rem', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.025em', marginBottom: '.2rem' }}>Set a password</div>
            <div style={{ fontSize: '.82rem', color: 'var(--sub)', fontWeight: 300, marginBottom: '1.5rem' }}>Make it something you&apos;ll remember</div>
            <div style={{ marginBottom: '1.25rem' }}>
              {label('Password')}
              <input type="password" placeholder="At least 8 characters" value={password} onChange={e => setPassword(e.target.value)} style={fieldStyle(focused === 'pw')} onFocus={() => setFocused('pw')} onBlur={() => setFocused(null)} onKeyDown={e => e.key === 'Enter' && createAccount()} />
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
            <div style={{ fontFamily: 'var(--display)', fontSize: '1.4rem', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.025em', marginBottom: '.5rem' }}>Check your email</div>
            <div style={{ fontSize: '.85rem', color: 'var(--sub)', fontWeight: 300, lineHeight: 1.7, marginBottom: '1.25rem' }}>
              We sent a verification link to<br />
              <strong style={{ color: 'var(--white)' }}>{verifyEmail}</strong>
            </div>
            <div style={{ background: 'var(--bdim)', border: '1px solid var(--bmid)', borderRadius: 8, padding: '.85rem 1rem', fontFamily: 'var(--mono)', fontSize: '.68rem', color: 'var(--blue)', marginBottom: '1.5rem', lineHeight: 1.65, textAlign: 'left' }}>
              ✓ Click the link in your email<br />
              ✓ Come back here and tap below<br />
              ✓ You&apos;ll go straight to your dashboard
            </div>
            <button style={btnStyle} onClick={checkVerification} disabled={loading}>
              {loading ? 'Checking...' : 'I verified my email →'}
            </button>
            <button onClick={resendVerification} style={{ width: '100%', padding: '.65rem', background: 'none', border: '1px solid var(--line2)', color: 'var(--sub)', borderRadius: 8, fontFamily: 'var(--body)', fontSize: '.8rem', cursor: 'pointer', marginBottom: '.75rem' }}>
              Resend verification email
            </button>
            <button onClick={() => { setEmail(''); setStep('email') }} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: '.62rem', cursor: 'pointer' }}>
              Use a different email
            </button>
          </div>
        )}

        {/* ── STEP: SIGN IN ── */}
        {step === 'signin' && (
          <div>
            {backBtn('who')}
            <div style={{ fontFamily: 'var(--display)', fontSize: '1.4rem', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.025em', marginBottom: '.2rem' }}>Welcome back</div>
            <div style={{ fontSize: '.82rem', color: 'var(--sub)', fontWeight: 300, marginBottom: '1.5rem' }}>Sign in to your account</div>
            <div style={{ marginBottom: '.85rem' }}>
              {label('Email')}
              <input type="email" placeholder="you@email.com" value={email} onChange={e => setEmail(e.target.value)} style={fieldStyle(focused === 'siEmail')} onFocus={() => setFocused('siEmail')} onBlur={() => setFocused(null)} />
            </div>
            <div style={{ marginBottom: '.5rem' }}>
              {label('Password')}
              <input type="password" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} style={fieldStyle(focused === 'siPw')} onFocus={() => setFocused('siPw')} onBlur={() => setFocused(null)} onKeyDown={e => e.key === 'Enter' && doSignIn()} />
            </div>
            <div style={{ textAlign: 'right', marginBottom: '1.25rem' }}>
              {/* /reset is the working code-based flow (send code → verify → set password).
                  The old in-page step emailed a link that dead-ended on /dashboard. */}
              <button onClick={() => router.push('/reset')} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: '.62rem', cursor: 'pointer', textDecoration: 'underline' }}>
                Forgot password?
              </button>
            </div>
            <button style={btnStyle} onClick={doSignIn} disabled={loading}>
              {loading ? 'Signing in...' : 'Sign in →'}
            </button>
            <div style={{ textAlign: 'center', fontSize: '.78rem', color: 'var(--muted)' }}>
              No account?{' '}
              <button onClick={() => { clearError(); setStep('who') }} style={{ background: 'none', border: 'none', color: 'var(--blue)', fontSize: '.78rem', cursor: 'pointer', textDecoration: 'underline', fontFamily: 'var(--body)' }}>
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

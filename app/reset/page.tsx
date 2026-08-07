'use client'

import { useState } from 'react'
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
  fontSize: '.875rem',
  outline: 'none',
  caretColor: 'var(--blue)',
  boxSizing: 'border-box',
}

export default function ResetPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [newPass, setNewPass] = useState('')
  const [confirmPass, setConfirmPass] = useState('')
  const [step, setStep] = useState<1 | 2>(1)
  const [sending, setSending] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [msg, setMsg] = useState('')
  const [ok, setOk] = useState(false)

  async function sendCode() {
    const em = email.trim()
    if (!em || !em.includes('@')) { setMsg('Enter a valid email.'); setOk(false); return }
    setSending(true)
    setMsg('')
    const { error } = await supabase.auth.signInWithOtp({ email: em, options: { shouldCreateUser: false } })
    setSending(false)
    if (error) {
      setMsg(
        error.message.includes('not found') || error.message.includes('registered')
          ? 'No account found with that email.'
          : error.message
      )
      setOk(false)
      return
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

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '80px 1.5rem 1.5rem' }}>
      <div className="rise-in" style={{ width: '100%', maxWidth: 420 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', marginBottom: '2rem', justifyContent: 'center' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--blue)', boxShadow: '0 0 10px rgba(59,130,246,0.6)', display: 'inline-block' }} />
          <span style={{ fontFamily: 'var(--display)', fontSize: '1.3rem', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.02em' }}>Seen</span>
        </div>

        {step === 1 ? (
          <div>
            <div style={{ fontFamily: 'var(--display)', fontSize: '1.4rem', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.025em', marginBottom: '.2rem' }}>Reset your password</div>
            <div style={{ fontSize: '.82rem', color: 'var(--sub)', fontWeight: 300, marginBottom: '1.5rem' }}>Enter your email and we&apos;ll send an 8-digit code</div>
            <div style={{ marginBottom: '1.25rem' }}>
              <label style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', textTransform: 'uppercase' as const, letterSpacing: '.08em', color: 'var(--dim)', display: 'block', marginBottom: '.35rem' }}>Email address</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') sendCode() }}
                onFocus={e => { e.target.style.borderColor = 'var(--blue)' }}
                onBlur={e => { e.target.style.borderColor = 'var(--line2)' }}
                placeholder="you@email.com"
                style={inp}
              />
            </div>
            {msg && <div style={{ fontFamily: 'var(--mono)', fontSize: '.65rem', color: ok ? 'var(--green)' : 'var(--red)', marginBottom: '.85rem' }}>{msg}</div>}
            <button
              onClick={sendCode}
              disabled={sending}
              style={{ width: '100%', padding: '.85rem', background: 'linear-gradient(135deg,#3b82f6 0%,#8b5cf6 100%)', color: '#fff', border: 'none', borderRadius: 8, fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.9rem', cursor: sending ? 'not-allowed' : 'pointer', marginBottom: '.75rem', boxShadow: '0 0 20px rgba(59,130,246,0.3)', opacity: sending ? 0.7 : 1 }}
            >
              {sending ? 'Sending...' : 'Send code →'}
            </button>
            <div style={{ textAlign: 'center' }}>
              <Link href="/login" style={{ color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: '.65rem', textDecoration: 'none' }}>
                Back to sign in
              </Link>
            </div>
          </div>
        ) : (
          <div>
            <div style={{ fontFamily: 'var(--display)', fontSize: '1.4rem', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.025em', marginBottom: '.2rem' }}>Enter your code</div>
            <div style={{ fontSize: '.82rem', color: 'var(--sub)', fontWeight: 300, marginBottom: '.35rem' }}>We sent an 8-digit code to</div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.82rem', color: 'var(--blue)', marginBottom: '1.5rem' }}>{email.trim()}</div>
            <div style={{ marginBottom: '.85rem' }}>
              <label style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', textTransform: 'uppercase' as const, letterSpacing: '.08em', color: 'var(--dim)', display: 'block', marginBottom: '.35rem' }}>8-digit code</label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={8}
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                onFocus={e => { e.target.style.borderColor = 'var(--blue)' }}
                onBlur={e => { e.target.style.borderColor = 'var(--line2)' }}
                placeholder="12345678"
                style={{ ...inp, fontFamily: 'var(--mono)', fontSize: '1.4rem', letterSpacing: '.2em', textAlign: 'center' }}
              />
            </div>
            <div style={{ marginBottom: '.85rem' }}>
              <label style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', textTransform: 'uppercase' as const, letterSpacing: '.08em', color: 'var(--dim)', display: 'block', marginBottom: '.35rem' }}>New password</label>
              <input
                type="password"
                value={newPass}
                onChange={e => setNewPass(e.target.value)}
                onFocus={e => { e.target.style.borderColor = 'var(--blue)' }}
                onBlur={e => { e.target.style.borderColor = 'var(--line2)' }}
                placeholder="Min 8 characters"
                style={inp}
              />
            </div>
            <div style={{ marginBottom: '1.25rem' }}>
              <label style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', textTransform: 'uppercase' as const, letterSpacing: '.08em', color: 'var(--dim)', display: 'block', marginBottom: '.35rem' }}>Confirm new password</label>
              <input
                type="password"
                value={confirmPass}
                onChange={e => setConfirmPass(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') verifyCode() }}
                onFocus={e => { e.target.style.borderColor = 'var(--blue)' }}
                onBlur={e => { e.target.style.borderColor = 'var(--line2)' }}
                placeholder="Confirm password"
                style={inp}
              />
            </div>
            {msg && <div style={{ fontFamily: 'var(--mono)', fontSize: '.65rem', color: ok ? 'var(--green)' : 'var(--red)', marginBottom: '.85rem' }}>{msg}</div>}
            <button
              onClick={verifyCode}
              disabled={verifying}
              style={{ width: '100%', padding: '.85rem', background: 'linear-gradient(135deg,#3b82f6 0%,#8b5cf6 100%)', color: '#fff', border: 'none', borderRadius: 8, fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.9rem', cursor: verifying ? 'not-allowed' : 'pointer', marginBottom: '.75rem', boxShadow: '0 0 20px rgba(59,130,246,0.3)', opacity: verifying ? 0.7 : 1 }}
            >
              {verifying ? 'Verifying...' : 'Update password →'}
            </button>
            <div style={{ textAlign: 'center' }}>
              <button
                onClick={() => { setStep(1); setCode(''); setMsg('') }}
                style={{ background: 'none', border: 'none', color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: '.65rem', cursor: 'pointer' }}
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

'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState, useEffect } from 'react'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'

export default function Nav() {
  const pathname = usePathname()
  const router = useRouter()
  const { isLoggedIn, isSeeker } = useAuth()
  const [showAccountModal, setShowAccountModal] = useState(false)
  const [resetSent, setResetSent] = useState(false)
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const isActive = (path: string) => pathname === path || pathname.startsWith(path + '/')

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/')
  }

  const handlePasswordReset = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.email) return
    await supabase.auth.resetPasswordForEmail(user.email, { redirectTo: `${window.location.origin}/reset` })
    setResetSent(true)
  }

  const isDashboard = pathname === '/dashboard'

  return (
    <>
      <nav id="mainNav" className={scrolled ? 'nav-scrolled' : ''}>
        <Link href="/" className="logo">
          <span className="logo-pulse" />
          Seen
        </Link>

        <div className="nav-pills">
          <Link href="/jobs" className={`ntab${isActive('/jobs') ? ' active' : ''}`}>Jobs</Link>
          <Link href="/companies" className={`ntab${isActive('/companies') ? ' active' : ''}`}>Companies</Link>
          <Link href="/demand" className={`ntab${isActive('/demand') ? ' active' : ''}`}>Demand</Link>
          <Link href="/feed" className={`ntab${isActive('/feed') ? ' active' : ''}`}>Feed</Link>
          {isSeeker && <Link href="/resume" className={`ntab${isActive('/resume') ? ' active' : ''}`}>Resume AI</Link>}
          {isSeeker && <Link href="/tracker" className={`ntab${isActive('/tracker') ? ' active' : ''}`}>Track</Link>}
          <Link href="/pricing" className={`ntab${isActive('/pricing') ? ' active' : ''}`}>Pricing</Link>
        </div>

        <div className="nav-right">
          {isSeeker && !isDashboard && (
            <Link href="/dashboard" style={{ display: 'inline-flex', alignItems: 'center', background: 'none', border: '1px solid var(--line2)', color: 'var(--sub)', borderRadius: 8, padding: '.32rem .75rem', fontFamily: 'var(--mono)', fontSize: '.62rem', cursor: 'pointer', whiteSpace: 'nowrap', textDecoration: 'none' }}>
              ← Dashboard
            </Link>
          )}
          {isSeeker && (
            <button
              onClick={() => setShowAccountModal(true)}
              className="btn btn-ghost"
              style={{ fontSize: '.75rem', padding: '.45rem .65rem', lineHeight: 1 }}
              title="Account settings"
            >⚙</button>
          )}
          {!isLoggedIn && (
            <>
              <Link href="/login" className="btn btn-ghost">Sign in</Link>
              <button className="btn btn-solid" onClick={() => router.push('/login?type=employer')}>For employers →</button>
            </>
          )}
        </div>
      </nav>

      {/* Account Settings Modal */}
      {showAccountModal && (
        <div
          style={{ display: 'block', position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', zIndex: 9000, backdropFilter: 'blur(4px)' }}
          onClick={e => { if (e.target === e.currentTarget) setShowAccountModal(false) }}
        >
          <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 'calc(100% - 2rem)', maxWidth: 380, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14, overflow: 'hidden' }}>
            <div style={{ padding: '.9rem 1.1rem', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontFamily: 'var(--display)', fontSize: '.88rem', fontWeight: 700, color: 'var(--white)', letterSpacing: '-.02em' }}>Account Settings</div>
              <button onClick={() => setShowAccountModal(false)} style={{ background: 'none', border: 'none', color: 'var(--dim)', cursor: 'pointer', fontSize: '1rem', lineHeight: 1, padding: '.2rem .3rem' }}>✕</button>
            </div>
            <div style={{ padding: '1rem 1.1rem' }}>
              <div style={{ marginBottom: '1rem' }}>
                <Link href="/profile" onClick={() => setShowAccountModal(false)} style={{ display: 'block', background: 'none', border: '1px solid var(--line2)', borderRadius: 8, padding: '.6rem 1rem', fontFamily: 'var(--mono)', fontSize: '.68rem', color: 'var(--sub)', textDecoration: 'none', textAlign: 'center', marginBottom: '.65rem' }}>
                  Profile settings →
                </Link>
                <div style={{ fontSize: '.78rem', fontWeight: 600, color: 'var(--white)', marginBottom: '.12rem' }}>Change password</div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--muted)', marginBottom: '.65rem' }}>We&apos;ll send a reset link to your email</div>
                <button className="btn btn-ghost" style={{ width: '100%', justifyContent: 'center', fontSize: '.78rem' }} onClick={handlePasswordReset}>Send reset link →</button>
              </div>
              {resetSent && (
                <div style={{ borderTop: '1px solid var(--line)', paddingTop: '.85rem', marginBottom: '1rem' }}>
                  <div style={{ background: 'var(--bdim)', border: '1px solid var(--bmid)', borderRadius: 8, padding: '.75rem 1rem', fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--blue)', lineHeight: 1.65 }}>
                    ✓ Reset link sent — check your email.<br />
                    <span style={{ color: 'var(--sub)' }}>Click the link in the email to set your new password.</span>
                  </div>
                </div>
              )}
              <div style={{ borderTop: '1px solid var(--line)', paddingTop: '.85rem' }}>
                <button className="btn btn-ghost" style={{ width: '100%', justifyContent: 'center', fontSize: '.78rem', color: 'var(--red)', borderColor: 'rgba(239,68,68,.3)' }} onClick={handleSignOut}>Sign out of Seen</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

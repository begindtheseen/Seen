'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState, useEffect } from 'react'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'

export default function Nav() {
  const pathname = usePathname()
  const router = useRouter()
  const { isLoggedIn, isSeeker, token } = useAuth()
  const [showAccountModal, setShowAccountModal] = useState(false)
  const [resetSent, setResetSent] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [creditBalance, setCreditBalance] = useState<number | null>(null)

  useEffect(() => {
    if (!isSeeker) { setCreditBalance(null); return }
    let cancelled = false
    token().then(async (tok) => {
      if (!tok || cancelled) return
      try {
        const res = await fetch('/api/user-sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
          body: JSON.stringify({ action: 'get_credits' }),
        })
        if (!res.ok || cancelled) return
        const data = await res.json() as { balance?: number; pro?: boolean }
        if (!cancelled) setCreditBalance(data.pro ? 999 : (data.balance ?? null))
      } catch { /* ignore */ }
    })
    return () => { cancelled = true }
  }, [isSeeker, token])

  // Close the mobile drawer whenever the route changes
  useEffect(() => { setMenuOpen(false) }, [pathname])

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
        <button className="side-menu-toggle" onClick={() => setMenuOpen(true)} aria-label="Menu" title="Menu">☰</button>
        <Link href="/" className="logo">
          <span className="logo-pulse" />
          Seen
        </Link>

        <div className="nav-pills">
          <Link href="/jobs" className={`ntab${isActive('/jobs') ? ' active' : ''}`}>Jobs</Link>
          <Link href="/companies" className={`ntab${isActive('/companies') ? ' active' : ''}`}>Companies</Link>
          <Link href="/demand" className={`ntab${isActive('/demand') ? ' active' : ''}`}>Demand</Link>
          <Link href="/feed" className={`ntab${isActive('/feed') ? ' active' : ''}`}>Feed</Link>
          {isSeeker && <Link href="/dashboard" className={`ntab${isActive('/dashboard') ? ' active' : ''}`}>Dashboard</Link>}
          {isSeeker && <Link href="/resume" className={`ntab${isActive('/resume') ? ' active' : ''}`}>Resume AI</Link>}
          {isSeeker && <Link href="/tracker" className={`ntab${isActive('/tracker') ? ' active' : ''}`}>Track</Link>}
          <Link href="/pricing" className={`ntab${isActive('/pricing') ? ' active' : ''}`}>Pricing</Link>
        </div>

        <div className="nav-right">
          {isSeeker && creditBalance !== null && (
            <button
              title={creditBalance === 999 ? 'Pro — unlimited AI credits' : `${creditBalance} AI credits remaining today`}
              style={{ background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 20, padding: '.2rem .65rem', fontFamily: 'var(--mono)', fontSize: '.6rem', fontWeight: 700, cursor: 'pointer', lineHeight: 1.5 }}
              onClick={() => setShowAccountModal(true)}
            >
              {creditBalance === 999 ? '∞' : creditBalance} AI
            </button>
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

      {/* Mobile slide-out menu */}
      <div className={`side-menu-overlay${menuOpen ? ' open' : ''}`} onClick={() => setMenuOpen(false)} />
      <div className={`side-menu${menuOpen ? ' open' : ''}`}>
        <div className="side-menu-logo">
          <span className="logo-pulse" />
          <span style={{ fontFamily: 'var(--display)', fontWeight: 800, fontSize: '1.2rem', color: 'var(--white)', letterSpacing: '-.02em' }}>Seen</span>
          <button onClick={() => setMenuOpen(false)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '1rem' }}>✕</button>
        </div>
        <Link href="/jobs" className={`side-menu-item${isActive('/jobs') ? ' active' : ''}`}><span className="side-menu-icon">💼</span>Jobs</Link>
        <Link href="/companies" className={`side-menu-item${isActive('/companies') ? ' active' : ''}`}><span className="side-menu-icon">🏢</span>Companies</Link>
        <Link href="/demand" className={`side-menu-item${isActive('/demand') ? ' active' : ''}`}><span className="side-menu-icon">📊</span>Demand</Link>
        <Link href="/feed" className={`side-menu-item${isActive('/feed') ? ' active' : ''}`}><span className="side-menu-icon">📡</span>Feed</Link>
        {isSeeker && <Link href="/resume" className={`side-menu-item${isActive('/resume') ? ' active' : ''}`}><span className="side-menu-icon">📄</span>Resume AI</Link>}
        {isSeeker && <Link href="/tracker" className={`side-menu-item${isActive('/tracker') ? ' active' : ''}`}><span className="side-menu-icon">✓</span>Track</Link>}
        {isSeeker && <Link href="/dashboard" className={`side-menu-item${isActive('/dashboard') ? ' active' : ''}`}><span className="side-menu-icon">▦</span>Dashboard</Link>}
        <Link href="/pricing" className={`side-menu-item${isActive('/pricing') ? ' active' : ''}`}><span className="side-menu-icon">◈</span>Pricing</Link>
        <div style={{ marginTop: 'auto', padding: '1rem 1.25rem 0', borderTop: '1px solid var(--line)' }}>
          {isSeeker ? (
            <button onClick={() => { setShowAccountModal(true); setMenuOpen(false) }} style={{ background: 'none', border: '1px solid var(--line2)', color: 'var(--sub)', borderRadius: 8, padding: '.5rem 1rem', fontFamily: 'var(--mono)', fontSize: '.65rem', cursor: 'pointer', width: '100%' }}>Account settings</button>
          ) : (
            <Link href="/login" className="btn btn-ghost" style={{ width: '100%', justifyContent: 'center' }}>Sign in</Link>
          )}
        </div>
      </div>

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

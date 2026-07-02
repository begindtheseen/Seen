'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState, useEffect, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import UpgradeModal from './UpgradeModal'

// The earn-credits flow: the résumé survey (asks about the user's past employers).
const ResumeSurveyModal = dynamic(() => import('./ResumeSurveyModal'), { ssr: false })

export default function Nav() {
  const pathname = usePathname()
  const router = useRouter()
  const { isLoggedIn, isSeeker, token } = useAuth()
  const [showAccountModal, setShowAccountModal] = useState(false)
  const [resetSent, setResetSent] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [creditBalance, setCreditBalance] = useState<number | null>(null)
  const [isPro, setIsPro] = useState(false)
  const [showUpgrade, setShowUpgrade] = useState(false)
  const [showSurvey, setShowSurvey] = useState(false)

  const fetchBalance = useCallback(async () => {
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
        if (!cancelled) { setCreditBalance(data.pro ? 999 : (data.balance ?? null)); setIsPro(!!data.pro) }
      } catch { /* ignore */ }
    })
    return () => { cancelled = true }
  }, [isSeeker, token])

  useEffect(() => {
    fetchBalance()
  }, [fetchBalance])

  useEffect(() => {
    const handler = () => { fetchBalance() }
    // Re-fetch on the custom event (usage/earn) AND when the tab regains focus — the latter
    // catches the daily reset for users who leave the tab open overnight.
    const onFocus = () => { if (document.visibilityState !== 'hidden') fetchBalance() }
    // UpgradeModal's "Earn free credits with a quick survey →" dispatches this — without a
    // listener the button closed the modal and did nothing.
    const onOpenSurvey = () => setShowSurvey(true)
    window.addEventListener('seen:credits-updated', handler)
    window.addEventListener('seen:open-survey', onOpenSurvey)
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      window.removeEventListener('seen:credits-updated', handler)
      window.removeEventListener('seen:open-survey', onOpenSurvey)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [fetchBalance])

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

        {/* Ordered by the seeker's own flow first (Dashboard → Jobs → Track → Résumé),
            then shared explore links, so it doesn't read as a random wall of tabs. */}
        <div className="nav-pills">
          {isSeeker && <Link href="/dashboard" className={`ntab${isActive('/dashboard') ? ' active' : ''}`}>Dashboard</Link>}
          <Link href="/jobs" className={`ntab${isActive('/jobs') ? ' active' : ''}`}>Jobs</Link>
          {isSeeker && <Link href="/tracker" className={`ntab${isActive('/tracker') ? ' active' : ''}`}>Track</Link>}
          {isSeeker && <Link href="/resume" className={`ntab${isActive('/resume') ? ' active' : ''}`}>Résumé AI</Link>}
          <Link href="/companies" className={`ntab${isActive('/companies') ? ' active' : ''}`}>Companies</Link>
          <Link href="/demand" className={`ntab${isActive('/demand') ? ' active' : ''}`}>Demand</Link>
          <Link href="/feed" className={`ntab${isActive('/feed') ? ' active' : ''}`}>Feed</Link>
          {isSeeker && <Link href="/saved" className={`ntab${isActive('/saved') ? ' active' : ''}`}>Saved</Link>}
          <Link href="/pricing" className={`ntab${isActive('/pricing') ? ' active' : ''}`}>Pricing</Link>
        </div>

        <div className="nav-right">
          {isSeeker && isPro && (
            <Link
              href="/pricing"
              title="Seen Pro — unlimited AI credits. Manage your membership."
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '.32rem',
                background: 'linear-gradient(135deg,rgba(16,185,129,.18),rgba(99,102,241,.18))',
                color: 'var(--green)', border: '1px solid rgba(16,185,129,.4)',
                borderRadius: 20, padding: '.32rem .7rem',
                fontFamily: 'var(--mono)', fontSize: '.62rem', fontWeight: 700, letterSpacing: '.04em',
                textDecoration: 'none', lineHeight: 1, boxShadow: '0 0 14px rgba(16,185,129,.18)',
              }}
            >
              ★ Unlimited · PRO
            </Link>
          )}
          {isSeeker && !isPro && creditBalance !== null && (
            <button
              title={creditBalance === 0 ? 'Out of AI credits — upgrade or earn more by tracking applications and answering surveys' : `${creditBalance} AI credit${creditBalance === 1 ? '' : 's'} left today`}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '.34rem',
                background: creditBalance === 0 ? 'rgba(239,68,68,.16)' : 'linear-gradient(135deg,rgba(59,130,246,.22),rgba(99,102,241,.22))',
                color: creditBalance === 0 ? 'var(--red)' : 'var(--white)',
                border: creditBalance === 0 ? '1px solid rgba(239,68,68,.4)' : '1px solid rgba(99,102,241,.45)',
                borderRadius: 20, padding: '.32rem .72rem',
                fontFamily: 'var(--mono)', fontSize: '.62rem', fontWeight: 700, cursor: 'pointer', lineHeight: 1,
                whiteSpace: 'nowrap',
                boxShadow: creditBalance === 0 ? '0 0 14px rgba(239,68,68,.18)' : '0 0 12px rgba(99,102,241,.16)',
                animation: creditBalance === 0 ? 'pulse 2s ease-in-out infinite' : undefined,
              }}
              onClick={() => creditBalance === 0 ? setShowUpgrade(true) : setShowSurvey(true)}
            >
              {creditBalance === 0
                ? <>⚠️ Out of credits · Upgrade</>
                : <>🪙 {creditBalance} credit{creditBalance === 1 ? '' : 's'} left</>}
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
        {/* Credit balance — always visible at the top of the mobile drawer for signed-in seekers */}
        {isSeeker && isPro && (
          <Link
            href="/pricing"
            onClick={() => setMenuOpen(false)}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.5rem',
              margin: '.25rem 1rem .6rem', padding: '.7rem .9rem', textDecoration: 'none',
              background: 'linear-gradient(135deg,rgba(16,185,129,.16),rgba(99,102,241,.16))',
              border: '1px solid rgba(16,185,129,.4)', borderRadius: 12,
            }}
          >
            <span style={{ fontFamily: 'var(--mono)', fontSize: '.66rem', fontWeight: 700, color: 'var(--green)', letterSpacing: '.03em' }}>★ Seen Pro</span>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '.66rem', fontWeight: 700, color: 'var(--green)' }}>Unlimited AI</span>
          </Link>
        )}
        {isSeeker && !isPro && creditBalance !== null && (
          <button
            onClick={() => { setMenuOpen(false); creditBalance === 0 ? setShowUpgrade(true) : setShowSurvey(true) }}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.5rem', width: 'calc(100% - 2rem)',
              margin: '.25rem 1rem .6rem', padding: '.7rem .9rem', cursor: 'pointer', textAlign: 'left',
              background: creditBalance === 0 ? 'rgba(239,68,68,.14)' : 'linear-gradient(135deg,rgba(59,130,246,.18),rgba(99,102,241,.18))',
              border: creditBalance === 0 ? '1px solid rgba(239,68,68,.4)' : '1px solid rgba(99,102,241,.4)',
              borderRadius: 12,
            }}
          >
            <span style={{ fontFamily: 'var(--mono)', fontSize: '.66rem', fontWeight: 700, color: creditBalance === 0 ? 'var(--red)' : 'var(--white)' }}>
              {creditBalance === 0 ? '⚠️ Out of AI credits' : `🪙 ${creditBalance} AI credit${creditBalance === 1 ? '' : 's'} left`}
            </span>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', fontWeight: 700, color: creditBalance === 0 ? 'var(--red)' : 'var(--blue)' }}>
              {creditBalance === 0 ? 'Upgrade →' : 'Earn more →'}
            </span>
          </button>
        )}
        {/* Grouped so the drawer reads as sections, not a flat wall of links. */}
        {isSeeker && <div className="side-menu-label">Your job search</div>}
        {isSeeker && <Link href="/dashboard" className={`side-menu-item${isActive('/dashboard') ? ' active' : ''}`}><span className="side-menu-icon">▦</span>Dashboard</Link>}
        {isSeeker && <Link href="/jobs" className={`side-menu-item${isActive('/jobs') ? ' active' : ''}`}><span className="side-menu-icon">💼</span>Find jobs</Link>}
        {isSeeker && <Link href="/tracker" className={`side-menu-item${isActive('/tracker') ? ' active' : ''}`}><span className="side-menu-icon">✓</span>Track applications</Link>}
        {isSeeker && <Link href="/resume" className={`side-menu-item${isActive('/resume') ? ' active' : ''}`}><span className="side-menu-icon">📄</span>Résumé AI</Link>}
        {isSeeker && <Link href="/saved" className={`side-menu-item${isActive('/saved') ? ' active' : ''}`}><span className="side-menu-icon">♥</span>Saved jobs</Link>}

        <div className="side-menu-label">Explore</div>
        {!isSeeker && <Link href="/jobs" className={`side-menu-item${isActive('/jobs') ? ' active' : ''}`}><span className="side-menu-icon">💼</span>Jobs</Link>}
        <Link href="/companies" className={`side-menu-item${isActive('/companies') ? ' active' : ''}`}><span className="side-menu-icon">🏢</span>Company intel</Link>
        <Link href="/demand" className={`side-menu-item${isActive('/demand') ? ' active' : ''}`}><span className="side-menu-icon">📊</span>Hiring demand</Link>
        <Link href="/feed" className={`side-menu-item${isActive('/feed') ? ' active' : ''}`}><span className="side-menu-icon">📡</span>Live feed</Link>

        <div className="side-menu-label">Plans</div>
        <Link href="/pricing" className={`side-menu-item${isActive('/pricing') ? ' active' : ''}`}><span className="side-menu-icon">◈</span>Pricing</Link>
        <div style={{ marginTop: 'auto', padding: '1rem 1.25rem 1.25rem', borderTop: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
          {isSeeker ? (
            <>
              <Link href="/profile" onClick={() => setMenuOpen(false)} style={{ display: 'block', background: 'none', border: '1px solid var(--line2)', color: 'var(--sub)', borderRadius: 8, padding: '.5rem 1rem', fontFamily: 'var(--mono)', fontSize: '.65rem', cursor: 'pointer', textAlign: 'center', textDecoration: 'none' }}>⚙ Profile &amp; settings</Link>
              <button onClick={() => { handleSignOut(); setMenuOpen(false) }} style={{ background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.25)', color: 'var(--red)', borderRadius: 8, padding: '.5rem 1rem', fontFamily: 'var(--mono)', fontSize: '.65rem', fontWeight: 600, cursor: 'pointer', width: '100%' }}>Sign out</button>
            </>
          ) : (
            <Link href="/login" className="btn btn-ghost" style={{ width: '100%', justifyContent: 'center' }}>Sign in</Link>
          )}
        </div>
      </div>

      {showUpgrade && <UpgradeModal reason="credits" onClose={() => setShowUpgrade(false)} />}
      {showSurvey && (
        <ResumeSurveyModal
          onClose={() => setShowSurvey(false)}
          onCreditsEarned={() => fetchBalance()}
        />
      )}

      {/* Account Settings Modal */}
      {showAccountModal && (
        <div
          style={{ display: 'block', position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', zIndex: 9000, backdropFilter: 'blur(4px)' }}
          onClick={e => { if (e.target === e.currentTarget) setShowAccountModal(false) }}
        >
          <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 'calc(100% - 2rem)', maxWidth: 380, background: 'var(--surface)', border: '1px solid rgba(99,102,241,.2)', borderRadius: 14, overflow: 'hidden', boxShadow: '0 32px 96px rgba(0,0,0,.7),0 0 72px rgba(99,102,241,.16),0 0 140px rgba(124,58,237,.08)' }}>
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

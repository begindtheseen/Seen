'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react'
import dynamic from 'next/dynamic'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import UpgradeModal from './UpgradeModal'
import styles from './Nav.module.css'

// The earn-credits flow: the résumé survey (asks about the user's past employers).
const ResumeSurveyModal = dynamic(() => import('./ResumeSurveyModal'), { ssr: false })

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg className={`${styles.chevron}${open ? ' ' + styles.chevronOpen : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}

function BookmarkIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  )
}

/** Accessible click-outside / Escape dropdown used by the More and Account menus. */
function Dropdown({ trigger, open, setOpen, align = 'right', children }: {
  trigger: ReactNode
  open: boolean
  setOpen: (v: boolean) => void
  align?: 'left' | 'right'
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open, setOpen])
  return (
    <div className={styles.menuWrap} ref={ref}>
      {trigger}
      {open && (
        <div className={`${styles.menu}${align === 'left' ? ' ' + styles.menuLeft : ''}`} role="menu">
          {children}
        </div>
      )}
    </div>
  )
}

export default function Nav() {
  const pathname = usePathname()
  const router = useRouter()
  const { isLoggedIn, isSeeker, token, user, profile } = useAuth()
  const [resetSent, setResetSent] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [acctOpen, setAcctOpen] = useState(false)
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

  // Close the mobile drawer and any open dropdown whenever the route changes
  useEffect(() => { setMenuOpen(false); setMoreOpen(false); setAcctOpen(false) }, [pathname])

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

  // The employer portal has its own employer-first chrome — never show the job-seeker nav there.
  if (pathname?.startsWith('/employers')) return null

  // ── Nav information architecture (9→5 primary; every destination still reachable) ──
  // Primary desktop links change with auth state; secondary destinations relocate to the
  // "More" affordance, the Saved bookmark icon, and the account menu (see PR for the full map).
  const linkCls = (path: string) => `${styles.link}${isActive(path) ? ' ' + styles.linkActive : ''}`
  const moreActive = isActive('/demand') || isActive('/feed') || (isSeeker && isActive('/employers'))
  const avatarInitial = (profile?.name?.trim()?.[0] || user?.email?.[0] || 'S').toUpperCase()

  return (
    <>
      <nav id="mainNav" className={scrolled ? 'nav-scrolled' : ''}>
        <button className="side-menu-toggle" onClick={() => setMenuOpen(true)} aria-label="Menu" title="Menu">☰</button>
        <Link href="/" className="logo">
          <span className="logo-pulse" />
          Seen
        </Link>

        {/* Primary destinations — the five that matter for the current auth state. */}
        <div className={styles.primary}>
          {isSeeker ? (
            <>
              <Link href="/dashboard" className={linkCls('/dashboard')}>Dashboard</Link>
              <Link href="/jobs" className={linkCls('/jobs')}>Jobs</Link>
              <Link href="/companies" className={linkCls('/companies')}>Companies</Link>
              <Link href="/tracker" className={linkCls('/tracker')}>Track</Link>
              <Link href="/resume" className={linkCls('/resume')}>Résumé AI</Link>
            </>
          ) : (
            <>
              <Link href="/companies" className={linkCls('/companies')}>Companies</Link>
              <Link href="/jobs" className={linkCls('/jobs')}>Jobs</Link>
              {/* Public employer portal (#200) — kept prominent for logged-out visitors. */}
              <Link href="/employers" className={linkCls('/employers')}>Employers</Link>
              <Link href="/pricing" className={linkCls('/pricing')}>Pricing</Link>
            </>
          )}

          {/* More — relocates Demand/Feed (and Employers for signed-in seekers) without deleting them. */}
          <Dropdown
            open={moreOpen}
            setOpen={setMoreOpen}
            align="left"
            trigger={
              <button
                className={`${styles.link}${moreActive ? ' ' + styles.linkActive : ''}`}
                onClick={() => { setMoreOpen(v => !v); setAcctOpen(false) }}
                aria-haspopup="menu"
                aria-expanded={moreOpen}
              >
                More<ChevronIcon open={moreOpen} />
              </button>
            }
          >
            <div className={styles.menuLabel}>Explore</div>
            {isSeeker && <Link href="/employers" className={styles.menuItem} role="menuitem">For employers</Link>}
            <Link href="/demand" className={styles.menuItem} role="menuitem">Hiring demand</Link>
            <Link href="/feed" className={styles.menuItem} role="menuitem">Live feed</Link>
            <Link href="/agencies" className={styles.menuItem} role="menuitem">Agency ghost index</Link>
          </Dropdown>
        </div>

        <div className={styles.right}>
          {/* Credits — subtle monospace chip (Pro shows an unlimited badge). */}
          {isSeeker && isPro && (
            <Link href="/pricing" className={styles.pro} title="Seen Pro — unlimited AI credits. Manage your membership.">
              ★ Unlimited · PRO
            </Link>
          )}
          {isSeeker && !isPro && creditBalance !== null && (
            <button
              className={`${styles.chip}${creditBalance === 0 ? ' ' + styles.chipZero : ''}`}
              title={creditBalance === 0
                ? 'Out of AI credits — upgrade or earn more by tracking applications and answering surveys'
                : `${creditBalance} AI credit${creditBalance === 1 ? '' : 's'} left today`}
              onClick={() => creditBalance === 0 ? setShowUpgrade(true) : setShowSurvey(true)}
            >
              <span className={styles.chipSpark} />
              <b>{creditBalance}</b>
              <span className={styles.chipLabel}>{creditBalance === 0 ? 'credits · top up' : `credit${creditBalance === 1 ? '' : 's'}`}</span>
            </button>
          )}

          {/* Saved — an icon, not a full nav slot. */}
          {isSeeker && (
            <Link
              href="/saved"
              className={`${styles.iconBtn}${isActive('/saved') ? ' ' + styles.iconBtnActive : ''}`}
              title="Saved jobs"
              aria-label="Saved jobs"
            >
              <BookmarkIcon />
            </Link>
          )}

          {/* Account menu — Pricing lives here (per the IA), plus profile + sign out. */}
          {isLoggedIn && (
            <Dropdown
              open={acctOpen}
              setOpen={setAcctOpen}
              align="right"
              trigger={
                <button
                  className={styles.avatar}
                  onClick={() => { setAcctOpen(v => !v); setMoreOpen(false) }}
                  aria-haspopup="menu"
                  aria-expanded={acctOpen}
                  aria-label="Account menu"
                  title="Account"
                >
                  {avatarInitial}
                </button>
              }
            >
              <div className={styles.menuLabel}>{user?.email ? user.email : 'Account'}</div>
              <Link href="/pricing" className={styles.menuItem} role="menuitem">Pricing &amp; plans</Link>
              {isSeeker && <Link href="/profile" className={styles.menuItem} role="menuitem">Profile &amp; settings</Link>}
              {isSeeker && (
                <button className={styles.menuItem} role="menuitem" onClick={handlePasswordReset}>Change password</button>
              )}
              {resetSent && (
                <div className={styles.menuNote}>✓ Reset link sent — check your email to set a new password.</div>
              )}
              <div className={styles.menuDivider} />
              <button className={`${styles.menuItem} ${styles.menuDanger}`} role="menuitem" onClick={handleSignOut}>Sign out</button>
            </Dropdown>
          )}

          {!isLoggedIn && (
            <>
              <Link href="/login" className="btn btn-ghost">Sign in</Link>
              {/* Primary CTA for a brand-new visitor = start as a job seeker (the default persona).
                  The employer path stays reachable via the "Employers" primary link + More menu, so
                  this no longer misdirects new seekers into employer login. */}
              <Link href="/login?signup=1" className="btn btn-solid">Get started</Link>
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
        <Link href="/agencies" className={`side-menu-item${isActive('/agencies') ? ' active' : ''}`}><span className="side-menu-icon">👻</span>Agency ghost index</Link>
        <Link href="/demand" className={`side-menu-item${isActive('/demand') ? ' active' : ''}`}><span className="side-menu-icon">📊</span>Hiring demand</Link>
        <Link href="/feed" className={`side-menu-item${isActive('/feed') ? ' active' : ''}`}><span className="side-menu-icon">📡</span>Live feed</Link>
        {/* Public employer portal — reachable for everyone (logged-out and logged-in). */}
        <Link href="/employers" className={`side-menu-item${isActive('/employers') ? ' active' : ''}`}><span className="side-menu-icon">🤝</span>For employers</Link>

        <div className="side-menu-label">Plans</div>
        <Link href="/pricing" className={`side-menu-item${isActive('/pricing') ? ' active' : ''}`}><span className="side-menu-icon">◈</span>Pricing</Link>
        <div style={{ marginTop: 'auto', padding: '1rem 1.25rem 1.25rem', borderTop: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
          {isSeeker ? (
            <>
              <Link href="/profile" onClick={() => setMenuOpen(false)} style={{ display: 'block', background: 'none', border: '1px solid var(--line2)', color: 'var(--sub)', borderRadius: 8, padding: '.5rem 1rem', fontFamily: 'var(--mono)', fontSize: '.65rem', cursor: 'pointer', textAlign: 'center', textDecoration: 'none' }}>⚙ Profile &amp; settings</Link>
              <button onClick={() => { handleSignOut(); setMenuOpen(false) }} style={{ background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.25)', color: 'var(--red)', borderRadius: 8, padding: '.5rem 1rem', fontFamily: 'var(--mono)', fontSize: '.65rem', fontWeight: 600, cursor: 'pointer', width: '100%' }}>Sign out</button>
            </>
          ) : isLoggedIn ? (
            <button onClick={() => { handleSignOut(); setMenuOpen(false) }} style={{ background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.25)', color: 'var(--red)', borderRadius: 8, padding: '.5rem 1rem', fontFamily: 'var(--mono)', fontSize: '.65rem', fontWeight: 600, cursor: 'pointer', width: '100%' }}>Sign out</button>
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
    </>
  )
}

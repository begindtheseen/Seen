'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState, useEffect, useRef, type ReactNode } from 'react'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import styles from '../Nav.module.css'
import empStyles from './EmployerNav.module.css'

// EmployerNav / EmployerFooter — the ONE shared chrome for the /employers portal.
//
// The seeker <Nav> removes itself on /employers (Nav.tsx: `if (pathname?.startsWith('/employers'))
// return null`), so every employer surface (landing, hub, verified) previously hand-rolled its own
// header. Those headers linked the Seen logo back to /employers — a dead-end — and had no sign-out,
// so a signed-in employer was trapped in the portal with no way home and no way to log out. This
// gives the whole portal one consistent, escapable, auth-aware bar:
//   • the Seen wordmark ALWAYS returns to the main site home (/),
//   • an organized menu of employer destinations (Reputation · Dashboard · Get Verified · Pricing),
//   • a real account menu with Sign out when logged in (Sign in / Claim when not),
//   • an explicit "for job seekers" exit, and a grouped mobile drawer.
// It reuses Nav.module.css + the global nav/side-menu classes so it is pixel-consistent with the
// seeker nav.

const LINKS: { href: string; label: string; match: (p: string) => boolean }[] = [
  { href: '/employers', label: 'Reputation', match: (p) => p === '/employers' },
  { href: '/employers/dashboard', label: 'Dashboard', match: (p) => p.startsWith('/employers/dashboard') },
  { href: '/employers/verified', label: 'Get Verified', match: (p) => p.startsWith('/employers/verified') },
  { href: '/employers#promote', label: 'Pricing', match: () => false },
]

/** Accessible click-outside / Escape dropdown (mirrors the seeker Nav's Account menu). */
function AccountDropdown({ trigger, open, setOpen, children }: {
  trigger: ReactNode
  open: boolean
  setOpen: (v: boolean) => void
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
      {open && <div className={styles.menu} role="menu">{children}</div>}
    </div>
  )
}

export function EmployerNav() {
  const pathname = usePathname() || ''
  const router = useRouter()
  const { isLoggedIn, ready, user, profile, employerCompany } = useAuth()
  const [scrolled, setScrolled] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [acctOpen, setAcctOpen] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Close the drawer + account menu on any route change.
  useEffect(() => { setMenuOpen(false); setAcctOpen(false) }, [pathname])

  const isActive = (l: (typeof LINKS)[number]) => l.match(pathname)
  const linkCls = (l: (typeof LINKS)[number]) => `${styles.link}${isActive(l) ? ' ' + styles.linkActive : ''}`
  const avatarInitial = (profile?.name?.trim()?.[0] || user?.email?.[0] || 'E').toUpperCase()

  const handleSignOut = async () => {
    try { await supabase.auth.signOut() } catch { /* ignore */ }
    setMenuOpen(false)
    setAcctOpen(false)
    router.push('/')
  }

  return (
    <>
      <nav id="mainNav" className={scrolled ? 'nav-scrolled' : ''}>
        <button className="side-menu-toggle" onClick={() => setMenuOpen(true)} aria-label="Menu" title="Menu">☰</button>

        {/* The wordmark ALWAYS goes home — this is the escape hatch that was missing. */}
        <Link href="/" className="logo" title="Back to Seen home">
          <span className="logo-pulse" />
          Seen
          <span style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '.12em', marginLeft: '.15rem', fontWeight: 500 }}>for employers</span>
        </Link>

        {/* Primary employer destinations (hidden on mobile via .primary — the drawer takes over). */}
        <div className={styles.primary}>
          {LINKS.map(l => (
            <Link key={l.href} href={l.href} className={linkCls(l)}>{l.label}</Link>
          ))}
        </div>

        <div className={styles.right}>
          <div className={empStyles.desktopActions}>
          {/* Exit to the job-seeker side (the drawer carries this on mobile). */}
          <Link href="/" className={styles.link} title="Go to the job-seeker side of Seen">For job seekers →</Link>

          {!ready ? null : isLoggedIn ? (
            <AccountDropdown
              open={acctOpen}
              setOpen={setAcctOpen}
              trigger={
                <button
                  className={styles.avatar}
                  onClick={() => setAcctOpen(v => !v)}
                  aria-haspopup="menu"
                  aria-expanded={acctOpen}
                  aria-label="Account menu"
                  title="Account"
                >
                  {avatarInitial}
                </button>
              }
            >
              <div className={styles.menuLabel}>{user?.email || 'Account'}</div>
              {employerCompany && (
                <div className={styles.menuLabel} style={{ color: 'var(--green)', textTransform: 'none', letterSpacing: 0 }}>
                  Managing {employerCompany}
                </div>
              )}
              <Link href="/employers/dashboard" className={styles.menuItem} role="menuitem">Your dashboard</Link>
              <Link href="/employers" className={styles.menuItem} role="menuitem">Reputation &amp; promote</Link>
              {!employerCompany && (
                <Link href="/employers#claim" className={styles.menuItem} role="menuitem">Claim your company</Link>
              )}
              <div className={styles.menuDivider} />
              <Link href="/" className={styles.menuItem} role="menuitem">Switch to job search</Link>
              <div className={styles.menuDivider} />
              <button className={`${styles.menuItem} ${styles.menuDanger}`} role="menuitem" onClick={handleSignOut}>Sign out</button>
            </AccountDropdown>
          ) : (
            <>
              <Link href="/login?type=employer" className="btn btn-ghost">Sign in</Link>
              <Link href="/employers#claim" className="btn btn-solid">Claim your company</Link>
            </>
          )}
          </div>
        </div>
      </nav>

      {/* Mobile slide-out drawer (reuses the global side-menu styles as the seeker nav does). */}
      <div className={`side-menu-overlay${menuOpen ? ' open' : ''}`} onClick={() => setMenuOpen(false)} />
      <div className={`side-menu${menuOpen ? ' open' : ''}`}>
        <div className="side-menu-logo">
          <span className="logo-pulse" />
          <span style={{ fontFamily: 'var(--display)', fontWeight: 800, fontSize: '1.2rem', color: 'var(--white)', letterSpacing: '-.02em' }}>Seen</span>
          <span style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '.12em' }}>employers</span>
          <button onClick={() => setMenuOpen(false)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '1rem' }} aria-label="Close menu">✕</button>
        </div>

        <div className="side-menu-label">For employers</div>
        <Link href="/employers" className={`side-menu-item${pathname === '/employers' ? ' active' : ''}`}><span className="side-menu-icon">📊</span>Reputation</Link>
        <Link href="/employers/dashboard" className={`side-menu-item${pathname.startsWith('/employers/dashboard') ? ' active' : ''}`}><span className="side-menu-icon">▦</span>Dashboard</Link>
        <Link href="/employers/verified" className={`side-menu-item${pathname.startsWith('/employers/verified') ? ' active' : ''}`}><span className="side-menu-icon">✓</span>Get Verified</Link>
        <Link href="/employers#promote" className="side-menu-item"><span className="side-menu-icon">◈</span>Pricing</Link>

        <div className="side-menu-label">Account</div>
        {ready && isLoggedIn && employerCompany && (
          <div className="side-menu-item" style={{ color: 'var(--green)' }}><span className="side-menu-icon">🏢</span>Managing {employerCompany}</div>
        )}
        <Link href="/" className="side-menu-item"><span className="side-menu-icon">💼</span>Switch to job search</Link>

        <div style={{ marginTop: 'auto', padding: '1rem 1.25rem 1.25rem', borderTop: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
          {ready && isLoggedIn ? (
            <button onClick={handleSignOut} style={{ background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.25)', color: 'var(--red)', borderRadius: 8, padding: '.5rem 1rem', fontFamily: 'var(--mono)', fontSize: '.65rem', fontWeight: 600, cursor: 'pointer', width: '100%' }}>Sign out</button>
          ) : (
            <>
              <Link href="/login?type=employer" className="btn btn-ghost" style={{ width: '100%', justifyContent: 'center' }} onClick={() => setMenuOpen(false)}>Sign in</Link>
              <Link href="/employers#claim" className="btn btn-solid" style={{ width: '100%', justifyContent: 'center' }} onClick={() => setMenuOpen(false)}>Claim your company</Link>
            </>
          )}
        </div>
      </div>
    </>
  )
}

// Shared employer footer — consistent across every portal surface, with the same honest promise line
// and a clear route back to the job-seeker side.
export function EmployerFooter() {
  return (
    <footer style={{ borderTop: '1px solid var(--line)', padding: '1.4rem 1.5rem' }}>
      <div style={{ maxWidth: 960, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '.6rem', width: '100%', boxSizing: 'border-box' }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--dim)' }}>© 2026 Seen · for employers</span>
        <div style={{ display: 'flex', gap: '1.1rem', flexWrap: 'wrap' }}>
          <Link href="/employers#promote" style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--dim)', textDecoration: 'none' }}>Pricing</Link>
          <Link href="/employers/verified" style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--dim)', textDecoration: 'none' }}>Get Verified</Link>
          <Link href="/legal" style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--dim)', textDecoration: 'none' }}>Legal</Link>
          <Link href="/" style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--dim)', textDecoration: 'none' }}>For job seekers →</Link>
        </div>
      </div>
    </footer>
  )
}

export default EmployerNav

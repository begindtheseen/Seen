'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react'
import dynamic from 'next/dynamic'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { markIntentionalSignOut } from '@/lib/sessionExpired'
import { _sync } from '@/lib/sync'
import UpgradeModal from './UpgradeModal'
import NotificationsBell from './NotificationsBell'
import CreditsPopover from './CreditsPopover'
import { dailyResetLabel } from '@/lib/creditRules'
import { useFocusTrap } from '@/lib/hooks/useFocusTrap'
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
  const { isLoggedIn, isSeeker, user, profile } = useAuth()
  const [resetSent, setResetSent] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [acctOpen, setAcctOpen] = useState(false)
  const [creditBalance, setCreditBalance] = useState<number | null>(null)
  // Credits chip popover (components/CreditsPopover.tsx) + the get_credits facts it shows.
  const [creditsOpen, setCreditsOpen] = useState(false)
  const [creditInfo, setCreditInfo] = useState<{ daily_earned?: number | null; max_daily_earn?: number | null; welcome?: boolean; daily?: number | null; purchased?: number | null }>({})
  const [isPro, setIsPro] = useState(false)
  const [showUpgrade, setShowUpgrade] = useState(false)
  const [showSurvey, setShowSurvey] = useState(false)
  const [isMac, setIsMac] = useState(true)
  const primaryRef = useRef<HTMLDivElement>(null)
  const indRef = useRef<HTMLSpanElement>(null)
  const drawerCloseRef = useRef<HTMLButtonElement>(null)
  const drawerRef = useRef<HTMLDivElement>(null)
  // Modal contract (lib/hooks/useFocusTrap): Tab cycles inside the open drawer, focus lands on the close
  // button, and closing returns focus to the hamburger that opened it.
  useFocusTrap(drawerRef, menuOpen, { initialFocus: drawerCloseRef })

  const fetchBalance = useCallback(async () => {
    if (!isSeeker) { setCreditBalance(null); return }
    let cancelled = false
    // Through _sync: a page asking get_credits in the same moment (pricing, résumé, the first-credit
    // dialog) shares this one request instead of adding a second function invocation.
    _sync('get_credits').then((d) => {
      const data = d as { balance?: number; pro?: boolean; daily_earned?: number | null; max_daily_earn?: number | null; welcome?: boolean; daily?: number | null; purchased?: number | null } | null
      if (!data || cancelled) return
      setCreditBalance(data.pro ? 999 : (data.balance ?? null)); setIsPro(!!data.pro)
      setCreditInfo({ daily_earned: data.daily_earned ?? null, max_daily_earn: data.max_daily_earn ?? null, welcome: !!data.welcome, daily: data.daily ?? null, purchased: data.purchased ?? null })
    }).catch(() => { /* ignore */ })
    return () => { cancelled = true }
  }, [isSeeker])

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

  // Phone drawer = a modal: the page behind it must not scroll (iOS ignores body overflow:hidden,
  // so the body is pinned at its scroll offset and restored on close) and Escape closes it. Focus
  // (into the dialog, trapped, returned to the opener) is the useFocusTrap call above.
  useEffect(() => {
    if (!menuOpen) return
    const body = document.body
    const y = window.scrollY
    const prev = { position: body.style.position, top: body.style.top, width: body.style.width, overflow: body.style.overflow }
    body.style.position = 'fixed'
    body.style.top = `-${y}px`
    body.style.width = '100%'
    body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      body.style.position = prev.position
      body.style.top = prev.top
      body.style.width = prev.width
      body.style.overflow = prev.overflow
      window.scrollTo(0, y)
    }
  }, [menuOpen])

  useEffect(() => { setIsMac(/Mac|iPhone|iPad/.test(navigator.platform || '')) }, [])

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Sliding active indicator: measure the active primary link and glide the bar under it
  // (Nav.module.css .ind). Re-measured on route change, auth change, resize and font load.
  useEffect(() => {
    const wrap = primaryRef.current
    const ind = indRef.current
    if (!wrap || !ind) return
    const measure = () => {
      const active = wrap.querySelector<HTMLElement>(`.${styles.linkActive}`)
      if (!active) { ind.style.opacity = '0'; ind.dataset.live = ''; return }
      const x = active.offsetLeft + 10 // inside the link's .62rem side padding
      const w = Math.max(8, active.offsetWidth - 20)
      const live = ind.dataset.live === '1'
      if (!live) ind.style.transition = 'none' // first appearance: land, don't glide in from x=0
      ind.style.transform = `translateX(${x}px)`
      ind.style.width = `${w}px`
      ind.style.opacity = '1'
      if (!live) { void ind.offsetWidth; ind.style.transition = ''; ind.dataset.live = '1' }
    }
    measure()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    ro?.observe(wrap)
    document.fonts?.ready?.then(measure).catch(() => {})
    return () => ro?.disconnect()
  }, [pathname, isSeeker, isLoggedIn])

  const isActive = (path: string) => pathname === path || pathname.startsWith(path + '/')

  const handleSignOut = async () => {
    // scope 'local': THIS device only. The default (global) revoked every session the account
    // had — signing out on a phone logged the user out on their laptop (audit 2026-10-23).
    // "Sign out of all devices" lives in Settings → Security, on purpose.
    markIntentionalSignOut()
    await supabase.auth.signOut({ scope: 'local' })
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
        {/* First focusable element on every page: jumps keyboard users past the nav to <main id="main">. */}
        <a href="#main" className="skip-link">Skip to content</a>
        <button className="side-menu-toggle" onClick={() => setMenuOpen(true)} aria-label="Menu" title="Menu" aria-expanded={menuOpen} aria-controls="side-menu" aria-haspopup="dialog">☰</button>
        {/* Signed-in seekers: the wordmark is "home" = the dashboard, like every signed-in product. */}
        <Link href={isSeeker ? '/dashboard' : '/'} className="logo" aria-label="Seen — home">
          <span className="logo-pulse" />
          {/* Four clipped letters: on the first load of a session they rise in one after another
              (app/motion.css `html.seen-first .logo-l`); otherwise they are just the wordmark. */}
          <span className="logo-word" aria-hidden="true">
            {['S', 'e', 'e', 'n'].map((ch, i) => (
              <span key={i} className="logo-c"><span className="logo-l">{ch}</span></span>
            ))}
          </span>
        </Link>

        {/* Primary destinations — the five that matter for the current auth state. */}
        <div className={styles.primary} ref={primaryRef}>
          {isSeeker ? (
            <>
              <Link href="/dashboard" className={linkCls('/dashboard')}>Dashboard</Link>
              <Link href="/jobs" className={linkCls('/jobs')}>Jobs</Link>
              <Link href="/companies" className={linkCls('/companies')}>Companies</Link>
              <Link href="/tracker" className={linkCls('/tracker')}>Track</Link>
              <Link href="/resume" className={linkCls('/resume')}>Résumé</Link>
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
          <span ref={indRef} className={styles.ind} aria-hidden="true" />
        </div>

        <div className={styles.right}>
          {/* ⌘K — jump anywhere (components/shell/CommandPalette). Desktop only; phones have the tab bar. */}
          <button type="button" className={styles.cmdk} onClick={() => window.dispatchEvent(new Event('seen:palette'))} title="Jump to anything (⌘K)" aria-label="Search and jump to anything">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
            <span className={styles.cmdkLabel}>Jump to…</span>
            <kbd className={styles.cmdkKey}>{isMac ? '⌘' : 'Ctrl'}K</kbd>
          </button>
          {/* Credits — subtle monospace chip (Pro shows an unlimited badge). */}
          {isSeeker && isPro && (
            <Link href="/pricing" className={styles.pro} title="You have Seen Pro access — see what is included">
              <span className={`${styles.pill} ${styles.proPill}`}>★ PRO</span>
            </Link>
          )}
          {isSeeker && !isPro && creditBalance !== null && (
            <span style={{ position: 'relative', display: 'inline-flex' }}>
              <button
                className={`${styles.chip}${creditBalance === 0 ? ' ' + styles.chipZero : ''}`}
                data-credits-chip
                aria-haspopup="dialog"
                aria-expanded={creditsOpen}
                title={creditBalance === 0
                  ? `No AI credits left today — ${dailyResetLabel()}. Tap for options.`
                  : `${creditBalance} AI credit${creditBalance === 1 ? '' : 's'} available · ${dailyResetLabel()}`}
                onClick={() => setCreditsOpen(o => !o)}
              >
                {/* The pill is the visual; the button around it is the hit area (44px tall on phones). */}
                <span className={styles.pill}>
                  <span className={styles.chipSpark} />
                  <b>{creditBalance}</b>
                  <span className={styles.chipLabel}>{`credit${creditBalance === 1 ? '' : 's'}`}</span>
                </span>
              </button>
              {creditsOpen && (
                <CreditsPopover
                  info={{ balance: creditBalance, ...creditInfo }}
                  onClose={() => setCreditsOpen(false)}
                  onEarn={() => setShowSurvey(true)}
                  onUpgrade={() => setShowUpgrade(true)}
                />
              )}
            </span>
          )}

          {/* Application updates — a bell that opens a modal (components/NotificationsBell.tsx). */}
          {isSeeker && user?.id && <NotificationsBell uid={user.id} className={styles.iconBtn} />}

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
                  <span className={styles.avatarDot}>{avatarInitial}</span>
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

      {/* Mobile slide-out menu — slides in from the RIGHT (thumb side), over a tap-to-close
          backdrop; Escape closes it too (effect above). Labels match the tab bar and the desktop
          primary row word for word, so the three navigations read as one. */}
      <div className={`side-menu-overlay${menuOpen ? ' open' : ''}`} onClick={() => setMenuOpen(false)} aria-hidden="true" />
      <div
        id="side-menu"
        ref={drawerRef}
        className={`side-menu ${styles.drawer}${menuOpen ? ` open ${styles.drawerOpen}` : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        aria-hidden={!menuOpen}
        // Off-screen drawer: nothing inside is tabbable or readable until it opens.
        inert={!menuOpen}
      >
        <div className="side-menu-logo">
          <span className="logo-pulse" />
          <span style={{ fontFamily: 'var(--display)', fontWeight: 800, fontSize: 'var(--fs-h3)', color: 'var(--white)', letterSpacing: '-.02em' }}>Seen</span>
          <button ref={drawerCloseRef} type="button" className={styles.drawerClose} onClick={() => setMenuOpen(false)} aria-label="Close menu">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
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
            <span style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', fontWeight: 500, color: 'var(--green)', letterSpacing: '.03em' }}>★ Seen Pro</span>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', fontWeight: 500, color: 'var(--green)' }}>What&apos;s included →</span>
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
            <span style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', fontWeight: 500, color: creditBalance === 0 ? 'var(--red)' : 'var(--white)' }}>
              {creditBalance === 0 ? 'No AI credits left today' : `🪙 ${creditBalance} AI credit${creditBalance === 1 ? '' : 's'} left`}
            </span>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', fontWeight: 500, color: creditBalance === 0 ? 'var(--red)' : 'var(--blue)' }}>
              {creditBalance === 0 ? 'Options →' : 'Earn more →'}
            </span>
          </button>
        )}
        {/* Grouped so the drawer reads as sections, not a flat wall of links. */}
        {isSeeker && <div className="side-menu-label">Your job search</div>}
        {isSeeker && <Link href="/dashboard" className={`side-menu-item${isActive('/dashboard') ? ' active' : ''}`}><span className="side-menu-icon">▦</span>Dashboard</Link>}
        {isSeeker && <Link href="/jobs" className={`side-menu-item${isActive('/jobs') ? ' active' : ''}`}><span className="side-menu-icon">💼</span>Jobs</Link>}
        {isSeeker && <Link href="/companies" className={`side-menu-item${isActive('/companies') ? ' active' : ''}`}><span className="side-menu-icon">🏢</span>Companies</Link>}
        {isSeeker && <Link href="/tracker" className={`side-menu-item${isActive('/tracker') ? ' active' : ''}`}><span className="side-menu-icon">✓</span>Track</Link>}
        {isSeeker && <Link href="/resume" className={`side-menu-item${isActive('/resume') ? ' active' : ''}`}><span className="side-menu-icon">📄</span>Résumé</Link>}
        {isSeeker && <Link href="/saved" className={`side-menu-item${isActive('/saved') ? ' active' : ''}`}><span className="side-menu-icon">♥</span>Saved jobs</Link>}

        <div className="side-menu-label">Explore</div>
        {!isSeeker && <Link href="/jobs" className={`side-menu-item${isActive('/jobs') ? ' active' : ''}`}><span className="side-menu-icon">💼</span>Jobs</Link>}
        {!isSeeker && <Link href="/companies" className={`side-menu-item${isActive('/companies') ? ' active' : ''}`}><span className="side-menu-icon">🏢</span>Companies</Link>}
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
              <Link href="/profile" onClick={() => setMenuOpen(false)} className={styles.drawerGhost}>⚙ Profile &amp; settings</Link>
              <button type="button" onClick={() => { handleSignOut(); setMenuOpen(false) }} className={styles.drawerDanger}>Sign out</button>
            </>
          ) : isLoggedIn ? (
            <button type="button" onClick={() => { handleSignOut(); setMenuOpen(false) }} className={styles.drawerDanger}>Sign out</button>
          ) : (
            <>
              {/* A guest's first move is an account, not a login — the nav's "Get started" button is
                  hidden under 480px (globals.css), so until now the drawer's only CTA was Sign in. */}
              <Link href="/login?signup=1" className={`btn btn-solid ${styles.drawerCta}`}>Create free account</Link>
              <Link href="/login" className={`btn btn-ghost ${styles.drawerCta}`}>Sign in</Link>
            </>
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

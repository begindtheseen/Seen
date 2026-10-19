'use client'

/**
 * Phone tab bar (≤768px): the five places a seeker lives, always one tap away. On desktop the
 * nav's primary row does this job; on phones that row is hidden and everything used to sit
 * behind the hamburger — which is why the site felt like separate pages instead of one app.
 * Solid surface (no backdrop-filter over content — iOS composites it wrong), safe-area aware,
 * and it ducks out of the way while the keyboard is up.
 */
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect } from 'react'
import { useAuth } from '@/lib/auth'
import styles from './TabBar.module.css'

type Tab = { href: string; label: string; icon: 'grid' | 'briefcase' | 'check' | 'building' | 'file' | 'home' | 'tag' | 'user' }

const SEEKER: Tab[] = [
  { href: '/dashboard', label: 'Dashboard', icon: 'grid' },
  { href: '/jobs', label: 'Jobs', icon: 'briefcase' },
  { href: '/tracker', label: 'Track', icon: 'check' },
  { href: '/companies', label: 'Companies', icon: 'building' },
  { href: '/resume', label: 'Résumé', icon: 'file' },
]
const GUEST: Tab[] = [
  { href: '/', label: 'Home', icon: 'home' },
  { href: '/jobs', label: 'Jobs', icon: 'briefcase' },
  { href: '/companies', label: 'Companies', icon: 'building' },
  { href: '/pricing', label: 'Pricing', icon: 'tag' },
  { href: '/login', label: 'Sign in', icon: 'user' },
]

// Focused flows that carry their own bottom chrome or must not be left mid-step by a stray tap.
const HIDDEN = ['/employers', '/login', '/reset', '/admin']

const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round' } as const
function Icon({ name }: { name: Tab['icon'] }) {
  switch (name) {
    case 'grid': return <svg viewBox="0 0 24 24" {...P} aria-hidden><rect x="3" y="3" width="7" height="7" rx="1.6" /><rect x="14" y="3" width="7" height="7" rx="1.6" /><rect x="3" y="14" width="7" height="7" rx="1.6" /><rect x="14" y="14" width="7" height="7" rx="1.6" /></svg>
    case 'briefcase': return <svg viewBox="0 0 24 24" {...P} aria-hidden><rect x="3" y="7" width="18" height="13" rx="2.5" /><path d="M8 7V5.5A1.5 1.5 0 0 1 9.5 4h5A1.5 1.5 0 0 1 16 5.5V7" /><path d="M3 12h18" /></svg>
    case 'check': return <svg viewBox="0 0 24 24" {...P} aria-hidden><rect x="3" y="3" width="18" height="18" rx="4" /><path d="M8 12.5l2.6 2.6L16.5 9" /></svg>
    case 'building': return <svg viewBox="0 0 24 24" {...P} aria-hidden><path d="M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16" /><path d="M16 9h2a2 2 0 0 1 2 2v10" /><path d="M2 21h20" /><path d="M8 7h4M8 11h4M8 15h4" /></svg>
    case 'file': return <svg viewBox="0 0 24 24" {...P} aria-hidden><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /><path d="M9 13h6M9 17h6" /></svg>
    case 'home': return <svg viewBox="0 0 24 24" {...P} aria-hidden><path d="M3 11l9-8 9 8" /><path d="M5 10v10h14V10" /></svg>
    case 'tag': return <svg viewBox="0 0 24 24" {...P} aria-hidden><path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z" /><circle cx="7.5" cy="7.5" r="1.3" /></svg>
    case 'user': return <svg viewBox="0 0 24 24" {...P} aria-hidden><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>
  }
}

export default function TabBar() {
  const pathname = usePathname() || '/'
  const { isLoggedIn, isSeeker, isEmployer } = useAuth()
  const hidden = isEmployer || HIDDEN.some(p => pathname === p || pathname.startsWith(p + '/'))
  const tabs = isSeeker ? SEEKER : isLoggedIn ? [] : GUEST
  const show = !hidden && tabs.length > 0

  // Pages pad their bottom for the bar via html.tabbar (globals.css); the keyboard hides it.
  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('tabbar', show)
    if (!show) return
    const isField = (el: EventTarget | null) =>
      el instanceof HTMLElement && (el.matches('input:not([type=checkbox]):not([type=radio]):not([type=range]), textarea, select, [contenteditable="true"]'))
    const onIn = (e: FocusEvent) => { if (isField(e.target)) root.classList.add('kb') }
    const onOut = () => { root.classList.remove('kb') }
    document.addEventListener('focusin', onIn)
    document.addEventListener('focusout', onOut)
    return () => {
      root.classList.remove('tabbar', 'kb')
      document.removeEventListener('focusin', onIn)
      document.removeEventListener('focusout', onOut)
    }
  }, [show])

  if (!show) return null
  const active = (href: string) => href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(href + '/')

  return (
    <div className={styles.bar} role="navigation" aria-label="Primary">
      {tabs.map(t => (
        <Link key={t.href} href={t.href} className={`${styles.item}${active(t.href) ? ' ' + styles.on : ''}`} aria-current={active(t.href) ? 'page' : undefined}>
          <span className={styles.ico}><Icon name={t.icon} /></span>
          <span className={styles.label}>{t.label}</span>
        </Link>
      ))}
    </div>
  )
}

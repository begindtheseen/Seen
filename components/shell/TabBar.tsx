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
import Icon from '@/components/ui/Icon'
import type { IconName } from '@/components/ui/icons'

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

// The shared icon set (components/ui/icons.ts), mapped from the tab's role.
const TAB_ICON: Record<Tab['icon'], IconName> = { grid: 'layout-dashboard', briefcase: 'briefcase', check: 'list-checks', building: 'building-2', file: 'file-text', home: 'house', tag: 'tag', user: 'user' }

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
          <span className={styles.ico}><Icon name={TAB_ICON[t.icon]} size={22} strokeWidth={1.9} /></span>
          <span className={styles.label}>{t.label}</span>
        </Link>
      ))}
    </div>
  )
}

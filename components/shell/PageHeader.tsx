'use client'

/**
 * The ONE page header every inner page uses, so the site reads as one product:
 * breadcrumb trail back to where you came from (Dashboard for signed-in seekers, Home for
 * everyone else) → eyebrow → title → one-line subtitle → actions. The breadcrumb is what makes
 * "get back to the dashboard from the tracker" a one-tap, same-place-every-time move.
 *
 * Usable from server components (agencies) because every prop is serialisable JSX.
 */
import Link from 'next/link'
import type { CSSProperties, ReactNode } from 'react'
import { useAuth } from '@/lib/auth'
import styles from './PageHeader.module.css'

export type Crumb = { href: string; label: string }

const TONES: Record<string, string> = {
  blue: 'var(--blue)', green: 'var(--green)', amber: 'var(--amber)',
  indigo: '#a5b4fc', violet: '#c4b5fd', red: 'var(--red)', cyan: 'var(--cyan)',
}

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 11l9-8 9 8" /><path d="M5 10v10h14V10" />
    </svg>
  )
}
function GridIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  )
}

/** Breadcrumb trail on its own — for pages with a custom hero (company page). */
export function Crumbs({ items = [], current, className }: { items?: Crumb[]; current?: ReactNode; className?: string }) {
  const { isSeeker } = useAuth()
  const root: Crumb = isSeeker ? { href: '/dashboard', label: 'Dashboard' } : { href: '/', label: 'Home' }
  const trail = [root, ...items.filter(c => c.href !== root.href)]
  return (
    <ol className={`${styles.crumbs}${className ? ' ' + className : ''}`} aria-label="Breadcrumb">
      {trail.map((c, i) => (
        <li key={c.href} className={styles.crumbLi}>
          <Link href={c.href} prefetch={false} className={styles.crumb}>
            {i === 0 && (isSeeker ? <GridIcon /> : <HomeIcon />)}
            {c.label}
          </Link>
          <span className={styles.sep} aria-hidden>›</span>
        </li>
      ))}
      {current && <li className={styles.cur} aria-current="page">{current}</li>}
    </ol>
  )
}

export default function PageHeader({
  title, eyebrow, sub, actions, crumbs, crumbLabel, tone = 'blue', size = 'md', children, className,
}: {
  title: ReactNode
  eyebrow?: ReactNode
  sub?: ReactNode
  actions?: ReactNode
  /** Intermediate crumbs between the root and this page (e.g. Companies › Amazon). */
  crumbs?: Crumb[]
  /** Label for the current page in the trail; defaults to the title when it is a string. */
  crumbLabel?: string
  tone?: keyof typeof TONES
  size?: 'md' | 'lg'
  children?: ReactNode
  className?: string
}) {
  const current = crumbLabel ?? (typeof title === 'string' ? title : undefined)
  return (
    <header
      className={`${styles.head}${size === 'lg' ? ' ' + styles.lg : ''}${className ? ' ' + className : ''}`}
      style={{ '--tone': TONES[tone] || TONES.blue } as CSSProperties}
    >
      <Crumbs items={crumbs} current={current} />
      <div className={styles.row}>
        <div className={styles.text}>
          {eyebrow && <div className={styles.eyebrow}>{eyebrow}</div>}
          <h1 className={styles.title}>{title}</h1>
          {sub && <p className={styles.sub}>{sub}</p>}
        </div>
        {actions && <div className={styles.actions}>{actions}</div>}
      </div>
      {children}
    </header>
  )
}

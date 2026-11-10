'use client'

// The admin's frame (audit §3.2). Desktop (≥900px): a solid left rail — wordmark, search, the six
// sections with their keys 1–6, the job chip, who is signed in. Phone: a slim top bar (wordmark, job
// chip, search) and a solid bottom bar of five 56px targets — Today · Review (live badge) · Listings ·
// People · More (Companies, System) — sitting above the safe area and ducking under the keyboard.
// The site's own nav, footer, tab bar and palette are hidden on /admin.
import { useEffect, useRef, type ReactNode } from 'react'
import Icon from '@/components/ui/Icon'
import type { SectionDef } from '../core/sections.tsx'
import { KeyHint } from './bits.tsx'
import styles from './AdminShell.module.css'

const fmt = (n: number) => Math.round(n).toLocaleString('en-US')

export type AdminShellProps = {
  sections: SectionDef[]
  active: string
  onSelect: (key: SectionDef['key']) => void
  /** Live counts on nav items (Review). null = could not be read. */
  badges: Partial<Record<string, number | null>>
  jobChip?: ReactNode
  onSearch: () => void
  onMore: () => void
  onSignOut: () => void
  username: string
  children: ReactNode
}

function Badge({ n }: { n: number | null | undefined }) {
  if (n === undefined) return null
  if (n === null) return <span className={`${styles.badge} ${styles.badgeUnread}`} aria-label="count unknown">?</span>
  if (n <= 0) return null
  return <span className={styles.badge} aria-label={`${fmt(n)} waiting`}>{n > 999 ? '999+' : fmt(n)}</span>
}

export default function AdminShell({ sections, active, onSelect, badges, jobChip, onSearch, onMore, onSignOut, username, children }: AdminShellProps) {
  const root = useRef<HTMLDivElement>(null)
  // The phone bar ducks while a field has focus (the keyboard is up).
  useEffect(() => {
    const el = root.current
    if (!el) return
    const isField = (t: EventTarget | null) => t instanceof HTMLElement && t.matches('input:not([type=checkbox]):not([type=radio]), textarea, select, [contenteditable="true"]')
    const onIn = (e: FocusEvent) => { if (isField(e.target)) el.classList.add(styles.kb) }
    const onOut = () => el.classList.remove(styles.kb)
    document.addEventListener('focusin', onIn)
    document.addEventListener('focusout', onOut)
    return () => { document.removeEventListener('focusin', onIn); document.removeEventListener('focusout', onOut) }
  }, [])

  const bar = sections.filter((s) => s.phone === 'bar')
  const more = sections.filter((s) => s.phone === 'more')
  const moreActive = more.some((s) => s.key === active)

  return (
    <div ref={root} className={styles.root} data-testid="admin-shell">
      <a href="#admin-main" className={styles.skip}>Skip to content</a>
      {/* Desktop rail */}
      <aside className={styles.rail} aria-label="Admin">
        <div className={styles.brand}><span className={styles.brandWord}>Seen</span><span className={styles.brandTag}>Admin</span></div>
        <button type="button" className={styles.searchBtn} onClick={onSearch} data-testid="rail-search">
          <Icon name="search" size={18} />
          <span className={styles.searchText}>Search</span>
          <KeyHint keys="/" />
        </button>
        <div role="navigation" className={styles.railNav} aria-label="Sections">
          {sections.map((s) => (
            <button key={s.key} type="button" className={styles.railItem} aria-current={s.key === active ? 'page' : undefined} onClick={() => onSelect(s.key)} data-testid={`rail-${s.key}`}>
              <Icon name={s.icon} size={18} />
              <span className={styles.railLabel}>{s.label}</span>
              <Badge n={badges[s.key]} />
              {s.hotkey ? <KeyHint keys={s.hotkey} /> : null}
            </button>
          ))}
        </div>
        <div className={styles.railFoot}>
          {jobChip ? <div className={styles.railJob}>{jobChip}</div> : null}
          <a href="/admin/legacy" className={styles.railLink}>Legacy admin<Icon name="arrow-up-right" size={14} /></a>
          <div className={styles.who}>
            <span className={styles.whoName} title={username}>Signed in as {username || 'admin'}</span>
            <button type="button" className={styles.signOut} onClick={onSignOut} data-testid="rail-signout">Sign out</button>
          </div>
        </div>
      </aside>

      {/* Phone top bar */}
      <header className={styles.top}>
        <div className={styles.brand}><span className={styles.brandWord}>Seen</span><span className={styles.brandTag}>Admin</span></div>
        <div className={styles.topJob}>{jobChip}</div>
        <button type="button" className={styles.iconBtn} onClick={onSearch} aria-label="Search" data-testid="top-search">
          <Icon name="search" size={20} />
        </button>
      </header>

      <div id="admin-main" className={styles.main} tabIndex={-1}><div className={styles.inner}>{children}</div></div>

      {/* Phone bottom bar */}
      {/* Not a <nav>: globals.css styles every nav element as the site bar. */}
      <div role="navigation" className={styles.bottom} aria-label="Sections">
        {bar.map((s) => (
          <button key={s.key} type="button" className={styles.tab} aria-current={s.key === active ? 'page' : undefined} onClick={() => onSelect(s.key)} data-testid={`tab-${s.key}`}>
            <span className={styles.tabIcon}><Icon name={s.icon} size={22} /><Badge n={badges[s.key]} /></span>
            <span className={styles.tabLabel}>{s.label}</span>
          </button>
        ))}
        <button type="button" className={styles.tab} aria-current={moreActive ? 'page' : undefined} onClick={onMore} data-testid="tab-more" aria-haspopup="dialog">
          <span className={styles.tabIcon}><Icon name="menu" size={22} /></span>
          <span className={styles.tabLabel}>{moreActive ? sections.find((s) => s.key === active)?.label : 'More'}</span>
        </button>
      </div>
    </div>
  )
}

'use client'

/**
 * ⌘K / Ctrl+K command palette — jump anywhere, check any company, find jobs, open one of your
 * tracked applications. Also the "g then <key>" shortcuts (g d → dashboard, g t → tracker…)
 * that make the site feel like one keyboard-driven product on desktop.
 * Opened by the shortcut or by `window.dispatchEvent(new Event('seen:palette'))` (the nav button).
 */
import { useRouter, usePathname } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '@/lib/auth'
import { AppStore } from '@/lib/stores/AppStore'
import { useFocusTrap } from '@/lib/hooks/useFocusTrap'
import styles from './CommandPalette.module.css'

type Item = { id: string; label: string; hint?: string; group: string; href: string; keys?: string; icon: string; kw?: string }

const companySlug = (name: string) => encodeURIComponent(name.trim().toLowerCase().replace(/\s+/g, '-'))

const SEEKER_PAGES: Item[] = [
  { id: 'dash', label: 'Dashboard', hint: 'Your command center', group: 'Go to', href: '/dashboard', keys: 'g d', icon: '▦', kw: 'home overview' },
  { id: 'jobs', label: 'Jobs', hint: 'Transparency-first job search', group: 'Go to', href: '/jobs', keys: 'g j', icon: '💼', kw: 'search openings' },
  { id: 'track', label: 'Application tracker', hint: 'Every application, check-ins, outcomes', group: 'Go to', href: '/tracker', keys: 'g t', icon: '✓', kw: 'applications pipeline' },
  { id: 'cos', label: 'Company intel', hint: 'Ghost rates and grades', group: 'Go to', href: '/companies', keys: 'g c', icon: '🏢', kw: 'companies scoreboard' },
  { id: 'resume', label: 'Résumé', hint: 'Fit score and rewrites for one job', group: 'Go to', href: '/resume', keys: 'g r', icon: '🧠', kw: 'resume optimize' },
  { id: 'saved', label: 'Saved jobs', group: 'Go to', href: '/saved', keys: 'g s', icon: '♥', kw: 'bookmarks' },
  { id: 'agencies', label: 'Agency ghost index', group: 'Explore', href: '/agencies', icon: '👻', kw: 'staffing recruiters' },
  { id: 'demand', label: 'Hiring demand', group: 'Explore', href: '/demand', icon: '📊', kw: 'markets cities' },
  { id: 'feed', label: 'Live feed', group: 'Explore', href: '/feed', icon: '📡', kw: 'reports community' },
  { id: 'pricing', label: 'Pricing & plans', group: 'Account', href: '/pricing', icon: '◈', kw: 'pro upgrade credits' },
  { id: 'profile', label: 'Profile & settings', group: 'Account', href: '/profile', icon: '⚙', kw: 'account' },
]
const SEEKER_ACTIONS: Item[] = [
  { id: 'add', label: 'Track a new application', hint: 'Opens the add form', group: 'Actions', href: '/tracker?add=1', icon: '+', kw: 'new log applied' },
  { id: 'report', label: 'Report an outcome', hint: 'Warn the next applicant', group: 'Actions', href: '/report', icon: '📣', kw: 'ghosted rejected hired share' },
]
const GUEST_PAGES: Item[] = [
  { id: 'home', label: 'Home', group: 'Go to', href: '/', keys: 'g h', icon: '⌂' },
  { id: 'jobs', label: 'Jobs', group: 'Go to', href: '/jobs', keys: 'g j', icon: '💼', kw: 'search openings' },
  { id: 'cos', label: 'Company intel', hint: 'Ghost rates and grades', group: 'Go to', href: '/companies', keys: 'g c', icon: '🏢', kw: 'companies scoreboard' },
  { id: 'agencies', label: 'Agency ghost index', group: 'Explore', href: '/agencies', icon: '👻', kw: 'staffing recruiters' },
  { id: 'demand', label: 'Hiring demand', group: 'Explore', href: '/demand', icon: '📊' },
  { id: 'feed', label: 'Live feed', group: 'Explore', href: '/feed', icon: '📡' },
  { id: 'pricing', label: 'Pricing', group: 'Account', href: '/pricing', icon: '◈', kw: 'pro' },
  { id: 'employers', label: 'For employers', group: 'Account', href: '/employers', icon: '🤝' },
  { id: 'login', label: 'Sign in', group: 'Account', href: '/login', icon: '→', kw: 'log in sign up register' },
]
const GO_KEYS: Record<string, string> = { d: '/dashboard', j: '/jobs', t: '/tracker', c: '/companies', r: '/resume', s: '/saved', h: '/' }

const inField = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.matches('input, textarea, select, [contenteditable="true"]') || el.isContentEditable)

export default function CommandPalette() {
  const router = useRouter()
  const pathname = usePathname()
  const { isLoggedIn, isSeeker } = useAuth()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const [mine, setMine] = useState<Item[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const pendingG = useRef<number | null>(null)
  // Tab stays in the palette; Escape/close returns focus to whatever opened it (the nav "Jump to…"
  // pill or the footer button) instead of dropping it on <body>.
  useFocusTrap(panelRef, open, { initialFocus: inputRef })

  const go = useCallback((href: string) => {
    setOpen(false)
    const target = href.split(/[?#]/)[0]
    if (target !== pathname) window.dispatchEvent(new Event('seen:nav-start'))
    router.push(href)
  }, [router, pathname])

  // Shortcuts: ⌘K / Ctrl+K toggles; "g" then a letter jumps (never while typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault(); setOpen(v => !v); return
      }
      if (open || inField(e.target) || e.metaKey || e.ctrlKey || e.altKey) return
      if (pendingG.current) {
        const dest = GO_KEYS[e.key.toLowerCase()]
        window.clearTimeout(pendingG.current); pendingG.current = null
        if (dest && (isSeeker || ['/', '/jobs', '/companies'].includes(dest))) { e.preventDefault(); go(dest) }
        return
      }
      if (e.key === 'g') pendingG.current = window.setTimeout(() => { pendingG.current = null }, 900)
    }
    const onOpen = () => setOpen(true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('seen:palette', onOpen)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('seen:palette', onOpen) }
  }, [open, isSeeker, go])

  // Fresh state each time it opens; pull the user's own applications + recently checked companies.
  useEffect(() => {
    if (!open) return
    setQ(''); setIdx(0)
    const items: Item[] = []
    if (isSeeker) {
      try {
        for (const a of AppStore.loadSync().slice().sort((x, y) => (y.updatedAt || 0) - (x.updatedAt || 0))) {
          items.push({ id: 'app_' + a.id, label: a.company, hint: `${a.role || 'Role'} · ${a.status === 'active' ? a.stage : a.status}`, group: 'Your applications', href: `/tracker#app_${a.id}`, icon: (a.company || '?').charAt(0).toUpperCase(), kw: 'application tracked' })
        }
      } catch { /* device-local store unavailable */ }
    }
    try {
      const raw = localStorage.getItem('seen_recent_cos')
      const recent = raw ? JSON.parse(raw) as Array<{ name: string; slug: string }> : []
      for (const c of recent.slice(0, 6)) items.push({ id: 'co_' + c.slug, label: c.name, hint: 'Company page', group: 'Recently checked', href: `/company/${c.slug}`, icon: (c.name || '?').charAt(0).toUpperCase(), kw: 'company ghost rate' })
    } catch { /* ignore */ }
    setMine(items)
    const t = window.setTimeout(() => inputRef.current?.focus(), 30)
    document.body.classList.add('modal-open')
    return () => { window.clearTimeout(t); document.body.classList.remove('modal-open') }
  }, [open, isSeeker])

  useEffect(() => { setOpen(false) }, [pathname])

  const items = useMemo<Item[]>(() => {
    const base = isSeeker ? [...SEEKER_ACTIONS, ...SEEKER_PAGES] : isLoggedIn ? GUEST_PAGES.filter(i => i.id !== 'login') : GUEST_PAGES
    const query = q.trim().toLowerCase()
    const dynamic: Item[] = []
    if (query) {
      dynamic.push({ id: 'q_co', label: `Check “${q.trim()}”`, hint: 'Ghost rate, grade and reports for any company', group: 'Search', href: `/company/${companySlug(q)}`, icon: '🏢' })
      dynamic.push({ id: 'q_jobs', label: `Find “${q.trim()}” jobs`, hint: 'Search open listings', group: 'Search', href: `/jobs?q=${encodeURIComponent(q.trim())}`, icon: '💼' })
    }
    const pool = [...mine, ...base]
    if (!query) return [...mine.slice(0, 4), ...base]
    const toks = query.split(/\s+/)
    const hits = pool.filter(i => { const hay = `${i.label} ${i.hint || ''} ${i.kw || ''}`.toLowerCase(); return toks.every(t => hay.includes(t)) })
    return [...hits, ...dynamic]
  }, [q, mine, isSeeker, isLoggedIn])

  useEffect(() => { setIdx(0) }, [q])
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-i="${idx}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [idx])

  if (!open) return null

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => Math.min(items.length - 1, i + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx(i => Math.max(0, i - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); const it = items[idx]; if (it) go(it.href) }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false) }
  }

  let lastGroup = ''
  return (
    <div className={styles.overlay} onMouseDown={() => setOpen(false)}>
      <div ref={panelRef} className={styles.panel} role="dialog" aria-modal="true" aria-label="Jump to" onMouseDown={e => e.stopPropagation()} onKeyDown={onKeyDown}>
        <div className={styles.inputRow}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
          <input
            ref={inputRef}
            className={styles.input}
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder={isSeeker ? 'Jump to a page, a company, or one of your applications…' : 'Jump to a page or check any company…'}
            aria-label="Search"
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className={styles.esc}>esc</kbd>
        </div>
        <div className={styles.list} ref={listRef} role="listbox">
          {items.length === 0 && <div className={styles.empty}>Nothing matches. Try a company name.</div>}
          {items.map((it, i) => {
            const head = it.group !== lastGroup ? it.group : null
            lastGroup = it.group
            return (
              <div key={it.id}>
                {head && <div className={styles.group}>{head}</div>}
                <button
                  type="button"
                  data-i={i}
                  role="option"
                  aria-selected={i === idx}
                  className={`${styles.item}${i === idx ? ' ' + styles.active : ''}`}
                  onMouseEnter={() => setIdx(i)}
                  onClick={() => go(it.href)}
                >
                  <span className={styles.ico} aria-hidden>{it.icon}</span>
                  <span className={styles.text}>
                    <b>{it.label}</b>
                    {it.hint && <small>{it.hint}</small>}
                  </span>
                  {it.keys && <kbd className={styles.keys}>{it.keys}</kbd>}
                  <span className={styles.enter} aria-hidden>↵</span>
                </button>
              </div>
            )
          })}
        </div>
        <div className={styles.foot}>
          <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
          <span><kbd>↵</kbd> open</span>
          <span><kbd>g</kbd> then <kbd>d</kbd>/<kbd>j</kbd>/<kbd>t</kbd>/<kbd>c</kbd> jump anywhere</span>
        </div>
      </div>
    </div>
  )
}

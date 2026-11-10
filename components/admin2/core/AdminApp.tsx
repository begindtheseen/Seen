'use client'

// The new admin, top to bottom: runtime → sign-in gate → shell (sections + the one sheet + jobs).
// app/admin/page.tsx renders <AdminApp />.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { AdminItemKind, AdminOverview } from '../contract.ts'
import AdminShell from '../ui/AdminShell.tsx'
import { JobChip } from '../ui/Job.tsx'
import { Loadable } from './Boundary.tsx'
import { AdminRuntimeProvider, useAdminJobs, useAdminQuery, useRuntime } from './hooks.tsx'
import LoginForm from './LoginForm.tsx'
import { useItemPlace, useSection } from './place.ts'
import { tokenStore } from './runtime.ts'
import { SECTION_KEYS, SECTIONS, type SectionProps } from './sections.tsx'
import SheetHost from './SheetHost.tsx'
import { ShellContext, type PanelSpec, type ShellApi } from './shellContext.ts'
import type { ShellSection } from './url.ts'
import styles from './shell.module.css'

const SCROLL_KEY = 'seen_admin_scroll_v1'

export default function AdminApp() {
  return (
    <AdminRuntimeProvider>
      <Gate />
    </AdminRuntimeProvider>
  )
}

function Gate() {
  const [state, setState] = useState<'boot' | 'out' | 'in'>('boot')
  const [username, setUsername] = useState('')
  useEffect(() => {
    setState(tokenStore.get() ? 'in' : 'out')
    setUsername(tokenStore.username() || '')
  }, [])
  if (state === 'boot') return <div className={styles.boot} aria-busy="true" />
  if (state === 'out') return <LoginScreen onSignedIn={(u) => { setUsername(u); setState('in') }} />
  return <Shell username={username} onSignedOut={() => setState('out')} />
}

function LoginScreen({ onSignedIn }: { onSignedIn: (u: string) => void }) {
  return (
    <div className={styles.loginPage}>
      <div className={styles.loginCard}>
        <div className={styles.loginBrand}><span className={styles.loginWord}>Seen</span><span className={styles.loginTag}>Admin</span></div>
        <h1 className={styles.loginH1}>Sign in</h1>
        <p className={styles.loginSub}>Use your admin username, not your Seen account.</p>
        <LoginForm onSignedIn={onSignedIn} />
      </div>
    </div>
  )
}

function readScrolls(): Record<string, number> {
  try { return JSON.parse(window.sessionStorage.getItem(SCROLL_KEY) || '{}') || {} } catch { return {} }
}
function writeScrolls(v: Record<string, number>) {
  try { window.sessionStorage.setItem(SCROLL_KEY, JSON.stringify(v)) } catch { /* ignore */ }
}

function Shell({ username: initialUser, onSignedOut }: { username: string; onSignedOut: () => void }) {
  const rt = useRuntime()
  const { api, cache, jobs, gate } = rt
  // A session started on /admin/legacy stored no username: ask the server who this is (best effort).
  const [username, setUsername] = useState(initialUser)
  useEffect(() => {
    if (initialUser) return
    void api<{ rows?: Array<{ username?: string }> }>('whoami').then((r) => {
      const u = r.ok ? r.rows?.[0]?.username : ''
      if (u) { setUsername(u); tokenStore.set(tokenStore.get(), u) }
    })
  }, [api, initialUser])
  const [section, rawGo] = useSection(SECTION_KEYS)
  const place = useItemPlace()
  const [panel, setPanel] = useState<PanelSpec | null>(null)
  const [ready, setReady] = useState(false)
  const [visited, setVisited] = useState<ShellSection[]>([])
  const scrolls = useRef<Record<string, number>>({})
  const current = useRef<ShellSection>(section)
  const sheetOpen = !!panel || !!place.raw

  // Sections mount on first visit (after the URL has been read) and then stay mounted.
  useEffect(() => { setReady(true); scrolls.current = readScrolls() }, [])
  useEffect(() => {
    if (!ready) return
    setVisited((v) => (v.includes(section) ? v : [...v, section]))
  }, [ready, section])

  // Scroll is remembered per section: saved while scrolling, put back after a switch (and a reload).
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null
    const onScroll = () => {
      if (document.body.classList.contains('modal-open')) return // a sheet's scroll lock is not a position
      if (t) return
      t = setTimeout(() => { t = null; scrolls.current[current.current] = Math.round(window.scrollY); writeScrolls(scrolls.current) }, 150)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => { window.removeEventListener('scroll', onScroll); if (t) clearTimeout(t) }
  }, [])
  useEffect(() => {
    if (!ready) return
    current.current = section
    const y = scrolls.current[section] || 0
    let tries = 0
    let raf = 0
    const put = () => {
      // A section that is still loading is too short to reach its old position: wait for it (≤1.5 s).
      if (y > 0 && document.documentElement.scrollHeight < y + window.innerHeight && tries++ < 90) { raf = requestAnimationFrame(put); return }
      window.scrollTo({ top: y, behavior: 'instant' as ScrollBehavior })
    }
    raf = requestAnimationFrame(put)
    return () => cancelAnimationFrame(raf)
  }, [ready, section])

  const goSection = useCallback((s: ShellSection, filter?: Record<string, string>) => {
    scrolls.current[current.current] = Math.round(window.scrollY)
    writeScrolls(scrolls.current)
    if (filter) scrolls.current[s] = 0 // a new filter starts at the top
    rawGo(s, filter)
  }, [rawGo])

  const signOut = useCallback(async () => {
    for (const j of jobs.list()) if (j.status === 'running' || j.status === 'cancelling') jobs.cancel(j.id)
    gate.settle(false)
    void api('admin_logout', {}, { noReauth: true, timeoutMs: 8000 })
    tokenStore.set(null, null)
    cache.clear()
    onSignedOut()
  }, [api, cache, jobs, gate, onSignedOut])

  const shell: ShellApi = useMemo(() => ({
    section,
    goSection,
    openItem: (kind: AdminItemKind, id: string) => place.open(kind, id),
    closeItem: place.close,
    openPanel: (p: PanelSpec) => setPanel(p),
    closePanel: () => setPanel(null),
    sheetOpen,
    username,
    signOut: () => { void signOut() },
  }), [section, goSection, place, sheetOpen, username, signOut])

  // Desktop keys: 1–6 switch section, "/" opens search. Never while typing or while a sheet is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return
      const t = e.target as HTMLElement | null
      if (t && (t.matches?.('input, textarea, select, [contenteditable="true"]') || t.isContentEditable)) return
      if (sheetOpen || document.querySelector('[role="dialog"][aria-modal="true"]')) return
      if (e.key === '/') { e.preventDefault(); setPanel({ kind: 'search' }); return }
      const hit = SECTIONS.find((s) => s.hotkey === e.key)
      if (hit) { e.preventDefault(); goSection(hit.key) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sheetOpen, goSection])

  // A second press of a running job focuses it: open the jobs sheet on it.
  useEffect(() => jobs.onFocus((id) => setPanel({ kind: 'jobs', focus: id })), [jobs])

  // The Review badge: everything waiting in the queues that live in Review (from the Today read).
  const overview = useAdminQuery<AdminOverview>('overview', () => api<AdminOverview>('overview'), { staleMs: 60_000 })
  const badges = useMemo(() => {
    const out: Record<string, number | null> = {}
    const qs = overview.data?.queues
    if (!qs) return out
    for (const q of qs) {
      if (q.section !== 'review') continue
      if (q.count === null) { out.review = out.review ?? null; continue }
      out.review = (out.review || 0) + q.count
    }
    return out
  }, [overview.data])

  const jobList = useAdminJobs()

  return (
    <ShellContext.Provider value={shell}>
      <AdminShell
        sections={SECTIONS}
        active={section}
        onSelect={(k) => goSection(k)}
        badges={badges}
        jobChip={jobList.length ? <JobChip jobs={jobList} onOpen={() => setPanel({ kind: 'jobs' })} /> : null}
        onSearch={() => setPanel({ kind: 'search' })}
        onMore={() => setPanel({ kind: 'more' })}
        onSignOut={() => { void signOut() }}
        username={username}
      >
        {ready ? SECTIONS.filter((s) => visited.includes(s.key)).map((s) => (
          <SectionSlot key={s.key} active={s.key === section}>
            <Loadable<SectionProps> load={s.load} props={{ active: s.key === section }} what={`the ${s.label} section`} />
          </SectionSlot>
        )) : null}
      </AdminShell>
      <SheetHost place={place} panel={panel} setPanel={setPanel} shell={shell} />
    </ShellContext.Provider>
  )
}

function SectionSlot({ active, children }: { active: boolean; children: ReactNode }) {
  return <section hidden={!active} className={styles.slot} data-section-active={active || undefined}>{children}</section>
}

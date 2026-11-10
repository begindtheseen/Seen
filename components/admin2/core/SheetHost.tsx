'use client'

// The ONE sheet on screen. It shows, in order of priority:
//   1. "Session ended — sign in" (the session gate is waiting; whatever was pressed replays after it),
//   2. a shell panel (search, More, jobs, a custom form),
//   3. the open item (`?item=<kind>:<id>`).
// The item's content stays MOUNTED (hidden) while the sign-in step covers it, so nothing typed into it
// is lost; there is never a sheet on top of a sheet.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import Button from '@/components/ui/Button'
import Icon from '@/components/ui/Icon'
import type { AdminItemKind, AdminSearch } from '../contract.ts'
import Sheet from '../ui/Sheet.tsx'
import { SearchField } from '../ui/bits.tsx'
import { EmptyState, ErrorState, Skeleton } from '../ui/states.tsx'
import { JobProgress } from '../ui/Job.tsx'
import { Loadable } from './Boundary.tsx'
import { ITEM_LABEL, ITEM_VIEWS, type ItemViewProps } from './items.tsx'
import { useAdminJobs, useRuntime } from './hooks.tsx'
import LoginForm, { signedInUser } from './LoginForm.tsx'
import { afterSheetClose, type ItemPlace } from './place.ts'
import { SECTIONS } from './sections.tsx'
import type { PanelSpec, ShellApi } from './shellContext.ts'
import styles from './shell.module.css'

export function ItemNotFound({ kind, id, detail }: { kind?: AdminItemKind; id?: string; detail?: string }) {
  return (
    <EmptyState
      icon="circle-slash"
      title={kind ? `${ITEM_LABEL[kind]} not found.` : 'Nothing to open at this link.'}
      body={detail || (id ? `Nothing with the id “${id}” exists, or it was deleted.` : 'The link names something the admin does not know.')}
    />
  )
}

function ItemBody({ place, shell, setTitle }: { place: ItemPlace; shell: ShellApi; setTitle: (t: string, d?: string) => void }) {
  const p = place.parsed
  if (!p.ok) {
    return <ItemNotFound detail={p.reason === 'unknown_kind' ? `“${p.raw}” is not something the admin can open.` : 'The link is missing the item’s id.'} />
  }
  const load = ITEM_VIEWS[p.ref.kind]
  if (!load) return <ItemNotFound kind={p.ref.kind} detail={`${ITEM_LABEL[p.ref.kind]}s cannot be opened in the new admin yet — the legacy admin still has them.`} />
  const props: ItemViewProps = { kind: p.ref.kind, id: p.ref.id, close: place.close, open: shell.openItem, setTitle }
  return <Loadable key={`${p.ref.kind}:${p.ref.id}`} load={load} props={props} what={`this ${ITEM_LABEL[p.ref.kind].toLowerCase()}`} />
}

// ── Global search: one box for an email, a company, a listing id or link, a report id ─────────────

function SearchPanel({ onPick }: { onPick: (kind: AdminItemKind, id: string) => void }) {
  const { api } = useRuntime()
  const [q, setQ] = useState('')
  const [state, setState] = useState<{ q: string; loading: boolean; res?: AdminSearch; error?: string }>({ q: '', loading: false })
  const [idx, setIdx] = useState(0)
  const seq = useRef(0)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { const t = setTimeout(() => input.current?.focus(), 30); return () => clearTimeout(t) }, [])
  useEffect(() => {
    const term = q.trim()
    if (term.length < 2) { setState({ q: term, loading: false }); return }
    const my = ++seq.current
    setState((s) => ({ ...s, q: term, loading: true, error: undefined }))
    const t = setTimeout(async () => {
      const res = await api<AdminSearch>('search', { q: term })
      if (my !== seq.current) return
      if (res.ok) { setState({ q: term, loading: false, res: res as AdminSearch }); setIdx(0) }
      else setState({ q: term, loading: false, error: res.error })
    }, 250)
    return () => clearTimeout(t)
  }, [q, api])
  const results = state.res?.results || []
  return (
    <div className={styles.searchPanel}>
      <SearchField ref={input} value={q} onChange={setQ} label="Search the admin" placeholder="Email, company, listing id or link, report id" testId="search-input"
        onEnter={() => { const r = results[idx]; if (r) onPick(r.kind, r.id) }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(results.length - 1, i + 1)) }
          if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)) }
        }} />
      <div className={styles.searchResults} aria-live="polite">
        {state.q.length < 2 ? <p className={styles.searchHint}>Type at least two characters. Search looks at account emails, company names, listing ids and links, and report ids.</p>
          : state.error ? <ErrorState what="search results" error={state.error} />
          : state.loading && !state.res ? <Skeleton rows={3} label="Searching" />
          : !results.length ? <p className={styles.searchHint} data-testid="search-empty">Nothing matches “{state.q}”.</p>
          : (
            <ul className={styles.resultList} role="listbox" aria-label="Results">
              {results.map((r, i) => (
                <li key={`${r.kind}:${r.id}`} role="option" aria-selected={i === idx}>
                  <button type="button" className={styles.result} data-active={i === idx || undefined} onClick={() => onPick(r.kind, r.id)} onMouseEnter={() => setIdx(i)} data-testid="search-result">
                    <span className={styles.resultKind}>{ITEM_LABEL[r.kind] || r.kind}</span>
                    <span className={styles.resultTitle}>{r.title}</span>
                    {r.sub ? <span className={styles.resultSub}>{r.sub}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
      </div>
    </div>
  )
}

function MorePanel({ shell, close }: { shell: ShellApi; close: () => void }) {
  const items = SECTIONS.filter((s) => s.phone === 'more')
  return (
    <div className={styles.moreList}>
      {items.map((s) => (
        <button key={s.key} type="button" className={styles.moreItem} aria-current={shell.section === s.key ? 'page' : undefined} data-testid={`more-${s.key}`}
          onClick={() => { close(); afterSheetClose(() => shell.goSection(s.key)) }}>
          <Icon name={s.icon} size={20} /><span>{s.label}</span><Icon name="chevron-right" size={18} className={styles.moreChevron} />
        </button>
      ))}
      <a href="/admin/legacy" className={styles.moreItem}><Icon name="arrow-up-right" size={20} /><span>Legacy admin</span></a>
      <div className={styles.moreWho}>
        <span>Signed in as {shell.username || 'admin'}</span>
        <Button variant="ghost" onClick={() => { close(); shell.signOut() }} data-testid="more-signout">Sign out</Button>
      </div>
    </div>
  )
}

function JobsPanel({ focus }: { focus?: string }) {
  const { jobs } = useRuntime()
  const list = useAdminJobs()
  if (!list.length) return <EmptyState icon="list-checks" title="No jobs." body="Long jobs (clearing stale listings, removing duplicates) show their progress here while they run." />
  return (
    <div className={styles.jobsList}>
      {[...list].reverse().map((j) => (
        <div key={j.id} data-focused={j.id === focus || undefined}>
          <JobProgress job={j} onCancel={() => jobs.cancel(j.id)} onResume={() => jobs.resume(j.id)} onDismiss={() => jobs.dismiss(j.id)} />
        </div>
      ))}
    </div>
  )
}

export default function SheetHost({ place, panel, setPanel, shell }: { place: ItemPlace; panel: PanelSpec | null; setPanel: (p: PanelSpec | null) => void; shell: ShellApi }) {
  const { gate } = useRuntime()
  const waiting = useSyncExternalStore(gate.subscribe, gate.isWaiting, () => false)
  const [title, setTitleState] = useState<{ key: string; t: string; d?: string } | null>(null)
  const itemKey = place.raw
  const setTitle = useCallback((t: string, d?: string) => setTitleState({ key: itemKey, t, d }), [itemKey])
  const closePanel = useCallback(() => setPanel(null), [setPanel])

  const layer: 'session' | 'panel' | 'item' | null = waiting ? 'session' : panel ? 'panel' : place.raw ? 'item' : null
  const p = place.parsed
  const itemTitle = title && title.key === itemKey ? title.t : p.ok ? `${ITEM_LABEL[p.ref.kind]}` : 'Not found'
  const itemDesc = title && title.key === itemKey ? title.d : p.ok ? `id ${p.ref.id}` : undefined

  const head = useMemo(() => {
    if (layer === 'session') return { t: 'Session ended', d: 'Sign in again to continue. Whatever you just pressed finishes after you sign in.' }
    if (layer === 'panel' && panel) {
      if (panel.kind === 'search') return { t: 'Search', d: undefined }
      if (panel.kind === 'more') return { t: 'More', d: undefined }
      if (panel.kind === 'jobs') return { t: 'Jobs', d: 'They keep running while you work elsewhere in the admin.' }
      return { t: panel.title, d: panel.description }
    }
    return { t: itemTitle, d: itemDesc }
  }, [layer, panel, itemTitle, itemDesc])

  const onClose = useCallback(() => {
    if (layer === 'session') gate.settle(false)
    else if (layer === 'panel') closePanel()
    else if (layer === 'item') place.close()
  }, [layer, gate, closePanel, place])

  return (
    <Sheet open={!!layer} onClose={onClose} urlBacked={layer === 'item'} title={head.t} description={head.d} testId={`sheet-${layer || 'none'}`}>
      {place.raw ? (
        <div hidden={layer !== 'item'} className={styles.itemWrap}>
          <ItemBody place={place} shell={shell} setTitle={setTitle} />
        </div>
      ) : null}
      {layer === 'panel' && panel?.kind === 'search' ? <SearchPanel onPick={(k, id) => { closePanel(); afterSheetClose(() => shell.openItem(k, id)) }} /> : null}
      {layer === 'panel' && panel?.kind === 'more' ? <MorePanel shell={shell} close={closePanel} /> : null}
      {layer === 'panel' && panel?.kind === 'jobs' ? <JobsPanel focus={panel.focus} /> : null}
      {layer === 'panel' && panel?.kind === 'custom' ? panel.render(closePanel) : null}
      {layer === 'session' ? (
        <div className={styles.sessionBody}>
          <LoginForm initialUser={signedInUser()} submitLabel="Sign in and continue" onSignedIn={() => gate.settle(true)} />
          <Button variant="ghost" full onClick={() => gate.settle(false)} data-testid="session-cancel">Stay signed out</Button>
        </div>
      ) : null}
    </Sheet>
  )
}

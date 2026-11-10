'use client'

// Review (audit §3.1): ONE inbox of decisions. The kinds are chips with live counts (`?review.kind=`);
// a kind with nothing waiting is still a chip, just quiet; a count that could not be read says so.
// Each kind is a list whose rows open a sheet (`?item=<kind>:<id>`) and whose actions go through the
// core's one action pipeline — rows change in place, a result line says exactly what happened, Undo
// where the server offers it, nothing reloads. Kinds already visited stay mounted (hidden), so a
// selection or a half-done confirm survives a trip to another kind.
import { useEffect, useState } from 'react'
import Button from '@/components/ui/Button'
import type { AdminList, AdminOverview } from '../../contract.ts'
import { useAdminList, useAdminQuery, useApi } from '../../core/hooks.tsx'
import { useUrlFilter } from '../../core/place.ts'
import type { SectionProps } from '../../core/sections.tsx'
import { useShell } from '../../core/shellContext.ts'
import { SectionHeader } from '../../ui/bits.tsx'
import { RefreshFailed } from '../../ui/states.tsx'
import { KINDS, kindCount, parseKind, reviewQueues, waitingLine, type HeldRow, type KindKey } from './adapter.ts'
import DupesPanel from './DupesPanel.tsx'
import HeldPanel, { HELD_SORTS } from './HeldPanel.tsx'
import KindPanel from './KindPanel.tsx'
import { KIND_CONFIGS } from './kinds.tsx'
import { KindChips } from './parts.tsx'
import RecentPanel from './RecentPanel.tsx'
import styles from './review.module.css'

export default function ReviewSection({ active }: SectionProps) {
  const api = useApi()
  const shell = useShell()
  const [kindRaw, setKindRaw] = useUrlFilter('review', 'kind', 'held')
  const kind = parseKind(kindRaw)
  const [, setQ] = useUrlFilter('review', 'q', '')
  const [, setStatus] = useUrlFilter('review', 'status', '')
  const [sortRaw, setSortRaw] = useUrlFilter('review', 'sort', 'needs_eyes')
  const sort = HELD_SORTS.includes(sortRaw) ? sortRaw : 'needs_eyes'
  const [visited, setVisited] = useState<Set<KindKey>>(() => new Set([kind]))
  useEffect(() => { setVisited((v) => (v.has(kind) ? v : new Set([...v, kind]))) }, [kind])

  const overview = useAdminQuery<AdminOverview>('overview', () => api<AdminOverview>('overview'), { staleMs: 30_000, refetchOnFocus: active })
  // The held list is the main queue: read once for its exact count, shared with its panel.
  const held = useAdminList<HeldRow>(`held?sort=${sort}`, () => api<AdminList<HeldRow>>('list_held_reports', { sort }, { timeoutMs: 45_000 }), { staleMs: 20_000 })
  const heldTotal = held.data ? (typeof held.total === 'number' ? held.total : held.rows.length) : undefined

  // ONE number per thing, from ONE read: every count here comes from the same `overview` the shell's Review
  // badge reads (the held list's own total only stands in until that read lands).
  const chips = KINDS.map((k) => ({ key: k.key, label: k.label, count: kindCount(k.key, overview.data, overview.data ? undefined : heldTotal) }))
  const queues = reviewQueues(overview.data)
  const sub = overview.data ? waitingLine(queues) : overview.loading ? 'Counting what is waiting…' : overview.error ? 'The waiting counts couldn’t be read.' : undefined

  const setKind = (k: KindKey) => {
    if (k === kind) return
    setKindRaw(k)
    setQ('')
    setStatus('')
  }
  const fetching = (overview.fetching && !!overview.data) || (held.fetching && !!held.data)
  const refreshAll = () => { void overview.refresh(); if (kind === 'held') void held.refresh() }

  return (
    <div className={styles.review} data-testid="section-review">
      <SectionHeader
        title="Review"
        sub={sub}
        fetching={fetching}
        actions={<Button variant="ghost" icon="refresh-cw" onClick={refreshAll} disabled={overview.fetching} data-testid="review-refresh">Refresh counts</Button>}
      />
      <RefreshFailed error={overview.data ? overview.error : undefined} onRetry={() => void overview.refresh()} />
      <KindChips chips={chips} value={kind} onChange={setKind} />
      {KINDS.filter((k) => visited.has(k.key)).map((k) => {
        const on = k.key === kind
        const visible = on && active && !shell.sheetOpen
        const cfg = KIND_CONFIGS[k.key]
        return (
          <div key={k.key} hidden={!on} data-kind={k.key}>
            {k.key === 'held' ? <HeldPanel on={on} visible={visible} list={held} sort={sort} setSort={(s) => setSortRaw(s === 'needs_eyes' ? '' : s)} />
              : k.key === 'recent' ? <RecentPanel on={on} visible={visible} />
                : k.key === 'dupes' ? <DupesPanel />
                  : cfg ? <KindPanel cfg={cfg} on={on} visible={visible} /> : null}
          </div>
        )
      })}
    </div>
  )
}

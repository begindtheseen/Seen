'use client'

// One list for any of the seven smaller kinds (kinds.tsx): status filter + search in the URL, rows that
// say what a decision needs, the kind's real actions inline (a confirm step in the row when the action
// has an outside effect and no Undo), the result line with Undo, and the row opening its sheet.
import { useMemo, useRef, useState } from 'react'
import Button from '@/components/ui/Button'
import type { AdminList } from '../../contract.ts'
import type { AdminApi } from '../../core/api.ts'
import type { ActionView } from '../../core/hooks.tsx'
import { useAdminAction, useAdminList, useApi } from '../../core/hooks.tsx'
import { useUrlFilter } from '../../core/place.ts'
import { useShell } from '../../core/shellContext.ts'
import { SearchField } from '../../ui/bits.tsx'
import ConfirmStep from '../../ui/ConfirmStep.tsx'
import { List, Row, RowActions } from '../../ui/List.tsx'
import { EmptyState } from '../../ui/states.tsx'
import { matchesQuery } from './adapter.ts'
import { listKey, type KAction, type KindConfig } from './kinds.tsx'
import { Chips, Choice, CursorRow, KeysHint, Meta, Line } from './parts.tsx'
import { useClaimsApi, useEndpointAction, useListKeys } from './reviewHooks.tsx'
import styles from './review.module.css'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRow = any

/** One action runner per distinct action of a kind (the list is fixed per kind, so hook order is stable). */
export function useKindActions(cfg: KindConfig<AnyRow>, opts: { onLeave?: (id: string) => void; leaveKey?: () => string | null; onSettled?: () => void } = {}) {
  const claimsApi = useClaimsApi()
  const names = useMemo(() => [...new Set(cfg.actions.map((a) => `${a.claims ? 'claims:' : ''}${a.action}`))], [cfg])
  const pendingLeave = useRef<{ id: string } | null>(null)
  const optsRef = useRef(opts)
  optsRef.current = opts
  const out: Record<string, ActionView> = {}
  for (const n of names) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    out[n] = useKindAction(n.startsWith('claims:') ? claimsApi : null, n.replace(/^claims:/, ''), {
      optimistic: (tx) => {
        const leave = pendingLeave.current
        pendingLeave.current = null
        const key = optsRef.current.leaveKey?.()
        if (leave && key) tx.removeRows(key, [leave.id])
      },
      onSettled: () => optsRef.current.onSettled?.(),
    })
  }
  const runnerFor = (a: KAction<AnyRow>) => out[`${a.claims ? 'claims:' : ''}${a.action}`]
  const run = (a: KAction<AnyRow>, row: AnyRow, note = '') => {
    const id = cfg.idOf(row)
    pendingLeave.current = a.decides ? { id } : null
    return runnerFor(a).run(a.args(row, note.trim()), id)
  }
  const busy = (row: AnyRow) => Object.values(out).some((r) => r.busy(cfg.idOf(row)))
  return { runnerFor, run, busy, all: out }
}

function useKindAction(api: AdminApi | null, action: string, options: Parameters<typeof useAdminAction>[1]) {
  // Both branches are hooks with the same shape; `api` is fixed for a given action name.
  const shellApi = useApi()
  return useEndpointAction(api || shellApi, action, options)
}

export default function KindPanel({ cfg, on, visible }: { cfg: KindConfig<AnyRow>; on: boolean; visible: boolean }) {
  const api = useApi()
  const claimsApi = useClaimsApi()
  const shell = useShell()
  const [statusRaw, setStatus] = useUrlFilter('review', 'status', cfg.waiting)
  // The URL's status and search belong to the kind on screen; a hidden panel keeps its waiting list.
  const status = on && cfg.statuses.some((s) => s.value === statusRaw) ? statusRaw : cfg.waiting
  const [qRaw, setQ] = useUrlFilter('review', 'q', '')
  const q = on ? qRaw : ''
  const searchRef = useRef<HTMLInputElement>(null)
  const [confirming, setConfirming] = useState<{ id: string; key: string } | null>(null)
  const [last, setLast] = useState<{ id: string; name: string } | null>(null)
  const fetchStatus = cfg.clientFilter ? 'all' : status
  const key = listKey(cfg, fetchStatus)
  const list = useAdminList<AnyRow>(key, ({ after }) => (cfg.claims ? claimsApi : api)<AdminList<AnyRow>>(cfg.listAction, cfg.body(fetchStatus, after)), { staleMs: 20_000, idOf: cfg.idOf })
  const acts = useKindActions(cfg, {
    leaveKey: () => (status === cfg.waiting ? key : null),
    onSettled: () => setConfirming(null),
  })

  const byStatus = cfg.clientFilter ? list.rows.filter((r: AnyRow) => cfg.clientFilter!(r, status)) : list.rows
  const rows = byStatus.filter((r: AnyRow) => matchesQuery(cfg.search(r), q))
  const searching = !!q.trim()

  const doAction = (a: KAction<AnyRow>, r: AnyRow) => {
    const id = cfg.idOf(r)
    if (a.confirm && !(confirming && confirming.id === id && confirming.key === a.key)) { setConfirming({ id, key: a.key }); return }
    setLast({ id, name: `${a.claims ? 'claims:' : ''}${a.action}` })
    void acts.run(a, r)
  }
  const hot = (h: 'a' | 'r') => (id: string) => {
    const r = rows.find((x: AnyRow) => cfg.idOf(x) === id)
    const a = r && cfg.actions.find((x) => x.hotkey === h && (!x.when || x.when(r)))
    if (r && a) doAction(a, r)
  }
  const keys = useListKeys({
    enabled: visible,
    ids: rows.map((r: AnyRow) => cfg.idOf(r)),
    onOpen: (id) => shell.openItem(cfg.item, id),
    onApprove: hot('a'),
    onReject: hot('r'),
    onUndo: () => { if (last) acts.all[last.name]?.undo(last.id) },
    searchRef,
  })

  return (
    <div className={styles.panel} data-testid={`panel-${cfg.kind}`}>
      <div className={styles.toolbar}>
        <Choice label="Status" options={cfg.statuses.map((s) => ({ ...s, count: s.value === status && !searching && !list.loading ? byStatus.length : undefined }))} value={status} onChange={(v) => setStatus(v === cfg.waiting ? '' : v)} testId={`${cfg.kind}-status`} />
        <SearchField ref={searchRef} value={q} onChange={setQ} label={`Search ${cfg.noun}`} placeholder={`Search ${cfg.noun}`} testId={`${cfg.kind}-search`} />
        <KeysHint keys={[['j k', 'move'], ['Enter', 'open'], ['a', 'approve'], ['r', 'reject'], ['u', 'undo'], ['/', 'search this list']]} />
      </div>
      {searching && byStatus.length ? (
        <p className={styles.note} data-testid={`${cfg.kind}-filter-note`}>
          {`${rows.length.toLocaleString('en-US')} of the ${byStatus.length.toLocaleString('en-US')} loaded ${cfg.noun} match “${q.trim()}”${list.hasMore ? ' — more are not loaded yet; Load more to search them too.' : ' — every one in this list is loaded.'}`}
        </p>
      ) : null}
      <List<AnyRow>
        rows={rows}
        idOf={cfg.idOf}
        noun={cfg.noun}
        loading={list.loading}
        error={list.error}
        onRetry={() => void list.refresh()}
        total={searching || cfg.clientFilter ? undefined : list.total}
        hasMore={list.hasMore}
        loadingMore={list.loadingMore}
        onLoadMore={() => void list.loadMore()}
        newCount={list.newCount}
        onShowNew={list.showNew}
        empty={<EmptyState icon={searching ? 'search' : 'circle-check'} title={searching ? `No ${cfg.noun} match “${q.trim()}”.` : cfg.empty(status)} />}
        renderRow={(r: AnyRow) => {
          const id = cfg.idOf(r)
          const shown = cfg.actions.filter((a) => a.inRow !== false && (!a.when || a.when(r)))
          const conf = confirming && confirming.id === id ? cfg.actions.find((a) => a.key === confirming.key) : null
          const errored = Object.entries(acts.all).find(([, v]) => v.state(id).status === 'error')
          const busy = acts.busy(r)
          return (
            <CursorRow id={id} cursor={keys.cursor === id}>
              <Row
                testId={`${cfg.kind}-row-${id}`}
                title={cfg.title(r)}
                onOpen={() => shell.openItem(cfg.item, id)}
                sub={cfg.sub(r)}
                status={<Chips items={cfg.chips(r)} />}
                meta={<Meta parts={cfg.meta(r)} />}
                pending={busy}
                actions={shown.length ? (
                  <RowActions>
                    {shown.map((a, i) => (
                      <Button key={a.key} variant={a.variant || (i === 0 ? 'secondary' : 'ghost')} onClick={() => doAction(a, r)} disabled={busy || !!conf} data-testid={`${cfg.kind}-${a.key}-${id}`}>
                        {a.label}
                      </Button>
                    ))}
                  </RowActions>
                ) : undefined}
                below={conf && conf.confirm ? (
                  <ConfirmStep inline {...conf.confirm(r)} busy={busy} onCancel={() => setConfirming(null)} onConfirm={() => { setLast({ id, name: `${conf.claims ? 'claims:' : ''}${conf.action}` }); void acts.run(conf, r) }} />
                ) : errored ? (
                  <Line state={errored[1].state(id)} onRetry={() => errored[1].retry(id)} onDismiss={() => errored[1].dismiss(id)} />
                ) : undefined}
              />
            </CursorRow>
          )
        }}
      />
    </div>
  )
}

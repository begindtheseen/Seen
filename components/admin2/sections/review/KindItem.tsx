'use client'

// The sheet for a listing ticket, Reddit dispute, employer claim, employer reply, purchase, data issue
// or account cluster (`?item=<kind>:<id>`). None of these has a per-item read on the server, so the
// sheet reads the kind's full list (every status) and finds the row — instantly from any list already
// on screen, then confirmed by the read. Every action of the kind is here, with its confirm step INSIDE
// the sheet, an optional note where the server takes one, and the result line with Undo.
import { useEffect, useMemo, useRef, useState } from 'react'
import Button from '@/components/ui/Button'
import type { AdminList } from '../../contract.ts'
import { useAdminList, useApi, useRuntime } from '../../core/hooks.tsx'
import type { ItemViewProps } from '../../core/items.tsx'
import { ItemNotFound } from '../../core/SheetHost.tsx'
import ConfirmStep from '../../ui/ConfirmStep.tsx'
import { ErrorState, RefreshFailed, Skeleton } from '../../ui/states.tsx'
import { CONFIG_BY_ITEM, listKey, type KAction, type KindConfig } from './kinds.tsx'
import { useKindActions } from './KindPanel.tsx'
import { Chips, Line } from './parts.tsx'
import { useClaimsApi } from './reviewHooks.tsx'
import styles from './review.module.css'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRow = any
const MAX_PAGES = 10

export default function KindItem(props: ItemViewProps) {
  const cfg = CONFIG_BY_ITEM[props.kind]
  if (!cfg) return <ItemNotFound kind={props.kind} id={props.id} />
  return <KindItemBody {...props} cfg={cfg} />
}

function KindItemBody({ kind, id, setTitle, open, cfg }: ItemViewProps & { cfg: KindConfig<AnyRow> }) {
  const api = useApi()
  const claimsApi = useClaimsApi()
  const { cache } = useRuntime()
  const allKey = listKey(cfg, 'all')
  const list = useAdminList<AnyRow>(allKey, ({ after }) => (cfg.claims ? claimsApi : api)<AdminList<AnyRow>>(cfg.listAction, cfg.body('all', after)), { staleMs: 10_000, idOf: cfg.idOf })
  const fromList = list.rows.find((r: AnyRow) => cfg.idOf(r) === id)
  // A row already on screen in another list of this kind shows at once, while the full read lands.
  const cached = useMemo(() => {
    if (fromList) return null
    for (const k of cache.keys()) {
      if (!k.startsWith(`${cfg.prefix}?`)) continue
      const rows = (cache.get<{ rows?: AnyRow[] }>(k).data?.rows) || []
      const hit = rows.find((r: AnyRow) => cfg.idOf(r) === id)
      if (hit) return hit
    }
    return null
  }, [cache, cfg, id, fromList])
  const row = fromList || cached
  // A paged list (data issues) may hold the row past the first page: read on, up to ten pages.
  const pages = useRef(0)
  useEffect(() => {
    if (fromList || !list.hasMore || list.loadingMore || list.fetching || pages.current >= MAX_PAGES) return
    pages.current += 1
    void list.loadMore()
  }, [fromList, list])

  const [note, setNote] = useState('')
  const [confirming, setConfirming] = useState<string | null>(null)
  const [lastName, setLastName] = useState<string | null>(null)
  const acts = useKindActions(cfg, { leaveKey: () => listKey(cfg, cfg.waiting), onSettled: () => setConfirming(null) })

  const statusWord = row ? (cfg.chips(row).find(Boolean)?.label || '') : ''
  useEffect(() => { if (row) setTitle(cfg.title(row), statusWord ? `${cfg.one} · ${statusWord.toLowerCase()}` : cfg.one) }, [row, cfg, setTitle, statusWord])

  if (!row && (list.loading || list.loadingMore || (list.hasMore && pages.current < MAX_PAGES && !list.error))) return <Skeleton rows={4} label={`Reading this ${cfg.one}`} />
  if (!row && list.error) return <ErrorState what={`this ${cfg.one}`} error={list.error} onRetry={() => void list.refresh()} retrying={list.fetching} />
  if (!row) return <ItemNotFound kind={kind} id={id} detail={list.hasMore ? `Searched the newest ${list.rows.length} ${cfg.noun}.` : undefined} />

  const available = cfg.actions.filter((a) => !a.when || a.when(row))
  const conf = confirming ? cfg.actions.find((a) => a.key === confirming) : null
  const takesNote = available.some((a) => a.note)
  const busy = acts.busy(row)
  const press = (a: KAction<AnyRow>) => {
    if (a.confirm && confirming !== a.key) { setConfirming(a.key); return }
    setLastName(`${a.claims ? 'claims:' : ''}${a.action}`)
    void acts.run(a, row, note)
  }
  const last = lastName ? acts.all[lastName] : null

  return (
    <div className={styles.item} data-testid={`${cfg.kind}-item`}>
      <RefreshFailed error={list.error} onRetry={() => void list.refresh()} />
      <Chips items={cfg.chips(row)} />
      {cfg.detail(row)}
      {cfg.kind === 'issues' && row.target_type === 'company' && row.target_name ? (
        <Button variant="ghost" iconRight="arrow-right" onClick={() => open('company', String(row.target_name))} data-testid="issue-open-company">Open {String(row.target_name)}</Button>
      ) : null}
      {takesNote ? (
        <label className={styles.field}>
          <span>{cfg.noteLabel || 'Note (optional)'}</span>
          <textarea className="ui-input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} data-testid={`${cfg.kind}-note`} />
        </label>
      ) : null}
      {last ? <Line state={last.state(id)} onUndo={() => last.undo(id)} onRetry={() => last.retry(id)} onDismiss={() => { last.dismiss(id); setLastName(null) }} /> : null}
      {conf && conf.confirm ? (
        <ConfirmStep {...conf.confirm(row)} busy={busy} onCancel={() => setConfirming(null)} onConfirm={() => press(conf)} />
      ) : available.length ? (
        <div className={styles.itemActions}>
          {available.map((a, i) => (
            <Button key={a.key} variant={a.variant === 'danger' ? 'danger' : i === 0 ? 'secondary' : 'ghost'} onClick={() => press(a)} loading={busy && lastName === `${a.claims ? 'claims:' : ''}${a.action}`} disabled={busy} data-testid={`${cfg.kind}-item-${a.key}`}>
              {a.label}
            </Button>
          ))}
        </div>
      ) : (
        <p className={styles.note}>Nothing left to decide here.</p>
      )}
    </div>
  )
}

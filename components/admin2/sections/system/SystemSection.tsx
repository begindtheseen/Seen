'use client'

// System (audit §3.1): one row per scheduled job (schedule in words, last run in California time, result,
// next run; "No run recorded yet" where nothing records it), errors by route, database size, the feature
// flags code actually reads, the activity log with Undo, and the revenue detail (one-time purchases only).
import { useMemo, useRef, useState, type MutableRefObject } from 'react'
import { formatPacific } from '@/lib/time/pacific'
import Button from '@/components/ui/Button'
import type { AdminList } from '../../contract.ts'
import { useAdminAction, useAdminJob, useAdminList, useAdminQuery, useApi } from '../../core/hooks.tsx'
import { useUrlFilter } from '../../core/place.ts'
import type { SectionProps } from '../../core/sections.tsx'
import { useShell } from '../../core/shellContext.ts'
import type { AdminItemKind } from '../../contract.ts'
import { FilterChips, KeyHint, SectionHeader, StatusChip } from '../../ui/bits.tsx'
import ConfirmStep from '../../ui/ConfirmStep.tsx'
import { JobProgress } from '../../ui/Job.tsx'
import { List, Row } from '../../ui/List.tsx'
import ResultLine from '../../ui/ResultLine.tsx'
import { EmptyState, ErrorState, RefreshFailed, Skeleton } from '../../ui/states.tsx'
import { useSectionKeys } from '../listings/sectionKeys.ts'
import styles from '../listings/listings.module.css'
import {
  ACTION_FILTERS, canOpen, cronInWords, cronLines, cronState, cronSummary, dangerConsequence, flagDoes, flagEnv, flagIsOn, flagStateWords,
  fmt, money, readActivity, readCron, readFlags, readFunnel, readRevenue, readRoutes, type ActivityRow, type CronRow, type Flag,
} from './adapter.ts'

export default function SystemSection({ active }: SectionProps) {
  const shell = useShell()
  const flagsUndo = useRef<(() => void) | null>(null)
  useSectionKeys({ active, sheetOpen: shell.sheetOpen, onUndo: () => flagsUndo.current?.() })
  return (
    <div className={styles.wrap} data-testid="section-system">
      <SectionHeader title="System" sub="Scheduled jobs, errors, database size, feature flags, everything admins did, and revenue." />
      <CronsBlock />
      <ErrorsBlock />
      <StorageBlock />
      <FlagsBlock undoRef={flagsUndo} />
      <ActivityBlock />
      <RevenueBlock />
    </div>
  )
}

// ── Scheduled jobs ───────────────────────────────────────────────────────────────────────────────
function CronsBlock() {
  const api = useApi()
  const q = useAdminList<CronRow>('crons', async () => {
    const res = await api<AdminList<Record<string, unknown>>>('cron_health')
    return res.ok ? { ...res, rows: (res.rows || []).map(readCron), next: undefined } : res
  }, { staleMs: 60_000, idOf: (c) => c.path || c.name })
  return (
    <section className={styles.block} aria-labelledby="sy-crons" data-testid="sy-crons">
      <div className={styles.blockHead}>
        <h2 id="sy-crons" className={styles.h2}>Scheduled jobs</h2>
        <Button variant="ghost" icon="refresh-cw" onClick={() => void q.refresh()} disabled={q.fetching}>Re-read</Button>
      </div>
      {q.loading ? <Skeleton rows={4} label="Reading the scheduled jobs" /> : null}
      {q.error && !q.data ? <ErrorState what="the scheduled jobs" error={q.error} onRetry={() => void q.refresh()} retrying={q.fetching} /> : null}
      {q.data ? (
        <>
          <RefreshFailed error={q.error} onRetry={() => void q.refresh()} />
          <p className={styles.text} data-testid="sy-crons-summary">{cronSummary(q.rows)} Times are California time.</p>
          <ul className={styles.table} aria-label="Scheduled jobs">
            {q.rows.map((c) => {
              const st = cronState(c)
              return (
                <li key={c.path || c.name} className={st.tone === 'bad' ? `${styles.tr} ${styles.trBad}` : styles.tr} data-testid={`cron-${c.name}`}>
                  <span className={styles.trName}>{c.name}<span className={styles.quiet}><br />{cronInWords(c.schedule)}</span></span>
                  <span className={styles.trBody}>
                    {cronLines(c).map((l) => <span key={l}>{l}</span>)}
                    {c.detail ? <span className={styles.quiet}>{c.detail}</span> : null}
                  </span>
                  <span className={styles.trSide}><StatusChip tone={st.tone} label={st.word} icon={st.tone === 'neutral' ? 'circle-help' : undefined} /></span>
                </li>
              )
            })}
          </ul>
        </>
      ) : null}
    </section>
  )
}

// ── Errors by route ──────────────────────────────────────────────────────────────────────────────
type ErrRow = { id: string; endpoint: string; error_msg: string; created_at: string; ref: string | null }
function ErrorsBlock() {
  const api = useApi()
  const [route, setRoute] = useUrlFilter('system', 'route', '')
  const routes = useAdminQuery<Record<string, unknown>>('errors:routes', () => api<Record<string, unknown>>('errors_list', { limit: 1 }), { staleMs: 60_000 })
  const byRoute = routes.data ? readRoutes(routes.data) : null
  const list = useAdminList<ErrRow>(`errors?route=${route}`, ({ after }) => api<AdminList<ErrRow>>('errors_list', { endpoint: route || undefined, after: after || undefined, limit: 25 }), { staleMs: 60_000 })
  const max = Math.max(1, ...(byRoute?.routes.map((r) => r.count) || [1]))
  return (
    <section className={styles.block} aria-labelledby="sy-errors" data-testid="sy-errors">
      <div className={styles.blockHead}><h2 id="sy-errors" className={styles.h2}>Errors</h2></div>
      {routes.loading ? <Skeleton rows={2} label="Counting errors" /> : null}
      {routes.error && !routes.data ? <ErrorState what="the error counts" error={routes.error} onRetry={() => void routes.refresh()} /> : null}
      {routes.data ? (
        byRoute === null ? <p className={styles.quiet}>The last 24 hours could not be counted by route (too many to read, or the read failed). The list below still shows each error.</p>
          : !byRoute.routes.length ? <p className={styles.text}>No errors in the last 24 hours.</p>
          : (
            <>
              <p className={styles.text}><span className={styles.strong}>{byRoute.total === null ? 'Errors' : `${fmt(byRoute.total)} ${byRoute.total === 1 ? 'error' : 'errors'}`} in the last 24 hours</span>, by the server route that logged them. Tap a route to list only its errors.</p>
              <ul className={styles.lines} aria-label="Errors by route">
                {byRoute.routes.slice(0, 10).map((r) => (
                  <li key={r.route} className={styles.barRow}>
                    <button type="button" className={styles.linkBtn} onClick={() => setRoute(route === r.route ? '' : r.route)} aria-pressed={route === r.route}>{r.route}</button>
                    <span className={styles.barNum}>{fmt(r.count)}</span>
                    <span className={styles.barTrack} aria-hidden="true"><span className={styles.barFill} style={{ transform: `scaleX(${r.count / max})` }} /></span>
                  </li>
                ))}
              </ul>
            </>
          )
      ) : null}
      {route ? <div className={styles.actions}><StatusChip tone="info" label={`Only ${route}`} /><Button variant="ghost" icon="x" onClick={() => setRoute('')}>Every route</Button></div> : null}
      <List<ErrRow>
        rows={list.rows} idOf={(e) => e.id} noun="errors" loading={list.loading} error={list.error} onRetry={() => void list.refresh()}
        hasMore={list.hasMore} loadingMore={list.loadingMore} onLoadMore={() => void list.loadMore()} newCount={list.newCount} onShowNew={list.showNew}
        empty={<EmptyState icon="circle-check" title={route ? `No errors logged by ${route}.` : 'No errors logged.'} />}
        renderRow={(e) => <Row title={e.error_msg || 'No message'} sub={`${e.endpoint} · ${e.created_at ? formatPacific(e.created_at) : ''}${e.ref ? ` · ref ${e.ref}` : ''}`} />}
      />
    </section>
  )
}

// ── Database size ────────────────────────────────────────────────────────────────────────────────
function StorageBlock() {
  return (
    <section className={styles.block} aria-labelledby="sy-db" data-testid="sy-db">
      <div className={styles.blockHead}><h2 id="sy-db" className={styles.h2}>Database size</h2><StatusChip tone="neutral" label="Couldn’t read" icon="circle-slash" /></div>
      <p className={styles.text}>The new admin&apos;s server has no read for the database size against the storage guard yet. The <a className={styles.link} href="/admin/legacy">legacy admin</a> shows it under Jobs (same sign-in).</p>
    </section>
  )
}

// ── Feature flags ────────────────────────────────────────────────────────────────────────────────
function FlagsBlock({ undoRef }: { undoRef: MutableRefObject<(() => void) | null> }) {
  const api = useApi()
  const q = useAdminQuery<Record<string, unknown>>('flags', () => api<Record<string, unknown>>('flags_list'), { staleMs: 60_000 })
  const set = useAdminAction('set_flag', { onSettled: (_res, args) => { setConfirm(null); setLast(String(args.flag_name)) } })
  const [confirm, setConfirm] = useState<string | null>(null)
  const [last, setLast] = useState<string | null>(null)
  const view = q.data ? readFlags(q.data) : null
  undoRef.current = last && set.state(last).result?.undo ? () => set.undo(last) : null
  const toggle = (f: Flag, on: boolean) => { void set.run({ flag_name: f.name, status: on ? 'fully_on' : 'off', ...(f.dangerous ? { confirm: f.name } : {}) }, f.name) }
  return (
    <section className={styles.block} aria-labelledby="sy-flags" data-testid="sy-flags">
      <div className={styles.blockHead}>
        <h2 id="sy-flags" className={styles.h2}>Feature flags</h2>
        <div className={styles.keys}><span><KeyHint keys="u" /> undo the last flag change</span></div>
      </div>
      <p className={styles.quiet}>Only flags some code reads. Each is on or off for everyone: the code treats any stored setting other than “off” as on.</p>
      {q.loading ? <Skeleton rows={3} label="Reading the flags" /> : null}
      {q.error && !view ? <ErrorState what="the feature flags" error={q.error} onRetry={() => void q.refresh()} retrying={q.fetching} /> : null}
      {view ? (
        <>
          <RefreshFailed error={q.error} onRetry={() => void q.refresh()} />
          <ul className={styles.lines} aria-label="Flags">
            {view.flags.map((f) => {
              const on = flagIsOn(f)
              const env = flagEnv(f)
              return (
                <li key={f.name} className={`${styles.block}`} data-testid={`flag-${f.name}`}>
                  <div className={styles.blockHead}>
                    <span className={styles.strong}>{f.name}</span>
                    <StatusChip tone={f.dangerous && !on ? 'bad' : on ? 'good' : 'neutral'} label={on ? 'On' : 'Off'} icon={on ? 'circle-check' : 'circle-slash'} />
                  </div>
                  <p className={styles.text}>{flagDoes(f)} Now: {flagStateWords(f)}.</p>
                  <p className={styles.quiet}>
                    Read at {f.readers.join(', ') || 'an unknown place'}.{env ? ` A server setting (${env}) overrides it when present.` : ''}
                    {f.updated_at ? ` Last changed ${formatPacific(f.updated_at)}${f.updated_by ? ` by ${f.updated_by}` : ''}.` : ''}
                  </p>
                  {confirm === f.name ? (
                    <ConfirmStep title={`Turn ${f.name} ${on ? 'off' : 'on'}?`} body={`${dangerConsequence(f, !on)} Undo is offered after.`}
                      confirmLabel={on ? 'Turn it off' : 'Turn it on'} typeToConfirm={f.dangerous ? f.name : undefined} tone="danger" busy={set.busy(f.name)}
                      onCancel={() => setConfirm(null)} onConfirm={() => toggle(f, !on)} />
                  ) : (
                    <div className={styles.actions}>
                      <Button variant={f.dangerous && on ? 'danger' : 'secondary'} onClick={() => setConfirm(f.name)} loading={set.busy(f.name)} data-testid={`flag-toggle-${f.name}`}>
                        {on ? 'Turn off…' : 'Turn on…'}
                      </Button>
                    </div>
                  )}
                  <ResultLine state={set.state(f.name)} onUndo={() => set.undo(f.name)} onRetry={() => set.retry(f.name)} onDismiss={() => set.dismiss(f.name)} runningText="Saving the flag…" />
                </li>
              )
            })}
          </ul>
          {view.unread.length ? (
            <div className={styles.blockFlat} data-testid="sy-flags-unread">
              <h3 className={styles.h2}>Stored but read by no code</h3>
              <p className={styles.quiet}>These rows exist in the feature flag table, but nothing reads them, so changing them would do nothing: {view.unread.join(', ')}.</p>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  )
}

// ── Activity log ─────────────────────────────────────────────────────────────────────────────────
function ActivityBlock() {
  const api = useApi()
  const shell = useShell()
  const [action, setAction] = useUrlFilter('system', 'action', '')
  const [target, setTarget] = useUrlFilter('system', 'target', '')
  const [logins, setLogins] = useUrlFilter('system', 'logins', '')
  const [targetTyped, setTargetTyped] = useState(target)
  const key = `activity?a=${action}&t=${target}&l=${logins}`
  const list = useAdminList<ActivityRow>(key, async ({ after }) => {
    const res = await api<AdminList<Record<string, unknown>>>('activity_log', { filter_action: action || undefined, target: target || undefined, include_logins: logins === '1' || undefined, after: after || undefined, limit: 50 })
    return res.ok ? { ...res, rows: (res.rows || []).map(readActivity) } : res
  }, { staleMs: 20_000 })
  return (
    <section className={styles.block} aria-labelledby="sy-activity" data-testid="sy-activity">
      <div className={styles.blockHead}>
        <h2 id="sy-activity" className={styles.h2}>Activity log</h2>
        <Button variant="ghost" icon="refresh-cw" onClick={() => void list.refresh()} disabled={list.fetching}>Re-read</Button>
      </div>
      <p className={styles.quiet}>Everything an admin did, newest first. A bulk decision shows as one row; its Undo covers every report in it. Undo is offered for 7 days where the change can be reversed.</p>
      <div className={styles.filters}>
        <label className={styles.field}><span>Action</span>
          <select className="ui-input" value={action} onChange={(e) => setAction(e.target.value)} data-testid="act-action">
            {ACTION_FILTERS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select></label>
        <label className={styles.field}><span>About (kind:id, e.g. job:9a1b…)</span>
          <input className="ui-input" value={targetTyped} onChange={(e) => setTargetTyped(e.target.value)} onBlur={() => setTarget(targetTyped.trim())}
            onKeyDown={(e) => { if (e.key === 'Enter') setTarget(targetTyped.trim()) }} autoCapitalize="off" spellCheck={false} data-testid="act-target" /></label>
        <label className={styles.field}><span>Sign-ins</span>
          <select className="ui-input" value={logins} onChange={(e) => setLogins(e.target.value)} data-testid="act-logins">
            <option value="">Hidden (the hourly automated sign-in is most of the log)</option>
            <option value="1">Shown</option>
          </select></label>
      </div>
      <List<ActivityRow>
        rows={list.rows} idOf={(a) => a.id} noun="log entries" loading={list.loading} error={list.error} onRetry={() => void list.refresh()}
        hasMore={list.hasMore} loadingMore={list.loadingMore} onLoadMore={() => void list.loadMore()} newCount={list.newCount} onShowNew={list.showNew}
        empty={<EmptyState icon="list" title="Nothing logged with these filters." />}
        renderRow={(a) => <ActivityItem a={a} onOpen={canOpen(a) ? () => shell.openItem(a.target_kind as AdminItemKind, a.target_id!) : undefined} />}
      />
    </section>
  )
}

function ActivityItem({ a, onOpen }: { a: ActivityRow; onOpen?: () => void }) {
  // An Undo runs as a job: a large one answers in rounds ("Restoring 400 of 1,200"), with progress and Cancel.
  const job = useAdminJob({ action: 'undo', args: { audit_id: a.id }, label: `Undoing: ${a.summary}`, past: 'Put back', noun: 'rows' })
  const [confirm, setConfirm] = useState(false)
  return (
    <Row testId={`act-row-${a.id}`} title={a.summary} onOpen={onOpen}
      sub={`by ${a.admin} · ${a.at ? formatPacific(a.at) : ''}${a.target_kind && a.target_id && !onOpen ? ` · ${a.target_kind} ${a.target_id}` : ''}`}
      actions={a.undoable && !job.job && !confirm ? <Button variant="secondary" icon="undo-2" onClick={() => setConfirm(true)} data-testid={`act-undo-${a.id}`}>Undo</Button> : undefined}
      below={confirm && !job.job ? (
        <ConfirmStep inline title={`Undo “${a.summary}”?`} body="Only rows that still hold what this action wrote are put back; anything changed since is left as it is and counted."
          confirmLabel="Undo it" tone="danger" onCancel={() => setConfirm(false)} onConfirm={() => { setConfirm(false); job.start() }} />
      ) : job.job ? <JobProgress job={job.job} onCancel={job.cancel} onResume={job.resume} onDismiss={job.dismiss} /> : undefined}
    />
  )
}

// ── Revenue ──────────────────────────────────────────────────────────────────────────────────────
function RevenueBlock() {
  const api = useApi()
  const [days, setDays] = useUrlFilter('system', 'days', '30')
  const d = ['7', '30', '90', '365'].includes(days) ? days : '30'
  const q = useAdminQuery<Record<string, unknown>>(`revenue?days=${d}`, () => api<Record<string, unknown>>('revenue_summary', { days: Number(d) }), { staleMs: 120_000 })
  const [showFunnel, setShowFunnel] = useState(false)
  const funnel = useAdminQuery<Record<string, unknown>>(`revenue:funnel?days=${d}`, () => api<Record<string, unknown>>('revenue_funnel', { days: Number(d) }, { timeoutMs: 45_000 }), { enabled: showFunnel, staleMs: 120_000 })
  const r = q.data ? readRevenue(q.data) : null
  const steps = useMemo(() => (funnel.data ? readFunnel(funnel.data) : []), [funnel.data])
  return (
    <section className={styles.block} aria-labelledby="sy-revenue" data-testid="sy-revenue">
      <div className={styles.blockHead}><h2 id="sy-revenue" className={styles.h2}>Revenue</h2></div>
      <FilterChips label="Window" value={d} onChange={(v) => setDays(v === '30' ? '' : v)} options={[{ value: '7', label: '7 days' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' }, { value: '365', label: '1 year' }]} />
      {q.loading ? <Skeleton rows={2} label="Adding up purchases" /> : null}
      {q.error && !r ? <ErrorState what="revenue" error={q.error} onRetry={() => void q.refresh()} retrying={q.fetching} /> : null}
      {r ? (
        <>
          <RefreshFailed error={q.error} onRetry={() => void q.refresh()} />
          <p className={styles.text} data-testid="sy-revenue-total"><span className={styles.strong}>{r.total === null ? 'The total couldn’t be read' : `${money(r.total)} in one-time purchases`}</span> in the last {d === '365' ? 'year' : `${d} days`}. Seen sells no subscriptions.</p>
          <ul className={styles.lines} aria-label="Revenue by product">
            {r.consumer.map((c) => (
              <li key={c.sku} className={styles.lineItem}><span className={styles.lineMain}>{c.name}</span>
                <span className={styles.lineSide}>{c.count === null ? 'couldn’t read' : `${fmt(c.count)} sold · ${c.cents === null ? '' : money(c.cents)}`}</span></li>
            ))}
            <li className={styles.lineItem}><span className={styles.lineMain}>Employer purchases (paid or fulfilled)</span><span className={styles.lineSide}>{r.employer === null ? 'couldn’t read' : money(r.employer)}</span></li>
          </ul>
          <p className={styles.quiet}>Where the numbers come from: {r.source || 'not stated by the server'}.</p>
          <div className={styles.actions}><Button variant="ghost" icon={showFunnel ? 'chevron-down' : 'chevron-right'} onClick={() => setShowFunnel((s) => !s)} aria-expanded={showFunnel} data-testid="sy-funnel-toggle">{showFunnel ? 'Hide the funnel' : 'Show the path to a purchase'}</Button></div>
          {showFunnel ? (
            funnel.loading ? <Skeleton rows={4} label="Reading the funnel" />
              : funnel.error && !funnel.data ? <ErrorState what="the funnel" error={funnel.error} onRetry={() => void funnel.refresh()} />
              : (
                <>
                  <p className={styles.quiet}>Each step counts people or events in the window; “not recorded” means the event table for that step does not exist yet.</p>
                  <ul className={styles.lines} aria-label="Funnel" data-testid="sy-funnel">
                    {steps.map((s) => <li key={s.key} className={styles.lineItem}><span className={styles.lineMain}>{s.label}</span><span className={styles.lineSide}>{s.n === null ? 'not recorded' : fmt(s.n)}</span></li>)}
                  </ul>
                </>
              )
          ) : null}
        </>
      ) : null}
    </section>
  )
}

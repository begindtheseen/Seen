'use client'

import { useState, useEffect, useCallback } from 'react'
import type { AdminStats, RecentReport, Issue, RedditDispute, RedditDisputeCounts, InactiveReport, DupCluster, RecentJob, JobGroup, DupGroup, MergePrefill, MergeLog, FeatureFlag } from './types'
import { Card, CardHeader, Badge, relTime, outcomeColor, availColor, runRefreshAndClear, refreshResultMsg } from './primitives'
import { saveFile } from './saveFile'
import { safeLocalGet, safeLocalSet } from '@/lib/safeStorage'

const ISSUE_TYPE_LABEL: Record<string, string> = {
  wrong_data: 'Wrong data', duplicate: 'Duplicate', broken_listing: 'Broken listing', spam: 'Spam', other: 'Other',
}
function issueBadgeColor(type: string) {
  if (type === 'wrong_data') return 'var(--amber)'
  if (type === 'duplicate' || type === 'spam') return 'var(--red)'
  if (type === 'broken_listing') return 'var(--sub)'
  return 'var(--dim)'
}

// Prominent red alert + one-click auto-remediation when the job board collapses.
// Calls the server-side emergency_job_refresh action, which in turn fires
// /api/refresh-jobs?all=1 (all batches + sources) to backfill listings now.
export function JobCrisisBanner({
  health,
  token,
  onRefresh,
}: {
  health: NonNullable<AdminStats['job_health']>
  token: string
  onRefresh: () => void
}) {
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const stalePct = Math.max(0, 100 - (health.active_pct || 0))

  async function runEmergencyRefresh() {
    setRunning(true)
    setResult(null)
    // Call refresh-jobs DIRECTLY (same-origin, its own 60s budget). Going through
    // /api/admin-stats used to time out: that function caps at 15s but the full
    // all-sources backfill takes ~40s, so the middle-man aborted → "fetch failed".
    // refresh-jobs validates this same admin-session token (X-Admin-Token) itself.
    const r = await runRefreshAndClear(token)
    if (r.ok) {
      setResult({ ok: true, msg: refreshResultMsg(r) })
      // Reload dashboard stats so the banner clears once the board recovers.
      setTimeout(onRefresh, 1500)
    } else {
      setResult({ ok: false, msg: (r.error || 'Refresh failed').slice(0, 120) })
    }
    setRunning(false)
  }

  return (
    <div
      role="alert"
      style={{
        background: 'linear-gradient(90deg, rgba(239,68,68,.16), rgba(239,68,68,.06))',
        border: '1px solid rgba(239,68,68,.5)',
        borderLeft: '4px solid var(--red)',
        borderRadius: 12,
        padding: '1rem 1.15rem',
        marginBottom: '1.25rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '1rem',
        flexWrap: 'wrap',
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.95rem', color: 'var(--red)', letterSpacing: '-.01em', marginBottom: '.25rem' }}>
          ⚠️ JOB CRISIS — only {health.active.toLocaleString()} active listings
        </div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--sub)', lineHeight: 1.5 }}>
          {health.stale.toLocaleString()} stale, {stalePct}% of corpus unavailable. Auto-refresh recommended.
        </div>
        {result && (
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', marginTop: '.4rem', color: result.ok ? 'var(--green)' : 'var(--red)' }}>
            {result.ok ? '✓ ' : '✗ '}{result.msg}
          </div>
        )}
      </div>
      <button
        onClick={runEmergencyRefresh}
        disabled={running}
        style={{
          background: 'var(--red)',
          border: 'none',
          borderRadius: 8,
          padding: '.6rem 1rem',
          color: '#fff',
          fontFamily: 'var(--mono)',
          fontSize: '.65rem',
          fontWeight: 700,
          cursor: running ? 'wait' : 'pointer',
          whiteSpace: 'nowrap',
          flexShrink: 0,
          opacity: running ? 0.7 : 1,
        }}
      >
        {running ? '⏳ Refreshing…' : 'Run emergency refresh →'}
      </button>
    </div>
  )
}

// Real, wired stale-job remediation for the Jobs & Companies panel — same flow the crisis
// banner uses (refresh-jobs validates the admin session token itself).
export function JobRefreshButton({ token, onDone }: { token: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  async function run() {
    setBusy(true); setMsg('')
    const r = await runRefreshAndClear(token)
    if (r.ok) {
      setMsg('✓ ' + refreshResultMsg(r))
      setTimeout(onDone, 1500)
    } else {
      setMsg('✗ ' + (r.error || 'failed').slice(0, 40))
    }
    setBusy(false)
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem' }}>
      {msg && <span style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', color: msg.startsWith('✓') ? 'var(--green)' : 'var(--red)' }}>{msg}</span>}
      <button className="ac-attn-act" onClick={run} disabled={busy}>{busy ? '…' : 'Refresh now'}</button>
    </span>
  )
}

const REDDIT_SUBS = ['recruitinghell', 'jobs', 'cscareerquestions', 'careerguidance']
const JOB_DEFS = [
  { key: 'refresh_jobs', name: 'Refresh job listings', desc: 'Pulls new openings from job boards · runs 6×/day', green: false },
  { key: 'refresh_demand', name: 'Refresh demand data', desc: 'Pulls BLS JOLTS + CES, updates demand index · runs monthly', green: false },
  { key: 'reddit_import', name: 'Reddit import', desc: 'Classifies hiring posts from r/recruitinghell + 3 others · runs nightly', green: true },
] as const

export function JobRunner({ token }: { token: string }) {
  const [running, setRunning] = useState<string | null>(null)
  const [label, setLabel] = useState<Record<string, string>>({})
  const [result, setResult] = useState('')

  function hdrs() { return { 'Content-Type': 'application/json', 'X-Admin-Token': token } }

  async function run(job: string) {
    setRunning(job)
    setLabel(l => ({ ...l, [job]: '⏳ Running…' }))
    setResult('')
    try {
      if (job === 'reddit_import') {
        let totalImported = 0
        const subResults: string[] = []
        setResult('Running…')
        for (const sub of REDDIT_SUBS) {
          const r = await fetch('/api/reports', { method: 'POST', headers: hdrs(), body: JSON.stringify({ action: 'reddit_import', subreddit: sub }) })
          const d = await r.json().catch(() => ({}))
          const n = d.results ? Object.values(d.results).reduce((s: number, v) => s + ((v as { imported?: number }).imported || 0), 0) : 0
          const posts = d.debug?.subreddits?.[sub]?.posts ?? d.debug?.subreddits?.[sub]?.error ?? '?'
          totalImported += n
          subResults.push(`${sub}:${posts}(+${n})`)
          setResult(`Running… ${subResults.join(' ')}`)
        }
        setLabel(l => ({ ...l, [job]: '✓ Done' }))
        setResult(`✓ Reddit: ${totalImported} imported | ${subResults.join(' ')}`)
      } else {
        const url = job === 'refresh_jobs' ? '/api/refresh-jobs' : '/api/demand'
        const res = await fetch(url, { method: 'POST', headers: hdrs(), body: JSON.stringify({}) })
        const d = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(d.error || String(res.status))
        let msg = `✓ ${job} complete`
        if (job === 'refresh_jobs' && d.inserted != null) msg = `✓ Jobs: ${d.inserted} inserted, ${d.updated ?? 0} updated`
        else if (job === 'refresh_demand' && d.rows_upserted != null) msg = `✓ Demand: ${d.rows_upserted} rows updated`
        setLabel(l => ({ ...l, [job]: '✓ Done' }))
        setResult(msg)
      }
    } catch (e) {
      setLabel(l => ({ ...l, [job]: '✗ Error' }))
      setResult('✗ ' + (e as Error).message.slice(0, 80))
    }
    setRunning(null)
    setTimeout(() => setLabel(l => ({ ...l, [job]: '' })), 5000)
  }

  return (
    <Card style={{ marginBottom: '1.25rem' }}>
      <CardHeader title="Background jobs" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
        {JOB_DEFS.map(j => (
          <div key={j.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.5rem', padding: '.6rem .75rem', background: 'var(--surface)', borderRadius: 8 }}>
            <div style={{ minWidth: 0, overflow: 'hidden' }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'var(--white)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{j.name}</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{j.desc}</div>
            </div>
            <button
              onClick={() => run(j.key)}
              disabled={running === j.key}
              style={{ background: 'none', border: `1px solid ${j.green ? 'var(--green)' : 'var(--line2)'}`, borderRadius: 7, padding: '.35rem .8rem', fontFamily: 'var(--mono)', fontSize: '.6rem', color: j.green ? 'var(--green)' : 'var(--sub)', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}
            >
              {label[j.key] || '▶ Run'}
            </button>
          </div>
        ))}
      </div>
      {result && <div style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--sub)', marginTop: '.6rem' }}>{result}</div>}
    </Card>
  )
}

export function ReportRow({ report: r, token, onRefresh }: { report: RecentReport; token: string; onRefresh: () => void }) {
  const [acting, setActing] = useState(false)
  const [localStatus, setLocalStatus] = useState<string | null>(null)

  async function act(action: string) {
    setActing(true)
    try {
      const res = await fetch('/api/admin-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
        body: JSON.stringify({ action, id: r.id }),
      })
      if (res.ok) {
        setLocalStatus(action === 'approve_report' ? 'approved' : action === 'investigate_report' ? 'review' : 'denied')
        setTimeout(onRefresh, 1200)
      }
    } finally {
      setActing(false)
    }
  }

  const isDenied = localStatus === 'denied' || (r.outcome_weight === 0 && !r.needs_review)
  const oc = outcomeColor(r.outcome)
  return (
    <div style={{ padding: '.6rem 1rem', borderBottom: '1px solid var(--line2)', borderLeft: `3px solid ${oc}`, margin: '0 -1rem', opacity: isDenied ? 0.45 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '.6rem', flexWrap: 'wrap' }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: outcomeColor(r.outcome), background: outcomeColor(r.outcome) + '18', border: `1px solid ${outcomeColor(r.outcome)}30`, borderRadius: 4, padding: '.1rem .4rem', flexShrink: 0, marginTop: 1 }}>{r.outcome}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'var(--white)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.company_name} · {r.role}</div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--sub)', marginTop: '.15rem' }}>{r.report_text?.slice(0, 90)}{r.report_text?.length > 90 ? '…' : ''}</div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--muted)', marginTop: '.15rem' }}>
            {relTime(r.created_at)} · community · {r.trust_reason || r.platform}
            {r.needs_review && !localStatus && <span style={{ marginLeft: '.4rem', color: 'var(--amber)' }}>● Review</span>}
            {localStatus === 'denied' && <span style={{ marginLeft: '.4rem', color: 'var(--red)' }}>✗ Denied</span>}
            {localStatus === 'approved' && <span style={{ marginLeft: '.4rem', color: 'var(--green)' }}>✓ Approved</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '.3rem', flexShrink: 0 }}>
          <button onClick={() => act('approve_report')} disabled={acting} title="Approve" style={{ background: 'var(--green)', border: 'none', borderRadius: 5, width: 26, height: 26, color: '#fff', fontSize: '.75rem', cursor: 'pointer' }}>✓</button>
          <button onClick={() => act('investigate_report')} disabled={acting} title="Investigate" style={{ background: 'var(--amber)', border: 'none', borderRadius: 5, width: 26, height: 26, color: '#fff', fontSize: '.75rem', cursor: 'pointer' }}>?</button>
          <button onClick={() => act('deny_hiring_report')} disabled={acting} title="Deny" style={{ background: 'var(--red)', border: 'none', borderRadius: 5, width: 26, height: 26, color: '#fff', fontSize: '.75rem', cursor: 'pointer' }}>✗</button>
        </div>
      </div>
    </div>
  )
}

export function IssueRow({ issue, token, onRefresh, onOpenMerge }: { issue: Issue; token: string; onRefresh: () => void; onOpenMerge: (name: string) => void }) {
  const [acting, setActing] = useState(false)
  const [done, setDone] = useState<'resolve' | 'dismiss' | null>(null)
  const color = issueBadgeColor(issue.type)

  async function act(action: 'resolve_issue' | 'dismiss_issue') {
    setActing(true)
    try {
      const res = await fetch('/api/admin-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
        body: JSON.stringify({ action, id: issue.id }),
      })
      const d = await res.json()
      if (!d.ok) throw new Error(d.error || res.status)
      setDone(action === 'resolve_issue' ? 'resolve' : 'dismiss')
      setTimeout(onRefresh, 1000)
    } catch (e) {
      setActing(false)
      alert('Error: ' + (e as Error).message)
    }
  }

  if (done) return (
    <div style={{ padding: '.65rem 0', borderBottom: '1px solid rgba(255,255,255,.04)', opacity: 0.4, fontFamily: 'var(--mono)', fontSize: '.6rem', color: done === 'resolve' ? 'var(--green)' : 'var(--dim)' }}>
      {done === 'resolve' ? '✓ Resolved' : '✓ Dismissed'} — {issue.target_name || ISSUE_TYPE_LABEL[issue.type] || issue.type}
    </div>
  )

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '.65rem', padding: '.65rem 0', borderBottom: '1px solid rgba(255,255,255,.04)' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', flexWrap: 'wrap', marginBottom: '.2rem' }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: '.48rem', textTransform: 'uppercase', letterSpacing: '.1em', padding: '.18rem .5rem', borderRadius: 4, flexShrink: 0, color, background: color + '1f' }}>
            {ISSUE_TYPE_LABEL[issue.type] || issue.type}
          </span>
          {issue.target_name && <span style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--white)', fontWeight: 600 }}>{issue.target_name}</span>}
          <span style={{ fontFamily: 'var(--mono)', fontSize: '.5rem', color: 'var(--dim)', marginLeft: 'auto', flexShrink: 0 }}>{relTime(issue.created_at)}</span>
        </div>
        {issue.notes && <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--sub)', lineHeight: 1.5, marginTop: '.18rem' }}>{issue.notes}</div>}
        {issue.type === 'duplicate' && issue.target_name && (
          <button onClick={() => onOpenMerge(issue.target_name)} style={{ fontFamily: 'var(--mono)', fontSize: '.5rem', marginTop: '.3rem', padding: '.18rem .5rem', borderRadius: 4, border: '1px solid var(--line2)', background: 'transparent', color: 'var(--sub)', cursor: 'pointer' }}>Open in merge tool ↓</button>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '.3rem', flexShrink: 0 }}>
        <button onClick={() => act('resolve_issue')} disabled={acting} style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', padding: '.22rem .6rem', borderRadius: 5, border: '1px solid rgba(16,185,129,.3)', background: 'rgba(16,185,129,.08)', color: 'var(--green)', cursor: 'pointer' }}>Resolve</button>
        <button onClick={() => act('dismiss_issue')} disabled={acting} style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', padding: '.22rem .6rem', borderRadius: 5, border: '1px solid var(--line2)', background: 'transparent', color: 'var(--dim)', cursor: 'pointer' }}>Dismiss</button>
      </div>
    </div>
  )
}

// ── Reddit disputes (the ADMIN side of the company-page correction loop) ──────────────
// Visitors flag a company page's surfaced public-Reddit discussion as a name collision,
// outdated, misleading, or resolved (api/company-reddit.js dispute action → company_reddit_disputes,
// migration 054). That was write-only; this panel is where an admin finally SEES and ACTS on the
// queue. Self-fetches the review queue (list_reddit_disputes) and PATCHes a row's status
// (update_reddit_dispute) — mirrors EmployerClaimsPanel's self-fetch/self-refresh shape and the
// IssueRow moderation semantics.
const DISPUTE_REASON_LABEL: Record<string, string> = {
  not_us: 'Not us', outdated: 'Outdated', misleading: 'Misleading', resolved: 'Resolved', other: 'Other',
}
function disputeReasonColor(reason: string) {
  if (reason === 'not_us') return 'var(--red)'
  if (reason === 'misleading') return 'var(--amber)'
  if (reason === 'resolved') return 'var(--green)'
  if (reason === 'outdated') return 'var(--sub)'
  return 'var(--dim)'
}
function disputeStatusColor(status: string) {
  if (status === 'open') return 'var(--amber)'
  if (status === 'actioned') return 'var(--green)'
  if (status === 'reviewed') return 'var(--blue)'
  return 'var(--dim)' // dismissed
}
type DisputeFilter = 'open' | 'reviewed' | 'actioned' | 'dismissed' | 'all'
const DISPUTE_FILTERS: { key: DisputeFilter; label: string }[] = [
  { key: 'open', label: 'Open' }, { key: 'reviewed', label: 'Reviewed' },
  { key: 'actioned', label: 'Actioned' }, { key: 'dismissed', label: 'Dismissed' }, { key: 'all', label: 'All' },
]
// The review states an admin can set. Rendered as a button per state, minus the row's current one.
const DISPUTE_ACTIONS: { status: 'reviewed' | 'actioned' | 'dismissed'; label: string }[] = [
  { status: 'reviewed', label: 'Mark reviewed' }, { status: 'actioned', label: 'Actioned' }, { status: 'dismissed', label: 'Dismiss' },
]

export function RedditDisputesPanel({ token }: { token: string }) {
  const [disputes, setDisputes] = useState<RedditDispute[]>([])
  const [counts, setCounts] = useState<RedditDisputeCounts>({ open: 0, reviewed: 0, actioned: 0, dismissed: 0, total: 0 })
  const [filter, setFilter] = useState<DisputeFilter>('open')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<number | null>(null)
  const [err, setErr] = useState('')

  // Silent reload (no loading flash after first paint) — matches EmployerClaimsPanel.
  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
        body: JSON.stringify({ action: 'list_reddit_disputes', ...(filter === 'all' ? {} : { status: filter }) }),
      })
      const d = await res.json()
      if (!d.ok) throw new Error(d.error || res.status)
      setDisputes(Array.isArray(d.disputes) ? d.disputes : [])
      if (d.counts) setCounts(d.counts)
      setErr('')
    } catch (e) { setErr((e as Error).message || 'Could not load disputes') } finally { setLoading(false) }
  }, [token, filter])

  useEffect(() => { load() }, [load])

  async function act(id: number, status: 'reviewed' | 'actioned' | 'dismissed') {
    setBusy(id); setErr('')
    // Optimistic: in a filtered view the row leaves the queue immediately; in "All" it flips state
    // in place. A background reload then reconciles the list + counts (and reverts on failure).
    setDisputes(list => (filter === 'all' ? list.map(x => (x.id === id ? { ...x, status } : x)) : list.filter(x => x.id !== id)))
    try {
      const res = await fetch('/api/admin-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
        body: JSON.stringify({ action: 'update_reddit_dispute', id, status }),
      })
      const d = await res.json()
      if (!d.ok) throw new Error(d.error || res.status)
    } catch (e) {
      setErr((e as Error).message || 'Update failed')
    } finally {
      setBusy(null)
      load() // reconcile with the server (restores the row if the PATCH failed)
    }
  }

  const activeLabel = (DISPUTE_FILTERS.find(f => f.key === filter)?.label || '').toLowerCase()
  const emptyMsg = filter === 'open' ? 'No open disputes.' : `No ${activeLabel} disputes.`

  return (
    <Card style={{ marginTop: '.65rem', border: '1px solid rgba(245,158,11,.22)' }}>
      <CardHeader
        title="Reddit disputes"
        badge={counts.open > 0 ? <Badge n={counts.open} color="var(--amber)" /> : undefined}
        action={<span style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--dim)' }}>Corrections submitted on company pages about the surfaced public-Reddit discussion</span>}
      />

      {/* Status filter — the actionable Open queue first; the rest is review history */}
      <div style={{ display: 'flex', gap: '.35rem', flexWrap: 'wrap', padding: '.2rem 0 .7rem', borderBottom: '1px solid var(--line2)', marginBottom: '.7rem' }}>
        {DISPUTE_FILTERS.map(f => {
          const n = f.key === 'all' ? counts.total : counts[f.key]
          const active = filter === f.key
          return (
            <button key={f.key} onClick={() => setFilter(f.key)} style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', padding: '.24rem .55rem', borderRadius: 6, border: `1px solid ${active ? 'var(--white)' : 'var(--line2)'}`, background: active ? 'rgba(255,255,255,.06)' : 'transparent', color: active ? 'var(--white)' : 'var(--sub)', cursor: 'pointer' }}>
              {f.label}{n > 0 ? ` ${n}` : ''}
            </button>
          )
        })}
      </div>

      {err && <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--red)', marginBottom: '.6rem' }}>{err}</div>}

      {loading ? (
        <div style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--dim)' }}>Loading…</div>
      ) : disputes.length === 0 ? (
        <div style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: filter === 'open' ? 'var(--green)' : 'var(--dim)' }}>{filter === 'open' ? '✓ ' : ''}{emptyMsg}</div>
      ) : (
        disputes.map(d => {
          const reasonColor = disputeReasonColor(d.reason)
          return (
            <div key={d.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '.65rem', padding: '.7rem 0', borderBottom: '1px solid rgba(255,255,255,.04)' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', flexWrap: 'wrap', marginBottom: '.25rem' }}>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: '.48rem', textTransform: 'uppercase', letterSpacing: '.1em', padding: '.18rem .5rem', borderRadius: 4, flexShrink: 0, color: reasonColor, background: reasonColor + '1f' }}>
                    {DISPUTE_REASON_LABEL[d.reason] || d.reason}
                  </span>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--white)', fontWeight: 600 }}>{d.company_name}</span>
                  {d.status !== 'open' && (
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '.46rem', textTransform: 'uppercase', letterSpacing: '.08em', color: disputeStatusColor(d.status), border: `1px solid ${disputeStatusColor(d.status)}`, borderRadius: 4, padding: '.1rem .35rem', flexShrink: 0 }}>{d.status}</span>
                  )}
                  <span style={{ fontFamily: 'var(--mono)', fontSize: '.5rem', color: 'var(--dim)', marginLeft: 'auto', flexShrink: 0 }}>{relTime(d.created_at)}</span>
                </div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--sub)', lineHeight: 1.5, marginTop: '.1rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{d.detail}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', flexWrap: 'wrap', marginTop: '.3rem' }}>
                  {d.permalink && (
                    <a href={d.permalink} target="_blank" rel="noopener noreferrer" style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--blue)', textDecoration: 'none', fontWeight: 700 }}>↗ Disputed thread</a>
                  )}
                  {d.contact && (
                    <a href={`mailto:${d.contact}`} style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--sub)', textDecoration: 'none' }}>✉ {d.contact}</a>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '.3rem', flexShrink: 0 }}>
                {DISPUTE_ACTIONS.filter(a => a.status !== d.status).map(a => {
                  const c = disputeStatusColor(a.status)
                  return (
                    <button key={a.status} onClick={() => act(d.id, a.status)} disabled={busy === d.id} style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', padding: '.22rem .6rem', borderRadius: 5, border: `1px solid ${c}4d`, background: c + '14', color: c, cursor: busy === d.id ? 'default' : 'pointer', opacity: busy === d.id ? 0.5 : 1, whiteSpace: 'nowrap' }}>
                      {busy === d.id ? '…' : a.label}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })
      )}
    </Card>
  )
}

export function InactiveRow({ report: r, token, onRefresh }: { report: InactiveReport; token: string; onRefresh?: () => void }) {
  const [acting, setActing] = useState(false)
  const [done, setDone] = useState<'deleted' | 'dismissed' | null>(null)
  const j = r.job || ({} as NonNullable<InactiveReport['job']>)
  const applyUrl = j.apply_url || ''
  // Reports whose job_id isn't a real jobs-table row (ephemeral search-result id, or an
  // already-gone listing) have no board listing to delete or link to — the admin can only
  // dismiss the report itself.
  const orphan = !r.job
  // For ephemeral (non-DB) listings there's no job row, but the client-sent snapshot lets us
  // still show what was reported instead of a bare id.
  const snap = r.snapshot || null
  // WHY it was flagged — count broken down by report status (expired / unknown).
  const reasonStr = Object.entries(r.reasons || {})
    .sort((a, b) => b[1] - a[1])
    .map(([reason, n]) => `${n} ${reason}`)
    .join(', ') || `${r.report_count} report${r.report_count === 1 ? '' : 's'}`

  async function act(action: 'delete_listing' | 'dismiss_inactive_report') {
    if (action === 'delete_listing') {
      const msg = orphan
        ? 'Delete this listing? It is a live search result (not saved to the board), so it will be suppressed from future searches so it can’t resurface, and the report cleared.'
        : 'Delete this listing? It will be removed from the job board (job seekers will no longer see it) and its reports cleared. This can be reversed by an engineer.'
      if (!confirm(msg)) return
    }
    if (action === 'dismiss_inactive_report' && !confirm('Keep this listing? The report is cleared from the queue and the listing stays live/searchable.')) return
    setActing(true)
    try {
      const res = await fetch('/api/admin-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
        body: JSON.stringify({ action, job_id: r.job_id }),
      })
      const d = await res.json()
      if (!d.ok) throw new Error(d.error || res.status)
      setDone(action === 'delete_listing' ? 'deleted' : 'dismissed')
      if (onRefresh) setTimeout(onRefresh, 1200)
    } catch (e) {
      setActing(false)
      alert('Error: ' + (e as Error).message)
    }
  }

  if (done) return (
    <div style={{ padding: '.5rem 0', borderBottom: '1px solid var(--line2)', fontFamily: 'var(--mono)', fontSize: '.58rem', color: done === 'deleted' ? 'var(--green)' : 'var(--dim)' }}>
      {done === 'deleted' ? '✓ Listing deleted' : '✓ Listing kept — report cleared'}
    </div>
  )

  return (
    <div style={{ padding: '.7rem 0', borderBottom: '1px solid var(--line2)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '.75rem', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {orphan ? (
            <>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'var(--white)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {snap && (snap.title || snap.company)
                  ? <>{snap.title || 'Untitled role'} · <span style={{ color: 'var(--sub)' }}>{snap.company || 'Unknown company'}</span></>
                  : <span style={{ color: 'var(--sub)' }}>{r.job_id}</span>}
              </div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--dim)', marginTop: '.15rem' }}>
                {snap?.city ? `${snap.city} · ` : ''}live listing (not saved to the board) · {reasonStr} · latest {relTime(r.latest_reported_at)}
              </div>
              {snap?.apply_url ? (
                <div style={{ marginTop: '.3rem' }}>
                  <a href={snap.apply_url} target="_blank" rel="noopener noreferrer" style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--blue)', textDecoration: 'none', fontWeight: 700 }}>↗ Open the live posting to investigate</a>
                </div>
              ) : (
                <div style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', color: 'var(--muted)', marginTop: '.3rem' }}>No apply URL captured (reported before snapshotting shipped) — dismiss to clear.</div>
              )}
            </>
          ) : (
            <>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'var(--white)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {j.title || 'Unknown title'} · <span style={{ color: 'var(--sub)' }}>{j.company || 'Unknown company'}</span>
              </div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--dim)', marginTop: '.15rem' }}>
                {j.city || 'Unknown location'} · {reasonStr} · latest {relTime(r.latest_reported_at)}
              </div>
              <div style={{ display: 'flex', gap: '.75rem', marginTop: '.25rem', flexWrap: 'wrap' }}>
                <a href={`/jobs/${encodeURIComponent(r.job_id)}`} target="_blank" rel="noopener noreferrer" style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--blue)', textDecoration: 'none' }}>↗ View listing page</a>
                {applyUrl && <a href={applyUrl} target="_blank" rel="noopener noreferrer" style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--blue)', textDecoration: 'none' }}>↗ Open apply URL</a>}
              </div>
            </>
          )}
        </div>
        <div style={{ display: 'flex', gap: '.45rem', flexShrink: 0 }}>
          {/* Orphan (ephemeral) delete suppresses the listing from future searches; a real board
              row is soft-deleted. Both are offered so the admin can always keep or delete. */}
          <button onClick={() => act('delete_listing')} disabled={acting} style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', padding: '.3rem .65rem', borderRadius: 6, border: '1px solid rgba(239,68,68,.4)', background: 'rgba(239,68,68,.08)', color: 'var(--red)', cursor: 'pointer' }}>Delete listing</button>
          <button onClick={() => act('dismiss_inactive_report')} disabled={acting} style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', padding: '.3rem .65rem', borderRadius: 6, border: '1px solid var(--line2)', background: 'transparent', color: 'var(--sub)', cursor: 'pointer' }}>Keep listing</button>
        </div>
      </div>
    </div>
  )
}

export function MergePanel({ token, prefill }: { token: string; prefill: MergePrefill | null }) {
  const [primary, setPrimary] = useState('')
  const [secondary, setSecondary] = useState('')
  const [status, setStatus] = useState<{ text: string; color: string } | null>(null)
  const [scanning, setScanning] = useState(false)
  const [autoMerging, setAutoMerging] = useState(false)
  const [merging, setMerging] = useState(false)
  const [dupes, setDupes] = useState<DupGroup[] | null>(null)
  const [merges, setMerges] = useState<MergeLog[] | null>(null)
  const [confirmUndo, setConfirmUndo] = useState<string | null>(null)
  const [undoing, setUndoing] = useState<string | null>(null)
  const [resplitName, setResplitName] = useState('')
  const [resplitting, setResplitting] = useState(false)

  // Prefill from issues queue "Open in merge tool"
  useEffect(() => {
    if (prefill) {
      setPrimary(prefill.primary)
      setSecondary(prefill.secondary)
    }
  }, [prefill])

  const loadMerges = useCallback(async () => {
    try {
      const res = await fetch('/api/admin-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
        body: JSON.stringify({ action: 'list_merges' }),
      })
      const d = await res.json()
      if (d.ok) setMerges(d.merges || [])
    } catch { /* history is non-critical — leave prior state */ }
  }, [token])

  useEffect(() => { loadMerges() }, [loadMerges])

  async function undoMerge(id: string) {
    setUndoing(id)
    setStatus({ text: 'Undoing merge…', color: 'var(--dim)' })
    try {
      const res = await fetch('/api/admin-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
        body: JSON.stringify({ action: 'undo_merge', merge_id: id }),
      })
      const d = await res.json()
      if (!d.ok) throw new Error(d.error || res.status)
      setStatus({ text: `✓ Undone — "${d.restored?.secondary_name}" split back out (${d.restored?.reports ?? 0} reports restored)`, color: 'var(--green)' })
      setConfirmUndo(null)
      loadMerges()
      scan()
    } catch (e) {
      setStatus({ text: 'Undo failed: ' + (e as Error).message, color: 'var(--red)' })
    }
    setUndoing(null)
  }

  async function scan() {
    setScanning(true)
    try {
      const res = await fetch('/api/admin-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
        body: JSON.stringify({ action: 'find_duplicates' }),
      })
      const d = await res.json()
      if (!d.ok) throw new Error(d.error || res.status)
      setDupes(d.duplicates || [])
    } catch (e) {
      setStatus({ text: 'Error: ' + (e as Error).message, color: 'var(--red)' })
    }
    setScanning(false)
  }

  async function manualMerge() {
    const p = primary.trim(), s = secondary.trim()
    if (!p || !s) { setStatus({ text: 'Both fields required', color: 'var(--red)' }); return }
    if (p.toLowerCase() === s.toLowerCase()) { setStatus({ text: 'Cannot merge a company with itself', color: 'var(--red)' }); return }
    setMerging(true)
    setStatus({ text: 'Merging…', color: 'var(--dim)' })
    try {
      const res = await fetch('/api/admin-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
        body: JSON.stringify({ action: 'merge', primary: p, secondary: s }),
      })
      const d = await res.json()
      if (!d.ok) throw new Error(d.error || res.status)
      setStatus({ text: `✓ "${s}" merged into "${p}" — ${d.merged_report_count} total reports${d.logged === false ? ' (not logged — history table unapplied)' : ''}`, color: 'var(--green)' })
      setPrimary(''); setSecondary('')
      scan()
      loadMerges()
    } catch (e) {
      setStatus({ text: 'Error: ' + (e as Error).message, color: 'var(--red)' })
    }
    setMerging(false)
  }

  async function autoMerge() {
    setAutoMerging(true)
    setStatus({ text: 'Scanning and merging…', color: 'var(--dim)' })
    try {
      const res = await fetch('/api/admin-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
        body: JSON.stringify({ action: 'auto_merge' }),
      })
      const d = await res.json()
      if (!d.ok) throw new Error(d.error || res.status)
      if (!d.merged) {
        setStatus({ text: '✓ Auto-merge complete — no duplicates found', color: 'var(--green)' })
      } else {
        const summary = (d.groups || []).map((g: { canonical: string; absorbed: string[] }) => `"${g.absorbed.join('", "')}" → "${g.canonical}"`).join(' · ')
        setStatus({ text: `✓ Merged ${d.merged} duplicate${d.merged !== 1 ? 's' : ''}: ${summary}`, color: 'var(--green)' })
      }
      scan()
      loadMerges()
    } catch (e) {
      setStatus({ text: 'Auto-merge failed: ' + (e as Error).message, color: 'var(--red)' })
    }
    setAutoMerging(false)
  }

  // Reclaim a company that got wrongly absorbed into another, by NAME — reverses the most recent
  // not-yet-undone merge where this was the absorbed company (no merge_id hunting required).
  async function resplitCompany() {
    const name = resplitName.trim()
    if (name.length < 2) { setStatus({ text: 'Enter the company that got absorbed', color: 'var(--red)' }); return }
    setResplitting(true)
    setStatus({ text: `Separating "${name}" back out…`, color: 'var(--dim)' })
    try {
      const res = await fetch('/api/admin-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
        body: JSON.stringify({ action: 'resplit_company', name }),
      })
      const d = await res.json()
      if (!d.ok) throw new Error(d.error || res.status)
      setStatus({ text: `✓ "${d.restored?.secondary_name}" split back out of "${d.restored?.primary_name}" (${d.restored?.reports ?? 0} reports restored${d.restored?.aliases_removed ? `, ${d.restored.aliases_removed} alias removed` : ''})`, color: 'var(--green)' })
      setResplitName('')
      loadMerges()
      scan()
    } catch (e) {
      setStatus({ text: 'Separate failed: ' + (e as Error).message, color: 'var(--red)' })
    }
    setResplitting(false)
  }

  function setMerge(p: string, s: string) { setPrimary(p); setSecondary(s) }

  const ts = (iso: unknown) => {
    if (!iso) return '—'
    const d = new Date(String(iso)), m = Math.floor((Date.now() - d.getTime()) / 60000)
    if (m < 60) return `${m}m ago`
    const h = Math.floor(m / 60)
    if (h < 24) return `${h}h ago`
    return `${Math.floor(h / 24)}d ago`
  }

  const inputStyle: React.CSSProperties = { width: '100%', background: 'var(--raised)', border: '1px solid var(--line2)', borderRadius: 7, padding: '.42rem .65rem', fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'var(--white)', outline: 'none', boxSizing: 'border-box' }

  return (
    <Card style={{ marginBottom: '1.25rem' }}>
      <CardHeader
        title="Company deduplication"
        action={
          <div style={{ display: 'flex', gap: '.45rem' }}>
            <button onClick={scan} disabled={scanning} style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', padding: '.3rem .75rem', borderRadius: 6, border: '1px solid var(--line2)', background: 'transparent', color: 'var(--sub)', cursor: 'pointer' }}>
              {scanning ? 'Scanning…' : 'Scan for dupes'}
            </button>
            <button onClick={autoMerge} disabled={autoMerging} style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', padding: '.3rem .75rem', borderRadius: 6, border: '1px solid rgba(16,185,129,.3)', background: 'rgba(16,185,129,.08)', color: 'var(--green)', cursor: 'pointer' }}>
              {autoMerging ? 'Running…' : 'Auto-merge'}
            </button>
          </div>
        }
      />
      {/* Manual merge form */}
      <div style={{ paddingBottom: '.75rem', borderBottom: '1px solid var(--line2)', marginBottom: '.75rem' }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: '.48rem', textTransform: 'uppercase', letterSpacing: '.12em', color: 'var(--dim)', marginBottom: '.5rem' }}>Manual merge</div>
        <div style={{ display: 'flex', gap: '.5rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 110 }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.48rem', color: 'var(--muted)', marginBottom: '.22rem' }}>Keep (primary)</div>
            <input value={primary} onChange={e => setPrimary(e.target.value)} placeholder="e.g. Amazon" style={inputStyle} />
          </div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.8rem', color: 'var(--dim)', flexShrink: 0, paddingBottom: '.45rem' }}>←</div>
          <div style={{ flex: 1, minWidth: 110 }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.48rem', color: 'var(--muted)', marginBottom: '.22rem' }}>Absorb (secondary)</div>
            <input value={secondary} onChange={e => setSecondary(e.target.value)} placeholder="e.g. amazon.com" style={inputStyle} />
          </div>
          <button onClick={manualMerge} disabled={merging} style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', padding: '.42rem .9rem', borderRadius: 7, border: '1px solid rgba(239,68,68,.3)', background: 'rgba(239,68,68,.08)', color: 'var(--red)', cursor: 'pointer', flexShrink: 0 }}>Merge →</button>
        </div>
        {status && <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', marginTop: '.45rem', color: status.color }}>{status.text}</div>}
      </div>
      {/* Separate a company back out (recovery) — reverses a bad merge by NAME */}
      <div style={{ paddingBottom: '.75rem', borderBottom: '1px solid var(--line2)', marginBottom: '.75rem' }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: '.48rem', textTransform: 'uppercase', letterSpacing: '.12em', color: 'var(--dim)', marginBottom: '.25rem' }}>Separate a company (undo a bad merge)</div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: '.5rem', color: 'var(--muted)', marginBottom: '.5rem', lineHeight: 1.5 }}>Got absorbed into another company (e.g. &quot;Towne Park&quot; saved as &quot;Towne&quot;)? Type it here to split it back out — reverses the most recent merge where it was absorbed, moves its reports back, and clears the stale score.</div>
        <div style={{ display: 'flex', gap: '.5rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 140 }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.48rem', color: 'var(--muted)', marginBottom: '.22rem' }}>Absorbed company name</div>
            <input value={resplitName} onChange={e => setResplitName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') resplitCompany() }} placeholder="e.g. Towne Park" style={inputStyle} />
          </div>
          <button onClick={resplitCompany} disabled={resplitting} style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', padding: '.42rem .9rem', borderRadius: 7, border: '1px solid rgba(59,130,246,.35)', background: 'rgba(59,130,246,.1)', color: 'var(--blue)', cursor: 'pointer', flexShrink: 0 }}>{resplitting ? 'Separating…' : 'Separate ←'}</button>
        </div>
      </div>
      {/* Detected duplicates list */}
      {dupes === null
        ? <div style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--dim)' }}>Click &quot;Scan for dupes&quot; to detect company name duplicates.</div>
        : dupes.length === 0
          ? <div style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--green)' }}>✓ No duplicates detected</div>
          : dupes.map(({ key, companies }) => {
            const prim = companies[0]
            const rest = companies.slice(1)
            return (
              <div key={key} style={{ padding: '.65rem 0', borderBottom: '1px solid var(--line2)' }}>
                <div style={{ fontFamily: 'var(--mono)', fontSize: '.5rem', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--amber)', marginBottom: '.3rem' }}>{companies.length} entries match &quot;{key}&quot;</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '.35rem', flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', padding: '.18rem .55rem', borderRadius: 4, background: 'rgba(16,185,129,.12)', color: 'var(--green)', border: '1px solid rgba(16,185,129,.2)' }}>{prim.name} <span style={{ opacity: .6 }}>({prim.report_count || 0})</span></span>
                  {rest.map(c => (
                    <span key={c.id} style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', padding: '.18rem .55rem', borderRadius: 4, background: 'rgba(239,68,68,.08)', color: 'var(--red)', border: '1px solid rgba(239,68,68,.15)' }}>{c.name} <span style={{ opacity: .6 }}>({c.report_count || 0})</span></span>
                  ))}
                  <button onClick={() => setMerge(prim.name, rest[0].name)} style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', padding: '.18rem .55rem', borderRadius: 5, border: '1px solid var(--line2)', background: 'transparent', color: 'var(--sub)', cursor: 'pointer', marginLeft: 'auto' }}>Set to merge</button>
                </div>
              </div>
            )
          })
      }

      {/* ── Merge history (undo) ── */}
      <div style={{ marginTop: '1rem', paddingTop: '.85rem', borderTop: '1px solid var(--line2)' }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: '.48rem', textTransform: 'uppercase', letterSpacing: '.12em', color: 'var(--dim)', marginBottom: '.5rem' }}>Merge history</div>
        {merges === null
          ? <div style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--dim)' }}>Loading…</div>
          : merges.length === 0
            ? <div style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--dim)' }}>No merges recorded yet — history starts with the next merge.</div>
            : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '.3rem' }}>
                {merges.map(m => (
                  <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap', padding: '.4rem 0', borderBottom: '1px solid var(--line2)' }}>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--white)', minWidth: 0, flex: 1, wordBreak: 'break-word' }}>
                      <span style={{ color: 'var(--red)' }}>{m.secondary_name}</span>
                      <span style={{ color: 'var(--dim)' }}> → </span>
                      <span style={{ color: 'var(--green)' }}>{m.primary_name}</span>
                      <span style={{ color: 'var(--dim)' }}> · {ts(m.created_at)}{m.moved_reports ? ` · ${m.moved_reports} report${m.moved_reports === 1 ? '' : 's'}` : ''}</span>
                    </span>
                    {m.undone_at
                      ? <span style={{ fontFamily: 'var(--mono)', fontSize: '.5rem', color: 'var(--dim)', flexShrink: 0 }}>undone {ts(m.undone_at)}</span>
                      : confirmUndo === m.id
                        ? (
                          <span style={{ display: 'flex', gap: '.3rem', flexShrink: 0 }}>
                            <button onClick={() => undoMerge(m.id)} disabled={undoing === m.id} style={{ fontFamily: 'var(--mono)', fontSize: '.5rem', padding: '.18rem .5rem', borderRadius: 5, border: '1px solid rgba(239,68,68,.4)', background: 'rgba(239,68,68,.12)', color: 'var(--red)', cursor: 'pointer' }}>{undoing === m.id ? '…' : 'Confirm undo'}</button>
                            <button onClick={() => setConfirmUndo(null)} disabled={undoing === m.id} style={{ fontFamily: 'var(--mono)', fontSize: '.5rem', padding: '.18rem .5rem', borderRadius: 5, border: '1px solid var(--line2)', background: 'transparent', color: 'var(--sub)', cursor: 'pointer' }}>Cancel</button>
                          </span>
                        )
                        : <button onClick={() => setConfirmUndo(m.id)} style={{ fontFamily: 'var(--mono)', fontSize: '.5rem', padding: '.18rem .5rem', borderRadius: 5, border: '1px solid var(--line2)', background: 'transparent', color: 'var(--sub)', cursor: 'pointer', flexShrink: 0 }}>Undo</button>
                    }
                  </div>
                ))}
              </div>
            )
        }
      </div>
    </Card>
  )
}

// Per-company evidentiary export — pulls the full audit bundle (every report + source/trust
// weight, the per-source aggregation, the live-recomputed grade, and a methodology key) and
// downloads it as JSON. Built for legal defensibility + showing exactly how a grade was derived.
export function CompanyExportPanel({ token }: { token: string }) {
  const [company, setCompany] = useState('')
  const [busy, setBusy] = useState<'' | 'json' | 'pdf' | 'package'>('')
  const [status, setStatus] = useState<{ text: string; color: string } | null>(null)
  // Two-step (prepare → download) so the save fires inside the user gesture on iOS. `ready`
  // holds whichever artifact was last prepared (JSON bundle or the legal PDF blob).
  const [ready, setReady] = useState<{ filename: string; mime: string; content: string | Blob; label: string } | null>(null)

  const inputStyle: React.CSSProperties = { width: '100%', background: 'var(--raised)', border: '1px solid var(--line2)', borderRadius: 7, padding: '.42rem .65rem', fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'var(--white)', outline: 'none', boxSizing: 'border-box' }
  const slugDate = (name: string) => ({ slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'company', date: new Date().toISOString().slice(0, 10) })

  // Raw JSON audit bundle (unchanged contract).
  async function prepareJson() {
    const name = company.trim()
    if (name.length < 2) { setStatus({ text: 'Enter a company name', color: 'var(--red)' }); return }
    setBusy('json'); setReady(null)
    setStatus({ text: 'Assembling audit bundle…', color: 'var(--dim)' })
    try {
      const res = await fetch('/api/admin-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
        body: JSON.stringify({ action: 'export_company', company: name }),
      })
      const d = await res.json()
      if (!d.ok) throw new Error(d.error || res.status)
      const b = d.bundle
      const t = b?.totals || {}
      const cs = b?.computed_score || {}
      const { slug, date } = slugDate(name)
      setReady({ filename: `seen-company-audit-${slug}-${date}.json`, mime: 'application/json', content: JSON.stringify(b, null, 2), label: 'JSON' })
      setStatus({ text: `✓ JSON ready — ${t.total_reports ?? 0} reports (${t.included_in_score ?? 0} in score · ${t.excluded_needs_review ?? 0} held) · ${t.distinct_submitters ?? 0} submitters · grade ${cs.overall_score ?? 'n/a'}. Tap Download.`, color: 'var(--green)' })
    } catch (e) {
      setStatus({ text: 'Export failed: ' + (e as Error).message, color: 'var(--red)' })
    }
    setBusy('')
  }

  // Legal Audit PDF — professional, legal-protection methodology + evidence packet. Rendered
  // server-side from the SAME bundle the JSON export uses; the PDF embeds the source JSON SHA-256.
  async function preparePdf() {
    const name = company.trim()
    if (name.length < 2) { setStatus({ text: 'Enter a company name', color: 'var(--red)' }); return }
    setBusy('pdf'); setReady(null)
    setStatus({ text: 'Generating legal audit PDF…', color: 'var(--dim)' })
    try {
      const res = await fetch('/api/admin-company-audit-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
        body: JSON.stringify({ company: name }),
      })
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || res.status) }
      const blob = await res.blob()
      const hash = res.headers.get('X-Source-Json-Sha256') || ''
      const { slug, date } = slugDate(name)
      setReady({ filename: `seen-legal-audit-${slug}-${date}.pdf`, mime: 'application/pdf', content: blob, label: 'PDF' })
      setStatus({ text: `✓ Legal PDF ready${hash ? ` — source SHA-256 ${hash.slice(0, 12)}…` : ''}. Tap Download.`, color: 'var(--green)' })
    } catch (e) {
      setStatus({ text: 'PDF failed: ' + (e as Error).message, color: 'var(--red)' })
    }
    setBusy('')
  }

  // Legal Audit PACKAGE — a ZIP of the PDF + the exact source JSON + a manifest, all from ONE
  // bundle so the PDF's printed hash, the JSON's hash, and the manifest all agree. Strongest
  // legal-defense export (the standalone JSON and PDF stay available above).
  async function preparePackage() {
    const name = company.trim()
    if (name.length < 2) { setStatus({ text: 'Enter a company name', color: 'var(--red)' }); return }
    setBusy('package'); setReady(null)
    setStatus({ text: 'Assembling legal audit package…', color: 'var(--dim)' })
    try {
      const res = await fetch('/api/admin-company-audit-package', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
        body: JSON.stringify({ company: name }),
      })
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || res.status) }
      const blob = await res.blob()
      const hash = res.headers.get('X-Source-Json-Sha256') || ''
      const { slug, date } = slugDate(name)
      setReady({ filename: `seen-legal-audit-package-${slug}-${date}.zip`, mime: 'application/zip', content: blob, label: 'Package' })
      setStatus({ text: `✓ Package ready (PDF + source JSON + manifest)${hash ? ` — source SHA-256 ${hash.slice(0, 12)}…` : ''}. Tap Download.`, color: 'var(--green)' })
    } catch (e) {
      setStatus({ text: 'Package failed: ' + (e as Error).message, color: 'var(--red)' })
    }
    setBusy('')
  }

  function download() {
    if (!ready) return
    // No await before this call — keeps the iOS share sheet inside the user gesture.
    saveFile(ready.filename, ready.mime, ready.content)
  }

  return (
    <Card style={{ marginBottom: '1.25rem' }}>
      <CardHeader title="Company score audit" />
      <div style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--dim)', marginBottom: '.6rem', lineHeight: 1.5 }}>
        Full evidentiary record for one company — every contributing &amp; held-out report with its source and trust weight, the per-source aggregation, the live-recomputed grade with all inputs, and the scoring methodology. Submitters are pseudonymized. Export the raw <strong>JSON</strong> bundle, the professional <strong>Legal Audit PDF</strong> (methodology + evidence packet, source JSON SHA-256 embedded), or the <strong>Legal Audit Package</strong> — a ZIP of the PDF + the exact source JSON + a manifest whose hashes all match (the strongest option for a company, its counsel, an authorized legal representative, or a regulator).
      </div>
      <div style={{ display: 'flex', gap: '.5rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 140 }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.48rem', color: 'var(--muted)', marginBottom: '.22rem' }}>Company name</div>
          <input value={company} onChange={e => { setCompany(e.target.value); setReady(null) }} onKeyDown={e => { if (e.key === 'Enter') prepareJson() }} placeholder="e.g. FedEx" style={inputStyle} />
        </div>
        {ready ? (
          <button onClick={download} style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', padding: '.42rem .9rem', borderRadius: 7, border: '1px solid rgba(16,185,129,.5)', background: 'rgba(16,185,129,.12)', color: 'var(--green)', cursor: 'pointer', flexShrink: 0 }}>
            ⬇ Download {ready.label}
          </button>
        ) : (
          <>
            <button onClick={prepareJson} disabled={!!busy} style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', padding: '.42rem .9rem', borderRadius: 7, border: '1px solid rgba(59,130,246,.3)', background: 'rgba(59,130,246,.08)', color: 'var(--blue)', cursor: 'pointer', flexShrink: 0 }}>
              {busy === 'json' ? 'Assembling…' : 'Export JSON'}
            </button>
            <button onClick={preparePdf} disabled={!!busy} style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', padding: '.42rem .9rem', borderRadius: 7, border: '1px solid rgba(124,58,237,.4)', background: 'rgba(124,58,237,.12)', color: 'var(--indigo, #a78bfa)', cursor: 'pointer', flexShrink: 0 }}>
              {busy === 'pdf' ? 'Generating…' : 'Generate Legal Audit PDF'}
            </button>
            <button onClick={preparePackage} disabled={!!busy} style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', padding: '.42rem .9rem', borderRadius: 7, border: '1px solid rgba(16,185,129,.45)', background: 'rgba(16,185,129,.1)', color: 'var(--green)', cursor: 'pointer', flexShrink: 0 }}>
              {busy === 'package' ? 'Packaging…' : 'Generate Legal Audit Package'}
            </button>
          </>
        )}
      </div>
      {status && <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', marginTop: '.5rem', color: status.color, lineHeight: 1.5 }}>{status.text}</div>}
    </Card>
  )
}

const FLAG_STATUS_LABELS: Record<string, string> = {
  off: 'Off', admin_only: 'Admin only', beta_users: 'Beta (20%)', percentage_rollout: '% rollout', fully_on: 'Live',
}
const FLAG_STATUS_COLORS: Record<string, string> = {
  off: 'var(--muted)', admin_only: 'var(--amber)', beta_users: 'var(--blue)', percentage_rollout: 'var(--indigo)', fully_on: 'var(--green)',
}
const FLAG_STATUSES = ['off', 'admin_only', 'beta_users', 'percentage_rollout', 'fully_on']

// Curated admin toggle layout. Internal batch cursors / tuning values are HIDDEN — they
// aren't on/off product toggles and were the main source of confusion. Real toggles are
// grouped, with one Reddit toggle and one credit toggle. Anything unrecognized and not
// hidden still shows under "Other" so nothing silently disappears.
const HIDDEN_FLAGS = new Set([
  'reddit_offset_recruitinghell', 'reddit_offset_jobs', 'reddit_offset_cscareerquestions',
  'reddit_offset_careerguidance', 'reddit_offset_antiwork', 'reddit_offset_askhr',
  'reddit_offset_interviews', 'reddit_offset_experienceddevs', 'reddit_offset_ExperiencedDevs',
  'reddit_offset_AskHR', 'job_search_target',
])
const FLAG_FRIENDLY: Record<string, string> = {
  ai_credit_system_enabled: 'AI credit system',
  reddit_import_enabled: 'Reddit import',
  job_refresh_enabled: 'Job refresh',
  admin_panel_enabled: 'Admin panel',
  duplicate_detection_enabled: 'Duplicate detection',
  hiring_forecast_enabled: 'Hiring forecast',
  company_confidence_matching_enabled: 'Company match confidence',
  outcome_cards_v2_enabled: 'Outcome cards v2',
  resume_question_engine_enabled: 'Résumé credit questions',
}
const FLAG_GROUPS: { group: string; flags: string[] }[] = [
  { group: 'Credits', flags: ['ai_credit_system_enabled'] },
  { group: 'Data ingestion', flags: ['reddit_import_enabled', 'job_refresh_enabled'] },
  { group: 'Features', flags: ['admin_panel_enabled', 'duplicate_detection_enabled', 'hiring_forecast_enabled', 'company_confidence_matching_enabled', 'outcome_cards_v2_enabled', 'resume_question_engine_enabled'] },
]

// Credits overview + a single master enable/disable for the whole credit system.
export function CreditsPanel({ credits, flags, token, onRefresh }: { credits: { total_users: number; pro_users: number; total_balance?: number; earned?: number; spent?: number }; flags: FeatureFlag[]; token: string; onRefresh: () => void }) {
  const sysFlag = flags.find(f => f.flag_name === 'ai_credit_system_enabled')
  const on = (sysFlag?.status || 'fully_on') !== 'off'
  const [saving, setSaving] = useState(false)
  async function toggle() {
    setSaving(true)
    try {
      const res = await fetch('/api/admin-stats', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token }, body: JSON.stringify({ action: 'set_flag', flag_name: 'ai_credit_system_enabled', status: on ? 'off' : 'fully_on' }) })
      const d = await res.json(); if (!d.ok) throw new Error(d.error || String(res.status))
      setTimeout(onRefresh, 400)
    } catch (e) { alert('✗ ' + (e as Error).message) }
    setSaving(false)
  }
  const Stat = ({ l, n, c }: { l: string; n: number | string; c?: string }) => (
    <div style={{ flex: '1 1 30%', minWidth: 92, padding: '.55rem .6rem', border: '1px solid var(--line2)', borderRadius: 8 }}>
      <div style={{ fontFamily: 'var(--mono)', fontSize: '.48rem', color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{l}</div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: '1.05rem', color: c || 'var(--white)', marginTop: '.15rem' }}>{typeof n === 'number' ? n.toLocaleString() : n}</div>
    </div>
  )
  return (
    <Card style={{ marginBottom: '1.25rem' }}>
      <CardHeader
        title="Credits"
        action={
          <button onClick={toggle} disabled={saving} style={{ background: on ? 'rgba(239,68,68,.1)' : 'rgba(34,197,94,.1)', border: `1px solid ${on ? 'rgba(239,68,68,.4)' : 'rgba(34,197,94,.4)'}`, borderRadius: 6, padding: '.3rem .7rem', fontFamily: 'var(--mono)', fontSize: '.58rem', color: on ? 'var(--red)' : 'var(--green)', cursor: 'pointer' }}>
            {saving ? '…' : on ? 'Disable credit system' : 'Enable credit system'}
          </button>
        }
      />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.5rem' }}>
        <Stat l="Credits held" n={credits.total_balance ?? 0} />
        <Stat l="Users w/ credits" n={credits.total_users} />
        <Stat l="Pro users" n={credits.pro_users} />
        <Stat l="Total earned" n={credits.earned ?? 0} c="var(--green)" />
        <Stat l="Total spent" n={credits.spent ?? 0} c="var(--amber)" />
        <Stat l="System" n={on ? 'On' : 'Off'} c={on ? 'var(--green)' : 'var(--muted)'} />
      </div>
    </Card>
  )
}

export function FlagsPanel({ flags, token, onRefresh }: { flags: FeatureFlag[]; token: string; onRefresh: () => void }) {
  const [saving, setSaving] = useState<string | null>(null)
  const [seeding, setSeeding] = useState(false)
  // Optimistic local status overrides keyed by flag_name
  const [localStatus, setLocalStatus] = useState<Record<string, string>>({})

  async function setFlag(flagName: string, status: string) {
    setSaving(flagName)
    const prev = localStatus[flagName]
    setLocalStatus(s => ({ ...s, [flagName]: status }))
    try {
      const res = await fetch('/api/admin-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
        body: JSON.stringify({ action: 'set_flag', flag_name: flagName, status }),
      })
      const d = await res.json()
      if (!d.ok) throw new Error(d.error || String(res.status))
    } catch (e) {
      setLocalStatus(s => ({ ...s, [flagName]: prev ?? '' }))
      alert('✗ Failed to update flag: ' + (e as Error).message)
    }
    setSaving(null)
  }

  async function seed() {
    setSeeding(true)
    try {
      const res = await fetch('/api/admin-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
        body: JSON.stringify({ action: 'seed_flags' }),
      })
      const d = await res.json()
      if (!d.ok) throw new Error(d.error || String(res.status))
      setTimeout(onRefresh, 600)
    } catch (e) {
      setSeeding(false)
      alert('✗ ' + (e as Error).message)
    }
  }

  function effectiveStatus(f: FeatureFlag) { return localStatus[f.flag_name] || f.status }

  function row(f: FeatureFlag) {
    const status = effectiveStatus(f)
    return (
      <div key={f.flag_name} style={{ display: 'flex', alignItems: 'center', gap: '.5rem', padding: '.55rem 0', borderBottom: '1px solid var(--line2)', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 0, fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--white)', overflow: 'hidden' }}>
          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{FLAG_FRIENDLY[f.flag_name] || f.flag_name}</div>
          {f.description && <div style={{ fontFamily: 'var(--mono)', fontSize: '.48rem', color: 'var(--dim)', marginTop: '.1rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.description}</div>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.35rem', flexShrink: 0 }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: FLAG_STATUS_COLORS[status] || 'var(--muted)', whiteSpace: 'nowrap' }}>
            {saving === f.flag_name ? 'Saving…' : (FLAG_STATUS_LABELS[status] || status)}
          </div>
          <select
            value={status}
            disabled={saving === f.flag_name}
            onChange={e => setFlag(f.flag_name, e.target.value)}
            style={{ background: 'var(--raised)', border: '1px solid var(--line2)', borderRadius: 5, padding: '.18rem .4rem', fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--sub)', cursor: 'pointer' }}
          >
            {FLAG_STATUSES.map(s => <option key={s} value={s}>{FLAG_STATUS_LABELS[s]}</option>)}
          </select>
        </div>
      </div>
    )
  }

  const grouped = new Set(FLAG_GROUPS.flatMap(g => g.flags))
  const others = flags.filter(f => !grouped.has(f.flag_name) && !HIDDEN_FLAGS.has(f.flag_name))

  return (
    <Card style={{ marginBottom: '1.25rem' }}>
      <CardHeader
        title="Feature flags"
        action={
          <button onClick={seed} disabled={seeding} style={{ background: 'none', border: '1px solid var(--line2)', borderRadius: 6, padding: '.3rem .7rem', fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--sub)', cursor: 'pointer' }}>
            {seeding ? 'Creating…' : '+ Seed defaults'}
          </button>
        }
      />
      {flags.length === 0
        ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.75rem' }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--dim)' }}>No flags in database</div>
            <button onClick={seed} disabled={seeding} style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', padding: '.3rem .75rem', borderRadius: 6, border: '1px solid rgba(59,130,246,.4)', background: 'rgba(59,130,246,.1)', color: 'var(--blue)', cursor: 'pointer' }}>
              {seeding ? 'Creating…' : 'Initialize default flags →'}
            </button>
          </div>
        )
        : (
          <>
            {FLAG_GROUPS.map(grp => {
              const rows = grp.flags.map(name => flags.find(f => f.flag_name === name)).filter(Boolean) as FeatureFlag[]
              if (!rows.length) return null
              return (
                <div key={grp.group} style={{ marginBottom: '.4rem' }}>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: '.5rem', color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '.06em', margin: '.5rem 0 .15rem' }}>{grp.group}</div>
                  {rows.map(row)}
                </div>
              )
            })}
            {others.length > 0 && (
              <div style={{ marginBottom: '.4rem' }}>
                <div style={{ fontFamily: 'var(--mono)', fontSize: '.5rem', color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '.06em', margin: '.5rem 0 .15rem' }}>Other</div>
                {others.map(row)}
              </div>
            )}
          </>
        )
      }
    </Card>
  )
}

const CLUSTER_STATUSES = ['suspected', 'safe', 'watching', 'limited', 'frozen', 'suspended']
const CLUSTER_COLORS: Record<string, string> = {
  suspected: 'var(--amber)', watching: 'var(--blue)', limited: 'var(--red)',
  frozen: 'var(--red)', suspended: 'var(--red)', safe: 'var(--green)',
}

export function ClustersPanel({ clusters, suspected, token, onRefresh }: { clusters: DupCluster[]; suspected: number; token: string; onRefresh: () => void }) {
  const [scanning, setScanning] = useState(false)
  const [scanMsg, setScanMsg] = useState('')
  const [localStatus, setLocalStatus] = useState<Record<string, string>>({})

  async function updateCluster(clusterId: string, status: string) {
    const prev = localStatus[clusterId]
    setLocalStatus(s => ({ ...s, [clusterId]: status }))
    try {
      const res = await fetch('/api/admin-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
        body: JSON.stringify({ action: 'update_cluster', cluster_id: clusterId, status }),
      })
      const d = await res.json()
      if (!d.ok) throw new Error(d.error || res.status)
    } catch (e) {
      setLocalStatus(s => ({ ...s, [clusterId]: prev ?? '' }))
      alert('Failed to update cluster: ' + (e as Error).message)
    }
  }

  async function scan() {
    setScanning(true)
    setScanMsg('Scanning login signals…')
    try {
      const res = await fetch('/api/admin-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
        body: JSON.stringify({ action: 'detect_duplicates_by_signals' }),
      })
      const d = await res.json()
      if (!d.ok) throw new Error(d.error || res.status)
      setScanMsg(`✓ Found ${d.suspects} suspect groups — created ${d.clusters_created} new clusters`)
      setTimeout(onRefresh, 1200)
    } catch (e) {
      setScanMsg('Error: ' + (e as Error).message)
      setScanning(false)
    }
  }

  return (
    <Card style={{ marginBottom: '1.25rem' }}>
      <CardHeader
        title="Duplicate account clusters"
        action={
          <button onClick={scan} disabled={scanning} style={{ background: 'none', border: '1px solid var(--line2)', borderRadius: 6, padding: '.3rem .7rem', fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--sub)', cursor: 'pointer' }}>
            Scan signals
          </button>
        }
      />
      {scanMsg && <div style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: scanMsg.startsWith('✓') ? 'var(--green)' : scanMsg.startsWith('Error') ? 'var(--red)' : 'var(--dim)', marginBottom: '.6rem' }}>{scanMsg}</div>}
      {suspected > 0 && (
        <div style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--amber)', marginBottom: '.6rem' }}>
          {suspected} suspected cluster{suspected === 1 ? '' : 's'}
        </div>
      )}
      {clusters.length === 0
        ? <div style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--dim)' }}>No suspected clusters — click &quot;Scan signals&quot; to detect</div>
        : clusters.map(c => {
          const status = localStatus[c.id] || c.status
          return (
            <div key={c.id} style={{ padding: '.6rem 0', borderBottom: '1px solid var(--line2)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '.65rem', flexWrap: 'wrap' }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', fontWeight: 700, color: CLUSTER_COLORS[status] || 'var(--sub)', flexShrink: 0 }}>Risk {c.risk_score}/100</span>
                <span style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--dim)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.user_ids?.length || 0} accounts · {(c.signals || []).join(', ')}</span>
                <select
                  value={status}
                  onChange={e => updateCluster(c.id, e.target.value)}
                  style={{ background: 'var(--raised)', border: '1px solid var(--line2)', borderRadius: 5, padding: '.18rem .4rem', fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--sub)', cursor: 'pointer', marginLeft: 'auto' }}
                >
                  {CLUSTER_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
          )
        })
      }
    </Card>
  )
}

export function JobDedupePanel({ token }: { token: string }) {
  const [scanning, setScanning] = useState(false)
  const [deduping, setDeduping] = useState(false)
  const [suspected, setSuspected] = useState<number | null>(null)
  const [deleted, setDeleted] = useState<number | null>(null)
  const [msg, setMsg] = useState('')
  const [target, setTarget] = useState('20')
  const [targetSaving, setTargetSaving] = useState(false)
  const [targetMsg, setTargetMsg] = useState('')

  useEffect(() => {
    fetch('/api/admin-stats', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token }, body: JSON.stringify({ action: 'get_job_target' }) })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.target) setTarget(String(d.target)) })
      .catch(() => {})
  }, [token])

  async function saveTarget() {
    const n = parseInt(target, 10)
    if (!Number.isFinite(n) || n < 5 || n > 60) { setTargetMsg('✗ Enter a number 5–60'); return }
    setTargetSaving(true); setTargetMsg('')
    try {
      const r = await fetch('/api/admin-stats', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token }, body: JSON.stringify({ action: 'set_job_target', target: n }) })
      const d = await r.json()
      if (!d.ok) throw new Error(d.error || 'Save failed')
      setTargetMsg(`✓ Saved — searches now aggregate up to ${d.target}`)
    } catch (e) { setTargetMsg(`✗ ${(e as Error).message}`) }
    setTargetSaving(false)
  }

  async function scan() {
    setScanning(true); setMsg(''); setSuspected(null); setDeleted(null)
    try {
      const r = await fetch('/api/admin-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
        body: JSON.stringify({ action: 'scan_job_dupes' }),
      })
      const d = await r.json()
      if (!d.ok) throw new Error(d.error || 'Scan failed')
      setSuspected(d.suspected)
      setMsg(d.suspected === 0 ? '✓ No duplicates found' : `Found ${d.suspected} duplicate${d.suspected !== 1 ? 's' : ''} (exact apply_url match)`)
    } catch(e) { setMsg(`✗ ${(e as Error).message}`) }
    setScanning(false)
  }

  async function dedupe() {
    if (!confirm(`Remove ${suspected} duplicate job listing${suspected !== 1 ? 's' : ''}? This keeps the newest copy of each duplicate set and deletes the rest. Cannot be undone.`)) return
    setDeduping(true); setMsg('')
    try {
      const r = await fetch('/api/admin-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
        body: JSON.stringify({ action: 'dedupe_jobs' }),
      })
      const d = await r.json()
      if (!d.ok) throw new Error(d.error || 'Dedupe failed')
      setDeleted(d.deleted); setSuspected(0)
      setMsg(d.deleted === 0 ? '✓ No duplicates to remove' : `✓ Removed ${d.deleted} duplicate listing${d.deleted !== 1 ? 's' : ''}`)
    } catch(e) { setMsg(`✗ ${(e as Error).message}`) }
    setDeduping(false)
  }

  const btnBase: React.CSSProperties = { background: 'none', border: '1px solid var(--line2)', color: 'var(--sub)', borderRadius: 8, padding: '.4rem .9rem', fontFamily: 'var(--mono)', fontSize: '.6rem', cursor: 'pointer', transition: 'all .15s', whiteSpace: 'nowrap' }

  return (
    <Card style={{ marginBottom: '1.25rem' }}>
      <CardHeader
        title="Job deduplication"
        action={<span style={{ fontFamily: 'var(--mono)', fontSize: '.48rem', color: 'var(--dim)' }}>Exact match on apply_url — keeps newest copy</span>}
      />
      <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', marginBottom: msg ? '.65rem' : 0 }}>
        <button onClick={scan} disabled={scanning || deduping} style={{ ...btnBase, borderColor: 'var(--blue)', color: 'var(--blue)' }}>
          {scanning ? '⏳ Scanning…' : '⟳ Scan for dupes'}
        </button>
        {suspected !== null && suspected > 0 && (
          <button onClick={dedupe} disabled={deduping || scanning} style={{ ...btnBase, borderColor: 'var(--red)', color: 'var(--red)' }}>
            {deduping ? '⏳ Removing…' : `✕ Remove ${suspected} dupe${suspected !== 1 ? 's' : ''}`}
          </button>
        )}
      </div>
      {msg && <div style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: deleted != null && deleted > 0 ? 'var(--green)' : suspected === 0 ? 'var(--green)' : msg.startsWith('✗') ? 'var(--red)' : 'var(--amber)' }}>{msg}</div>}

      {/* Aggregation target */}
      <div style={{ marginTop: '.85rem', paddingTop: '.75rem', borderTop: '1px solid var(--line2)' }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: '.48rem', textTransform: 'uppercase', letterSpacing: '.12em', color: 'var(--dim)', marginBottom: '.4rem' }}>Aggregation target</div>
        <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--sub)' }}>Min listings per search</span>
          <input type="number" min={5} max={60} value={target} onChange={e => setTarget(e.target.value)}
            style={{ width: 64, background: 'var(--raised)', border: '1px solid var(--line2)', borderRadius: 6, padding: '.3rem .5rem', fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'var(--white)', outline: 'none' }} />
          <button onClick={saveTarget} disabled={targetSaving} style={{ ...btnBase, borderColor: 'var(--green)', color: 'var(--green)' }}>{targetSaving ? '⏳ Saving…' : 'Save'}</button>
        </div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: '.5rem', color: 'var(--dim)', marginTop: '.4rem' }}>
          If a search has fewer related listings than this, Seen pulls more from online and stores them. Higher = aggregate harder; lower = calm it down. (5–60)
        </div>
        {targetMsg && <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', marginTop: '.35rem', color: targetMsg.startsWith('✗') ? 'var(--red)' : 'var(--green)' }}>{targetMsg}</div>}
      </div>

      <div style={{ fontFamily: 'var(--mono)', fontSize: '.5rem', color: 'var(--dim)', marginTop: '.5rem' }}>
        Scan first to preview. Delete keeps the most recently seen copy. Run the SQL migration in <code style={{ color: 'var(--sub)' }}>014_job_dedup.sql</code> after deduping to block future dupes.
      </div>
    </Card>
  )
}

export function AllJobsBrowser({ token, onUnauthorized }: { token: string; onUnauthorized: () => void }) {
  const [groups, setGroups] = useState<JobGroup[]>([])
  const [totalJobs, setTotalJobs] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [companyJobs, setCompanyJobs] = useState<Record<string, RecentJob[]>>({})
  const [companyLoading, setCompanyLoading] = useState<string | null>(null)
  const COLLAPSED_COUNT = 10

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/admin-stats', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
          body: JSON.stringify({ action: 'get_jobs_grouped' }),
        })
        if (res.status === 401 || res.status === 403) { onUnauthorized(); return }
        const d = await res.json()
        if (!d.ok) throw new Error(d.error || String(res.status))
        setGroups(d.groups || [])
        setTotalJobs(d.total_jobs || 0)
      } catch (e) {
        setError((e as Error).message)
      }
      setLoading(false)
    }
    load()
  }, [token, onUnauthorized])

  async function toggleCompany(company: string) {
    if (expanded === company) { setExpanded(null); return }
    setExpanded(company)
    if (companyJobs[company]) return
    setCompanyLoading(company)
    try {
      const res = await fetch('/api/admin-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
        body: JSON.stringify({ action: 'get_company_jobs', company }),
      })
      if (res.status === 401 || res.status === 403) { onUnauthorized(); return }
      const d = await res.json()
      if (!d.ok) throw new Error(d.error)
      setCompanyJobs(prev => ({ ...prev, [company]: d.jobs || [] }))
    } catch (e) {
      setCompanyJobs(prev => ({ ...prev, [company]: [] }))
    }
    setCompanyLoading(null)
  }

  const filtered = search.trim()
    ? groups.filter(g => g.company.toLowerCase().includes(search.toLowerCase()))
    : groups
  // Keep the list short by default — show the first N, with a toggle to extend.
  // When filtering, always show all matches.
  const visible = (search.trim() || showAll) ? filtered : filtered.slice(0, COLLAPSED_COUNT)

  return (
    <Card style={{ marginBottom: '1.25rem' }}>
      <CardHeader title={`All job listings${totalJobs ? ` — ${totalJobs.toLocaleString()} total` : ''}`} />
      <div style={{ marginBottom: '.75rem' }}>
        <input
          type="text"
          placeholder="Filter by company…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            width: '100%', boxSizing: 'border-box',
            fontFamily: 'var(--mono)', fontSize: '.62rem',
            padding: '.35rem .6rem', borderRadius: 6,
            border: '1px solid var(--line2)', background: 'var(--bg2)',
            color: 'var(--white)', outline: 'none',
          }}
        />
      </div>
      {loading && <div style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--dim)' }}>Loading…</div>}
      {!loading && error && <div style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--red)' }}>✗ {error}</div>}
      {!loading && !error && filtered.length === 0 && (
        <div style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--dim)' }}>No companies match.</div>
      )}
      {!loading && !error && visible.map(g => {
        const isOpen = expanded === g.company
        const jobs = companyJobs[g.company] || []
        const isLoadingJobs = companyLoading === g.company
        return (
          <div key={g.company} style={{ borderBottom: '1px solid var(--line2)' }}>
            <div
              onClick={() => toggleCompany(g.company)}
              style={{ display: 'flex', alignItems: 'center', gap: '.6rem', padding: '.45rem 0', cursor: 'pointer' }}
            >
              <span style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--sub)', width: '.8rem', flexShrink: 0 }}>
                {isOpen ? '▾' : '▸'}
              </span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'var(--white)', flex: 1 }}>{g.company}</span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--dim)', flexShrink: 0 }}>
                {g.total} total · <span style={{ color: g.active > 0 ? 'var(--green)' : 'var(--dim)' }}>{g.active} active</span>
              </span>
            </div>
            {isOpen && (
              <div style={{ paddingLeft: '1.4rem', paddingBottom: '.5rem' }}>
                {isLoadingJobs && <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--dim)' }}>Loading…</div>}
                {!isLoadingJobs && jobs.length === 0 && <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--dim)' }}>No listings found.</div>}
                {!isLoadingJobs && jobs.map(j => {
                  const avail = j.availability_status || 'active'
                  return (
                    <div key={j.id} style={{ display: 'flex', alignItems: 'center', gap: '.6rem', padding: '.3rem 0', borderBottom: '1px solid var(--line2)' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--white)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {j.title || '—'}
                        </div>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', color: 'var(--dim)', marginTop: '.08rem' }}>
                          {j.city || '—'} · <span style={{ color: availColor(avail) }}>{avail}</span> · {relTime(j.created_at)}
                        </div>
                      </div>
                      {j.apply_url && (
                        <a href={j.apply_url} target="_blank" rel="noopener noreferrer" style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--blue)', textDecoration: 'none', flexShrink: 0 }}>↗</a>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
      {!loading && !error && !search.trim() && filtered.length > COLLAPSED_COUNT && (
        <button
          onClick={() => setShowAll(v => !v)}
          style={{ marginTop: '.6rem', fontFamily: 'var(--mono)', fontSize: '.58rem', padding: '.4rem .8rem', borderRadius: 6, border: '1px solid var(--line2)', background: 'transparent', color: 'var(--sub)', cursor: 'pointer', width: '100%' }}
        >
          {showAll ? `▴ Show less` : `▾ Show all ${filtered.length} companies`}
        </button>
      )}
    </Card>
  )
}

const DEPLOY_HOOK_KEY = 'seen_deploy_hook_url'

export function DeployPanel() {
  const [hookUrl, setHookUrl] = useState('')
  const [saved, setSaved] = useState('')
  const [input, setInput] = useState('')
  const [deploying, setDeploying] = useState(false)
  const [status, setStatus] = useState<{ text: string; color: string } | null>(null)
  const [showInput, setShowInput] = useState(false)

  useEffect(() => {
    const stored = safeLocalGet(DEPLOY_HOOK_KEY) || ''
    setSaved(stored)
    setHookUrl(stored)
  }, [])

  function saveHook() {
    const url = input.trim()
    if (!url.startsWith('https://')) { setStatus({ text: 'Paste the full Vercel deploy hook URL', color: 'var(--red)' }); return }
    safeLocalSet(DEPLOY_HOOK_KEY, url)
    setSaved(url)
    setHookUrl(url)
    setInput('')
    setShowInput(false)
    setStatus({ text: '✓ Deploy hook saved', color: 'var(--green)' })
    setTimeout(() => setStatus(null), 3000)
  }

  async function deploy() {
    if (!hookUrl) { setShowInput(true); return }
    setDeploying(true)
    setStatus({ text: 'Triggering deploy…', color: 'var(--dim)' })
    try {
      await fetch(hookUrl, { method: 'POST' })
      setStatus({ text: '✓ Deploy triggered — Vercel is building next-migration now', color: 'var(--green)' })
    } catch {
      setStatus({ text: '✗ Failed to reach Vercel. Check the hook URL.', color: 'var(--red)' })
    }
    setDeploying(false)
  }

  const masked = saved ? saved.slice(0, 40) + '…' : ''

  return (
    <Card style={{ marginBottom: '1.25rem', border: '1px solid rgba(99,102,241,.25)' }}>
      <CardHeader
        title="Deploy to production"
        action={
          saved ? (
            <button
              onClick={() => { setShowInput(s => !s); setStatus(null) }}
              style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', padding: '.25rem .6rem', borderRadius: 5, border: '1px solid var(--line2)', background: 'transparent', color: 'var(--dim)', cursor: 'pointer' }}
            >
              {showInput ? 'Cancel' : 'Change hook'}
            </button>
          ) : undefined
        }
      />

      {(!saved || showInput) && (
        <div style={{ marginBottom: '1rem' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--sub)', lineHeight: 1.65, marginBottom: '.65rem' }}>
            In Vercel → Seen project → Settings → find <span style={{ color: 'var(--white)' }}>Deploy Hooks</span> → create one for branch <span style={{ color: 'var(--blue)' }}>next-migration</span> → paste the URL below.
          </div>
          <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="https://api.vercel.com/v1/integrations/deploy/…"
              style={{ flex: 1, minWidth: 200, background: 'var(--raised)', border: '1px solid var(--line2)', borderRadius: 7, padding: '.42rem .65rem', fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--white)', outline: 'none' }}
            />
            <button
              onClick={saveHook}
              disabled={!input.trim()}
              style={{ background: 'rgba(99,102,241,.15)', border: '1px solid rgba(99,102,241,.35)', borderRadius: 7, padding: '.42rem .9rem', fontFamily: 'var(--mono)', fontSize: '.6rem', color: '#a5b4fc', cursor: 'pointer', flexShrink: 0 }}
            >
              Save →
            </button>
          </div>
        </div>
      )}

      {saved && !showInput && (
        <div style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', color: 'var(--dim)', marginBottom: '.85rem' }}>
          Hook: {masked}
        </div>
      )}

      <button
        onClick={deploy}
        disabled={deploying}
        style={{
          width: '100%',
          background: saved ? 'linear-gradient(135deg,rgba(99,102,241,.2),rgba(16,185,129,.15))' : 'var(--raised)',
          border: `1px solid ${saved ? 'rgba(99,102,241,.4)' : 'var(--line2)'}`,
          borderRadius: 9, padding: '.85rem 1.25rem',
          fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.95rem',
          color: saved ? '#a5b4fc' : 'var(--sub)',
          cursor: deploying ? 'not-allowed' : 'pointer', opacity: deploying ? 0.7 : 1,
          letterSpacing: '-.01em', textAlign: 'left' as const,
        }}
      >
        {deploying ? '⏳ Deploying…' : saved ? '🚀 Deploy latest Claude changes →' : '⚙ Paste deploy hook URL above to enable'}
        {saved && !deploying && (
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.56rem', fontWeight: 400, color: 'rgba(165,180,252,.55)', marginTop: '.2rem' }}>
            Pushes all Claude commits live in ~1 min
          </div>
        )}
      </button>

      {status && (
        <div style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: status.color, marginTop: '.65rem' }}>{status.text}</div>
      )}
    </Card>
  )
}

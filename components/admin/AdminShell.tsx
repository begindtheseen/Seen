'use client'

import { useState } from 'react'
import type { AdminStats, AttnItem, MergePrefill } from './types'
import { Panel, MetricRow, Card, CardHeader, Badge, BarChart, relTime, outcomeColor, stageColor, runRefreshAndClear, refreshResultMsg } from './primitives'
import { AdminHero, AdminCommandCenter, AdminMetricCard, CardSubLink, AdminAttentionQueue, AdminTabs, type HealthStatus, type TabKey } from './overview'
import { KpiModal, ManageAccountsModal, RevenueDetailModal, TrialsDetailModal, SharesDetailModal, ErrorsDetailModal } from './modals'
import { JobCrisisBanner, JobRefreshButton, JobRunner, ReportRow, IssueRow, InactiveRow, MergePanel, CompanyExportPanel, CreditsPanel, FlagsPanel, ClustersPanel, JobDedupePanel, AllJobsBrowser, DeployPanel } from './panels'

// The authenticated dashboard body. Owns local UI state (open modals, merge prefill,
// emergency-refresh status). `reload` re-fetches stats; `onLogout`/`onUnauthorized`
// bubble up to the page-level session controller.
export function AdminShell({ stats, token, reload, onLogout, onUnauthorized }: {
  stats: AdminStats
  token: string
  reload: () => void
  onLogout: () => void
  onUnauthorized: () => void
}) {
  const [mergePrefill, setMergePrefill] = useState<MergePrefill | null>(null)
  const [kpiModal, setKpiModal] = useState<{ metric: string; title: string } | null>(null)
  const [manageOpen, setManageOpen] = useState(false)
  const [manageFilter, setManageFilter] = useState<'all' | 'pro' | 'free'>('all')
  const [detail, setDetail] = useState<null | 'revenue' | 'trials' | 'shares' | 'errors'>(null)
  const [emgBusy, setEmgBusy] = useState(false)
  const [emgMsg, setEmgMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [tab, setTab] = useState<TabKey>('overview')
  function openKpi(metric: string, title: string) { setKpiModal({ metric, title }) }
  function openManage(f: 'all' | 'pro' | 'free') { setManageFilter(f); setManageOpen(true) }

  // Fetches the CSV payload; the actual save happens in CsvDownloadButton's
  // click handler (user-gesture-safe for iOS). Returns null on any failure.
  async function fetchCsv(): Promise<{ filename: string; content: string } | null> {
    try {
      const res = await fetch('/api/admin-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
        body: JSON.stringify({ action: 'export_csv' }),
      })
      const d = await res.json()
      if (d?.csv) return { filename: d.filename || 'seen-metrics.csv', content: d.csv }
      return null
    } catch { return null }
  }

  // Shared job-board remediation used by the Needs Attention rows. Backfills fresh listings
  // AND clears unconfirmed-stale rows, then surfaces a clear result (never a silent no-op)
  // and reloads so the stale count visibly drops.
  async function runEmergencyRefresh() {
    setEmgBusy(true); setEmgMsg(null)
    const r = await runRefreshAndClear(token)
    if (r.ok) {
      setEmgMsg({ ok: true, text: refreshResultMsg(r) })
      setTimeout(reload, 1500)
    } else {
      setEmgMsg({ ok: false, text: (r.error || 'refresh failed').slice(0, 120) })
    }
    setEmgBusy(false)
  }

  const topReportedMax = Math.max(...(stats.reports.top_companies || []).map(c => c.count), 1)
  const topLookupMax = Math.max(...(stats.company_lookups?.top || []).map(c => c.count), 1)
  const chartMax = Math.max(...(stats.reports.chart || []).map(d => d.count), 1)
  const needsReviewCount = (stats.reports.recent || []).filter(r => r.needs_review).length

  // ── Derive the command center from REAL response fields ONLY ────────────────
  const m = stats.monetization
  const jh = stats.job_health
  const jb = stats.jobs
  const fw = stats.flywheel
  const inactiveCount = (jb?.inactive_reports || []).length
  const staleJobs = jb?.stale_or_expired ?? 0
  const activeJobs = jh?.active ?? jb?.active ?? 0
  const paidUsers = m?.active_paid ?? m?.pro_users ?? 0
  const mrr = m?.mrr ?? null
  const shares = m?.outcome_card_shares ?? 0
  const errToday = stats.errors?.today ?? 0
  const dupSuspected = stats.duplicate_clusters?.suspected ?? 0
  const openIssues = stats.issues?.open ?? 0
  const stripeOn = !!m?.stripe_connected

  // Data-flywheel status phrase from real activity (product-critical panel).
  const fwActivity = shares + (fw?.job_searches_30d ?? 0) + (fw?.resume_scans_30d ?? 0) + stats.reports.today
  const fwStatus = shares === 0 && (fw?.job_searches_30d ?? 0) === 0 ? 'Not moving yet' : fwActivity < 25 ? 'Early activity' : 'Community data growing'

  // Needs Attention — actionable warnings from real data. A benign zero (0 canceled,
  // 0 errors) never appears; only zeros that ARE the problem do (per product spec).
  const attn: AttnItem[] = []
  if (jh?.crisis) attn.push({ key: 'crisis', sev: 'red', title: `Job board crisis — ${activeJobs.toLocaleString()} active listings`, detail: `${(jh.stale ?? 0).toLocaleString()} stale · only ${jh.active_pct}% of the corpus is live. Seekers see a dead board.`, action: { label: 'Refresh', onClick: runEmergencyRefresh, busy: emgBusy } })
  else if (staleJobs > 500) attn.push({ key: 'stale', sev: 'amber', title: `${staleJobs.toLocaleString()} stale / expired listings`, detail: 'A large slice of the job corpus is unavailable. Refresh to keep the board fresh.', action: { label: 'Refresh', onClick: runEmergencyRefresh, busy: emgBusy } })
  if (errToday > 10) attn.push({ key: 'errs', sev: 'red', title: `${errToday} API errors today`, detail: 'Error volume is elevated — see the failing routes.', action: { label: 'View', onClick: () => setDetail('errors') } })
  if (stripeOn && paidUsers === 0) attn.push({ key: 'norev', sev: 'amber', title: '0 paid users — revenue not activated yet', detail: 'Stripe is connected but there are no active paid subscriptions. Conversion has not started.', action: { label: 'View', onClick: () => setDetail('revenue') } })
  if ((m?.past_due ?? 0) > 0) attn.push({ key: 'pastdue', sev: 'amber', title: `${m!.past_due} subscription${m!.past_due === 1 ? '' : 's'} past due`, detail: 'Payment is failing — these accounts may churn without follow-up.', action: { label: 'View', onClick: () => setDetail('trials') } })
  if ((m?.trialing ?? 0) > 0) attn.push({ key: 'trials', sev: 'blue', title: `${m!.trialing} user${m!.trialing === 1 ? '' : 's'} trialing — watch conversion`, detail: 'Active trials in flight (cancelled trials excluded). Nudge them before the trial ends.', action: { label: 'View', onClick: () => setDetail('trials') } })
  if ((m?.canceling ?? 0) > 0) attn.push({ key: 'canceling', sev: 'amber', title: `${m!.canceling} subscription${m!.canceling === 1 ? '' : 's'} set to cancel`, detail: 'Cancelled but still live until period end — these will churn. Win them back before then.', action: { label: 'View', onClick: () => setDetail('trials') } })
  if (shares === 0) attn.push({ key: 'noshare', sev: 'blue', title: 'No outcome cards shared — flywheel not moving', detail: 'Outcome cards are the virality engine. Nothing has been shared yet.', action: { label: 'View', onClick: () => setDetail('shares') } })
  if (needsReviewCount > 0) attn.push({ key: 'review', sev: 'amber', title: `${needsReviewCount} report${needsReviewCount === 1 ? '' : 's'} need review`, detail: 'Flagged community reports are held out of scoring until cleared (Advanced tools → moderation).' })
  if (dupSuspected > 0) attn.push({ key: 'dup', sev: 'amber', title: `${dupSuspected} suspected duplicate account cluster${dupSuspected === 1 ? '' : 's'}`, detail: 'Shared-signal groups flagged for anti-Sybil review (Advanced tools → clusters).' })
  if (inactiveCount > 0) attn.push({ key: 'inactive', sev: 'amber', title: `${inactiveCount} reported inactive listing${inactiveCount === 1 ? '' : 's'}`, detail: 'Users flagged these jobs as no longer active — verify and remove (Advanced tools).' })
  if (openIssues > 0) attn.push({ key: 'issues', sev: 'amber', title: `${openIssues} open data-quality issue${openIssues === 1 ? '' : 's'}`, detail: 'Community-reported data problems awaiting resolution (Advanced tools → issues).' })

  // ── Overall health for the hero pill + one-sentence summary (real signals only) ──
  const hasWarnings = attn.some(a => a.sev === 'red' || a.sev === 'amber')
  const status: HealthStatus = jh?.crisis
    ? 'Critical'
    : (errToday > 10 || staleJobs > 500 || hasWarnings) ? 'Attention needed' : 'Healthy'

  let summary: string
  if (jh?.crisis) {
    summary = `The job board has collapsed to ${activeJobs.toLocaleString()} active listings — run an emergency refresh before anything else.`
  } else if (status === 'Attention needed') {
    const probs: string[] = []
    if (errToday > 10) probs.push(`${errToday} API errors today`)
    if (staleJobs > 500) probs.push(`${staleJobs.toLocaleString()} stale listings`)
    if (stripeOn && paidUsers === 0) probs.push('no paid conversions yet')
    if ((m?.past_due ?? 0) > 0) probs.push(`${m!.past_due} past-due subscription${m!.past_due === 1 ? '' : 's'}`)
    if ((m?.canceling ?? 0) > 0) probs.push(`${m!.canceling} set to cancel`)
    if (needsReviewCount > 0) probs.push(`${needsReviewCount} report${needsReviewCount === 1 ? '' : 's'} to review`)
    if (inactiveCount > 0) probs.push(`${inactiveCount} flagged listing${inactiveCount === 1 ? '' : 's'}`)
    if (openIssues > 0) probs.push(`${openIssues} data issue${openIssues === 1 ? '' : 's'}`)
    if (dupSuspected > 0) probs.push(`${dupSuspected} duplicate cluster${dupSuspected === 1 ? '' : 's'}`)
    const head = probs.length ? probs.slice(0, 3).join(', ') : 'a few items need a look'
    summary = head.charAt(0).toUpperCase() + head.slice(1) + ' — clear the queue below.'
  } else {
    summary = `Jobs are fresh, errors are low, and ${fwStatus === 'Not moving yet' ? 'the data flywheel is ready to start' : 'the data flywheel is moving'}.`
  }

  // Card status phrases (honest, per-metric)
  const revPhrase = mrr ? 'Revenue is moving' : stripeOn ? 'Not activated yet' : 'Stripe not connected'
  const jobsPhrase = jh?.crisis ? 'Board in crisis' : staleJobs > 500 ? 'Stale building up' : 'Board is fresh'

  return (
    <div className="page-full" style={{ background: 'radial-gradient(ellipse at 10% 0%,rgba(29,78,216,0.1) 0%,transparent 50%),radial-gradient(ellipse at 90% 10%,rgba(124,58,237,0.07) 0%,transparent 45%)' }}>
      <div className="adm-wrap">

        {/* 1. Hero — title, health pill, plain-English summary, session actions */}
        <AdminHero status={status} summary={summary} onRefresh={reload} fetchCsv={fetchCsv} onLogout={onLogout} />

        {/* Crisis banner stays prominent (one-click remediation) */}
        {jh?.crisis && <JobCrisisBanner health={jh} token={token} onRefresh={reload} />}

        {/* 2. Five core operating cards — every original pulse door preserved (sub-links open the second modal). */}
        <AdminCommandCenter>
          <AdminMetricCard label="Revenue" value={mrr != null ? `$${mrr.toLocaleString()}` : '$0'} phrase={revPhrase} tone={mrr ? 'green' : 'dim'}
            onClick={() => setDetail('revenue')}
            secondary={<>{paidUsers.toLocaleString()} paid · {m ? `${m.conversion_pct}%` : '0%'} conv{stripeOn && (m?.trialing ?? 0) > 0 ? <> · <CardSubLink onClick={() => setDetail('trials')}>{m!.trialing} trialing</CardSubLink></> : null}</>} />

          <AdminMetricCard label="Users" value={stats.users.total.toLocaleString()} phrase={`${stats.users.dau} active today`} tone="white"
            onClick={() => openManage('all')}
            secondary={<><CardSubLink onClick={() => openManage('pro')}>{paidUsers.toLocaleString()} Pro</CardSubLink> · {m ? m.free_users.toLocaleString() : '—'} free</>} />

          <AdminMetricCard label="Jobs" value={activeJobs.toLocaleString()} phrase={jobsPhrase} tone={jh?.crisis ? 'red' : 'blue'}
            onClick={() => openKpi('jobs_active', 'Active job listings')}
            secondary={<>{(jb?.added_today ?? jb?.new_today ?? 0).toLocaleString()} added today · <CardSubLink onClick={() => openKpi('jobs_stale', 'Stale & expired jobs')}>{staleJobs.toLocaleString()} stale</CardSubLink></>} />

          <AdminMetricCard label="Flywheel" value={stats.reports.total.toLocaleString()} phrase={fwStatus} tone={stats.reports.total > 0 ? 'green' : 'dim'}
            onClick={() => openKpi('total_reports', 'All reports')}
            secondary={<><CardSubLink onClick={() => setDetail('shares')}>{shares.toLocaleString()} shared</CardSubLink> · {fw ? fw.job_searches_30d.toLocaleString() : '—'} searches</>} />

          <AdminMetricCard label="System" value={errToday} phrase={errToday === 0 ? 'No API incidents' : `${errToday} error${errToday === 1 ? '' : 's'} today`} tone={errToday > 10 ? 'red' : errToday > 0 ? 'amber' : 'green'}
            onClick={() => setDetail('errors')}
            secondary={<>{jh?.crisis ? 'refresh behind' : 'refresh healthy'} · {stripeOn ? 'Stripe on' : 'Stripe off'}</>} />
        </AdminCommandCenter>

        {/* 3. Attention Queue */}
        <AdminAttentionQueue items={attn} emgMsg={emgMsg} />

        {/* 4. Section tabs — Overview stays hero + cards + queue; heavy tools tucked into tabs. */}
        <AdminTabs value={tab} onChange={setTab} />

        {tab === 'overview' && (
          <div className="a2-tabpanel a2-overview-hint">The command center above is your Overview. Pick a tab for detailed tools and data.</div>
        )}

        {tab === 'users' && (
          <div className="a2-tabpanel">
          <Panel title="Users" right={<span className="ac-panel-status">{stats.users.dau} active today</span>}>
            <MetricRow label="Total accounts" value={stats.users.total.toLocaleString()} status="all time" onClick={() => openKpi('total_accounts', 'All accounts')} />
            <MetricRow label="New today" value={stats.users.new_today} status="last 24h" tone={stats.users.new_today > 0 ? 'blue' : 'dim'} onClick={() => openKpi('new_today', 'New accounts today')} />
            <MetricRow label="New this week" value={stats.users.new_this_week} status="last 7 days" onClick={() => openKpi('new_this_week', 'New accounts this week')} />
            <MetricRow label="Free users" value={m ? m.free_users.toLocaleString() : '—'} status="not upgraded" tone="sub" />
            <MetricRow label="Paid users" value={paidUsers.toLocaleString()} status="Pro" tone={paidUsers ? 'green' : 'dim'} />
            <MetricRow label="Suspected duplicates" value={dupSuspected} status="shared-signal clusters" tone={dupSuspected > 0 ? 'amber' : 'dim'} />
            <button className="ac-btn" onClick={() => setManageOpen(true)}>Manage accounts →</button>
          </Panel>
          </div>
        )}

        {tab === 'jobs' && (
          <div className="a2-tabpanel">
          <Panel title="Jobs & Companies" right={staleJobs > 0 ? <JobRefreshButton token={token} onDone={reload} /> : <span className="ac-panel-status">{jh ? `${jh.active_pct}% live` : ''}</span>}>
            <MetricRow label="Total stored jobs" value={(jb?.total ?? 0).toLocaleString()} status="all statuses" onClick={() => openKpi('jobs_total', 'All stored jobs')} />
            <MetricRow label="Active listings" value={activeJobs.toLocaleString()} status="live jobs users see" tone={jh?.crisis ? 'red' : 'blue'} onClick={() => openKpi('jobs_active', 'Active job listings')} />
            <MetricRow label="Added today" value={jb?.added_today ?? jb?.new_today ?? 0} status="new listings" tone={(jb?.added_today ?? 0) > 0 ? 'green' : 'dim'} onClick={() => openKpi('jobs_today', 'Jobs added today')} />
            <MetricRow label="Stale / expired" value={staleJobs.toLocaleString()} status="flagged unavailable" tone={staleJobs > 500 ? 'amber' : 'dim'} onClick={() => openKpi('jobs_stale', 'Stale & expired jobs')} />
            <MetricRow label="Company scores" value={stats.companies.with_scores.toLocaleString()} status="graded companies" onClick={() => openKpi('companies_scored', 'Companies with scores')} />
            <MetricRow label="Reported inactive" value={inactiveCount} status="user-flagged listings" tone={inactiveCount > 0 ? 'amber' : 'dim'} />
          </Panel>
            {/* New job listings browser */}
            <AllJobsBrowser token={token} onUnauthorized={onUnauthorized} />

            {/* Job deduplication */}
            <JobDedupePanel token={token} />

            {/* Reported inactive listings */}
            <Card style={{ marginTop: '.65rem' }}>
              <CardHeader
                title="Reported inactive listings"
                badge={(stats.jobs?.inactive_reports || []).length > 0 ? <Badge n={stats.jobs.inactive_reports.length} color="var(--amber)" /> : undefined}
                action={<span style={{ fontFamily: 'var(--mono)', fontSize: '.48rem', color: 'var(--dim)' }}>User reports that a listing is no longer active</span>}
              />
              {(stats.jobs?.inactive_reports || []).length === 0
                ? <div style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--dim)' }}>No inactive reports this week</div>
                : (stats.jobs.inactive_reports || []).map(r => (<InactiveRow key={r.job_id} report={r} token={token} />))
              }
            </Card>
          </div>
        )}

        {tab === 'community' && (
          <div className="a2-tabpanel">
          <Panel title="Data Flywheel" right={<span className="ac-panel-status" style={{ color: fwStatus === 'Not moving yet' ? 'var(--dim)' : 'var(--green)' }}>{fwStatus}</span>}>
            <MetricRow label="Outcome cards shared" value={shares.toLocaleString()} status="virality signal" tone={shares > 0 ? 'blue' : 'dim'} />
            <MetricRow label="Community reports" value={stats.reports.total.toLocaleString()} status={`${stats.reports.today} today`} tone="green" onClick={() => openKpi('total_reports', 'All reports')} />
            <MetricRow label="Job searches (30d)" value={fw ? fw.job_searches_30d.toLocaleString() : '—'} status="tracker demand" tone="sub" />
            <MetricRow label="Résumé scans (30d)" value={fw ? fw.resume_scans_30d.toLocaleString() : '—'} status="intel surveys" tone="sub" />
            <MetricRow label="Companies scored" value={stats.companies.with_scores.toLocaleString()} status="with AI scores" onClick={() => openKpi('companies_scored', 'Companies with scores')} />
            <MetricRow label="Credits earned / spent" value={`${(stats.credits.earned ?? 0).toLocaleString()} / ${(stats.credits.spent ?? 0).toLocaleString()}`} status="engagement" tone="sub" />
          </Panel>

            {/* Company lookups setup note */}
            {stats.company_lookups && !stats.company_lookups.ready && (
              <div id="admSetupNote" style={{ background: 'rgba(245,158,11,.06)', border: '1px solid rgba(245,158,11,.2)', borderRadius: 10, padding: '1rem 1.1rem', marginBottom: '1rem' }}>
                <div style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--amber)', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '.5rem' }}>Enable company lookup tracking</div>
                <p style={{ fontSize: '.78rem', color: 'var(--sub)', marginBottom: '.75rem', lineHeight: 1.6 }}>Run this SQL in your Supabase SQL editor once to track which companies users are researching:</p>
                <pre style={{ background: 'rgba(0,0,0,.35)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 6, padding: '.75rem 1rem', fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'var(--white)', overflowX: 'auto', lineHeight: 1.7, margin: 0 }}>
                  {`CREATE TABLE IF NOT EXISTS search_logs (
  id bigserial PRIMARY KEY,
  query text NOT NULL,
  created_at timestamptz DEFAULT now()
);`}
                </pre>
              </div>
            )}

            {/* Reports chart */}
            <div className="adm-panel" style={{ marginBottom: '.65rem' }}>
              <div className="adm-panel-hdr">
                Reports submitted — last 30 days
                <span style={{ fontFamily: 'var(--mono)', fontSize: '.5rem', color: 'var(--dim)' }}>one bar = one day</span>
              </div>
              <div style={{ padding: '.85rem 1rem .6rem' }}>
                <div className="adm-chart-row">
                  {(stats.reports.chart || []).map(d => (
                    <div key={d.date} className="adm-chart-bar" style={{ height: `${chartMax > 0 ? (d.count / chartMax) * 100 : 0}%` }} title={`${d.date}: ${d.count}`} />
                  ))}
                </div>
                {stats.reports.chart && stats.reports.chart.length > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '.3rem 0 0', fontFamily: 'var(--mono)', fontSize: '.44rem', color: 'var(--dim)' }}>
                    {[0, 7, 14, 21, 29].map(i => (
                      <span key={i}>{stats.reports.chart[i]?.date?.slice(5) || ''}</span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Two-column: most reported + most researched */}
            <div className="adm-2col">
              <div className="adm-panel">
                <div className="adm-panel-hdr">Most reported companies <span style={{ color: 'var(--dim)', fontWeight: 400 }}>(30d)</span></div>
                <BarChart items={(stats.reports.top_companies || []).slice(0, 8).map(c => ({ label: c.company, value: c.count }))} max={topReportedMax} />
              </div>
              <div className="adm-panel">
                <div className="adm-panel-hdr">Most researched companies <span style={{ color: 'var(--dim)', fontWeight: 400 }}>(7d)</span></div>
                {stats.company_lookups?.ready
                  ? <BarChart items={(stats.company_lookups.top || []).slice(0, 8).map(c => ({ label: c.company, value: c.count }))} max={topLookupMax} green />
                  : <div style={{ padding: '.85rem 1rem', fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--dim)' }}>search_logs not set up</div>
                }
              </div>
            </div>

            {/* Outcome breakdown */}
            <div className="adm-panel" style={{ marginBottom: '.65rem' }}>
              <div className="adm-panel-hdr">Report outcome breakdown <span style={{ color: 'var(--dim)', fontWeight: 400 }}>(30d)</span></div>
              <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', padding: '.75rem 1rem' }}>
                {Object.entries(stats.reports.outcome_breakdown ?? {}).filter(([, v]) => (v as number) > 0).map(([outcome, count]) => (
                  <div key={outcome} style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', padding: '.35rem .75rem', borderRadius: 6, background: outcomeColor(outcome) + '18', color: outcomeColor(outcome), border: `1px solid ${outcomeColor(outcome)}30` }}>
                    {outcome}: {count as number}
                  </div>
                ))}
              </div>
            </div>

            {/* Recent hiring reports (moderation) */}
            <Card style={{ marginTop: '.65rem' }}>
              <CardHeader title="Recent hiring reports (last 25)" badge={needsReviewCount > 0 ? <Badge n={needsReviewCount} /> : undefined} />
              {(stats.reports.recent || []).length === 0
                ? <div style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--dim)' }}>No reports yet</div>
                : (stats.reports.recent || []).map(r => (<ReportRow key={r.id} report={r} token={token} onRefresh={reload} />))
              }
            </Card>

            {/* Recent tracker applications */}
            <Card style={{ marginTop: '.65rem' }}>
              <CardHeader title="Recent tracker applications (last 25)" />
              {(stats.applications.recent || []).length === 0
                ? <div style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--muted)' }}>No applications tracked yet</div>
                : (stats.applications.recent || []).map(a => (
                  <div key={a.id} className="adm-row" style={{ margin: '0 -1rem', borderLeft: `3px solid ${stageColor(a.stage)}`, gap: '.6rem' }}>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: stageColor(a.stage), background: stageColor(a.stage) + '18', border: `1px solid ${stageColor(a.stage)}30`, borderRadius: 4, padding: '.1rem .4rem', flexShrink: 0 }}>{a.stage}</span>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--white)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.company_name} · {a.role}</span>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--muted)', flexShrink: 0 }}>{relTime(a.created_at)}</span>
                  </div>
                ))
              }
            </Card>

            {/* Data quality issues queue */}
            <Card style={{ marginTop: '.65rem' }}>
              <CardHeader
                title="Data quality issues"
                badge={stats.issues?.open > 0 ? <Badge n={stats.issues.open} /> : undefined}
                action={<button onClick={reload} style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', padding: '.3rem .75rem', borderRadius: 6, border: '1px solid var(--line2)', background: 'transparent', color: 'var(--sub)', cursor: 'pointer' }}>↻ Refresh</button>}
              />
              {(stats.issues?.items || []).length === 0
                ? <div style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--green)' }}>✓ No open issues</div>
                : (stats.issues.items || []).map(issue => (
                  <IssueRow key={issue.id} issue={issue} token={token} onRefresh={reload} onOpenMerge={name => setMergePrefill({ primary: name, secondary: '', nonce: Date.now() })} />
                ))
              }
            </Card>

            {/* Company deduplication */}
            <MergePanel token={token} prefill={mergePrefill} />

          </div>
        )}

        {tab === 'revenue' && (
          <div className="a2-tabpanel">
          <Panel title="Revenue" right={<span className="ac-panel-status" style={{ color: mrr ? 'var(--green)' : 'var(--dim)' }}>{mrr ? 'Revenue is moving' : 'Not active yet'}</span>}>
            <MetricRow label="MRR" value={mrr != null ? `$${mrr.toLocaleString()}` : '$0'} status={m?.mrr_annualized != null ? `$${m.mrr_annualized.toLocaleString()}/yr` : (stripeOn ? 'no active subs' : 'Stripe not connected')} tone={mrr ? 'green' : 'dim'} />
            <MetricRow label="Paid users" value={paidUsers.toLocaleString()} status={m ? `${m.conversion_pct}% of ${m.total_accounts.toLocaleString()}` : ''} tone={paidUsers ? 'green' : 'dim'} />
            <MetricRow label="On trial" value={stripeOn ? (m?.trialing ?? 0) : '—'} status="trialing now" tone={(m?.trialing ?? 0) > 0 ? 'blue' : 'dim'} />
            <MetricRow label="Canceling" value={stripeOn ? (m?.canceling ?? 0) : '—'} status="cancels at period end" tone={(m?.canceling ?? 0) > 0 ? 'amber' : 'dim'} />
            <MetricRow label="Past due" value={stripeOn ? (m?.past_due ?? 0) : '—'} status="payment failing" tone={(m?.past_due ?? 0) > 0 ? 'amber' : 'dim'} />
            <MetricRow label="Canceled" value={stripeOn ? (m?.canceled ?? 0) : '—'} status="churned" tone={(m?.canceled ?? 0) > 0 ? 'red' : 'dim'} />
            <MetricRow label="Conversion" value={m ? `${m.conversion_pct}%` : '—'} status="free → paid" tone="sub" />
            {!stripeOn && <div className="ac-panel-foot">Stripe not connected — trial / paid / MRR breakdown unavailable.</div>}
          </Panel>
          </div>
        )}

        {tab === 'system' && (
          <div className="a2-tabpanel">
          <Panel title="System Health" right={<span className="ac-panel-status" style={{ color: (errToday > 0 || jh?.crisis) ? 'var(--amber)' : 'var(--green)' }}>{(errToday > 0 || jh?.crisis) ? 'Attention needed' : 'All systems normal'}</span>}>
          <MetricRow label="API errors today" value={errToday} status="last 24h" tone={errToday > 10 ? 'red' : errToday > 0 ? 'amber' : 'green'} />
          <MetricRow label="API errors this week" value={stats.errors?.this_week ?? 0} status="last 7 days" tone={(stats.errors?.this_week ?? 0) > 0 ? 'amber' : 'dim'} />
          <MetricRow label="Active users today" value={stats.users.dau} status="DAU" tone="sub" />
          <MetricRow label="Job refresh" value={jh?.crisis ? 'Behind' : 'Healthy'} status={jh ? `${jh.active_pct}% corpus live` : ''} tone={jh?.crisis ? 'red' : 'green'} />
          {stats.errors?.recent && stats.errors.recent.length > 0 ? (
            <div className="ac-panel-foot">
              <div style={{ marginBottom: '.35rem', color: 'var(--sub)' }}>Recent errors by route</div>
              {stats.errors.recent.slice(0, 4).map((e, i) => (
                <div key={i} style={{ padding: '.15rem 0', color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <span style={{ color: 'var(--dim)' }}>{relTime(e.created_at)}</span> · <span style={{ color: 'var(--sub)' }}>{e.endpoint}</span> · {e.error_msg?.slice(0, 50)}
                </div>
              ))}
            </div>
          ) : <div className="ac-panel-foot" style={{ color: 'var(--green)' }}>✓ No system issues detected.</div>}
        </Panel>
            {/* Background job runner */}
            <JobRunner token={token} />
          </div>
        )}

        {tab === 'advanced' && (
          <div className="a2-tabpanel">
            {/* Per-company evidentiary export */}
            <CompanyExportPanel token={token} />

            {/* Credits overview + master toggle */}
            <CreditsPanel credits={stats.credits} flags={stats.feature_flags || []} token={token} onRefresh={reload} />

            {/* Feature flags */}
            <FlagsPanel flags={stats.feature_flags || []} token={token} onRefresh={reload} />

            {/* Duplicate account clusters */}
            <ClustersPanel clusters={stats.duplicate_clusters?.items || []} suspected={stats.duplicate_clusters?.suspected || 0} token={token} onRefresh={reload} />

            {/* Deploy trigger */}
            <DeployPanel />

          </div>
        )}

      </div>

      {kpiModal && (
        <KpiModal metric={kpiModal.metric} title={kpiModal.title} token={token} onClose={() => setKpiModal(null)} />
      )}
      {manageOpen && (
        <ManageAccountsModal token={token} initialFilter={manageFilter} onClose={() => setManageOpen(false)} />
      )}
      {detail === 'revenue' && <RevenueDetailModal m={stats.monetization} onClose={() => setDetail(null)} />}
      {detail === 'trials' && <TrialsDetailModal token={token} onClose={() => setDetail(null)} />}
      {detail === 'shares' && <SharesDetailModal m={stats.monetization} onClose={() => setDetail(null)} />}
      {detail === 'errors' && <ErrorsDetailModal errors={stats.errors} onClose={() => setDetail(null)} />}
    </div>
  )
}

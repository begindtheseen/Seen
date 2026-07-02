'use client'

import { useState, useEffect } from 'react'
import type { AdminStats, Sub, Tone } from './types'
import { UserRow } from './UserRow'
import { DetailModal, DetailStat, relTime } from './primitives'

export function KpiDetailRows({ metric, rows, token, onDeleteRow }: { metric: string; rows: Record<string, unknown>[]; token: string; onDeleteRow: (id: string) => void }) {
  const cell = (txt: unknown, color?: string) => (
    <span style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: color || 'var(--sub)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{String(txt ?? '—')}</span>
  )
  const ts = (iso: unknown) => {
    if (!iso) return '—'
    const d = new Date(String(iso)), now = Date.now(), diff = now - d.getTime(), m = Math.floor(diff / 60000)
    if (m < 60) return `${m}m ago`
    const h = Math.floor(m / 60)
    if (h < 24) return `${h}h ago`
    return `${Math.floor(h / 24)}d ago`
  }

  // Users group — with per-row delete (full admins only; server enforces role)
  if (['total_accounts','new_today','new_this_week'].includes(metric)) {
    return <div style={{ display: 'flex', flexDirection: 'column', gap: '.45rem' }}>
      {rows.map((r, i) => (
        <UserRow key={String(r.id ?? i)} r={r} token={token} onDeleted={onDeleteRow} ts={ts} />
      ))}
    </div>
  }

  // Companies scored
  if (metric === 'companies_scored') {
    return <div style={{ display: 'flex', flexDirection: 'column', gap: '.45rem' }}>
      {rows.map((r, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '.5rem', padding: '.5rem .6rem', background: 'var(--card)', borderRadius: 7, alignItems: 'center' }}>
          {cell(r.company, 'var(--white)')}
          {cell(`${Math.round(Number(r.score || 0))}`, Number(r.score) > 65 ? 'var(--green)' : Number(r.score) > 40 ? 'var(--amber)' : 'var(--red)')}
          {cell(ts(r.created_at))}
        </div>
      ))}
    </div>
  }

  // Reports group
  if (['total_reports','reports_today','reports_week','ghost_rate'].includes(metric)) {
    const outColor = (o: unknown) => {
      const s = String(o)
      if (s === 'ghosted') return 'var(--red)'
      if (s === 'rejected' || s === 'autoreject') return 'var(--amber)'
      if (s === 'interview' || s === 'human') return 'var(--blue)'
      if (s === 'offer' || s === 'hired') return 'var(--green)'
      return 'var(--dim)'
    }
    return <div style={{ display: 'flex', flexDirection: 'column', gap: '.45rem' }}>
      {rows.map((r, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '.5rem', padding: '.5rem .6rem', background: 'var(--card)', borderRadius: 7, alignItems: 'center' }}>
          {cell(r.company_name || r.company, 'var(--white)')}
          {cell(r.outcome, outColor(r.outcome))}
          {cell(ts(r.created_at || r.updated_at))}
        </div>
      ))}
    </div>
  }

  // Apps group
  if (['apps_total','ghosted_30d','hired_30d'].includes(metric)) {
    const statusColor = (s: unknown) => {
      const v = String(s)
      if (v === 'ghosted') return 'var(--red)'
      if (v === 'hired') return 'var(--green)'
      if (v === 'rejected') return 'var(--amber)'
      return 'var(--sub)'
    }
    return <div style={{ display: 'flex', flexDirection: 'column', gap: '.45rem' }}>
      {rows.map((r, i) => (
        <div key={i} style={{ padding: '.5rem .6rem', background: 'var(--card)', borderRadius: 7 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '.5rem', marginBottom: '.2rem' }}>
            {cell(r.company_name, 'var(--white)')}
            {cell(r.status, statusColor(r.status))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '.5rem' }}>
            {cell(r.role || '—')}
            {cell(ts(r.created_at || r.updated_at))}
          </div>
        </div>
      ))}
    </div>
  }

  // Co. lookups
  if (metric === 'co_lookups') {
    return <div style={{ display: 'flex', flexDirection: 'column', gap: '.45rem' }}>
      {rows.map((r, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '.5rem', padding: '.5rem .6rem', background: 'var(--card)', borderRadius: 7, alignItems: 'center' }}>
          {cell(r.query, 'var(--white)')}
          {cell(ts(r.created_at))}
        </div>
      ))}
    </div>
  }

  // Jobs group (total/active/today/stale)
  return <div style={{ display: 'flex', flexDirection: 'column', gap: '.45rem' }}>
    {rows.map((r, i) => (
      <div key={i} style={{ padding: '.5rem .6rem', background: 'var(--card)', borderRadius: 7 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '.5rem', marginBottom: '.2rem' }}>
          {cell(r.company, 'var(--white)')}
          {cell(r.availability_status || 'active', r.availability_status === 'stale' ? 'var(--amber)' : r.availability_status === 'expired' ? 'var(--red)' : 'var(--green)')}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '.5rem' }}>
          {cell(r.title)}
          {cell(ts(r.created_at || r.last_seen_at))}
        </div>
      </div>
    ))}
  </div>
}

export function KpiModal({ metric, title, token, onClose }: { metric: string; title: string; token: string; onClose: () => void }) {
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null)

  useEffect(() => {
    fetch('/api/admin-stats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
      body: JSON.stringify({ action: 'get_kpi_detail', metric }),
    }).then(r => r.json()).then(d => setRows(d.rows || [])).catch(() => setRows([]))
  }, [metric, token])

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.72)', zIndex: 300, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
      onClick={onClose}
    >
      <div
        style={{ background: 'var(--surface)', borderRadius: '14px 14px 0 0', width: '100%', maxWidth: 640, maxHeight: '82vh', display: 'flex', flexDirection: 'column', animation: 'fadeUp .22s ease both' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem 1.25rem .75rem', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
          <div style={{ fontFamily: 'var(--display)', fontWeight: 700, fontSize: '.95rem', color: 'var(--white)' }}>{title}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--dim)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '.9rem', padding: '.2rem .4rem', lineHeight: 1 }}>✕</button>
        </div>
        {/* Body */}
        <div style={{ overflow: 'auto', flex: 1, padding: '.75rem 1.25rem 2rem' }}>
          {rows === null ? (
            <div style={{ textAlign: 'center', padding: '2.5rem', fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'var(--dim)' }}>Loading…</div>
          ) : !rows.length ? (
            <div style={{ textAlign: 'center', padding: '2.5rem', fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'var(--dim)' }}>No data yet</div>
          ) : (
            <KpiDetailRows metric={metric} rows={rows} token={token} onDeleteRow={(id) => setRows(rs => (rs || []).filter(r => String(r.id) !== id))} />
          )}
        </div>
      </div>
    </div>
  )
}

// Manage accounts — reuses the get_kpi_detail(total_accounts) fetch (same data that powers
// the users drill-down) + the existing UserRow (grant-credits input + type-to-confirm delete).
// Adds an email search filter. Own scroll area, iPhone safe-area aware, mobile mini-cards.
export function ManageAccountsModal({ token, initialFilter = 'all', onClose }: { token: string; initialFilter?: 'all' | 'pro' | 'free'; onClose: () => void }) {
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<'all' | 'pro' | 'free'>(initialFilter)

  useEffect(() => {
    fetch('/api/admin-stats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
      body: JSON.stringify({ action: 'get_kpi_detail', metric: 'total_accounts' }),
    }).then(r => r.json()).then(d => setRows(d.rows || [])).catch(() => setRows([]))
  }, [token])

  const ts = (iso: unknown) => {
    if (!iso) return '—'
    const d = new Date(String(iso)), m = Math.floor((Date.now() - d.getTime()) / 60000)
    if (m < 60) return `${m}m ago`
    const h = Math.floor(m / 60)
    if (h < 24) return `${h}h ago`
    return `${Math.floor(h / 24)}d ago`
  }

  const needle = q.trim().toLowerCase()
  const proCount = (rows || []).filter(r => r.pro).length
  const filtered = (rows || []).filter(r =>
    (!needle || String(r.email ?? '').toLowerCase().includes(needle)) &&
    (filter === 'all' || (filter === 'pro' ? !!r.pro : !r.pro))
  )
  const segStyle = (active: boolean): React.CSSProperties => ({
    flex: 1, background: active ? 'rgba(59,130,246,.18)' : 'transparent', border: `1px solid ${active ? 'rgba(59,130,246,.5)' : 'var(--line2)'}`,
    borderRadius: 6, padding: '.32rem .5rem', fontFamily: 'var(--mono)', fontSize: '.56rem', color: active ? 'var(--blue)' : 'var(--dim)', cursor: 'pointer', whiteSpace: 'nowrap',
  })

  return (
    <div className="ac-modal" onClick={onClose}>
      <div className="ac-modal-card" onClick={e => e.stopPropagation()}>
        <div className="ac-modal-hdr">
          <div>
            <div className="ac-modal-ttl">Manage accounts</div>
            <div className="ac-modal-sub">{rows === null ? 'Loading…' : `${rows.length} account${rows.length === 1 ? '' : 's'} · ${proCount} Pro${needle || filter !== 'all' ? ` · ${filtered.length} shown` : ''} · newest 100`}</div>
          </div>
          <button className="ac-modal-x" onClick={onClose}>✕</button>
        </div>
        <div className="ac-modal-search">
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Filter by email…" autoComplete="off" />
          <div style={{ display: 'flex', gap: '.4rem', marginTop: '.5rem' }}>
            <button type="button" style={segStyle(filter === 'all')} onClick={() => setFilter('all')}>All</button>
            <button type="button" style={segStyle(filter === 'pro')} onClick={() => setFilter('pro')}>Pro</button>
            <button type="button" style={segStyle(filter === 'free')} onClick={() => setFilter('free')}>Free</button>
          </div>
        </div>
        <div className="ac-modal-body">
          {rows === null ? (
            <div style={{ textAlign: 'center', padding: '2rem', fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'var(--dim)' }}>Loading accounts…</div>
          ) : !filtered.length ? (
            <div style={{ textAlign: 'center', padding: '2rem', fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'var(--dim)' }}>{needle ? 'No accounts match that email.' : filter === 'pro' ? 'No Pro accounts yet.' : filter === 'free' ? 'No free accounts.' : 'No accounts yet.'}</div>
          ) : (
            filtered.map((r, i) => (
              <UserRow key={String(r.id ?? i)} r={r} token={token} ts={ts} onDeleted={id => setRows(rs => (rs || []).filter(x => String(x.id) !== id))} />
            ))
          )}
        </div>
      </div>
    </div>
  )
}

const STRIPE_SUBS_URL = 'https://dashboard.stripe.com/subscriptions'
function stripeLinkStyle(): React.CSSProperties {
  return { display: 'inline-flex', alignItems: 'center', gap: '.35rem', marginTop: '.9rem', fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--blue)', textDecoration: 'none', border: '1px solid rgba(59,130,246,.35)', borderRadius: 7, padding: '.45rem .7rem', background: 'rgba(59,130,246,.08)' }
}

// MRR tile → revenue breakdown from stats.monetization (NO new fetch) + Stripe deep link.
export function RevenueDetailModal({ m, onClose }: { m: AdminStats['monetization']; onClose: () => void }) {
  const stripeOn = !!m?.stripe_connected
  const money = (n: number | null | undefined) => (n != null ? `$${n.toLocaleString()}` : '—')
  return (
    <DetailModal title="Revenue" sub={stripeOn ? 'Live from Stripe' : 'Stripe not connected'} onClose={onClose}>
      {!stripeOn ? (
        <div style={{ textAlign: 'center', padding: '2rem', fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'var(--dim)' }}>Stripe not connected — revenue breakdown unavailable.</div>
      ) : (
        <>
          <DetailStat label="MRR" value={money(m?.mrr)} status="monthly recurring" tone={m?.mrr ? 'green' : 'dim'} />
          <DetailStat label="Annualized" value={money(m?.mrr_annualized)} status="run rate / yr" tone={m?.mrr_annualized ? 'green' : 'dim'} />
          <DetailStat label="Active paid" value={(m?.active_paid ?? 0).toLocaleString()} status="paying now" tone={(m?.active_paid ?? 0) > 0 ? 'green' : 'dim'} />
          <DetailStat label="Trialing" value={(m?.trialing ?? 0).toLocaleString()} status="in trial" tone={(m?.trialing ?? 0) > 0 ? 'blue' : 'dim'} />
          <DetailStat label="Canceling" value={(m?.canceling ?? 0).toLocaleString()} status="cancels at period end" tone={(m?.canceling ?? 0) > 0 ? 'amber' : 'dim'} />
          <DetailStat label="Past due" value={(m?.past_due ?? 0).toLocaleString()} status="payment failing" tone={(m?.past_due ?? 0) > 0 ? 'amber' : 'dim'} />
          <DetailStat label="Canceled" value={(m?.canceled ?? 0).toLocaleString()} status="churned" tone={(m?.canceled ?? 0) > 0 ? 'red' : 'dim'} />
          <DetailStat label="Conversion" value={m ? `${m.conversion_pct}%` : '—'} status="free → paid" tone="sub" />
          <a href={STRIPE_SUBS_URL} target="_blank" rel="noopener noreferrer" style={stripeLinkStyle()}>Manage in Stripe ↗</a>
        </>
      )}
    </DetailModal>
  )
}

// Trials tile → real subscription list (list_subscriptions). Read-only + per-row Stripe link.
export function TrialsDetailModal({ token, onClose }: { token: string; onClose: () => void }) {
  const [data, setData] = useState<{ subscriptions: Sub[]; stripe_connected: boolean; error?: string } | null>(null)
  useEffect(() => {
    fetch('/api/admin-stats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
      body: JSON.stringify({ action: 'list_subscriptions' }),
    }).then(r => r.json()).then(d => setData({ subscriptions: d.subscriptions || [], stripe_connected: !!d.stripe_connected, error: d.error })).catch(() => setData({ subscriptions: [], stripe_connected: false, error: 'Network error' }))
  }, [token])

  const statusTone = (s: string): Tone => s === 'trialing' ? 'blue' : s === 'active' ? 'green' : s === 'past_due' || s === 'unpaid' ? 'amber' : s === 'canceled' ? 'red' : 'sub'
  const fmtDate = (unix: number | null) => unix ? new Date(unix * 1000).toLocaleDateString() : '—'
  // Trialing subs first (this is the Trials door), then the rest.
  const subs = (data?.subscriptions || []).slice().sort((a, b) => (a.status === 'trialing' ? -1 : 0) - (b.status === 'trialing' ? -1 : 0))
  const trialCount = subs.filter(s => s.status === 'trialing').length

  return (
    <DetailModal title="Trials & subscriptions" sub={data === null ? 'Loading…' : data.stripe_connected ? `${trialCount} trialing · ${subs.length} total` : 'Stripe not connected'} onClose={onClose}>
      {data === null ? (
        <div style={{ textAlign: 'center', padding: '2rem', fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'var(--dim)' }}>Loading subscriptions…</div>
      ) : !data.stripe_connected ? (
        <div style={{ textAlign: 'center', padding: '2rem', fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'var(--dim)' }}>Stripe not connected — no subscriptions to show.</div>
      ) : !subs.length ? (
        <div style={{ textAlign: 'center', padding: '2rem', fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'var(--dim)' }}>{data.error ? `Stripe error: ${data.error}` : 'No subscriptions yet.'}</div>
      ) : (
        subs.map(s => (
          <div key={s.id} className="ac-acct">
            <div className="ac-acct-top">
              <span className="ac-acct-email">{s.email || s.customer || s.id}</span>
              <span className="ac-acct-age" style={{ color: `var(--${statusTone(s.status) === 'white' ? 'sub' : statusTone(s.status)})` }}>{s.status}{s.cancel_at_period_end ? ' · canceling' : ''}</span>
            </div>
            <div className="ac-acct-actions" style={{ justifyContent: 'space-between' }}>
              <span style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', color: 'var(--dim)' }}>
                {s.status === 'trialing' ? `trial ends ${fmtDate(s.trial_end)}` : `renews ${fmtDate(s.current_period_end)}`}
              </span>
              <a href={`${STRIPE_SUBS_URL}/${s.id}`} target="_blank" rel="noopener noreferrer" style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', color: 'var(--blue)', textDecoration: 'none', border: '1px solid rgba(59,130,246,.3)', borderRadius: 5, padding: '.22rem .45rem' }}>Open in Stripe ↗</a>
            </div>
          </div>
        ))
      )}
    </DetailModal>
  )
}

// Cards-shared tile → per-channel share breakdown from stats.monetization (NO new fetch).
export function SharesDetailModal({ m, onClose }: { m: AdminStats['monetization']; onClose: () => void }) {
  const total = m?.outcome_card_shares ?? 0
  const channels = Object.entries(m?.shares_by_channel || {}).sort((a, b) => (b[1] as number) - (a[1] as number))
  return (
    <DetailModal title="Outcome cards shared" sub={`${total.toLocaleString()} total`} onClose={onClose}>
      {!channels.length ? (
        <div style={{ textAlign: 'center', padding: '2rem', fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'var(--dim)' }}>No outcome cards shared yet — the virality flywheel has not started.</div>
      ) : (
        channels.map(([ch, n]) => (
          <DetailStat key={ch} label={ch} value={(n as number).toLocaleString()} status="shares" tone={(n as number) > 0 ? 'blue' : 'dim'} />
        ))
      )}
    </DetailModal>
  )
}

// API tile → recent errors + by-route breakdown from stats.errors (NO new fetch).
export function ErrorsDetailModal({ errors, onClose }: { errors: AdminStats['errors']; onClose: () => void }) {
  const recent = errors?.recent || []
  const byRoute = Object.entries(errors?.by_route || {}).sort((a, b) => (b[1] as number) - (a[1] as number))
  return (
    <DetailModal title="API errors" sub={`${errors?.today ?? 0} today · ${errors?.this_week ?? 0} this week`} onClose={onClose}>
      {!recent.length && !byRoute.length ? (
        <div style={{ textAlign: 'center', padding: '2rem', fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'var(--green)' }}>✓ No API errors logged.</div>
      ) : (
        <>
          {byRoute.length > 0 && (
            <>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', color: 'var(--sub)', textTransform: 'uppercase', letterSpacing: '.1em', margin: '.2rem 0 .35rem' }}>By route</div>
              {byRoute.map(([route, n]) => (
                <DetailStat key={route} label={route} value={(n as number).toLocaleString()} status="errors" tone={(n as number) > 10 ? 'red' : 'amber'} />
              ))}
            </>
          )}
          {recent.length > 0 && (
            <>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', color: 'var(--sub)', textTransform: 'uppercase', letterSpacing: '.1em', margin: '.9rem 0 .35rem' }}>Recent</div>
              {recent.map((e, i) => (
                <div key={i} style={{ padding: '.5rem .6rem', background: 'var(--card)', borderRadius: 7, marginBottom: '.4rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '.5rem' }}>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--white)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.endpoint}</span>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', color: 'var(--dim)', flexShrink: 0 }}>{relTime(e.created_at)}</span>
                  </div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: '.54rem', color: 'var(--red)', marginTop: '.2rem', lineHeight: 1.4 }}>{e.error_msg}</div>
                </div>
              ))}
            </>
          )}
        </>
      )}
    </DetailModal>
  )
}

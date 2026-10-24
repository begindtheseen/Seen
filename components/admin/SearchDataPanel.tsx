'use client'

// Admin → Community → "Search demand": what people searched on Google and Bing before they saw a Seen page
// (last 28 days of public.search_daily, filled daily by api/cron-search-data.js). Shows freshness, the weekly
// digest (movers, new striking-distance queries, low-CTR pages, companies people search that need reports) and
// the intent mix. Read-only; raw queries are shown here (admin) and nowhere public.
// Phone floors: every font size is a --fs-NN token (12px at ≤768px), buttons get the 44px floor from globals.css,
// and rows are minmax(0, …) grids so a long query never widens the page.

import { useState } from 'react'
import { Card, CardHeader } from './primitives'

type Striking = { source: string; query: string; page: string; impressions: number; position: number; intent: string; company: string | null; advice: string }
type LowCtr = { source: string; page: string; impressions: number; ctr: number; expected_ctr: number; position: number; lost_clicks: number }
type Demand = { company: string; impressions: number; graded: boolean; applicant_reports: number; reports_needed: number; intents: string[] }
type Mover = { query: string; clicks: number; clicks_change: number; impressions_change: number }
type Out = {
  ok: boolean; ready?: boolean; reason?: string; error?: string; rows?: number
  freshness?: { google: string | null; bing: string | null; stale?: boolean }
  window?: { from: string; to: string } | null
  totals?: { clicks: number; impressions: number; queries: number; pages: number }
  intents?: Record<string, { queries: number; impressions: number; clicks: number }>
  striking_distance?: Striking[]
  digest?: { week: { from: string; to: string }; top_movers: Mover[]; new_striking_distance: Striking[]; low_ctr_pages: LowCtr[]; demand_targets: Demand[] } | null
}

const mono: React.CSSProperties = { fontFamily: 'var(--mono)' }
const row: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: '.6rem', alignItems: 'baseline', padding: '.35rem 0', borderTop: '1px solid var(--line)' }
const ell: React.CSSProperties = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }
const label: React.CSSProperties = { ...mono, fontSize: 'var(--fs-55)', color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '.1em', margin: '.85rem 0 .3rem' }
const pathOf = (u: string) => { try { return new URL(u).pathname } catch { return u } }
const pct = (v: number) => `${(v * 100).toFixed(1)}%`
const signed = (n: number) => (n > 0 ? `+${n}` : String(n))

function Section({ title, empty, children }: { title: string; empty: boolean; children: React.ReactNode }) {
  return (
    <div>
      <div style={label}>{title}</div>
      {empty ? <div style={{ ...mono, fontSize: 'var(--fs-60)', color: 'var(--dim)' }}>Nothing yet</div> : children}
    </div>
  )
}

export function SearchDataPanel({ token }: { token: string }) {
  const [busy, setBusy] = useState(false)
  const [data, setData] = useState<Out | null>(null)
  const [err, setErr] = useState('')

  async function load() {
    setBusy(true); setErr('')
    try {
      const r = await fetch('/api/admin-stats?action=search_opportunities', { headers: { 'X-Admin-Token': token }, cache: 'no-store' })
      const d = await r.json().catch(() => ({})) as Out
      if (!r.ok || !d.ok) throw new Error(d.error || `HTTP ${r.status}`)
      setData(d)
    } catch (e) { setErr((e as Error).message) }
    setBusy(false)
  }

  const dg = data?.digest
  const intents = Object.entries(data?.intents || {}).filter(([, v]) => v.impressions > 0).sort((a, b) => b[1].impressions - a[1].impressions)
  return (
    <Card style={{ marginBottom: '.65rem' }}>
      <CardHeader title="Search demand" action={<button onClick={load} disabled={busy} style={{ ...mono, fontSize: 'var(--fs-60)', background: 'none', border: '1px solid var(--line2)', borderRadius: 8, padding: '.35rem .8rem', color: 'var(--blue)', cursor: 'pointer' }}>{busy ? 'Loading…' : data ? 'Refresh' : 'Load'}</button>} />
      <div style={{ ...mono, fontSize: 'var(--fs-60)', color: 'var(--sub)', lineHeight: 1.6 }}>
        What people searched on Google and Bing before they saw a Seen page, last 28 days. Pulled daily at 6:20 AM PT (5:20 AM in winter).
      </div>
      {err && <div style={{ ...mono, fontSize: 'var(--fs-62)', color: 'var(--red)', marginTop: '.5rem' }}>✗ {err}</div>}
      {data && data.ready === false && <div style={{ ...mono, fontSize: 'var(--fs-62)', color: 'var(--amber)', marginTop: '.5rem' }}>{data.reason}</div>}
      {data?.ready && (
        <div style={{ minWidth: 0 }}>
          <div style={{ ...mono, fontSize: 'var(--fs-62)', color: data.freshness?.stale ? 'var(--amber)' : 'var(--sub)', marginTop: '.5rem' }}>
            Google through {data.freshness?.google || 'no data'} · Bing through {data.freshness?.bing || 'no data'}{data.freshness?.stale ? ' · the daily pull looks stopped' : ''}
          </div>
          {data.totals && data.window && (
            <div style={{ ...mono, fontSize: 'var(--fs-62)', color: 'var(--white)', marginTop: '.35rem' }}>
              {data.totals.impressions.toLocaleString()} impressions · {data.totals.clicks.toLocaleString()} clicks · {data.totals.queries.toLocaleString()} queries · {data.window.from} to {data.window.to}
            </div>
          )}

          <Section title="Companies searched that need reports" empty={!dg?.demand_targets?.length}>
            {(dg?.demand_targets || []).map((d) => (
              <div key={d.company} style={row}>
                <span style={{ ...ell, ...mono, fontSize: 'var(--fs-62)', color: 'var(--white)' }}>{d.company} <span style={{ color: 'var(--dim)' }}>· {d.applicant_reports} report{d.applicant_reports === 1 ? '' : 's'}{d.graded ? '' : ` · needs ${d.reports_needed} for a grade`}</span></span>
                <span style={{ ...mono, fontSize: 'var(--fs-60)', color: 'var(--sub)' }}>{d.impressions.toLocaleString()} impr.</span>
              </div>
            ))}
          </Section>

          <Section title="Striking distance (position 8 to 20)" empty={!data.striking_distance?.length}>
            {(data.striking_distance || []).slice(0, 12).map((s) => (
              <div key={`${s.source}:${s.query}`} style={{ ...row, gridTemplateColumns: 'minmax(0,1fr)' }}>
                <span style={{ ...ell, ...mono, fontSize: 'var(--fs-62)', color: 'var(--white)' }}>{s.query} <span style={{ color: 'var(--dim)' }}>· {s.source} · pos {s.position} · {s.impressions} impr. · {pathOf(s.page)}</span></span>
                <span style={{ ...mono, fontSize: 'var(--fs-60)', color: 'var(--sub)', lineHeight: 1.5 }}>{s.advice}</span>
              </div>
            ))}
          </Section>

          <Section title="Low CTR for their position (rewrite title + description)" empty={!dg?.low_ctr_pages?.length}>
            {(dg?.low_ctr_pages || []).map((p) => (
              <div key={`${p.source}:${p.page}`} style={row}>
                <span style={{ ...ell, ...mono, fontSize: 'var(--fs-62)', color: 'var(--white)' }}>{pathOf(p.page)} <span style={{ color: 'var(--dim)' }}>· {p.source} · pos {p.position} · CTR {pct(p.ctr)} vs {pct(p.expected_ctr)}</span></span>
                <span style={{ ...mono, fontSize: 'var(--fs-60)', color: 'var(--amber)' }}>~{p.lost_clicks} clicks</span>
              </div>
            ))}
          </Section>

          <Section title={`This week's movers${dg ? ` (${dg.week.from} to ${dg.week.to})` : ''}`} empty={!dg?.top_movers?.length}>
            {(dg?.top_movers || []).map((m) => (
              <div key={m.query} style={row}>
                <span style={{ ...ell, ...mono, fontSize: 'var(--fs-62)', color: 'var(--white)' }}>{m.query}</span>
                <span style={{ ...mono, fontSize: 'var(--fs-60)', color: m.clicks_change >= 0 ? 'var(--green)' : 'var(--red)' }}>{signed(m.clicks_change)} clicks · {signed(m.impressions_change)} impr.</span>
              </div>
            ))}
          </Section>

          <Section title="New striking-distance queries this week" empty={!dg?.new_striking_distance?.length}>
            {(dg?.new_striking_distance || []).map((s) => (
              <div key={`${s.source}:${s.query}`} style={row}>
                <span style={{ ...ell, ...mono, fontSize: 'var(--fs-62)', color: 'var(--white)' }}>{s.query}</span>
                <span style={{ ...mono, fontSize: 'var(--fs-60)', color: 'var(--sub)' }}>pos {s.position}</span>
              </div>
            ))}
          </Section>

          <Section title="What searchers ask" empty={!intents.length}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.4rem' }}>
              {intents.map(([k, v]) => (
                <span key={k} style={{ ...mono, fontSize: 'var(--fs-60)', padding: '.3rem .6rem', borderRadius: 6, border: '1px solid var(--line)', color: 'var(--sub)' }}>{k.replace(/_/g, ' ')}: {v.impressions.toLocaleString()}</span>
              ))}
            </div>
          </Section>
        </div>
      )}
    </Card>
  )
}

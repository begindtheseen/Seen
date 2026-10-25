'use client'

// Admin → Users → "Revenue funnel" (GET /api/admin-stats?action=revenue_funnel&days=N →
// lib/server/revenueFunnel.js). Each step from a guest's email to a paid Interview Prep, the rate between
// steps, and the monthly revenue those rates imply at today's interview volume — so revenue is a number
// you can move one step at a time, not a hope.

import { useCallback, useEffect, useState } from 'react'
import { Panel } from './primitives'
import s from './SignupSourcesPanel.module.css'

type Step = { key: string; label: string; n: number | null }
type Report = {
  ok: boolean; error?: string; days: number; recording: boolean; steps: Step[]
  rates: { email: number | null; activation: number | null; offer_click: number | null; checkout: number | null }
  revenue: { interview_prep: number | null; credit_pack: number | null; credit_pack_count: number | null; paying_subscribers_now: number | null; monthly_price: number }
  implied: { interviews_per_month: number; take_rate_pct: number; dollars: number } | null
}
const WINDOWS = [7, 30, 90]
const show = (n: number | null) => (n == null ? '—' : n.toLocaleString())
const pct = (n: number | null) => (n == null ? '—' : `${n}%`)
const usd = (n: number | null) => (n == null ? '—' : `$${n.toFixed(2)}`)

export function RevenueFunnelPanel({ token }: { token: string }) {
  const [days, setDays] = useState(30)
  const [data, setData] = useState<Report | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const load = useCallback(async (d: number) => {
    setBusy(true); setErr('')
    try {
      const r = await fetch(`/api/admin-stats?action=revenue_funnel&days=${d}`, { headers: { 'X-Admin-Token': token }, cache: 'no-store' })
      const body = await r.json().catch(() => null) as Report | null
      if (r.status === 401) throw new Error('Session expired — log in again')
      if (!r.ok || !body?.ok) throw new Error(body?.error || `HTTP ${r.status}`)
      setData(body)
    } catch (e) { setErr((e as Error).message) }
    setBusy(false)
  }, [token])
  useEffect(() => { void load(days) }, [days, load])

  const right = (
    <span className={s.windows} role="group" aria-label="Window">
      {WINDOWS.map((w) => (
        <button key={w} type="button" className={`${s.win} ${w === days ? s.on : ''}`} aria-pressed={w === days} onClick={() => setDays(w)} disabled={busy}>{w}d</button>
      ))}
    </span>
  )

  return (
    <Panel title="Revenue funnel" right={right}>
      {err && <div className={s.err}>✗ {err}</div>}
      {!err && !data && <div className={s.empty}>Loading…</div>}
      {data && (
        <>
          {!data.recording && (
            <div className={s.empty}>Offer and email steps are not recording yet — apply migration 20261025120000_interview_prep_funnel.sql. The other steps are live.</div>
          )}
          <div className={s.totals}>
            <span><b>{usd(data.revenue.interview_prep)}</b> Interview Prep</span>
            <span><b>{usd(data.revenue.credit_pack)}</b> credit packs ({show(data.revenue.credit_pack_count)})</span>
            <span><b>{show(data.revenue.paying_subscribers_now)}</b> paying Pro now</span>
          </div>
          <div className={s.table} role="table">
            <div className={`${s.row} ${s.noPaid} ${s.head}`} role="row" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,5rem)' }}>
              <span role="columnheader">Step · last {data.days} days</span>
              <span role="columnheader">Count</span>
            </div>
            {data.steps.map((st) => (
              <div key={st.key} className={s.row} role="row" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,5rem)' }}>
                <span className={s.name} role="cell" title={st.label}>{st.label}</span>
                <span className={s.n} role="cell">{show(st.n)}</span>
              </div>
            ))}
          </div>
          <div className={s.sub}>Rates</div>
          <div className={s.totals}>
            <span>email given <b>{pct(data.rates.email)}</b></span>
            <span>sign-up → tracked <b>{pct(data.rates.activation)}</b></span>
            <span>offer → pressed <b>{pct(data.rates.offer_click)}</b></span>
            <span>pressed → bought <b>{pct(data.rates.checkout)}</b></span>
          </div>
          <div className={s.empty}>
            {data.implied
              ? <>At {data.implied.interviews_per_month} interviews a month and a {data.implied.take_rate_pct}% take rate, Interview Prep makes about <b style={{ color: 'var(--white)' }}>${data.implied.dollars.toFixed(2)}/month</b>. Move any one number and this moves with it.</>
              : <>Implied monthly revenue appears once the offer has been shown and pressed at least once.</>}
          </div>
        </>
      )}
    </Panel>
  )
}

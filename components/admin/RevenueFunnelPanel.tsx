'use client'

// Admin → Users → "Revenue funnel" (GET /api/admin-stats?action=revenue_funnel&days=N →
// lib/server/revenueFunnel.js). Each step from a guest's email to a paid Interview Prep, the rate between
// steps, and the monthly revenue those rates imply at today's interview volume — so revenue is a number
// you can move one step at a time, not a hope.

import { useCallback, useEffect, useState } from 'react'
import { Panel } from './primitives'
import s from './SignupSourcesPanel.module.css'

type Step = { key: string; label: string; n: number | null }
type Surface = { surface: string; shown: number | null; clicked: number | null }
type Report = {
  ok: boolean; error?: string; days: number; recording: boolean; recording_steps: boolean; steps: Step[]; surfaces: Surface[]
  rates: { email: number | null; activation: number | null; offer_click: number | null; checkout: number | null; checkout_completion: number | null }
  revenue: {
    interview_prep: number | null; job_search_pass: number | null; pass_count: number | null
    credit_pack: number | null; credit_pack_count: number | null; total: number | null
    paying_customers: number | null; legacy_subscriptions_marked_pro: number | null
  }
  implied: { interviews_per_month: number; take_rate_pct: number; dollars: number } | null
}
const SURFACE_LABEL: Record<string, string> = {
  tracker_prep: 'Tracker card (interview)', company_page: 'Company page', pricing: '/pricing',
  upgrade_modal: 'Upgrade sheet', lock_card: 'Lock card', homepage: 'Homepage',
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
          {data.recording && !data.recording_steps && (
            <div className={s.empty}>Pricing views, offers by page, previews and checkouts are not recording yet — apply migration 20261025160000_funnel_steps.sql. The tracker card&apos;s offer is still counted.</div>
          )}
          <div className={s.totals}>
            <span><b>{usd(data.revenue.total)}</b> revenue</span>
            <span><b>{usd(data.revenue.interview_prep)}</b> Interview Prep</span>
            <span><b>{usd(data.revenue.job_search_pass)}</b> Job Search Pass ({show(data.revenue.pass_count)})</span>
            {!!data.revenue.credit_pack_count && <span><b>{usd(data.revenue.credit_pack)}</b> old credit packs ({show(data.revenue.credit_pack_count)})</span>}
            <span title="Distinct accounts with a purchase in this window. Comped accounts and no-card trials never buy, so they are not counted."><b>{show(data.revenue.paying_customers)}</b> paying customers</span>
          </div>
          {!!data.revenue.legacy_subscriptions_marked_pro && (
            <div className={s.empty}>{show(data.revenue.legacy_subscriptions_marked_pro)} account{data.revenue.legacy_subscriptions_marked_pro === 1 ? '' : 's'} still on a subscription or trial started before 2026-10-25 (Stripe decides which pay; not counted above).</div>
          )}
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
          <div className={s.sub}>Offers by page</div>
          <div className={s.table} role="table">
            <div className={`${s.row} ${s.head}`} role="row" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,4rem) minmax(0,4rem) minmax(0,3.5rem)' }}>
              <span role="columnheader">Page</span>
              <span role="columnheader">Shown</span>
              <span role="columnheader">Pressed</span>
              <span role="columnheader">Rate</span>
            </div>
            {data.surfaces.map((x) => (
              <div key={x.surface} className={s.row} role="row" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,4rem) minmax(0,4rem) minmax(0,3.5rem)' }}>
                <span className={s.name} role="cell">{SURFACE_LABEL[x.surface] || x.surface}</span>
                <span className={s.n} role="cell">{show(x.shown)}</span>
                <span className={s.n} role="cell">{show(x.clicked)}</span>
                <span className={s.n} role="cell">{pct(x.shown && x.clicked != null ? Math.round((x.clicked / x.shown) * 100) : null)}</span>
              </div>
            ))}
          </div>
          <div className={s.sub}>Rates</div>
          <div className={s.totals}>
            <span>email given <b>{pct(data.rates.email)}</b></span>
            <span>sign-up → tracked <b>{pct(data.rates.activation)}</b></span>
            <span>card offer → pressed <b>{pct(data.rates.offer_click)}</b></span>
            <span>pressed → bought prep <b>{pct(data.rates.checkout)}</b></span>
            <span>checkout opened → paid <b>{pct(data.rates.checkout_completion)}</b></span>
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

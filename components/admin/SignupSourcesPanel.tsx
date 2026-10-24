'use client'

// Admin → Users → "Where signups come from": first-touch attribution of new accounts
// (GET /api/admin-stats?action=signup_attribution&days=N → lib/server/attributionReport.js).
// For each landing-page group, referring site, campaign and invite: how many accounts signed up, how many
// of those tracked an application, started a trial / Pro, and paid. "Paid" is shown only when Stripe
// could be read; otherwise the column is hidden and the trial column reads "Pro (incl. trial)".

import { useCallback, useEffect, useState } from 'react'
import { Panel } from './primitives'
import s from './SignupSourcesPanel.module.css'

type Group = { key: string; label?: string; name?: string; slug?: string; signups: number; tracked: number; pro_or_trial: number; paid: number | null }
type Report = {
  ok: boolean; ready?: boolean; error?: string; days?: number; since?: string
  paid_known?: boolean; paid_note?: string | null
  total?: Group
  by_landing?: Group[]; top_companies?: Group[]; by_referrer?: Group[]; other_referrers?: Group[]
  by_utm_source?: Group[]; by_utm_campaign?: Group[]; by_invite?: Group[]
}
type View = 'landing' | 'referrer' | 'campaign' | 'invite'
const VIEWS: [View, string][] = [['landing', 'Landing page'], ['referrer', 'Referrer'], ['campaign', 'Campaign'], ['invite', 'Invite']]
const WINDOWS = [7, 30, 90]

const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : '—')

function Table({ rows, paidKnown, nameOf }: { rows: Group[]; paidKnown: boolean; nameOf?: (g: Group) => string }) {
  if (!rows.length) return <div className={s.empty}>No sign-ups here yet.</div>
  return (
    <div className={s.table} role="table">
      <div className={`${s.row} ${s.head} ${paidKnown ? '' : s.noPaid}`} role="row">
        <span role="columnheader">Source</span>
        <span role="columnheader" title="Accounts created">Signups</span>
        <span role="columnheader" title="Tracked at least one application">Tracked</span>
        <span role="columnheader" title={paidKnown ? 'Started a trial or subscription, or bought a pass' : 'Pro (incl. trial)'}>{paidKnown ? 'Trial / Pro' : 'Pro + trial'}</span>
        {paidKnown && <span role="columnheader" title="Money changed hands (paid invoice or one-time purchase)">Paid</span>}
      </div>
      {rows.map((g) => (
        <div key={g.key} className={`${s.row} ${paidKnown ? '' : s.noPaid}`} role="row">
          <span className={s.name} role="cell" title={nameOf ? nameOf(g) : (g.label || g.key)}>{nameOf ? nameOf(g) : (g.label || g.key)}</span>
          <span className={s.n} role="cell">{g.signups}</span>
          <span className={s.n} role="cell">{g.tracked}<em>{pct(g.tracked, g.signups)}</em></span>
          <span className={s.n} role="cell">{g.pro_or_trial}<em>{pct(g.pro_or_trial, g.signups)}</em></span>
          {paidKnown && <span className={s.n} role="cell">{g.paid ?? '—'}<em>{pct(g.paid || 0, g.signups)}</em></span>}
        </div>
      ))}
    </div>
  )
}

export function SignupSourcesPanel({ token }: { token: string }) {
  const [days, setDays] = useState(30)
  const [view, setView] = useState<View>('landing')
  const [data, setData] = useState<Report | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const load = useCallback(async (d: number) => {
    setBusy(true); setErr('')
    try {
      const r = await fetch(`/api/admin-stats?action=signup_attribution&days=${d}`, { headers: { 'X-Admin-Token': token }, cache: 'no-store' })
      const body = await r.json().catch(() => null) as Report | null
      if (r.status === 401) throw new Error('Session expired — log in again')
      if (!r.ok || !body?.ok) throw new Error(body?.error || `HTTP ${r.status}`)
      setData(body)
    } catch (e) { setErr((e as Error).message) }
    setBusy(false)
  }, [token])

  useEffect(() => { void load(days) }, [days, load])

  const t = data?.total
  const paidKnown = !!data?.paid_known
  const right = (
    <span className={s.windows} role="group" aria-label="Window">
      {WINDOWS.map((w) => (
        <button key={w} type="button" className={`${s.win} ${w === days ? s.on : ''}`} aria-pressed={w === days} onClick={() => setDays(w)} disabled={busy}>{w}d</button>
      ))}
    </span>
  )

  return (
    <Panel title="Where signups come from" right={right}>
      {err && <div className={s.err}>✗ {err}</div>}
      {!err && !data && <div className={s.empty}>Loading…</div>}
      {data && data.ready === false && (
        <div className={s.empty}>Not recording yet — apply migration 20261024180000_signup_attribution.sql. New accounts are recorded from then on.</div>
      )}
      {data?.ready && t && (
        <>
          <div className={s.totals}>
            <span><b>{t.signups}</b> signups</span>
            <span><b>{t.tracked}</b> tracked ({pct(t.tracked, t.signups)})</span>
            <span><b>{t.pro_or_trial}</b> {paidKnown ? 'trial/Pro' : 'Pro (incl. trial)'} ({pct(t.pro_or_trial, t.signups)})</span>
            {paidKnown && <span><b>{t.paid}</b> paid ({pct(t.paid || 0, t.signups)})</span>}
          </div>
          <div className={s.tabs} role="tablist" aria-label="Group by">
            {VIEWS.map(([k, label]) => (
              <button key={k} type="button" role="tab" aria-selected={view === k} className={`${s.tab} ${view === k ? s.on : ''}`} onClick={() => setView(k)}>{label}</button>
            ))}
          </div>
          {view === 'landing' && (
            <>
              <Table rows={data.by_landing || []} paidKnown={paidKnown} />
              {!!data.top_companies?.length && (
                <details className={s.more}>
                  <summary>Top company pages ({data.top_companies.length})</summary>
                  <Table rows={data.top_companies} paidKnown={paidKnown} nameOf={(g) => g.name || g.key} />
                </details>
              )}
            </>
          )}
          {view === 'referrer' && (
            <>
              <Table rows={data.by_referrer || []} paidKnown={paidKnown} />
              {!!data.other_referrers?.length && (
                <details className={s.more}>
                  <summary>Other sites ({data.other_referrers.length})</summary>
                  <Table rows={data.other_referrers} paidKnown={paidKnown} />
                </details>
              )}
            </>
          )}
          {view === 'campaign' && (
            <>
              <div className={s.sub}>utm_source</div>
              <Table rows={data.by_utm_source || []} paidKnown={paidKnown} />
              <div className={s.sub}>utm_campaign</div>
              <Table rows={data.by_utm_campaign || []} paidKnown={paidKnown} />
            </>
          )}
          {view === 'invite' && <Table rows={data.by_invite || []} paidKnown={paidKnown} />}
          <div className="ac-panel-foot">
            First touch of the device each new account signed up on, last {data.days} days (California days). Only accounts created after this shipped are counted.
            {data.paid_note ? ` ${data.paid_note}.` : ''}
          </div>
        </>
      )}
    </Panel>
  )
}

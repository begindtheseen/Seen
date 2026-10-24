'use client'

// Inbox Autopilot on the tracker: a private forwarding address, the setup steps (with the Gmail
// confirmation code shown live the moment Gmail sends it), what Seen read, and the one-tap "add this to
// the company's grade?" question. Server: api/user-sync.js inbox_* actions → lib/server/inbox/store.js.
// Seen never stores an email — only the company, the role and what happened.

import { useCallback, useEffect, useRef, useState } from 'react'
import { showReportReward } from '@/lib/rewardNotice'
import { _sync } from '@/lib/sync'
import { formatPacific } from '@/lib/time/pacific.js'
import type { Application } from '@/lib/types'
import s from './InboxAutopilot.module.css'

type InboxEvent = {
  id: string; received_at: string; state: 'applied' | 'unplaced'; kind: string
  company: string | null; role: string | null; vendor: string | null
  sender_name: string | null; sender_domain: string | null
  application_id: string | null; share_state: 'ask' | 'shared' | 'declined' | null
}
type Status = {
  ready: boolean; enabled?: boolean; address?: string; paused?: boolean
  received_count?: number; last_received_at?: string | null
  forwarding_confirm?: { code?: string | null; url?: string | null; for?: string | null; at?: string } | null
  gmail_filter?: string; events?: InboxEvent[]
}

const KIND: Record<string, string> = {
  application_received: 'Applied', interview: 'Interview', assessment: 'Assessment', rejection: 'Rejected', offer: 'Offer',
}
const SHARE_OUTCOME: Record<string, string> = { rejection: 'rejected', offer: 'offer', interview: 'interview' }

export default function InboxAutopilot({ apps, token, onAppsChanged, status }: {
  apps: Application[]
  token: () => Promise<string | null>
  onAppsChanged: () => void
  /** The status the page's own `load` already carried. undefined = the page has not loaded yet (wait);
   *  null = it could not carry one (ask for it here). Saves a second /api/user-sync call at mount. */
  status?: unknown
}) {
  const [st, setSt] = useState<Status | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [copied, setCopied] = useState('')
  const [showSetup, setShowSetup] = useState(false)
  const [pick, setPick] = useState<Record<string, string>>({})
  const seen = useRef<number | null>(null)
  // The page passes a fresh function every render; a ref keeps `load` stable (no refetch loop).
  const changed = useRef(onAppsChanged)
  changed.current = onAppsChanged

  const load = useCallback(async () => {
    const r = await _sync('inbox_status') as Status | null
    if (!r) return
    setSt(r)
    // New mail since the last look → the cards changed on the server; reload them.
    if (seen.current != null && (r.received_count || 0) > seen.current) changed.current()
    seen.current = r.received_count || 0
  }, [])

  useEffect(() => {
    if (status === undefined) return
    if (status && typeof (status as Status).ready === 'boolean') {
      // The page's load already holds the cards that go with this status: record it, no reload.
      const s0 = status as Status
      setSt(s0); seen.current = s0.received_count || 0
      return
    }
    load()
  }, [status, load])

  const settingUp = !!(st?.enabled && (showSetup || !st.received_count || st.forwarding_confirm))
  // While the user is setting up, look every 15 s so Gmail's confirmation code appears on its own.
  useEffect(() => {
    if (!settingUp) return
    const t = setInterval(() => { if (!document.hidden) load() }, 15000)
    return () => clearInterval(t)
  }, [settingUp, load])

  const act = async (action: string, payload: Record<string, unknown> = {}) => {
    setBusy(true); setErr('')
    const r = await _sync(action, payload) as (Status & { ok?: boolean; error?: string }) | null
    setBusy(false)
    if (!r) { setErr('That didn’t go through — check your connection and try again.'); return null }
    if (r.error) { setErr(r.error); return r }
    if ('ready' in r) setSt(r)
    return r
  }

  const copy = async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(what); setTimeout(() => setCopied(''), 1800) } catch { setErr('Copy failed — select the text and copy it.') }
  }

  const share = async (ev: InboxEvent, yes: boolean) => {
    if (yes && ev.company) {
      const tok = await token()
      if (tok) {
        // The matched application's id lets the server reward the report with Pro days (it checks
        // the row is this account's and old enough itself — lib/server/growthRewards.js).
        const d = await fetch('/api/reports', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
          body: JSON.stringify({ action: 'quick_submit', company: ev.company, outcome: SHARE_OUTCOME[ev.kind], role: ev.role || '', ...(ev.application_id ? { application_id: ev.application_id } : {}) }),
        }).then(r => (r.ok ? r.json() : null)).catch(() => null) as { reward?: Parameters<typeof showReportReward>[0] } | null
        if (d?.reward) showReportReward(d.reward)
      }
    }
    await act('inbox_share', { id: ev.id, choice: yes ? 'shared' : 'declined' })
    load()
  }

  const assign = async (ev: InboxEvent) => {
    const appId = pick[ev.id]
    if (!appId) return
    const r = await act('inbox_assign', { id: ev.id, application_id: appId })
    if (r && !r.error) { changed.current(); load() }
  }

  if (!st || !st.ready) return null // not live yet (migration pending) or still loading

  if (!st.enabled) {
    return (
      <section className={s.card} id="autopilot">
        <div className={s.pitch}>
          <div>
            <div className={s.eyebrow}>New · Inbox Autopilot</div>
            <h3 className={s.title}>Let your inbox fill in the tracker</h3>
            <p className={s.sub}>Forward your job emails to a private Seen address. Every “thanks for applying”, interview invite and rejection updates your applications on its own — no typing.</p>
            <p className={s.fine}>Free. Seen keeps only the company, the role and what happened — never the email itself. Turn it off any time and it’s all deleted.</p>
          </div>
          <button className="btn btn-green" disabled={busy} onClick={() => act('inbox_enable')}>{busy ? 'Turning on…' : 'Turn it on'}</button>
        </div>
        {err && <div className={s.err}>{err}</div>}
      </section>
    )
  }

  const events = st.events || []
  const asks = events.filter(e => e.share_state === 'ask' && SHARE_OUTCOME[e.kind])
  const unplaced = events.filter(e => e.state === 'unplaced')
  const recent = events.filter(e => e.state === 'applied').slice(0, 6)
  const activeApps = apps.filter(a => a.id && !a.id.startsWith('app_'))
  const fc = st.forwarding_confirm

  return (
    <section className={s.card} id="autopilot">
      <div className={s.head}>
        <div className={s.headL}>
          <span className={`${s.dot} ${st.paused ? s.dotOff : ''}`} />
          <b>Inbox Autopilot</b>
          <span className={s.muted}>
            {st.paused ? 'Paused' : 'On'} · {st.received_count || 0} email{st.received_count === 1 ? '' : 's'} read
            {st.last_received_at ? ` · last ${formatPacific(st.last_received_at, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ''}
          </span>
        </div>
        <button className={s.link} onClick={() => setShowSetup(v => !v)}>{settingUp ? 'Hide setup' : 'Setup'}</button>
      </div>

      <div className={s.addrRow}>
        <code className={s.addr}>{st.address}</code>
        <button className="btn btn-ghost" style={{ fontSize: '.72rem' }} onClick={() => copy(st.address || '', 'address')}>{copied === 'address' ? 'Copied ✓' : 'Copy address'}</button>
      </div>

      {fc && (fc.code || fc.url) && (
        <div className={s.confirm}>
          <b>Gmail sent a confirmation code{fc.for ? ` for ${fc.for}` : ''}:</b>
          {fc.code && <><code className={s.code}>{fc.code}</code><button className={s.link} onClick={() => copy(fc.code || '', 'code')}>{copied === 'code' ? 'Copied ✓' : 'Copy'}</button></>}
          <div className={s.muted}>Paste it in Gmail → Settings → Forwarding and POP/IMAP, then click Verify{fc.url ? <> — or <a href={fc.url} target="_blank" rel="noopener noreferrer">confirm it in Gmail</a></> : null}.</div>
        </div>
      )}

      {settingUp && (
        <ol className={s.steps}>
          <li><b>Gmail on a computer</b> (the phone app can’t set this up): Settings ⚙ → <i>See all settings</i> → <i>Forwarding and POP/IMAP</i> → <i>Add a forwarding address</i> → paste your Seen address. Leave forwarding itself <b>off</b> at the top of that page.</li>
          <li>Gmail sends Seen a confirmation code — it shows up right here within a minute. Paste it back into Gmail and click <i>Verify</i>.</li>
          <li>Make a filter so only job emails go to Seen: in Gmail’s search bar open <i>Show search options</i>, paste this into <i>Has the words</i>, click <i>Create filter</i>, tick <i>Forward it to</i> your Seen address.
            <div className={s.addrRow}><code className={s.filter}>{st.gmail_filter}</code><button className={s.link} onClick={() => copy(st.gmail_filter || '', 'filter')}>{copied === 'filter' ? 'Copied ✓' : 'Copy'}</button></div>
          </li>
          <li>Old emails don’t forward by themselves — forward any past “thanks for applying” or interview email to your Seen address and it’s tracked too. Outlook, Yahoo or anything else: forward to the same address.</li>
        </ol>
      )}

      {asks.length > 0 && (
        <div className={s.block}>
          {asks.map(ev => (
            <div key={ev.id} className={s.ask}>
              <span>Seen read {ev.kind === 'interview' ? 'an interview invite' : ev.kind === 'offer' ? 'an offer' : 'a rejection'} from <b>{ev.company}</b>. Add it to {ev.company}’s grade? <span className={s.muted}>Anonymous — it warns the next applicant.</span></span>
              <span className={s.btns}>
                <button className="btn btn-green" style={{ fontSize: '.7rem' }} disabled={busy} onClick={() => share(ev, true)}>Yes</button>
                <button className="btn btn-ghost" style={{ fontSize: '.7rem' }} disabled={busy} onClick={() => share(ev, false)}>No</button>
              </span>
            </div>
          ))}
        </div>
      )}

      {unplaced.length > 0 && (
        <div className={s.block}>
          {unplaced.map(ev => (
            <div key={ev.id} className={s.ask}>
              <span>{KIND[ev.kind] || 'An'} email from <b>{ev.sender_name || ev.sender_domain || 'an employer'}</b>{ev.sender_domain && ev.sender_name ? <span className={s.muted}> ({ev.sender_domain})</span> : null} — which application is it?</span>
              <span className={s.btns}>
                <select className={s.select} value={pick[ev.id] || ''} onChange={e => setPick(p => ({ ...p, [ev.id]: e.target.value }))}>
                  <option value="">Choose…</option>
                  {activeApps.map(a => <option key={a.id} value={a.id}>{a.company}{a.role ? ` — ${a.role}` : ''}</option>)}
                </select>
                <button className="btn btn-ghost" style={{ fontSize: '.7rem' }} disabled={busy || !pick[ev.id]} onClick={() => assign(ev)}>Put it there</button>
              </span>
            </div>
          ))}
        </div>
      )}

      {recent.length > 0 && (
        <ul className={s.list}>
          {recent.map(ev => (
            <li key={ev.id}>
              <span className={`${s.kind} ${s['k_' + ev.kind] || ''}`}>{KIND[ev.kind] || ev.kind}</span>
              <span className={s.co}>{ev.company}{ev.role ? <span className={s.muted}> · {ev.role}</span> : null}</span>
              <span className={s.muted}>{formatPacific(ev.received_at, { month: 'short', day: 'numeric' })}</span>
            </li>
          ))}
        </ul>
      )}

      <div className={s.foot}>
        <button className={s.link} disabled={busy} onClick={() => act('inbox_pause', { paused: !st.paused })}>{st.paused ? 'Resume' : 'Pause'}</button>
        <button className={s.link} disabled={busy} onClick={() => { if (confirm('Get a new address? The old one stops working right away — update your Gmail forwarding to the new one.')) act('inbox_new_address') }}>New address</button>
        <button className={`${s.link} ${s.danger}`} disabled={busy} onClick={() => { if (confirm('Turn off Inbox Autopilot? Your address stops working and everything Seen read is deleted. Your tracker cards stay.')) act('inbox_disable') }}>Turn off</button>
      </div>
      {err && <div className={s.err}>{err}</div>}
    </section>
  )
}

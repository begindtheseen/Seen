'use client'

// Settings → Job alerts (owner request 2026-11-01): choose what the job-match email is about —
// the résumé (default), only the person's own alerts (title words + place + radius), or off.
// "Off" is the same switch as the email's unsubscribe link (email_prefs.job_match_opt_out).
// Reads / writes through /api/user-sync job_alerts_get / job_alerts_save; hidden until the
// migration adds the columns ({ ready: false }).
import { useEffect, useId, useState } from 'react'
import { _syncRaw } from '@/lib/sync'
import { describeAlert, MAX_ALERTS, ALERT_RADII, DEFAULT_MILES } from '@/lib/server/jobAlerts.js'
import { MAX_PER_DAY } from '@/lib/server/jobMatchEmails.js'
import p from '@/app/profile/profile.module.css'
import s from './JobAlertsCard.module.css'

type Mode = 'resume' | 'alerts' | 'off'
type StoredAlert = { keywords: string; place: string; remote: boolean; miles: number | null }
type Draft = { keywords: string; place: string; remote: boolean; miles: number }
type Prefs = { ready: true; mode: Mode; saved_mode: 'resume' | 'alerts'; alerts: StoredAlert[]; has_resume: boolean | null; max: number; radii: number[] }
type FieldErr = { index: number | null; field: string | null; error: string }

const toDraft = (a: StoredAlert): Draft => ({ keywords: a.keywords, place: a.remote ? '' : a.place, remote: !!a.remote, miles: a.miles || DEFAULT_MILES })
const blank = (): Draft => ({ keywords: '', place: '', remote: false, miles: DEFAULT_MILES })
const wire = (d: Draft) => ({ keywords: d.keywords, place: d.remote ? 'Remote' : d.place, miles: d.remote ? null : d.miles })
const sameAs = (a: { mode: Mode; drafts: Draft[] }, b: { mode: Mode; drafts: Draft[] }) => JSON.stringify([a.mode, a.drafts.map(wire)]) === JSON.stringify([b.mode, b.drafts.map(wire)])

export default function JobAlertsCard({ id = 'alerts', onReady }: { id?: string; onReady?: (ready: boolean) => void }) {
  const uid = useId()
  const [state, setState] = useState<'loading' | 'hidden' | 'error' | 'ready'>('loading')
  const [prefs, setPrefs] = useState<Prefs | null>(null)
  const [mode, setMode] = useState<Mode>('resume')
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [fieldErr, setFieldErr] = useState<FieldErr | null>(null)

  function apply(d: Prefs) {
    setPrefs(d)
    setMode(d.mode)
    setDrafts(d.alerts.length ? d.alerts.map(toDraft) : (d.mode === 'alerts' ? [blank()] : []))
  }

  async function load() {
    setState('loading')
    const r = await _syncRaw('job_alerts_get')
    const d = r.body as (Prefs | { ready: false } | null)
    if (r.ok && d && d.ready === true) { apply(d); setState('ready'); onReady?.(true); return }
    if (r.ok && d && d.ready === false) { setState('hidden'); onReady?.(false); return }
    setState('error'); onReady?.(false)
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load() }, [])

  if (state === 'hidden' || state === 'loading') return null

  if (state === 'error' || !prefs) {
    return (
      <section id={id} className={p.card}>
        <div className={p.eyebrow}>Job alerts</div>
        <h2 className={p.cardT}>Job match emails</h2>
        <div className={`${p.msg} ${p.err}`} role="alert">Couldn’t load your job alert settings.</div>
        <div className={p.btnRow} style={{ marginTop: '.75rem' }}>
          <button type="button" className={`${p.ghost} ${s.tap}`} onClick={() => void load()}>Try again</button>
        </div>
      </section>
    )
  }

  const savedState = { mode: prefs.mode, drafts: prefs.alerts.map(toDraft) }
  const dirty = !sameAs({ mode, drafts }, savedState)
  const max = prefs.max || MAX_ALERTS
  const radii = prefs.radii?.length ? prefs.radii : ALERT_RADII

  const edit = (i: number, patch: Partial<Draft>) => {
    setDrafts((cur) => cur.map((d, j) => (j === i ? { ...d, ...patch } : d)))
    setMsg(null)
    if (fieldErr?.index === i) setFieldErr(null)
  }
  const remove = (i: number) => { setDrafts((cur) => cur.filter((_, j) => j !== i)); setFieldErr(null); setMsg(null) }
  const add = () => { if (drafts.length < max) { setDrafts((cur) => [...cur, blank()]); setMsg(null) } }
  const pickMode = (m: Mode) => {
    setMode(m); setMsg(null); setFieldErr(null)
    if (m === 'alerts' && drafts.length === 0) setDrafts([blank()])
  }

  async function save() {
    // Rows left completely empty are dropped rather than refused.
    const keep = drafts.filter((d) => d.keywords.trim() || (!d.remote && d.place.trim()))
    setSaving(true); setMsg(null); setFieldErr(null)
    const r = await _syncRaw('job_alerts_save', { mode, alerts: keep.map(wire) })
    setSaving(false)
    const d = r.body as (Prefs | { ready: false } | { error?: string; index?: number | null; field?: string | null } | null)
    if (r.ok && d && 'ready' in d && d.ready === true) {
      apply(d)
      setMsg({ ok: true, text: d.mode === 'off' ? 'Saved. Job match emails are off.' : 'Saved.' })
      return
    }
    if (r.ok && d && 'ready' in d && d.ready === false) { setState('hidden'); onReady?.(false); return }
    const e = (d || {}) as { error?: string; index?: number | null; field?: string | null }
    setDrafts(keep.length ? keep : drafts)
    if (typeof e.index === 'number') setFieldErr({ index: e.index, field: e.field || null, error: e.error || 'Check this alert.' })
    setMsg({ ok: false, text: e.error || 'Could not save — try again.' })
  }

  const modes: { value: Mode; title: string; sub: string }[] = [
    {
      value: 'resume', title: 'Jobs that match my résumé',
      sub: prefs.has_resume === false ? 'Needs a résumé on file — add one in the Résumé section.' : 'Seen picks from listings that fit the roles on your résumé, near your city.',
    },
    { value: 'alerts', title: 'Only my job alerts', sub: 'Only new listings that match one of the alerts below.' },
    { value: 'off', title: 'Off', sub: 'No job match emails. Outcome check-ins are separate.' },
  ]

  return (
    <section id={id} className={p.card}>
      <div className={p.cardHead}>
        <div>
          <div className={p.eyebrow}>Job alerts</div>
          <h2 className={p.cardT}>Job match emails</h2>
          <p className={p.cardS}>At most {MAX_PER_DAY} emails a day, each about one live listing. Choose what they’re about.</p>
        </div>
      </div>

      <fieldset className={s.modes}>
        <legend className={p.label}>Email me about</legend>
        {modes.map((m) => (
          <label key={m.value} className={`${s.mode} ${mode === m.value ? s.modeOn : ''}`}>
            <input type="radio" name={`${uid}-mode`} value={m.value} checked={mode === m.value} onChange={() => pickMode(m.value)} className={s.radio} />
            <span className={s.modeText}>
              <span className={s.modeT}>{m.title}</span>
              <span className={s.modeS}>{m.sub}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {(mode === 'alerts' || drafts.length > 0) && (
        <div className={s.alerts}>
          <div className={s.alertsHead}>
            <span className={p.label} style={{ margin: 0 }}>Your alerts · {drafts.length} of {max}</span>
            {mode !== 'alerts' && drafts.length > 0 && <span className={s.note}>Used only when “Only my job alerts” is on.</span>}
          </div>
          {drafts.map((d, i) => {
            const err = fieldErr && fieldErr.index === i ? fieldErr : null
            const kwId = `${uid}-kw-${i}`, plId = `${uid}-pl-${i}`, miId = `${uid}-mi-${i}`, rmId = `${uid}-rm-${i}`
            const preview = d.keywords.trim() ? describeAlert({ keywords: d.keywords, place: d.remote ? 'Remote' : (d.place.trim() || ''), remote: d.remote, miles: d.miles }) : 'Add a job title or keywords to see what this alert will match.'
            return (
              <div key={i} className={`${s.alert} ${err ? s.alertErr : ''}`}>
                <div className={p.field}>
                  <label className={p.label} htmlFor={kwId}>Job title or keywords</label>
                  <input id={kwId} className={p.input} type="text" autoComplete="off" maxLength={60} value={d.keywords}
                    onChange={(e) => edit(i, { keywords: e.target.value })} placeholder="e.g. cashier, warehouse associate"
                    aria-invalid={err?.field === 'keywords' || undefined} />
                </div>
                <label className={s.check} htmlFor={rmId}>
                  <input id={rmId} type="checkbox" checked={d.remote} onChange={(e) => edit(i, { remote: e.target.checked })} />
                  <span>Remote jobs instead of a place</span>
                </label>
                {!d.remote && (
                  <div className={s.where}>
                    <div className={p.field}>
                      <label className={p.label} htmlFor={plId}>City and state, or ZIP</label>
                      <input id={plId} className={p.input} type="text" autoComplete="off" maxLength={80} value={d.place}
                        onChange={(e) => edit(i, { place: e.target.value })} placeholder="e.g. Phoenix, AZ or 85004"
                        aria-invalid={err?.field === 'place' || undefined} />
                    </div>
                    <div className={p.field}>
                      <label className={p.label} htmlFor={miId}>Within</label>
                      <select id={miId} className={p.select} value={d.miles} onChange={(e) => edit(i, { miles: Number(e.target.value) })}
                        aria-invalid={err?.field === 'miles' || undefined}>
                        {radii.map((r) => <option key={r} value={r}>{r} miles</option>)}
                      </select>
                    </div>
                  </div>
                )}
                <p className={s.preview}>{preview}</p>
                {err && <div className={`${p.msg} ${p.err}`} role="alert" style={{ marginTop: '.25rem' }}>{err.error}</div>}
                <button type="button" className={`${p.ghost} ${p.danger} ${s.tap} ${s.remove}`} onClick={() => remove(i)} aria-label={`Remove alert ${i + 1}`}>Remove</button>
              </div>
            )
          })}
          {drafts.length < max && (
            <button type="button" className={`${p.ghost} ${s.tap}`} onClick={add}>+ Add an alert</button>
          )}
        </div>
      )}

      {mode === 'resume' && drafts.length === 0 && (
        <div className={p.btnRow} style={{ marginTop: '1rem' }}>
          <button type="button" className={`${p.ghost} ${s.tap}`} onClick={() => pickMode('alerts')}>Set up job alerts instead</button>
        </div>
      )}

      <div className={p.btnRow} style={{ marginTop: '1rem' }}>
        <button type="button" className={`${p.primary} ${s.tap}`} onClick={() => void save()} disabled={saving || !dirty}>
          {saving ? 'Saving…' : 'Save job alerts'}
        </button>
        {dirty && !saving && (
          <button type="button" className={`${p.ghost} ${s.tap}`} onClick={() => { apply(prefs); setMsg(null); setFieldErr(null) }}>Discard</button>
        )}
      </div>
      {msg && <div className={`${p.msg} ${msg.ok ? p.ok : p.err}`} role={msg.ok ? 'status' : 'alert'}>{msg.text}</div>}
      <div className={p.fine}>Every email has a one-click link to stop them. Changes apply from the next send.</div>
    </section>
  )
}

'use client'

// /tracker for someone without an account. It used to redirect to a "Welcome back · Sign in to your
// account" wall, which a guest who had just tracked something (and never had an account) read as
// broken (conversion audit 2026-10-24). Now a guest tracks on this device, the same AppStore the
// signed-in tracker uses, and is asked once, in plain words, for an email to get the check-ins. Their
// applications ride along with that sign-up (lib/pendingApplicationClient.ts).
//
// ?add=1&company=<name> (FAQ "Track your application", the dashboard's "+ Track application") opens
// the form with the company filled in.

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import PageHeader from '@/components/shell/PageHeader'
import { AppStore } from '@/lib/stores/AppStore'
import type { Application } from '@/lib/types'
import { daysSince } from '@/lib/stores/checkSchedule'
import { COMPANY_MAX, ROLE_MAX } from '@/lib/stores/applicationEdit'
import { appliedAtFromChoice, checkinEmailPlan, shortDay, type AppliedChoice } from '@/lib/trackCapture'
import { cleanCompany } from '@/lib/signupIntent.js'
import { hasPendingRef } from '@/lib/referralClient'
import { loginHref } from '@/lib/safeHref.js'
import AppliedWhen from '@/components/track/AppliedWhen'
import CheckinEmailAsk from '@/components/track/CheckinEmailAsk'
import InterviewPrep from '@/components/tracker/InterviewPrep'
import s from '@/components/track/track.module.css'

export default function GuestTracker() {
  const params = useSearchParams()
  const [apps, setApps] = useState<Application[]>([])
  const [loaded, setLoaded] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [company, setCompany] = useState('')
  const [role, setRole] = useState('')
  const [choice, setChoice] = useState<AppliedChoice | null>(null)
  const [pickedDay, setPickedDay] = useState('')
  const [error, setError] = useState('')
  const [invite, setInvite] = useState(false)

  useEffect(() => {
    setApps(AppStore.loadSync())
    setLoaded(true)
    setInvite(hasPendingRef())
  }, [])
  useEffect(() => {
    if (params?.get('add') === '1') {
      setShowForm(true)
      const c = cleanCompany(params.get('company'))
      if (c) setCompany(c)
    }
  }, [params])

  const active = apps.filter(a => a.status === 'active')
  const latest = useMemo(() => [...active].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0] || null, [active])
  const plan = useMemo(() => (latest ? checkinEmailPlan(latest.appliedAt, latest.updatedAt || Date.now()).filter(p => p.at > Date.now()) : []), [latest])

  async function add() {
    const c = company.trim(), r = role.trim()
    if (!c) { setError('Add the company.'); return }
    if (!r) { setError('Add the job title.'); return }
    if (c.length > COMPANY_MAX || r.length > ROLE_MAX) { setError('Keep the company and job title shorter.'); return }
    if (!choice) { setError('Pick when you applied.'); return }
    const appliedAt = appliedAtFromChoice(choice, pickedDay)
    if (appliedAt == null) { setError('Pick the day you applied (today or earlier).'); return }
    setError('')
    const res = await AppStore.add({ company: c, role: r, platform: 'Direct', status: 'active', stage: 'Applied', appliedAt }, false)
    if (res.duplicate) setError(`${c} · ${r} is already on your list.`)
    setApps(AppStore.loadSync())
    if (!res.duplicate) { setShowForm(false); setCompany(''); setRole(''); setChoice(null); setPickedDay('') }
  }

  // "They called me in" — the guest card moves to Interview on this device (round 2: a guest could only
  // Remove a card, so the "if they call you in…" promise had nowhere to land).
  async function calledIn(id: string) {
    await AppStore.update(id, { stage: 'Interview' }, false)
    setApps(AppStore.loadSync())
  }
  async function schedule(id: string, iso: string) {
    await AppStore.update(id, {}, false, { markers: [{ id: `ev_${Date.now()}`, type: 'interview_scheduled', date: Date.now(), source: 'user', confidence: 'high', data: { at: iso } }] })
    setApps(AppStore.loadSync())
  }
  const scheduledAt = (a: Application) => {
    const ev = [...(a.events || [])].reverse().find(e => e.type === 'interview_scheduled' && typeof e.data?.at === 'string')
    return ev ? String(ev.data!.at) : ''
  }

  async function remove(id: string) {
    await AppStore.remove(id, false)
    setApps(AppStore.loadSync())
  }

  return (
    <div className="page-full">
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '2rem 16px 4rem', width: '100%', boxSizing: 'border-box' }} data-testid="guest-tracker">
        <PageHeader
          eyebrow="Application tracker"
          title="Track your applications"
          sub="Saved on this device. Add your email and Seen checks in with you on day 7, 14 and 30."
          crumbLabel="Tracker"
        />

        {loaded && (showForm || apps.length === 0) && (
          <section className={s.card} aria-label="Track an application">
            <p className={s.title}>{apps.length ? 'Track another application' : 'Track your first application'}</p>
            <form onSubmit={e => { e.preventDefault(); void add() }}>
              <div className={s.field}>
                <label className={s.label} htmlFor="gt-company">Company</label>
                <input autoComplete="off" id="gt-company" className={s.input} type="text" placeholder="e.g. Walmart" maxLength={COMPANY_MAX} value={company} onChange={e => setCompany(e.target.value)} data-testid="gt-company" />
              </div>
              <div className={s.field}>
                <label className={s.label} htmlFor="gt-role">Job title</label>
                <input autoComplete="off" id="gt-role" className={s.input} type="text" placeholder="e.g. Cashier" maxLength={ROLE_MAX} value={role} onChange={e => setRole(e.target.value)} data-testid="gt-role" />
              </div>
              <AppliedWhen choice={choice} pickedDay={pickedDay} onChoice={c => { setChoice(c); setError('') }} onPickedDay={setPickedDay} />
              {error && <p className={s.err} role="alert" style={{ marginTop: 0, marginBottom: '.6rem' }}>{error}</p>}
              <button type="submit" className={s.primary} data-testid="gt-submit">Track it</button>
              {apps.length > 0 && (
                <div className={s.actions}>
                  <button type="button" className={`${s.link} ${s.linkDim}`} onClick={() => { setShowForm(false); setError('') }}>Cancel</button>
                </div>
              )}
            </form>
          </section>
        )}

        {apps.length > 0 && (
          <>
            {latest && (
              <section className={s.card} aria-label="Email check-ins">
                <p className={s.title}>Get your check-ins by email</p>
                <CheckinEmailAsk company={latest.company} plan={plan} next="/tracker" inviteWaiting={invite} trackerLink={false} />
              </section>
            )}

            <ul style={{ listStyle: 'none', margin: '1.25rem 0 0', padding: 0, display: 'grid', gap: '.6rem' }} aria-label="Your applications">
              {apps.map(a => (
                <li key={a.id} className={`${s.card} ${s.quiet}`} style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '.75rem', flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 14rem', minWidth: 0 }}>
                    <p className={s.title} style={{ fontSize: '1rem', margin: 0 }}>{a.company}</p>
                    <p className={s.small} style={{ margin: '.15rem 0 0', color: 'var(--sub)' }}>
                      {a.role} · Day {daysSince(a.appliedAt)} · applied {shortDay(a.appliedAt)}{a.status !== 'active' ? ` · ${a.status}` : ''}
                    </p>
                  </div>
                  {a.status === 'active' && a.stage === 'Applied' && (
                    <button type="button" className={s.ghost} onClick={() => void calledIn(a.id)} data-testid="gt-called-in">📅 They called me in</button>
                  )}
                  <button type="button" className={s.ghost} onClick={() => void remove(a.id)} aria-label={`Remove ${a.company} ${a.role}`}>Remove</button>
                  {a.status === 'active' && ['Phone Screen', 'Interview', 'Final Round'].includes(a.stage) && (
                    <div style={{ flexBasis: '100%', minWidth: 0 }}>
                      <InterviewPrep guest appId={a.id} company={a.company} role={a.role} interviewAt={scheduledAt(a)} isPro={false} stage={a.stage} onSchedule={iso => void schedule(a.id, iso)} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
            {!showForm && (
              <div style={{ marginTop: '1rem' }}>
                <button type="button" className={s.ghost} onClick={() => setShowForm(true)} data-testid="gt-add-another">+ Track another</button>
              </div>
            )}
          </>
        )}

        <p className={s.small} style={{ marginTop: '1.5rem' }}>
          Already have an account? <Link href={loginHref('/tracker')} style={{ color: 'var(--green)' }}>Sign in</Link> and these move to it.
        </p>
      </div>
    </div>
  )
}

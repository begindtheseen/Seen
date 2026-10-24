'use client'

// The company page's main action for the person reading it: "Applied to {Company}? Track it."
// Sits right under the grade and its numbers (conversion audit 2026-10-24: the old "I applied here"
// button sat ~1,200px down, never asked when they applied, and told a guest "✓ Tracked" with no way to
// ever hear from Seen again). Flow:
//   1. role + WHEN they applied (the check-in clock starts at the real date — lib/trackCapture.ts);
//   2. the application is saved (device-local for a guest, on the account when signed in);
//   3. a guest is asked for an email right there, for the day-7 nudge (components/track/CheckinEmailAsk);
//      a signed-in person is told the dates the check-in emails will come (api/outcome-followups.js).
// Every promise names what Seen actually does: it checks in, and it knows the reported reply rate.
// It never says "we'll tell you when they respond" — Seen cannot know that.

import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/lib/auth'
import { AppStore } from '@/lib/stores/AppStore'
import { hasPendingRef } from '@/lib/referralClient'
import { safeNextPath } from '@/lib/signupIntent.js'
import { appliedAtFromChoice, checkinEmailPlan, joinDays, type AppliedChoice } from '@/lib/trackCapture'
import { daysSince } from '@/lib/stores/checkSchedule'
import { ROLE_MAX } from '@/lib/stores/applicationEdit'
import type { Application } from '@/lib/types'
import AppliedWhen from '@/components/track/AppliedWhen'
import CheckinEmailAsk from '@/components/track/CheckinEmailAsk'
import s from '@/components/track/track.module.css'

const sameCompany = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

export default function TrackCta({ company, slug, responsePct = null }: {
  /** The company as the page shows it ("Walmart", never the lowercase slug name). */
  company: string
  /** The page's own slug (as in the URL) — where the confirmation link returns. */
  slug: string
  /** The reported reply rate, only when the page shows rates (lib/companyPageSummary ratesShown). */
  responsePct?: number | null
}) {
  const { isLoggedIn, ready } = useAuth()
  const [step, setStep] = useState<'idle' | 'form' | 'saved'>('idle')
  const [role, setRole] = useState('')
  const [choice, setChoice] = useState<AppliedChoice | null>(null)
  const [pickedDay, setPickedDay] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [app, setApp] = useState<Pick<Application, 'role' | 'appliedAt'> & { trackedAt: number } | null>(null)
  const [welcome, setWelcome] = useState(false)
  const [invite, setInvite] = useState(false)

  // Already tracking this company on this device / account: show it instead of asking again.
  useEffect(() => {
    try {
      const mine = AppStore.loadSync().find(a => a.status === 'active' && sameCompany(a.company || '', company))
      if (mine) { setApp({ role: mine.role, appliedAt: mine.appliedAt, trackedAt: mine.updatedAt || Date.now() }); setStep('saved') }
    } catch { /* storage blocked */ }
    setInvite(hasPendingRef())
  }, [company, isLoggedIn])

  // Back from the confirmation email (?checkins=on): say it worked, once, and tidy the address bar.
  useEffect(() => {
    if (!ready || typeof window === 'undefined') return
    const u = new URL(window.location.href)
    if (u.searchParams.get('checkins') !== 'on') return
    u.searchParams.delete('checkins')
    window.history.replaceState(window.history.state, '', `${u.pathname}${u.search}${u.hash}`)
    if (isLoggedIn) setWelcome(true)
  }, [ready, isLoggedIn])

  // The account picks up the guest's application on first sign-in (lib/pendingApplicationClient.ts).
  useEffect(() => {
    const onImported = () => {
      const mine = AppStore.loadSync().find(a => a.status === 'active' && sameCompany(a.company || '', company))
      if (mine) { setApp({ role: mine.role, appliedAt: mine.appliedAt, trackedAt: Date.now() }); setStep('saved') }
    }
    window.addEventListener('seen:applications-imported', onImported)
    return () => window.removeEventListener('seen:applications-imported', onImported)
  }, [company])

  // Only emails still to come (an application tracked weeks ago has had some already).
  const plan = useMemo(() => (app ? checkinEmailPlan(app.appliedAt, app.trackedAt).filter(p => p.at > Date.now()) : []), [app])
  const next = safeNextPath(`/company/${slug}?checkins=on`) || '/tracker'

  async function track() {
    const r = role.trim()
    if (!r) { setError('Add the job title you applied for.'); return }
    if (r.length > ROLE_MAX) { setError(`Keep the job title under ${ROLE_MAX} characters.`); return }
    if (!choice) { setError('Pick when you applied.'); return }
    const appliedAt = appliedAtFromChoice(choice, pickedDay)
    if (appliedAt == null) { setError('Pick the day you applied (today or earlier).'); return }
    setError(''); setBusy(true)
    try {
      await AppStore.add({ company, role: r, platform: 'Seen', status: 'active', stage: 'Applied', appliedAt }, isLoggedIn)
      setApp({ role: r, appliedAt, trackedAt: Date.now() })
      setStep('saved')
    } catch {
      setError('Could not save it on this device. Check that your browser allows site storage.')
    }
    setBusy(false)
  }

  const replyLine = responsePct != null
    ? <p className={s.fact} data-testid="track-reply-rate">{company} usually replies to {responsePct}% of applicants.</p>
    : null

  if (step === 'saved' && app) {
    const day = daysSince(app.appliedAt)
    return (
      <section className={s.card} aria-label={`Your ${company} application`} data-testid="track-cta">
        {welcome && isLoggedIn ? (
          <p className={s.ok} data-testid="track-welcome">You&apos;re in. Your {company} check-ins are on.</p>
        ) : (
          <p className={s.ok}>Tracked.</p>
        )}
        <p className={s.small} style={{ marginTop: 0, marginBottom: '.6rem', color: 'var(--sub)' }}>
          {app.role} · Day {day}{isLoggedIn ? '' : ' · saved on this device'}
        </p>
        {replyLine}
        {isLoggedIn ? (
          <>
            <p className={s.sub} data-testid="track-signed-in">
              {plan.length
                ? <>We&apos;ll email you on {joinDays(plan)} to ask what happened, unless you update it first.</>
                : <>Update it in your tracker when you hear back.</>}
            </p>
            <div className={s.actions}><a href="/tracker" className={s.link}>Open your tracker →</a></div>
          </>
        ) : (
          <CheckinEmailAsk company={company} plan={plan} next={next} inviteWaiting={invite} />
        )}
      </section>
    )
  }

  if (step === 'form') {
    return (
      <section className={s.card} aria-label={`Track your ${company} application`} data-testid="track-cta">
        <p className={s.title}>Track your {company} application</p>
        <form onSubmit={e => { e.preventDefault(); void track() }}>
          <div className={s.field}>
            <label className={s.label} htmlFor="track-role">Job title</label>
            <input
              id="track-role"
              type="text"
              className={s.input}
              placeholder="e.g. Cashier"
              autoComplete="organization-title"
              maxLength={ROLE_MAX}
              value={role}
              onChange={e => setRole(e.target.value)}
              data-testid="track-role"
              autoFocus
            />
          </div>
          <AppliedWhen choice={choice} pickedDay={pickedDay} onChoice={c => { setChoice(c); setError('') }} onPickedDay={setPickedDay} />
          {error && <p className={s.err} role="alert" style={{ marginTop: 0, marginBottom: '.6rem' }}>{error}</p>}
          <button type="submit" className={s.primary} disabled={busy} data-testid="track-submit">{busy ? 'Saving…' : 'Track it'}</button>
          <div className={s.actions}>
            <button type="button" className={`${s.link} ${s.linkDim}`} onClick={() => { setStep('idle'); setError('') }}>Cancel</button>
          </div>
        </form>
      </section>
    )
  }

  return (
    <section className={s.card} aria-label={`Applied to ${company}?`} data-testid="track-cta">
      <p className={s.title}>Applied to {company}?</p>
      <p className={s.sub}>Track it and we&apos;ll check in on day 7, 14 and 30.</p>
      <button type="button" className={s.primary} onClick={() => setStep('form')} data-testid="track-open">Track my application</button>
    </section>
  )
}

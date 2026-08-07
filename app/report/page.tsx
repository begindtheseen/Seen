'use client'

import { useState, useEffect, useRef, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { AppStore } from '@/lib/stores/AppStore'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import OutcomeCard from '@/components/OutcomeCard'
import { isRedditSourced, PUBLIC_DISCUSSION_LABEL } from '@/lib/reportSource'
import type { Application } from '@/lib/types'

type Outcome = 'ghosted' | 'autoreject' | 'human' | 'waiting' | ''
type Stage = 'application' | 'phone' | 'interview' | 'final' | ''

// Human-readable labels for stored outcome enums — never show raw "autoreject"/"human" to users.
const OUTCOME_LABELS: Record<string, string> = {
  ghosted: 'Ghosted', autoreject: 'Auto-rejected', rejected: 'Rejected', human: 'Human reply',
  interview: 'Interview', interviewing: 'Interviewing', offer: 'Offer', hired: 'Hired', waiting: 'Still waiting',
}
const outcomeLabel = (o: string) => OUTCOME_LABELS[o] || (o ? o.charAt(0).toUpperCase() + o.slice(1) : '—')

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--surface)',
  border: '1.5px solid var(--line2)',
  borderRadius: 8,
  padding: '.62rem .9rem',
  color: 'var(--white)',
  fontFamily: 'var(--body)',
  fontSize: '.875rem',
  outline: 'none',
  caretColor: 'var(--blue)',
  marginBottom: '.85rem',
}

const selectStyle: React.CSSProperties = {
  ...{} as React.CSSProperties,
  width: '100%',
  background: 'var(--surface)',
  border: '1.5px solid var(--line2)',
  borderRadius: 8,
  padding: '.62rem .9rem',
  color: 'var(--white)',
  fontFamily: 'var(--body)',
  fontSize: '.875rem',
  outline: 'none',
  cursor: 'pointer',
  marginBottom: '.85rem',
}

const lbl = (text: string) => (
  <label style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', textTransform: 'uppercase' as const, letterSpacing: '.08em', color: 'var(--dim)', display: 'block', marginBottom: '.3rem' }}>
    {text}
  </label>
)

function RadioGroup<T extends string>({
  name, options, value, onChange,
}: {
  name: string
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', marginBottom: '.85rem' }}>
      {options.map(o => (
        <label
          key={o.value}
          style={{
            display: 'flex', alignItems: 'center', gap: '.35rem',
            background: value === o.value ? 'var(--bdim)' : 'var(--surface)',
            border: `1.5px solid ${value === o.value ? 'var(--blue)' : 'var(--line2)'}`,
            borderRadius: 8, padding: '.45rem .85rem', cursor: 'pointer',
            fontFamily: 'var(--mono)', fontSize: '.68rem', color: value === o.value ? 'var(--white)' : 'var(--sub)',
            transition: 'all .15s',
          }}
        >
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={value === o.value}
            onChange={() => onChange(o.value)}
            style={{ display: 'none' }}
          />
          {o.label}
        </label>
      ))}
    </div>
  )
}

// Map a tracker terminal status → the report form's Outcome enum.
// hired has no slot in the anonymous Outcome union (it's an offer outcome the create_from_tracker
// path records directly), so we leave the form blank for hired and rely on autoApp for the card.
function statusToOutcome(status?: string): Outcome {
  if (status === 'ghosted') return 'ghosted'
  if (status === 'rejected') return 'autoreject'
  return ''
}

function ReportPage() {
  const searchParams = useSearchParams()
  const { isLoggedIn } = useAuth()
  const appId = searchParams?.get('app_id') || null
  const auto = searchParams?.get('auto') === '1'

  const [company, setCompany] = useState('')
  const [role, setRole] = useState('')
  const [location, setLocation] = useState('')
  const [platform, setPlatform] = useState('')
  const [outcome, setOutcome] = useState<Outcome>('')
  const [stage, setStage] = useState<Stage>('')
  const [rounds, setRounds] = useState('0')
  const [unpaid, setUnpaid] = useState('na')
  const [experience, setExperience] = useState('')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [recentReports, setRecentReports] = useState<Array<{id:string;outcome:string;company_name?:string;role?:string;platform?:string;created_at:string}>>([])
  const [matchedAppId, setMatchedAppId] = useState<string | null>(null)
  const [trackerUpdated, setTrackerUpdated] = useState(false)
  // The tracked app for one-click card mode (?app_id=&auto=1). When set, we render the
  // OutcomeCard live over the prefilled form and record a first-party create_from_tracker report.
  const [autoApp, setAutoApp] = useState<Application | null>(null)
  const [trackerSubmitted, setTrackerSubmitted] = useState(false)
  // Low-friction deep links (/report?company=X&outcome=ghosted from /agencies, /ghosted, company
  // pages): when the URL prefills the form we show a confirm strip and drop the cursor on the
  // first field still missing, so the happy path is type-one-thing-and-submit.
  const [urlPrefilled, setUrlPrefilled] = useState(false)
  const roleRef = useRef<HTMLInputElement>(null)
  const locationRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    try {
      // EXPLICIT URL params win over any tracker guess. Job pages and company pages link
      // here with ?company=&role=&outcome= — ignoring them prefilled the form with a
      // DIFFERENT company from the user's tracker, one click away from a wrong-company report.
      const urlCompany = searchParams?.get('company') || ''
      const urlRole = searchParams?.get('role') || ''
      const urlOutcomeRaw = (searchParams?.get('outcome') || '').toLowerCase()
      // Map caller vocab onto the form's outcome union ('human' = a person responded).
      const OUTCOME_MAP: Record<string, Outcome> = {
        ghosted: 'ghosted', autoreject: 'autoreject', rejected: 'autoreject',
        interview: 'human', interviewing: 'human', hired: 'human', offer: 'human',
        waiting: 'waiting',
      }
      const urlOutcome = OUTCOME_MAP[urlOutcomeRaw]
      if (urlCompany) {
        setCompany(urlCompany)
        if (urlRole) setRole(urlRole)
        if (urlOutcome) setOutcome(urlOutcome)
        setUrlPrefilled(true)
        // Land the cursor on the first field still missing so the prefilled link is
        // fill-one-gap-and-submit. (Required fields stay required — this is friction
        // reduction, not validation reduction.)
        setTimeout(() => { (urlRole ? locationRef : roleRef).current?.focus() }, 0)
        return // do NOT overwrite explicit intent with tracker data
      }
      // Outcome-only links (/report?outcome=ghosted from /ghosted and /agencies): honor the
      // explicit outcome, then let the tracker fill the who/what below WITHOUT overriding it.
      if (urlOutcome) setOutcome(urlOutcome)

      const apps = AppStore.loadSync()
      if (!apps.length) return
      // One-click mode: prefer the explicitly-passed tracked app.
      const explicit = appId ? apps.find(a => a.id === appId) : null
      // Otherwise prefer the most recent terminal app (the user is probably reporting on it).
      const terminal = apps.filter(a => a.status === 'ghosted' || a.status === 'rejected' || a.status === 'hired')
      const source = explicit || (terminal.length ? terminal[0] : apps[0])
      if (!source) return
      if (source.company) setCompany(source.company)
      if (source.role) setRole(source.role)
      if (source.location) setLocation(source.location)
      if (source.platform) setPlatform(source.platform)
      // An explicit ?outcome= param wins over the tracker's guess (URL params are intent).
      if (!urlOutcome) setOutcome(statusToOutcome(source.status))
      // Auto card: a terminal tracked app + auto=1 → show the live OutcomeCard immediately.
      const isTerminal = source.status === 'ghosted' || source.status === 'rejected' || source.status === 'hired'
      if (auto && explicit && isTerminal) setAutoApp(source)
    } catch {}
  }, [appId, auto, searchParams])

  // Record the first-party report from real tracker data (full trust, anti-Sybil checked
  // server-side) the moment the one-click card opens. Fires at most once per app.
  useEffect(() => {
    if (!autoApp || trackerSubmitted) return
    setTrackerSubmitted(true)
    const outcomeForStatus = autoApp.status === 'hired' ? 'hired' : autoApp.status === 'rejected' ? 'rejected' : 'ghosted'
    ;(async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) return // anonymous can't create a first-party tracker report; card still shows
        await fetch('/api/reports', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({
            action: 'create_from_tracker',
            company: autoApp.company,
            role: autoApp.role,
            location: autoApp.location || '',
            platform: autoApp.platform || '',
            outcome: outcomeForStatus,
          }),
        })
      } catch { /* non-blocking — the card is the user-facing win */ }
    })()
  }, [autoApp, trackerSubmitted])

  // Record a light share/download analytics row (outcome_card_shares). Non-blocking.
  const recordCardShare = async (via: string) => {
    if (!autoApp) return
    const outcomeForStatus = autoApp.status === 'hired' ? 'hired' : autoApp.status === 'rejected' ? 'rejected' : 'ghosted'
    try {
      const { data: { session } } = await supabase.auth.getSession()
      await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}) },
        body: JSON.stringify({ action: 'record_card_share', company: autoApp.company, outcome: outcomeForStatus, shared_via: via }),
      })
    } catch { /* analytics is best-effort */ }
  }

  useEffect(() => {
    fetch('/api/reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'feed', limit: 5, offset: 0 }),
    })
      .then(r => r.json())
      .then((d: { reports?: Array<{id:string;outcome:string;company_name?:string;role?:string;platform?:string;created_at:string}> }) => {
        if (d.reports?.length) setRecentReports(d.reports)
      })
      .catch(() => {})
  }, [])

  async function submit() {
    if (!company.trim() || !role.trim() || !location.trim()) {
      setError('Company, job title, and location are required.')
      return
    }
    if (!outcome) {
      setError('Select an outcome.')
      return
    }
    setLoading(true)
    setError('')

    // Moderate first
    try {
      const modRes = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'moderate', company, role, location, experience: notes }),
      })
      if (modRes.ok) {
        const mod = await modRes.json() as { ok: boolean; issues?: string[] }
        if (!mod.ok && mod.issues?.length) {
          setError(mod.issues[0])
          setLoading(false)
          return
        }
      }
    } catch { /* moderate is non-blocking */ }

    // Submit — attach the auth token when signed in so the report is recorded as
    // first-party (full trust weight); anonymous reports still go through, down-weighted.
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}) },
        body: JSON.stringify({
          action: 'submit',
          company: company.trim().toLowerCase(),
          role: role.trim(),
          location: location.trim(),
          platform: platform.trim(),
          outcome,
          ghost_stage: outcome === 'ghosted' ? stage : null,
          rounds: parseInt(rounds) || 0,
          unpaid_work: unpaid,
          experience_level: experience,
          report_text: notes.trim() || null,
        }),
      })
      if (!res.ok) throw new Error('Submit failed')
      setDone(true)
      // Find matching tracker app to offer update
      try {
        const apps = AppStore.loadSync()
        const match = apps.find(a => a.company.toLowerCase().trim() === company.trim().toLowerCase())
        if (match && match.status === 'active') setMatchedAppId(match.id)
      } catch {}
    } catch {
      setError('Submission failed. Please try again.')
    }
    setLoading(false)
  }

  if (done) {
    return (
      <div style={{ minHeight: '70vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '80px 2rem 3rem' }}>
        <div style={{ textAlign: 'center', maxWidth: 440 }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>✅</div>
          <h2 style={{ fontFamily: 'var(--display)', fontSize: '1.5rem', fontWeight: 800, color: 'var(--white)', marginBottom: '.5rem' }}>
            Report submitted
          </h2>
          <p style={{ fontFamily: 'var(--mono)', fontSize: '.72rem', color: 'var(--sub)', lineHeight: 1.7, marginBottom: '1.5rem' }}>
            Thank you. Your experience has been added to the transparency feed and will update {company}&apos;s score in real time.
          </p>
          <div style={{ display: 'flex', gap: '.75rem', justifyContent: 'center' }}>
            <a href="/feed" style={{ background: 'none', border: '1px solid var(--line2)', borderRadius: 8, padding: '.6rem 1.25rem', fontFamily: 'var(--mono)', fontSize: '.7rem', color: 'var(--sub)', textDecoration: 'none' }}>
              View feed →
            </a>
            <a href={`/company/${encodeURIComponent(company.trim().toLowerCase().replace(/\s+/g, '-'))}`} style={{ background: 'var(--blue)', border: 'none', borderRadius: 8, padding: '.6rem 1.25rem', fontFamily: 'var(--mono)', fontSize: '.7rem', color: '#fff', textDecoration: 'none' }}>
              See {company} score →
            </a>
          </div>
          {matchedAppId && !trackerUpdated && (
            <div style={{ marginTop: '1.5rem', background: 'rgba(99,102,241,.08)', border: '1px solid rgba(99,102,241,.2)', borderRadius: 10, padding: '1rem 1.15rem', textAlign: 'left' }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--indigo)', marginBottom: '.35rem' }}>Your tracker still shows this as active</div>
              <div style={{ fontSize: '.72rem', color: 'var(--sub)', marginBottom: '.75rem' }}>Update it to match your report?</div>
              <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
                {/* Pass the real login state — hardcoding false meant the change never synced
                    to the DB and quietly reverted on the next load for signed-in users. */}
                {outcome === 'ghosted' && (
                  <button onClick={() => { AppStore.update(matchedAppId, { status: 'ghosted' }, isLoggedIn); setTrackerUpdated(true) }} style={{ fontFamily: 'var(--mono)', fontSize: '.65rem', background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 7, padding: '.35rem .8rem', color: 'var(--red)', cursor: 'pointer' }}>Mark as ghosted in tracker</button>
                )}
                {(outcome === 'autoreject' || outcome === 'human') && (
                  <button onClick={() => { AppStore.update(matchedAppId, { status: 'rejected', stage: 'Rejected' }, isLoggedIn); setTrackerUpdated(true) }} style={{ fontFamily: 'var(--mono)', fontSize: '.65rem', background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 7, padding: '.35rem .8rem', color: 'var(--red)', cursor: 'pointer' }}>Mark as rejected in tracker</button>
                )}
                {/* "Mark as hired" only makes sense when a human responded — offering it on a
                    "Still waiting" report was contradictory. */}
                {outcome === 'human' && (
                  <button onClick={() => { AppStore.update(matchedAppId, { status: 'hired', stage: 'Offer' }, isLoggedIn); setTrackerUpdated(true) }} style={{ fontFamily: 'var(--mono)', fontSize: '.65rem', background: 'rgba(16,185,129,.1)', border: '1px solid rgba(16,185,129,.3)', borderRadius: 7, padding: '.35rem .8rem', color: 'var(--green)', cursor: 'pointer' }}>Mark as hired in tracker</button>
                )}
                <button onClick={() => setMatchedAppId(null)} style={{ fontFamily: 'var(--mono)', fontSize: '.65rem', background: 'none', border: '1px solid var(--line2)', borderRadius: 7, padding: '.35rem .8rem', color: 'var(--dim)', cursor: 'pointer' }}>Skip</button>
              </div>
            </div>
          )}
          {trackerUpdated && (
            <div style={{ marginTop: '1.5rem', fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--green)', textAlign: 'center' }}>✓ Tracker updated</div>
          )}
        </div>
      </div>
    )
  }

  return (
    <>
    {/* One-click outcome card: live OutcomeCard rendered immediately over the prefilled form
        from REAL tracked data. Closing it returns to the (prefilled) report form. */}
    {autoApp && <OutcomeCard app={autoApp} onClose={() => setAutoApp(null)} onShared={recordCardShare} />}
    <div className="page-full">
      <div style={{ maxWidth: 680, margin: '0 auto', padding: '2.5rem 2rem', width: '100%', boxSizing: 'border-box' }}>
        {appId && auto && !autoApp && (
          <div style={{ background: 'rgba(99,102,241,.08)', border: '1px solid rgba(99,102,241,.22)', borderRadius: 10, padding: '.7rem 1rem', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.75rem', flexWrap: 'wrap' }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--sub)', lineHeight: 1.6 }}>
              ✦ Prefilled from your tracker.{company ? ` Reporting your ${company} outcome.` : ''}
            </div>
            <button
              onClick={() => { const apps = AppStore.loadSync(); const a = apps.find(x => x.id === appId); if (a) setAutoApp(a) }}
              style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', fontWeight: 700, color: '#fff', border: 'none', background: 'linear-gradient(135deg,#3b82f6 0%,#8b5cf6 100%)', borderRadius: 8, padding: '.45rem .9rem', cursor: 'pointer', flexShrink: 0 }}
            >
              ✦ Open share card
            </button>
          </div>
        )}
        {urlPrefilled && (
          <div style={{ background: 'rgba(59,130,246,.08)', border: '1px solid rgba(59,130,246,.22)', borderRadius: 10, padding: '.7rem 1rem', marginBottom: '1.25rem', fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--sub)', lineHeight: 1.6 }}>
            ✦ Prefilled for you{company ? <> — reporting <span style={{ color: 'var(--white)', fontWeight: 700 }}>{company}</span></> : ''}. Fill any missing field and hit submit.
          </div>
        )}
        <div style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', textTransform: 'uppercase', letterSpacing: '.22em', color: 'var(--blue)', marginBottom: '.6rem', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ width: 22, height: 1, background: 'var(--blue)', display: 'inline-block' }} />
          Anonymous report
        </div>
        <h1 style={{ fontFamily: 'var(--display)', fontSize: '1.75rem', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.03em', marginBottom: '.25rem' }}>
          Report your experience
        </h1>
        <p style={{ color: 'var(--sub)', fontSize: '.82rem', fontWeight: 300, marginBottom: '1.5rem' }}>
          Takes 60 seconds. Helps thousands of job seekers tonight. 100% anonymous.
        </p>

        {/* Step progress indicator */}
        {(() => { const step = outcome ? 2 : 1; return (
          <div style={{ display: 'flex', gap: '.5rem', marginBottom: '1.5rem', alignItems: 'center' }}>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '.3rem' }}>
              <div style={{ height: 3, background: 'var(--blue)', borderRadius: 2, width: '100%' }} />
              <div style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', color: 'var(--blue)', fontWeight: 700 }}>The listing</div>
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '.3rem' }}>
              <div style={{ height: 3, background: step >= 2 ? 'var(--blue)' : 'var(--line2)', borderRadius: 2, width: '100%' }} />
              <div style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', color: step >= 2 ? 'var(--blue)' : 'var(--dim)' }}>What happened</div>
            </div>
          </div>
        )})()}

        {error && (
          <div style={{ background: 'var(--rdim)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 8, padding: '.72rem 1rem', fontFamily: 'var(--mono)', fontSize: '.72rem', color: 'var(--red)', marginBottom: '1rem' }}>
            {error}
          </div>
        )}

        <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 14, padding: '1.75rem' }}>
          {/* Listing details */}
          <div style={{ marginBottom: '1.5rem' }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--dim)', marginBottom: '1rem', paddingBottom: '.5rem', borderBottom: '1px solid var(--line)' }}>
              The listing
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.75rem' }}>
              <div>
                {lbl('Company name *')}
                <input type="text" placeholder="e.g. Stripe" value={company} onChange={e => setCompany(e.target.value)} style={inputStyle} />
              </div>
              <div>
                {lbl('Job title *')}
                <input ref={roleRef} type="text" placeholder="e.g. Software Engineer" value={role} onChange={e => setRole(e.target.value)} style={inputStyle} />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.75rem' }}>
              <div>
                {lbl('City, State *')}
                <input ref={locationRef} type="text" placeholder="e.g. Austin, TX" value={location} onChange={e => setLocation(e.target.value)} style={inputStyle} />
              </div>
              <div>
                {lbl('Platform (optional)')}
                <input type="text" placeholder="LinkedIn, Indeed, Greenhouse..." value={platform} onChange={e => setPlatform(e.target.value)} style={inputStyle} />
              </div>
            </div>
          </div>

          {/* Outcome */}
          <div style={{ marginBottom: '1.5rem' }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--dim)', marginBottom: '1rem', paddingBottom: '.5rem', borderBottom: '1px solid var(--line)' }}>
              What happened?
            </div>
            {lbl('Outcome *')}
            <RadioGroup
              name="outcome"
              value={outcome}
              onChange={setOutcome}
              options={[
                { value: 'ghosted', label: '👻 Ghosted' },
                { value: 'autoreject', label: '🤖 Auto-rejected' },
                { value: 'human', label: '💬 Got a response' },
                { value: 'waiting', label: '⏳ Still waiting' },
              ]}
            />

            {outcome === 'ghosted' && (
              <>
                {lbl('Ghosted after which stage?')}
                <RadioGroup
                  name="stage"
                  value={stage}
                  onChange={setStage}
                  options={[
                    { value: 'application', label: 'Application' },
                    { value: 'phone', label: 'Phone screen' },
                    { value: 'interview', label: 'Interview' },
                    { value: 'final', label: 'Final round' },
                  ]}
                />
              </>
            )}
          </div>

          {/* Details */}
          <div style={{ marginBottom: '1.5rem' }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--dim)', marginBottom: '1rem', paddingBottom: '.5rem', borderBottom: '1px solid var(--line)' }}>
              Details
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '.75rem' }}>
              <div>
                {lbl('Interview rounds')}
                <select value={rounds} onChange={e => setRounds(e.target.value)} style={selectStyle}>
                  {['0','1','2','3','4','5','6+'].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div>
                {lbl('Unpaid work?')}
                <select value={unpaid} onChange={e => setUnpaid(e.target.value)} style={selectStyle}>
                  <option value="na">N/A</option>
                  <option value="yes">Yes — unpaid test</option>
                  <option value="paid">Yes — but paid</option>
                  <option value="no">No</option>
                </select>
              </div>
              <div>
                {lbl('Your level')}
                <select value={experience} onChange={e => setExperience(e.target.value)} style={selectStyle}>
                  <option value="">Prefer not to say</option>
                  <option value="entry">Entry level</option>
                  <option value="mid">Mid level</option>
                  <option value="senior">Senior</option>
                  <option value="lead">Lead / Staff</option>
                </select>
              </div>
            </div>
            {lbl('Anything else? (optional)')}
            <textarea
              placeholder="What stood out about this process? How did it make you feel?"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={4}
              style={{ width: '100%', background: 'var(--surface)', border: '1.5px solid var(--line2)', borderRadius: 8, padding: '.72rem 1rem', color: 'var(--white)', fontFamily: 'var(--mono)', fontSize: '.72rem', outline: 'none', resize: 'vertical', lineHeight: 1.6, caretColor: 'var(--blue)' }}
            />
          </div>

          <button
            onClick={submit}
            disabled={loading}
            style={{ width: '100%', background: 'linear-gradient(135deg,#3b82f6 0%,#8b5cf6 100%)', color: '#fff', border: 'none', borderRadius: 8, padding: '.85rem', fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.9rem', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1, boxShadow: '0 0 20px rgba(59,130,246,0.3)' }}
          >
            {loading ? 'Submitting...' : 'Submit report →'}
          </button>
          <p style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--muted)', textAlign: 'center', marginTop: '.75rem' }}>
            100% anonymous · No account required · No personal data stored
          </p>
        </div>

        {recentReports.length > 0 && (
          <div style={{ marginTop: '2.5rem', borderTop: '1px solid var(--line)', paddingTop: '1.5rem' }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--dim)', marginBottom: '1rem' }}>
              Recent community reports
            </div>
            {recentReports.map(r => (
              <div key={r.id} style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 8, padding: '.75rem 1rem', marginBottom: '.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
                <div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: '.68rem', color: 'var(--white)', fontWeight: 600 }}>{outcomeLabel(r.outcome)}</div>
                  {r.company_name && <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--blue)', marginTop: '.15rem' }}>@ {r.company_name}</div>}
                  {r.role && <div style={{ fontFamily: 'var(--mono)', fontSize: '.56rem', color: 'var(--dim)', marginTop: '.1rem' }}>{r.role}</div>}
                  {isRedditSourced(r.platform) && (
                    <div style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', color: 'var(--muted)', marginTop: '.2rem' }} title="Imported from a public Reddit thread, not submitted directly to Seen">{PUBLIC_DISCUSSION_LABEL}</div>
                  )}
                </div>
                <span style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', color: 'var(--muted)', flexShrink: 0 }}>
                  {new Date(r.created_at).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
    </>
  )
}

export default function ReportPageWrapper() {
  return (
    <Suspense fallback={<div className="page-full"><div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}><div className="spinner" /></div></div>}>
      <ReportPage />
    </Suspense>
  )
}

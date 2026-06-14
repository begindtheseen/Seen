'use client'

import { useEffect, useState, useCallback, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/lib/auth'
import { AppStore } from '@/lib/stores/AppStore'
import { EventStore } from '@/lib/stores/EventStore'
import { STAGES } from '@/lib/constants'
import type { Application } from '@/lib/types'
import OutcomeCard from '@/components/OutcomeCard'
import RoundsPrompt from '@/components/RoundsPrompt'

const STATUS_MAP: Record<string, string> = {
  active: '',
  ghosted: 'ghosted',
  hired: 'hired',
  rejected: 'rejected',
}

function getDaysSince(ts: number): number {
  return Math.floor((Date.now() - ts) / 86400000)
}

function AppCard({ app, onUpdate, onRemove }: {
  app: Application
  onUpdate: (id: string, changes: Partial<Application>) => void
  onRemove: (id: string) => void
}) {
  const days = getDaysSince(app.appliedAt)
  const statusClass = STATUS_MAP[app.status] || ''
  const isActive = app.status === 'active'
  const [expanded, setExpanded] = useState(false)

  return (
    <div className={`app-card ${statusClass}`} id={`app_${app.id}`}>
      {/* Clickable header — tap to expand/collapse update actions */}
      <div
        className="app-card-head"
        onClick={() => { if (isActive) setExpanded(e => !e) }}
        style={{ cursor: isActive ? 'pointer' : 'default' }}
      >
        <div className="app-logo">{app.company.charAt(0)}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="app-co">{app.company}</div>
          <div className="app-role">{app.role}</div>
          {app.location && <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--muted)' }}>{app.location}</div>}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '.25rem', flexShrink: 0 }}>
          {app.score != null && (
            <span style={{ fontFamily: 'var(--mono)', fontSize: '.65rem', color: app.score >= 70 ? 'var(--green)' : app.score >= 40 ? 'var(--amber)' : 'var(--red)', fontWeight: 600 }}>{app.score}</span>
          )}
          <span style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--muted)', background: 'var(--raised)', border: '1px solid var(--line)', borderRadius: 4, padding: '.1rem .35rem' }}>Day {days}</span>
          {isActive && (
            <span style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--blue)', marginTop: '.1rem' }}>{expanded ? '▲' : 'Update ▼'}</span>
          )}
        </div>
      </div>

      {/* Stage pipeline (active only, collapsed when expanded to save space) */}
      {isActive && !expanded && (
        <div className="app-stages" style={{ marginTop: '.65rem' }}>
          <div style={{ display: 'flex', gap: '.25rem', alignItems: 'center', overflowX: 'auto' }}>
            {STAGES.map((s, i) => {
              const stageIdx = STAGES.indexOf(app.stage as typeof STAGES[number])
              const isDone = i < stageIdx
              const isCurrent = i === stageIdx
              return (
                <div key={s} className={`stage-pip ${isDone ? 'done' : ''} ${isCurrent ? 'current' : ''}`} title={s}>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: '.5rem', whiteSpace: 'nowrap' }}>{s}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Terminal status badge */}
      {!isActive && (
        <div style={{ marginTop: '.5rem' }}>
          <span className={`status-pill ${app.status}`}>{app.status.charAt(0).toUpperCase() + app.status.slice(1)}</span>
        </div>
      )}

      {/* Meta row */}
      <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap', marginTop: '.5rem', alignItems: 'center' }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--muted)' }}>Applied {new Date(app.appliedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
        {app.platform && <span style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--muted)' }}>via {app.platform}</span>}
        {app.jobUrl && <a href={app.jobUrl} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--blue)', textDecoration: 'none' }}>View listing →</a>}
      </div>

      {/* Actions — shown when expanded */}
      {isActive && expanded && (
        <div className="app-actions" style={{ marginTop: '.85rem', borderTop: '1px solid var(--line)', paddingTop: '.75rem' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', textTransform: 'uppercase', letterSpacing: '.09em', color: 'var(--dim)', marginBottom: '.5rem' }}>What happened?</div>
          <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
            <button className="btn btn-ghost" style={{ fontSize: '.68rem', padding: '.4rem .85rem', borderColor: 'var(--green)', color: 'var(--green)', fontWeight: 600 }} onClick={e => { e.stopPropagation(); onUpdate(app.id, { status: 'hired', stage: 'Offer' }); setExpanded(false) }}>🎉 Got the job</button>
            <button className="btn btn-ghost" style={{ fontSize: '.68rem', padding: '.4rem .85rem', borderColor: 'rgba(239,68,68,.3)', color: 'var(--red)' }} onClick={e => { e.stopPropagation(); onUpdate(app.id, { status: 'ghosted' }); setExpanded(false) }}>👻 Ghosted</button>
            <button className="btn btn-ghost" style={{ fontSize: '.68rem', padding: '.4rem .85rem', color: 'var(--muted)' }} onClick={e => { e.stopPropagation(); onUpdate(app.id, { status: 'rejected' }); setExpanded(false) }}>❌ Rejected</button>
          </div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', textTransform: 'uppercase', letterSpacing: '.09em', color: 'var(--dim)', marginBottom: '.4rem', marginTop: '.65rem' }}>Move stage</div>
          <div style={{ display: 'flex', gap: '.35rem', flexWrap: 'wrap' }}>
            {STAGES.filter(s => s !== app.stage && s !== 'Offer').map(s => (
              <button key={s} className="btn btn-ghost" style={{ fontSize: '.62rem', padding: '.28rem .65rem' }} onClick={e => { e.stopPropagation(); onUpdate(app.id, { stage: s }); setExpanded(false) }}>→ {s}</button>
            ))}
          </div>
          <button
            onClick={e => { e.stopPropagation(); setExpanded(false) }}
            style={{ marginTop: '.65rem', background: 'none', border: 'none', fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--muted)', cursor: 'pointer', padding: '0' }}
          >
            ✕ collapse
          </button>
        </div>
      )}
      {!isActive && (
        <div style={{ marginTop: '.75rem', display: 'flex', gap: '.4rem' }}>
          <button className="btn btn-ghost" style={{ fontSize: '.62rem', padding: '.28rem .65rem', color: 'var(--muted)' }} onClick={() => onRemove(app.id)}>Remove</button>
        </div>
      )}
    </div>
  )
}

function CheckCard({ check, onAnswer, onSnooze }: {
  check: ReturnType<typeof EventStore.dueChecks>[0]
  onAnswer: (appId: string, checkType: string, data: Record<string, unknown>) => void
  onSnooze: (appId: string, checkType: string) => void
}) {
  const { app, checkType, daysElapsed, label, q } = check
  const answers: Array<{ label: string; data: Record<string, unknown>; highlight?: boolean }> = []
  if (checkType === 'response_check') {
    answers.push({ label: '✅ Got a response', data: { got_response: true, response_type: 'unknown', days_to_response: daysElapsed }, highlight: true })
    answers.push({ label: '📅 Interview scheduled', data: { got_response: true, response_type: 'interview', days_to_response: daysElapsed }, highlight: true })
    answers.push({ label: '❌ Rejected', data: { got_response: true, response_type: 'rejection', days_to_response: daysElapsed } })
    answers.push({ label: '👻 Ghosted', data: { got_response: false, response_type: 'ghosted', days_to_response: daysElapsed } })
    answers.push({ label: '↩ I withdrew', data: { got_response: false, response_type: 'withdrew', withdrew: true, days_to_response: daysElapsed } })
  } else if (checkType === 'interview_check') {
    answers.push({ label: '✅ Had an interview', data: { had_interview: true, interview_type: 'interview' }, highlight: true })
    answers.push({ label: '📞 Phone screen only', data: { had_interview: true, interview_type: 'phone_screen' }, highlight: true })
    answers.push({ label: '❌ Rejected', data: { had_interview: false, ended: true, outcome: 'rejected' } })
    answers.push({ label: '👻 Still no response', data: { had_interview: false, ended: false } })
    answers.push({ label: '↩ I withdrew', data: { had_interview: false, ended: true, outcome: 'withdrew', withdrew: true } })
  } else {
    answers.push({ label: '🎉 Got an offer!', data: { outcome: 'offer' }, highlight: true })
    answers.push({ label: '❌ Rejected', data: { outcome: 'rejected' } })
    answers.push({ label: '👻 Ghosted', data: { outcome: 'ghosted' } })
    answers.push({ label: '🔄 Still active', data: { outcome: 'active' } })
    answers.push({ label: '↩ I withdrew', data: { outcome: 'withdrew', withdrew: true } })
  }

  return (
    <div className="check-card">
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '.5rem' }}>
        <div>
          <div style={{ fontFamily: 'var(--display)', fontWeight: 700, fontSize: '.85rem', color: 'var(--white)' }}>{app.company}</div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--muted)' }}>{app.role} · Day {daysElapsed}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', flexShrink: 0 }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--amber)', background: 'rgba(245,158,11,.1)', border: '1px solid rgba(245,158,11,.2)', borderRadius: 4, padding: '.15rem .45rem' }}>{label}</span>
          <button onClick={() => onSnooze(app.id, checkType)} style={{ background: 'none', border: 'none', fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--muted)', cursor: 'pointer', padding: '.1rem .3rem' }} title="Remind me tomorrow">✕</button>
        </div>
      </div>
      <div style={{ fontSize: '.78rem', color: 'var(--sub)', marginBottom: '.65rem' }}>{q}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.45rem' }}>
        {answers.map(a => (
          <button key={a.label} className="btn btn-ghost" style={{ fontSize: '.7rem', padding: '.38rem .75rem', ...(a.highlight ? { borderColor: 'var(--green)', color: 'var(--green)' } : {}) }} onClick={() => onAnswer(app.id, checkType, a.data)}>
            {a.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function TrackerPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { isLoggedIn, isSeeker } = useAuth()
  const [apps, setApps] = useState<Application[]>([])
  const [loading, setLoading] = useState(true)
  const [outcomeApp, setOutcomeApp] = useState<Application | null>(null)
  const [roundsApp, setRoundsApp] = useState<Application | null>(null)
  const [showManual, setShowManual] = useState(false)
  const [manualForm, setManualForm] = useState({ company: '', role: '', location: '', platform: 'Direct' })
  const [highlightNew, setHighlightNew] = useState(false)
  const highlightedRef = useRef(false)
  const [updateInsight, setUpdateInsight] = useState<{ title: string; body: string; color: string } | null>(null)

  useEffect(() => {
    if (!isLoggedIn) { router.replace('/login'); return }
    if (isLoggedIn && !isSeeker) { router.replace('/'); return }
  }, [isLoggedIn, isSeeker, router])

  const loadApps = useCallback(async () => {
    const data = await AppStore.load(isLoggedIn)
    setApps(data)
    setLoading(false)
    if (searchParams?.get('new') === '1' && !highlightedRef.current && data.length > 0) {
      highlightedRef.current = true
      setHighlightNew(true)
      setTimeout(() => {
        const el = document.getElementById(`app_${data[0].id}`)
        if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }) }
        setTimeout(() => setHighlightNew(false), 2800)
      }, 300)
    }
  }, [isLoggedIn, searchParams])

  useEffect(() => {
    if (!isLoggedIn) return
    loadApps()
  }, [isLoggedIn, loadApps])

  const handleUpdate = async (id: string, changes: Partial<Application>) => {
    await AppStore.update(id, changes, isLoggedIn)
    const terminalStatuses = ['hired', 'ghosted', 'rejected']
    if (changes.status && terminalStatuses.includes(changes.status)) {
      const updated = await AppStore.load(isLoggedIn)
      setApps(updated)
      const app = updated.find(a => a.id === id)
      if (app) {
        const merged = { ...app, ...changes }
        setOutcomeApp(merged)
        if (changes.status === 'hired') setRoundsApp(merged)
      }
    } else {
      loadApps()
    }
  }

  const handleCheckInsight = async (app: Application, checkType: string, data: Record<string, unknown>) => {
    // Fetch company score for context-aware insight
    let score: { ghost_rate: number; avg_wait_days: number; overall_score: number } | null = null
    try {
      const r = await fetch('/api/reports', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: app.company }),
      })
      const d = await r.json()
      if (d.score) score = d.score
    } catch {}

    const days = Math.floor((Date.now() - app.appliedAt) / 86400000)

    if (checkType === 'response_check') {
      const rt = data.response_type as string
      if (rt === 'ghosted') {
        const ghostPct = score ? Math.round(score.ghost_rate * 100) : null
        setUpdateInsight({
          title: '👻 Ghost documented',
          body: ghostPct != null
            ? `${app.company} has a ${ghostPct}% ghost rate. You're not alone — this data helps warn other applicants.`
            : `Ghosting logged after ${days} days. This adds to the public record for ${app.company}.`,
          color: 'rgba(156,163,175,0.15)',
        })
      } else if (rt === 'interview') {
        const avgWait = score?.avg_wait_days ?? 21
        setUpdateInsight({
          title: '📞 Interview unlocked — you\'re ahead',
          body: `You reached the interview stage at ${app.company} in ${days} days. The average applicant waits ${avgWait} days just for a first response.`,
          color: 'rgba(99,102,241,0.12)',
        })
      } else if (rt !== 'withdrew') {
        const avgWait = score?.avg_wait_days ?? 21
        setUpdateInsight({
          title: '✅ Response received',
          body: days <= avgWait
            ? `${app.company} responded in ${days} days — faster than their ${avgWait}-day average.`
            : `Response took ${days} days vs their ${avgWait}-day average. Logged.`,
          color: 'rgba(16,185,129,0.1)',
        })
      }
    } else if (checkType === 'interview_check') {
      if (data.interview_type) {
        setUpdateInsight({
          title: '🗓 Interview stage confirmed',
          body: `You\'re in the interview stage at ${app.company} after ${days} days. Top 20-30% of applicants reach this point.`,
          color: 'rgba(99,102,241,0.12)',
        })
      }
    } else if (checkType === 'outcome_check') {
      const outcome = data.outcome as string
      if (outcome === 'ghosted') {
        setUpdateInsight({
          title: '👻 Final outcome: Ghosted',
          body: `${app.company} went silent after ${days} days. Outcome card coming next — your experience will be visible to future applicants.`,
          color: 'rgba(156,163,175,0.12)',
        })
      }
    }
  }

  const handleRemove = async (id: string) => {
    await AppStore.remove(id, isLoggedIn)
    loadApps()
  }

  const handleCheckAnswer = (appId: string, checkType: string, data: Record<string, unknown>) => {
    EventStore.add({ appId, type: checkType, data })
    const app = apps.find(a => a.id === appId)
    if (app) handleCheckInsight(app, checkType, data)
    if (data.withdrew) {
      handleUpdate(appId, { status: 'rejected', stage: 'Rejected' })
      return
    }
    if (checkType === 'outcome_check') {
      const outcome = data.outcome as string
      if (outcome === 'offer') handleUpdate(appId, { status: 'hired', stage: 'Offer' })
      else if (outcome === 'rejected') handleUpdate(appId, { status: 'rejected', stage: 'Rejected' })
      else if (outcome === 'ghosted') handleUpdate(appId, { status: 'ghosted' })
      else loadApps()
    } else if (checkType === 'response_check') {
      const rt = data.response_type as string
      if (rt === 'ghosted') handleUpdate(appId, { status: 'ghosted' })
      else if (rt === 'rejection') handleUpdate(appId, { status: 'rejected', stage: 'Rejected' })
      else if (rt === 'interview') handleUpdate(appId, { stage: 'Interview' })
      else loadApps()
    } else if (checkType === 'interview_check') {
      const it = data.interview_type as string
      if (data.ended && (data.outcome as string) === 'rejected') handleUpdate(appId, { status: 'rejected', stage: 'Rejected' })
      else if (it === 'phone_screen') handleUpdate(appId, { stage: 'Phone Screen' })
      else if (it === 'interview') handleUpdate(appId, { stage: 'Interview' })
      else loadApps()
    } else {
      loadApps()
    }
  }

  const handleSnooze = (appId: string, checkType: string) => {
    EventStore.snooze(appId, checkType)
    loadApps()
  }

  const clearDupes = () => {
    const seen = new Set<string>()
    const local = AppStore.loadSync()
    const deduped = local.filter(a => {
      const key = `${a.company.toLowerCase()}|${a.role.toLowerCase()}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    localStorage.setItem('seen_applications_v1', JSON.stringify(deduped))
    loadApps()
  }

  if (!isLoggedIn || !isSeeker) return null
  if (loading) return <div className="page-full"><div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}><div className="spinner" /></div></div>

  const active = apps.filter(a => a.status === 'active')
  const ghosted = apps.filter(a => a.status === 'ghosted')
  const hired = apps.filter(a => a.status === 'hired')
  const rejected = apps.filter(a => a.status === 'rejected')
  const dueChecks = EventStore.dueChecks(apps)

  const handleManualAdd = async () => {
    if (!manualForm.company.trim() || !manualForm.role.trim()) return
    await AppStore.add({ company: manualForm.company.trim(), role: manualForm.role.trim(), location: manualForm.location.trim(), platform: manualForm.platform, stage: 'Applied', status: 'active' }, isLoggedIn)
    setApps(AppStore.loadSync())
    setManualForm({ company: '', role: '', location: '', platform: 'Direct' })
    setShowManual(false)
  }

  return (
    <>
    {/* Manual add modal */}
    {showManual && (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.8)', zIndex: 9000, backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        onClick={e => { if (e.target === e.currentTarget) setShowManual(false) }}>
        <div style={{ width: 'calc(100% - 2rem)', maxWidth: 440, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14, overflow: 'hidden' }}>
          <div style={{ padding: '.9rem 1.1rem', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontFamily: 'var(--display)', fontSize: '.88rem', fontWeight: 700, color: 'var(--white)' }}>Track application</span>
            <button onClick={() => setShowManual(false)} style={{ background: 'none', border: 'none', color: 'var(--dim)', cursor: 'pointer', fontSize: '1rem' }}>✕</button>
          </div>
          <div style={{ padding: '1rem 1.1rem', display: 'flex', flexDirection: 'column', gap: '.65rem' }}>
            {[
              { key: 'company', label: 'Company *', placeholder: 'e.g. Stripe' },
              { key: 'role', label: 'Role *', placeholder: 'e.g. Software Engineer' },
              { key: 'location', label: 'Location', placeholder: 'e.g. Remote' },
              { key: 'platform', label: 'Applied via', placeholder: 'e.g. LinkedIn, Direct' },
            ].map(f => (
              <div key={f.key}>
                <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--muted)', marginBottom: '.25rem', textTransform: 'uppercase', letterSpacing: '.06em' }}>{f.label}</div>
                <input
                  value={manualForm[f.key as keyof typeof manualForm]}
                  onChange={e => setManualForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && handleManualAdd()}
                  placeholder={f.placeholder}
                  style={{ width: '100%', background: 'var(--card)', border: '1.5px solid var(--line2)', borderRadius: 8, padding: '.5rem .75rem', color: 'var(--white)', fontFamily: 'var(--body)', fontSize: '.82rem', outline: 'none', boxSizing: 'border-box' }}
                />
              </div>
            ))}
            <button
              className="btn btn-green"
              style={{ width: '100%', justifyContent: 'center', marginTop: '.25rem' }}
              onClick={handleManualAdd}
              disabled={!manualForm.company.trim() || !manualForm.role.trim()}
            >
              Add to tracker →
            </button>
          </div>
        </div>
      </div>
    )}
    {outcomeApp && <OutcomeCard app={outcomeApp} onClose={() => setOutcomeApp(null)} />}
    {roundsApp && !outcomeApp && (
      <RoundsPrompt
        app={roundsApp}
        onSubmit={(rounds, notes) => {
          EventStore.add({ appId: roundsApp.id, type: 'rounds_reported', data: { rounds, notes } })
          setRoundsApp(null)
        }}
        onSkip={() => setRoundsApp(null)}
      />
    )}
    <div className="page-full">
      <div style={{ maxWidth: 1000, margin: '0 auto', padding: '2.5rem 2rem' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.5rem' }}>
          <div>
            <div className="eyebrow">Application tracker</div>
            <h1 style={{ fontFamily: 'var(--display)', fontSize: '1.9rem', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.03em', marginBottom: '.3rem' }}>My applications</h1>
            <p style={{ color: 'var(--sub)', fontSize: '.82rem', fontWeight: 300 }}>Synced to your account across all devices.</p>
          </div>
          <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
            <button className="btn btn-green" style={{ fontSize: '.72rem' }} onClick={() => setShowManual(true)}>+ Track manually</button>
            {<button className="btn btn-ghost" style={{ fontSize: '.72rem' }} onClick={clearDupes}>Clear dupes</button>}
            {apps.length > 0 && <button className="btn btn-ghost" style={{ fontSize: '.72rem', color: 'var(--muted)' }} onClick={() => { if (confirm('Remove all applications? This cannot be undone.')) { AppStore.clear(); setApps([]) } }}>Clear all</button>}
          </div>
        </div>

        {/* Stats */}
        <div style={{ display: 'flex', gap: '.75rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
          {[
            { label: 'Total', n: apps.length },
            { label: 'Active', n: active.length },
            { label: 'Hired', n: hired.length },
            { label: 'Ghosted', n: ghosted.length },
            { label: 'Rejected', n: rejected.length },
          ].map(s => (
            <div key={s.label} className="tracker-stat">
              <span className="tracker-stat-n">{s.n}</span>
              <span className="tracker-stat-l">{s.label}</span>
            </div>
          ))}
        </div>

        {/* Funnel visualization */}
        {apps.length >= 2 && (
          <div style={{ marginBottom: '1.5rem', background: 'var(--raised)', border: '1px solid var(--line2)', borderRadius: 12, padding: '1rem 1.25rem' }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', textTransform: 'uppercase', letterSpacing: '.09em', color: 'var(--dim)', marginBottom: '.85rem' }}>Application Funnel</div>
            <div className="funnel">
              {(() => {
                const stageLevel = (s: string) => ['Applied', 'Viewed', 'Phone Screen', 'Interview', 'Final Round', 'Offer'].indexOf(s)
                const screened = apps.filter(a => stageLevel(a.stage) >= 1 || a.status !== 'active').length
                const interviewed = apps.filter(a => stageLevel(a.stage) >= 3 || a.status === 'hired').length
                return [
                  { label: 'Applied', n: apps.length, color: 'var(--blue)' },
                  { label: 'Screened', n: screened, color: '#6366f1' },
                  { label: 'Interview', n: interviewed, color: 'var(--amber)' },
                  { label: 'Hired', n: hired.length, color: 'var(--green)' },
                ].map(s => (
                  <div className="funnel-stage" key={s.label}>
                    <div className="funnel-label">{s.label}</div>
                    <div className="funnel-bar-wrap">
                      <div className="funnel-bar-fill" style={{ width: apps.length ? `${Math.round(s.n / apps.length * 100)}%` : '0%', background: s.color }} />
                    </div>
                    <div className="funnel-pct">{s.n}</div>
                  </div>
                ))
              })()}
            </div>
            {ghosted.length > 0 && (
              <div className="funnel-ghost-note" style={{ marginTop: '.5rem' }}>👻 {ghosted.length} ghosted before responding</div>
            )}
          </div>
        )}

        {/* Pipeline (active apps, desktop) */}
        {active.length > 0 && (
          <div className="tracker-pipeline-wrap" style={{ marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', gap: '.75rem', overflowX: 'auto', padding: '.25rem 0' }}>
              {STAGES.map(stage => {
                const stageApps = active.filter(a => a.stage === stage)
                if (!stageApps.length) return null
                return (
                  <div key={stage} className="pipeline-col">
                    <div style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--muted)', marginBottom: '.5rem' }}>{stage} <span style={{ color: 'var(--sub)' }}>({stageApps.length})</span></div>
                    {stageApps.slice(0, 3).map(a => (
                      <div key={a.id} className="pipeline-mini-card">
                        <div style={{ fontFamily: 'var(--display)', fontSize: '.72rem', fontWeight: 700, color: 'var(--white)', marginBottom: '.1rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.company}</div>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.role.slice(0, 22)}{a.role.length > 22 ? '…' : ''}</div>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', color: 'var(--dim)', marginTop: '.25rem' }}>Day {getDaysSince(a.appliedAt)}</div>
                      </div>
                    ))}
                    {stageApps.length > 3 && <div style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--muted)', padding: '.2rem 0' }}>+{stageApps.length - 3} more</div>}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Update insight — shown after answering a check card */}
        {updateInsight && (
          <div style={{ marginBottom: '1.25rem', background: updateInsight.color, border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, padding: '1rem 1.1rem', animation: 'fadeUp .3s ease both', display: 'flex', gap: '.85rem', alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: 'var(--display)', fontSize: '.82rem', fontWeight: 700, color: 'var(--white)', marginBottom: '.3rem' }}>{updateInsight.title}</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'var(--sub)', lineHeight: 1.7 }}>{updateInsight.body}</div>
            </div>
            <button onClick={() => setUpdateInsight(null)} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '.75rem', padding: '.1rem', flexShrink: 0 }}>✕</button>
          </div>
        )}

        {/* Check prompts */}
        {dueChecks.length > 0 && (
          <div style={{ marginBottom: '1.5rem' }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', textTransform: 'uppercase', letterSpacing: '.09em', color: 'var(--amber)', marginBottom: '.75rem', display: 'flex', alignItems: 'center', gap: '.5rem' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--amber)', display: 'inline-block', animation: 'pulse 2s infinite' }} />
              {dueChecks.length} application check{dueChecks.length > 1 ? 's' : ''} due
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '.65rem' }}>
              {dueChecks.map(d => (
                <CheckCard key={`${d.app.id}_${d.checkType}`} check={d} onAnswer={handleCheckAnswer} onSnooze={handleSnooze} />
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {apps.length === 0 && (
          <div style={{ textAlign: 'center', padding: '3rem 2rem' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>📋</div>
            <div style={{ fontFamily: 'var(--display)', fontSize: '1.1rem', fontWeight: 700, color: 'var(--white)', marginBottom: '.5rem' }}>No applications yet</div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.7rem', color: 'var(--muted)', marginBottom: '1.5rem' }}>Browse jobs and hit Apply to start tracking</div>
            <a href="/jobs" className="btn btn-green" style={{ display: 'inline-flex', textDecoration: 'none', justifyContent: 'center' }}>Browse jobs →</a>
          </div>
        )}

        {/* Application cards */}
        {apps.length > 0 && (
          <div id="trackerList" style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
            {apps.map((app, i) => (
              <div key={app.id} style={highlightNew && i === 0 ? { borderRadius: 12, boxShadow: '0 0 0 2px var(--green), 0 0 30px rgba(16,185,129,0.3)', transition: 'box-shadow 2.5s ease' } : undefined}>
                <AppCard app={app} onUpdate={handleUpdate} onRemove={handleRemove} />
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
    </>
  )
}

export default function TrackerPageWrapper() {
  return (
    <Suspense fallback={<div className="page-full"><div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}><div className="spinner" /></div></div>}>
      <TrackerPage />
    </Suspense>
  )
}

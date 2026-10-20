'use client'

import { useEffect, useState, useCallback, useRef, useMemo, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/lib/auth'
import { AppStore } from '@/lib/stores/AppStore'
import { EventStore } from '@/lib/stores/EventStore'
import { STAGES } from '@/lib/constants'
import type { Application, DueCheck } from '@/lib/types'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { listingHref } from '@/lib/listingHref.js'
import OutcomeCard from '@/components/OutcomeCard'
import RoundsPrompt from '@/components/RoundsPrompt'
import { firstPartyReportCount } from '@/lib/server/reportCounts'
import { isGradeableScore } from '@/lib/gradeGate'
import ModalPortal from '@/components/ModalPortal'
import WithdrawModal from '@/components/WithdrawModal'
import PageHeader from '@/components/shell/PageHeader'
const SurveyModal = dynamic(() => import('@/components/SurveyModal'), { ssr: false })
const ResumeSurveyModal = dynamic(() => import('@/components/ResumeSurveyModal'), { ssr: false })

const STATUS_MAP: Record<string, string> = {
  active: '',
  ghosted: 'ghosted',
  hired: 'hired',
  rejected: 'rejected',
  withdrawn: 'rejected',
}

function getDaysSince(ts: number): number {
  return Math.floor((Date.now() - ts) / 86400000)
}

type Watch = { tone: 'ok' | 'warn' | 'danger'; text: string }
type Intel = { ghost_rate?: number; avg_wait_days?: number; report_count?: number; first_party_report_count?: number; data_source?: string | null; overall_score?: number }
// batch_scores payload (api/reports.js): report_count is FUSED; first_party_report_count is the honest count.
type ScoreIntel = { ghost_rate: number; overall_score: number; report_count: number; avg_wait_days?: number; first_party_report_count?: number; data_source?: string | null }
// Time-aware "is this normal?" verdict — the insight only Seen can give: compare how
// long an application has been silent against how this company ACTUALLY responds.
// Stated as fact ("they ghost 42%") ONLY when first-party applicant reports back it; a score
// built from web research alone (fused report_count > 0, first-party 0) is worded as an estimate.
function ghostWatch(days: number, intel?: Intel): Watch | null {
  if (!intel || !intel.report_count || !intel.avg_wait_days) return null
  const w = Math.round(intel.avg_wait_days)
  if (w <= 0) return null
  const gp = Math.round((intel.ghost_rate || 0) * 100)
  const est = firstPartyReportCount(intel) === 0
  const avg = est ? `~${w}d estimated average` : `~${w}d average`
  if (days <= w) return { tone: 'ok', text: `Day ${days} · typical first response here is ${est ? `estimated at ~${w}d` : `~${w}d`} — still in the normal window.` }
  if (days <= w * 2) return { tone: 'warn', text: `Day ${days} · past their ${avg} — a good time to follow up${gp >= 30 ? (est ? `; estimated ghost rate ${gp}%` : `; they ghost ${gp}%`) : ''}.` }
  const x = (days / w).toFixed(1)
  return { tone: 'danger', text: `Day ${days} · ${x}× their ${avg}${gp >= 30 ? (est ? ` — estimated ghost rate ${gp}%. Likely ghosted.` : ` — they ghost ${gp}% of applicants here. Likely ghosted.`) : ' — likely ghosted.'}` }
}

function AppCard({ app, onUpdate, onRemove, onShare, onReload, intel, check, onAnswer, onSnooze }: {
  app: Application
  onUpdate: (id: string, changes: Partial<Application>) => void
  onRemove: (id: string) => void
  onShare: (app: Application) => void
  onReload: () => void
  intel?: Intel
  /** The one check-in due on this application, asked right on its card. */
  check?: DueCheck
  onAnswer: (appId: string, checkType: string, data: Record<string, unknown>) => void
  onSnooze: (appId: string, checkType: string) => void
}) {
  const [withdrawing, setWithdrawing] = useState(false)
  const days = getDaysSince(app.appliedAt)
  const statusClass = STATUS_MAP[app.status] || ''
  const isActive = app.status === 'active'
  const [expanded, setExpanded] = useState(false)
  const ghostRate = intel?.ghost_rate
  const watch = isActive ? ghostWatch(days, intel) : null
  const listing = listingHref(app)
  const linkStyle = { fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--blue)', textDecoration: 'none' } as const

  return (
    <div className={`app-card ${statusClass}`} id={`app_${app.id}`}>
      {/* Clickable header — tap to expand/collapse update actions */}
      <div
        className="app-card-head"
        onClick={() => { if (isActive) setExpanded(e => !e) }}
        style={{ cursor: isActive ? 'pointer' : 'default' }}
      >
        <div className="app-card-logo">{app.company.charAt(0)}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="app-card-co">{app.company}</div>
          <div className="app-card-title">{app.role}</div>
          {app.location && <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--muted)' }}>{app.location}</div>}
          {/* Set by the employer from their Seen applications inbox (api/employer-listings syncApplicantTracker). */}
          {app.employerStage && (
            <div title="Updated by the employer on Seen" style={{ display: 'inline-flex', alignItems: 'center', gap: '.25rem', marginTop: '.25rem', fontFamily: 'var(--mono)', fontSize: '.55rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: app.employerStage === 'Not selected' ? 'var(--red)' : 'var(--green)', border: '1px solid currentColor', borderRadius: 999, padding: '.12rem .5rem' }}>
              🏢 Employer: {app.employerStage}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '.25rem', flexShrink: 0 }}>
          {app.score != null && (
            <span style={{ fontFamily: 'var(--mono)', fontSize: '.65rem', color: app.score >= 70 ? 'var(--green)' : app.score >= 40 ? 'var(--amber)' : 'var(--red)', fontWeight: 600 }}>{app.score}</span>
          )}
          {ghostRate != null && ghostRate > 0.3 && (
            <span style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', color: ghostRate > 0.55 ? 'var(--red)' : 'var(--amber)', background: ghostRate > 0.55 ? 'rgba(239,68,68,.08)' : 'rgba(245,158,11,.08)', border: `1px solid ${ghostRate > 0.55 ? 'rgba(239,68,68,.2)' : 'rgba(245,158,11,.2)'}`, borderRadius: 4, padding: '.1rem .3rem', marginTop: '.1rem' }}>
              {ghostRate > 0.55 ? '👻' : '⚠'} {Math.round(ghostRate * 100)}% ghost
            </span>
          )}
          <span style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--muted)', background: 'var(--raised)', border: '1px solid var(--line)', borderRadius: 4, padding: '.1rem .35rem' }}>Day {days}</span>
          {isActive && (
            <span style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--blue)', marginTop: '.1rem' }}>{expanded ? '▲' : 'Update ▼'}</span>
          )}
        </div>
      </div>

      {/* Stage pipeline (active only, collapsed when expanded to save space) */}
      {isActive && !expanded && (
        <div className="stage-pipe" style={{ marginTop: '.65rem' }}>
          {STAGES.map((s, i) => {
            const stageIdx = STAGES.indexOf(app.stage as typeof STAGES[number])
            const isDone = i < stageIdx
            const isCurrent = i === stageIdx
            return (
              <div key={s} className={`stage-step ${isDone ? 'done' : ''} ${isCurrent ? 'current' : ''}`} title={s}>{s}</div>
            )
          })}
        </div>
      )}

      {/* Check-in: asked on the application it is about, not in a separate stack above the list. */}
      {check && <CheckIn check={check} onAnswer={onAnswer} onSnooze={onSnooze} ghostRate={intel?.ghost_rate} avgWaitDays={intel?.avg_wait_days} />}

      {/* Ghost Watch — time-aware verdict from this company's real Seen data */}
      {watch && (
        <div style={{
          marginTop: '.55rem', fontFamily: 'var(--mono)', fontSize: '.6rem', lineHeight: 1.6, borderRadius: 7, padding: '.45rem .7rem',
          color: watch.tone === 'danger' ? 'var(--red)' : watch.tone === 'warn' ? 'var(--amber)' : 'var(--muted)',
          background: watch.tone === 'danger' ? 'rgba(239,68,68,.07)' : watch.tone === 'warn' ? 'rgba(245,158,11,.06)' : 'var(--raised)',
          border: `1px solid ${watch.tone === 'danger' ? 'rgba(239,68,68,.2)' : watch.tone === 'warn' ? 'rgba(245,158,11,.2)' : 'var(--line)'}`,
        }}>
          {watch.tone === 'danger' ? '👻 ' : watch.tone === 'warn' ? '⏰ ' : '✓ '}{watch.text}
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
        {listing && (listing.internal
          // A listing posted on Seen: its page is /jobs/<id> here, so open it in the app.
          ? <Link href={listing.href} onClick={e => e.stopPropagation()} style={linkStyle}>View listing →</Link>
          : <a href={listing.href} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} style={linkStyle}>View listing →</a>)}
      </div>

      {/* The employer edited the listing after this application went in — dated so the applicant
          knows the posting they read may have changed. */}
      {app.listingEditedAt && Date.parse(app.listingEditedAt) > app.appliedAt && (
        <div style={{ marginTop: '.45rem', fontFamily: 'var(--mono)', fontSize: '.56rem', color: 'var(--amber)' }}>
          ✎ Listing edited by the employer {new Date(app.listingEditedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} — after you applied
        </div>
      )}

      {/* Messages on an Apply-on-Seen application: from the employer (interview time, a number to
          call, …) and the applicant's own withdrawal note. Stored once, on the employer's copy. */}
      {!!app.messages?.length && (
        <div style={{ marginTop: '.7rem', display: 'flex', flexDirection: 'column', gap: '.4rem' }}>
          {app.messages.map((m, i) => (
            <div key={i} style={{ borderRadius: 9, padding: '.5rem .7rem', background: m.from === 'employer' ? 'rgba(59,130,246,.08)' : 'var(--raised)', border: `1px solid ${m.from === 'employer' ? 'rgba(59,130,246,.25)' : 'var(--line)'}` }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '.54rem', color: m.from === 'employer' ? 'var(--blue)' : 'var(--muted)', marginBottom: '.2rem' }}>
                {m.from === 'employer' ? `🏢 ${app.company}` : m.withdrawal ? 'You · withdrew' : 'You'} · {new Date(m.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </div>
              {m.text
                ? <div style={{ fontSize: '.8rem', color: 'var(--white)', lineHeight: 1.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{m.text}</div>
                : <div style={{ fontSize: '.74rem', color: 'var(--muted)' }}>Withdrew without a note.</div>}
            </div>
          ))}
        </div>
      )}

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
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.5rem', marginTop: '.65rem' }}>
            <button
              onClick={e => { e.stopPropagation(); setExpanded(false) }}
              style={{ background: 'none', border: 'none', fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--muted)', cursor: 'pointer', padding: '0' }}
            >
              ✕ collapse
            </button>
            <button
              onClick={e => { e.stopPropagation(); setWithdrawing(true) }}
              style={{ background: 'none', border: 'none', fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--red)', cursor: 'pointer', padding: '0' }}
            >
              ↩ Withdraw application
            </button>
          </div>
        </div>
      )}
      {!isActive && (
        <div style={{ marginTop: '.75rem', display: 'flex', gap: '.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
          {app.status !== 'withdrawn' && (
            <button
              className="btn"
              style={{ fontSize: '.66rem', padding: '.34rem .8rem', fontWeight: 700, color: '#fff', border: 'none', background: 'linear-gradient(135deg,#3b82f6 0%,#8b5cf6 100%)', boxShadow: '0 0 16px rgba(99,102,241,.3)' }}
              onClick={() => onShare(app)}
            >
              ✦ Share outcome card
            </button>
          )}
          <button className="btn btn-ghost" style={{ fontSize: '.62rem', padding: '.28rem .65rem', color: 'var(--muted)' }} onClick={() => onRemove(app.id)}>Remove</button>
        </div>
      )}
      {withdrawing && <WithdrawModal app={app} onClose={() => setWithdrawing(false)} onWithdrawn={onReload} />}
    </div>
  )
}

function CheckIn({ check, onAnswer, onSnooze, ghostRate, avgWaitDays }: {
  check: DueCheck
  onAnswer: (appId: string, checkType: string, data: Record<string, unknown>) => void
  onSnooze: (appId: string, checkType: string) => void
  ghostRate?: number
  avgWaitDays?: number
}) {
  const { app, checkType, daysElapsed, q } = check
  const answers: Array<{ label: string; data: Record<string, unknown>; highlight?: boolean }> = []
  if (checkType === 'response_check') {
    answers.push({ label: '✅ Got a response', data: { got_response: true, response_type: 'unknown', days_to_response: daysElapsed }, highlight: true })
    answers.push({ label: '📅 Interview', data: { got_response: true, response_type: 'interview', days_to_response: daysElapsed }, highlight: true })
    answers.push({ label: '❌ Rejected', data: { got_response: true, response_type: 'rejection', days_to_response: daysElapsed } })
    answers.push({ label: '👻 Ghosted', data: { got_response: false, response_type: 'ghosted', days_to_response: daysElapsed } })
    answers.push({ label: '↩ I withdrew', data: { got_response: false, response_type: 'withdrew', withdrew: true, days_to_response: daysElapsed } })
  } else if (checkType === 'interview_check') {
    answers.push({ label: '✅ Had an interview', data: { had_interview: true, interview_type: 'interview' }, highlight: true })
    answers.push({ label: '📞 Phone screen', data: { had_interview: true, interview_type: 'phone_screen' }, highlight: true })
    answers.push({ label: '❌ Rejected', data: { had_interview: false, ended: true, outcome: 'rejected' } })
    answers.push({ label: '👻 Still nothing', data: { had_interview: false, ended: false } })
    answers.push({ label: '↩ I withdrew', data: { had_interview: false, ended: true, outcome: 'withdrew', withdrew: true } })
  } else {
    answers.push({ label: '🎉 Got an offer', data: { outcome: 'offer' }, highlight: true })
    answers.push({ label: '❌ Rejected', data: { outcome: 'rejected' } })
    answers.push({ label: '👻 Ghosted', data: { outcome: 'ghosted' } })
    answers.push({ label: '🔄 Still active', data: { outcome: 'active' } })
    answers.push({ label: '↩ I withdrew', data: { outcome: 'withdrew', withdrew: true } })
  }
  const showGhost = ghostRate != null && ghostRate > 0.4 && checkType === 'response_check'

  return (
    <div className="app-check" onClick={e => e.stopPropagation()}>
      <div className="app-check-head">
        <span className="app-check-tag"><span className="app-check-dot" />Day {daysElapsed} check-in</span>
        <button type="button" className="app-check-later" onClick={() => onSnooze(app.id, checkType)} title="Ask me again tomorrow">Later</button>
      </div>
      <div className="app-check-q">{q}</div>
      {showGhost && (
        <div className="app-check-note">
          {app.company} ghosts {Math.round(ghostRate! * 100)}% of applicants{avgWaitDays ? `, usually by day ${avgWaitDays}` : ''}.
        </div>
      )}
      <div className="app-check-opts">
        {answers.map(a => (
          <button key={a.label} type="button" className={`app-check-opt${a.highlight ? ' hi' : ''}`} onClick={() => onAnswer(app.id, checkType, a.data)}>
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
  const { isLoggedIn, isSeeker, ready, token } = useAuth()
  const [apps, setApps] = useState<Application[]>([])
  // Newest application first (owner request 2026-10-18): by the date applied, then last update.
  const orderedApps = useMemo(() => [...apps].sort((a, b) => (b.appliedAt - a.appliedAt) || (b.updatedAt - a.updatedAt)), [apps])
  const [loading, setLoading] = useState(true)
  const [outcomeApp, setOutcomeApp] = useState<Application | null>(null)
  const [roundsApp, setRoundsApp] = useState<Application | null>(null)
  const [showManual, setShowManual] = useState(false)
  const [showSurvey, setShowSurvey] = useState(false)
  // Survey source: prefer the résumé-based survey (asks about the user's past employers from
  // their résumé); fall back to the tracked-application survey only when there's no résumé data.
  const [surveyMode, setSurveyMode] = useState<'resume' | 'tracker'>('resume')
  const [creditsEarned, setCreditsEarned] = useState(0)
  const [manualForm, setManualForm] = useState({ company: '', role: '', location: '', platform: 'Direct' })
  const [highlightId, setHighlightId] = useState('')
  const highlightedRef = useRef('')
  const [updateInsight, setUpdateInsight] = useState<{ title: string; body: string; color: string } | null>(null)
  const [companyScores, setCompanyScores] = useState<Record<string, ScoreIntel>>({})

  useEffect(() => {
    if (!ready) return // wait for the session to resolve — redirecting early bounced signed-in users
    if (!isLoggedIn) { router.replace('/login'); return }
    if (isLoggedIn && !isSeeker) { router.replace('/'); return }
  }, [ready, isLoggedIn, isSeeker, router])

  // ?add=1 (the dashboard's "+ Track application") opens the add-application form directly.
  useEffect(() => {
    if (searchParams?.get('add') === '1') setShowManual(true)
  }, [searchParams])

  const loadApps = useCallback(async () => {
    const data = await AppStore.load(isLoggedIn)
    setApps(data)
    setLoading(false)
    // Highlight + scroll to one card: the one just added (?new=1 — the DB returns it first), or the
    // one a notification points at (#app_<id>, from the bell in the Nav).
    const hashId = typeof window !== 'undefined' && window.location.hash.startsWith('#app_') ? window.location.hash.slice(5) : ''
    const target = hashId && data.some(a => a.id === hashId) ? hashId
      : searchParams?.get('new') === '1' && data.length > 0 ? data[0].id : ''
    if (target && highlightedRef.current !== target) {
      highlightedRef.current = target
      setHighlightId(target)
      setTimeout(() => {
        const el = document.getElementById(`app_${target}`)
        if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }) }
        setTimeout(() => setHighlightId(''), 2800)
      }, 300)
    }
  }, [isLoggedIn, searchParams])

  // A notification tapped while already on the tracker changes only the hash — re-run the jump.
  useEffect(() => {
    const onHash = () => { if (window.location.hash.startsWith('#app_')) loadApps() }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [loadApps])

  useEffect(() => {
    if (!isLoggedIn) return
    loadApps()
  }, [isLoggedIn, loadApps])

  useEffect(() => {
    if (!apps.length) return
    const cos = [...new Set(apps.map(a => a.company.toLowerCase().trim()).filter(Boolean))].slice(0, 50)
    fetch('/api/reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'batch_scores', names: cos }),
    })
      .then(r => r.ok ? r.json() : { scores: {} })
      .then((d: { scores?: Record<string, Partial<{ [K in keyof ScoreIntel]: ScoreIntel[K] | null }> & { gradeable?: boolean | null }> }) => {
        if (!d.scores) return
        // Grade gate (lib/gradeGate.ts): only companies with ≥5 real reports supply ghost rates /
        // wait times to the tracker's watches, badges and check-ins.
        const graded: Record<string, ScoreIntel> = {}
        for (const [k, v] of Object.entries(d.scores)) {
          if (isGradeableScore(v) && typeof v.ghost_rate === 'number') {
            graded[k] = { ghost_rate: v.ghost_rate, overall_score: v.overall_score, report_count: v.report_count ?? 0, ...(typeof v.avg_wait_days === 'number' ? { avg_wait_days: v.avg_wait_days } : {}), ...(v.first_party_report_count != null ? { first_party_report_count: v.first_party_report_count } : {}), ...(v.data_source != null ? { data_source: v.data_source } : {}) }
          }
        }
        setCompanyScores(graded)
      })
      .catch(() => {})
  }, [apps])

  const handleUpdate = async (id: string, changes: Partial<Application>) => {
    await AppStore.update(id, changes, isLoggedIn)
    // The ONE community report per terminal outcome (hired included — "Got the job" never reached
    // the company's score before). A withdrawal is the applicant's move, not the company's: no report.
    if (changes.status === 'ghosted' || changes.status === 'rejected' || changes.status === 'hired') {
      const origApp = apps.find(a => a.id === id)
      if (origApp) {
        const outcome = changes.status
        // quick_submit requires a signed-in user — without the Bearer token every one of
        // these community reports 401'd silently and the tracker→intel flywheel fed nothing.
        token().then(tok => {
          if (!tok) return
          fetch('/api/reports', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
            body: JSON.stringify({
              action: 'quick_submit',
              company: origApp.company,
              outcome,
              role: origApp.role,
              city: origApp.location || '',
            }),
          }).catch(() => {})
        }).catch(() => {})
      }
    }
    const terminalStatuses = ['hired', 'ghosted', 'rejected', 'withdrawn']
    if (changes.status && terminalStatuses.includes(changes.status)) {
      const updated = await AppStore.load(isLoggedIn)
      setApps(updated)
      const app = updated.find(a => a.id === id)
      if (app && changes.status !== 'withdrawn') {
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
      if (d.score && isGradeableScore(d.score)) score = d.score
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
        const avgWait = score?.avg_wait_days || null // null = no wait data for this company; never invent one
        setUpdateInsight({
          title: '📞 Interview unlocked — you\'re ahead',
          body: avgWait
            ? `You reached the interview stage at ${app.company} in ${days} days. Applicants there wait about ${avgWait} days just for a first response.`
            : `You reached the interview stage at ${app.company} in ${days} days. Logged — this sharpens ${app.company}'s response data.`,
          color: 'rgba(99,102,241,0.12)',
        })
      } else if (rt !== 'withdrew') {
        const avgWait = score?.avg_wait_days || null
        setUpdateInsight({
          title: '✅ Response received',
          body: avgWait
            ? (days <= avgWait
                ? `${app.company} responded in ${days} days — faster than their ${avgWait}-day average.`
                : `Response took ${days} days vs their ${avgWait}-day average. Logged.`)
            : `${app.company} responded in ${days} days. Logged — this becomes part of their response-time record.`,
          color: 'rgba(16,185,129,0.1)',
        })
      }
    } else if (checkType === 'interview_check') {
      if (data.interview_type) {
        setUpdateInsight({
          title: '🗓 Interview stage confirmed',
          body: `You\'re in the interview stage at ${app.company} after ${days} days. Most applications never get this far.`,
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

  // Route a terminal tracked app to the report page pre-loaded for one-click card creation.
  // /report reads app_id + auto=1 and prefills + renders the OutcomeCard inline from real
  // tracker data (no re-typing). This is the tracker→report→share virality loop.
  const handleShare = (app: Application) => {
    router.push(`/report?app_id=${encodeURIComponent(app.id)}&auto=1`)
  }

  const handleCheckAnswer = (appId: string, checkType: string, data: Record<string, unknown>) => {
    const app = apps.find(a => a.id === appId)
    // Pass the app's identity onto the event — _submitAsReport files a community report
    // from it, and without company/role the server rejected every day-30 outcome.
    EventStore.add({
      appId, type: checkType, data,
      company: app?.company, role: app?.role, location: app?.location, platform: app?.platform,
    })
    if (app) handleCheckInsight(app, checkType, data)
    if (data.withdrew) {
      // "I withdrew" used to be recorded as REJECTED and filed against the company as a rejection.
      handleUpdate(appId, { status: 'withdrawn' })
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

  const clearDupes = async () => {
    // Only OPEN duplicates of the same company+role are dupes; a finished application at the same
    // company last year is history, not a duplicate. Newest copy wins. Always confirmed.
    const seen = new Set<string>()
    const local = AppStore.loadSync()
    const removed: Application[] = []
    const deduped = [...local].sort((a, b) => (b.appliedAt || 0) - (a.appliedAt || 0)).filter(a => {
      if (a.status !== 'active') return true
      const key = `${a.company.toLowerCase().trim()}|${a.role.toLowerCase().trim()}`
      if (seen.has(key)) { removed.push(a); return false }
      seen.add(key)
      return true
    })
    if (!removed.length) { setUpdateInsight({ title: 'No duplicates', body: 'Every open application is unique.', color: 'rgba(99,102,241,0.12)' }); return }
    if (!confirm(`Remove ${removed.length} duplicate open application${removed.length > 1 ? 's' : ''}? The newest copy of each is kept.`)) return
    localStorage.setItem('seen_applications_v1', JSON.stringify(deduped))
    setApps(deduped)
    // Also delete the dropped duplicates from the DB — dedupe-in-localStorage-only just let them
    // resurrect on the next load. AWAITED before the reload: firing the deletes and reloading at once
    // let the reload's SELECT win the race and bring the duplicates straight back, so one press never
    // cleared them all (the same race AppStore.update/remove already await for).
    if (isLoggedIn) await Promise.all(removed.filter(a => !a.id.startsWith('app_')).map(a => AppStore.remove(a.id, true).catch(() => {})))
    await loadApps()
  }

  if (!isLoggedIn || !isSeeker) return null
  if (loading) return <div className="page-full"><div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}><div className="spinner" /></div></div>

  const active = apps.filter(a => a.status === 'active')
  const ghosted = apps.filter(a => a.status === 'ghosted')
  const hired = apps.filter(a => a.status === 'hired')
  const rejected = apps.filter(a => a.status === 'rejected')
  const withdrawn = apps.filter(a => a.status === 'withdrawn')
  const dueChecks = EventStore.dueChecks(apps)
  const checkByApp = new Map(dueChecks.map(d => [d.app.id, d]))
  const firstChecked = orderedApps.find(a => checkByApp.has(a.id))

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
      <ModalPortal>
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.88)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        onClick={e => { if (e.target === e.currentTarget) setShowManual(false) }}>
        <div style={{ width: 'calc(100% - 2rem)', maxWidth: 440, background: 'var(--surface)', border: '1px solid rgba(99,102,241,.25)', borderRadius: 14, overflow: 'hidden', boxShadow: '0 32px 96px rgba(0,0,0,.7),0 0 72px rgba(99,102,241,.18),0 0 140px rgba(124,58,237,.08)' }}>
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
      </ModalPortal>
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
      <div style={{ maxWidth: 1000, margin: '0 auto', padding: '2.5rem 2rem', width: '100%', boxSizing: 'border-box' }}>

        {/* Header — shared shell header: crumb back to the dashboard, title, actions */}
        <PageHeader
          eyebrow="Application tracker"
          title="My applications"
          sub="Applications sync to your account. Check-in answers stay on this device."
          actions={<>
            <button className="btn btn-green" style={{ fontSize: '.72rem' }} onClick={() => setShowManual(true)}>+ Track manually</button>
            <button className="btn btn-ghost" style={{ fontSize: '.72rem' }} onClick={clearDupes}>Clear dupes</button>
            {apps.length > 0 && <button className="btn btn-ghost" style={{ fontSize: '.72rem', color: 'var(--muted)' }} onClick={() => { if (confirm('Remove all applications? This cannot be undone.')) { AppStore.clear(isLoggedIn); setApps([]) } }}>Clear all</button>}
          </>}
        />

        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(84px, 1fr))', gap: '.6rem', marginBottom: '1.5rem' }}>
          {[
            { label: 'Total', n: apps.length },
            { label: 'Active', n: active.length },
            { label: 'Hired', n: hired.length },
            { label: 'Ghosted', n: ghosted.length },
            { label: 'Rejected', n: rejected.length },
            ...(withdrawn.length ? [{ label: 'Withdrawn', n: withdrawn.length }] : []),
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
                // Screened = the company engaged: moved past Applied, or ended with a decision (hired/rejected).
                // Ghosted and withdrawn applications never got a screen.
                const screened = apps.filter(a => stageLevel(a.stage) >= 1 || a.status === 'hired' || a.status === 'rejected').length
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

        {/* Ghost risk alerts — proactive, shown before check prompts */}
        {(() => {
          const atRisk = active.filter(a => {
            const score = companyScores[a.company.toLowerCase().trim()]
            // Needs a real ghost rate AND a real wait time — no 21-day stand-in (that number was invented).
            if (!score || score.ghost_rate < 0.5 || !score.avg_wait_days) return false
            const days = getDaysSince(a.appliedAt)
            const avgWait = score.avg_wait_days
            // In the danger window: past 7 days but not yet 2x avg wait
            return days >= 7 && days < avgWait * 2
          })
          if (!atRisk.length) return null
          return (
            <div style={{ marginBottom: '1.25rem', background: 'rgba(239,68,68,.05)', border: '1px solid rgba(239,68,68,.2)', borderRadius: 12, padding: '1rem 1.1rem' }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', textTransform: 'uppercase', letterSpacing: '.09em', color: 'var(--red)', marginBottom: '.65rem', display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--red)', display: 'inline-block', animation: 'pulse 2s infinite' }} />
                {atRisk.length} application{atRisk.length > 1 ? 's' : ''} at ghost risk
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '.55rem' }}>
                {atRisk.slice(0, 3).map(a => {
                  const score = companyScores[a.company.toLowerCase().trim()]!
                  const days = getDaysSince(a.appliedAt)
                  const avgWait = score.avg_wait_days || 0 // atRisk already requires a real value
                  const daysLeft = Math.max(0, avgWait - days)
                  return (
                    <div key={a.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.75rem' }}>
                      <div>
                        <span style={{ fontFamily: 'var(--display)', fontSize: '.8rem', fontWeight: 700, color: 'var(--white)' }}>{a.company}</span>
                        <span style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--muted)', marginLeft: '.5rem' }}>{a.role}</span>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--red)', fontWeight: 600 }}>
                          {Math.round(score.ghost_rate * 100)}% ghost rate
                        </div>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--muted)' }}>
                          {daysLeft > 0 ? `~${daysLeft}d to ghost point` : `past ghost window (day ${days})`}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })()}

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

        {/* Check-ins live on each application's card. Up here: one line saying how many are
            waiting, which jumps to the first one in list order. */}
        {firstChecked && (
          <button
            type="button"
            className="check-count"
            onClick={() => document.getElementById(`app_${firstChecked.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
          >
            <span className="app-check-dot" />
            {dueChecks.length} application{dueChecks.length > 1 ? 's' : ''} waiting on a quick check-in
            <span className="check-count-go">Go to first ↓</span>
          </button>
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

        {/* Survey CTA — show when user has apps with data to contribute */}
        {apps.length >= 1 && !showSurvey && (
          <div
            onClick={() => { setSurveyMode('resume'); setShowSurvey(true) }}
            style={{
              background: 'linear-gradient(90deg, rgba(99,102,241,.1), rgba(124,58,237,.06))',
              border: '1px solid rgba(99,102,241,.22)',
              borderRadius: 10,
              padding: '.65rem 1rem',
              marginBottom: '.75rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '.75rem',
              cursor: 'pointer',
              transition: 'background .15s',
            }}
          >
            <div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--indigo)', fontWeight: 600, marginBottom: '.12rem', display: 'flex', alignItems: 'center', gap: '.35rem' }}>
                <span style={{ fontSize: '.7rem' }}>✦</span>
                {creditsEarned > 0 ? `You earned ${creditsEarned} credit${creditsEarned !== 1 ? 's' : ''} — keep going` : 'Earn up to 5 credits today'}
              </div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--sub)' }}>
                Share what happened with your applications — 90 sec, helps future job seekers
              </div>
            </div>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'var(--indigo)', flexShrink: 0 }}>Start →</span>
          </div>
        )}
        {creditsEarned > 0 && !showSurvey && (
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--green)', textAlign: 'center', marginBottom: '.65rem' }}>
            ✓ +{creditsEarned} credits earned this session
          </div>
        )}

        {/* Application cards */}
        {apps.length > 0 && (
          <div id="trackerList" style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
            {orderedApps.map(app => (
              <div key={app.id} style={highlightId === app.id ? { borderRadius: 12, boxShadow: '0 0 0 2px var(--green), 0 0 30px rgba(16,185,129,0.3)', transition: 'box-shadow 2.5s ease' } : undefined}>
                <AppCard app={app} onUpdate={handleUpdate} onRemove={handleRemove} onShare={handleShare} onReload={loadApps} intel={companyScores[app.company.toLowerCase().trim()]} check={checkByApp.get(app.id)} onAnswer={handleCheckAnswer} onSnooze={handleSnooze} />
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
    {showSurvey && surveyMode === 'resume' && (
      <ResumeSurveyModal
        onClose={() => setShowSurvey(false)}
        onCreditsEarned={(n) => { setCreditsEarned(n); setShowSurvey(false) }}
        // No résumé / no parsed employers / all past employers surveyed → fall back to the
        // tracked-application survey so the user can still earn.
        onExhausted={() => setSurveyMode('tracker')}
      />
    )}
    {showSurvey && surveyMode === 'tracker' && (
      <SurveyModal
        apps={apps}
        onClose={() => setShowSurvey(false)}
        onCreditsEarned={(n) => { setCreditsEarned(n); setShowSurvey(false) }}
      />
    )}
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

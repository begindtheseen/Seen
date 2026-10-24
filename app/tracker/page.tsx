'use client'

import { useEffect, useState, useCallback, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/lib/auth'
import { AppStore, isDbId, type SyncState, type UpdateOptions, type UpdateResult } from '@/lib/stores/AppStore'
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
import { gradeLetter } from '@/lib/companyDisplay'
import ModalPortal from '@/components/ModalPortal'
import WithdrawModal from '@/components/WithdrawModal'
import PageHeader from '@/components/shell/PageHeader'
import InboxAutopilot from '@/components/tracker/InboxAutopilot'
import ApplicationForm from '@/components/tracker/ApplicationForm'
import ConfirmDialog from '@/components/tracker/ConfirmDialog'
import StagePipeline from '@/components/tracker/StagePipeline'
import { emptyForm, formFromApplication, toNewApplication, editChanges, type ApplicationForm as FormValues } from '@/lib/stores/applicationEdit'
import { nextCheckLine, daysSince } from '@/lib/stores/checkSchedule'
import { splitOpenDuplicates } from '@/lib/stores/applicationDupes'
import { sortApplications, filterApplications, SORT_MODES, PAGE_SIZE, type SortMode } from '@/lib/stores/applicationOrder'
import { checkAnsweredEvent, checkSnoozedEvent, checkLabel, isSuperseded } from '@/lib/stores/checkEvents'
import { responded } from '@/lib/stores/outcomes'
import { companySlug } from '@/lib/cardCopy.js'
import { slugSegment } from '@/lib/safeHref.js'
import { showToast } from '@/lib/toast'
import s from '@/components/tracker/tracker.module.css'
import { LoadError, PageSkeleton } from '@/components/shell/LoadStates'
import { loginHref } from '@/lib/safeHref.js'
import type { CheckType } from '@/lib/constants'
const SurveyModal = dynamic(() => import('@/components/SurveyModal'), { ssr: false })
const ResumeSurveyModal = dynamic(() => import('@/components/ResumeSurveyModal'), { ssr: false })

const STATUS_MAP: Record<string, string> = {
  active: '',
  ghosted: 'ghosted',
  hired: 'hired',
  rejected: 'rejected',
  withdrawn: 'rejected',
}

// "Day N" = California calendar days since applying (lib/stores/checkSchedule daysSince — the same
// count the day-7/14/30 check-ins fire on). Never a 24-hour-period count or a UTC day.
const getDaysSince = (ts: number): number => daysSince(ts)

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

// An offer or rejection recorded under 2 days after applying (anti-gaming flag set by AppStore and
// the server): asked once, gently, on the card (audit 3 L5).
const fastOutcome = (app: Application) => (app.events || []).some(e => !isSuperseded(e) && (e.anomaly_flags || []).includes('impossible_timeline'))

const STAGE_RANK = (st: string) => STAGES.indexOf(st as typeof STAGES[number])
/** A check-in answer only ever RAISES the stage (a "Got a response" never moves a Final Round card back). */
const raise = (app: Application, stage: string): Partial<Application> => (STAGE_RANK(stage) > STAGE_RANK(app.stage) ? { stage } : {})

function AppCard({ app, expanded, setExpanded, onUpdate, onEdit, onRemove, onShare, onReload, intel, check, onAnswer, onSnooze, sync, onRetry }: {
  app: Application
  /** One card open at a time (the page owns it, so the phone's floating button can get out of its way). */
  expanded: boolean
  setExpanded: (open: boolean) => void
  onUpdate: (id: string, changes: Partial<Application>) => void
  /** Opens the Edit form (company, role, location, platform, applied-on). */
  onEdit: (app: Application) => void
  /** Delete after its own confirm: AppStore.remove — nothing is reported anywhere. */
  onRemove: (id: string) => Promise<void>
  onShare: (app: Application) => void
  onReload: () => void
  intel?: Intel
  /** The one check-in due on this application, asked right on its card. */
  check?: DueCheck
  onAnswer: (appId: string, checkType: CheckType, data: Record<string, unknown>) => void
  onSnooze: (appId: string, checkType: CheckType) => void
  /** Where this card stands with the account (H5): saving now, synced, or kept on this device only. */
  sync: SyncState
  onRetry: (id: string) => void
}) {
  const [withdrawing, setWithdrawing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const days = getDaysSince(app.appliedAt)
  const statusClass = STATUS_MAP[app.status] || ''
  const isActive = app.status === 'active'
  const ghostRate = intel?.ghost_rate
  const watch = isActive ? ghostWatch(days, intel) : null
  const listing = listingHref(app)
  // 40px hit area without growing the row (negative vertical margin).
  const linkStyle = { fontFamily: 'var(--mono)', fontSize: '.75rem', color: 'var(--blue)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', minHeight: 40, padding: '0 .4rem', margin: '-8px -.4rem' } as const
  // "Next check-in Oct 30 — did they respond?" — while a check is due the card asks it instead; a check
  // put off with "Later" says when it comes back ("We'll ask again Oct 25 — …", audit 3 M6).
  const next = isActive && !check ? EventStore.nextCheck(app) : null
  const snoozedUntil = next?.due ? EventStore.snoozedUntil(app, next.type) : null
  const nextLine = isActive && !check ? nextCheckLine(app.appliedAt, EventStore.answeredChecks(app), Date.now(), snoozedUntil) : null
  // The company page, by the ONE slug scheme (lib/cardCopy companySlug), re-encoded through safeHref.
  const coHref = app.company ? `/company/${slugSegment(companySlug(app.company))}` : null
  const fmt = (ms: number) => new Date(ms).toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric' })

  return (
    <div className={`app-card ${statusClass}`} id={`app_${app.id}`}>
      {/* Clickable header — tap to expand/collapse update actions */}
      <div
        className="app-card-head"
        onClick={() => { if (isActive) setExpanded(!expanded) }}
        style={{ cursor: isActive ? 'pointer' : 'default', marginBottom: isActive ? '.35rem' : undefined }}
      >
        <div className="app-card-logo">{app.company.charAt(0)}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          {coHref
            ? <Link href={coHref} className={`app-card-co ${s.coLine}`} onClick={e => e.stopPropagation()} title={`${app.company} on Seen`}>{app.company}</Link>
            : <div className={`app-card-co ${s.coLine}`}>{app.company}</div>}
          <div className={`app-card-title ${s.roleLine}`}>{app.role}</div>
          {app.location && <div className={s.locLine}>{app.location}</div>}
          {/* Set by the employer from their Seen applications inbox (lib/server/seenApply.js) — only an
              Apply-on-Seen application has an employer on Seen. Prod's column default ("New") used to put
              "EMPLOYER: NEW" on every hand-tracked card. */}
          {app.seenApply && app.employerStage && (
            <div className={`${s.empBadge}${app.employerStage === 'Not selected' ? ' ' + s.neg : ''}`} title={`${app.company} set this from their Seen applications inbox — it is their status for your application, not Seen's guess.`}>
              🏢 Employer: {app.employerStage}
            </div>
          )}
          {/* Inbox Autopilot read an employer email about this application (lib/server/inbox/apply.js). */}
          {(() => {
            const fromEmail = (app.events || []).filter(e => e.source === 'email')
            if (!fromEmail.length) return null
            const last = fromEmail[fromEmail.length - 1]
            const label: Record<string, string> = { application_submitted: 'confirmation', interview_received: 'interview invite', assessment_received: 'assessment', rejected: 'rejection', offer_received: 'offer' }
            return (
              <div title="Updated from an email you forwarded to Seen" style={{ display: 'inline-flex', alignItems: 'center', gap: '.25rem', marginTop: '.25rem', marginLeft: app.seenApply && app.employerStage ? '.35rem' : 0, fontFamily: 'var(--mono)', fontSize: '.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--blue)', border: '1px solid currentColor', borderRadius: 999, padding: '.12rem .5rem' }}>
                ✉ From email: {label[String(last.type)] || 'update'}
              </div>
            )
          })()}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '.25rem', flexShrink: 0 }}>
          {app.score != null && (
            <span style={{ fontFamily: 'var(--mono)', fontSize: '.75rem', color: app.score >= 70 ? 'var(--green)' : app.score >= 40 ? 'var(--amber)' : 'var(--red)', fontWeight: 600 }}>{app.score}</span>
          )}
          {ghostRate != null && ghostRate > 0.3 && (
            <span style={{ fontFamily: 'var(--mono)', fontSize: '.75rem', color: ghostRate > 0.55 ? 'var(--red)' : 'var(--amber)', background: ghostRate > 0.55 ? 'rgba(239,68,68,.08)' : 'rgba(245,158,11,.08)', border: `1px solid ${ghostRate > 0.55 ? 'rgba(239,68,68,.2)' : 'rgba(245,158,11,.2)'}`, borderRadius: 4, padding: '.1rem .3rem', marginTop: '.1rem' }}>
              {ghostRate > 0.55 ? '👻' : '⚠'} {Math.round(ghostRate * 100)}% ghost
            </span>
          )}
          <span style={{ fontFamily: 'var(--mono)', fontSize: '.75rem', color: 'var(--muted)', background: 'var(--raised)', border: '1px solid var(--line)', borderRadius: 4, padding: '.1rem .35rem' }}>Day {days}</span>
          {sync === 'saving' && <span className={`${s.sync} ${s.syncSaving}`} role="status">Saving…</span>}
          {sync === 'unsynced' && (
            <button type="button" className={`${s.sync} ${s.syncOff}`} onClick={e => { e.stopPropagation(); onRetry(app.id) }} title="This change is saved on this device but has not reached your account yet. Tap to send it again.">
              Not synced · Retry
            </button>
          )}
          {isActive && (
            <button type="button" className={s.toggle} aria-expanded={expanded} onClick={e => { e.stopPropagation(); setExpanded(!expanded) }}>
              {expanded ? '▲ Close' : 'Update ▼'}
            </button>
          )}
        </div>
      </div>

      {/* Stage control — six buttons on wide screens, chip + "Next: … →" on phones. */}
      {isActive && <StagePipeline stage={app.stage} onStage={st => onUpdate(app.id, { stage: st })} />}
      {nextLine && <div className={s.nextCheck}>{nextLine}</div>}
      {fastOutcome(app) && (
        <div className={s.fast}>
          That was fast — double-check the date?
          <button type="button" className={s.fastBtn} onClick={e => { e.stopPropagation(); onEdit(app) }}>Check the date</button>
        </div>
      )}

      {/* Check-in: asked on the application it is about, not in a separate stack above the list. */}
      {check && <CheckIn check={check} onAnswer={onAnswer} onSnooze={onSnooze} ghostRate={intel?.ghost_rate} avgWaitDays={intel?.avg_wait_days} />}

      {/* Ghost Watch — time-aware verdict from this company's real Seen data */}
      {watch && (
        <div style={{
          marginTop: '.55rem', fontFamily: 'var(--mono)', fontSize: '.75rem', lineHeight: 1.6, borderRadius: 7, padding: '.45rem .7rem',
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
      <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap', marginTop: '.5rem', alignItems: 'center', minHeight: 24 }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: '.75rem', color: 'var(--muted)' }}>Applied {fmt(app.appliedAt)}</span>
        {app.platform && <span style={{ fontFamily: 'var(--mono)', fontSize: '.75rem', color: 'var(--muted)' }}>via {app.platform}</span>}
        {listing && (listing.internal
          // A listing posted on Seen: its page is /jobs/<id> here, so open it in the app.
          ? <Link href={listing.href} onClick={e => e.stopPropagation()} style={linkStyle}>View listing →</Link>
          : <a href={listing.href} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} style={linkStyle}>View listing →</a>)}
      </div>

      {/* The employer edited the listing after this application went in — dated so the applicant
          knows the posting they read may have changed. */}
      {app.listingEditedAt && Date.parse(app.listingEditedAt) > app.appliedAt && (
        <div style={{ marginTop: '.45rem', fontFamily: 'var(--mono)', fontSize: '.75rem', color: 'var(--amber)' }}>
          ✎ Listing edited by the employer {fmt(Date.parse(app.listingEditedAt))} — after you applied
        </div>
      )}

      {/* Messages on an Apply-on-Seen application: from the employer (interview time, a number to
          call, …) and the applicant's own withdrawal note. Stored once, on the employer's copy. */}
      {!!app.messages?.length && (
        <div style={{ marginTop: '.7rem', display: 'flex', flexDirection: 'column', gap: '.4rem' }}>
          {app.messages.map((m, i) => (
            <div key={i} style={{ borderRadius: 9, padding: '.5rem .7rem', background: m.from === 'employer' ? 'rgba(59,130,246,.08)' : 'var(--raised)', border: `1px solid ${m.from === 'employer' ? 'rgba(59,130,246,.25)' : 'var(--line)'}` }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '.75rem', color: m.from === 'employer' ? 'var(--blue)' : 'var(--muted)', marginBottom: '.2rem' }}>
                {m.from === 'employer' ? `🏢 ${app.company}` : m.withdrawal ? 'You · withdrew' : 'You'} · {fmt(Date.parse(m.at))}
              </div>
              {m.text
                ? <div style={{ fontSize: '.8rem', color: 'var(--white)', lineHeight: 1.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{m.text}</div>
                : <div style={{ fontSize: '.75rem', color: 'var(--muted)' }}>Withdrew without a note.</div>}
            </div>
          ))}
        </div>
      )}

      {/* Actions — shown when expanded. Outcomes (reported to Seen once, as the ONE community report per
          terminal outcome) are kept apart from managing the record (Edit / Delete file nothing). */}
      {isActive && expanded && (
        <div className={`app-actions ${s.panel}`} onClick={e => e.stopPropagation()}>
          <div className={s.label}>What happened?</div>
          <div className={s.actRow}>
            <button type="button" className={`${s.act} ${s.actGreen}`} onClick={() => { onUpdate(app.id, { status: 'hired', stage: 'Offer' }); setExpanded(false) }}>🎉 Got the job</button>
            <button type="button" className={`${s.act} ${s.actRed}`} onClick={() => { onUpdate(app.id, { status: 'ghosted' }); setExpanded(false) }}>👻 Ghosted</button>
            <button type="button" className={`${s.act} ${s.actQuiet}`} onClick={() => { onUpdate(app.id, { status: 'rejected' }); setExpanded(false) }}>❌ Rejected</button>
          </div>
          {/* Phones: the pipeline is a chip + "Next"; jumping to any stage happens here. */}
          <div className={s.moveRow} style={{ flexDirection: 'column' }}>
            <div className={s.label}>Move to stage</div>
            <div className={s.actRow} style={{ marginBottom: '.75rem' }}>
              {STAGES.filter(st => st !== app.stage).map(st => (
                <button key={st} type="button" className={s.act} onClick={() => { onUpdate(app.id, { stage: st }); setExpanded(false) }}>→ {st}</button>
              ))}
            </div>
          </div>
          <div className={s.label}>This record</div>
          <div className={s.manage}>
            <button type="button" className={s.act} onClick={() => onEdit(app)}>✎ Edit</button>
            <button type="button" className={`${s.act} ${s.actQuiet}`} onClick={() => setDeleting(true)} title="Added by mistake? Delete files nothing.">🗑 Delete</button>
            <button type="button" className={`${s.act} ${s.actRed}`} onClick={() => setWithdrawing(true)}>↩ Withdraw</button>
          </div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.75rem', color: 'var(--dim)', marginTop: '.5rem', lineHeight: 1.5 }}>
            Delete = added by mistake, nothing is filed. Withdraw = you pulled out; the card stays.
          </div>
        </div>
      )}
      {!isActive && (
        <div className={s.actRow} style={{ marginTop: '.75rem' }}>
          {app.status !== 'withdrawn' && (
            <button
              type="button"
              className={`${s.act} ${s.actPrimary}`}
              onClick={() => onShare(app)}
            >
              ✦ Share outcome card
            </button>
          )}
          <button type="button" className={`${s.act} ${s.actQuiet}`} onClick={() => setDeleting(true)}>🗑 Delete</button>
        </div>
      )}
      {withdrawing && <WithdrawModal app={app} onClose={() => setWithdrawing(false)} onWithdrawn={onReload} />}
      {deleting && (
        <ConfirmDialog
          title="Delete this application?"
          body={<span style={{ overflowWrap: 'anywhere' }}>Removes <b style={{ color: 'var(--white)' }}>{app.company} · {app.role}</b> from your tracker. Nothing is sent to Seen or to {app.company} — no report, no review. Use this for entries added by mistake.</span>}
          confirmLabel="Delete"
          busyLabel="Deleting…"
          onConfirm={async () => { await onRemove(app.id); setDeleting(false) }}
          onClose={() => setDeleting(false)}
        />
      )}
    </div>
  )
}

function CheckIn({ check, onAnswer, onSnooze, ghostRate, avgWaitDays }: {
  check: DueCheck
  onAnswer: (appId: string, checkType: CheckType, data: Record<string, unknown>) => void
  onSnooze: (appId: string, checkType: CheckType) => void
  ghostRate?: number
  avgWaitDays?: number
}) {
  const { app, checkType, daysElapsed, q } = check
  // tone: good = a step forward (green) · neutral = nothing has happened yet (no ghost icon, no colour —
  // "Still nothing" with a 👻 read as if it filed a ghosting, audit 3 M6) · end = an outcome.
  const answers: Array<{ label: string; data: Record<string, unknown>; tone?: 'good' | 'neutral' }> = []
  if (checkType === 'response_check') {
    answers.push({ label: '✅ Got a response', data: { got_response: true, response_type: 'unknown', days_to_response: daysElapsed }, tone: 'good' })
    answers.push({ label: '📅 Interview', data: { got_response: true, response_type: 'interview', days_to_response: daysElapsed }, tone: 'good' })
    answers.push({ label: '⏳ Not yet', data: { got_response: false, not_yet: true }, tone: 'neutral' })
    answers.push({ label: '❌ Rejected', data: { got_response: true, response_type: 'rejection', days_to_response: daysElapsed } })
    answers.push({ label: '👻 Ghosted', data: { got_response: false, response_type: 'ghosted', days_to_response: daysElapsed } })
    answers.push({ label: '↩ I withdrew', data: { got_response: false, response_type: 'withdrew', withdrew: true, days_to_response: daysElapsed } })
  } else if (checkType === 'interview_check') {
    answers.push({ label: '✅ Had an interview', data: { had_interview: true, interview_type: 'interview' }, tone: 'good' })
    answers.push({ label: '📞 Phone screen', data: { had_interview: true, interview_type: 'phone_screen' }, tone: 'good' })
    answers.push({ label: '⏳ Not yet', data: { had_interview: false, ended: false, not_yet: true }, tone: 'neutral' })
    answers.push({ label: '❌ Rejected', data: { had_interview: false, ended: true, outcome: 'rejected' } })
    answers.push({ label: '↩ I withdrew', data: { had_interview: false, ended: true, outcome: 'withdrew', withdrew: true } })
  } else {
    answers.push({ label: '🎉 Got an offer', data: { outcome: 'offer' }, tone: 'good' })
    answers.push({ label: '⏳ Still waiting', data: { outcome: 'active' }, tone: 'neutral' })
    answers.push({ label: '❌ Rejected', data: { outcome: 'rejected' } })
    answers.push({ label: '👻 Ghosted', data: { outcome: 'ghosted' } })
    answers.push({ label: '↩ I withdrew', data: { outcome: 'withdrew', withdrew: true } })
  }
  const showGhost = ghostRate != null && ghostRate > 0.4 && checkType === 'response_check'

  return (
    <div className="app-check" onClick={e => e.stopPropagation()}>
      <div className="app-check-head">
        {/* The milestone, not the card's age: "Day 30 check-in · day 31" (audit 3 M7). */}
        <span className="app-check-tag"><span className="app-check-dot" />{checkLabel(check)}</span>
        <button type="button" className="app-check-later" style={{ minHeight: 44, minWidth: 44, margin: '-.6rem -.3rem -.6rem 0' }} onClick={() => onSnooze(app.id, checkType)} title="Ask me again tomorrow">Later</button>
      </div>
      <div className="app-check-q">{q}</div>
      {showGhost && (
        <div className="app-check-note">
          {app.company} ghosts {Math.round(ghostRate! * 100)}% of applicants{avgWaitDays ? `, usually by day ${avgWaitDays}` : ''}.
        </div>
      )}
      <div className="app-check-opts">
        {answers.map(a => (
          <button key={a.label} type="button" className={`app-check-opt${a.tone === 'good' ? ' hi' : ''}${a.tone === 'neutral' ? ' ' + s.neutral : ''}`} style={{ minHeight: 44 }} onClick={() => onAnswer(app.id, checkType, a.data)}>
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
  const [loading, setLoading] = useState(true)
  // The account's rows could not be read: show the error + Retry and this device's local copy, never
  // "0 TOTAL · No applications yet" (R-1).
  const [loadFailed, setLoadFailed] = useState(false)
  const [outcomeApp, setOutcomeApp] = useState<Application | null>(null)
  const [roundsApp, setRoundsApp] = useState<Application | null>(null)
  const [showManual, setShowManual] = useState(false)
  const [showSurvey, setShowSurvey] = useState(false)
  // Survey source: prefer the résumé-based survey (asks about the user's past employers from
  // their résumé); fall back to the tracked-application survey only when there's no résumé data.
  const [surveyMode, setSurveyMode] = useState<'resume' | 'tracker'>('resume')
  const [creditsEarned, setCreditsEarned] = useState(0)
  const [editing, setEditing] = useState<Application | null>(null)
  // Edit hit a 409: the form re-opens on the account's latest copy with this notice (audit 3 M5).
  const [editNotice, setEditNotice] = useState('')
  const [editKey, setEditKey] = useState(0)
  const [expandedId, setExpandedId] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)
  const [confirmDupes, setConfirmDupes] = useState(false)
  const [highlightId, setHighlightId] = useState('')
  const highlightedRef = useRef('')
  const [updateInsight, setUpdateInsight] = useState<{ title: string; body: string; color: string } | null>(null)
  const [companyScores, setCompanyScores] = useState<Record<string, ScoreIntel>>({})
  // Writes in flight, per card (H5 "Saving…"); everything else comes from the record (AppStore.syncState).
  const [saving, setSaving] = useState<ReadonlySet<string>>(new Set())
  const markSaving = useCallback((id: string, on: boolean) => setSaving(prev => {
    const next = new Set(prev)
    if (on) next.add(id); else next.delete(id)
    return next
  }), [])
  // List controls (audit 3 M11): attention-first by default, a text filter, ten at a time.
  const [sortMode, setSortMode] = useState<SortMode>('attention')
  const [filterText, setFilterText] = useState('')
  const [visible, setVisible] = useState(PAGE_SIZE)

  useEffect(() => {
    if (!ready) return // wait for the session to resolve — redirecting early bounced signed-in users
    if (!isLoggedIn) { router.replace(loginHref(`${window.location.pathname}${window.location.search}${window.location.hash}`)); return }
    if (isLoggedIn && !isSeeker) { router.replace('/'); return }
  }, [ready, isLoggedIn, isSeeker, router])

  // ?add=1 (the dashboard's "+ Track application") opens the add-application form directly.
  useEffect(() => {
    if (searchParams?.get('add') === '1') setShowManual(true)
  }, [searchParams])

  // Check-in answers given on this device before they reached the account (offline, or answered before
  // answers were stored on the application) are written onto the application now (H3).
  const pushLedger = useCallback(async (data: Application[]) => {
    let pushed = 0
    for (const a of data) {
      if (!isDbId(a.id)) continue
      const pending = EventStore.pendingLedger(a)
      if (!pending.length) continue
      const markers = pending.map(e => checkAnsweredEvent(e.type as CheckType, (e.data || {}) as Record<string, unknown>, daysSince(a.appliedAt, e.createdAt), e.createdAt))
      await AppStore.update(a.id, {}, true, { markers })
      pushed++
    }
    if (pushed) setApps(AppStore.loadSync())
  }, [])

  // Highlight one card and make sure it is on screen: it may sit past "Show 10 more" or under a filter,
  // so the list is opened as far as that card first (a new Day-0 card sorts after the waiting ones).
  const reveal = useCallback((id: string, data: Application[]) => {
    setHighlightId(id)
    const due = new Set(EventStore.dueChecks(data).map(d => d.app.id))
    const at = sortApplications(data, 'attention', due).findIndex(a => a.id === id)
    setFilterText(''); setSortMode('attention')
    if (at >= 0) setVisible(v => Math.max(v, Math.ceil((at + 1) / PAGE_SIZE) * PAGE_SIZE))
    setTimeout(() => {
      const el = document.getElementById(`app_${id}`)
      if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }) }
      setTimeout(() => setHighlightId(''), 2800)
    }, 300)
  }, [])

  const loadApps = useCallback(async () => {
    const { apps: data, synced } = await AppStore.loadResult(isLoggedIn)
    setApps(data)
    setLoadFailed(!synced)
    setLoading(false)
    if (synced && isLoggedIn) {
      const { conflicts } = AppStore.lastLoad
      if (conflicts.length) showToast(`${conflicts.length === 1 ? 'A change' : `${conflicts.length} changes`} made on this device lost to a newer one from another device — showing the latest.`)
      void pushLedger(data)
    }
    // Highlight + scroll to one card: the one just added (?new=1 — the DB returns it first), or the
    // one a notification points at (#app_<id>, from the bell in the Nav).
    const hashId = typeof window !== 'undefined' && window.location.hash.startsWith('#app_') ? window.location.hash.slice(5) : ''
    const target = hashId && data.some(a => a.id === hashId) ? hashId
      : searchParams?.get('new') === '1' && data.length > 0 ? data[0].id : ''
    if (target && highlightedRef.current !== target) {
      highlightedRef.current = target
      reveal(target, data)
    }
  }, [isLoggedIn, searchParams, pushLedger, reveal])

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

  // A new filter or order starts from the top ten again.
  useEffect(() => { setVisible(v => (highlightedRef.current ? v : PAGE_SIZE)) }, [filterText, sortMode])

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

  /** What a failed / refused write tells the user (H5 — never silent). */
  const sayResult = (r: UpdateResult, what = 'That change') => {
    if (r.status === 'failed') showToast(`${what} didn’t reach your account — it’s kept on this device. Tap “Not synced · Retry” on the card.`)
    else if (r.status === 'stale') showToast('Updated on another device — showing the latest.')
    else if (r.status === 'gone') showToast('That application was deleted on another device.')
  }

  // Stage / status moves and check-in answers. The card moves at once; the write is queued per card
  // (AppStore.update) and its result is shown — a failed one stays on the card as "Not synced · Retry".
  const handleUpdate = async (id: string, changes: Partial<Application>, opts: UpdateOptions = {}): Promise<UpdateResult> => {
    const origApp = apps.find(a => a.id === id)
    setApps(prev => prev.map(a => (a.id === id ? { ...a, ...changes } : a)))
    markSaving(id, true)
    const r = await AppStore.update(id, changes, isLoggedIn, opts)
    markSaving(id, false)
    const after = AppStore.loadSync()
    setApps(after)
    sayResult(r, changes.stage ? `Moving it to ${changes.stage}` : 'That update')
    if (r.status === 'stale' || r.status === 'gone') return r
    // The ONE community report per terminal outcome (hired included — "Got the job" never reached
    // the company's score before). A withdrawal is the applicant's move, not the company's: no report.
    if (origApp && (changes.status === 'ghosted' || changes.status === 'rejected' || changes.status === 'hired')) {
      const outcome = changes.status
      // quick_submit requires a signed-in user — without the Bearer token every one of
      // these community reports 401'd silently and the tracker→intel flywheel fed nothing.
      token().then(tok => {
        if (!tok) return
        fetch('/api/reports', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
          body: JSON.stringify({ action: 'quick_submit', company: origApp.company, outcome, role: origApp.role, city: origApp.location || '' }),
        }).catch(() => {})
      }).catch(() => {})
    }
    if (changes.status && ['hired', 'ghosted', 'rejected'].includes(changes.status)) {
      const app = after.find(a => a.id === id)
      if (app) {
        setOutcomeApp(app)
        if (changes.status === 'hired') setRoundsApp(app)
      }
    }
    return r
  }

  const handleRetry = async (id: string) => {
    markSaving(id, true)
    const r = await AppStore.retry(id, isLoggedIn)
    markSaving(id, false)
    setApps(AppStore.loadSync())
    if (r.status === 'ok') showToast('Synced to your account.')
    else if (r.status === 'failed') showToast('Still can’t reach your account — it stays on this device and syncs when the connection is back.')
    else sayResult(r)
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

    const days = daysSince(app.appliedAt)

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

  // Delete (the card's own confirm already happened): AppStore.remove is awaited, then the list
  // reloads. Nothing is reported — a typo must never become a company review.
  const handleRemove = async (id: string) => {
    await AppStore.remove(id, isLoggedIn && isDbId(id))
    await loadApps()
  }

  // Edit: only the fields that changed go to AppStore.update (→ update_application). No event, no report.
  // A 409 re-opens the form on the account's latest copy instead of overwriting it (M5).
  const handleEditSave = async (values: FormValues) => {
    if (!editing) return
    const changes = editChanges(editing, values)
    if (!Object.keys(changes).length) { setEditing(null); setEditNotice(''); return }
    markSaving(editing.id, true)
    const r = await AppStore.update(editing.id, changes, isLoggedIn)
    markSaving(editing.id, false)
    setApps(AppStore.loadSync())
    if (r.status === 'stale' && r.server) {
      setEditing(r.server)
      setEditNotice('Updated on another device — showing the latest. Make your change again if it still applies.')
      setEditKey(k => k + 1)
      return
    }
    setEditing(null); setEditNotice('')
    if (r.status === 'gone') showToast('That application was deleted on another device.')
    else if (r.status === 'failed') showToast('Saved on this device — it didn’t reach your account yet. Tap “Not synced · Retry” on the card.')
  }

  // Route a terminal tracked app to the report page pre-loaded for one-click card creation.
  // /report reads app_id + auto=1 and prefills + renders the OutcomeCard inline from real
  // tracker data (no re-typing). This is the tracker→report→share virality loop.
  const handleShare = (app: Application) => {
    router.push(`/report?app_id=${encodeURIComponent(app.id)}&auto=1`)
  }

  // A check-in answer is DATA ON THE APPLICATION (H3): a check_answered marker plus whatever it means
  // for the stage/status, in ONE update_application call — so the next device knows it was answered
  // and the dashboard's response rate counts it. The device ledger keeps a copy for offline use.
  const handleCheckAnswer = (appId: string, checkType: CheckType, data: Record<string, unknown>) => {
    const app = apps.find(a => a.id === appId)
    if (!app) return
    // Pass the app's identity onto the event — _submitAsReport files a community report
    // from it, and without company/role the server rejected every day-30 outcome.
    EventStore.add({ appId, type: checkType, data, company: app.company, role: app.role, location: app.location, platform: app.platform })
    handleCheckInsight(app, checkType, data)
    const markers = [checkAnsweredEvent(checkType, data, daysSince(app.appliedAt))]
    let changes: Partial<Application> = {}
    let ensureEvent: string | undefined
    if (data.withdrew) {
      // "I withdrew" used to be recorded as REJECTED and filed against the company as a rejection.
      changes = { status: 'withdrawn' }
    } else if (checkType === 'outcome_check') {
      const outcome = data.outcome as string
      if (outcome === 'offer') changes = { status: 'hired', stage: 'Offer' }
      else if (outcome === 'rejected') changes = { status: 'rejected', stage: 'Rejected' }
      else if (outcome === 'ghosted') changes = { status: 'ghosted' }
    } else if (checkType === 'response_check') {
      const rt = data.response_type as string
      if (rt === 'ghosted') changes = { status: 'ghosted' }
      else if (rt === 'rejection') changes = { status: 'rejected', stage: 'Rejected' }
      else if (rt === 'interview') changes = raise(app, 'Interview')
      // "Got a response": the company engaged — recorded as response_received, the card at least Viewed.
      else if (data.got_response) { changes = raise(app, 'Viewed'); ensureEvent = 'response_received' }
    } else if (checkType === 'interview_check') {
      const it = data.interview_type as string
      if (data.ended && (data.outcome as string) === 'rejected') changes = { status: 'rejected', stage: 'Rejected' }
      else if (it === 'phone_screen') changes = raise(app, 'Phone Screen')
      else if (it === 'interview') changes = raise(app, 'Interview')
    }
    void handleUpdate(appId, changes, { markers, ensureEvent })
  }

  // "Later": a check_snoozed event on the application (so another device holds the question too) and
  // the card says when it comes back.
  const handleSnooze = (appId: string, checkType: CheckType) => {
    const until = EventStore.snooze(appId, checkType)
    void handleUpdate(appId, {}, { markers: [checkSnoozedEvent(checkType, until)] })
  }

  // Only OPEN duplicates of the same company+role are dupes (lib/stores/applicationDupes); a finished
  // application at the same company last year is history, not a duplicate. The ORIGINAL (oldest) copy
  // is kept — it carries the first applied date and the event history (audit 3 L3).
  const clearDupes = async () => {
    const { removed } = splitOpenDuplicates(AppStore.loadSync())
    // AWAITED before the reload: firing the deletes and reloading at once let the reload's SELECT win
    // the race and bring the duplicates straight back.
    for (const a of removed) await AppStore.remove(a.id, isLoggedIn && isDbId(a.id)).catch(() => {})
    setConfirmDupes(false)
    await loadApps()
    showToast(`Removed ${removed.length} duplicate${removed.length === 1 ? '' : 's'} — kept the original of each.`)
  }

  // Session unresolved or first load in flight → the page's own skeleton, never a blank (R-2).
  if (!ready || (isLoggedIn && isSeeker && loading)) {
    return <div className="page-full"><div className={s.body} style={{ maxWidth: 1000, margin: '0 auto', padding: '2.5rem 1rem', width: '100%', boxSizing: 'border-box' }}><PageSkeleton label="Loading your applications" tiles={5} rows={4} /></div></div>
  }
  if (!isLoggedIn || !isSeeker) return null

  const active = apps.filter(a => a.status === 'active')
  const ghosted = apps.filter(a => a.status === 'ghosted')
  const hired = apps.filter(a => a.status === 'hired')
  const rejected = apps.filter(a => a.status === 'rejected')
  const withdrawn = apps.filter(a => a.status === 'withdrawn')
  const dueChecks = EventStore.dueChecks(apps)
  const checkByApp = new Map(dueChecks.map(d => [d.app.id, d]))
  const dueIds = new Set(checkByApp.keys())
  const shownApps = filterApplications(sortApplications(apps, sortMode, dueIds), filterText)
  const pageApps = shownApps.slice(0, visible)
  // Housekeeping is for a LIST: with one card "Clear all" beside it read as a threat (phone audit
  // 2026-10-23), and "Clear dupes" only means something when there is a duplicate to clear.
  const openDupes = splitOpenDuplicates(apps).removed.length
  const firstChecked = shownApps.find(a => checkByApp.has(a.id))
  const syncOf = (a: Application): SyncState => (saving.has(a.id) ? 'saving' : AppStore.syncState(a, isLoggedIn))

  // The form closes at once (H5): the card is on the list before the account answers; a slow or failed
  // save shows on the card ("Saving…" / "Not synced · Retry"), never as a form held open for 15 s.
  const handleManualAdd = async (values: FormValues) => {
    const id = 'app_' + Date.now()
    const pending = AppStore.add({ ...toNewApplication(values), id }, isLoggedIn)
    markSaving(id, true)
    const now = AppStore.loadSync()
    setApps(now)
    setShowManual(false)
    reveal(now.some(a => a.id === id) ? id : (now.find(a => a.company.toLowerCase() === values.company.trim().toLowerCase() && a.role.toLowerCase() === values.role.trim().toLowerCase())?.id || id), now)
    const r = await pending
    markSaving(id, false)
    setApps(AppStore.loadSync())
    if (r.id !== id) setHighlightId(h => (h === id ? r.id : h))
    if (r.duplicate) showToast(`${values.company.trim()} · ${values.role.trim()} is already on your list.`)
    else if (!r.synced) showToast('Saved on this device — it didn’t reach your account yet. It syncs on its own, or tap “Not synced · Retry”.')
  }
  const anyWeekOld = apps.some(a => daysSince(a.appliedAt) >= 7)

  return (
    <>
    {/* Add / Edit — one form (components/tracker/ApplicationForm) */}
    {showManual && (
      <ApplicationForm title="Track application" initial={emptyForm()} submitLabel="Add to tracker →" busyLabel="Adding…" onSubmit={handleManualAdd} onClose={() => setShowManual(false)} />
    )}
    {editing && (
      <ApplicationForm key={editKey} title={`Edit · ${editing.company}`} initial={formFromApplication(editing)} notice={editNotice} submitLabel="Save changes" busyLabel="Saving…" onSubmit={handleEditSave} onClose={() => { setEditing(null); setEditNotice('') }} />
    )}
    {confirmClear && (
      <ConfirmDialog
        title="Remove every application?"
        body={`Clears all ${apps.length} from your tracker and your account. Nothing is reported. This cannot be undone.`}
        confirmLabel="Remove all"
        busyLabel="Removing…"
        onConfirm={async () => { await AppStore.clear(isLoggedIn); setApps([]); setConfirmClear(false) }}
        onClose={() => setConfirmClear(false)}
      />
    )}
    {confirmDupes && (
      <ConfirmDialog
        title={`Remove ${openDupes} duplicate${openDupes === 1 ? '' : 's'}?`}
        body={`Open applications to the same company for the same role are duplicates. The original of each — its first applied date and history — is kept; the later ${openDupes === 1 ? 'copy is' : 'copies are'} removed. Nothing is reported.`}
        confirmLabel={`Remove ${openDupes}`}
        busyLabel="Removing…"
        onConfirm={clearDupes}
        onClose={() => setConfirmDupes(false)}
      />
    )}
    {outcomeApp && (
      <OutcomeCard
        app={outcomeApp}
        onClose={() => setOutcomeApp(null)}
        // The other tracked companies' letters (same batch_scores the cards read) so a hired post
        // can compare honestly: "The other 3 places I applied were a C or worse".
        otherGrades={Object.entries(companyScores).filter(([k]) => k !== outcomeApp.company.toLowerCase().trim()).map(([, v]) => gradeLetter(v.overall_score))}
      />
    )}
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
      <div className={s.body} style={{ maxWidth: 1000, margin: '0 auto', padding: '2.5rem 1rem', width: '100%', boxSizing: 'border-box' }}>

        {/* Header — shared shell header: crumb back to the dashboard, title, actions. On phones the
            action lives in the floating button above the tab bar instead (never a tab-bar item). */}
        <PageHeader
          className={s.hdr}
          eyebrow="Application tracker"
          title="My applications"
          sub="Your applications sync to your account. Seen checks in with you at day 7, 14 and 30."
          actions={<button type="button" className={`${s.act} ${s.actPrimary} ${s.deskOnly}`} onClick={() => setShowManual(true)}>+ Track application</button>}
        />

        {loadFailed && (
          <div style={{ marginBottom: '1.25rem' }}>
            <LoadError
              what="your applications from your account"
              detail={apps.length ? `Seen could not be reached. The ${apps.length} below are what this device last synced; edits you make now sync when the connection is back.` : 'Seen could not be reached, so this list does not reflect your account yet.'}
              onRetry={() => { setLoading(true); void loadApps() }}
              retrying={loading}
            />
          </div>
        )}

        {/* Inbox Autopilot — forwarded job emails keep these cards up to date (hidden until it is live) */}
        <InboxAutopilot apps={apps} token={token} onAppsChanged={loadApps} />

        {/* Stats — tiles on wide screens; one line on phones so the cards come first */}
        {apps.length > 0 && (
          <div className={`${s.statLine} ${s.phoneOnly}`} aria-label="Totals">
            <b>{active.length}</b> active<span className={s.sep}>·</span><b>{hired.length}</b> hired<span className={s.sep}>·</span><b>{ghosted.length}</b> ghosted
            {rejected.length > 0 && <><span className={s.sep}>·</span><b>{rejected.length}</b> rejected</>}
            {withdrawn.length > 0 && <><span className={s.sep}>·</span><b>{withdrawn.length}</b> withdrawn</>}
          </div>
        )}
        {/* Hidden when the account could not be read and this device holds nothing: a row of zeros under an
            error block would still read as "you have no applications" (R-1). */}
        {!(loadFailed && apps.length === 0) && (
        <div className={`${s.statTiles} ${s.deskOnly}`}>
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
        )}

        {/* Funnel visualization — needs enough applications to mean anything */}
        {apps.length >= 5 && (
          <div className={s.after} style={{ marginBottom: '1.5rem', background: 'var(--raised)', border: '1px solid var(--line2)', borderRadius: 12, padding: '1rem 1.25rem' }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.75rem', textTransform: 'uppercase', letterSpacing: '.09em', color: 'var(--dim)', marginBottom: '.85rem' }}>Application Funnel</div>
            <div className="funnel">
              {(() => {
                const stageLevel = (s: string) => ['Applied', 'Viewed', 'Phone Screen', 'Interview', 'Final Round', 'Offer'].indexOf(s)
                // Screened = the company engaged: moved past Applied, or ended with a decision (hired/rejected).
                // Ghosted and withdrawn applications never got a screen.
                // The same "responded" the dashboard uses (lib/stores/outcomes) — a check-in "Got a response" counts.
                const screened = apps.filter(a => stageLevel(a.stage) >= 1 || responded(a)).length
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
              <div style={{ fontFamily: 'var(--mono)', fontSize: '.75rem', textTransform: 'uppercase', letterSpacing: '.09em', color: 'var(--red)', marginBottom: '.65rem', display: 'flex', alignItems: 'center', gap: '.5rem' }}>
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
                        <span style={{ fontFamily: 'var(--mono)', fontSize: '.75rem', color: 'var(--muted)', marginLeft: '.5rem' }}>{a.role}</span>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: '.75rem', color: 'var(--red)', fontWeight: 600 }}>
                          {Math.round(score.ghost_rate * 100)}% ghost rate
                        </div>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: '.75rem', color: 'var(--muted)' }}>
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
              <div style={{ fontFamily: 'var(--mono)', fontSize: '.75rem', color: 'var(--sub)', lineHeight: 1.7 }}>{updateInsight.body}</div>
            </div>
            <button type="button" aria-label="Dismiss" onClick={() => setUpdateInsight(null)} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: '.75rem', minWidth: 44, minHeight: 44, margin: '-.6rem -.6rem -.6rem 0', flexShrink: 0 }}>✕</button>
          </div>
        )}

        {/* Check-ins live on each application's card. Up here: one line saying how many are
            waiting, which jumps to the first one in list order. */}
        {firstChecked && (
          <button
            type="button"
            className="check-count"
            style={{ minHeight: 44 }}
            onClick={() => document.getElementById(`app_${firstChecked.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
          >
            <span className="app-check-dot" />
            {dueChecks.length} application{dueChecks.length > 1 ? 's' : ''} waiting on a quick check-in
            <span className="check-count-go">Go to first ↓</span>
          </button>
        )}

        {/* Empty state — both ways in: track one yourself, or Apply on a job. Never shown for a failed load. */}
        {apps.length === 0 && !loadFailed && (
          <div className={s.empty}>
            <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>📋</div>
            <div style={{ fontFamily: 'var(--display)', fontSize: '1.1rem', fontWeight: 700, color: 'var(--white)', marginBottom: '.5rem' }}>No applications yet</div>
            <div style={{ fontSize: '.82rem', color: 'var(--sub)', lineHeight: 1.6, maxWidth: 420, margin: '0 auto' }}>Add one you already sent, or hit Apply on a job here and it lands on this list by itself.</div>
            <div className={s.emptyBtns}>
              <button type="button" className={`${s.act} ${s.actPrimary}`} onClick={() => setShowManual(true)}>+ Track application</button>
              <Link href="/jobs" className={s.act}>Browse jobs →</Link>
            </div>
          </div>
        )}

        {/* Survey CTA — once at least one application is a week old there is something to report */}
        {anyWeekOld && !showSurvey && (
          <div
            className={s.after}
            role="button"
            tabIndex={0}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSurveyMode('resume'); setShowSurvey(true) } }}
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
              <div style={{ fontFamily: 'var(--mono)', fontSize: '.75rem', color: 'var(--indigo)', fontWeight: 600, marginBottom: '.12rem', display: 'flex', alignItems: 'center', gap: '.35rem' }}>
                <span style={{ fontSize: '.75rem' }}>✦</span>
                {creditsEarned > 0 ? `You earned ${creditsEarned} credit${creditsEarned !== 1 ? 's' : ''} — keep going` : 'Earn up to 5 credits today'}
              </div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '.75rem', color: 'var(--sub)' }}>
                Share what happened with your applications — 90 sec, helps future job seekers
              </div>
            </div>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '.75rem', color: 'var(--indigo)', flexShrink: 0 }}>Start →</span>
          </div>
        )}
        {creditsEarned > 0 && !showSurvey && (
          <div className={s.after} style={{ fontFamily: 'var(--mono)', fontSize: '.75rem', color: 'var(--green)', textAlign: 'center', marginBottom: '.65rem' }}>
            ✓ +{creditsEarned} credits earned this session
          </div>
        )}

        {/* Application cards */}
        {/* List controls (M11): attention-first by default, filter, ten at a time. */}
        {apps.length > 1 && (
          <div className={s.tools} role="search" aria-label="List controls">
            <label className={s.toolField}>
              <span className={s.toolLabel}>Sort</span>
              <select className={s.select} value={sortMode} onChange={e => setSortMode(e.target.value as SortMode)} aria-label="Sort applications">
                {SORT_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </label>
            <label className={`${s.toolField} ${s.toolGrow}`}>
              <span className={s.toolLabel}>Filter</span>
              <input className={s.input} type="search" value={filterText} onChange={e => setFilterText(e.target.value)} placeholder="Company, role, city or stage" aria-label="Filter applications" maxLength={80} />
            </label>
            <span className={s.toolCount} aria-live="polite">
              {filterText.trim() ? `${shownApps.length} of ${apps.length} match` : `${apps.length} tracked`}
            </span>
          </div>
        )}
        {apps.length > 0 && shownApps.length === 0 && (
          <div className={s.noMatch}>
            No application matches “{filterText.trim()}”.
            <button type="button" className={s.act} onClick={() => setFilterText('')}>Clear filter</button>
          </div>
        )}

        {apps.length > 0 && (
          <div id="trackerList" style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
            {pageApps.map(app => (
              <div key={app.id} style={highlightId === app.id ? { borderRadius: 12, boxShadow: '0 0 0 2px var(--green), 0 0 30px rgba(16,185,129,0.3)', transition: 'box-shadow 2.5s ease' } : undefined}>
                <AppCard app={app} expanded={expandedId === app.id} setExpanded={open => setExpandedId(open ? app.id : '')} onUpdate={handleUpdate} onEdit={a => { setEditNotice(''); setEditing(a) }} onRemove={handleRemove} onShare={handleShare} onReload={loadApps} intel={companyScores[app.company.toLowerCase().trim()]} check={checkByApp.get(app.id)} onAnswer={handleCheckAnswer} onSnooze={handleSnooze} sync={syncOf(app)} onRetry={handleRetry} />
              </div>
            ))}
          </div>
        )}
        {shownApps.length > pageApps.length && (
          <button type="button" className={`${s.act} ${s.more}`} onClick={() => setVisible(v => v + PAGE_SIZE)}>
            Show {Math.min(PAGE_SIZE, shownApps.length - pageApps.length)} more <span className={s.moreN}>· {shownApps.length - pageApps.length} not shown</span>
          </button>
        )}

        {/* Housekeeping — under the list, out of the way of it; only once there is a list (≥2 cards). */}
        {apps.length > 1 && (
          <div className={`${s.house} ${s.after}`}>
            {openDupes > 0 && (
              <button type="button" className={`${s.act} ${s.actQuiet}`} onClick={() => setConfirmDupes(true)}>Clear {openDupes} duplicate{openDupes > 1 ? 's' : ''}</button>
            )}
            <button type="button" className={`${s.act} ${s.actQuiet}`} onClick={() => setConfirmClear(true)}>Clear all</button>
          </div>
        )}

      </div>
    </div>
    {/* Phones: "+ Track application" floats above the tab bar so it is always one tap away */}
    {apps.length > 0 && !showManual && !editing && !expandedId && (
      <button type="button" className={s.fab} onClick={() => setShowManual(true)} aria-label="Track application">+ Track application</button>
    )}
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

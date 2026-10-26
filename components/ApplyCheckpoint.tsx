'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth'
import { AppStore } from '@/lib/stores/AppStore'
import { applicationFromListing } from '@/lib/stores/listingApplication'
import { aiHeaders } from '@/lib/aiHeaders'
import ModalPortal from '@/components/ModalPortal'
import { displayCompanyName } from '@/lib/companyDisplay'
import { buildCompanySummary } from '@/lib/companyPageSummary'
import { appliedAtFromChoice, checkinEmailPlan, joinDays, type AppliedChoice } from '@/lib/trackCapture'
import { hasPendingRef } from '@/lib/referralClient'
import { safeNextPath } from '@/lib/signupIntent.js'
import AppliedWhen from '@/components/track/AppliedWhen'
import CheckinEmailAsk from '@/components/track/CheckinEmailAsk'

interface ApplyCheckpointProps {
  job: { id: string; title: string; company: string; location?: string; apply_url?: string | null }
  optimized?: boolean
  // When the user has ALREADY indicated they applied (e.g. finished the Apply & Optimize
  // funnel and clicked "I Applied"), open straight into the tracked receipt and record the
  // application on mount — don't re-ask "Did you apply?", which people close without tracking.
  autoConfirm?: boolean
  onClose: () => void
}

type Step = 'main' | 'when' | 'not_yet' | 'declined' | 'confirmed' | 'not_yet_confirmed' | 'listing_gone'

const NOT_YET_REASONS = [
  'I want to edit the resume first',
  'I\'m comparing companies',
  'Not sure this role is right',
  'I\'ll apply soon',
]

const DECLINED_REASONS = [
  'Company looks risky',
  'Salary is unclear',
  'Listing seems fake or outdated',
  'Too many red flags',
  'Found a better option',
]

function saveSkipReason(
  company: string,
  role: string,
  reason: string,
  type: 'not_yet' | 'declined',
) {
  try {
    const key = 'seen_skip_reasons'
    const existing: Array<{
      company: string
      role: string
      reason: string
      type: 'not_yet' | 'declined'
      timestamp: number
    }> = JSON.parse(localStorage.getItem(key) || '[]')
    existing.push({ company, role, reason, type, timestamp: Date.now() })
    localStorage.setItem(key, JSON.stringify(existing))
  } catch {
    // localStorage unavailable — ignore
  }
}

export default function ApplyCheckpoint({ job, optimized: _optimized, autoConfirm = false, onClose }: ApplyCheckpointProps) {
  const router = useRouter()
  const { isLoggedIn } = useAuth()
  const [step, setStep] = useState<Step>(autoConfirm ? 'confirmed' : 'main')
  // The employer as a person would name it ("PLS", never the board slug "plscareers") — what the
  // tracker record and every sentence here carry.
  const companyName = displayCompanyName(job.company) || job.company
  const [loading, setLoading] = useState(false)

  const [creditEarned, setCreditEarned] = useState(false)
  // "I applied earlier": the check-in clock starts at the real date (lib/trackCapture.ts).
  const [whenChoice, setWhenChoice] = useState<AppliedChoice | null>(null)
  const [whenDay, setWhenDay] = useState('')
  const [whenError, setWhenError] = useState('')
  const [tracked, setTracked] = useState<{ appliedAt: number; trackedAt: number } | null>(null)
  // The company's reported reply rate, only where the company page would show one (≥ the rates bar).
  // batch_scores reads stored scores only — it never starts research for an unknown name.
  const [responsePct, setResponsePct] = useState<number | null>(null)
  useEffect(() => {
    if (step !== 'confirmed' || !job.company) return
    let alive = true
    const name = String(job.company).toLowerCase().trim()
    fetch('/api/reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'batch_scores', names: [name] }) })
      .then(r => (r.ok ? r.json() : null))
      .then((d: { scores?: Record<string, Record<string, unknown>> } | null) => {
        const sc = d?.scores?.[name]
        if (!alive || !sc) return
        setResponsePct(buildCompanySummary(sc as Parameters<typeof buildCompanySummary>[0], []).responsePct)
      })
      .catch(() => { /* the line is simply left out */ })
    return () => { alive = false }
  }, [step, job.company])

  // If the user already confirmed they applied (finished the Apply & Optimize funnel),
  // record the application once on mount so it always lands in the tracker — no second
  // "Did you apply?" prompt to accidentally dismiss.
  const didAutoConfirm = useRef(false)
  useEffect(() => {
    if (autoConfirm && !didAutoConfirm.current) {
      didAutoConfirm.current = true
      handleApplied()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoConfirm])

  // The listing page was up but the position was gone/closed — the applicant couldn't
  // apply at all. File an availability report (the same signal the job-card flag uses):
  // it lands in the admin reported-listings queue to keep or remove, and once an admin
  // confirms it dead, the company's score carries the stale-listing penalty.
  const [reportedGone, setReportedGone] = useState<'sent' | 'signin' | null>(null)
  async function handleListingGone() {
    setLoading(true)
    if (!isLoggedIn) {
      setReportedGone('signin')
    } else {
      try {
        await fetch('/api/user-sync', {
          method: 'POST',
          headers: await aiHeaders(),
          body: JSON.stringify({
            action: 'report_job_availability',
            job_id: String(job.id),
            status: 'expired',
            snapshot: {
              company: job.company || null,
              title: job.title || null,
              city: job.location || null,
              apply_url: job.apply_url || null,
            },
          }),
        })
        setReportedGone('sent')
      } catch {
        setReportedGone('sent') // report is best-effort; never dead-end the user on a network blip
      }
    }
    setLoading(false)
    setStep('listing_gone')
  }

  // The ONLY place this dialog writes an application: on "✓ Yes, I applied" (or autoConfirm, when
  // the user already said so in the Optimize funnel). "Apply ↗" itself only opens the listing and
  // records an anonymous click (lib/trackApply) — it never adds a card. The card carries the
  // listing's full title, location, id and link (lib/stores/listingApplication).
  async function handleApplied(appliedAt: number = Date.now()) {
    setLoading(true)
    setTracked({ appliedAt, trackedAt: Date.now() })
    try {
      await AppStore.add({ ...applicationFromListing(job), appliedAt }, isLoggedIn)
      // Earn 1 AI credit back for tracking the application
      if (isLoggedIn) {
        try {
          const hdrs = await aiHeaders()
          const r = await fetch('/api/user-sync', {
            method: 'POST',
            headers: hdrs,
            body: JSON.stringify({ action: 'earn_credit', reason: 'track_application', jid: job.id }),
          })
          const d = await r.json().catch(() => ({}))
          if (d.earned) {
            setCreditEarned(true)
            window.dispatchEvent(new CustomEvent('seen:credits-updated'))
          }
        } catch { /* best-effort */ }
      }
    } catch {
      // Non-fatal — still show confirmed step
    }
    setLoading(false)
    setStep('confirmed')
  }

  // The check-in emails this application will really get (api/outcome-followups.js), and where a
  // guest's confirmation link comes back to: this listing's page when it is a Seen listing, else the tracker.
  const checkinPlan = tracked ? checkinEmailPlan(tracked.appliedAt, tracked.trackedAt) : []
  const checkpointNext = (typeof window !== 'undefined' && window.location.pathname.startsWith('/jobs/') && safeNextPath(window.location.pathname)) || '/tracker'
  const [inviteWaiting, setInviteWaiting] = useState(false)
  useEffect(() => { setInviteWaiting(hasPendingRef()) }, [])

  // ── Styles ─────────────────────────────────────────────────────────────────

  const backdropStyle: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,.65)',
    backdropFilter: 'blur(4px)',
    WebkitBackdropFilter: 'blur(4px)',
    zIndex: 9900,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '1rem',
  }

  const sheetStyle: React.CSSProperties = {
    width: '100%',
    maxWidth: 480,
    maxHeight: '85dvh',
    overflowY: 'auto',
    // Solid, never glass: a panel over content (CLAUDE.md, PR #322 rule) — the old 3% white let the page show through.
    background: '#0e111c',
    borderRadius: 20,
    border: '1px solid var(--line2)',
    padding: '0 0 env(safe-area-inset-bottom, 16px)',
    animation: 'fadeUp .25s ease both',
    position: 'relative',
  }

  const innerStyle: React.CSSProperties = {
    padding: '20px 24px 28px',
  }

  const closeBtnStyle: React.CSSProperties = {
    position: 'absolute',
    top: 16,
    right: 18,
    background: 'none',
    border: 'none',
    color: 'var(--dim)',
    fontSize: 20,
    lineHeight: 1,
    cursor: 'pointer',
    padding: 4,
    zIndex: 1,
  }

  const backBtnStyle: React.CSSProperties = {
    background: 'none',
    border: 'none',
    color: 'var(--dim)',
    lineHeight: 1,
    cursor: 'pointer',
    padding: '0 4px 0 0',
    marginBottom: 16,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontFamily: 'var(--mono)',
    fontSize: 13,
  }

  const headingStyle: React.CSSProperties = {
    fontFamily: 'var(--display)',
    fontSize: 24,
    fontWeight: 800,
    color: 'var(--white)',
    lineHeight: 1.15,
    marginBottom: 6,
  }

  const subtitleStyle: React.CSSProperties = {
    fontFamily: 'var(--mono)',
    fontSize: 13,
    color: 'var(--sub)',
    lineHeight: 1.5,
    marginBottom: 4,
  }

  const jobLineStyle: React.CSSProperties = {
    fontFamily: 'var(--mono)',
    fontSize: 12,
    color: 'var(--dim)',
    marginBottom: 24,
  }

  const primaryBtnStyle: React.CSSProperties = {
    display: 'block',
    width: '100%',
    padding: '14px 20px',
    background: 'rgba(16,185,129,.12)',
    color: 'var(--green)',
    border: '1px solid var(--green)',
    borderRadius: 11,
    fontFamily: 'var(--mono)',
    fontSize: 14,
    fontWeight: 600,
    cursor: loading ? 'not-allowed' : 'pointer',
    opacity: loading ? 0.6 : 1,
    textAlign: 'left',
    marginBottom: 10,
    transition: 'background .15s, opacity .15s',
  }

  const secondaryBtnStyle: React.CSSProperties = {
    display: 'block',
    width: '100%',
    padding: '13px 20px',
    background: 'none',
    color: 'var(--sub)',
    border: '1px solid var(--line)',
    borderRadius: 11,
    fontFamily: 'var(--mono)',
    fontSize: 14,
    cursor: 'pointer',
    textAlign: 'left',
    marginBottom: 10,
    transition: 'border-color .15s, color .15s',
  }

  const ghostBtnStyle: React.CSSProperties = {
    display: 'block',
    width: '100%',
    padding: '12px 20px',
    background: 'none',
    color: 'var(--dim)',
    border: 'none',
    borderRadius: 11,
    fontFamily: 'var(--mono)',
    fontSize: 13,
    cursor: 'pointer',
    textAlign: 'left',
    transition: 'color .15s',
  }

  const reasonBtnStyle: React.CSSProperties = {
    display: 'block',
    width: '100%',
    padding: '13px 16px',
    background: 'none',
    color: 'var(--sub)',
    border: '1px solid var(--line)',
    borderRadius: 10,
    fontFamily: 'var(--mono)',
    fontSize: 13,
    cursor: 'pointer',
    textAlign: 'left',
    marginBottom: 8,
    transition: 'border-color .15s, color .15s',
  }

  const confirmedCheckStyle: React.CSSProperties = {
    fontFamily: 'var(--display)',
    fontSize: 40,
    fontWeight: 800,
    color: 'var(--green)',
    lineHeight: 1,
    marginBottom: 10,
  }

  const closeFullBtnStyle: React.CSSProperties = {
    display: 'block',
    width: '100%',
    padding: '13px 20px',
    background: 'none',
    color: 'var(--sub)',
    border: '1px solid var(--line)',
    borderRadius: 11,
    fontFamily: 'var(--mono)',
    fontSize: 14,
    cursor: 'pointer',
    textAlign: 'center',
    transition: 'border-color .15s, color .15s',
  }

  const trackerBtnStyle: React.CSSProperties = {
    display: 'block',
    width: '100%',
    padding: '13px 20px',
    background: 'rgba(16,185,129,.12)',
    color: 'var(--green)',
    border: '1px solid var(--green)',
    borderRadius: 11,
    fontFamily: 'var(--mono)',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    textAlign: 'center',
    marginBottom: 10,
    transition: 'background .15s',
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <ModalPortal>
    <div
      style={backdropStyle}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={sheetStyle} role="dialog" aria-modal="true" aria-label={step === 'main' ? `Did you apply to ${job.company}?` : 'Application tracking'}>
        {/* ── MAIN ── */}
        {step === 'main' && (
          <div style={innerStyle}>
            <button style={closeBtnStyle} onClick={onClose} aria-label="Close">×</button>

            <div style={headingStyle}>Did you apply?</div>
            <div style={subtitleStyle}>Answer once so Seen can start your response timeline.</div>
            <div style={jobLineStyle}>{companyName} · {job.title}</div>

            <button
              style={primaryBtnStyle}
              onClick={() => handleApplied()}
              disabled={loading}
              data-testid="checkpoint-applied"
            >
              {loading ? 'Saving…' : '✓ Yes, I applied today'}
            </button>

            <button
              style={secondaryBtnStyle}
              onClick={() => { setWhenChoice(null); setWhenError(''); setStep('when') }}
              disabled={loading}
              data-testid="checkpoint-applied-earlier"
            >
              I applied earlier
            </button>

            <button
              style={secondaryBtnStyle}
              onClick={() => setStep('not_yet')}
            >
              Not yet
            </button>

            <button
              style={secondaryBtnStyle}
              onClick={handleListingGone}
              disabled={loading}
            >
              🚫 Couldn&apos;t — the listing was gone or closed
            </button>

            <button
              style={ghostBtnStyle}
              onClick={() => setStep('declined')}
            >
              I changed my mind
            </button>
          </div>
        )}

        {/* ── WHEN (applied before today) ── */}
        {step === 'when' && (
          <div style={innerStyle}>
            <button style={backBtnStyle} onClick={() => setStep('main')}>
              ← back
            </button>
            <div style={headingStyle}>When did you apply?</div>
            <div style={{ ...jobLineStyle, marginBottom: 16 }}>{companyName} · {job.title}</div>
            <AppliedWhen
              legend="Pick the closest"
              choice={whenChoice}
              pickedDay={whenDay}
              onChoice={c => { setWhenChoice(c); setWhenError('') }}
              onPickedDay={setWhenDay}
            />
            {whenError && <div role="alert" style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--red)', marginBottom: 10 }}>{whenError}</div>}
            <button
              style={{ ...primaryBtnStyle, textAlign: 'center' }}
              disabled={loading}
              data-testid="checkpoint-when-submit"
              onClick={() => {
                const at = whenChoice ? appliedAtFromChoice(whenChoice, whenDay) : null
                if (at == null) { setWhenError(whenChoice ? 'Pick the day you applied (today or earlier).' : 'Pick when you applied.'); return }
                void handleApplied(at)
              }}
            >
              {loading ? 'Saving…' : 'Track it'}
            </button>
          </div>
        )}

        {/* ── LISTING GONE (couldn't apply — flag for admin review) ── */}
        {step === 'listing_gone' && (
          <div style={innerStyle}>
            <div style={{ ...confirmedCheckStyle, fontSize: 40 }}>
              {reportedGone === 'signin' ? 'Thanks for flagging.' : 'Flagged for review.'}
            </div>
            <div style={{
              fontFamily: 'var(--mono)',
              fontSize: 14,
              color: 'var(--sub)',
              lineHeight: 1.6,
              marginBottom: 24,
            }}>
              {reportedGone === 'signin' ? (
                <>Sign in and report it from the listing card so it counts — verified dead
                listings get pulled, and companies that leave them up lose transparency score.</>
              ) : (
                <>We&apos;ll verify {companyName} — {job.title} and pull it if it&apos;s dead.
                Companies that leave inactive listings up lose transparency score, so this
                report protects the next applicant&apos;s time.</>
              )}
            </div>
            <button style={closeFullBtnStyle} onClick={onClose}>
              Close
            </button>
          </div>
        )}

        {/* ── NOT YET ── */}
        {step === 'not_yet' && (
          <div style={innerStyle}>
            <button style={backBtnStyle} onClick={() => setStep('main')}>
              ← back
            </button>

            <div style={headingStyle}>What&apos;s holding you back?</div>

            <div style={{ marginTop: 18 }}>
              {NOT_YET_REASONS.map(reason => (
                <button
                  key={reason}
                  style={reasonBtnStyle}
                  onClick={() => {
                    saveSkipReason(companyName, job.title, reason, 'not_yet')
                    setStep('not_yet_confirmed')
                  }}
                >
                  {reason}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── NOT YET CONFIRMED ── */}
        {step === 'not_yet_confirmed' && (
          <div style={innerStyle}>
            <div style={{ ...confirmedCheckStyle, fontSize: 40 }}>Got it.</div>
            <div style={{
              fontFamily: 'var(--mono)',
              fontSize: 14,
              color: 'var(--sub)',
              lineHeight: 1.6,
              marginBottom: 24,
            }}>
              We&apos;ll remind you to check back on {companyName} — {job.title}.
            </div>
            <button style={closeFullBtnStyle} onClick={onClose}>
              Close
            </button>
          </div>
        )}

        {/* ── DECLINED ── */}
        {step === 'declined' && (
          <div style={innerStyle}>
            <button style={backBtnStyle} onClick={() => setStep('main')}>
              ← back
            </button>

            <div style={headingStyle}>What happened?</div>

            <div style={{ marginTop: 18 }}>
              {DECLINED_REASONS.map(reason => (
                <button
                  key={reason}
                  style={reasonBtnStyle}
                  onClick={() => {
                    saveSkipReason(companyName, job.title, reason, 'declined')
                    // "Fake or outdated" is an availability claim, not just a skip reason —
                    // file it (weaker 'unknown' status) so it reaches the admin review queue
                    // instead of dying in localStorage.
                    if (reason === 'Listing seems fake or outdated' && isLoggedIn) {
                      aiHeaders().then(h => fetch('/api/user-sync', {
                        method: 'POST',
                        headers: h,
                        body: JSON.stringify({
                          action: 'report_job_availability',
                          job_id: String(job.id),
                          status: 'unknown',
                          snapshot: { company: job.company || null, title: job.title || null, city: job.location || null, apply_url: job.apply_url || null },
                        }),
                      })).catch(() => { /* best-effort signal */ })
                    }
                    onClose()
                  }}
                >
                  {reason}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── CONFIRMED ── */}
        {step === 'confirmed' && (
          <div style={innerStyle}>
            <div style={confirmedCheckStyle}>✓ Tracked.</div>

            {creditEarned && (
              <div style={{
                background: 'rgba(16,185,129,.1)', border: '1px solid rgba(16,185,129,.25)',
                borderRadius: 8, padding: '.5rem .85rem', marginBottom: '.75rem',
                fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', color: 'var(--green)',
                display: 'flex', alignItems: 'center', gap: '.4rem',
              }}>
                +1 AI credit earned for tracking
              </div>
            )}

            {responsePct != null && (
              <div style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--text)', lineHeight: 1.6, marginBottom: 10 }} data-testid="checkpoint-reply-rate">
                {companyName} usually replies to {responsePct}% of applicants.
              </div>
            )}

            {isLoggedIn ? (
              <div style={{ fontFamily: 'var(--mono)', fontSize: 14, color: 'var(--sub)', lineHeight: 1.6, marginBottom: 22 }} data-testid="checkpoint-signed-in">
                {checkinPlan.length
                  ? <>We&apos;ll email you on {joinDays(checkinPlan)} to ask what happened, unless you update it first.</>
                  : <>Update it in your tracker when you hear back.</>}
              </div>
            ) : (
              <div style={{ marginBottom: 18 }}>
                <CheckinEmailAsk company={companyName} plan={checkinPlan} next={checkpointNext} inviteWaiting={inviteWaiting} trackerLink={false} />
              </div>
            )}

            <button style={trackerBtnStyle} onClick={() => router.push('/tracker')}>
              Go to tracker →
            </button>

            <button style={closeFullBtnStyle} onClick={onClose}>
              Close
            </button>
          </div>
        )}
      </div>
    </div>
    </ModalPortal>
  )
}

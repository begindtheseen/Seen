'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth'
import { AppStore } from '@/lib/stores/AppStore'

interface CoScore {
  overall_score: number
  ghost_rate: number
  avg_wait_days: number
  report_count: number
  risk_level: 'safe' | 'warn' | 'danger'
}

function grade(s: number) {
  if (s >= 80) return 'A'; if (s >= 65) return 'B'
  if (s >= 50) return 'C'; if (s >= 35) return 'D'; return 'F'
}

const JOURNEY_STEPS = [
  { label: 'Resume optimized', done: true },
  { label: 'Apply to job', done: false },
  { label: 'Confirm application', done: false },
  { label: 'Track response', done: false },
  { label: 'Unlock outcome report', done: false },
]

const NOT_YET_REASONS = [
  { id: 'edit', label: 'Want to edit my resume first' },
  { id: 'comparing', label: 'Comparing companies' },
  { id: 'unsure', label: 'Not sure this job is worth it' },
  { id: 'later', label: 'Will apply later' },
]

const CHANGED_REASONS = [
  { id: 'risky', label: 'Company looks risky' },
  { id: 'salary', label: 'Salary or comp unclear' },
  { id: 'fake', label: 'Job listing seems fake' },
  { id: 'better', label: 'Found a better option' },
  { id: 'other', label: 'Other reason' },
]

type Answer = 'yes' | 'not_yet' | 'changed' | 'remind' | null
type Phase = 'ask' | 'not_yet_reason' | 'changed_reason' | 'done_yes' | 'done_other'

function ApplyContent() {
  const params = useSearchParams()
  const router = useRouter()
  const { isLoggedIn } = useAuth()

  const co      = params?.get('co') ?? ''
  const role    = params?.get('role') ?? ''
  const jid     = params?.get('jid') ?? ''
  const jobUrl  = params?.get('jobUrl') ?? ''
  const platform = params?.get('via') ?? 'Seen'

  const [score, setScore] = useState<CoScore | null>(null)
  const [phase, setPhase] = useState<Phase>('ask')
  const [answer, setAnswer] = useState<Answer>(null)
  const [saving, setSaving] = useState(false)
  const [insight, setInsight] = useState<string | null>(null)
  const [notYetReason, setNotYetReason] = useState('')

  useEffect(() => {
    if (!co) return
    fetch('/api/reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: co }),
    })
      .then(r => r.json())
      .then(d => { if (d.score) setScore(d.score) })
      .catch(() => {})
  }, [co])

  const riskColor = score
    ? score.risk_level === 'safe' ? 'var(--green)' : score.risk_level === 'danger' ? 'var(--red)' : 'var(--amber)'
    : 'var(--blue)'

  async function handleYes() {
    setSaving(true)
    await AppStore.add({
      company: co || 'Unknown',
      role: role || 'Unknown',
      location: '',
      platform,
      stage: 'Applied',
      status: 'active',
      jobUrl: jobUrl || undefined,
      jobId: jid || undefined,
    }, isLoggedIn)
    setSaving(false)

    // Unlock insight based on company data
    if (score) {
      const ghostPct = Math.round(score.ghost_rate * 100)
      const wait = score.avg_wait_days
      if (score.ghost_rate > 0.6) {
        setInsight(`⚠ ${co} has a ${ghostPct}% ghost rate. We'll alert you if they go silent past ${wait} days.`)
      } else if (score.risk_level === 'safe') {
        setInsight(`✅ ${co} has a strong hiring grade (${grade(score.overall_score)}). Most applicants hear back within ${wait} days.`)
      } else {
        setInsight(`📊 ${co} typically responds within ${wait} days. Your Day 7 and Day 14 check-ins are now scheduled.`)
      }
    } else {
      setInsight(`📊 Tracked. Your Day 7 check-in is scheduled — we'll ask if ${co} responded.`)
    }

    setAnswer('yes')
    setPhase('done_yes')
  }

  function handleNotYet() {
    setAnswer('not_yet')
    setPhase('not_yet_reason')
  }

  function handleChanged() {
    setAnswer('changed')
    setPhase('changed_reason')
  }

  function handleRemind() {
    setAnswer('remind')
    // Store a "remind" intent in localStorage so the /apply page can surface it later
    try {
      const reminders = JSON.parse(localStorage.getItem('seen_apply_reminders') || '[]')
      reminders.push({ co, role, jid, jobUrl, remindAt: Date.now() + 86400000 })
      localStorage.setItem('seen_apply_reminders', JSON.stringify(reminders.slice(-10)))
    } catch {}
    setPhase('done_other')
  }

  function handleNotYetReason(id: string) {
    setNotYetReason(id)
    setPhase('done_other')
  }

  function handleChangedReason(id: string) {
    // Store avoidance data — user avoided a high-risk application
    try {
      const avoided = JSON.parse(localStorage.getItem('seen_avoided_apps') || '[]')
      avoided.push({ co, role, jid, reason: id, ts: Date.now() })
      localStorage.setItem('seen_avoided_apps', JSON.stringify(avoided.slice(-20)))
    } catch {}
    setPhase('done_other')
  }

  if (!co && !role) {
    return (
      <div style={{ textAlign: 'center', padding: '4rem 2rem', color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: '.75rem' }}>
        Missing application context.{' '}
        <a href="/jobs" style={{ color: 'var(--blue)' }}>Browse jobs →</a>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 460, margin: '0 auto', padding: '3rem 1.5rem 4rem', width: '100%', boxSizing: 'border-box' }}>

      {/* Eyebrow */}
      <div style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', textTransform: 'uppercase', letterSpacing: '.14em', color: 'var(--blue)', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 16, height: 1, background: 'var(--blue)', display: 'inline-block' }} />
        Seen · Application Tracker
      </div>

      {/* Company header */}
      <h1 style={{ fontFamily: 'var(--display)', fontSize: '1.65rem', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.03em', lineHeight: 1.2, marginBottom: '.35rem' }}>
        {phase === 'ask' ? <>Did you apply to <span style={{ color: riskColor }}>{co}</span>?</> :
         phase === 'not_yet_reason' ? 'What\'s holding you back?' :
         phase === 'changed_reason' ? 'What changed your mind?' :
         phase === 'done_yes' ? 'Application tracked ✅' :
         'Got it.'}
      </h1>
      {role && phase === 'ask' && (
        <div style={{ fontFamily: 'var(--mono)', fontSize: '.72rem', color: 'var(--sub)', marginBottom: '1.5rem' }}>{role}</div>
      )}

      {/* Journey progress — endowed progress effect */}
      {(phase === 'ask' || phase === 'done_yes') && (
        <div style={{ marginBottom: '1.5rem', background: 'var(--raised)', border: '1px solid var(--line)', borderRadius: 10, padding: '.75rem 1rem' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--dim)', marginBottom: '.6rem' }}>Application journey</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.35rem' }}>
            {JOURNEY_STEPS.map((step, i) => {
              const isCompleted = phase === 'done_yes' ? i <= 2 : step.done
              const isCurrent = phase === 'ask' ? i === 1 : (phase === 'done_yes' ? i === 3 : false)
              return (
                <div key={step.label} style={{ display: 'flex', alignItems: 'center', gap: '.6rem' }}>
                  <div style={{
                    width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
                    background: isCompleted ? 'var(--green)' : isCurrent ? 'rgba(59,130,246,0.3)' : 'var(--line)',
                    border: `2px solid ${isCompleted ? 'var(--green)' : isCurrent ? 'var(--blue)' : 'var(--line2)'}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '8px',
                  }}>
                    {isCompleted && <span style={{ color: '#fff' }}>✓</span>}
                  </div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: isCompleted ? 'var(--green)' : isCurrent ? 'var(--white)' : 'var(--dim)', fontWeight: isCurrent ? 600 : 400 }}>
                    {step.label}
                    {isCurrent && <span style={{ color: 'var(--blue)', marginLeft: '.4rem' }}>← you are here</span>}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Company score card */}
      {score && phase === 'ask' && (
        <div style={{
          background: 'var(--raised)', border: `1px solid ${riskColor}22`, borderRadius: 12,
          padding: '.85rem 1rem', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '1rem',
        }}>
          <div style={{ fontFamily: 'var(--display)', fontSize: '2rem', fontWeight: 800, color: riskColor, lineHeight: 1, flexShrink: 0 }}>
            {grade(score.overall_score)}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--muted)', marginBottom: '.25rem' }}>{co} hiring grade</div>
            <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
              {score.ghost_rate > 0 && (
                <span style={{ fontFamily: 'var(--mono)', fontSize: '.5rem', background: score.ghost_rate > 0.5 ? 'rgba(239,68,68,0.1)' : 'rgba(245,158,11,0.1)', color: score.ghost_rate > 0.5 ? 'var(--red)' : 'var(--amber)', border: `1px solid ${score.ghost_rate > 0.5 ? 'rgba(239,68,68,0.2)' : 'rgba(245,158,11,0.2)'}`, borderRadius: 4, padding: '.1rem .35rem' }}>
                  {Math.round(score.ghost_rate * 100)}% ghost rate
                </span>
              )}
              {score.avg_wait_days > 0 && (
                <span style={{ fontFamily: 'var(--mono)', fontSize: '.5rem', background: 'rgba(99,102,241,0.1)', color: 'rgba(180,180,255,0.85)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 4, padding: '.1rem .35rem' }}>
                  avg {score.avg_wait_days}d wait
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* === PHASE: ask === */}
      {phase === 'ask' && (
        <>
          {/* Incentive strip */}
          <div style={{ background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.18)', borderRadius: 12, padding: '.9rem 1rem', marginBottom: '1.25rem' }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', textTransform: 'uppercase', letterSpacing: '.12em', color: 'var(--green)', fontWeight: 700, marginBottom: '.65rem' }}>
              Track this application and unlock
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '.4rem' }}>
              {[
                ['📊', 'Expected response window for ' + (co || 'this company')],
                ['👻', 'Ghost risk alert if they go silent'],
                ['📅', 'Day 7 / 14 / 30 check-in reminders'],
                ['🎉', 'Outcome card + share image when it closes'],
              ].map(([icon, text]) => (
                <div key={text} style={{ display: 'flex', alignItems: 'center', gap: '.55rem', fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'rgba(52,211,153,0.85)' }}>
                  <span style={{ flexShrink: 0 }}>{icon}</span><span>{text}</span>
                </div>
              ))}
            </div>
          </div>

          {!isLoggedIn && (
            <div style={{ background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 9, padding: '.65rem .9rem', marginBottom: '1rem', fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--amber)', lineHeight: 1.65 }}>
              <strong>Sign in</strong> to sync reminders across all devices.{' '}
              <a href={`/login?return=${encodeURIComponent(`/apply?co=${encodeURIComponent(co)}&role=${encodeURIComponent(role)}&jid=${jid}&jobUrl=${encodeURIComponent(jobUrl)}`)}`} style={{ color: 'var(--blue)', textDecoration: 'none' }}>Sign in →</a>
            </div>
          )}

          {/* 4-option grid */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
            <button
              onClick={handleYes}
              disabled={saving}
              style={{ width: '100%', background: 'linear-gradient(135deg, rgba(16,185,129,0.18) 0%, rgba(16,185,129,0.08) 100%)', border: '1.5px solid rgba(16,185,129,0.5)', color: 'var(--green)', fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.95rem', borderRadius: 12, padding: '.95rem 1.25rem', cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1, letterSpacing: '-.01em', textAlign: 'left', boxShadow: '0 0 24px rgba(16,185,129,0.1)' }}
            >
              ✅ Yes, I applied
              <div style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', fontWeight: 400, color: 'rgba(52,211,153,0.65)', marginTop: '.25rem' }}>Start tracking your timeline</div>
            </button>

            <button
              onClick={handleNotYet}
              style={{ width: '100%', background: 'var(--raised)', border: '1px solid var(--line2)', color: 'var(--white)', fontFamily: 'var(--display)', fontWeight: 700, fontSize: '.88rem', borderRadius: 12, padding: '.85rem 1.25rem', cursor: 'pointer', textAlign: 'left' }}
            >
              ⏳ Not yet
              <div style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', fontWeight: 400, color: 'var(--sub)', marginTop: '.2rem' }}>Save it and come back</div>
            </button>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.5rem' }}>
              <button
                onClick={handleChanged}
                style={{ background: 'var(--raised)', border: '1px solid var(--line2)', color: 'var(--sub)', fontFamily: 'var(--mono)', fontSize: '.65rem', borderRadius: 10, padding: '.75rem .9rem', cursor: 'pointer', textAlign: 'left' }}
              >
                ❌ Changed my mind
              </button>
              <button
                onClick={handleRemind}
                style={{ background: 'var(--raised)', border: '1px solid var(--line2)', color: 'var(--sub)', fontFamily: 'var(--mono)', fontSize: '.65rem', borderRadius: 10, padding: '.75rem .9rem', cursor: 'pointer', textAlign: 'left' }}
              >
                🔔 Remind me later
              </button>
            </div>
          </div>
        </>
      )}

      {/* === PHASE: not_yet_reason === */}
      {phase === 'not_yet_reason' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.45rem' }}>
          {NOT_YET_REASONS.map(r => (
            <button
              key={r.id}
              onClick={() => handleNotYetReason(r.id)}
              style={{ width: '100%', background: 'var(--raised)', border: '1px solid var(--line2)', color: 'var(--white)', fontFamily: 'var(--mono)', fontSize: '.72rem', borderRadius: 10, padding: '.8rem 1rem', cursor: 'pointer', textAlign: 'left' }}
            >
              {r.label}
            </button>
          ))}
          {jobUrl && (
            <a
              href={jobUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: 'block', marginTop: '.5rem', background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.25)', color: 'var(--blue)', fontFamily: 'var(--mono)', fontSize: '.68rem', borderRadius: 10, padding: '.8rem 1rem', textDecoration: 'none', textAlign: 'center' }}
            >
              ↗ Open job listing — decide now
            </a>
          )}
        </div>
      )}

      {/* === PHASE: changed_reason === */}
      {phase === 'changed_reason' && (
        <>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'var(--sub)', marginBottom: '1rem', lineHeight: 1.65 }}>
            Your feedback helps Seen flag risky companies for other applicants.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.45rem' }}>
            {CHANGED_REASONS.map(r => (
              <button
                key={r.id}
                onClick={() => handleChangedReason(r.id)}
                style={{ width: '100%', background: 'var(--raised)', border: '1px solid var(--line2)', color: 'var(--white)', fontFamily: 'var(--mono)', fontSize: '.72rem', borderRadius: 10, padding: '.8rem 1rem', cursor: 'pointer', textAlign: 'left' }}
              >
                {r.label}
              </button>
            ))}
          </div>
        </>
      )}

      {/* === PHASE: done_yes === */}
      {phase === 'done_yes' && (
        <>
          {insight && (
            <div style={{ background: 'rgba(16,185,129,0.07)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: 12, padding: '1rem 1.1rem', marginBottom: '1.25rem' }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--green)', fontWeight: 700, marginBottom: '.4rem' }}>Unlocked insight</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '.7rem', color: 'rgba(255,255,255,0.85)', lineHeight: 1.7 }}>{insight}</div>
            </div>
          )}
          <button
            onClick={() => router.push('/tracker?new=1')}
            style={{ width: '100%', background: 'linear-gradient(135deg, rgba(16,185,129,0.2) 0%, rgba(16,185,129,0.1) 100%)', border: '1.5px solid rgba(16,185,129,0.4)', color: 'var(--green)', fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.95rem', borderRadius: 12, padding: '.95rem 1.25rem', cursor: 'pointer', marginBottom: '.65rem', letterSpacing: '-.01em' }}
          >
            View my tracker →
          </button>
          <button
            onClick={() => router.push('/jobs')}
            style={{ width: '100%', background: 'none', border: 'none', color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: '.62rem', cursor: 'pointer', padding: '.5rem', textAlign: 'center' }}
          >
            Browse more jobs
          </button>
        </>
      )}

      {/* === PHASE: done_other === */}
      {phase === 'done_other' && (
        <>
          <div style={{ background: 'var(--raised)', border: '1px solid var(--line2)', borderRadius: 12, padding: '1rem 1.1rem', marginBottom: '1.25rem' }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.7rem', color: 'var(--sub)', lineHeight: 1.7 }}>
              {answer === 'not_yet' && (
                <div style={{ fontFamily: 'var(--mono)', fontSize: '.7rem', color: 'var(--sub)', lineHeight: 1.7 }}>
                  {(notYetReason === 'comparing' || notYetReason === 'unsure') && score ? (
                    <>
                      <div style={{ marginBottom: '.5rem' }}>
                        {co} hiring grade: <span style={{ color: riskColor, fontWeight: 700 }}>{grade(score.overall_score)}</span>
                        {score.ghost_rate > 0 && <> · <span style={{ color: score.ghost_rate > 0.5 ? 'var(--red)' : 'var(--amber)' }}>{Math.round(score.ghost_rate * 100)}% ghost rate</span></>}
                        {score.avg_wait_days > 0 && <> · avg {score.avg_wait_days}d to hear back</>}
                      </div>
                      <div>Saved. Come back after you&apos;ve decided — we&apos;ll track it from here.</div>
                    </>
                  ) : (
                    `Saved. ${jobUrl ? 'The job listing is still open above.' : "Come back after you apply and we'll start tracking."}`
                  )}
                </div>
              )}
              {answer === 'changed' && `Got it. We'll use your feedback to flag this type of issue for future applicants.`}
              {answer === 'remind' && `Saved. We'll keep this ready for when you come back. Check-in scheduled.`}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
            {jobUrl && (
              <a
                href={jobUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: 'block', background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)', color: 'var(--blue)', fontFamily: 'var(--mono)', fontSize: '.7rem', borderRadius: 10, padding: '.8rem 1rem', textDecoration: 'none', textAlign: 'center' }}
              >
                ↗ Open job listing
              </a>
            )}
            <a
              href="/jobs"
              style={{ display: 'block', background: 'none', border: '1px solid var(--line)', color: 'var(--sub)', fontFamily: 'var(--mono)', fontSize: '.7rem', borderRadius: 10, padding: '.8rem 1rem', textDecoration: 'none', textAlign: 'center' }}
            >
              Browse more jobs →
            </a>
          </div>
        </>
      )}

    </div>
  )
}

export default function ApplyPage() {
  return (
    <div className="page-full">
      <Suspense fallback={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
          <div className="spinner" />
        </div>
      }>
        <ApplyContent />
      </Suspense>
    </div>
  )
}

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

const PERKS = [
  { icon: '📅', label: 'Day 7 check-in', sub: '"Did they respond?"' },
  { icon: '📅', label: 'Day 14 follow-up', sub: '"Got an interview?"' },
  { icon: '📅', label: 'Day 30 outcome', sub: '"What happened?"' },
  { icon: '👻', label: 'Ghost alert', sub: 'We\'ll tell you if they go silent' },
  { icon: '🎉', label: 'Outcome card', sub: 'Shareable image when you land it' },
]

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
  const [saving, setSaving] = useState(false)
  const [done, setDone]   = useState(false)

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

  async function handleApplied() {
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
    setDone(true)
    setTimeout(() => router.push('/tracker?new=1'), 900)
  }

  if (!co && !role) {
    return (
      <div style={{ textAlign: 'center', padding: '4rem 2rem', color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: '.75rem' }}>
        Missing application context. <a href="/jobs" style={{ color: 'var(--blue)' }}>Browse jobs →</a>
      </div>
    )
  }

  const riskColor = score
    ? score.risk_level === 'safe' ? 'var(--green)' : score.risk_level === 'danger' ? 'var(--red)' : 'var(--amber)'
    : 'var(--blue)'

  return (
    <div style={{ maxWidth: 460, margin: '0 auto', padding: '3rem 1.5rem 4rem' }}>

      {/* Eyebrow */}
      <div style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', textTransform: 'uppercase', letterSpacing: '.14em', color: 'var(--blue)', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 16, height: 1, background: 'var(--blue)', display: 'inline-block' }} />
        Application tracker
      </div>

      {/* Company + role header */}
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontFamily: 'var(--display)', fontSize: '1.7rem', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.03em', lineHeight: 1.15, marginBottom: '.35rem' }}>
          Did you apply to<br />
          <span style={{ color: riskColor }}>{co}</span>?
        </h1>
        {role && (
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.72rem', color: 'var(--sub)', marginTop: '.3rem' }}>
            {role}
          </div>
        )}
      </div>

      {/* Company score card — shown if we have data */}
      {score && (
        <div style={{
          background: 'var(--raised)',
          border: `1px solid ${riskColor}22`,
          borderRadius: 12,
          padding: '.85rem 1rem',
          marginBottom: '1.25rem',
          display: 'flex',
          alignItems: 'center',
          gap: '1rem',
        }}>
          <div style={{
            fontFamily: 'var(--display)',
            fontSize: '2rem',
            fontWeight: 800,
            color: riskColor,
            lineHeight: 1,
            flexShrink: 0,
          }}>
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
              {score.report_count > 0 && (
                <span style={{ fontFamily: 'var(--mono)', fontSize: '.5rem', color: 'var(--dim)', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 4, padding: '.1rem .35rem' }}>
                  {score.report_count} reports
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* If user goes to apply first, open job URL */}
      {jobUrl && (
        <a
          href={jobUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '.5rem',
            background: 'var(--raised)', border: '1px solid var(--line2)',
            color: 'var(--sub)', fontFamily: 'var(--mono)', fontSize: '.68rem',
            borderRadius: 9, padding: '.65rem 1rem', textDecoration: 'none',
            marginBottom: '1rem',
          }}
        >
          ↗ Open job listing
        </a>
      )}

      {/* Incentive strip */}
      <div style={{
        background: 'rgba(16,185,129,0.06)',
        border: '1px solid rgba(16,185,129,0.18)',
        borderRadius: 12,
        padding: '1rem 1.1rem',
        marginBottom: '1.25rem',
      }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', textTransform: 'uppercase', letterSpacing: '.12em', color: 'var(--green)', fontWeight: 700, marginBottom: '.75rem' }}>
          When you track this application
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.55rem' }}>
          {PERKS.map(p => (
            <div key={p.label} style={{ display: 'flex', alignItems: 'flex-start', gap: '.65rem' }}>
              <span style={{ fontSize: '.9rem', flexShrink: 0 }}>{p.icon}</span>
              <div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'rgba(52,211,153,0.9)', fontWeight: 600 }}>{p.label}</div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'rgba(52,211,153,0.55)' }}>{p.sub}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Primary CTA */}
      {done ? (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '.5rem',
          background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)',
          borderRadius: 12, padding: '1.25rem', textAlign: 'center',
        }}>
          <div style={{ fontSize: '1.5rem' }}>✅</div>
          <div style={{ fontFamily: 'var(--display)', fontSize: '.9rem', fontWeight: 700, color: 'var(--green)' }}>Application tracked!</div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--sub)' }}>Taking you to your tracker…</div>
        </div>
      ) : (
        <>
          {!isLoggedIn && (
            <div style={{ background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 9, padding: '.65rem .9rem', marginBottom: '1rem', fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--amber)', lineHeight: 1.65 }}>
              <strong>Sign in</strong> to sync reminders across all your devices.{' '}
              <a href={`/login?return=${encodeURIComponent(`/apply?co=${encodeURIComponent(co)}&role=${encodeURIComponent(role)}&jid=${jid}&jobUrl=${encodeURIComponent(jobUrl)}`)}`} style={{ color: 'var(--blue)', textDecoration: 'none' }}>
                Sign in →
              </a>
            </div>
          )}

          <button
            onClick={handleApplied}
            disabled={saving}
            style={{
              width: '100%',
              background: 'linear-gradient(135deg, rgba(16,185,129,0.2) 0%, rgba(16,185,129,0.1) 100%)',
              border: '1.5px solid rgba(16,185,129,0.5)',
              color: 'var(--green)',
              fontFamily: 'var(--display)',
              fontWeight: 800,
              fontSize: '1rem',
              borderRadius: 12,
              padding: '1rem 1.5rem',
              cursor: saving ? 'not-allowed' : 'pointer',
              opacity: saving ? 0.7 : 1,
              letterSpacing: '-.01em',
              transition: 'all .2s',
              marginBottom: '.65rem',
              boxShadow: '0 0 30px rgba(16,185,129,0.12)',
            }}
          >
            {saving ? 'Saving…' : `✅ Yes, I applied to ${co}`}
          </button>

          <button
            onClick={() => router.push('/jobs')}
            style={{
              width: '100%',
              background: 'none',
              border: 'none',
              color: 'var(--muted)',
              fontFamily: 'var(--mono)',
              fontSize: '.62rem',
              cursor: 'pointer',
              padding: '.5rem',
              textAlign: 'center',
            }}
          >
            Skip — not yet
          </button>
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

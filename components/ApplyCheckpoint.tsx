'use client'

import { useState } from 'react'
import { aiHeaders } from '@/lib/aiHeaders'

interface ApplyCheckpointProps {
  job: { id: string; title: string; company: string }
  optimized?: boolean
  onClose: () => void
}

type Step = 'main' | 'not_yet' | 'declined' | 'confirmed'

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

export default function ApplyCheckpoint({ job, optimized, onClose }: ApplyCheckpointProps) {
  const [step, setStep] = useState<Step>('main')
  const [loading, setLoading] = useState(false)

  async function handleApplied() {
    setLoading(true)
    try {
      const headers = await aiHeaders()
      await fetch('/api/user-sync', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          action: 'create_application',
          company: job.company,
          role: job.title,
          job_id: job.id,
          resume_optimized: optimized || false,
        }),
      })
    } catch {
      // Non-fatal — still show confirmed step
    }

    try {
      const key = 'seen_tracked_apps'
      const existing: Array<{ company: string; role: string; job_id: string; applied_at: string }> =
        JSON.parse(localStorage.getItem(key) || '[]')
      existing.push({
        company: job.company,
        role: job.title,
        job_id: job.id,
        applied_at: new Date().toISOString(),
      })
      localStorage.setItem(key, JSON.stringify(existing))
    } catch {
      // localStorage unavailable — ignore
    }

    setLoading(false)
    setStep('confirmed')
  }

  // ── Styles ─────────────────────────────────────────────────────────────────

  const backdropStyle: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,.65)',
    backdropFilter: 'blur(4px)',
    WebkitBackdropFilter: 'blur(4px)',
    zIndex: 9900,
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'center',
  }

  const sheetStyle: React.CSSProperties = {
    width: '100%',
    maxWidth: 480,
    background: 'var(--card)',
    borderRadius: '20px 20px 0 0',
    border: '1px solid var(--line2)',
    borderBottom: 'none',
    padding: '0 0 env(safe-area-inset-bottom, 16px)',
    animation: 'fadeUp .25s ease both',
    position: 'relative',
  }

  const handleStyle: React.CSSProperties = {
    width: 40,
    height: 4,
    borderRadius: 2,
    background: 'var(--line2)',
    margin: '12px auto 0',
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
    fontSize: 22,
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
    fontSize: 48,
    fontWeight: 800,
    color: 'var(--green)',
    lineHeight: 1,
    marginBottom: 10,
  }

  const statsRowStyle: React.CSSProperties = {
    display: 'flex',
    gap: 12,
    marginTop: 20,
    marginBottom: 14,
  }

  const statBoxStyle: React.CSSProperties = {
    flex: 1,
    background: 'rgba(255,255,255,.04)',
    border: '1px solid var(--line)',
    borderRadius: 10,
    padding: '12px 14px',
  }

  const statLabelStyle: React.CSSProperties = {
    fontFamily: 'var(--mono)',
    fontSize: 11,
    color: 'var(--dim)',
    marginBottom: 4,
  }

  const statValueStyle: React.CSSProperties = {
    fontFamily: 'var(--mono)',
    fontSize: 13,
    color: 'var(--white)',
    fontWeight: 600,
  }

  const ghostRiskStyle: React.CSSProperties = {
    fontFamily: 'var(--mono)',
    fontSize: 12,
    color: 'var(--dim)',
    marginBottom: 22,
    padding: '10px 14px',
    background: 'rgba(255,255,255,.03)',
    border: '1px solid var(--line)',
    borderRadius: 9,
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

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div
      style={backdropStyle}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={sheetStyle}>
        <div style={handleStyle} />

        {/* ── MAIN ── */}
        {step === 'main' && (
          <div style={innerStyle}>
            <button style={closeBtnStyle} onClick={onClose} aria-label="Close">×</button>

            <div style={headingStyle}>Did you apply?</div>
            <div style={subtitleStyle}>Answer once so Seen can start your response timeline.</div>
            <div style={jobLineStyle}>{job.company} · {job.title}</div>

            <button
              style={primaryBtnStyle}
              onClick={handleApplied}
              disabled={loading}
            >
              {loading ? 'Saving…' : '✓ Yes, I applied'}
            </button>

            <button
              style={secondaryBtnStyle}
              onClick={() => setStep('not_yet')}
            >
              Not yet
            </button>

            <button
              style={ghostBtnStyle}
              onClick={() => setStep('declined')}
            >
              I changed my mind
            </button>
          </div>
        )}

        {/* ── NOT YET ── */}
        {step === 'not_yet' && (
          <div style={innerStyle}>
            <button style={backBtnStyle} onClick={() => setStep('main')}>
              ← back
            </button>

            <div style={headingStyle}>What's holding you back?</div>

            <div style={{ marginTop: 18 }}>
              {NOT_YET_REASONS.map(reason => (
                <button
                  key={reason}
                  style={reasonBtnStyle}
                  onClick={onClose}
                >
                  {reason}
                </button>
              ))}
            </div>
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
                  onClick={onClose}
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

            <div style={{
              fontFamily: 'var(--mono)',
              fontSize: 14,
              color: 'var(--sub)',
              lineHeight: 1.6,
              marginBottom: 4,
            }}>
              We'll tell you when {job.company} usually responds — and when silence becomes a signal.
            </div>

            <div style={statsRowStyle}>
              <div style={statBoxStyle}>
                <div style={statLabelStyle}>Expected response</div>
                <div style={statValueStyle}>7–14 days</div>
              </div>
              <div style={statBoxStyle}>
                <div style={statLabelStyle}>Next check-in</div>
                <div style={statValueStyle}>in 3 days</div>
              </div>
            </div>

            <div style={ghostRiskStyle}>
              Ghost risk if no response by day 21: <span style={{ color: 'var(--white)' }}>Moderate</span>
            </div>

            <button style={closeFullBtnStyle} onClick={onClose}>
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

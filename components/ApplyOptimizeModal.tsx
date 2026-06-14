'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth'
import { aiHeaders } from '@/lib/aiHeaders'
import { ResumeStore } from '@/lib/stores/ResumeStore'
import type { Job } from '@/lib/types'

interface OptimizeBullet {
  original: string
  optimized: string
  addresses: string
}

interface OptimizeResult {
  job_priorities: string[]
  optimized_bullets: OptimizeBullet[]
  keywords_added: string[]
}

type Step =
  | 'loading-resume'
  | 'not-logged-in'
  | 'no-resume'
  | 'choose'
  | 'optimizing'
  | 'review'
  | 'sending'
  | 'done'

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 9000,
  background: 'rgba(0,0,0,.8)', backdropFilter: 'blur(6px)',
  display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
}

const sheet: React.CSSProperties = {
  width: '100%', maxWidth: 520,
  background: 'var(--surface)',
  border: '1px solid rgba(99,102,241,.22)',
  borderRadius: '16px 16px 0 0',
  overflow: 'hidden',
  boxShadow: '0 -40px 120px rgba(0,0,0,.7), 0 0 80px rgba(99,102,241,.15)',
  maxHeight: '92dvh',
  overflowY: 'auto',
}

const sheetHdr: React.CSSProperties = {
  padding: '.85rem 1.1rem',
  borderBottom: '1px solid var(--line)',
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 1,
}

const btnClose: React.CSSProperties = {
  background: 'none', border: 'none', color: 'var(--dim)',
  cursor: 'pointer', fontSize: '1rem', padding: '.2rem .3rem', lineHeight: 1,
}

const btnPrimary: React.CSSProperties = {
  width: '100%', padding: '.8rem 1rem',
  background: 'linear-gradient(135deg,#3b82f6 0%,#8b5cf6 100%)',
  color: '#fff', border: 'none', borderRadius: 10,
  fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.88rem',
  cursor: 'pointer', boxShadow: '0 0 20px rgba(59,130,246,.3)',
}

const btnGhost: React.CSSProperties = {
  width: '100%', padding: '.65rem 1rem',
  background: 'none', border: '1px solid var(--line2)', color: 'var(--muted)',
  borderRadius: 10, fontFamily: 'var(--mono)', fontSize: '.7rem',
  cursor: 'pointer',
}

const btnGreen: React.CSSProperties = {
  width: '100%', padding: '.8rem 1rem',
  background: 'linear-gradient(135deg,rgba(16,185,129,.25),rgba(16,185,129,.12))',
  color: 'var(--green)', border: '1.5px solid rgba(16,185,129,.45)',
  borderRadius: 10, fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.88rem',
  cursor: 'pointer',
}

function LoadingDots() {
  return (
    <div style={{ display: 'flex', gap: 5, justifyContent: 'center', alignItems: 'center', padding: '2.5rem 0' }}>
      {[0, 1, 2].map(i => (
        <div
          key={i}
          style={{
            width: 8, height: 8, borderRadius: '50%',
            background: 'var(--blue)',
            animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite`,
          }}
        />
      ))}
    </div>
  )
}

export default function ApplyOptimizeModal({
  job,
  onClose,
  onApplied,
}: {
  job: Job
  onClose: () => void
  onApplied: () => void
}) {
  const router = useRouter()
  const { isLoggedIn, user, profile } = useAuth()
  const [step, setStep] = useState<Step>('loading-resume')
  const [resumeText, setResumeText] = useState('')
  const [result, setResult] = useState<OptimizeResult | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isLoggedIn) { setStep('not-logged-in'); return }
    ResumeStore.load(user?.id, isLoggedIn).then(data => {
      if (data?.text && data.text.length > 50) {
        setResumeText(data.text)
        // Skip the choose step — user already picked "Apply & Optimize"
        runOptimize(data.text)
      } else {
        setStep('no-resume')
      }
    })
  }, [isLoggedIn, user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function runOptimize(resumeOverride?: string) {
    const text = resumeOverride ?? resumeText
    setStep('optimizing')
    setError('')
    try {
      const headers = await aiHeaders()
      const r = await fetch('/api/resume', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          tool: 'optimize',
          job: job.title,
          company: job.company,
          resume: text,
          jobDescription: job.description || '',
        }),
      })
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        throw new Error(e.error || `Error ${r.status}`)
      }
      const data = await r.json()
      setResult(data)
      setStep('review')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Optimization failed — try again')
      setStep('choose')
    }
  }

  async function approveAndSend() {
    setStep('sending')
    const email = user?.email || profile?.email || ''
    const bullets = result?.optimized_bullets || []
    const kwds = result?.keywords_added || []

    // Build a rich text summary with actual bullet rewrites for the email
    const bulletLines = bullets.map((b, i) =>
      `${i + 1}. BEFORE: ${b.original}\n   AFTER: ${b.optimized}\n   (${b.addresses})`
    ).join('\n\n')
    const summary = [
      `${bullets.length} bullet${bullets.length !== 1 ? 's' : ''} rewritten for ${job.title} at ${job.company}.`,
      kwds.length > 0 ? `Keywords added: ${kwds.join(', ')}.` : '',
      bullets.length > 0 ? `\n\nYour optimized bullets:\n\n${bulletLines}` : '',
    ].filter(Boolean).join(' ')

    try {
      const headers = await aiHeaders()
      await fetch('/api/resume', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          action: 'email_analysis',
          email,
          co: job.company,
          role: job.title,
          jid: job.id,
          jobUrl: job.apply_url,
          summary,
          matchScore: null,
        }),
      })
    } catch (_) {
      // email is best-effort, never block the flow
    }
    setStep('done')
  }

  function applyWithoutOptimize() {
    if (job.apply_url) window.open(job.apply_url, '_blank', 'noopener,noreferrer')
    onApplied()
    onClose()
  }

  const title = step === 'done'
    ? '🎉 You\'re ready to apply'
    : step === 'review'
    ? 'Review your optimized resume'
    : step === 'optimizing' || step === 'sending'
    ? step === 'optimizing' ? 'Optimizing your resume…' : 'Sending to your email…'
    : 'Apply & Optimize'

  return (
    <div style={overlay} onClick={onClose}>
      <div style={sheet} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={sheetHdr}>
          <div>
            <div style={{ fontFamily: 'var(--display)', fontSize: '.88rem', fontWeight: 700, color: 'var(--white)' }}>
              {title}
            </div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.56rem', color: 'var(--muted)', marginTop: '.1rem' }}>
              {job.title} · {job.company}
            </div>
          </div>
          <button style={btnClose} onClick={onClose}>✕</button>
        </div>

        <div style={{ padding: '1.1rem' }}>

          {/* ── loading-resume ── */}
          {step === 'loading-resume' && <LoadingDots />}

          {/* ── not-logged-in ── */}
          {step === 'not-logged-in' && (
            <>
              <div style={{ textAlign: 'center', padding: '.5rem 0 1.25rem' }}>
                <div style={{ fontSize: '2rem', marginBottom: '.75rem' }}>👋</div>
                <div style={{ fontFamily: 'var(--display)', fontSize: '1rem', fontWeight: 700, color: 'var(--white)', marginBottom: '.35rem' }}>Sign in to apply &amp; track</div>
                <div style={{ fontSize: '.82rem', color: 'var(--sub)', lineHeight: 1.7, marginBottom: '1.25rem' }}>
                  Track responses, get ghost alerts, and receive day-7/14/30 check-ins.
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
                <button style={btnPrimary} onClick={() => { onClose(); router.push('/login') }}>Sign in to apply →</button>
                {job.apply_url && (
                  <a
                    href={job.apply_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ display: 'block', textAlign: 'center', ...btnGhost, textDecoration: 'none' } as React.CSSProperties}
                    onClick={onClose}
                  >
                    Continue as guest (not tracked)
                  </a>
                )}
              </div>
            </>
          )}

          {/* ── no-resume ── */}
          {step === 'no-resume' && (
            <>
              <div style={{ textAlign: 'center', padding: '.5rem 0 1rem' }}>
                <div style={{ fontSize: '2rem', marginBottom: '.75rem' }}>📄</div>
                <div style={{ fontFamily: 'var(--display)', fontSize: '.95rem', fontWeight: 700, color: 'var(--white)', marginBottom: '.35rem' }}>Upload your resume first</div>
                <div style={{ fontSize: '.8rem', color: 'var(--sub)', lineHeight: 1.7, marginBottom: '1.25rem' }}>
                  Seen needs your resume to rewrite bullets for this specific role.
                  Takes 30 seconds — upload once, optimized for every job.
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
                <button
                  style={btnPrimary}
                  onClick={() => {
                    onClose()
                    router.push(`/resume?company=${encodeURIComponent(job.company)}&role=${encodeURIComponent(job.title)}`)
                  }}
                >
                  Upload resume + optimize →
                </button>
                <button style={btnGhost} onClick={applyWithoutOptimize}>Apply without optimizing</button>
              </div>
            </>
          )}

          {/* ── choose ── */}
          {step === 'choose' && (
            <>
              {/* Why optimize strip */}
              <div style={{ background: 'rgba(99,102,241,.07)', border: '1px solid rgba(99,102,241,.18)', borderRadius: 10, padding: '.8rem .95rem', marginBottom: '1rem' }}>
                <div style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', textTransform: 'uppercase', letterSpacing: '.1em', color: '#818cf8', fontWeight: 700, marginBottom: '.45rem' }}>When you optimize first</div>
                {[
                  '🎯 AI rewrites your bullets to match this exact role',
                  '🔑 Adds the keywords their ATS is scanning for',
                  '📧 Your optimized resume sent to your email',
                  '📋 One-click back to update your tracker',
                ].map(t => (
                  <div key={t} style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'rgba(165,180,252,.85)', marginBottom: '.22rem' }}>{t}</div>
                ))}
              </div>

              {error && (
                <div style={{ background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)', borderRadius: 8, padding: '.6rem .85rem', marginBottom: '.75rem', fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'var(--red)' }}>
                  {error}
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
                <button style={btnPrimary} onClick={() => runOptimize()}>
                  🧠 Optimize &amp; Apply · 1 credit
                </button>
                <button style={btnGhost} onClick={applyWithoutOptimize}>
                  Apply without optimizing
                </button>
              </div>
            </>
          )}

          {/* ── optimizing ── */}
          {step === 'optimizing' && (
            <div style={{ textAlign: 'center', paddingBottom: '1rem' }}>
              <LoadingDots />
              <div style={{ fontFamily: 'var(--mono)', fontSize: '.7rem', color: 'var(--sub)', marginBottom: '.75rem' }}>
                Reading your resume and rewriting bullets for this role…
              </div>
              <button style={{ background: 'none', border: 'none', color: 'var(--dim)', fontFamily: 'var(--mono)', fontSize: '.62rem', cursor: 'pointer', textDecoration: 'underline' }} onClick={applyWithoutOptimize}>
                Skip — just apply directly
              </button>
            </div>
          )}

          {/* ── review ── */}
          {step === 'review' && result && (
            <>
              {/* Keywords added */}
              {result.keywords_added.length > 0 && (
                <div style={{ marginBottom: '1rem' }}>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--green)', marginBottom: '.45rem' }}>
                    Keywords added
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.3rem' }}>
                    {result.keywords_added.map(kw => (
                      <span key={kw} style={{ background: 'rgba(16,185,129,.1)', border: '1px solid rgba(16,185,129,.25)', color: 'var(--green)', borderRadius: 5, padding: '.18rem .55rem', fontFamily: 'var(--mono)', fontSize: '.62rem' }}>
                        +{kw}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Bullets */}
              <div style={{ marginBottom: '1.1rem' }}>
                <div style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--dim)', marginBottom: '.55rem' }}>
                  Proposed changes — {result.optimized_bullets.length} bullet{result.optimized_bullets.length !== 1 ? 's' : ''} rewritten
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '.85rem' }}>
                  {result.optimized_bullets.map((b, i) => (
                    <div key={i} style={{ background: 'var(--card)', border: '1px solid var(--line2)', borderRadius: 10, overflow: 'hidden' }}>
                      <div style={{ padding: '.6rem .8rem', borderBottom: '1px solid var(--line)' }}>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: '.48rem', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--dim)', marginBottom: '.3rem' }}>Before</div>
                        <div style={{ fontSize: '.72rem', color: 'var(--muted)', lineHeight: 1.55 }}>{b.original}</div>
                      </div>
                      <div style={{ padding: '.6rem .8rem' }}>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: '.48rem', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--green)', marginBottom: '.3rem' }}>After · {b.addresses}</div>
                        <div style={{ fontSize: '.72rem', color: 'var(--white)', lineHeight: 1.55, fontWeight: 500 }}>{b.optimized}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
                <button style={btnGreen} onClick={approveAndSend}>
                  ✓ Approve &amp; send to my email
                </button>
                <button style={btnGhost} onClick={() => setStep('choose')}>← Re-optimize</button>
              </div>
            </>
          )}

          {/* ── sending ── */}
          {step === 'sending' && (
            <div style={{ textAlign: 'center', paddingBottom: '1rem' }}>
              <LoadingDots />
              <div style={{ fontFamily: 'var(--mono)', fontSize: '.7rem', color: 'var(--sub)' }}>
                Sending your optimized resume to {user?.email || profile?.email || 'your email'}…
              </div>
            </div>
          )}

          {/* ── done ── */}
          {step === 'done' && (
            <>
              <div style={{ textAlign: 'center', padding: '.5rem 0 1.25rem' }}>
                <div style={{ fontSize: '2.5rem', marginBottom: '.75rem' }}>✉️</div>
                <div style={{ fontFamily: 'var(--display)', fontSize: '1rem', fontWeight: 700, color: 'var(--white)', marginBottom: '.4rem' }}>
                  Check your email
                </div>
                <div style={{ fontSize: '.78rem', color: 'var(--sub)', lineHeight: 1.7 }}>
                  Your optimized resume is on its way to{' '}
                  <span style={{ color: 'var(--white)', fontWeight: 600 }}>{user?.email || profile?.email || 'your inbox'}</span>.
                  Open it, then apply with your new bullets.
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '.6rem' }}>
                {job.apply_url ? (
                  <a
                    href={job.apply_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ display: 'block', textDecoration: 'none' }}
                    onClick={() => { onApplied(); onClose() }}
                  >
                    <div style={{ ...btnPrimary, textAlign: 'center' }}>
                      Apply Online →
                    </div>
                  </a>
                ) : (
                  <button style={btnPrimary} onClick={() => { onApplied(); onClose() }}>
                    I Applied — Start Tracking →
                  </button>
                )}

                {job.apply_url && (
                  <button
                    style={btnGreen}
                    onClick={() => { onApplied(); onClose() }}
                  >
                    I Applied — Start Tracking →
                  </button>
                )}

                <button style={btnGhost} onClick={onClose}>
                  Close — I'll apply later
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

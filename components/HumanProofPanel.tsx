'use client'

// HumanProofPanel — the HumanProof UI. Mobile-first.
//
// Renders AFTER SeenFitPanel on /jobs/[id]. HumanProof removes generic AI-style résumé
// writing and adds truthful, specific, human work context. All scoring/rewriting is
// computed server-side by api/optimizer.js (action: 'humanize') — NO external AI.
//
// FRAMING: this copy ONLY talks about removing generic AI tone and adding truthful work
// context so the application reads real and is interview-ready. It NEVER claims to
// bypass, beat, or trick AI detectors, ATS, or employers.

import { useState, useCallback } from 'react'
import { ResumeStore } from '@/lib/stores/ResumeStore'
import { aiHeaders } from '@/lib/aiHeaders'
import { useAuth } from '@/lib/auth'
import UpgradeModal from '@/components/UpgradeModal'
import type { Job } from '@/lib/types'

interface Contribution { factor: string; weight: number; raw: number; points: number; reason: string }
interface Flag { flagType: string; severity: 'low' | 'medium' | 'high'; originalPhrase: string; explanation: string; suggestedFix: string | null }
interface SafeBullet { text: string; evidenceUsed: string[]; replaced: string | null }
interface ConfirmItem { text: string; reason: string; placeholder: string }
interface InterviewWarning { phrase: string; warning: string }
interface ChangeMade { from: string; to: string; reason: string }

interface HumanProofOutput {
  run_id?: string | null
  engine_version: string
  humanproof_score: number
  ai_slop_risk: 'low' | 'medium' | 'high'
  before_score: number
  after_score: number
  flags: Flag[]
  humanized_text: string
  safe_bullets: SafeBullet[]
  confirm_before_using: ConfirmItem[]
  interview_risk_warnings: InterviewWarning[]
  changes_made: ChangeMade[]
  explanation: { summary: string; contributions: Contribution[]; notes: string[] }
}

type State = 'idle' | 'no_resume' | 'loading' | 'done' | 'error' | 'disabled' | 'locked'

const mono = 'var(--mono)'

function scoreColor(s: number): string {
  return s >= 70 ? 'var(--green)' : s >= 45 ? 'var(--amber)' : 'var(--red)'
}
function riskColor(r: string): string {
  return r === 'low' ? 'var(--green)' : r === 'medium' ? 'var(--amber)' : 'var(--red)'
}

export default function HumanProofPanel({ job }: { job: Job }) {
  const { isLoggedIn } = useAuth()
  const { user } = useAuth() as unknown as { user: { id?: string } | null }
  const [state, setState] = useState<State>('idle')
  const [out, setOut] = useState<HumanProofOutput | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [rated, setRated] = useState<number | null>(null)
  const [showUpgrade, setShowUpgrade] = useState(false)

  const sendFeedback = useCallback(async (action: string, runId?: string | null, rating?: number) => {
    try {
      await fetch('/api/optimizer', {
        method: 'POST',
        headers: await aiHeaders(),
        body: JSON.stringify({ action: 'humanize_feedback', run_id: runId, user_action: action, rating }),
      })
    } catch { /* non-fatal */ }
  }, [])

  const copy = useCallback(async (text: string, key: string, runId?: string | null, action = 'copy') => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      setTimeout(() => setCopied(null), 1600)
      sendFeedback(action, runId)
    } catch { /* ignore */ }
  }, [sendFeedback])

  const run = useCallback(async () => {
    setState('loading')
    const resume = await ResumeStore.load(user?.id, isLoggedIn)
    if (!resume?.text || resume.text.trim().length < 40) {
      setState('no_resume')
      return
    }
    try {
      const res = await fetch('/api/optimizer', {
        method: 'POST',
        headers: await aiHeaders(),
        body: JSON.stringify({
          action: 'humanize',
          text: resume.text,
          mode: 'resume',
          jobId: job.id,
          jobTitle: job.title,
          company: job.company,
          jobDescription: job.description || '',
          resumeText: resume.text,
        }),
      })
      if (res.status === 403) { setState('disabled'); return }
      const data = await res.json()
      if ((res.status === 402 || data.locked) && (data.pro_required || data.credits_required)) {
        setState('locked')
        return
      }
      if (!res.ok || data.error) { setState('error'); return }
      setOut(data)
      setState('done')
    } catch {
      setState('error')
    }
  }, [job, isLoggedIn, user])

  // ── Trigger (idle) — the positioning line ──
  if (state === 'idle') {
    return (
      <div style={{ marginTop: '1.5rem' }}>
        <div style={{ background: 'var(--gdim)', border: '1px solid var(--line)', borderRadius: 12, padding: '1.1rem 1.1rem 1.25rem' }}>
          <div style={{ fontFamily: 'var(--display)', fontWeight: 800, color: 'var(--white)', fontSize: '.95rem', marginBottom: '.3rem' }}>HumanProof</div>
          <p style={{ fontFamily: mono, fontSize: '.65rem', color: 'var(--sub)', lineHeight: 1.6, marginBottom: '.9rem' }}>
            Your application is optimized. Now make it sound real — remove generic AI tone and add truthful, specific work context so it&apos;s interview-ready.
          </p>
          <button
            onClick={run}
            style={{ width: '100%', background: 'linear-gradient(135deg,#10b981 0%,#3b82f6 100%)', color: '#fff', border: 'none', borderRadius: 10, padding: '.85rem 1rem', fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.9rem', cursor: 'pointer' }}
          >
            Humanize this application
          </button>
          <div style={{ fontFamily: mono, fontSize: '.55rem', color: 'var(--muted)', textAlign: 'center', marginTop: '.45rem' }}>
            Deterministic — grounded in your real résumé, nothing invented.
          </div>
        </div>
      </div>
    )
  }

  if (state === 'loading') {
    return (
      <div style={{ marginTop: '1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '.6rem', padding: '1.5rem', background: 'var(--gdim)', border: '1px solid var(--line)', borderRadius: 12 }}>
        <div className="spinner" /><span style={{ fontFamily: mono, fontSize: '.7rem', color: 'var(--sub)' }}>Making it sound real…</span>
      </div>
    )
  }

  if (state === 'no_resume') {
    return (
      <div style={{ marginTop: '1.5rem', background: 'var(--card)', border: '1px solid var(--line2)', borderRadius: 12, padding: '1.25rem', textAlign: 'center' }}>
        <div style={{ fontFamily: 'var(--display)', fontWeight: 700, color: 'var(--white)', marginBottom: '.4rem' }}>Add your résumé first</div>
        <p style={{ fontFamily: mono, fontSize: '.65rem', color: 'var(--sub)', marginBottom: '1rem', lineHeight: 1.6 }}>HumanProof rewrites your real résumé into plainer, more specific language. Add it once to use it on every application.</p>
        <a href={`/resume?company=${encodeURIComponent(job.company)}&role=${encodeURIComponent(job.title)}`} style={{ display: 'inline-block', background: 'var(--green)', color: 'var(--ink)', borderRadius: 8, padding: '.6rem 1.25rem', fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.82rem', textDecoration: 'none' }}>Add résumé →</a>
      </div>
    )
  }

  if (state === 'disabled') {
    return (
      <div style={{ marginTop: '1.5rem', fontFamily: mono, fontSize: '.7rem', color: 'var(--muted)', textAlign: 'center', padding: '1rem' }}>HumanProof is temporarily unavailable.</div>
    )
  }

  // ── Locked CTA (unpaid + HUMANPROOF_PAID_ONLY on) ──
  if (state === 'locked') {
    return (
      <div style={{ marginTop: '1.5rem' }}>
        <div style={{ background: 'var(--gdim)', border: '1px solid var(--line2)', borderRadius: 12, padding: '1.4rem', textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
          <div style={{ fontSize: '1.5rem', marginBottom: '.5rem' }}>🔒</div>
          <div style={{ fontFamily: 'var(--display)', fontWeight: 800, color: 'var(--white)', fontSize: '1rem', marginBottom: '.5rem' }}>
            Your application is optimized. Now make it sound real.
          </div>
          <p style={{ fontFamily: mono, fontSize: '.66rem', color: 'var(--sub)', lineHeight: 1.65, marginBottom: '1.1rem', maxWidth: 420, marginLeft: 'auto', marginRight: 'auto' }}>
            Unlock HumanProof to remove generic AI tone, add truthful work context, and make your application interview-ready.
          </p>
          <button
            onClick={() => setShowUpgrade(true)}
            style={{ background: 'linear-gradient(135deg,#10b981 0%,#3b82f6 100%)', color: '#fff', border: 'none', borderRadius: 10, padding: '.75rem 1.5rem', fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.85rem', cursor: 'pointer' }}
          >
            Unlock HumanProof
          </button>
        </div>
        {showUpgrade && <UpgradeModal reason="pro" featureName="HumanProof" onClose={() => setShowUpgrade(false)} />}
      </div>
    )
  }

  if (state === 'error') {
    return (
      <div style={{ marginTop: '1.5rem', textAlign: 'center', padding: '1rem' }}>
        <div style={{ fontFamily: mono, fontSize: '.7rem', color: 'var(--muted)', marginBottom: '.6rem' }}>Couldn&apos;t humanize this. Try again.</div>
        <button onClick={run} style={{ background: 'var(--raised)', border: '1px solid var(--line2)', color: 'var(--sub)', borderRadius: 7, padding: '.5rem 1rem', fontFamily: mono, fontSize: '.65rem', cursor: 'pointer' }}>Retry</button>
      </div>
    )
  }

  if (!out) return null

  const sortedContribs = [...out.explanation.contributions].sort((a, b) => b.points - a.points)
  const delta = out.after_score - out.before_score

  return (
    <div style={{ marginTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Header — HumanProof Score + AI Slop Risk */}
      <div style={{ background: 'var(--gdim)', border: '1px solid var(--line)', borderRadius: 12, padding: '1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ position: 'relative', flexShrink: 0, width: 64, height: 64, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', border: `3px solid ${scoreColor(out.humanproof_score)}` }}>
            <span style={{ fontFamily: 'var(--display)', fontWeight: 800, fontSize: '1.35rem', color: scoreColor(out.humanproof_score) }}>{out.humanproof_score}</span>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--display)', fontWeight: 800, color: 'var(--white)', fontSize: '1rem' }}>HumanProof Score</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', marginTop: '.3rem', flexWrap: 'wrap' }}>
              <span style={{ fontFamily: mono, fontSize: '.55rem', textTransform: 'uppercase', letterSpacing: '.05em', color: riskColor(out.ai_slop_risk), border: `1px solid ${riskColor(out.ai_slop_risk)}`, borderRadius: 5, padding: '.12rem .45rem' }}>
                {out.ai_slop_risk} AI-slop risk
              </span>
              <span style={{ fontFamily: mono, fontSize: '.55rem', color: 'var(--dim)' }}>v{out.engine_version}</span>
            </div>
          </div>
        </div>
        {/* Before → After */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', marginTop: '.95rem', fontFamily: mono, fontSize: '.62rem' }}>
          <span style={{ color: 'var(--muted)' }}>Before <strong style={{ color: scoreColor(out.before_score) }}>{out.before_score}</strong></span>
          <span style={{ color: 'var(--dim)' }}>→</span>
          <span style={{ color: 'var(--muted)' }}>After <strong style={{ color: scoreColor(out.after_score) }}>{out.after_score}</strong></span>
          {delta !== 0 && <span style={{ color: delta > 0 ? 'var(--green)' : 'var(--red)' }}>({delta > 0 ? '+' : ''}{delta})</span>}
        </div>
        <p style={{ fontFamily: mono, fontSize: '.65rem', color: 'var(--sub)', lineHeight: 1.6, marginTop: '.85rem' }}>{out.explanation.summary}</p>
      </div>

      {/* Why your score is this — self-explaining */}
      <Section title="WHY YOUR SCORE IS THIS">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.6rem' }}>
          {sortedContribs.map((c) => (
            <div key={c.factor}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '.25rem' }}>
                <span style={{ fontFamily: mono, fontSize: '.62rem', color: 'var(--sub)' }}>{labelOf(c.factor)}</span>
                <span style={{ fontFamily: mono, fontSize: '.62rem', color: 'var(--white)' }}>+{c.points} pts</span>
              </div>
              <div style={{ height: 5, background: 'var(--raised)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ width: `${Math.min(100, c.raw * 100)}%`, height: '100%', background: scoreColor(c.raw * 100) }} />
              </div>
              <div style={{ fontFamily: mono, fontSize: '.55rem', color: 'var(--muted)', marginTop: '.25rem', lineHeight: 1.5 }}>{c.reason}</div>
            </div>
          ))}
        </div>
      </Section>

      {/* What changed — before/after diff of edits */}
      {out.changes_made.length > 0 && (
        <Section title="WHAT CHANGED">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
            {out.changes_made.slice(0, 14).map((c, i) => (
              <div key={i} style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 7, padding: '.6rem .8rem' }}>
                <div style={{ fontSize: '.72rem', lineHeight: 1.5 }}>
                  <span style={{ color: 'var(--red)', textDecoration: 'line-through' }}>{c.from}</span>
                  <span style={{ color: 'var(--dim)' }}> → </span>
                  <span style={{ color: 'var(--green)' }}>{c.to}</span>
                </div>
                <div style={{ fontFamily: mono, fontSize: '.55rem', color: 'var(--muted)', marginTop: '.25rem' }}>{c.reason}</div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Safe humanized bullets */}
      {out.safe_bullets.length > 0 && (
        <Section title="SAFE HUMANIZED BULLETS">
          <div style={{ fontFamily: mono, fontSize: '.58rem', color: 'var(--green)', marginBottom: '.6rem' }}>✓ Grounded in your résumé — no invented numbers, tools, or claims.</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.55rem' }}>
            {out.safe_bullets.map((b, i) => (
              <div key={i} style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 8, padding: '.7rem .85rem', display: 'flex', gap: '.6rem', alignItems: 'flex-start' }}>
                <span style={{ fontSize: '.78rem', color: 'var(--sub)', lineHeight: 1.6, flex: 1 }}>{b.text}</span>
                <button onClick={() => copy(b.text, `b${i}`, out.run_id)} style={{ background: 'none', border: '1px solid var(--line2)', borderRadius: 6, padding: '.25rem .5rem', fontFamily: mono, fontSize: '.55rem', color: copied === `b${i}` ? 'var(--green)' : 'var(--muted)', cursor: 'pointer', flexShrink: 0 }}>{copied === `b${i}` ? '✓' : 'copy'}</button>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Confirm before using */}
      {out.confirm_before_using.length > 0 && (
        <Section title="CONFIRM BEFORE USING">
          <div style={{ fontFamily: mono, fontSize: '.58rem', color: 'var(--amber)', marginBottom: '.6rem', lineHeight: 1.5 }}>⚠ These numbers/tools aren&apos;t in your résumé. Confirm a real one or leave it out — we won&apos;t invent it.</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.55rem' }}>
            {out.confirm_before_using.map((c, i) => (
              <div key={i} style={{ background: 'rgba(245,158,11,.06)', border: '1px solid rgba(245,158,11,.2)', borderRadius: 8, padding: '.7rem .85rem' }}>
                <div style={{ fontSize: '.76rem', color: 'var(--sub)', lineHeight: 1.6 }}>{c.text}</div>
                <div style={{ fontFamily: mono, fontSize: '.55rem', color: 'var(--muted)', marginTop: '.35rem' }}>{c.reason}</div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Interview defensibility warnings */}
      {out.interview_risk_warnings.length > 0 && (
        <Section title="INTERVIEW DEFENSIBILITY">
          <div style={{ fontFamily: mono, fontSize: '.58rem', color: 'var(--muted)', marginBottom: '.6rem', lineHeight: 1.5 }}>Make sure every line is easy to explain out loud in an interview.</div>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '.45rem' }}>
            {out.interview_risk_warnings.map((w, i) => (
              <li key={i} style={{ display: 'flex', gap: '.5rem', fontSize: '.72rem', color: 'var(--sub)', lineHeight: 1.5 }}>
                <span style={{ color: 'var(--amber)', flexShrink: 0 }}>⚠</span>{w.warning}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Full humanized version */}
      <Section title="HUMANIZED VERSION">
        <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 8, padding: '.85rem' }}>
          <pre style={{ fontSize: '.78rem', color: 'var(--sub)', lineHeight: 1.7, margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{out.humanized_text}</pre>
          <div style={{ display: 'flex', gap: '.5rem', marginTop: '.75rem', flexWrap: 'wrap' }}>
            <button onClick={() => copy(out.humanized_text, 'bullets', out.run_id, 'copy_bullets')} style={{ background: 'var(--green)', color: 'var(--ink)', border: 'none', borderRadius: 7, padding: '.45rem .9rem', fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.7rem', cursor: 'pointer' }}>{copied === 'bullets' ? '✓ Copied' : 'Copy Humanized Resume Bullets'}</button>
          </div>
        </div>
      </Section>

      {/* Actions — save + rate */}
      <div style={{ background: 'var(--gdim)', border: '1px solid var(--line)', borderRadius: 12, padding: '1.1rem' }}>
        <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <button onClick={() => { sendFeedback('save', out.run_id); setCopied('saved'); setTimeout(() => setCopied(null), 1600) }} style={{ background: 'var(--raised)', border: '1px solid var(--line2)', color: 'var(--sub)', borderRadius: 8, padding: '.55rem 1rem', fontFamily: mono, fontSize: '.65rem', cursor: 'pointer' }}>{copied === 'saved' ? '✓ Saved' : 'Save Version'}</button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '.35rem', marginLeft: 'auto' }}>
            <span style={{ fontFamily: mono, fontSize: '.55rem', color: 'var(--muted)' }}>Rate this pass</span>
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} onClick={() => { setRated(n); sendFeedback('rate', out.run_id, n) }} aria-label={`Rate ${n}`} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '.95rem', color: rated != null && n <= rated ? 'var(--amber)' : 'var(--line2)', padding: 0 }}>★</button>
            ))}
          </div>
        </div>
        {out.explanation.notes.length > 0 && (
          <ul style={{ listStyle: 'none', padding: 0, margin: '.85rem 0 0', display: 'flex', flexDirection: 'column', gap: '.35rem' }}>
            {out.explanation.notes.map((n, i) => (
              <li key={i} style={{ fontFamily: mono, fontSize: '.58rem', color: 'var(--muted)', lineHeight: 1.5 }}>• {n}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--gdim)', border: '1px solid var(--line)', borderRadius: 12, padding: '1.1rem' }}>
      <div style={{ fontFamily: mono, fontSize: '.55rem', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--dim)', marginBottom: '.75rem' }}>{title}</div>
      {children}
    </div>
  )
}

function labelOf(factor: string): string {
  return ({
    specificity: 'Specificity',
    natural_rhythm: 'Natural rhythm',
    evidence_grounding: 'Evidence grounding',
    buzzword_control: 'Buzzword control',
    voice_consistency: 'Voice consistency',
    interview_defensibility: 'Interview defensibility',
    role_believability: 'Role believability',
    formatting_naturalness: 'Formatting naturalness',
  } as Record<string, string>)[factor] || factor
}

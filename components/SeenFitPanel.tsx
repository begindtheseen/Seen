'use client'

// SeenFitPanel — the SeenFit Engine UI. Mobile-first.
//
// Renders the deterministic optimizer output for one job: SeenFit Score, "Why you
// match", missing keywords, safe résumé bullets, confirm-before-using suggestions, a
// ready-to-send application message, company hiring/process risk, and save/copy/apply
// actions. All scoring is computed server-side by api/optimizer.js (no external AI).

import { useState, useCallback } from 'react'
import { ResumeStore } from '@/lib/stores/ResumeStore'
import { aiHeaders } from '@/lib/aiHeaders'
import { useAuth } from '@/lib/auth'
import type { Job } from '@/lib/types'

interface Contribution { factor: string; weight: number; raw: number; points: number; reason: string }
interface RiskFlag { code: string; severity: 'low' | 'medium' | 'high'; message: string }
interface RequirementMatch { requirement: string; surface: string; importance: string; matched: boolean; via: string; evidence: string | null }
interface SafeBullet { text: string; evidenceUsed: string[]; template: string }
interface ConfirmItem { text: string; reason: string; placeholder: string }

interface OptimizerOutput {
  run_id?: string | null
  fit_score: number
  confidence: number
  confidence_label: 'low' | 'medium' | 'high'
  required_match: number
  preferred_match: number
  ats_coverage: number
  evidence_strength: number
  seniority_alignment: number
  company_process_score: number
  risk_flags: RiskFlag[]
  missing_keywords: string[]
  matched_requirements: RequirementMatch[]
  unsupported_requirements: RequirementMatch[]
  safe_bullets: SafeBullet[]
  confirm_before_using: ConfirmItem[]
  application_message: string
  explanation: { summary: string; contributions: Contribution[]; notes: string[] }
}

type State = 'idle' | 'no_resume' | 'loading' | 'done' | 'error' | 'disabled'

function scoreColor(s: number): string {
  return s >= 70 ? 'var(--green)' : s >= 45 ? 'var(--amber)' : 'var(--red)'
}

function pct(n: number): string {
  return `${Math.round((n || 0) * 100)}%`
}

const mono = 'var(--mono)'

export default function SeenFitPanel({ job }: { job: Job }) {
  const { isLoggedIn } = useAuth()
  const { user } = useAuth() as unknown as { user: { id?: string } | null }
  const [state, setState] = useState<State>('idle')
  const [out, setOut] = useState<OptimizerOutput | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  const sendFeedback = useCallback(async (action: string, runId?: string | null) => {
    try {
      await fetch('/api/optimizer', {
        method: 'POST',
        headers: await aiHeaders(),
        body: JSON.stringify({ action: 'feedback', run_id: runId, user_action: action }),
      })
    } catch { /* non-fatal */ }
  }, [])

  const copy = useCallback(async (text: string, key: string, runId?: string | null) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      setTimeout(() => setCopied(null), 1600)
      sendFeedback('copy', runId)
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
          action: 'optimize',
          resumeText: resume.text,
          jobId: job.id,
          jobTitle: job.title,
          company: job.company,
          jobDescription: job.description || '',
          jobLocation: job.location || '',
          remoteOk: /remote/i.test(job.location || ''),
        }),
      })
      if (res.status === 403) { setState('disabled'); return }
      const data = await res.json()
      if (!res.ok || data.error) { setState('error'); return }
      setOut(data)
      setState('done')
    } catch {
      setState('error')
    }
  }, [job, isLoggedIn, user])

  // ── Trigger button (idle) ──
  if (state === 'idle') {
    return (
      <div style={{ marginTop: '1.5rem' }}>
        <button
          onClick={run}
          style={{ width: '100%', background: 'linear-gradient(135deg,#3b82f6 0%,#8b5cf6 100%)', color: '#fff', border: 'none', borderRadius: 10, padding: '.85rem 1rem', fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.9rem', cursor: 'pointer' }}
        >
          ✨ Optimize for this job
        </button>
        <div style={{ fontFamily: mono, fontSize: '.55rem', color: 'var(--muted)', textAlign: 'center', marginTop: '.45rem' }}>
          Deterministic SeenFit Engine — no AI guesswork, your data stays grounded.
        </div>
      </div>
    )
  }

  if (state === 'loading') {
    return (
      <div style={{ marginTop: '1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '.6rem', padding: '1.5rem', background: 'var(--gdim)', border: '1px solid var(--line)', borderRadius: 12 }}>
        <div className="spinner" /><span style={{ fontFamily: mono, fontSize: '.7rem', color: 'var(--sub)' }}>Scoring your fit…</span>
      </div>
    )
  }

  if (state === 'no_resume') {
    return (
      <div style={{ marginTop: '1.5rem', background: 'var(--card)', border: '1px solid var(--line2)', borderRadius: 12, padding: '1.25rem', textAlign: 'center' }}>
        <div style={{ fontFamily: 'var(--display)', fontWeight: 700, color: 'var(--white)', marginBottom: '.4rem' }}>Add your résumé first</div>
        <p style={{ fontFamily: mono, fontSize: '.65rem', color: 'var(--sub)', marginBottom: '1rem', lineHeight: 1.6 }}>SeenFit scores your résumé against this exact role. Upload it once and we&apos;ll optimize every application.</p>
        <a href={`/resume?company=${encodeURIComponent(job.company)}&role=${encodeURIComponent(job.title)}`} style={{ display: 'inline-block', background: 'var(--green)', color: 'var(--ink)', borderRadius: 8, padding: '.6rem 1.25rem', fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.82rem', textDecoration: 'none' }}>Add résumé →</a>
      </div>
    )
  }

  if (state === 'disabled') {
    return (
      <div style={{ marginTop: '1.5rem', fontFamily: mono, fontSize: '.7rem', color: 'var(--muted)', textAlign: 'center', padding: '1rem' }}>SeenFit optimization is temporarily unavailable.</div>
    )
  }

  if (state === 'error') {
    return (
      <div style={{ marginTop: '1.5rem', textAlign: 'center', padding: '1rem' }}>
        <div style={{ fontFamily: mono, fontSize: '.7rem', color: 'var(--muted)', marginBottom: '.6rem' }}>Couldn&apos;t run the optimization. Try again.</div>
        <button onClick={run} style={{ background: 'var(--raised)', border: '1px solid var(--line2)', color: 'var(--sub)', borderRadius: 7, padding: '.5rem 1rem', fontFamily: mono, fontSize: '.65rem', cursor: 'pointer' }}>Retry</button>
      </div>
    )
  }

  if (!out) return null

  const sortedContribs = [...out.explanation.contributions].sort((a, b) => b.points - a.points)

  return (
    <div style={{ marginTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* SeenFit Score header */}
      <div style={{ background: 'var(--gdim)', border: '1px solid var(--line)', borderRadius: 12, padding: '1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ position: 'relative', flexShrink: 0, width: 64, height: 64, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', border: `3px solid ${scoreColor(out.fit_score)}` }}>
            <span style={{ fontFamily: 'var(--display)', fontWeight: 800, fontSize: '1.35rem', color: scoreColor(out.fit_score) }}>{out.fit_score}</span>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--display)', fontWeight: 800, color: 'var(--white)', fontSize: '1rem' }}>SeenFit Score</div>
            <div style={{ fontFamily: mono, fontSize: '.6rem', color: 'var(--dim)', marginTop: '.2rem' }}>
              {out.confidence_label} confidence ({pct(out.confidence)}) · v{ (out as { engine_version?: string }).engine_version || 'seenfit-1.0.0' }
            </div>
          </div>
        </div>
        <p style={{ fontFamily: mono, fontSize: '.65rem', color: 'var(--sub)', lineHeight: 1.6, marginTop: '.85rem' }}>{out.explanation.summary}</p>
      </div>

      {/* Why your score is X — self-explaining contributions */}
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

      {/* Why you match */}
      {out.matched_requirements.length > 0 && (
        <Section title="WHY YOU MATCH">
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
            {out.matched_requirements.map((m, i) => (
              <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '.5rem', fontSize: '.78rem', color: 'var(--sub)', lineHeight: 1.5 }}>
                <span style={{ color: 'var(--green)', fontSize: '.6rem', marginTop: '.2rem', flexShrink: 0 }}>✓</span>
                <span><strong style={{ color: 'var(--white)' }}>{m.surface}</strong>{m.via === 'related' ? ' (transferable)' : ''}{m.evidence ? ` — ${m.evidence.slice(0, 90)}` : ''}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Missing keywords */}
      {out.missing_keywords.length > 0 && (
        <Section title="MISSING KEYWORDS">
          <div style={{ fontFamily: mono, fontSize: '.58rem', color: 'var(--muted)', marginBottom: '.6rem', lineHeight: 1.5 }}>Add the ones you genuinely have — ATS filters scan for these literally.</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.4rem' }}>
            {out.missing_keywords.map((k, i) => (
              <span key={i} style={{ background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)', color: 'var(--red)', borderRadius: 5, padding: '.2rem .55rem', fontFamily: mono, fontSize: '.62rem' }}>{k}</span>
            ))}
          </div>
        </Section>
      )}

      {/* Safe résumé bullets */}
      {out.safe_bullets.length > 0 && (
        <Section title="SAFE RÉSUMÉ BULLETS">
          <div style={{ fontFamily: mono, fontSize: '.58rem', color: 'var(--green)', marginBottom: '.6rem' }}>✓ Fully backed by your résumé — no invented claims.</div>
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
          <div style={{ fontFamily: mono, fontSize: '.58rem', color: 'var(--amber)', marginBottom: '.6rem', lineHeight: 1.5 }}>⚠ These need a real number/detail from you. We will not invent it.</div>
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

      {/* Application message */}
      <Section title="APPLICATION MESSAGE">
        <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 8, padding: '.85rem' }}>
          <p style={{ fontSize: '.78rem', color: 'var(--sub)', lineHeight: 1.7, margin: 0 }}>{out.application_message}</p>
          <div style={{ display: 'flex', gap: '.5rem', marginTop: '.75rem' }}>
            <button onClick={() => copy(out.application_message, 'msg', out.run_id)} style={{ background: 'var(--green)', color: 'var(--ink)', border: 'none', borderRadius: 7, padding: '.45rem .9rem', fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.7rem', cursor: 'pointer' }}>{copied === 'msg' ? '✓ Copied' : 'Copy message'}</button>
          </div>
        </div>
      </Section>

      {/* Company hiring / process risk */}
      <Section title="COMPANY HIRING RISK">
        <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', marginBottom: out.risk_flags.length ? '.7rem' : 0 }}>
          <span style={{ fontFamily: 'var(--display)', fontWeight: 800, fontSize: '1.1rem', color: scoreColor(out.company_process_score) }}>{Math.round(out.company_process_score)}<span style={{ fontSize: '.6rem', color: 'var(--muted)' }}>/100</span></span>
          <span style={{ fontFamily: mono, fontSize: '.6rem', color: 'var(--muted)' }}>hiring-process score (real applicant outcomes)</span>
        </div>
        {out.risk_flags.length > 0 ? (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '.4rem' }}>
            {out.risk_flags.map((f, i) => (
              <li key={i} style={{ display: 'flex', gap: '.5rem', fontSize: '.72rem', color: f.severity === 'high' ? 'var(--red)' : f.severity === 'medium' ? 'var(--amber)' : 'var(--muted)', lineHeight: 1.5 }}>
                <span style={{ flexShrink: 0 }}>{f.severity === 'high' ? '✕' : '⚠'}</span>{f.message}
              </li>
            ))}
          </ul>
        ) : (
          <div style={{ fontFamily: mono, fontSize: '.62rem', color: 'var(--green)' }}>No risk flags — clean signals for this role.</div>
        )}
      </Section>

      {/* Actions */}
      <div style={{ display: 'flex', gap: '.6rem' }}>
        {job.apply_url && (
          <a href={job.apply_url} target="_blank" rel="noopener noreferrer" onClick={() => sendFeedback('apply', out.run_id)} style={{ flex: 1, textAlign: 'center', background: 'var(--green)', color: 'var(--ink)', borderRadius: 8, padding: '.65rem', fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.8rem', textDecoration: 'none' }}>Apply now →</a>
        )}
        <button onClick={() => sendFeedback('save', out.run_id)} style={{ background: 'var(--raised)', border: '1px solid var(--line2)', color: 'var(--sub)', borderRadius: 8, padding: '.65rem 1rem', fontFamily: mono, fontSize: '.65rem', cursor: 'pointer' }}>Saved ✓</button>
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
    required_match: 'Required skills',
    preferred_match: 'Preferred skills',
    evidence_strength: 'Evidence strength',
    seniority_alignment: 'Seniority fit',
    company_process_score: 'Company process',
    ats_coverage: 'ATS keywords',
    location_pay_alignment: 'Location / pay',
    risk_penalty: 'Risk adjustment',
  } as Record<string, string>)[factor] || factor
}

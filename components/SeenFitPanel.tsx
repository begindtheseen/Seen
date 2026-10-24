'use client'

// SeenFitPanel — the FREE SeenFit diagnosis for one job. Mobile-first.
//
// Renders the ONE verdict (score or none, band, one sentence, the hard-gate line first), the
// factors that were measured, "Why you match" with the résumé sentence that proves each match,
// what the posting asks for that the résumé does not show, the screens the résumé cannot answer,
// and the company's hiring-process risk. Bullets, the rewrite plan and the application message
// are the paid package (api/resume.js tool:optimize — "Optimize" on the job card); the free
// response no longer carries them (2026-10-24 audit, C3). Computed server-side, no external AI.

import { useState, useCallback } from 'react'
import { ResumeStore } from '@/lib/stores/ResumeStore'
import { aiHeaders } from '@/lib/aiHeaders'
import { useAuth } from '@/lib/auth'
import type { Job } from '@/lib/types'
import { MIN_REPORTS_FOR_GRADE } from '@/lib/gradeGate'
import { VerdictCard, WhyYouMatch, MissingList, Checklist, type Verdict, type ConstraintRow } from '@/components/optimizer/Verdict'

interface Contribution { factor: string; weight: number; raw: number; points: number; reason: string; scored?: boolean }
interface RiskFlag { code: string; severity: 'low' | 'medium' | 'high'; message: string }
interface RequirementMatch { requirement: string; surface: string; importance: string; matched: boolean; via: string; evidence: string | null; soft?: boolean; hard?: boolean }

interface OptimizerOutput {
  run_id?: string | null
  verdict: Verdict
  constraints: ConstraintRow[]
  fit_score: number | null
  confidence: number
  confidence_label: 'low' | 'medium' | 'high'
  required_match: number
  preferred_match: number
  ats_coverage: number
  evidence_strength: number
  seniority_alignment: number
  company_process_score: number
  company_process_known?: boolean
  risk_flags: RiskFlag[]
  missing_keywords: string[]
  matched_requirements: RequirementMatch[]
  unsupported_requirements: RequirementMatch[]
  explanation: { summary: string; contributions: Contribution[]; notes: string[] }
}

type State = 'idle' | 'no_resume' | 'loading' | 'done' | 'error' | 'disabled' | 'preview'

function scoreColor(s: number): string {
  return s >= 70 ? 'var(--green)' : s >= 45 ? 'var(--amber)' : 'var(--red)'
}

const mono = 'var(--mono)'

export default function SeenFitPanel({ job, onOptimized }: { job: Job; /** Called once a SeenFit run succeeds on this page. */ onOptimized?: () => void }) {
  const { isLoggedIn } = useAuth()
  const { user } = useAuth() as unknown as { user: { id?: string } | null }
  const [state, setState] = useState<State>('idle')
  const [out, setOut] = useState<OptimizerOutput | null>(null)

  const sendFeedback = useCallback(async (action: string, runId?: string | null) => {
    try {
      await fetch('/api/optimizer', {
        method: 'POST',
        headers: await aiHeaders(),
        body: JSON.stringify({ action: 'feedback', run_id: runId, user_action: action }),
      })
    } catch { /* non-fatal */ }
  }, [])

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
          jobSource: job.source || null,
          jobLocation: job.location || '',
          remoteOk: /remote/i.test(job.location || ''),
        }),
      })
      if (res.status === 403) { setState('disabled'); return }
      const data = await res.json()
      if (res.status === 422 && data.error === 'preview_only') { setState('preview'); return }
      if (!res.ok || data.error) { setState('error'); return }
      setOut(data)
      setState('done')
      onOptimized?.()
    } catch {
      setState('error')
    }
  }, [job, isLoggedIn, user, onOptimized])

  // ── Trigger button (idle) ──
  if (state === 'idle') {
    return (
      <div style={{ marginTop: '1.5rem' }}>
        <button
          onClick={run}
          style={{ width: '100%', background: 'linear-gradient(135deg,#3b82f6 0%,#8b5cf6 100%)', color: '#fff', border: 'none', borderRadius: 10, padding: '.85rem 1rem', fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.9rem', cursor: 'pointer' }}
        >
          ✨ Check my fit for this job · free
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

  if (state === 'preview') {
    return (
      <div style={{ marginTop: '1.5rem', fontFamily: mono, fontSize: 'var(--fs-70)', color: 'var(--muted)', textAlign: 'center', padding: '1rem', lineHeight: 1.6 }}>This listing only has a summary, so there is nothing to measure your résumé against. Open the full posting to read what it asks for.</div>
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

  const sortedContribs = [...out.explanation.contributions].filter((c) => c.scored !== false).sort((a, b) => b.points - a.points)

  return (
    <div style={{ marginTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <VerdictCard verdict={out.verdict} note={`${out.confidence_label} confidence · free`} />

      {out.verdict.score != null && (
        <Section title="WHAT THE SCORE IS MADE OF">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.6rem' }}>
            {sortedContribs.map((c) => (
              <div key={c.factor}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '.25rem' }}>
                  <span style={{ fontFamily: mono, fontSize: 'var(--fs-62)', color: 'var(--sub)' }}>{labelOf(c.factor)}</span>
                  <span style={{ fontFamily: mono, fontSize: 'var(--fs-62)', color: 'var(--white)' }}>+{c.points} pts</span>
                </div>
                <div style={{ height: 5, background: 'var(--raised)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ width: `${Math.min(100, c.raw * 100)}%`, height: '100%', background: scoreColor(c.raw * 100) }} />
                </div>
                <div style={{ fontFamily: mono, fontSize: 'var(--fs-55)', color: 'var(--muted)', marginTop: '.25rem', lineHeight: 1.5 }}>{c.reason}</div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {out.matched_requirements.length > 0 && <Section title="WHY YOU MATCH"><WhyYouMatch matched={out.matched_requirements} limit={8} /></Section>}
      {out.unsupported_requirements.length > 0 && <Section title="WHAT THE POSTING ALSO ASKS FOR"><MissingList missing={out.unsupported_requirements} limit={10} /></Section>}
      {(out.constraints || []).some((c) => c.status === 'ask') && <Section title="SCREENS YOUR RÉSUMÉ CAN'T ANSWER"><Checklist constraints={out.constraints} /></Section>}
      <div style={{ fontFamily: mono, fontSize: 'var(--fs-60)', color: 'var(--muted)', lineHeight: 1.6 }}>
        The rewrite plan — which bullet to lead with, number questions that write a bullet, an availability line, a summary for this job — is the Optimize button on the listing.
      </div>

      {/* Company hiring / process risk */}
      <Section title="COMPANY HIRING RISK">
        <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', marginBottom: out.risk_flags.length ? '.7rem' : 0 }}>
          {out.company_process_known === false ? (
            <span style={{ fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.85rem', color: 'var(--muted)' }}>Not graded yet</span>
          ) : (
            <span style={{ fontFamily: 'var(--display)', fontWeight: 800, fontSize: '1.1rem', color: scoreColor(out.company_process_score) }}>{Math.round(out.company_process_score)}<span style={{ fontSize: '.6rem', color: 'var(--muted)' }}>/100</span></span>
          )}
          <span style={{ fontFamily: mono, fontSize: '.6rem', color: 'var(--muted)' }}>{out.company_process_known === false ? `Fewer than ${MIN_REPORTS_FOR_GRADE} applicant reports — no grade yet` : 'hiring-process score (real applicant outcomes)'}</span>
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

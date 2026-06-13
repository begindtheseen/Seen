'use client'

// Job detail page — parity port of the old SPA `page-job-detail` (origin/main:index.html:2274–2293)
// driven by `openJobListing` (index.html:11213) + AI insights block (11260–11405).
// Source of truth: origin/main. AI uses the existing /api/job-insights endpoint (unchanged).

import { useState, useEffect, useCallback, use } from 'react'
import { useRouter } from 'next/navigation'
import { Score } from '@/lib/score'
import { JobCache } from '@/lib/stores/JobCache'
import { SavedJobsStore } from '@/lib/stores/SavedJobs'
import { aiHeaders } from '@/lib/aiHeaders'
import { useAuth } from '@/lib/auth'
import type { Job } from '@/lib/types'

interface Insights {
  what_they_want: string[]
  hidden_requirements: string[]
  insider_tip: string
  description_summary: string
}

const L1_TTL = 24 * 60 * 60 * 1000 // localStorage TTL — matches old _INSIGHTS_L1_TTL (24h)

// Format raw/AI description into clean paragraphs — port of old _formatDescText
function formatDesc(text: string): string[] {
  if (!text || text.length < 10) return []
  const t = text.replace(/^Category\s*:\s*[^\n.]+\s*/i, '').trim()
  return t.split(/\n+/).map(l => l.trim()).filter(Boolean)
}

function companySlug(name: string) {
  return encodeURIComponent(name.toLowerCase().replace(/\s+/g, '-'))
}

function Skeleton({ widths, h }: { widths: number[]; h: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '.65rem' }}>
      {widths.map((w, i) => (
        <div key={i} style={{ height: h, background: 'var(--raised)', borderRadius: 4, width: `${w}%`, animation: 'pulse 1.4s ease infinite' }} />
      ))}
    </div>
  )
}

export default function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const { isLoggedIn } = useAuth()

  const [job, setJob] = useState<Job | null>(null)
  const [resolved, setResolved] = useState(false)
  const [saved, setSaved] = useState(false)
  const [insights, setInsights] = useState<Insights | null>(null)
  const [insightsState, setInsightsState] = useState<'loading' | 'done' | 'unavailable' | 'no_desc' | 'credits'>('loading')

  // Resolve the job from the session cache (Next.js equivalent of old global JOBS array)
  useEffect(() => {
    const j = JobCache.get(id)
    setJob(j)
    setResolved(true)
    if (j) setSaved(SavedJobsStore.isSaved(j.id))
  }, [id])

  const loadInsights = useCallback(async (j: Job) => {
    const desc = j.description || ''
    if (!desc || desc.length <= 80) {
      setInsightsState('no_desc')
      return
    }
    // L1: localStorage 24h
    const cacheKey = 'ji_' + j.id
    try {
      const raw = localStorage.getItem(cacheKey)
      if (raw) {
        const entry = JSON.parse(raw)
        if (Date.now() - entry.ts < L1_TTL) { setInsights(entry.data); setInsightsState('done'); return }
        localStorage.removeItem(cacheKey)
      }
    } catch { /* ignore */ }

    // L2: /api/job-insights (DB cache 7d → Claude on miss). Bearer token if signed in.
    try {
      const res = await fetch('/api/job-insights', {
        method: 'POST',
        headers: await aiHeaders(),
        body: JSON.stringify({ jobId: j.id, job: j.title, company: j.company, jobDescription: desc, needsSummary: true }),
      })
      const d = await res.json()
      if (d.credits_required) { setInsightsState('credits'); return }
      if (d.what_they_want?.length) {
        try { localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), data: d })) } catch { /* ignore */ }
        setInsights(d)
        setInsightsState('done')
      } else {
        setInsights(d) // may still carry description_summary
        setInsightsState('unavailable')
      }
    } catch {
      setInsightsState('unavailable')
    }
  }, [])

  useEffect(() => {
    if (job) loadInsights(job)
  }, [job, loadInsights])

  function toggleSave() {
    if (!job) return
    if (saved) {
      SavedJobsStore.remove(job.id, isLoggedIn)
      setSaved(false)
    } else {
      SavedJobsStore.save({ id: job.id, co: job.company, title: job.title, city: job.location, score: job.score }, isLoggedIn)
      setSaved(true)
    }
  }

  function goBack() {
    if (window.history.length > 1) router.back()
    else router.push('/jobs')
  }

  const backBtn = (
    <button onClick={goBack} style={{ background: 'none', border: 'none', fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'var(--dim)', cursor: 'pointer', padding: '.25rem 0', marginBottom: '1.5rem', display: 'inline-flex', alignItems: 'center', gap: '.35rem' }}>← Back to jobs</button>
  )

  // Direct-link / refresh fallback — job not in this session's cache
  if (resolved && !job) {
    return (
      <div style={{ minHeight: '100vh', paddingTop: 58, background: 'radial-gradient(ellipse at 80% 0%,rgba(16,185,129,0.06) 0%,transparent 45%)' }}>
        <div style={{ maxWidth: 720, margin: '0 auto', padding: '1.25rem 1rem 7rem' }}>
          {backBtn}
          <div style={{ background: 'var(--raised)', border: '1px solid var(--line2)', borderRadius: 12, padding: '1.5rem', textAlign: 'center' }}>
            <div style={{ fontFamily: 'var(--display)', fontSize: '1rem', fontWeight: 700, color: 'var(--white)', marginBottom: '.4rem' }}>This listing isn&apos;t loaded</div>
            <div style={{ fontSize: '.8rem', color: 'var(--sub)', fontWeight: 300, marginBottom: '1rem', lineHeight: 1.6 }}>Job details are loaded from your search session. Run a search and open the listing from the results.</div>
            <button onClick={() => router.push('/jobs')} style={{ background: 'var(--green)', color: 'var(--ink)', border: 'none', borderRadius: 8, padding: '.6rem 1.25rem', fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.82rem', cursor: 'pointer' }}>Search jobs →</button>
          </div>
        </div>
      </div>
    )
  }

  if (!job) return <div style={{ minHeight: '100vh', paddingTop: 58 }}><div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}><div className="spinner" /></div></div>

  const risk = Score.risk(job.score)
  const chips = [job.type, job.level, job.salary && job.salary !== '—' ? job.salary : ''].filter(Boolean) as string[]
  const avail = job.availability_status
  const descParas = formatDesc(insights?.description_summary || job.description || '')

  return (
    <div style={{ minHeight: '100vh', paddingTop: 58, background: 'radial-gradient(ellipse at 80% 0%,rgba(16,185,129,0.06) 0%,transparent 45%),radial-gradient(ellipse at 15% 10%,rgba(29,78,216,0.07) 0%,transparent 40%)' }}>
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '1.25rem 1rem 7rem' }}>
        {backBtn}

        {/* Header card — glassmorphism glass panel */}
        <div className="hero-terminal" style={{ display: 'block', marginBottom: '1.5rem', padding: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem', marginBottom: chips.length > 0 ? '.85rem' : 0 }}>
            <div style={{ width: 52, height: 52, borderRadius: 10, background: 'var(--raised)', border: '1px solid var(--line2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--display)', fontWeight: 800, fontSize: '1.3rem', color: 'var(--white)', flexShrink: 0 }}>
              {(job.company || '?')[0].toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1 style={{ fontFamily: 'var(--display)', fontSize: '1.25rem', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.025em', lineHeight: 1.2, marginBottom: '.3rem' }}>{job.title}</h1>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'var(--dim)' }}>{job.company}{job.location ? ` · 📍 ${job.location}` : ''}</div>
            </div>
            <div style={{ textAlign: 'center', flexShrink: 0 }}>
              <div className={`sring ${risk}`} style={{ width: 44, height: 44 }}><div className="sring-n" style={{ fontSize: '.85rem' }}>{job.score}</div></div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '.45rem', color: 'var(--muted)', marginTop: '.15rem' }}>score</div>
            </div>
          </div>
          {chips.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.4rem' }}>
              {chips.map((c, i) => (
                <span key={i} style={{ background: 'var(--raised)', border: '1px solid var(--line2)', borderRadius: 5, padding: '.2rem .55rem', fontSize: '.65rem', fontFamily: 'var(--mono)', color: 'var(--sub)' }}>{c}</span>
              ))}
            </div>
          )}
        </div>

        {/* Availability warning — only when the field exists (no invented data) */}
        {avail === 'stale' && (
          <div style={{ marginTop: '.85rem', padding: '.55rem .8rem', background: 'rgba(245,158,11,.07)', border: '1px solid rgba(245,158,11,.2)', borderRadius: 8, fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--amber)', lineHeight: 1.55 }}>⚠ This listing hasn&apos;t been seen in 7+ days and may be closed. Verify before applying.</div>
        )}
        {avail === 'expired' && (
          <div style={{ marginTop: '.85rem', padding: '.55rem .8rem', background: 'rgba(239,68,68,.07)', border: '1px solid rgba(239,68,68,.2)', borderRadius: 8, fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--red)', lineHeight: 1.55 }}>✕ This listing is likely closed — it hasn&apos;t been seen in 14+ days. Check the company&apos;s careers page directly.</div>
        )}

        {/* AI insights */}
        <div style={{ marginTop: '1.5rem', background: 'var(--gdim)', border: '1px solid var(--line)', borderRadius: 12, padding: '1.25rem', animation: 'fadeUp .4s .15s ease both' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--dim)', marginBottom: '.85rem' }}>
            WHAT {(job.company || 'THIS COMPANY').toUpperCase()} IS HIRING FOR
          </div>
          {insightsState === 'loading' && <Skeleton widths={[80, 65, 72, 58, 68]} h={10} />}
          {insightsState === 'no_desc' && <div style={{ fontSize: '.75rem', color: 'var(--muted)' }}>No description available for AI analysis.</div>}
          {insightsState === 'unavailable' && <div style={{ fontSize: '.75rem', color: 'var(--muted)' }}>AI insights unavailable for this listing.</div>}
          {insightsState === 'credits' && (
            <div style={{ fontSize: '.75rem', color: 'var(--muted)', lineHeight: 1.6 }}>
              {isLoggedIn ? "You're out of AI credits for now — insights will be available again soon." : <>Sign in to unlock AI insights for this role. <a href="/login" style={{ color: 'var(--green)' }}>Sign in →</a></>}
            </div>
          )}
          {insightsState === 'done' && insights && (
            <>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '.6rem' }}>
                {insights.what_they_want.map((item, i) => (
                  <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '.55rem', fontSize: '.8rem', color: 'var(--sub)', lineHeight: 1.5 }}>
                    <span style={{ color: 'var(--green)', fontSize: '.6rem', marginTop: '.22rem', flexShrink: 0 }}>▶</span>{item}
                  </li>
                ))}
              </ul>
              {(insights.hidden_requirements?.length > 0 || insights.insider_tip) && (
                <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--line)' }}>
                  {insights.hidden_requirements?.length > 0 && (
                    <>
                      <div style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--dim)', marginBottom: '.55rem' }}>Unstated Expectations</div>
                      <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 .85rem', display: 'flex', flexDirection: 'column', gap: '.45rem' }}>
                        {insights.hidden_requirements.map((r, i) => (
                          <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '.5rem', fontSize: '.75rem', color: 'var(--muted)', lineHeight: 1.5 }}>
                            <span style={{ color: 'var(--red)', fontSize: '.55rem', marginTop: '.2rem', flexShrink: 0 }}>◆</span>{r}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  {insights.insider_tip && (
                    <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 7, padding: '.65rem .9rem', fontSize: '.75rem', color: 'var(--sub)', lineHeight: 1.6 }}>
                      <span style={{ color: 'var(--green)', fontWeight: 700 }}>Tip: </span>{insights.insider_tip}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Description */}
        <div style={{ marginTop: '1.5rem', animation: 'fadeUp .4s .25s ease both' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--dim)', marginBottom: '.75rem' }}>ABOUT THIS ROLE</div>
          {insightsState === 'loading'
            ? <Skeleton widths={[95, 82, 90, 70, 86, 75, 92, 65, 80, 88]} h={9} />
            : descParas.length > 0
              ? descParas.map((p, i) => <p key={i} style={{ fontSize: '.84rem', color: 'var(--sub)', lineHeight: 1.8, margin: '0 0 .85rem' }}>{p}</p>)
              : <p style={{ fontSize: '.84rem', color: 'var(--muted)', fontWeight: 300 }}>No description available.</p>
          }
        </div>

        {/* Report placeholder */}
        <div style={{ marginTop: '1.5rem', background: 'var(--raised)', border: '1px solid var(--line2)', borderRadius: 12, padding: '1.25rem', opacity: .6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '.65rem', marginBottom: '.45rem' }}>
            <div style={{ fontFamily: 'var(--display)', fontSize: '.9rem', fontWeight: 700, color: 'var(--muted)' }}>Report Your Experience</div>
            <span style={{ background: 'var(--line)', color: 'var(--dim)', fontFamily: 'var(--mono)', fontSize: '.5rem', padding: '.15rem .45rem', borderRadius: 4, letterSpacing: '.06em' }}>COMING SOON</span>
          </div>
          <div style={{ fontSize: '.75rem', color: 'var(--muted)', fontWeight: 300, lineHeight: 1.65 }}>Applied here? Share how it went — response rate, interview process, offer outcome. Help the community cut through the noise.</div>
        </div>
      </div>

      {/* Sticky footer */}
      <div style={{ position: 'sticky', bottom: 0, background: 'var(--ink)', borderTop: '1px solid var(--line2)', padding: '.9rem 1rem', zIndex: 10 }}>
        <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
          <a href={`/company/${companySlug(job.company)}`} style={{ display: 'block', width: '100%', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'var(--amber)', textDecoration: 'none', padding: '.25rem 0 .5rem', opacity: .85 }}>
            🏢 Check {job.company || 'company'} →
          </a>
          <div style={{ display: 'flex', gap: '.75rem' }}>
            <button onClick={toggleSave} aria-label={saved ? 'Unsave' : 'Save'} style={{ background: 'none', border: '1px solid var(--line2)', borderRadius: 8, padding: '.65rem 1rem', fontSize: '1.1rem', cursor: 'pointer', color: saved ? 'var(--green)' : 'var(--muted)', flexShrink: 0 }}>{saved ? '♥' : '♡'}</button>
            {job.apply_url
              ? <a href={job.apply_url} target="_blank" rel="noopener noreferrer" style={{ flex: 1, textAlign: 'center', background: 'var(--green)', color: 'var(--ink)', borderRadius: 8, padding: '.65rem 1rem', fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.85rem', textDecoration: 'none' }}>Apply &amp; Optimize →</a>
              : <button disabled style={{ flex: 1, background: 'var(--muted)', color: 'var(--ink)', border: 'none', borderRadius: 8, padding: '.65rem 1rem', fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.85rem', opacity: .65 }}>No apply link</button>
            }
          </div>
        </div>
      </div>
    </div>
  )
}

'use client'

// Job detail page — parity port of the old SPA `page-job-detail` (origin/main:index.html:2274–2293)
// driven by `openJobListing` (index.html:11213) + AI insights block (11260–11405).
// Source of truth: origin/main. AI uses the existing /api/job-insights endpoint (unchanged).

import { useState, useEffect, useCallback, use } from 'react'
import { useRouter } from 'next/navigation'
import { Score } from '@/lib/score'
import { JobCache } from '@/lib/stores/JobCache'
import { SavedJobsStore } from '@/lib/stores/SavedJobs'
import ListingCard from '@/components/ListingCard'
import SeenFitPanel from '@/components/SeenFitPanel'
import HumanProofPanel from '@/components/HumanProofPanel'
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
  const [showApplyModal, setShowApplyModal] = useState(false)
  const [showShareCard, setShowShareCard] = useState(false)
  const [reportedInactive, setReportedInactive] = useState(false)
  const [reportingInactive, setReportingInactive] = useState(false)

  async function reportInactive() {
    if (!isLoggedIn) { alert('Sign in to report listings.'); return }
    setReportingInactive(true)
    try {
      await fetch('/api/user-sync', {
        method: 'POST',
        headers: await aiHeaders(),
        body: JSON.stringify({ action: 'report_job_availability', job_id: String(id), status: 'expired' }),
      })
      setReportedInactive(true)
    } catch { /* silent */ } finally {
      setReportingInactive(false)
    }
  }

  // Resolve the job — session cache first (fast path), then the saved snapshot
  // (so a SAVED listing always reopens to the exact thing saved, even in a new
  // session or after it has aged out of the DB), then DB fallback for direct links.
  useEffect(() => {
    const j = JobCache.get(id)
    if (j) {
      setJob(j)
      setSaved(SavedJobsStore.isSaved(j.id))
      setResolved(true)
      return
    }
    const snap = SavedJobsStore.getSnapshot(id)
    if (snap) {
      JobCache.set(snap)
      setJob(snap)
      setSaved(true)
      setResolved(true)
      return
    }
    fetch('/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'get_by_id', id }),
    })
      .then(r => r.json())
      .then((d: { job?: Record<string, unknown> }) => {
        if (!d.job) return
        const r = d.job
        const mapped: Job = {
          id: String(r.id ?? id),
          title: String(r.title ?? ''),
          company: String(r.company ?? ''),
          location: String(r.location ?? ''),
          score: Number(r.score) || 65,
          waste: Number(r.waste_score ?? r.waste) || 25,
          level: String(r.level ?? 'Mid level'),
          type: String(r.type ?? 'Full-time'),
          source: String(r.source ?? 'Job board'),
          description: String(r.description ?? ''),
          salary: r.salary ? String(r.salary) : null,
          apply_url: r.apply_url ? String(r.apply_url) : (r.url ? String(r.url) : null),
          availability_status: r.availability_status ? String(r.availability_status) : undefined,
        }
        JobCache.set(mapped)
        setJob(mapped)
        setSaved(SavedJobsStore.isSaved(id))
      })
      .catch(() => {})
      .finally(() => setResolved(true))
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
      // A freshly generated insight ('generated') consumed a credit server-side; DB-cache
      // hits are free. Only refresh the Nav balance when a credit was actually spent.
      if (d._src === 'generated') window.dispatchEvent(new Event('seen:credits-updated'))
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
      SavedJobsStore.save(job, isLoggedIn)
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
      <div className="page-full">
        <div style={{ maxWidth: 720, margin: '0 auto', padding: '1.25rem 1rem 7rem', width: '100%', boxSizing: 'border-box' }}>
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

  if (!job) return <div className="page-full"><div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}><div className="spinner" /></div></div>

  const risk = Score.risk(job.score)
  const chips = [job.type, job.level, job.salary && job.salary !== '—' ? job.salary : ''].filter(Boolean) as string[]
  const avail = job.availability_status
  const descParas = formatDesc(insights?.description_summary || job.description || '')

  return (
    <div className="page-full">
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '1.25rem 1rem 7rem', width: '100%', boxSizing: 'border-box' }}>
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

        {/* Stat grid — Score / Waste / Type / Level / Salary / Source */}
        <div className="jd-grid">
          <div className="jd-stat"><span className="jd-sn" style={{ color: Score.color(risk) }}>{job.score}</span><span className="jd-sl">Score</span></div>
          <div className="jd-stat"><span className="jd-sn" style={{ color: job.waste > 55 ? 'var(--red)' : job.waste > 35 ? 'var(--amber)' : 'var(--green)' }}>{job.waste}%</span><span className="jd-sl">Waste risk</span></div>
          <div className="jd-stat"><span className="jd-sn" style={{ fontSize: '.75rem' }}>{job.type || 'Full-time'}</span><span className="jd-sl">Type</span></div>
          <div className="jd-stat"><span className="jd-sn" style={{ fontSize: '.75rem' }}>{job.level || 'Mid level'}</span><span className="jd-sl">Level</span></div>
          <div className="jd-stat"><span className="jd-sn" style={{ color: 'var(--green)', fontSize: '.78rem' }}>{job.salary || '—'}</span><span className="jd-sl">Salary</span></div>
          <div className="jd-stat"><span className="jd-sn" style={{ fontSize: '.68rem', color: 'var(--blue)' }}>{job.source || 'Job board'}</span><span className="jd-sl">Source</span></div>
        </div>

        {/* Waste score panel — shown when company has high waste risk */}
        {job.waste > 40 && (
          <div className="waste-panel" style={{ animation: 'fadeUp .4s .1s ease both' }}>
            <span className="wp-label">⚠ {job.waste}% Waste risk</span>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--muted)' }}>High chance of no response</span>
          </div>
        )}

        {/* Status indicator — pulsing blue if listing was recently seen */}
        {avail === 'active' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '.45rem', marginBottom: '.85rem', fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--blue)', animation: 'fadeUp .4s .08s ease both' }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--blue)', display: 'inline-block', animation: 'pulse 2s infinite', flexShrink: 0 }} />
            Active listing — seen recently
          </div>
        )}

        {/* Availability warning — only when the field exists (no invented data) */}
        {avail === 'stale' && (
          <div style={{ marginTop: '.85rem', padding: '.55rem .8rem', background: 'rgba(245,158,11,.07)', border: '1px solid rgba(245,158,11,.2)', borderRadius: 8, fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--amber)', lineHeight: 1.55 }}>⚠ This listing hasn&apos;t been seen in 7+ days and may be closed. Verify before applying.</div>
        )}
        {avail === 'expired' && (
          <div style={{ marginTop: '.85rem', padding: '.55rem .8rem', background: 'rgba(239,68,68,.07)', border: '1px solid rgba(239,68,68,.2)', borderRadius: 8, fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--red)', lineHeight: 1.55 }}>✕ This listing is likely closed — it hasn&apos;t been seen in 14+ days. Check the company&apos;s careers page directly.</div>
        )}

        {/* Report inactive */}
        <div style={{ marginTop: '.4rem' }}>
          {!reportedInactive ? (
            <button
              onClick={reportInactive}
              disabled={reportingInactive}
              style={{ background: 'none', border: 'none', fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--dim)', cursor: 'pointer', padding: '.1rem 0', opacity: .55, transition: 'opacity .15s' }}
              onMouseOver={e => (e.currentTarget.style.opacity = '1')}
              onMouseOut={e => (e.currentTarget.style.opacity = '.55')}
            >
              {reportingInactive ? 'Reporting…' : '⚑ Not active? Report it'}
            </button>
          ) : (
            <span style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--amber)' }}>✓ Reported — thanks</span>
          )}
        </div>

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

        {/* SeenFit Engine — deterministic, keyless résumé/application optimizer */}
        <SeenFitPanel job={job} />

        {/* HumanProof — runs AFTER SeenFit: removes generic AI tone, adds truthful work context */}
        <HumanProofPanel job={job} />

        {/* Report Your Experience — T1-15 */}
        <div style={{ marginTop: '1.5rem', background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 12, padding: '1.25rem' }}>
          <div style={{ fontFamily: 'var(--display)', fontSize: '.9rem', fontWeight: 700, color: 'var(--white)', marginBottom: '.3rem' }}>Report your experience</div>
          <p style={{ fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'var(--sub)', marginBottom: '1rem', lineHeight: 1.6 }}>
            Applied here? Share how it went — takes 60 seconds and helps thousands of job seekers.
          </p>
          <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
            <a
              href={`/report?company=${encodeURIComponent(job?.company || '')}&role=${encodeURIComponent(job?.title || '')}&outcome=ghosted`}
              style={{ fontFamily: 'var(--mono)', fontSize: '.65rem', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: 'var(--red)', borderRadius: 7, padding: '.4rem .85rem', textDecoration: 'none' }}
            >
              👻 Got ghosted
            </a>
            <a
              href={`/report?company=${encodeURIComponent(job?.company || '')}&role=${encodeURIComponent(job?.title || '')}&outcome=rejected`}
              style={{ fontFamily: 'var(--mono)', fontSize: '.65rem', background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.3)', color: 'var(--blue)', borderRadius: 7, padding: '.4rem .85rem', textDecoration: 'none' }}
            >
              🤝 Rejected
            </a>
            <a
              href={`/report?company=${encodeURIComponent(job?.company || '')}&role=${encodeURIComponent(job?.title || '')}&outcome=interviewing`}
              style={{ fontFamily: 'var(--mono)', fontSize: '.65rem', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', color: 'var(--green)', borderRadius: 7, padding: '.4rem .85rem', textDecoration: 'none' }}
            >
              📅 Got an interview
            </a>
            <a
              href={`/report?company=${encodeURIComponent(job?.company || '')}&role=${encodeURIComponent(job?.title || '')}&outcome=hired`}
              style={{ fontFamily: 'var(--mono)', fontSize: '.65rem', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', color: 'var(--green)', borderRadius: 7, padding: '.4rem .85rem', textDecoration: 'none' }}
            >
              ✅ Got an offer
            </a>
          </div>
        </div>
      </div>

      {/* Sticky footer */}
      <div style={{ position: 'sticky', bottom: 0, background: 'var(--ink)', borderTop: '1px solid var(--line2)', padding: '.9rem 1rem', zIndex: 10 }}>
        <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '.5rem', width: '100%', boxSizing: 'border-box' }}>
          <a href={`/company/${companySlug(job.company)}`} style={{ display: 'block', width: '100%', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'var(--amber)', textDecoration: 'none', padding: '.25rem 0 .5rem', opacity: .85 }}>
            🏢 Check {job.company || 'company'} →
          </a>
          <div style={{ display: 'flex', gap: '.75rem' }}>
            <button onClick={toggleSave} aria-label={saved ? 'Unsave' : 'Save'} style={{ background: 'none', border: '1px solid var(--line2)', borderRadius: 8, padding: '.65rem 1rem', fontSize: '1.1rem', cursor: 'pointer', color: saved ? 'var(--green)' : 'var(--muted)', flexShrink: 0 }}>{saved ? '♥' : '♡'}</button>
            <button onClick={() => setShowShareCard(true)} aria-label="Share listing" title="Share this listing" style={{ background: 'none', border: '1px solid var(--line2)', borderRadius: 8, padding: '.65rem 1rem', fontSize: '1.05rem', cursor: 'pointer', color: 'var(--muted)', flexShrink: 0 }}>🖼</button>
            {job.apply_url
              ? <button
                  onClick={() => setShowApplyModal(true)}
                  style={{ flex: 1, textAlign: 'center', background: 'var(--green)', color: 'var(--ink)', borderRadius: 8, padding: '.65rem 1rem', fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.85rem', border: 'none', cursor: 'pointer' }}
                >
                  Apply &amp; Optimize →
                </button>
              : <button disabled style={{ flex: 1, background: 'var(--muted)', color: 'var(--ink)', border: 'none', borderRadius: 8, padding: '.65rem 1rem', fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.85rem', opacity: .65 }}>No apply link</button>
            }
          </div>
        </div>
        {showShareCard && job && (
          <ListingCard
            data={{
              title: job.title, company: job.company, location: job.location,
              level: job.level, type: job.type, score: job.score, waste: job.waste,
              whatTheyWant: insights?.what_they_want, insiderTip: insights?.insider_tip,
            }}
            onClose={() => setShowShareCard(false)}
          />
        )}
        {showApplyModal && job && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: '0 0 0 0' }} onClick={() => setShowApplyModal(false)}>
            <div style={{ position: 'relative', background: 'var(--surface)', borderRadius: '14px 14px 0 0', padding: '1.5rem', width: '100%', maxWidth: 520, animation: 'fadeUp .25s ease both' }} onClick={e => e.stopPropagation()}>
              <div style={{ fontFamily: 'var(--display)', fontSize: '1.1rem', fontWeight: 800, color: 'var(--white)', marginBottom: '.4rem' }}>Ready to apply?</div>
              <p style={{ fontFamily: 'var(--mono)', fontSize: '.68rem', color: 'var(--sub)', marginBottom: '1.25rem', lineHeight: 1.65 }}>
                Optimize your resume for this role before you apply — it takes 60 seconds and can significantly improve your chances.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '.65rem' }}>
                <a
                  href={`/resume?company=${encodeURIComponent(job.company)}&role=${encodeURIComponent(job.title)}`}
                  style={{ display: 'block', textAlign: 'center', background: 'linear-gradient(135deg,#3b82f6 0%,#8b5cf6 100%)', color: '#fff', borderRadius: 9, padding: '.75rem', fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.9rem', textDecoration: 'none' }}
                >
                  ✨ Optimize resume first →
                </a>
                <a
                  href={job.apply_url || '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ display: 'block', textAlign: 'center', background: 'var(--card)', border: '1px solid var(--line2)', color: 'var(--sub)', borderRadius: 9, padding: '.75rem', fontFamily: 'var(--mono)', fontSize: '.72rem', textDecoration: 'none' }}
                  onClick={() => setShowApplyModal(false)}
                >
                  Skip optimization — apply directly
                </a>
              </div>
              <button onClick={() => setShowApplyModal(false)} style={{ position: 'absolute', top: '1rem', right: '1rem', background: 'none', border: 'none', color: 'var(--muted)', fontSize: '1.2rem', cursor: 'pointer' }}>×</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

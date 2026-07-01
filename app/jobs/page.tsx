'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Score } from '@/lib/score'
import { SavedJobsStore } from '@/lib/stores/SavedJobs'
import { JobCache } from '@/lib/stores/JobCache'
import { stableJobId } from '@/lib/jobId'
import { AppStore } from '@/lib/stores/AppStore'
import { RecentSearchesStore } from '@/lib/stores/RecentSearches'
import { useAuth } from '@/lib/auth'
import { aiHeaders } from '@/lib/aiHeaders'
import type { Job } from '@/lib/types'
import HiringProbability from '@/components/HiringProbability'
import ApplyCheckpoint from '@/components/ApplyCheckpoint'
import ApplyOptimizeModal from '@/components/ApplyOptimizeModal'

// In-memory search cache: `${query}|${location}` → { jobs, ts }
const searchCache = new Map<string, { jobs: Job[]; ts: number }>()

type SortMode = 'transparency' | 'waste' | 'recent'
type NicheFilter = '' | 'tech' | 'healthcare' | 'retail' | 'logistics' | 'finance' | 'other'
type LevelFilter = '' | 'entry' | 'mid' | 'senior'
type TypeFilter = '' | 'Full-time' | 'Part-time' | 'Contract'
type PostedFilter = '' | '1' | '7' | '30'

function jobVibes(job: Job): { cls: string; txt: string }[] {
  const vibes: { cls: string; txt: string }[] = []
  const src = (job.source || '').toLowerCase()
  const loc = (job.location || '').toLowerCase()
  const score = job.score || 65
  if (src.includes('greenhouse') || src.includes('lever') || src.includes('workday')) {
    vibes.push({ cls: 'v-g', txt: '✅ Direct ATS' })
  } else if (src.includes('linkedin')) {
    vibes.push({ cls: 'v-b', txt: '💼 LinkedIn' })
  } else if (src.includes('indeed')) {
    vibes.push({ cls: 'v-n', txt: '🔍 Indeed' })
  }
  if (job.salary) vibes.push({ cls: 'v-g', txt: '💰 Salary listed' })
  if (score >= 75) vibes.push({ cls: 'v-g', txt: '✅ High transparency' })
  else if (score < 40) vibes.push({ cls: 'v-r', txt: '⚠️ Low score' })
  if (loc.includes('remote') || (job.type || '').toLowerCase().includes('remote')) {
    vibes.push({ cls: 'v-b', txt: '🏠 Remote' })
  }
  return vibes.slice(0, 3)
}

function ScoreRing({ score }: { score: number }) {
  const risk = Score.risk(score)
  return (
    <div className={`sring ${risk}`} style={{ width: 46, height: 46, flexShrink: 0 }}>
      <div className="sring-n" style={{ fontSize: '.9rem' }}>{score}</div>
      <div className="sring-l">{Score.label(risk)}</div>
    </div>
  )
}

// ── Job detail drawer helpers ─────────────────────────────────────────────────

interface Insights {
  what_they_want: string[]
  hidden_requirements: string[]
  insider_tip: string
  description_summary: string
}

const L1_TTL = 24 * 60 * 60 * 1000

function formatDesc(text: string): string[] {
  if (!text || text.length < 10) return []
  return text.replace(/^Category\s*:\s*[^\n.]+\s*/i, '').trim()
    .split(/\n+/).map(l => l.trim()).filter(Boolean)
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

// ── Job Detail Drawer ─────────────────────────────────────────────────────────

function JobDetailDrawer({ job, isLoggedIn, onClose, onApply, onCheckCompany }: {
  job: Job
  isLoggedIn: boolean
  onClose: () => void
  onApply: (job: Job) => void
  onCheckCompany: (company: string) => void
}) {
  const [visible, setVisible] = useState(false)
  const [saved, setSaved] = useState(() => SavedJobsStore.isSaved(job.id))
  const [insights, setInsights] = useState<Insights | null>(null)
  const [insightsState, setInsightsState] = useState<'loading' | 'done' | 'unavailable' | 'no_desc' | 'credits'>('loading')

  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(id)
  }, [])

  const loadInsights = useCallback(async (j: Job) => {
    const desc = j.description || ''
    if (!desc || desc.length <= 80) { setInsightsState('no_desc'); return }
    const key = 'ji_' + j.id
    try {
      const raw = localStorage.getItem(key)
      if (raw) {
        const e = JSON.parse(raw)
        if (Date.now() - e.ts < L1_TTL) { setInsights(e.data); setInsightsState('done'); return }
        localStorage.removeItem(key)
      }
    } catch { /* ignore */ }
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
        try { localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data: d })) } catch { /* ignore */ }
        setInsights(d); setInsightsState('done')
      } else { setInsights(d); setInsightsState('unavailable') }
    } catch { setInsightsState('unavailable') }
  }, [])

  useEffect(() => { loadInsights(job) }, [job, loadInsights])

  function toggleSave() {
    if (saved) { SavedJobsStore.remove(job.id, isLoggedIn); setSaved(false) }
    else { SavedJobsStore.save(job, isLoggedIn); setSaved(true) }
  }

  const risk = Score.risk(job.score)
  const avail = job.availability_status
  const descParas = formatDesc(insights?.description_summary || job.description || '')
  const chips = [job.type, job.level, job.salary && job.salary !== '—' ? job.salary : ''].filter(Boolean) as string[]

  return (
    <>
      {/* Backdrop */}
      <div
        style={{
          position: 'fixed', inset: 0, zIndex: 9800,
          background: `rgba(0,0,0,${visible ? '.65' : '0'})`,
          backdropFilter: visible ? 'blur(3px)' : 'none',
          transition: 'background .3s ease, backdrop-filter .3s ease',
        }}
        onClick={onClose}
      />
      {/* Slide-in panel */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 9900,
        width: 'min(540px, 100vw)',
        background: 'var(--surface)',
        borderLeft: '1px solid var(--line)',
        boxShadow: '-12px 0 48px rgba(0,0,0,.55),-40px 0 80px rgba(99,102,241,.12),-60px 0 120px rgba(124,58,237,.06)',
        transform: `translateX(${visible ? '0' : '100%'})`,
        transition: 'transform .3s cubic-bezier(.32,.72,0,1)',
        display: 'flex', flexDirection: 'column',
        overflowY: 'hidden',
      }}>
        {/* Sticky header */}
        <div style={{ flexShrink: 0, borderBottom: '1px solid var(--line)', padding: '.85rem 1.15rem', display: 'flex', alignItems: 'center', gap: '.65rem' }}>
          <button onClick={onClose} style={{ background: 'none', border: '1px solid var(--line2)', borderRadius: 7, color: 'var(--dim)', cursor: 'pointer', fontSize: '.72rem', padding: '.28rem .65rem', fontFamily: 'var(--mono)', flexShrink: 0 }}>← Back</button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--display)', fontSize: '.85rem', fontWeight: 700, color: 'var(--white)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{job.title}</div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', color: 'var(--muted)' }}>{job.company}</div>
          </div>
          <a href={`/jobs/${encodeURIComponent(job.id)}`} style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', color: 'var(--muted)', textDecoration: 'none', flexShrink: 0, padding: '.25rem' }}>↗</a>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--dim)', cursor: 'pointer', fontSize: '1rem', padding: '.2rem', lineHeight: 1, flexShrink: 0 }}>✕</button>
        </div>

        {/* Scrollable content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '1.15rem', paddingBottom: '0' }}>
          {/* Header card */}
          <div className="hero-terminal" style={{ display: 'block', marginBottom: '1.1rem', padding: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '.8rem', marginBottom: chips.length ? '.7rem' : 0 }}>
              <div style={{ width: 44, height: 44, borderRadius: 9, background: 'var(--raised)', border: '1px solid var(--line2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--display)', fontWeight: 800, fontSize: '1.1rem', color: 'var(--white)', flexShrink: 0 }}>
                {(job.company || '?')[0].toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: 'var(--display)', fontSize: '1.05rem', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.025em', lineHeight: 1.2, marginBottom: '.22rem' }}>{job.title}</div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--dim)' }}>{job.company}{job.location ? ` · 📍 ${job.location}` : ''}</div>
              </div>
              <div className={`sring ${risk}`} style={{ width: 40, height: 40, flexShrink: 0 }}>
                <div className="sring-n" style={{ fontSize: '.8rem' }}>{job.score}</div>
              </div>
            </div>
            {chips.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.3rem' }}>
                {chips.map((c, i) => <span key={i} style={{ background: 'var(--raised)', border: '1px solid var(--line2)', borderRadius: 5, padding: '.18rem .48rem', fontSize: '.58rem', fontFamily: 'var(--mono)', color: 'var(--sub)' }}>{c}</span>)}
              </div>
            )}
          </div>

          {/* Stat grid */}
          <div className="jd-grid" style={{ marginBottom: '1rem' }}>
            <div className="jd-stat"><span className="jd-sn" style={{ color: Score.color(risk) }}>{job.score}</span><span className="jd-sl">Score</span></div>
            <div className="jd-stat"><span className="jd-sn" style={{ color: job.waste > 55 ? 'var(--red)' : job.waste > 35 ? 'var(--amber)' : 'var(--green)' }}>{job.waste}%</span><span className="jd-sl">Waste risk</span></div>
            <div className="jd-stat"><span className="jd-sn" style={{ fontSize: '.72rem' }}>{job.type || 'Full-time'}</span><span className="jd-sl">Type</span></div>
            <div className="jd-stat"><span className="jd-sn" style={{ fontSize: '.72rem' }}>{job.level || 'Mid level'}</span><span className="jd-sl">Level</span></div>
            <div className="jd-stat"><span className="jd-sn" style={{ color: 'var(--green)', fontSize: '.75rem' }}>{job.salary || '—'}</span><span className="jd-sl">Salary</span></div>
            <div className="jd-stat"><span className="jd-sn" style={{ fontSize: '.65rem', color: 'var(--blue)' }}>{job.source || 'Job board'}</span><span className="jd-sl">Source</span></div>
          </div>

          {/* Waste panel */}
          {job.waste > 40 && (
            <div className="waste-panel">
              <span className="wp-label">⚠ {job.waste}% Waste risk</span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--muted)' }}>High chance of no response</span>
            </div>
          )}

          {/* Availability */}
          {avail === 'active' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', marginBottom: '.75rem', fontFamily: 'var(--mono)', fontSize: '.56rem', color: 'var(--blue)' }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--blue)', display: 'inline-block', animation: 'pulse 2s infinite', flexShrink: 0 }} />
              Active listing — seen recently
            </div>
          )}
          {avail === 'stale' && (
            <div style={{ marginBottom: '.75rem', padding: '.5rem .75rem', background: 'rgba(245,158,11,.07)', border: '1px solid rgba(245,158,11,.2)', borderRadius: 8, fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--amber)', lineHeight: 1.5 }}>⚠ May be closed — verify before applying.</div>
          )}
          {avail === 'expired' && (
            <div style={{ marginBottom: '.75rem', padding: '.5rem .75rem', background: 'rgba(239,68,68,.07)', border: '1px solid rgba(239,68,68,.2)', borderRadius: 8, fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--red)', lineHeight: 1.5 }}>✕ Likely closed — check the company&apos;s careers page.</div>
          )}

          {/* AI Insights */}
          <div style={{ background: 'var(--gdim)', border: '1px solid var(--line)', borderRadius: 12, padding: '1rem', marginBottom: '1.1rem' }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.56rem', textTransform: 'uppercase' as const, letterSpacing: '.08em', color: 'var(--dim)', marginBottom: '.7rem' }}>
              WHAT {(job.company || 'THIS COMPANY').toUpperCase()} IS HIRING FOR
            </div>
            {insightsState === 'loading' && <Skeleton widths={[80, 65, 72, 58, 68]} h={10} />}
            {insightsState === 'no_desc' && <div style={{ fontSize: '.72rem', color: 'var(--muted)' }}>No description for AI analysis.</div>}
            {insightsState === 'unavailable' && <div style={{ fontSize: '.72rem', color: 'var(--muted)' }}>AI insights unavailable for this listing.</div>}
            {insightsState === 'credits' && (
              <div style={{ fontSize: '.72rem', color: 'var(--muted)', lineHeight: 1.6 }}>
                {isLoggedIn ? "Out of AI credits — insights will return soon." : <><a href="/login" style={{ color: 'var(--green)' }}>Sign in</a> to unlock AI insights.</>}
              </div>
            )}
            {insightsState === 'done' && insights && (
              <>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
                  {insights.what_they_want.map((item, i) => (
                    <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '.5rem', fontSize: '.78rem', color: 'var(--sub)', lineHeight: 1.5 }}>
                      <span style={{ color: 'var(--green)', fontSize: '.58rem', marginTop: '.2rem', flexShrink: 0 }}>▶</span>{item}
                    </li>
                  ))}
                </ul>
                {(insights.hidden_requirements?.length > 0 || insights.insider_tip) && (
                  <div style={{ marginTop: '.8rem', paddingTop: '.8rem', borderTop: '1px solid var(--line)' }}>
                    {insights.hidden_requirements?.length > 0 && (
                      <>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', textTransform: 'uppercase' as const, letterSpacing: '.08em', color: 'var(--dim)', marginBottom: '.45rem' }}>Unstated expectations</div>
                        <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 .7rem', display: 'flex', flexDirection: 'column', gap: '.38rem' }}>
                          {insights.hidden_requirements.map((r, i) => (
                            <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '.45rem', fontSize: '.72rem', color: 'var(--muted)', lineHeight: 1.5 }}>
                              <span style={{ color: 'var(--red)', fontSize: '.52rem', marginTop: '.2rem', flexShrink: 0 }}>◆</span>{r}
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                    {insights.insider_tip && (
                      <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 7, padding: '.6rem .8rem', fontSize: '.72rem', color: 'var(--sub)', lineHeight: 1.6 }}>
                        <span style={{ color: 'var(--green)', fontWeight: 700 }}>Tip: </span>{insights.insider_tip}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Description */}
          <div style={{ marginBottom: '1.1rem' }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.56rem', textTransform: 'uppercase' as const, letterSpacing: '.08em', color: 'var(--dim)', marginBottom: '.6rem' }}>ABOUT THIS ROLE</div>
            {insightsState === 'loading'
              ? <Skeleton widths={[95, 82, 90, 70, 86, 75, 92]} h={9} />
              : descParas.length > 0
                ? descParas.map((p, i) => <p key={i} style={{ fontSize: '.8rem', color: 'var(--sub)', lineHeight: 1.8, margin: '0 0 .75rem' }}>{p}</p>)
                : <p style={{ fontSize: '.8rem', color: 'var(--muted)', fontWeight: 300 }}>No description available.</p>
            }
          </div>

          {/* Report experience */}
          <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 12, padding: '1rem', marginBottom: '1rem' }}>
            <div style={{ fontFamily: 'var(--display)', fontSize: '.82rem', fontWeight: 700, color: 'var(--white)', marginBottom: '.22rem' }}>Report your experience</div>
            <p style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--sub)', marginBottom: '.75rem', lineHeight: 1.6 }}>Applied here? 60 seconds helps thousands of job seekers.</p>
            <div style={{ display: 'flex', gap: '.35rem', flexWrap: 'wrap' }}>
              {([
                { label: '👻 Ghosted',   outcome: 'ghosted',      bg: 'rgba(239,68,68,0.1)',    border: 'rgba(239,68,68,0.3)',    color: 'var(--red)'   },
                { label: '🤝 Rejected',  outcome: 'rejected',     bg: 'rgba(99,102,241,0.1)',  border: 'rgba(99,102,241,0.3)',  color: 'var(--blue)'  },
                { label: '📅 Interview', outcome: 'interviewing', bg: 'rgba(16,185,129,0.1)',  border: 'rgba(16,185,129,0.3)',  color: 'var(--green)' },
                { label: '✅ Offer',     outcome: 'hired',        bg: 'rgba(16,185,129,0.08)', border: 'rgba(16,185,129,0.2)',  color: 'var(--green)' },
              ] as const).map(({ label, outcome, bg, border, color }) => (
                <a key={outcome}
                  href={`/report?company=${encodeURIComponent(job.company)}&role=${encodeURIComponent(job.title)}&outcome=${outcome}`}
                  style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', background: bg, border: `1px solid ${border}`, color, borderRadius: 7, padding: '.32rem .7rem', textDecoration: 'none' }}>
                  {label}
                </a>
              ))}
            </div>
          </div>
        </div>

        {/* Sticky footer */}
        <div style={{ flexShrink: 0, borderTop: '1px solid var(--line2)', padding: '.85rem 1.15rem', background: 'var(--ink)' }}>
          <button
            onClick={() => onCheckCompany(job.company)}
            style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--amber)', padding: '.05rem 0 .45rem', opacity: .85, cursor: 'pointer' }}
          >
            🏢 Check {job.company} →
          </button>
          <div style={{ display: 'flex', gap: '.6rem' }}>
            <button onClick={toggleSave} style={{ background: 'none', border: '1px solid var(--line2)', borderRadius: 8, padding: '.58rem .85rem', fontSize: '.95rem', cursor: 'pointer', color: saved ? 'var(--green)' : 'var(--muted)', flexShrink: 0 }}>{saved ? '♥' : '♡'}</button>
            {job.apply_url
              ? <button
                  onClick={() => { onClose(); onApply(job) }}
                  style={{ flex: 1, textAlign: 'center', background: 'var(--green)', color: 'var(--ink)', borderRadius: 8, padding: '.58rem 1rem', fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.82rem', border: 'none', cursor: 'pointer' }}
                >Apply &amp; Optimize →</button>
              : <button disabled style={{ flex: 1, background: 'var(--raised)', color: 'var(--muted)', border: 'none', borderRadius: 8, padding: '.58rem 1rem', fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.82rem', opacity: .45 }}>No apply link</button>
            }
          </div>
        </div>
      </div>
    </>
  )
}

// ── Company Preview Modal ─────────────────────────────────────────────────────

interface CoPreviewScore {
  overall_score: number
  ghost_rate: number
  response_rate: number
  avg_wait_days: number
  avg_rounds: number
  waste: number
  report_count: number
  data_quality?: string
}

function coVibes(sc: CoPreviewScore): { label: string; cls: string }[] {
  const vibes: { label: string; cls: string }[] = []
  if (sc.ghost_rate > 0.55)       vibes.push({ label: '👻 Frequent ghosting', cls: 'v-r' })
  else if (sc.ghost_rate > 0.4)   vibes.push({ label: '👻 High ghost rate',   cls: 'v-r' })
  if (sc.avg_wait_days > 21)      vibes.push({ label: `⏳ ${sc.avg_wait_days}d avg wait`, cls: 'v-y' })
  if (sc.avg_rounds >= 4)         vibes.push({ label: `📋 ${sc.avg_rounds.toFixed(1)} rounds avg`, cls: 'v-b' })
  if (sc.waste > 55)              vibes.push({ label: '⚠ High waste risk',    cls: 'v-y' })
  if (sc.response_rate > 0.72)    vibes.push({ label: '✅ Highly responsive', cls: 'v-g' })
  if (sc.overall_score >= 80)     vibes.push({ label: '🌟 Strong process',    cls: 'v-g' })
  if (sc.overall_score < 35)      vibes.push({ label: '❌ Low transparency',   cls: 'v-r' })
  return vibes.slice(0, 4)
}

function coGrade(s: number) {
  if (s >= 80) return 'A'; if (s >= 65) return 'B'
  if (s >= 50) return 'C'; if (s >= 35) return 'D'; return 'F'
}

function CoPreviewModal({ company, onClose }: { company: string; onClose: () => void }) {
  const [sc, setSc] = useState<CoPreviewScore | null>(null)
  const [loading, setLoading] = useState(true)
  const slug = encodeURIComponent(company.toLowerCase().replace(/\s+/g, '-'))

  useEffect(() => {
    setLoading(true)
    setSc(null)
    fetch('/api/reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: company }),
    })
      .then(r => r.ok ? r.json() : {})
      .then((d: { score?: CoPreviewScore }) => { if (d.score) setSc(d.score) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [company])

  const risk = sc ? (sc.overall_score >= 65 ? 'safe' : sc.overall_score >= 40 ? 'warn' : 'danger') : 'warn'
  const glowColor = risk === 'safe' ? 'rgba(16,185,129,0.3)' : risk === 'danger' ? 'rgba(239,68,68,0.3)' : 'rgba(245,158,11,0.3)'
  const borderColor = risk === 'safe' ? 'rgba(16,185,129,0.35)' : risk === 'danger' ? 'rgba(239,68,68,0.35)' : 'rgba(245,158,11,0.35)'
  const gradeColor = risk === 'safe' ? 'var(--green)' : risk === 'danger' ? 'var(--red)' : 'var(--amber)'

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9500, background: 'rgba(0,0,0,.8)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <div
        style={{
          position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
          width: 'calc(100% - 2rem)', maxWidth: 400,
          background: 'var(--surface)', borderRadius: 16, overflow: 'hidden',
          border: `1px solid ${borderColor}`,
          boxShadow: `0 0 60px ${glowColor}, 0 0 120px ${glowColor.replace('0.3', '0.12')}`,
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding: '1rem 1.15rem .75rem', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontFamily: 'var(--display)', fontSize: '1rem', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.02em' }}>{company}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--dim)', cursor: 'pointer', fontSize: '1rem', padding: '.2rem .3rem', lineHeight: 1 }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ padding: '1.15rem' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '1.5rem 0', fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'var(--muted)' }}>
              <div style={{ fontSize: '1.25rem', marginBottom: '.5rem', animation: 'spin 1s linear infinite' }}>🔍</div>
              Checking hiring data...
            </div>
          ) : sc ? (
            <>
              {/* Grade + score */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '.85rem', marginBottom: '.75rem' }}>
                <div style={{ fontFamily: 'var(--display)', fontSize: '3rem', fontWeight: 800, color: gradeColor, lineHeight: 1, letterSpacing: '-.04em' }}>{coGrade(sc.overall_score)}</div>
                <div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--muted)' }}>Seen Score</div>
                  <div style={{ fontFamily: 'var(--display)', fontSize: '1.6rem', fontWeight: 800, color: 'var(--white)', lineHeight: 1, letterSpacing: '-.03em' }}>{sc.overall_score}<span style={{ fontSize: '.9rem', color: 'var(--muted)' }}>/100</span></div>
                  {sc.report_count > 0 && <div style={{ fontFamily: 'var(--mono)', fontSize: '.5rem', color: 'var(--dim)', marginTop: '.15rem' }}>{sc.report_count} reports</div>}
                </div>
              </div>

              {/* Vibe tags */}
              {coVibes(sc).length > 0 && (
                <div style={{ display: 'flex', gap: '.28rem', flexWrap: 'wrap', marginBottom: '.85rem' }}>
                  {coVibes(sc).map(v => <span key={v.label} className={`vibe ${v.cls}`}>{v.label}</span>)}
                </div>
              )}

              {/* Key stats */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '.5rem', marginBottom: '1rem' }}>
                {[
                  { label: 'Response', value: `${Math.round((sc.response_rate || 0) * 100)}%` },
                  { label: 'Ghosts',   value: `${Math.round((sc.ghost_rate || 0) * 100)}%`    },
                  { label: 'Avg wait', value: `${sc.avg_wait_days || '—'}d`                   },
                ].map(({ label, value }) => (
                  <div key={label} style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 8, padding: '.55rem .6rem', textAlign: 'center' }}>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: '.95rem', fontWeight: 500, color: 'var(--white)', lineHeight: 1, marginBottom: '.18rem' }}>{value}</div>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: '.48rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.06em' }}>{label}</div>
                  </div>
                ))}
              </div>

              <a
                href={`/company/${slug}`}
                style={{ display: 'block', width: '100%', textAlign: 'center', background: 'linear-gradient(135deg,#3b82f6,#8b5cf6)', color: '#fff', border: 'none', borderRadius: 9, padding: '.7rem 1rem', fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.88rem', cursor: 'pointer', textDecoration: 'none', boxShadow: '0 0 20px rgba(59,130,246,0.3)' }}
              >
                View full company →
              </a>
            </>
          ) : (
            <div style={{ textAlign: 'center', padding: '1.5rem 0', fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'var(--muted)' }}>
              No data found for this company yet.<br />
              <a href={`/company/${slug}`} style={{ color: 'var(--blue)', textDecoration: 'none', marginTop: '.5rem', display: 'inline-block' }}>View company page →</a>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function JobCard({ job, index, onSaveToggle, onOpen, onApply, onCheckCompany, alreadyApplied }: { job: Job; index: number; onSaveToggle: (id: string) => void; onOpen: (job: Job) => void; onApply: (job: Job) => void; onCheckCompany: (company: string) => void; alreadyApplied?: boolean }) {
  const risk = Score.risk(job.score)
  const wl = Score.wasteLabel(job.waste)
  const vibes = jobVibes(job)
  const [saved, setSaved] = useState(() => SavedJobsStore.isSaved(job.id))
  const [reportedInactive, setReportedInactive] = useState(false)
  const [reportingInactive, setReportingInactive] = useState(false)
  const { user } = useAuth()
  const logoLetter = (job.company || '?')[0].toUpperCase()

  async function reportInactive(e: React.MouseEvent) {
    e.stopPropagation()
    if (!user) { alert('Sign in to report listings.'); return }
    setReportingInactive(true)
    try {
      await fetch('/api/user-sync', {
        method: 'POST',
        headers: await aiHeaders(),
        body: JSON.stringify({ action: 'report_job_availability', job_id: String(job.id), status: 'expired' }),
      })
      setReportedInactive(true)
    } catch { /* silent */ } finally {
      setReportingInactive(false)
    }
  }

  function toggleSave(e: React.MouseEvent) {
    e.stopPropagation()
    if (saved) {
      SavedJobsStore.remove(job.id, false)
      setSaved(false)
    } else {
      SavedJobsStore.save(job, false)
      setSaved(true)
    }
    onSaveToggle(job.id)
  }

  return (
    <div className={`jlc ${risk}`} style={{ animation: `fadeUp .4s ${Math.min(index, 12) * 0.06}s ease both` }}>
      <div
        className="jlc-top"
        onClick={() => onOpen(job)}
        role="button"
        tabIndex={0}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(job) } }}
        style={{ cursor: 'pointer' }}
      >
        <div className="jrc-logo">{logoLetter}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="jlc-title">{job.title}</div>
          <div className="jlc-co">{job.company}</div>
          <div className="jlc-loc">📍 {job.location}</div>
        </div>
        <ScoreRing score={job.score} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '.35rem', flexWrap: 'wrap', margin: '.35rem 0' }}>
        <span className={`${wl.cls} waste-badge`}>{wl.txt}</span>
        {job.waste >= 55 && (
          <span className="vibe v-r" style={{ display: 'inline-flex', alignItems: 'center', gap: '.25rem' }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--red)', animation: 'pulse 1.2s infinite', display: 'inline-block', flexShrink: 0 }} />
            👻 high ghost risk
          </span>
        )}
        {job.availability_status === 'stale' && (
          <span className="vibe v-a" style={{ fontSize: '.57rem' }}>⚠ may be closed</span>
        )}
        {(job.availability_status === 'expired' || job.availability_status === 'closed') && (
          <span className="vibe v-r" style={{ fontSize: '.57rem' }}>✕ likely closed</span>
        )}
        {vibes.map((v, i) => (
          <span key={i} className={`vibe ${v.cls}`}>{v.txt}</span>
        ))}
        {alreadyApplied && (
          <span style={{ fontFamily: 'var(--mono)', fontSize: '.57rem', background: 'rgba(99,102,241,.1)', border: '1px solid rgba(99,102,241,.22)', borderRadius: 5, padding: '.12rem .4rem', color: 'var(--indigo)' }}>✓ Applied</span>
        )}
      </div>

      {job.description && (
        <div style={{ fontSize: '.72rem', color: 'var(--muted)', margin: '.25rem 0', lineHeight: 1.55 }}>
          {job.description.slice(0, 120)}...
        </div>
      )}

      <div className="jlc-meta">
        <span className="jlc-mi">{job.type || 'Full-time'}</span>
        <span className="jlc-mi">·</span>
        <span className="jlc-mi">{job.level}</span>
        {job.salary && <><span className="jlc-mi">·</span><span className="jlc-sal">{job.salary}</span></>}
        <span className="jlc-mi">·</span>
        <span className="jlc-mi" style={{ color: 'var(--blue)' }}>{job.source || 'Job board'}</span>
      </div>

      <button
        onClick={e => { e.stopPropagation(); onCheckCompany(job.company) }}
        style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--amber)', padding: '.1rem 0 .55rem', opacity: .8, cursor: 'pointer' }}
      >
        🏢 Check {job.company} →
      </button>

      <div className="jlc-actions">
        <button
          className="jlc-save"
          data-saved={saved ? '1' : '0'}
          onClick={toggleSave}
          aria-label={saved ? 'Unsave' : 'Save'}
        >
          {saved ? '♥' : '♡'}
        </button>
        <button
          className="jlc-apply"
          onClick={e => { e.stopPropagation(); onApply(job) }}
          disabled={!job.apply_url}
        >
          Apply &amp; Optimize →
        </button>
      </div>

      <button
        onClick={() => onOpen(job)}
        style={{ display: 'block', width: '100%', textAlign: 'center', background: 'none', border: 'none', borderTop: '1px solid var(--line)', marginTop: '.6rem', paddingTop: '.6rem', fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--green)', cursor: 'pointer' }}
      >
        View details + AI insights →
      </button>

      {!reportedInactive ? (
        <button
          onClick={reportInactive}
          disabled={reportingInactive}
          style={{ background: 'none', border: 'none', fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--dim)', cursor: 'pointer', padding: '.1rem 0', opacity: .55, transition: 'opacity .15s', display: 'block' }}
          onMouseOver={e => (e.currentTarget.style.opacity = '1')}
          onMouseOut={e => (e.currentTarget.style.opacity = '.55')}
        >
          {reportingInactive ? 'Reporting…' : '⚑ Not active? Report it'}
        </button>
      ) : (
        <span style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--amber)', display: 'block', padding: '.1rem 0' }}>✓ Reported — thanks</span>
      )}
    </div>
  )
}

// ── SwipeJobDeck ──────────────────────────────────────────────────────────────

function SwipeJobDeck({ jobs, onOpen, onDismiss, onSave, onApply, coScores }: {
  jobs: Job[]
  onOpen: (job: Job) => void
  onDismiss: () => void
  onSave?: () => void
  onApply?: (job: Job) => void
  coScores?: Record<string, {ghost_rate: number; overall_score: number; response_rate?: number}>
}) {
  const [stack, setStack] = useState<Job[]>(() => [...jobs])
  const [deltaX, setDeltaX] = useState(0)
  const [deltaY, setDeltaY] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const [flyDir, setFlyDir] = useState<'left' | 'right' | 'up' | null>(null)
  const [savedCount, setSavedCount] = useState(0)
  const startXRef = useRef(0)
  const startYRef = useRef(0)
  const deltaYRef = useRef(0)
  const hasMoved = useRef(false)
  const cardRef = useRef<HTMLDivElement>(null)
  const { isLoggedIn } = useAuth()

  // Keep stack in sync when jobs prop changes (e.g. initial load)
  useEffect(() => { setStack([...jobs]) }, [jobs])

  const topJob = stack[0] ?? null
  const secondJob = stack[1] ?? null
  const thirdJob = stack[2] ?? null

  const badgeOpacity = Math.min(1, Math.abs(deltaX) / 80)
  const applyBadgeOpacity = Math.min(1, Math.abs(deltaY) / 80)
  const showLeft = deltaX < -40
  const showRight = deltaX > 40
  const showUp = deltaY < -30 && Math.abs(deltaX) < 80

  // Swipe-right is the "♡ Save" gesture — it must add to Saved Jobs (same as the
  // list-view heart), not create a tracker application. (Apply is the up-swipe.)
  function saveJob(job: Job) {
    SavedJobsStore.save(job, isLoggedIn)
  }

  function advance(dir: 'left' | 'right' | 'up') {
    if (!topJob) return
    if (dir === 'right') {
      saveJob(topJob)
      setSavedCount(c => c + 1)
      onSave?.()
    }
    if (dir === 'up') {
      onApply?.(topJob)
    }
    setFlyDir(dir)
    setTimeout(() => {
      setStack(prev => {
        const next = prev.slice(1)
        if (next.length === 0) onDismiss()
        return next
      })
      setFlyDir(null)
      setDeltaX(0)
      setDeltaY(0)
      deltaYRef.current = 0
      setIsDragging(false)
    }, 300)
  }

  function onPointerStart(clientX: number, clientY: number) {
    if (flyDir) return
    startXRef.current = clientX
    startYRef.current = clientY
    hasMoved.current = false
    setIsDragging(true)
    setDeltaX(0)
    setDeltaY(0)
    deltaYRef.current = 0
  }

  function onPointerMove(clientX: number, clientY: number) {
    if (!isDragging || flyDir) return
    const dx = clientX - startXRef.current
    const dy = clientY - startYRef.current
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) hasMoved.current = true
    setDeltaX(dx)
    setDeltaY(dy)
    deltaYRef.current = dy
  }

  function onPointerEnd() {
    if (!isDragging || flyDir) return
    if (!hasMoved.current && topJob) {
      setIsDragging(false)
      setDeltaX(0)
      setDeltaY(0)
      deltaYRef.current = 0
      onOpen(topJob)
      return
    }
    const dy = deltaYRef.current
    if (dy < -80 && Math.abs(deltaX) < 80) {
      advance('up')
    } else if (Math.abs(deltaX) > 80) {
      advance(deltaX > 0 ? 'right' : 'left')
    } else {
      if (cardRef.current) cardRef.current.classList.add('snap-back')
      setDeltaX(0)
      setDeltaY(0)
      deltaYRef.current = 0
      setIsDragging(false)
      setTimeout(() => {
        if (cardRef.current) cardRef.current.classList.remove('snap-back')
      }, 350)
    }
  }

  // Mouse event handlers
  function onMouseDown(e: React.MouseEvent) {
    e.preventDefault()
    onPointerStart(e.clientX, e.clientY)

    function onMouseMove(ev: MouseEvent) { onPointerMove(ev.clientX, ev.clientY) }
    function onMouseUp() {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      onPointerEnd()
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }

  // Touch event handlers
  function onTouchStart(e: React.TouchEvent) {
    const t = e.touches[0]
    onPointerStart(t.clientX, t.clientY)
  }

  function onTouchMove(e: React.TouchEvent) {
    const t = e.touches[0]
    onPointerMove(t.clientX, t.clientY)
  }

  function onTouchEnd() { onPointerEnd() }

  if (stack.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '1.5rem 1rem', background: 'rgba(99,102,241,.06)', border: '1px solid rgba(99,102,241,.18)', borderRadius: 14 }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--green)', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '.4rem' }}>Deck cleared</div>
        <div style={{ fontFamily: 'var(--display)', fontSize: '1rem', fontWeight: 700, color: 'var(--white)', letterSpacing: '-.02em', marginBottom: '.3rem' }}>
          You matched {savedCount} job{savedCount !== 1 ? 's' : ''}
        </div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--sub)', marginBottom: '1rem' }}>
          Saved applications are in your tracker
        </div>
        <div style={{ display: 'flex', gap: '.5rem', justifyContent: 'center', flexWrap: 'wrap' }}>
          <a href="/resume" style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', padding: '.35rem .8rem', background: 'rgba(99,102,241,.15)', border: '1px solid rgba(99,102,241,.35)', borderRadius: 7, color: 'var(--indigo)', textDecoration: 'none' }}>See all matches →</a>
          <button onClick={() => setStack([...jobs])} style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', padding: '.35rem .8rem', background: 'none', border: '1px solid var(--line2)', borderRadius: 7, color: 'var(--dim)', cursor: 'pointer' }}>Replay deck</button>
        </div>
      </div>
    )
  }

  // Top card transform
  let topTransform = ''
  let topOpacity = 1
  if (flyDir === 'left') {
    topTransform = 'translateX(-120%) rotate(-18deg)'
    topOpacity = 0
  } else if (flyDir === 'right') {
    topTransform = 'translateX(120%) rotate(18deg)'
    topOpacity = 0
  } else if (flyDir === 'up') {
    topTransform = 'translateY(-130%) scale(0.9)'
    topOpacity = 0
  } else if (isDragging) {
    topTransform = `translate(${deltaX}px, ${Math.min(0, deltaY)}px) rotate(${deltaX * 0.05}deg)`
  }

  // Second card scale animates toward 1.0 as user drags
  const dragProgress = Math.min(1, Math.abs(deltaX) / 80)
  const secondScale = 0.96 + dragProgress * 0.04
  const secondY = 8 - dragProgress * 8

  const scoreRisk = (score: number): 'safe' | 'warn' | 'danger' => score >= 75 ? 'safe' : score >= 50 ? 'warn' : 'danger'
  const scoreColor = (score: number) => score >= 75 ? 'var(--green)' : score >= 50 ? 'var(--amber)' : 'var(--red)'
  // Continuous HSL scale: 25→0° (red), 60→60° (yellow), 95→120° (green)
  const scoreHsl = (score: number, alpha: number) => {
    const t = Math.max(0, Math.min(1, (score - 25) / 70))
    const hue = Math.round(t * 120)
    return `hsla(${hue}, 80%, 55%, ${alpha})`
  }
  const scoreGradient = (score: number) =>
    `linear-gradient(145deg, ${scoreHsl(score, .15)} 0%, transparent 60%)`
  const scoreBorder = (score: number) => scoreHsl(score, .45)
  const scoreGlow = (score: number) => scoreHsl(score, .2)
  const scoreStripe = (score: number) => scoreHsl(score, .75)

  return (
  <div>
    <div className="swipe-deck" aria-label="Swipe job cards — drag right to save, left to pass" style={{ height: 340 }}>
      {/* Third peek card */}
      {thirdJob && (
        <div className="swipe-peek" style={{ transform: 'scale(0.92) translateY(16px)', transformOrigin: 'bottom center', zIndex: 1 }} />
      )}
      {/* Second peek card */}
      {secondJob && (
        <div className="swipe-peek" style={{ transform: `scale(${secondScale}) translateY(${secondY}px)`, transformOrigin: 'bottom center', zIndex: 2, transition: isDragging ? 'none' : 'transform .2s ease' }} />
      )}
      {/* Top card */}
      <div
        ref={cardRef}
        className="swipe-card"
        style={{
          transform: topTransform, opacity: topOpacity, zIndex: 3,
          transition: flyDir ? 'transform .3s ease, opacity .3s ease' : undefined,
          background: scoreGradient(topJob.score),
          borderColor: scoreBorder(topJob.score),
          boxShadow: `0 8px 32px rgba(0,0,0,.45), 0 0 48px ${scoreGlow(topJob.score)}, inset 0 2px 0 ${scoreStripe(topJob.score)}, inset 0 1px 0 rgba(255,255,255,.08)`,
        }}
        onMouseDown={onMouseDown}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {/* PASS badge */}
        <span className="swipe-badge swipe-badge-l" style={{ opacity: showLeft ? badgeOpacity : 0 }}>✕ Pass</span>
        {/* SAVE badge */}
        <span className="swipe-badge swipe-badge-r" style={{ opacity: showRight ? badgeOpacity : 0 }}>♡ Save</span>
        {/* APPLY badge (up swipe) */}
        <span style={{
          position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
          fontFamily: 'var(--mono)', fontSize: '.75rem', fontWeight: 700,
          color: 'var(--blue)', background: 'rgba(59,130,246,.15)',
          border: '1.5px solid rgba(59,130,246,.5)', borderRadius: 7,
          padding: '.3rem .7rem', pointerEvents: 'none',
          opacity: showUp ? applyBadgeOpacity : 0, transition: 'opacity .1s',
        }}>↑ Apply Now</span>

        {/* Card content */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '.75rem', marginBottom: '.6rem' }}>
          <div style={{
            width: 42, height: 42, borderRadius: 10,
            background: `linear-gradient(135deg, ${scoreHsl(topJob.score, .25)}, rgba(255,255,255,.06))`,
            border: `1px solid ${scoreBorder(topJob.score)}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'var(--display)', fontWeight: 800, fontSize: '1.05rem',
            color: scoreHsl(topJob.score, 1), flexShrink: 0,
          }}>
            {(topJob.company || '?')[0].toUpperCase()}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--display)', fontSize: '.92rem', fontWeight: 700, color: 'var(--white)', letterSpacing: '-.02em', lineHeight: 1.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{topJob.title}</div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--dim)', marginTop: '.12rem' }}>{topJob.company}{topJob.location ? ` · ${topJob.location}` : ''}</div>
          </div>
          <div className={`sring ${scoreRisk(topJob.score)}`} style={{ width: 40, height: 40, flexShrink: 0 }}>
            <div className="sring-n" style={{ fontSize: '.8rem' }}>{topJob.score}</div>
          </div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.3rem', marginBottom: '.55rem' }}>
          {topJob.salary && <span style={{ background: 'rgba(16,185,129,.12)', border: '1px solid rgba(16,185,129,.3)', borderRadius: 5, padding: '.17rem .5rem', fontSize: '.6rem', fontFamily: 'var(--mono)', color: 'var(--green)', fontWeight: 600 }}>{topJob.salary}</span>}
          {topJob.type && <span style={{ background: 'rgba(99,102,241,.1)', border: '1px solid rgba(99,102,241,.25)', borderRadius: 5, padding: '.17rem .5rem', fontSize: '.6rem', fontFamily: 'var(--mono)', color: '#a5b4fc' }}>{topJob.type}</span>}
          {topJob.level && <span style={{ background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 5, padding: '.17rem .5rem', fontSize: '.6rem', fontFamily: 'var(--mono)', color: 'var(--sub)' }}>{topJob.level}</span>}
        </div>

        {topJob.description && (
          <div style={{ fontFamily: 'var(--body)', fontSize: '.7rem', color: 'var(--muted)', lineHeight: 1.55, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
            {topJob.description}
          </div>
        )}

        {(() => {
          const sc = coScores?.[topJob.company.toLowerCase()]
          if (!sc || sc.ghost_rate <= 0.3) return null
          const ghostPct = Math.round(sc.ghost_rate * 100)
          const isHigh = sc.ghost_rate > 0.55
          return (
            <div style={{ marginTop: '.45rem', display: 'flex', alignItems: 'center', gap: '.3rem' }}>
              <span style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', color: isHigh ? 'var(--red)' : 'var(--amber)', background: isHigh ? 'rgba(239,68,68,.1)' : 'rgba(245,158,11,.1)', border: `1px solid ${isHigh ? 'rgba(239,68,68,.25)' : 'rgba(245,158,11,.25)'}`, borderRadius: 5, padding: '.12rem .4rem' }}>
                {isHigh ? '👻' : '⚠'} {ghostPct}% of applicants never hear back
              </span>
            </div>
          )
        })()}

        {(() => {
          const sc = coScores?.[topJob.company.toLowerCase()]
          if (!sc) return null
          return (
            <HiringProbability
              responseRate={sc.response_rate ?? (sc.overall_score ? sc.overall_score / 100 * 0.45 : 0.20)}
              ghostRate={sc.ghost_rate || 0.55}
              jobLevel={topJob.level}
              compact
            />
          )
        })()}

        <div style={{ position: 'absolute', bottom: '.9rem', left: '1.15rem', right: '1.15rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', color: 'var(--muted)' }}>{topJob.source || 'Job board'}</span>
          <span style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', color: 'var(--dim)' }}>{stack.length} left{savedCount > 0 ? ` · ♡ ${savedCount} saved` : ''}</span>
        </div>
      </div>
    </div>

    {/* Action buttons */}
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '1rem', marginTop: '1rem' }}>
      <button
        onClick={() => advance('left')}
        title="Skip"
        style={{ width: 50, height: 50, borderRadius: '50%', border: '1px solid var(--line2)', background: 'var(--card)', color: 'var(--dim)', fontSize: '1.1rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--mono)' }}
      >✕</button>
      <button
        onClick={() => advance('up')}
        title="Apply now"
        style={{ width: 62, height: 62, borderRadius: '50%', border: '1px solid rgba(59,130,246,.45)', background: 'rgba(59,130,246,.12)', color: 'var(--blue)', fontSize: '1.35rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}
      >↑</button>
      <button
        onClick={() => advance('right')}
        title="Save"
        style={{ width: 50, height: 50, borderRadius: '50%', border: '1px solid rgba(16,185,129,.45)', background: 'rgba(16,185,129,.12)', color: 'var(--green)', fontSize: '1.1rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >♡</button>
    </div>
    <div style={{ textAlign: 'center', marginTop: '.4rem', fontFamily: 'var(--mono)', fontSize: '.52rem', color: 'var(--muted)', letterSpacing: '.04em' }}>
      drag or tap the buttons to decide
    </div>
  </div>
  )
}


const US_CITIES = ['New York, NY','Los Angeles, CA','Chicago, IL','Houston, TX','Phoenix, AZ','San Antonio, TX','San Diego, CA','Dallas, TX','San Jose, CA','Austin, TX','Seattle, WA','Denver, CO','Boston, MA','Atlanta, GA','Miami, FL','Portland, OR','Las Vegas, NV','San Francisco, CA','Washington, DC','Charlotte, NC','Nashville, TN','Minneapolis, MN','Raleigh, NC','Detroit, MI','Sacramento, CA']

export default function JobsPage() {
  const router = useRouter()
  const { isLoggedIn, profile } = useAuth()
  const [query, setQuery] = useState('')
  const [location, setLocation] = useState('')
  const autoSearchedRef = useRef(false)
  const [locSuggs, setLocSuggs] = useState<string[]>([])
  const [showLocSuggs, setShowLocSuggs] = useState(false)
  const [gpsLoading, setGpsLoading] = useState(false)
  const [radius, setRadius] = useState('25')
  const [niche, setNiche] = useState<NicheFilter>('')
  const [level, setLevel] = useState<LevelFilter>('')
  const [jobType, setJobType] = useState<TypeFilter>('')
  const [posted, setPosted] = useState<PostedFilter>('')
  const [sort, setSort] = useState<SortMode>('transparency')
  const [jobs, setJobs] = useState<Job[]>([])
  const [filtered, setFiltered] = useState<Job[]>([])
  const [applyJob, setApplyJob] = useState<Job | null>(null)
  const [checkCompany, setCheckCompany] = useState<string | null>(null)
  const [detailJob, setDetailJob] = useState<Job | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [statusMsg, setStatusMsg] = useState('Enter a search above →')
  const [saveVersion, setSaveVersion] = useState(0)
  const [recommended, setRecommended] = useState<Job[]>([])
  const [recSkills, setRecSkills] = useState<string[]>([])
  const [recStatus, setRecStatus] = useState<'idle' | 'loading' | 'done'>('idle')
  const [swipeCount, setSwipeCount] = useState(0)
  const [deckDone, setDeckDone] = useState(false)
  const [swipeMode, setSwipeMode] = useState(false)
  const [checkpointJob, setCheckpointJob] = useState<Job | null>(null)
  const [coScores, setCoScores] = useState<Record<string, {ghost_rate: number; overall_score: number; response_rate?: number}>>({})
  const [appliedCos, setAppliedCos] = useState<Set<string>>(new Set())
  const abortRef = useRef<AbortController | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const hasFilters = !!(niche || level || jobType || posted)

  function applySort(list: Job[], mode: SortMode): Job[] {
    const copy = [...list]
    if (mode === 'waste') return copy.sort((a, b) => a.waste - b.waste)
    if (mode === 'recent') return copy // preserve server order (most recent first)
    return copy.sort((a, b) => b.score - a.score) // transparency
  }

  function applyFilters(list: Job[]): Job[] {
    let out = list
    if (niche) out = out.filter(j => {
      const src = (j.source || '').toLowerCase()
      const title = (j.title || '').toLowerCase()
      if (niche === 'tech') return src.includes('tech') || title.match(/engineer|developer|software|data|devops|product/i) !== null
      if (niche === 'healthcare') return title.match(/nurse|doctor|health|medical|pharmacy|clinical/i) !== null
      if (niche === 'retail') return title.match(/retail|store|cashier|food|restaurant|barista/i) !== null
      if (niche === 'logistics') return title.match(/driver|warehouse|logistics|supply|delivery/i) !== null
      if (niche === 'finance') return title.match(/finance|accounting|analyst|banker|insurance/i) !== null
      return true
    })
    if (level) out = out.filter(j => (j.level || '').toLowerCase().includes(level))
    if (jobType) out = out.filter(j => j.type === jobType)
    return out
  }

  const updateDisplay = useCallback((list: Job[], sortMode: SortMode) => {
    const f = applyFilters(list)
    // Never blank the board: if active filters zero out a non-empty result set, fall
    // back to showing all nearby roles with a note, rather than "No results".
    if (f.length === 0 && list.length > 0) {
      const s = applySort(list, sortMode)
      setFiltered(s)
      setStatusMsg(`No exact filter matches — showing all ${s.length} nearby role${s.length !== 1 ? 's' : ''}`)
      return
    }
    const s = applySort(f, sortMode)
    setFiltered(s)
    setStatusMsg(s.length === 0 ? 'No results. Try a different title or wider radius.' : `${s.length} result${s.length !== 1 ? 's' : ''}`)
  }, [niche, level, jobType, posted]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (jobs.length > 0) updateDisplay(jobs, sort)
  }, [niche, level, jobType, posted, sort]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-request GPS on mount; fall back to profile city if GPS denied
  useEffect(() => {
    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      requestGpsLocation()
    } else if (profile?.city) {
      setLocation(profile.city)
      if (!autoSearchedRef.current) { autoSearchedRef.current = true; searchJobs(undefined, profile.city) }
    }
    // Pre-load last search from recent history (delayed to not conflict with GPS)
    const t = setTimeout(() => {
      if (!autoSearchedRef.current) {
        try {
          const recent = RecentSearchesStore.get()
          if (recent.length > 0) {
            const last = recent[0]
            setQuery(last.name)
            if (last.loc) setLocation(last.loc)
            autoSearchedRef.current = true
            searchJobs(last.name, last.loc)
          }
        } catch {}
      }
    }, 1200)
    return () => clearTimeout(t)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Once profile loads, if location still empty, pre-fill and auto-search
  useEffect(() => {
    if (!autoSearchedRef.current && !location.trim() && profile?.city && !gpsLoading) {
      autoSearchedRef.current = true
      setLocation(profile.city)
      searchJobs(undefined, profile.city)
    }
  }, [profile?.city]) // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch resume-powered recommendations when logged in
  useEffect(() => {
    if (!isLoggedIn) return
    setRecStatus('loading')
    aiHeaders().then(hdrs => fetch('/api/jobs', {
      method: 'POST',
      headers: hdrs,
      body: JSON.stringify({ action: 'recommended' }),
    }))
    .then(r => r.ok ? r.json() : {})
    .then((data: { jobs?: unknown[]; skills?: string[] }) => {
      if (Array.isArray(data.jobs) && data.jobs.length) {
        const raw: Job[] = (data.jobs as Record<string, unknown>[]).map(j => ({
          id: String(j.id || 'rec_' + Math.random().toString(36).slice(2, 8)),
          title: String(j.title || ''),
          company: String(j.company || ''),
          location: String(j.location || 'US'),
          score: Number(j.score) || 65,
          waste: Number(j.waste_score ?? j.waste) || 25,
          level: String(j.level || 'Mid level'),
          type: String(j.type || 'Full-time'),
          source: String(j.source || 'Seen'),
          description: String(j.description || ''),
          salary: j.salary ? String(j.salary) : null,
          apply_url: j.apply_url ? String(j.apply_url) : (j.url ? String(j.url) : null),
        }))
        setRecommended(raw)
        setRecSkills(Array.isArray(data.skills) ? data.skills : [])
      }
    })
    .catch(() => {})
    .finally(() => setRecStatus('done'))
  }, [isLoggedIn]) // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch ghost rates for companies in the swipe deck
  useEffect(() => {
    if (!recommended.length) return
    const cos = [...new Set(recommended.map(j => j.company.toLowerCase().trim()).filter(Boolean))].slice(0, 30)
    fetch('/api/reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'batch_scores', names: cos }),
    })
      .then(r => r.ok ? r.json() : { scores: {} })
      .then((d: { scores?: Record<string, {ghost_rate: number; overall_score: number; response_rate?: number}> }) => {
        if (d.scores) setCoScores(d.scores)
      })
      .catch(() => {})
  }, [recommended])

  useEffect(() => {
    try {
      const apps = AppStore.loadSync()
      setAppliedCos(new Set(apps.map(a => a.company.toLowerCase().trim())))
    } catch {}
  }, [])

  useEffect(() => {
    if (!profile?.experience || level) return // don't override if user already set it
    const exp = profile.experience.toLowerCase()
    if (exp.includes('entry') || exp.includes('0-1') || exp.includes('junior') || exp.includes('intern')) {
      setLevel('entry')
    } else if (exp.includes('senior') || exp.includes('5+') || exp.includes('lead') || exp.includes('staff') || exp.includes('principal')) {
      setLevel('senior')
    } else if (exp.includes('mid') || exp.includes('2-') || exp.includes('3-') || exp.includes('4-')) {
      setLevel('mid')
    }
  }, [profile?.experience]) // eslint-disable-line react-hooks/exhaustive-deps

  async function requestGpsLocation() {
    if (!navigator.geolocation || location.trim()) return
    setGpsLoading(true)
    try {
      const pos = await new Promise<GeolocationPosition>((res, rej) =>
        navigator.geolocation.getCurrentPosition(res, rej, { timeout: 8000, maximumAge: 300000 })
      )
      const { latitude: lat, longitude: lon } = pos.coords
      const r = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`,
        { headers: { 'User-Agent': 'seenjobs.io/1.0', 'Accept-Language': 'en' } }
      )
      if (!r.ok) throw new Error('geocode')
      const geo = await r.json() as { address: Record<string, string> }
      const city = geo.address.city || geo.address.town || geo.address.village || geo.address.county || ''
      const state = geo.address.state || ''
      const loc = city && state ? `${city}, ${state}` : city || state
      if (loc) {
        setLocation(loc)
        if (!autoSearchedRef.current) { autoSearchedRef.current = true; searchJobs(undefined, loc) }
      }
    } catch {
      // GPS failed — fall back to profile city
      if (profile?.city && !autoSearchedRef.current) {
        autoSearchedRef.current = true
        setLocation(profile.city)
        searchJobs(undefined, profile.city)
      }
    }
    finally { setGpsLoading(false) }
  }

  async function searchJobs(queryOverride?: string, locationOverride?: string) {
    const q = (queryOverride ?? query).trim()
    const loc = (locationOverride ?? location).trim()
    if (!q && !loc) {
      setStatusMsg('Enter a job title or location to search.')
      return
    }

    const cacheKey = `${q}|${loc}|${radius}`
    const cached = searchCache.get(cacheKey)
    const CACHE_TTL = 5 * 60 * 1000 // 5 min
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      // Serve cached results immediately, then silently refresh in background
      setJobs(cached.jobs)
      updateDisplay(cached.jobs, sort)
      setStatus('done')
      setStatusMsg(`${cached.jobs.length} result${cached.jobs.length !== 1 ? 's' : ''} (from cache — refreshing…)`)
    } else {
      if (abortRef.current) abortRef.current.abort()
      abortRef.current = new AbortController()
      setStatus('loading')
      setStatusMsg('Searching...')
      if (!cached) { setJobs([]); setFiltered([]) }
    }

    // One automatic retry on a transient failure (cold start, flaky network) before
    // ever showing an error — a single blip should never surface as "Search failed".
    for (let attempt = 0; ; attempt++) {
      try {
        const ctrl = new AbortController()
        abortRef.current = ctrl
        const res = await fetch('/api/jobs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: q, location: loc, radius }),
          signal: ctrl.signal,
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json() as { jobs?: unknown[]; results?: unknown[]; widened?: boolean; radius?: number }
        const raw: Job[] = (data.jobs || data.results || []).map((item: unknown) => {
          const j = item as Record<string, unknown>
          const company = String(j.company || j.co || '')
          const title = String(j.title || '')
          const location = String(j.location || j.loc || j.city || loc || 'US')
          const apply_url = j.apply_url ? String(j.apply_url) : (j.url ? String(j.url) : null)
          return {
            // Stable, content-derived id when the API has none — so the same listing
            // keeps the same id across loads and saved listings reliably reopen.
            id: String(j.id || stableJobId({ company, title, location, apply_url })),
            title,
            company,
            location,
            score: Number(j.score) || 65,
            waste: Number(j.waste_score ?? j.waste) || 25,
            level: String(j.level || j.lvl || 'Mid level'),
            type: String(j.type || 'Full-time'),
            source: String(j.source || 'Job board'),
            description: String(j.description || ''),
            salary: j.salary ? String(j.salary) : null,
            apply_url,
          }
        })
        searchCache.set(cacheKey, { jobs: raw, ts: Date.now() })
        JobCache.setMany(raw)
        setJobs(raw)
        updateDisplay(raw, sort)
        setStatus('done')
        // When we had to widen past the requested radius (nothing within it), say so —
        // otherwise nearby-but-outside-radius results look like the radius is broken.
        if (data.widened && loc && raw.length) {
          setStatusMsg(`No jobs within ${data.radius || radius} mi of ${loc} — showing the ${raw.length} nearest matches`)
        }
        if (q) try { RecentSearchesStore.push(q, loc || undefined) } catch {}
        return
      } catch (err) {
        if ((err as Error).name === 'AbortError') return // superseded by a newer search
        if (attempt < 1) { await new Promise(r => setTimeout(r, 1200)); continue }
        setStatus('error')
        setStatusMsg('Search failed. Please try again.')
        return
      }
    }
  }

  function clearFilters() {
    setNiche('')
    setLevel('')
    setJobType('')
    setPosted('')
    setFiltered(applySort(jobs, sort))
    setStatusMsg(jobs.length > 0 ? `${jobs.length} result${jobs.length !== 1 ? 's' : ''}` : 'Enter a search above →')
  }

  function handleSaveToggle() {
    setSaveVersion(v => v + 1)
  }

  const inputStyle: React.CSSProperties = {
    flex: 1, minWidth: 160,
    background: 'var(--surface)',
    border: '1.5px solid var(--line2)',
    borderRadius: 8,
    padding: '.62rem .9rem',
    color: 'var(--white)',
    fontFamily: 'var(--body)',
    fontSize: '.875rem',
    outline: 'none',
    caretColor: 'var(--blue)',
  }

  const selectStyle: React.CSSProperties = {
    background: 'var(--card)',
    border: '1px solid var(--line2)',
    borderRadius: 6,
    padding: '.33rem .68rem',
    fontFamily: 'var(--mono)',
    fontSize: '.68rem',
    color: 'var(--sub)',
    outline: 'none',
    cursor: 'pointer',
  }

  return (
    <>
    <div className="page-full">
      <div className="jpage">
        <div className="jpage-hdr">
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', textTransform: 'uppercase', letterSpacing: '.22em', color: 'var(--green)', marginBottom: '.6rem', display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ width: 22, height: 1, background: 'var(--green)', display: 'inline-block', flexShrink: 0 }} />
            Job search · transparency-first
          </div>
          <h1>Open positions</h1>
          <p>Sorted by transparency. Every listing shows waste risk, process score, and vibe tags — not just salary and location.</p>

          {/* Search bar */}
          <div style={{ display: 'flex', gap: '.5rem', marginTop: '1rem', flexWrap: 'wrap' }}>
            <input
              type="text"
              placeholder="Job title or role..."
              value={query}
              onChange={e => {
                const val = e.target.value
                setQuery(val)
                if (debounceRef.current) clearTimeout(debounceRef.current)
                if (val.trim().length >= 2 || location.trim().length >= 2) {
                  debounceRef.current = setTimeout(() => searchJobs(val, undefined), 450)
                }
              }}
              onKeyDown={e => { if (e.key === 'Enter') { if (debounceRef.current) clearTimeout(debounceRef.current); searchJobs() } }}
              style={inputStyle}
            />
            <div style={{ position: 'relative', flex: 1, minWidth: 160 }}>
              <input
                type="text"
                placeholder="City or state..."
                value={location}
                onChange={e => {
                  const val = e.target.value
                  setLocation(val)
                  if (val.length >= 2) {
                    setLocSuggs(US_CITIES.filter(c => c.toLowerCase().includes(val.toLowerCase())).slice(0, 6))
                    setShowLocSuggs(true)
                  } else {
                    setShowLocSuggs(false)
                  }
                }}
                onKeyDown={e => e.key === 'Enter' && searchJobs()}
                onBlur={() => setTimeout(() => setShowLocSuggs(false), 150)}
                style={{ ...inputStyle, flex: 'unset', minWidth: 'unset', width: '100%', paddingRight: '2rem' }}
              />
              <button
                onClick={requestGpsLocation}
                title="Use my location"
                disabled={gpsLoading || !!location.trim()}
                style={{ position: 'absolute', right: '.5rem', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: gpsLoading || location.trim() ? 'default' : 'pointer', fontSize: '.9rem', color: gpsLoading ? 'var(--blue)' : 'var(--muted)', padding: 0, lineHeight: 1, opacity: location.trim() ? 0.3 : 1, transition: 'color .15s' }}
              >
                {gpsLoading ? '⏳' : '📍'}
              </button>
              {showLocSuggs && locSuggs.length > 0 && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, background: 'var(--card)', border: '1px solid var(--line2)', borderRadius: 8, marginTop: 2, overflow: 'hidden', boxShadow: '0 8px 24px rgba(0,0,0,.4)' }}>
                  {locSuggs.map(city => (
                    <div key={city} onMouseDown={() => { setLocation(city); setShowLocSuggs(false) }}
                      style={{ padding: '.45rem .8rem', fontFamily: 'var(--mono)', fontSize: '.68rem', color: 'var(--sub)', cursor: 'pointer' }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >{city}</div>
                  ))}
                </div>
              )}
            </div>
            <select value={radius} onChange={e => setRadius(e.target.value)} style={selectStyle}>
              <option value="10">10 mi</option>
              <option value="25">25 mi</option>
              <option value="50">50 mi</option>
              <option value="100">100 mi</option>
              <option value="0">Remote</option>
            </select>
            <button
              onClick={() => searchJobs()}
              disabled={status === 'loading'}
              style={{
                background: 'linear-gradient(135deg,#3b82f6 0%,#8b5cf6 100%)',
                color: '#fff', border: 'none', borderRadius: 8,
                padding: '.62rem 1.25rem',
                fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.85rem',
                cursor: status === 'loading' ? 'not-allowed' : 'pointer',
                opacity: status === 'loading' ? 0.6 : 1,
                boxShadow: '0 0 20px rgba(59,130,246,0.3)',
              }}
            >
              {status === 'loading' ? 'Searching...' : 'Search →'}
            </button>
          </div>

          {/* Filter bar */}
          <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', marginTop: '.6rem', alignItems: 'center' }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--muted)' }}>Filter:</span>
            <select value={niche} onChange={e => setNiche(e.target.value as NicheFilter)} style={selectStyle}>
              <option value="">Any industry</option>
              <option value="tech">Tech / Software</option>
              <option value="healthcare">Healthcare</option>
              <option value="retail">Retail / Food Service</option>
              <option value="logistics">Logistics / Warehouse</option>
              <option value="finance">Finance</option>
              <option value="other">Other</option>
            </select>
            <select value={level} onChange={e => setLevel(e.target.value as LevelFilter)} style={selectStyle}>
              <option value="">Any level</option>
              <option value="entry">Entry level</option>
              <option value="mid">Mid level</option>
              <option value="senior">Senior</option>
            </select>
            <select value={jobType} onChange={e => setJobType(e.target.value as TypeFilter)} style={selectStyle}>
              <option value="">Any type</option>
              <option value="Full-time">Full-time</option>
              <option value="Part-time">Part-time</option>
              <option value="Contract">Contract</option>
            </select>
            <select value={posted} onChange={e => setPosted(e.target.value as PostedFilter)} style={selectStyle}>
              <option value="">Any time</option>
              <option value="1">Last 24 hours</option>
              <option value="7">Last week</option>
              <option value="30">Last month</option>
            </select>
            {hasFilters && (
              <button onClick={clearFilters} style={{ background: 'none', border: '1px solid var(--line2)', color: 'var(--muted)', borderRadius: 6, padding: '.28rem .68rem', fontFamily: 'var(--mono)', fontSize: '.62rem', cursor: 'pointer' }}>
                ✕ Clear
              </button>
            )}
          </div>
        </div>

        {/* Recommended section — powered by resume intelligence */}
        {isLoggedIn && (recStatus === 'loading' || recommended.length > 0) && (
          <div style={{ marginBottom: '1.5rem', paddingBottom: '1.5rem', borderBottom: '1px solid var(--line)' }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', textTransform: 'uppercase' as const, letterSpacing: '.12em', color: 'var(--green)', marginBottom: '.75rem', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 20, height: 1.5, background: 'linear-gradient(90deg, var(--green), #8b5cf6)', display: 'inline-block', flexShrink: 0 }} />
              Matched to your resume
              {recSkills.length > 0 && (
                <span style={{ color: 'var(--dim)', letterSpacing: 'normal', textTransform: 'none' as const, marginLeft: 2, fontSize: '.6rem' }}>
                  · {recSkills.slice(0, 3).join(', ')}
                </span>
              )}
              {deckDone && swipeCount > 0 && (
                <span style={{ color: 'var(--green)', letterSpacing: 'normal', textTransform: 'none' as const, marginLeft: 2, fontSize: '.6rem' }}>
                  · {swipeCount} saved today
                </span>
              )}
            </div>
            {recStatus === 'loading' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '.65rem' }}>
                {[0, 1, 2].map(i => (
                  <div key={i} style={{ height: 110, background: 'var(--raised)', borderRadius: 12, animation: `pulse 1.4s ${i * 0.15}s ease infinite` }} />
                ))}
              </div>
            ) : (
              <SwipeJobDeck
                jobs={recommended}
                onOpen={j => setDetailJob(j)}
                onDismiss={() => setDeckDone(true)}
                onSave={() => setSwipeCount(c => c + 1)}
                onApply={j => { if (j.apply_url) window.open(j.apply_url, '_blank', 'noopener,noreferrer'); setCheckpointJob(j) }}
                coScores={coScores}
              />
            )}
          </div>
        )}

        {/* Results header */}
        <div className="jtb">
          <div className="jct">{statusMsg}</div>
          <div style={{ display: 'flex', gap: '.4rem', alignItems: 'center' }}>
            {filtered.length > 0 && (
              <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--line2)', background: 'var(--card)' }}>
                <button
                  onClick={() => setSwipeMode(false)}
                  title="List view"
                  style={{ fontFamily: 'var(--mono)', fontSize: '.65rem', fontWeight: swipeMode ? 400 : 600, padding: '.35rem .75rem', background: swipeMode ? 'transparent' : 'var(--surface)', color: swipeMode ? 'var(--dim)' : 'var(--white)', border: 'none', borderRight: '1px solid var(--line2)', cursor: 'pointer', transition: 'background .12s,color .12s' }}
                >☰ List</button>
                <button
                  onClick={() => setSwipeMode(true)}
                  title="Swipe mode — drag right to save, left to pass"
                  style={{ fontFamily: 'var(--mono)', fontSize: '.65rem', fontWeight: swipeMode ? 600 : 400, padding: '.35rem .75rem', background: swipeMode ? 'var(--surface)' : 'transparent', color: swipeMode ? 'var(--white)' : 'var(--dim)', border: 'none', cursor: 'pointer', transition: 'background .12s,color .12s' }}
                >⚡ Swipe</button>
              </div>
            )}
            <select
              className="jss"
              value={sort}
              onChange={e => setSort(e.target.value as SortMode)}
            >
              <option value="transparency">By transparency</option>
              <option value="waste">Lowest waste risk</option>
              <option value="recent">Most recent</option>
            </select>
          </div>
        </div>

        {/* Results — swipe deck or list */}
        {filtered.length > 0 && swipeMode ? (
          <SwipeJobDeck
            jobs={filtered}
            onOpen={j => setDetailJob(j)}
            onDismiss={() => setSwipeMode(false)}
            onSave={() => setSaveVersion(v => v + 1)}
            onApply={j => { if (j.apply_url) window.open(j.apply_url, '_blank', 'noopener,noreferrer'); setCheckpointJob(j) }}
            coScores={coScores}
          />
        ) : filtered.length > 0 ? (
          <div className="jlist" key={saveVersion}>
            {filtered.map((job, i) => (
              <JobCard key={job.id} job={job} index={i} onSaveToggle={handleSaveToggle} onOpen={j => setDetailJob(j)} onApply={j => setApplyJob(j)} onCheckCompany={co => setCheckCompany(co)} alreadyApplied={appliedCos.has(job.company.toLowerCase().trim())} />
            ))}
          </div>
        ) : status === 'idle' ? (
          <div style={{ textAlign: 'center', padding: '2.75rem 1.5rem 3.25rem' }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.56rem', color: 'var(--green)', textTransform: 'uppercase', letterSpacing: '.16em', marginBottom: '.5rem' }}>Start a search</div>
            <div style={{ fontFamily: 'var(--display)', fontSize: '1.1rem', fontWeight: 700, color: 'var(--white)', letterSpacing: '-.02em', marginBottom: '.4rem' }}>What role are you hunting?</div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--muted)', marginBottom: '1.15rem' }}>Every result is transparency-scored before you waste a single application.</div>
            <div style={{ display: 'flex', gap: '.45rem', flexWrap: 'wrap', justifyContent: 'center' }}>
              {['Software Engineer', 'Product Manager', 'Data Analyst', 'Marketing'].map(role => (
                <button key={role} className="sugg-chip" onClick={() => { setQuery(role); searchJobs(role) }}>{role}</button>
              ))}
            </div>
            {isLoggedIn && recStatus === 'done' && recommended.length === 0 && (
              <div style={{ marginTop: '1.5rem', padding: '.85rem 1.1rem', background: 'rgba(139,92,246,0.07)', border: '1px solid rgba(139,92,246,0.2)', borderRadius: 10, maxWidth: 340, margin: '1.5rem auto 0', textAlign: 'left' }}>
                <div style={{ fontFamily: 'var(--display)', fontSize: '.82rem', fontWeight: 700, color: 'var(--white)', marginBottom: '.22rem' }}>Get personalized matches</div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--sub)', lineHeight: 1.6, marginBottom: '.65rem' }}>Upload your resume and we&apos;ll surface jobs that match your skills and experience level automatically.</div>
                <a href="/resume" style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: '#a78bfa', textDecoration: 'none' }}>Upload resume →</a>
              </div>
            )}
          </div>
        ) : status === 'loading' ? (
          <div className="jlist">
            {[0, 1, 2, 3, 4].map(i => (
              <div key={i} style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 12, padding: '1rem 1.1rem', display: 'flex', gap: '.75rem', alignItems: 'flex-start' }}>
                <div style={{ width: 46, height: 46, borderRadius: 9, background: 'var(--raised)', flexShrink: 0, animation: `pulse 1.4s ${i * 0.12}s ease infinite` }} />
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '.55rem' }}>
                  <div style={{ height: 14, borderRadius: 4, background: 'var(--raised)', width: `${55 + (i % 3) * 15}%`, animation: `pulse 1.4s ${i * 0.12}s ease infinite` }} />
                  <div style={{ height: 11, borderRadius: 4, background: 'var(--raised)', width: '40%', animation: `pulse 1.4s ${i * 0.12}s ease infinite` }} />
                  <div style={{ display: 'flex', gap: '.35rem' }}>
                    {[0, 1, 2].map(j => <div key={j} style={{ height: 20, width: 60, borderRadius: 5, background: 'var(--raised)', animation: `pulse 1.4s ${(i + j) * 0.09}s ease infinite` }} />)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '4rem 2rem', color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: '.75rem' }}>
            No results found. Try a different title or wider radius.
          </div>
        )}
      </div>
    </div>

    {/* Apply & Optimize modal */}

    {detailJob && (
      <JobDetailDrawer
        job={detailJob}
        isLoggedIn={isLoggedIn}
        onClose={() => setDetailJob(null)}
        onApply={j => { setDetailJob(null); setApplyJob(j) }}
        onCheckCompany={co => { setDetailJob(null); setCheckCompany(co) }}
      />
    )}

    {checkCompany && (
      <CoPreviewModal company={checkCompany} onClose={() => setCheckCompany(null)} />
    )}

    {applyJob && (
      <ApplyOptimizeModal
        job={applyJob}
        onClose={() => setApplyJob(null)}
        onApplied={() => setCheckpointJob(applyJob)}
      />
    )}

    {checkpointJob && (
      <ApplyCheckpoint
        job={checkpointJob}
        onClose={() => setCheckpointJob(null)}
      />
    )}
    </>
  )
}

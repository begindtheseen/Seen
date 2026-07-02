'use client'

import { useState, useCallback, useEffect } from 'react'
import { Score } from '@/lib/score'
import { SavedJobsStore } from '@/lib/stores/SavedJobs'
import { aiHeaders } from '@/lib/aiHeaders'
import type { Job } from '@/lib/types'

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

export default function JobDetailDrawer({ job, isLoggedIn, onClose, onApply, onCheckCompany }: {
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

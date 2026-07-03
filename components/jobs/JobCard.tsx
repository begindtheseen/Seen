'use client'

import { useState } from 'react'
import { Score } from '@/lib/score'
import { SavedJobsStore } from '@/lib/stores/SavedJobs'
import { useAuth } from '@/lib/auth'
import { aiHeaders } from '@/lib/aiHeaders'
import type { Job } from '@/lib/types'

function jobVibes(job: Job): { cls: string; txt: string }[] {
  const vibes: { cls: string; txt: string }[] = []
  const src = (job.source || '').toLowerCase()
  const loc = (job.location || '').toLowerCase()
  const score = job.score
  if (src.includes('greenhouse') || src.includes('lever') || src.includes('workday')) {
    vibes.push({ cls: 'v-g', txt: '✅ Direct ATS' })
  } else if (src.includes('linkedin')) {
    vibes.push({ cls: 'v-b', txt: '💼 LinkedIn' })
  } else if (src.includes('indeed')) {
    vibes.push({ cls: 'v-n', txt: '🔍 Indeed' })
  }
  if (job.salary) vibes.push({ cls: 'v-g', txt: '💰 Salary listed' })
  if (score != null && score >= 75) vibes.push({ cls: 'v-g', txt: '✅ High transparency' })
  else if (score != null && score < 40) vibes.push({ cls: 'v-r', txt: '⚠️ Low score' })
  if (loc.includes('remote') || (job.type || '').toLowerCase().includes('remote')) {
    vibes.push({ cls: 'v-b', txt: '🏠 Remote' })
  }
  return vibes.slice(0, 3)
}

function ScoreRing({ score }: { score: number | null }) {
  const risk = Score.risk(score)
  const unrated = score == null
  return (
    <div className={`sring ${risk}`} style={{ width: 46, height: 46, flexShrink: 0 }} title={unrated ? 'Not enough signal in this listing to score it' : undefined}>
      <div className="sring-n" style={{ fontSize: unrated ? '1.1rem' : '.9rem' }}>{unrated ? '–' : score}</div>
      <div className="sring-l">{Score.label(risk)}</div>
    </div>
  )
}

export default function JobCard({ job, index, onSaveToggle, onOpen, onApply, onCheckCompany, alreadyApplied }: { job: Job; index: number; onSaveToggle: (id: string) => void; onOpen: (job: Job) => void; onApply: (job: Job) => void; onCheckCompany: (company: string) => void; alreadyApplied?: boolean }) {
  const risk = Score.risk(job.score)
  const wl = job.waste != null ? Score.wasteLabel(job.waste) : null
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
        {wl && <span className={`${wl.cls} waste-badge`}>{wl.txt}</span>}
        {job.waste != null && job.waste >= 55 && (
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

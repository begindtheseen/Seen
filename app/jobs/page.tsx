'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import type { Job } from '@/lib/types'
import { useJobSearch, type SortMode } from '@/lib/hooks/useJobSearch'
import JobCard from '@/components/jobs/JobCard'
import JobDetailDrawer from '@/components/jobs/JobDetailDrawer'
import CoPreviewModal from '@/components/jobs/CoPreviewModal'
import SwipeJobDeck from '@/components/jobs/SwipeJobDeck'
import JobFilters from '@/components/jobs/JobFilters'
import ApplyCheckpoint from '@/components/ApplyCheckpoint'
import ApplyOptimizeModal from '@/components/ApplyOptimizeModal'

const US_CITIES = ['New York, NY','Los Angeles, CA','Chicago, IL','Houston, TX','Phoenix, AZ','San Antonio, TX','San Diego, CA','Dallas, TX','San Jose, CA','Austin, TX','Seattle, WA','Denver, CO','Boston, MA','Atlanta, GA','Miami, FL','Portland, OR','Las Vegas, NV','San Francisco, CA','Washington, DC','Charlotte, NC','Nashville, TN','Minneapolis, MN','Raleigh, NC','Detroit, MI','Sacramento, CA']

export default function JobsPage() {
  const router = useRouter()
  const {
    isLoggedIn,
    query, setQuery,
    location, setLocation,
    locSuggs, setLocSuggs,
    showLocSuggs, setShowLocSuggs,
    gpsLoading,
    radius, setRadius,
    niche, setNiche,
    level, setLevel,
    jobType, setJobType,
    posted, setPosted,
    sort, setSort,
    hasFilters,
    filtered,
    status,
    statusMsg,
    recommended,
    recSkills,
    recStatus,
    coScores,
    appliedCos,
    searchJobs,
    requestGpsLocation,
    clearFilters,
  } = useJobSearch()

  const [applyJob, setApplyJob] = useState<Job | null>(null)
  const [checkCompany, setCheckCompany] = useState<string | null>(null)
  const [detailJob, setDetailJob] = useState<Job | null>(null)
  const [saveVersion, setSaveVersion] = useState(0)
  const [swipeCount, setSwipeCount] = useState(0)
  const [deckDone, setDeckDone] = useState(false)
  const [swipeMode, setSwipeMode] = useState(false)
  const [checkpointJob, setCheckpointJob] = useState<Job | null>(null)
  // When the checkpoint is opened AFTER the user already confirmed applying (the Apply &
  // Optimize funnel), it should record the application immediately rather than re-ask.
  const [checkpointAuto, setCheckpointAuto] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function handleSaveToggle() {
    setSaveVersion(v => v + 1)
  }

  const inputStyle: React.CSSProperties = {
    flex: 1, minWidth: 130,
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
            <div style={{ position: 'relative', flex: 1, minWidth: 130 }}>
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
          <JobFilters
            niche={niche} setNiche={setNiche}
            level={level} setLevel={setLevel}
            jobType={jobType} setJobType={setJobType}
            posted={posted} setPosted={setPosted}
            hasFilters={hasFilters} clearFilters={clearFilters}
            selectStyle={selectStyle}
          />
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
        onApplied={() => { setCheckpointAuto(true); setCheckpointJob(applyJob) }}
      />
    )}

    {checkpointJob && (
      <ApplyCheckpoint
        job={checkpointJob}
        autoConfirm={checkpointAuto}
        onClose={() => { setCheckpointJob(null); setCheckpointAuto(false) }}
      />
    )}
    </>
  )
}

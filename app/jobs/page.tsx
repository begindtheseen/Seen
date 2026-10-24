'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import type { Job } from '@/lib/types'
import { trackApplyClick } from '@/lib/trackApply'
import { useJobSearch, type SortMode } from '@/lib/hooks/useJobSearch'
import JobCard from '@/components/jobs/JobCard'
import JobDetailDrawer from '@/components/jobs/JobDetailDrawer'
import CoPreviewModal from '@/components/jobs/CoPreviewModal'
import SwipeJobDeck from '@/components/jobs/SwipeJobDeck'
import JobFilters from '@/components/jobs/JobFilters'
import ResumeMatches from '@/components/jobs/ResumeMatches'
import ApplyCheckpoint from '@/components/ApplyCheckpoint'
import ApplyOptimizeModal from '@/components/ApplyOptimizeModal'
import { notify } from '@/lib/notify'
import { matchCities } from '@/lib/data/usCities'
import { takesSeenApply } from '@/lib/seenApplyMode'
import { useCompanySuggestions, CompanySuggestList, CompanyResultCard } from '@/components/jobs/CompanySuggest'
import PageHeader from '@/components/shell/PageHeader'
import { LoadError } from '@/components/shell/LoadStates'
import { resultsView } from '@/lib/searchView.js'
import bar from '@/components/jobs/JobSearchBar.module.css'
import { groupListings } from '@/lib/jobs/groupListings.js'

// Empty-state suggestions, most-held first. Live corpus counts by title (prod, read-only,
// 2026-10-23): software engineer 3,960 · nurse 1,360 · sales associate 648 · customer service 489 ·
// warehouse 398 · data analyst 231 · cashier 113 · server 50. (Marketing 1,525 / product manager
// 1,092 were dropped for the hourly roles the audit persona actually searches for.)
const SUGGESTED_ROLES = ['Software Engineer', 'Nurse', 'Sales Associate', 'Customer Service', 'Warehouse', 'Data Analyst', 'Cashier', 'Server']

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
    notice,
    recommended,
    recHasResume,
    recReason,
    recCity,
    recCitySource,
    recSkills,
    recStatus,
    coScores,
    appliedCos,
    searchJobs,
    retrySearch,
    requestGpsLocation,
    clearFilters,
  } = useJobSearch()
  // ONE decision for the results area (lib/searchView.js): error / idle / loading / empty / results.
  const view = resultsView({ status, count: filtered.length })

  const [applyJob, setApplyJob] = useState<Job | null>(null)
  const [checkCompany, setCheckCompany] = useState<string | null>(null)
  const [detailJob, setDetailJob] = useState<Job | null>(null)
  const [saveVersion, setSaveVersion] = useState(0)
  const [swipeMode, setSwipeMode] = useState(false)
  const [checkpointJob, setCheckpointJob] = useState<Job | null>(null)
  // When the checkpoint is opened AFTER the user already confirmed applying (the Apply &
  // Optimize funnel), it should record the application immediately rather than re-ask.
  const [checkpointAuto, setCheckpointAuto] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Company search in the same box: matching companies under the input, card above results.
  const coSuggs = useCompanySuggestions(query)
  const [showCoSuggs, setShowCoSuggs] = useState(false)

  function handleSaveToggle() {
    setSaveVersion(v => v + 1)
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

  const hasCity = location.trim().length > 0
  // The résumé rail: with ≥1 real match (same role family, near the person's city — the profile's,
  // else the résumé's own), and never once a search has been typed — the search is the page's job.
  // (The old ≥3 bar hid the one Phoenix match the audit persona had: "Nothing near Phoenix matched".)
  const typed = query.trim().length > 0
  const showRail = isLoggedIn && !typed && (recStatus === 'loading' || recommended.length >= 1)
  const showCityLine = isLoggedIn && !typed && recStatus === 'done' && recReason === 'no_city'
  // Same employer + title at several addresses → one card with "+N more locations"
  // (lib/jobs/groupListings.js). Every row is still counted in the results line.
  const grouped = groupListings(filtered)
  // Suggestions never repeat what is already typed (the list used to offer "Phoenix, AZ" under a
  // typed "Phoenix, AZ" and, on a phone, sit on the Search button).
  const visibleLocSuggs = locSuggs.filter(c => c.toLowerCase() !== location.trim().toLowerCase())

  return (
    <>
    <div className="page-full">
      <div className="jpage">
        <div className="jpage-hdr">
          <PageHeader
            eyebrow="Job search · transparency-first"
            tone="green"
            title="Open positions"
            crumbLabel="Jobs"
            sub="Ranked by how well they match your search. Every listing shows waste risk, process score, and vibe tags — not just salary and location."
            className="jpage-head"
          />

          {/* Search bar — job titles AND company names in the same box (CompanySuggest.tsx) */}
          <div className={bar.wrap}>
            <div className={bar.query}>
            <input
              type="text"
              className={bar.input}
              placeholder="Job title, role or company..."
              value={query}
              onFocus={() => setShowCoSuggs(true)}
              onBlur={() => setTimeout(() => setShowCoSuggs(false), 150)}
              onChange={e => {
                const val = e.target.value
                setQuery(val)
                if (debounceRef.current) clearTimeout(debounceRef.current)
                if (val.trim().length >= 2) {
                  debounceRef.current = setTimeout(() => searchJobs(val, undefined), 450)
                }
              }}
              onKeyDown={e => { if (e.key === 'Enter') { if (debounceRef.current) clearTimeout(debounceRef.current); setShowCoSuggs(false); searchJobs() } }}
            />
            {showCoSuggs && (
              <CompanySuggestList
                items={coSuggs}
                onPick={name => {
                  if (debounceRef.current) clearTimeout(debounceRef.current)
                  setQuery(name)
                  setShowCoSuggs(false)
                  searchJobs(name)
                }}
              />
            )}
            </div>
            <div className={bar.row}>
              <div className={bar.loc}>
                <input
                  type="text"
                  className={`${bar.input} ${bar.locInput}`}
                  placeholder="City or state..."
                  aria-label="City or state"
                  value={location}
                  onChange={e => {
                    const val = e.target.value
                    setLocation(val)
                    if (val.length >= 2) {
                      setLocSuggs(matchCities(val, 6))
                      setShowLocSuggs(true)
                    } else {
                      setShowLocSuggs(false)
                    }
                  }}
                  // Enter searches AND closes the suggestion list (it used to stay open over the
                  // Search button); Esc just closes it.
                  onKeyDown={e => {
                    if (e.key === 'Enter') { setShowLocSuggs(false); searchJobs() }
                    else if (e.key === 'Escape') setShowLocSuggs(false)
                  }}
                  onBlur={() => setTimeout(() => setShowLocSuggs(false), 150)}
                />
                <button
                  type="button"
                  onClick={requestGpsLocation}
                  title="Use my location"
                  aria-label="Use my location"
                  disabled={gpsLoading || hasCity}
                  className={`${bar.pin}${gpsLoading ? ' ' + bar.pinBusy : ''}${hasCity ? ' ' + bar.pinOff : ''}`}
                >
                  {gpsLoading ? '⏳' : '📍'}
                </button>
                {showLocSuggs && visibleLocSuggs.length > 0 && (
                  <div className={bar.suggs} role="listbox" aria-label="Matching cities">
                    {visibleLocSuggs.map(city => (
                      <div key={city} className={bar.sugg} onMouseDown={() => { setLocation(city); setShowLocSuggs(false) }}>{city}</div>
                    ))}
                  </div>
                )}
              </div>
              {/* A radius only means something next to a place: with no city the select reads
                  "Anywhere" (Remote stays available) instead of a dangling "25 mi". */}
              <select
                className={bar.radius}
                aria-label="Distance"
                value={hasCity || radius === '0' ? radius : 'any'}
                onChange={e => setRadius(e.target.value === 'any' ? '25' : e.target.value)}
              >
                {hasCity ? (
                  <>
                    <option value="10">10 mi</option>
                    <option value="25">25 mi</option>
                    <option value="50">50 mi</option>
                    <option value="100">100 mi</option>
                  </>
                ) : (
                  <option value="any">Anywhere</option>
                )}
                <option value="0">Remote</option>
              </select>
              <button
                type="button"
                className={bar.go}
                onClick={() => searchJobs()}
                disabled={status === 'loading'}
              >
                {status === 'loading' ? 'Searching...' : 'Search →'}
              </button>
            </div>
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

        {/* Matched to your résumé — compact, gated, hidden once a search is typed */}
        {showRail && (
          <ResumeMatches
            jobs={recommended}
            loading={recStatus === 'loading'}
            skills={recSkills}
            city={recCity}
            citySource={recCitySource}
            onOpen={j => setDetailJob(j)}
          />
        )}
        {showCityLine && (
          <div className={bar.cityLine}>Add your city in <a href="/profile">Settings</a> for local matches to your résumé.</div>
        )}

        {/* The search names a company → its card (grade only when it has enough reviews) */}
        {status === 'done' && <CompanyResultCard items={coSuggs} searched={query} />}

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
              aria-label="Sort results"
              value={sort}
              onChange={e => setSort(e.target.value as SortMode)}
            >
              <option value="best">Best match</option>
              <option value="transparency">By transparency</option>
              <option value="waste">Lowest waste risk</option>
              <option value="recent">Most recent</option>
            </select>
          </div>
        </div>
        {notice && filtered.length > 0 && <div className={bar.notice} role="status">{notice}</div>}

        {/* Results — swipe deck or list */}
        {filtered.length > 0 && swipeMode ? (
          <SwipeJobDeck
            jobs={filtered}
            onOpen={j => setDetailJob(j)}
            onDismiss={() => setSwipeMode(false)}
            onSave={() => setSaveVersion(v => v + 1)}
            onApply={j => { if (takesSeenApply(j)) { setDetailJob(j); return } if (j.apply_url) { trackApplyClick(j); window.open(j.apply_url, '_blank', 'noopener,noreferrer') } setCheckpointJob(j) }}
            coScores={coScores}
          />
        ) : view === 'results' ? (
          <div className="jlist">
            {grouped.map(({ lead: job, more }, i) => (
              <JobCard key={job.id} job={job} more={more} index={i} onSaveToggle={handleSaveToggle} onOpen={j => setDetailJob(j)} onApply={j => takesSeenApply(j) ? setDetailJob(j) : setApplyJob(j)} onCheckCompany={co => setCheckCompany(co)} alreadyApplied={appliedCos.has(job.id) || (!!job.apply_url && appliedCos.has(job.apply_url))} />
            ))}
          </div>
        ) : view === 'error' ? (
          /* A failed search is an error with a Retry — never the "No matches" empty state (R-3). */
          <div style={{ padding: '1.5rem 0 3rem' }}>
            <LoadError what="job listings" detail="The search request did not get through. Your title and location are kept — try again." onRetry={retrySearch} />
          </div>
        ) : view === 'idle' ? (
          <div style={{ textAlign: 'center', padding: '2.75rem 1.5rem 3.25rem' }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.56rem', color: 'var(--green)', textTransform: 'uppercase', letterSpacing: '.16em', marginBottom: '.5rem' }}>Start a search</div>
            <div style={{ fontFamily: 'var(--display)', fontSize: '1.1rem', fontWeight: 700, color: 'var(--white)', letterSpacing: '-.02em', marginBottom: '.4rem' }}>What role are you hunting?</div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--muted)', marginBottom: '1.15rem' }}>Every result is transparency-scored before you waste a single application.</div>
            <div style={{ display: 'flex', gap: '.45rem', flexWrap: 'wrap', justifyContent: 'center' }}>
              {SUGGESTED_ROLES.map(role => (
                <button key={role} className="sugg-chip" onClick={() => { setQuery(role); searchJobs(role) }}>{role}</button>
              ))}
            </div>
            {/* Only when the ACCOUNT has no résumé on file (the rail says so) — never because the rail is empty. */}
            {isLoggedIn && recStatus === 'done' && recommended.length === 0 && recHasResume === false && (
              <div style={{ marginTop: '1.5rem', padding: '.85rem 1.1rem', background: 'rgba(139,92,246,0.07)', border: '1px solid rgba(139,92,246,0.2)', borderRadius: 10, maxWidth: 340, margin: '1.5rem auto 0', textAlign: 'left' }}>
                <div style={{ fontFamily: 'var(--display)', fontSize: '.82rem', fontWeight: 700, color: 'var(--white)', marginBottom: '.22rem' }}>Get personalized matches</div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--sub)', lineHeight: 1.6, marginBottom: '.65rem' }}>Upload your resume and we&apos;ll surface jobs that match your skills and experience level automatically.</div>
                <a href="/resume" style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: '#a78bfa', textDecoration: 'none' }}>Upload resume →</a>
              </div>
            )}
            {isLoggedIn && recStatus === 'done' && recommended.length === 0 && recHasResume === true && recReason !== 'no_city' && (
              <div style={{ marginTop: '1.25rem', fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--dim)' }}>Nothing near {recCity || 'you'} matched your résumé&apos;s roles yet — search by title above.</div>
            )}
          </div>
        ) : view === 'loading' ? (
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
        ) : view === 'empty' ? (
          <div style={{ textAlign: 'center', padding: '4rem 2rem' }}>
            <div style={{ fontSize: '2rem', marginBottom: '.75rem' }}>🔍</div>
            <div style={{ fontFamily: 'var(--display)', fontSize: '1.05rem', fontWeight: 800, color: 'var(--white)', marginBottom: '.4rem' }}>No matches for this search</div>
            <div style={{ color: 'var(--sub)', fontFamily: 'var(--body)', fontSize: '.82rem', fontWeight: 300, maxWidth: 360, margin: '0 auto', lineHeight: 1.6 }}>Try a broader job title, widen the radius, or clear a filter — new roles are indexed continuously.</div>
          </div>
        ) : null}
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

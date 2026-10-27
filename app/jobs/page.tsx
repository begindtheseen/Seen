'use client'

import { useState, useRef, useEffect, Fragment } from 'react'
import { flushSync } from 'react-dom'
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
import { takesSeenApply } from '@/lib/seenApplyMode'
import { useCompanySuggestions, CompanyResultCard } from '@/components/jobs/CompanySuggest'
import PageHeader from '@/components/shell/PageHeader'
import { LoadError } from '@/components/shell/LoadStates'
import { resultsView } from '@/lib/searchView.js'
import bar from '@/components/jobs/JobSearchBar.module.css'
import { groupListings } from '@/lib/jobs/groupListings.js'
import { isMatch } from '@/lib/server/jobPriority.js'
import Button from '@/components/ui/Button'
import { Chip } from '@/components/ui/Badge'
import Icon from '@/components/ui/Icon'
import j from './jobs.module.css'

// Empty-state suggestions, most-held first. Live corpus counts by title (prod, read-only,
// 2026-10-23): software engineer 3,960 · nurse 1,360 · sales associate 648 · customer service 489 ·
// warehouse 398 · data analyst 231 · cashier 113 · server 50. (Marketing 1,525 / product manager
// 1,092 were dropped for the hourly roles the audit persona actually searches for.)
// Ordered for the people who land here from search (hourly roles first — conversion audit 2026-10-24).
const SUGGESTED_ROLES = ['Cashier', 'Warehouse', 'Customer Service', 'Sales Associate', 'Nurse', 'Server', 'Data Analyst', 'Software Engineer']

export default function JobsPage() {
  const router = useRouter()
  const {
    isLoggedIn,
    query, setQuery,
    location, setLocation,
    committedQuery,
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
    hasMore,
    loadingMore,
    loadMore,
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
  // No autofill (owner 2026-10-24: "I hate the autofill… gets in the way"): no lists under the boxes and
  // no searching while typing. A search runs on Enter or the Search button. When the search that RAN
  // names a company, its card shows above the results.
  const coSuggs = useCompanySuggestions(status === 'done' ? committedQuery : '')

  function handleSaveToggle() {
    setSaveVersion(v => v + 1)
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
  // Matches first, then — under a divider — openings that only share a word with the search. The
  // hook's sort already puts every match first (lib/server/jobPriority.js), so one index splits them.
  const firstOther = typed ? grouped.findIndex(g => !isMatch(g.lead)) : -1
  // After a search with results, phones get a sticky one-line query bar (audit #25: the first card sat
  // ~700px down under a three-row form). The location row comes back when the bar is opened (barOpen below).
  const searched = status === 'done' && filtered.length > 0
  // The one-line bar opens when anything in it gets focus (or its location chip is tapped) and STAYS open until a
  // search runs or a tap lands outside.
  // It used to show the location row only while the bar had focus (`:focus-within`): iPhone Safari drops focus
  // from the title box before it focuses the location box, so the row hid under the finger and the city could
  // never be typed (owner report 2026-10-27).
  const [barOpen, setBarOpen] = useState(false)
  const barRef = useRef<HTMLDivElement>(null)
  const locRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!barOpen) return
    const away = (e: PointerEvent) => { if (barRef.current && !barRef.current.contains(e.target as Node)) setBarOpen(false) }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [barOpen])
  // The chip opens the row and focuses the city box inside the same tap: iPhone only raises the keyboard for a
  // focus() made during the tap itself, so the row is rendered synchronously first.
  function editLocation() {
    flushSync(() => setBarOpen(true))
    locRef.current?.focus()
    locRef.current?.select()
  }
  function runSearch() {
    setBarOpen(false)
    const el = document.activeElement as HTMLElement | null
    if (el && barRef.current?.contains(el)) el.blur()
    searchJobs()
  }
  const [copied, setCopied] = useState(false)
  async function copySearchLink() {
    try { await navigator.clipboard.writeText(window.location.href); setCopied(true); setTimeout(() => setCopied(false), 1800) }
    catch { notify({ title: 'Copy this page’s address to share the search', severity: 'info', duration: 2600 }) }
  }

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
            sub="Ranked by how well they match your search. Every listing shows how complete its posting is and how the employer treats applicants — not just pay and location."
            className={`jpage-head${searched ? ' ' + j.searchedHead : ''}`}
          />

          {/* Search bar — job titles AND company names in the same box. No autofill: Enter / Search runs it. */}
          <div ref={barRef} className={`${bar.wrap}${searched ? ' ' + bar.compact : ''}${searched && barOpen ? ' ' + bar.open : ''}`} role="search"
            onFocus={() => setBarOpen(true)}>
            <div className={bar.query}>
            <input
              type="text"
              className={bar.input}
              placeholder="Job title, role or company..."
              aria-label="Job title, role or company"
              value={query}
              name="seen-job-query"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              enterKeyHint="search"
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') runSearch() }}
            />
            {/* Compact (phone, after a search): the place being searched, one tap from changing it, and the bar's own Search button. */}
            <button type="button" className={bar.locChip} onClick={editLocation}
              /* no focus on press: a focused chip would open the bar (onFocus) and hide itself before the click */
              onPointerDown={e => e.preventDefault()} onMouseDown={e => e.preventDefault()}
              aria-label={hasCity ? `Location: ${location}. Change it` : 'Add a location'}>
              <Icon name="map-pin" size={14} />
              <span>{hasCity ? location.split(',')[0].trim() || location : 'Anywhere'}</span>
            </button>
            <button type="button" className={bar.goIcon} onClick={runSearch} disabled={status === 'loading'} aria-label="Search">
              <Icon name="search" size={18} />
            </button>
            </div>
            <div className={bar.row}>
              <div className={bar.loc}>
                <input
                  type="text"
                  className={`${bar.input} ${bar.locInput}`}
                  placeholder="City or state..."
                  aria-label="City or state"
                  ref={locRef}
                  value={location}
                  name="seen-job-location"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  enterKeyHint="search"
                  onChange={e => setLocation(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') runSearch() }}
                />
                <button
                  type="button"
                  onClick={requestGpsLocation}
                  title="Use my location"
                  aria-label="Use my location"
                  disabled={gpsLoading || hasCity}
                  className={`${bar.pin}${gpsLoading ? ' ' + bar.pinBusy : ''}${hasCity ? ' ' + bar.pinOff : ''}`}
                >
                  <Icon name={gpsLoading ? 'loader-circle' : 'map-pin'} size={16} className={gpsLoading ? bar.spin : undefined} />
                </button>
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
                onClick={runSearch}
                disabled={status === 'loading'}
              >
                {status === 'loading' ? 'Searching…' : 'Search'}
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
        {status === 'done' && <CompanyResultCard items={coSuggs} searched={committedQuery} />}

        {/* Results header — only over results: a failed or empty search shows its own state, never this
            toolbar on top of an error (audit #30). */}
        {filtered.length > 0 && (
          <div className={j.toolbar}>
            <p className={j.count} aria-live="polite">{statusMsg}</p>
            <div className={j.tools}>
              {status === 'done' && typed && (
                <Button size="sm" variant="ghost" onClick={copySearchLink} data-testid="copy-search-link" title="Copy a link to this search" icon={copied ? 'check' : 'link'}>
                  <span className={j.hideSm}>{copied ? 'Copied' : 'Copy link'}</span>
                </Button>
              )}
              <div className={j.seg} role="group" aria-label="View">
                <Chip selected={!swipeMode} onClick={() => setSwipeMode(false)} icon="list" title="List view">List</Chip>
                <Chip selected={swipeMode} onClick={() => setSwipeMode(true)} icon="layers" title="Swipe mode — drag right to save, left to pass">Swipe</Chip>
              </div>
              <label htmlFor="jobs-sort" className="sr-only">Sort results</label>
              <select id="jobs-sort" className={`ui-input ${j.sort}`} value={sort} onChange={e => setSort(e.target.value as SortMode)}>
                <option value="best">Best match</option>
                <option value="transparency">Best posting score</option>
                <option value="waste">Lowest wasted-effort risk</option>
                <option value="recent">Most recent</option>
              </select>
            </div>
          </div>
        )}
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
          <>
          <div className="jlist">
            {grouped.map(({ lead: job, more }, i) => (
              <Fragment key={job.id}>
                {i === firstOther && (
                  <div className={bar.divider} role="separator" data-testid="other-openings">
                    <span className={bar.dividerTitle}>Other openings{hasCity ? ' nearby' : ''}</span>
                    <span className={bar.dividerSub}>Not {query.trim() ? `“${query.trim()}”` : 'this role'} — they share a word with your search.</span>
                  </div>
                )}
                <JobCard job={job} more={more} index={i} onSaveToggle={handleSaveToggle} onOpen={j => setDetailJob(j)} onApply={j => takesSeenApply(j) ? setDetailJob(j) : setApplyJob(j)} onCheckCompany={co => setCheckCompany(co)} alreadyApplied={appliedCos.has(job.id) || (!!job.apply_url && appliedCos.has(job.apply_url))} employerScore={coScores[job.company.toLowerCase().trim()]?.overall_score ?? null} />
              </Fragment>
            ))}
          </div>
          {hasMore && (
            <Button variant="secondary" full onClick={() => loadMore()} loading={loadingMore} data-testid="show-more" className={j.more}>
              {loadingMore ? 'Loading…' : 'Show 60 more'}
            </Button>
          )}
          </>
        ) : view === 'error' ? (
          /* A failed search is an error with a Retry — never the "No matches" empty state (R-3). */
          <div className={j.state}>
            <LoadError what="job listings" detail="The search request did not get through. Your title and location are kept — try again." onRetry={retrySearch} />
          </div>
        ) : view === 'idle' ? (
          <div className={j.idle}>
            <p className="ui-eyebrow">Start a search</p>
            <h2 className={j.idleTitle}>What role are you looking for?</h2>
            <p className={j.idleSub}>Every result shows how complete its posting is and how the employer treats applicants.</p>
            <div className={j.suggest}>
              {SUGGESTED_ROLES.map(role => (
                <Chip key={role} onClick={() => { setQuery(role); searchJobs(role) }}>{role}</Chip>
              ))}
            </div>
            {/* Only when the ACCOUNT has no résumé on file (the rail says so) — never because the rail is empty. */}
            {isLoggedIn && recStatus === 'done' && recommended.length === 0 && recHasResume === false && (
              <div className={j.resumeAsk}>
                <p className={j.resumeTitle}>Get matches from your résumé</p>
                <p className={j.idleSub}>Upload it once and Seen surfaces jobs that match your skills and experience level.</p>
                <Button size="sm" variant="secondary" href="/resume" iconRight="arrow-right">Upload résumé</Button>
              </div>
            )}
            {isLoggedIn && recStatus === 'done' && recommended.length === 0 && recHasResume === true && recReason !== 'no_city' && (
              <p className={j.idleSub}>Nothing near {recCity || 'you'} matched your résumé&apos;s roles yet — search by title above.</p>
            )}
          </div>
        ) : view === 'loading' ? (
          <div className="jlist" role="status" aria-label="Searching">
            {[0, 1, 2, 3, 4].map(i => (
              <div key={i} className={j.skRow}>
                <div className={`sk ${j.skLogo}`} />
                <div className={j.skBody}>
                  <div className="sk" style={{ height: 14, width: `${55 + (i % 3) * 15}%` }} />
                  <div className="sk" style={{ height: 12, width: '40%' }} />
                  <div className="sk" style={{ height: 22, width: '30%' }} />
                </div>
              </div>
            ))}
          </div>
        ) : view === 'empty' ? (
          <div className={j.idle}>
            <Icon name="search" size={28} className={j.emptyIcon} />
            <h2 className={j.idleTitle}>No matches for this search</h2>
            <p className={j.idleSub}>Try a broader job title, widen the radius, or clear a filter — new roles are indexed continuously.</p>
            {hasFilters && <Button size="sm" variant="secondary" onClick={clearFilters}>Clear filters</Button>}
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

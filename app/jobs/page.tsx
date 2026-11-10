'use client'

import { useState, useEffect, useRef, Fragment } from 'react'
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
import { useUrlPlace, useScrollMemory, afterPendingBack } from '@/lib/nav/urlState'
import { JobCache } from '@/lib/stores/JobCache'
import { httpHref } from '@/lib/safeHref.js'

// Empty-state suggestions, most-held first. Live corpus counts by title (prod, read-only,
// 2026-10-23): software engineer 3,960 · nurse 1,360 · sales associate 648 · customer service 489 ·
// warehouse 398 · data analyst 231 · cashier 113 · server 50. (Marketing 1,525 / product manager
// 1,092 were dropped for the hourly roles the audit persona actually searches for.)
// Ordered for the people who land here from search (hourly roles first — conversion audit 2026-10-24).
const SUGGESTED_ROLES = ['Cashier', 'Warehouse', 'Customer Service', 'Sales Associate', 'Nurse', 'Server', 'Data Analyst', 'Software Engineer']

export default function JobsPage() {
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
    pay, setPay,
    sort, setSort,
    hasFilters,
    area,
    areaProblem,
    includeRemote, setIncludeRemote,
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
  // The open listing is a PLACE in the URL (?job=<id>, Indeed's ?vjk=): opening it adds a history entry,
  // so Back closes it, and leaving for a company page / the listing page / the employer's site and
  // pressing Back reopens it over the same list (owner 2026-11-01: "be more like Indeed").
  const jobPlace = useUrlPlace('job')
  const [detailJob, setDetailJobState] = useState<Job | null>(null)
  function setDetailJob(job: Job | null) {
    if (job) { JobCache.set(job); setDetailJobState(job); jobPlace.open(String(job.id)) }
    else { setDetailJobState(null); jobPlace.close() }
  }
  const [, setSaveVersion] = useState(0)
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
  // ~700px down under a three-row form). The location row reappears while the bar has focus.
  const searched = status === 'done' && filtered.length > 0
  // The compact bar's location row is opened by STATE, not by CSS :focus-within — moving focus from the
  // title box to the city box (or tapping the 📍 / distance controls) dropped focus-within for a frame,
  // the row vanished under the finger and the city could not be changed (owner 2026-11-01). It stays
  // open until a search runs.
  const [whereOpen, setWhereOpen] = useState(false)
  const locRef = useRef<HTMLInputElement>(null)
  function runSearch() {
    setWhereOpen(false)
    try { (document.activeElement as HTMLElement | null)?.blur?.() } catch { /* ignore */ }
    searchJobs()
  }
  function openWhere() {
    setWhereOpen(true)
    setTimeout(() => locRef.current?.focus(), 0)
  }
  // A state typed alone is the whole state: the radius means nothing there (the select says "Whole state").
  // A state or a county typed alone is that whole area: the radius means nothing there (the select says so).
  const wholeState = (area?.kind === 'state' || area?.kind === 'county') && location.trim() === area.typed
  const radiusLabel = wholeState ? (area?.kind === 'county' ? 'whole county' : 'whole state') : radius === '0' ? 'Remote' : hasCity ? `${radius} mi` : 'Anywhere'
  // Follow the URL: Back/Forward open or close the listing; a page loaded on ?job= (Back from another
  // page) reopens it once its row is known — from the results, the rail, or this tab's listing cache.
  useEffect(() => {
    const id = jobPlace.value
    if (!id) { setDetailJobState(null); return }
    setDetailJobState(cur => {
      if (cur && String(cur.id) === id) return cur
      return filtered.find(x => String(x.id) === id) || recommended.find(x => String(x.id) === id) || JobCache.get(id) || cur
    })
  }, [jobPlace.value, filtered, recommended])
  // Back to the results lands where the list was scrolled (rows render after the restore).
  useScrollMemory(status === 'done' || status === 'error' || (status === 'idle' && !query.trim()))
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
            title="Open positions"
            crumbLabel="Jobs"
            sub="Ranked by how well they match your search. Every listing shows how complete its posting is and how the employer treats applicants — not just pay and location."
            className={`jpage-head${searched ? ' ' + j.searchedHead : ''}`}
          />

          {/* Search bar — job titles AND company names in the same box. No autofill: Enter / Search runs it. */}
          <div className={`${bar.wrap}${searched ? ' ' + bar.compact : ''}${whereOpen ? ' ' + bar.whereOpen : ''}`} role="search">
            <div className={bar.query}>
            <input
              type="text"
              className={bar.input}
              placeholder="Job title or company — optional"
              aria-label="Job title or company (optional — leave it empty to see every job in the place)"
              value={query}
              name="seen-job-query"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              enterKeyHint="search"
              onChange={e => setQuery(e.target.value)}
              onFocus={() => { if (searched) setWhereOpen(true) }}
              onKeyDown={e => { if (e.key === 'Enter') runSearch() }}
            />
            {/* Compact (phone, after a search): the one-line bar's own Search button. */}
            <button type="button" className={bar.goIcon} onClick={runSearch} disabled={status === 'loading'} aria-label="Search">
              <Icon name="search" size={18} />
            </button>
            </div>
            {/* Compact: where the search is, as one tap target that opens the location row. */}
            {/* Remote results are not the city's results: the chip reads "Remote" alone (phone tester 2026-11-02). */}
            <button type="button" className={bar.whereChip} onClick={openWhere} aria-label={radius === '0' ? 'Change location: Remote' : `Change location: ${location.trim() || 'anywhere'}, ${radiusLabel}`}>
              <Icon name={radius === '0' ? 'globe' : 'map-pin'} size={14} />
              <span className={bar.whereText}>{radius === '0' ? 'Remote' : `${location.trim() || 'Anywhere'} · ${radiusLabel}`}</span>
              <span className={bar.whereEdit}>Change</span>
            </button>
            <div className={bar.row} onPointerDownCapture={() => { if (searched) setWhereOpen(true) }}>
              <div className={bar.loc}>
                <label htmlFor="jobs-location" className="sr-only">Where — city, state or ZIP code</label>
                <input
                  type="text"
                  id="jobs-location"
                  ref={locRef}
                  className={`${bar.input} ${bar.locInput}`}
                  placeholder="City, state or ZIP"
                  inputMode="text"
                  value={location}
                  name="seen-job-location"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  enterKeyHint="search"
                  onChange={e => setLocation(e.target.value)}
                  onFocus={() => { if (searched) setWhereOpen(true) }}
                  onKeyDown={e => { if (e.key === 'Enter') runSearch() }}
                />
                <button
                  type="button"
                  onClick={() => { void requestGpsLocation() }}
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
                aria-label={wholeState ? `Distance — not used: this search covers all of ${area?.label}` : 'Distance'}
                title={wholeState ? `Not used: this search covers all of ${area?.label}` : undefined}
                value={wholeState ? 'state' : hasCity || radius === '0' ? radius : 'any'}
                disabled={wholeState}
                onChange={e => setRadius(e.target.value === 'any' ? '25' : e.target.value)}
              >
                {wholeState ? (
                  <option value="state">{area?.kind === 'county' ? 'Whole county' : 'Whole state'}</option>
                ) : hasCity ? (
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
            pay={pay} setPay={setPay}
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
              {status === 'done' && (typed || !!area) && (
                <Button size="sm" variant="ghost" onClick={copySearchLink} data-testid="copy-search-link" title="Copy a link to this search" icon={copied ? 'check' : 'link'}>
                  <span className={j.hideSm}>{copied ? 'Copied' : 'Copy link'}</span>
                </Button>
              )}
              <div className={j.seg} role="group" aria-label="View">
                <Chip selected={!swipeMode} onClick={() => setSwipeMode(false)} icon="list" title="List view">List</Chip>
                <Chip selected={swipeMode} onClick={() => setSwipeMode(true)} icon="layers" title="Swipe mode — drag right to save, left to pass">Swipe</Chip>
              </div>
              <label htmlFor="jobs-sort" className="sr-only">Sort results</label>
              {area ? (
                <select id="jobs-sort" className={`ui-input ${j.sort}`} value={sort === 'recent' ? 'recent' : 'nearest'} onChange={e => setSort(e.target.value as SortMode)}>
                  {area.kind === 'point' && <option value="nearest">Nearest first</option>}
                  <option value="recent">Newest first</option>
                </select>
              ) : (
                <select id="jobs-sort" className={`ui-input ${j.sort}`} value={sort} onChange={e => setSort(e.target.value as SortMode)}>
                  <option value="best">Best match</option>
                  <option value="transparency">Best posting score</option>
                  <option value="waste">Lowest wasted-effort risk</option>
                  <option value="recent">Most recent</option>
                </select>
              )}
            </div>
          </div>
        )}
        {notice && filtered.length > 0 && <div className={bar.notice} role="status">{notice}</div>}
        {/* Area search: remote listings based here are counted apart and shown only on request. */}
        {area && status === 'done' && area.remoteTotal > 0 && (
          <div className={bar.areaRemote}>
            <Chip selected={includeRemote} onClick={() => setIncludeRemote(!includeRemote)} icon="globe" data-testid="area-remote">
              {/* The remote listings counted here are remote-only roles whose listing names a place in this area
                  ("Remote - Phoenix, AZ", "Remote (Tempe)"). */}
              {includeRemote ? `Showing ${area.remoteTotal.toLocaleString('en-US')} remote listing${area.remoteTotal === 1 ? '' : 's'} for ${area.label} — hide` : `Also show ${area.remoteTotal.toLocaleString('en-US')} remote listing${area.remoteTotal === 1 ? '' : 's'} for ${area.label}`}
            </Chip>
          </div>
        )}

        {/* Results — swipe deck or list */}
        {filtered.length > 0 && swipeMode ? (
          <SwipeJobDeck
            jobs={filtered}
            onOpen={j => setDetailJob(j)}
            onDismiss={() => setSwipeMode(false)}
            onSave={() => setSaveVersion(v => v + 1)}
            onApply={j => { if (takesSeenApply(j)) { setDetailJob(j); return } const u = httpHref(j.apply_url); if (u) { trackApplyClick(j); window.open(u, '_blank', 'noopener,noreferrer') } setCheckpointJob(j) }}
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
                <JobCard job={job} more={more} index={i} onSaveToggle={handleSaveToggle} onOpen={j => setDetailJob(j)} onCheckCompany={co => setCheckCompany(co)} alreadyApplied={appliedCos.has(job.id) || (!!job.apply_url && appliedCos.has(job.apply_url))} employerScore={coScores[job.company.toLowerCase().trim()]?.overall_score ?? null} />
              </Fragment>
            ))}
          </div>
          {hasMore && (
            <Button variant="secondary" full onClick={() => loadMore()} loading={loadingMore} data-testid="show-more" className={j.more}>
              {loadingMore ? 'Loading…' : area
                ? (area.jobsTotal < area.total
                  ? `Show more · ${(area.total - filtered.length).toLocaleString('en-US')} more locations`
                  : `Show ${Math.min(60, area.total - filtered.length)} more · ${(area.total - filtered.length).toLocaleString('en-US')} left`)
                : 'Show 60 more'}
            </Button>
          )}
          {area && !hasMore && filtered.length >= 60 && (
            <p className={bar.areaEnd}>That’s all {area.jobsTotal < area.total ? `${area.jobsTotal.toLocaleString('en-US')} jobs (${area.total.toLocaleString('en-US')} locations)` : `${area.total.toLocaleString('en-US')} jobs`}.</p>
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
            <p className={j.idleSub}>Or leave the title empty and search a city, state or ZIP to see every job Seen holds there.</p>
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
        ) : view === 'empty' && areaProblem ? (
          /* A place Seen could not search: say why, offer the places it could mean — never an unrelated list. */
          <div className={j.idle} data-testid="area-problem">
            <Icon name="map-pin" size={28} className={j.emptyIcon} />
            <h2 className={j.idleTitle}>{areaProblem.message}</h2>
            {areaProblem.suggestions.length > 0 && (
              <>
                <p className={j.idleSub}>{areaProblem.reason === 'ambiguous' ? 'Which one?' : 'Did you mean'}</p>
                <div className={j.suggest}>
                  {areaProblem.suggestions.map(s => (
                    <Chip key={s} onClick={() => { setLocation(s); searchJobs(undefined, s) }}>{s}</Chip>
                  ))}
                </div>
              </>
            )}
            {areaProblem.reason === 'needs_position' && (
              <Button size="sm" variant="secondary" icon="map-pin" onClick={() => { void requestGpsLocation(true) }}>Use my location</Button>
            )}
          </div>
        ) : view === 'empty' && area ? (
          <div className={j.idle} data-testid="area-empty">
            <Icon name="map-pin" size={28} className={j.emptyIcon} />
            <h2 className={j.idleTitle}>{hasFilters ? `No jobs match these filters ${area.kind !== 'point' ? `in ${area.label}` : `within ${area.radius} miles of ${area.label}`}` : `No jobs on Seen ${area.kind !== 'point' ? `in ${area.label}` : `within ${area.radius} miles of ${area.label}`} yet`}</h2>
            {area.wider && area.wider.total > 0 && (
              <Button size="sm" variant="secondary" onClick={() => setRadius(String(area.wider!.radius))} iconRight="arrow-right">
                {`${area.wider.total.toLocaleString('en-US')} within ${area.wider.radius} miles`}
              </Button>
            )}
            {hasFilters && <Button size="sm" variant="ghost" onClick={clearFilters}>Clear filters</Button>}
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
        // Close the drawer (one Back for its ?job= entry) and open the sheet only once that Back has landed: the
        // drawer used to call onClose() AND this handler closed again — two Backs, and the page left /jobs (round 5).
        onApply={j => { setDetailJob(null); afterPendingBack(() => setApplyJob(j)) }}
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

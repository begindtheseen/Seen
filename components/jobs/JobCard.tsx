'use client'

import { useState, useEffect } from 'react'
import { Score } from '@/lib/score'
import { SavedJobsStore } from '@/lib/stores/SavedJobs'
import { useAuth } from '@/lib/auth'
import { aiHeaders } from '@/lib/aiHeaders'
import { notify } from '@/lib/notify'
import type { Job } from '@/lib/types'
import { takesSeenApply } from '@/lib/seenApplyMode'
import { trackApplyClick } from '@/lib/trackApply'
import { RESUME_OPTIMIZE_COST, creditCostLabel, priceLabel } from '@/lib/creditRules'
import { useProStatus } from '@/lib/hooks/useProStatus'
import ApplyCheckpoint from '@/components/ApplyCheckpoint'
import { displayCompanyName } from '@/lib/companyDisplay'
import { displayPay } from '@/lib/jobs/pay.js'
import { roleSnippet, isDescriptionPreview } from '@/lib/jobs/descriptionText.js'
import { httpHref, pathSegment } from '@/lib/safeHref.js'
import { wasOptimized } from '@/lib/optimizedJobs'
import Link from 'next/link'
import { JobCache } from '@/lib/stores/JobCache'
import ListingScoreRing from '@/components/jobs/ListingScoreRing'
import EmployerGradeChip from '@/components/jobs/EmployerGradeChip'

// The optimize action's price, rendered from the credit rules so the label can never drift.
const OPTIMIZE_PRICE = creditCostLabel(RESUME_OPTIMIZE_COST)

// Secondary (outlined) action next to the primary Apply — the paid optimizer. Inline because
// globals.css is owned elsewhere; mirrors .jlc-apply's shape without its gradient.
// The price must never be clipped: the label may wrap to "Optimize ·" / "1 credit" on a
// narrow phone, so the number is always visible.
const optimizeBtn: React.CSSProperties = {
  background: 'rgba(99,102,241,.08)', color: '#a5b4fc', border: '1px solid rgba(99,102,241,.35)',
  borderRadius: 8, padding: '.55rem .5rem', fontFamily: 'var(--display)', fontWeight: 800, fontSize: 'var(--fs-meta)', lineHeight: 1.15,
  cursor: 'pointer', textAlign: 'center', minWidth: 0,
}
// Split row: a grid with minmax(0, 1fr) tracks so the row's min-content can never widen the
// page on a phone (a flex row of nowrap buttons did exactly that at 390px — CLAUDE.md phone rule).
const splitRow: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr) minmax(0, 1fr)', alignItems: 'stretch' }

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
  if (displayPay(job)) vibes.push({ cls: 'v-g', txt: '💰 Pay listed' })
  if (score != null && score >= 75) vibes.push({ cls: 'v-g', txt: '✅ High transparency' })
  else if (score != null && score < 40) vibes.push({ cls: 'v-r', txt: '⚠️ Thin posting' })
  if (loc.includes('remote') || (job.type || '').toLowerCase().includes('remote')) {
    vibes.push({ cls: 'v-b', txt: '🏠 Remote' })
  }
  return vibes.slice(0, 3)
}

export default function JobCard({ job, index, onSaveToggle, onOpen, onApply, onCheckCompany, alreadyApplied, more = [], employerScore = null }: { job: Job; index: number; onSaveToggle: (id: string) => void; onOpen: (job: Job) => void; onApply: (job: Job) => void; onCheckCompany: (company: string) => void; alreadyApplied?: boolean; /** Same employer + title at other addresses (lib/jobs/groupListings.js) — one card, "+N more locations". */ more?: Job[]; /** The employer's overall score when it is GRADEABLE (useJobSearch coScores — already grade-gated), else null. */ employerScore?: number | null }) {
  const wl = job.waste != null ? Score.wasteLabel(job.waste) : null
  const vibes = jobVibes(job)
  const [saved, setSaved] = useState(() => SavedJobsStore.isSaved(job.id))
  const [reportedInactive, setReportedInactive] = useState(false)
  const [reportingInactive, setReportingInactive] = useState(false)
  // After a plain "Apply ↗" the existing tracker checkpoint offers "Did you apply? → track it".
  const [checkpoint, setCheckpoint] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const { user, isLoggedIn } = useAuth()
  const pro = useProStatus()
  // The employer as a person names it: "PLS", not the board slug "plscareers" (lib/companyDisplay.ts).
  // job.company stays the data key for the company lookup behind "Check".
  const companyName = displayCompanyName(job.company) || job.company
  const logoLetter = (companyName || '?')[0].toUpperCase()
  const pay = displayPay(job)
  // An Adzuna row is a ~500-char teaser of the posting, never its text: say so, link the full
  // posting, and never sell an optimization of a text we do not have.
  const preview = isDescriptionPreview(job)
  const snippet = job.description ? roleSnippet(job.description, job.company, job.title) : ''
  const applyHref = httpHref(job.apply_url)
  const canOptimize = !takesSeenApply(job) && !!applyHref && !preview
  // This person already optimized this listing on this device within 7 days (a hint; the modal
  // asks the server cache before it ever offers to charge).
  // Read after mount (localStorage) so the server HTML and the first client render agree.
  const [optimizedHere, setOptimizedHere] = useState(false)
  useEffect(() => { setOptimizedHere(wasOptimized(user?.id, job.id)) }, [user?.id, job.id])

  async function reportInactive(e: React.MouseEvent) {
    e.stopPropagation()
    if (!user) { alert('Sign in to report listings.'); return }
    setReportingInactive(true)
    try {
      await fetch('/api/user-sync', {
        method: 'POST',
        headers: await aiHeaders(),
        // Send a listing snapshot so admin can see/investigate the report even when this is a
        // live search result (j_<hash> id) never saved to the board. Mirrors app/jobs/[id].
        body: JSON.stringify({
          action: 'report_job_availability',
          job_id: String(job.id),
          status: 'expired',
          snapshot: {
            company: job.company || null,
            title: job.title || null,
            city: job.location || null,
            apply_url: job.apply_url || null,
          },
        }),
      })
      setReportedInactive(true)
      notify({ title: 'Thanks — reported', sub: 'We’ll review this listing', severity: 'success', duration: 2600 })
    } catch { /* silent */ } finally {
      setReportingInactive(false)
    }
  }

  function toggleSave(e: React.MouseEvent) {
    e.stopPropagation()
    if (saved) {
      SavedJobsStore.remove(job.id, isLoggedIn)
      setSaved(false)
      notify({ title: 'Removed from saved', sub: `${job.title} · ${companyName}`, severity: 'info', duration: 2600 })
    } else {
      SavedJobsStore.save(job, isLoggedIn)
      setSaved(true)
      notify({ title: 'Saved to your list', sub: `${job.title} · ${companyName}`, severity: 'success', duration: 2600 })
    }
    onSaveToggle(job.id)
  }

  return (
    <div className="jlc" style={{ animation: `riseIn .5s ${Math.min(index, 12) * 0.05}s cubic-bezier(.16,1,.3,1) both` }}>
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
          <div className="jlc-co">{companyName}</div>
          <div className="jlc-loc">📍 {job.location}{more.length > 0 && <span style={{ color: 'var(--dim)' }}> · +{more.length} more location{more.length !== 1 ? 's' : ''}</span>}</div>
        </div>
        <ListingScoreRing score={job.score} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '.35rem', flexWrap: 'wrap', margin: '.35rem 0' }}>
        {job.featured && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.25rem', fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '.06em', color: '#f7c948', background: 'rgba(247,201,72,.12)', border: '1px solid rgba(247,201,72,.4)', borderRadius: 999, padding: '.15rem .5rem' }}>★ Featured</span>
        )}
        {job.employer_posted && (
          <span title="Posted directly on Seen by the employer" style={{ display: 'inline-flex', alignItems: 'center', gap: '.25rem', fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--green)', background: 'var(--gdim)', border: '1px solid var(--green)', borderRadius: 999, padding: '.15rem .5rem' }}>✓ Posted on Seen</span>
        )}
        {wl && <span className={`${wl.cls} waste-badge`}>{wl.txt}</span>}
        {job.waste != null && job.waste >= 55 && (
          <span className="vibe v-r" style={{ display: 'inline-flex', alignItems: 'center', gap: '.25rem' }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--red)', display: 'inline-block', flexShrink: 0 }} />
            👻 high ghost risk
          </span>
        )}
        {job.availability_status === 'stale' && (
          <span className="vibe v-a" style={{ fontSize: 'var(--fs-meta)' }}>⚠ may be closed</span>
        )}
        {(job.availability_status === 'expired' || job.availability_status === 'closed') && (
          <span className="vibe v-r" style={{ fontSize: 'var(--fs-meta)' }}>✕ likely closed</span>
        )}
        {preview && (
          <span className="vibe v-a" title="This source gives Seen only a short preview of the posting" style={{ fontSize: 'var(--fs-meta)' }}>✂ Preview — full posting on the employer&apos;s site</span>
        )}
        {vibes.map((v, i) => (
          <span key={i} className={`vibe ${v.cls}`}>{v.txt}</span>
        ))}
        {alreadyApplied && (
          <span style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', background: 'rgba(99,102,241,.1)', border: '1px solid rgba(99,102,241,.22)', borderRadius: 5, padding: '.12rem .4rem', color: 'var(--indigo)' }}>✓ Applied</span>
        )}
      </div>

      {/* The posting's first sentence about the ROLE (lib/jobs/descriptionText.js roleSnippet) — not the
          company's mission paragraph that every one of its cards used to open with. */}
      {snippet && (
        <div style={{ fontSize: 'var(--fs-meta)', color: 'var(--muted)', margin: '.25rem 0', lineHeight: 1.55 }}>
          {snippet}
        </div>
      )}

      {more.length > 0 && (
        <div style={{ margin: '.1rem 0 .3rem' }}>
          <button
            type="button"
            onClick={e => { e.stopPropagation(); setMoreOpen(o => !o) }}
            aria-expanded={moreOpen}
            style={{ background: 'none', border: 'none', padding: '.35rem 0', fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', color: 'var(--blue)', cursor: 'pointer', minHeight: 44 }}
          >
            📍 {moreOpen ? 'Hide' : 'Show'} {more.length} more location{more.length !== 1 ? 's' : ''} for this role {moreOpen ? '▴' : '▾'}
          </button>
          {moreOpen && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '.2rem' }}>
              {more.map(m => (
                <button
                  key={m.id}
                  type="button"
                  onClick={e => { e.stopPropagation(); onOpen(m) }}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.5rem', width: '100%', minWidth: 0, minHeight: 44, textAlign: 'left', background: 'var(--raised)', border: '1px solid var(--line)', borderRadius: 8, padding: '.45rem .7rem', cursor: 'pointer', color: 'inherit' }}
                >
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', color: 'var(--sub)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>📍 {m.location}</span>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', color: 'var(--green)', flexShrink: 0 }}>Open →</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="jlc-meta">
        <span className="jlc-mi">{job.type || 'Full-time'}</span>
        {/* Level only when the title says it (unknown is '' — never a default "Mid level"). */}
        {job.level && <><span className="jlc-mi">·</span><span className="jlc-mi">{job.level}</span></>}
        {pay && <><span className="jlc-mi">·</span><span className="jlc-sal">{pay}</span></>}
        <span className="jlc-mi">·</span>
        <span className="jlc-mi" style={{ color: 'var(--blue)' }}>{job.source || 'Job board'}</span>
      </div>

      {/* The employer's own grade (how it treats applicants) when it has one — the ring above grades the
          posting only. Without a grade, the quick company check. */}
      {typeof employerScore === 'number' ? (
        <div style={{ padding: '.1rem 0 .55rem' }}>
          <EmployerGradeChip company={job.company} score={employerScore} />
        </div>
      ) : (
        <button
          onClick={e => { e.stopPropagation(); onCheckCompany(job.company) }}
          style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', color: 'var(--amber)', padding: '.1rem 0 .55rem', opacity: .8, cursor: 'pointer' }}
        >
          🏢 Check {companyName} →
        </button>
      )}

      {/* Two separate actions (2026-10-23): "Apply ↗" is FREE — it opens the listing in a new
          tab and offers tracking; "Optimize · 1 credit" is the paid optimizer. One tap never
          spends a credit the person did not ask for. */}
      <div className="jlc-actions" style={canOptimize ? splitRow : undefined}>
        <button
          className="jlc-save"
          data-saved={saved ? '1' : '0'}
          onClick={toggleSave}
          aria-label={saved ? 'Unsave' : 'Save'}
        >
          {saved ? '♥' : '♡'}
        </button>
        {takesSeenApply(job) ? (
          <button className="jlc-apply" onClick={e => { e.stopPropagation(); onApply(job) }}>Apply on Seen →</button>
        ) : applyHref ? (
          <>
            <a
              className="jlc-apply"
              href={applyHref}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="apply-link"
              style={{ textDecoration: 'none', minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', ...(canOptimize ? {} : { flex: 1 }) }}
              onClick={e => { e.stopPropagation(); trackApplyClick(job); setCheckpoint(true) }}
            >
              {preview ? 'Open the full posting ↗' : 'Apply ↗'}
            </a>
            {canOptimize && (
              <button
                type="button"
                style={optimizeBtn}
                data-testid="optimize-btn"
                title={optimizedHere ? 'Open your optimization for this job — kept for 7 days, no credit' : `Optimize your résumé for this job · ${priceLabel(RESUME_OPTIMIZE_COST, pro)}`}
                onClick={e => { e.stopPropagation(); onApply(job) }}
              >
                {/* opening the modal never charges; it checks the server cache first (C2/E6) */}
                {optimizedHere ? 'Optimize · cached' : <>Optimize · {priceLabel(RESUME_OPTIMIZE_COST, pro).replace(' ', '\u00a0')}</>}
              </button>
            )}
          </>
        ) : (
          <button className="jlc-apply" disabled style={{ opacity: .45, cursor: 'not-allowed' }}>No apply link</button>
        )}
      </div>
      {checkpoint && <ApplyCheckpoint job={job} onClose={() => setCheckpoint(false)} />}

      {/* A real link to the listing's own page (it was a button that, signed in, POSTed the posting to
          /api/job-insights and changed nothing on screen — audit 2026-10-24). The detail page probes the
          insight cache when it opens; nothing is sent from the card. */}
      <Link
        href={`/jobs/${pathSegment(job.id)}`}
        prefetch={false}
        data-testid="view-details"
        onClick={e => { e.stopPropagation(); JobCache.set(job) }}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', minHeight: 44, textDecoration: 'none', borderTop: '1px solid var(--line)', marginTop: '.6rem', fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', color: 'var(--green)' }}
      >
        View details + AI insights →
      </Link>

      {!reportedInactive ? (
        <button
          onClick={reportInactive}
          disabled={reportingInactive}
          style={{ background: 'none', border: 'none', fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', color: 'var(--dim)', cursor: 'pointer', padding: '.1rem 0', opacity: .55, transition: 'opacity .15s', display: 'block' }}
          onMouseOver={e => (e.currentTarget.style.opacity = '1')}
          onMouseOut={e => (e.currentTarget.style.opacity = '.55')}
        >
          {reportingInactive ? 'Reporting…' : '⚑ Not active? Report it'}
        </button>
      ) : (
        <span style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', color: 'var(--amber)', display: 'block', padding: '.1rem 0' }}>✓ Reported — thanks</span>
      )}
    </div>
  )
}

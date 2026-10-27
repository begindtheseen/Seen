'use client'

// One search result, compact (audit #26: cards were ~300px with a gradient CTA each, 1.5 visible at
// 1440). ~120px: title · company · place · pay, at most three badges (the employer's grade first),
// then one row of actions. The posting's text, insights and the full company check live in the
// drawer / the listing page — a tap on the card opens the drawer.
import { useState, useEffect } from 'react'
import { SavedJobsStore } from '@/lib/stores/SavedJobs'
import { useAuth } from '@/lib/auth'
import { aiHeaders } from '@/lib/aiHeaders'
import { notify } from '@/lib/notify'
import type { Job } from '@/lib/types'
import { takesSeenApply } from '@/lib/seenApplyMode'
import { trackApplyClick } from '@/lib/trackApply'
import { RESUME_OPTIMIZE_COST, priceLabel } from '@/lib/creditRules'
import { useProStatus } from '@/lib/hooks/useProStatus'
import ApplyCheckpoint from '@/components/ApplyCheckpoint'
import { displayCompanyName } from '@/lib/companyDisplay'
import { displayPay } from '@/lib/jobs/pay.js'
import { isDescriptionPreview } from '@/lib/jobs/descriptionText.js'
import { httpHref, pathSegment } from '@/lib/safeHref.js'
import { wasOptimized } from '@/lib/optimizedJobs'
import { JobCache } from '@/lib/stores/JobCache'
import { wastedEffortTone } from '@/lib/ui/tone.js'
import ListingScoreRing from '@/components/jobs/ListingScoreRing'
import EmployerGradeChip from '@/components/jobs/EmployerGradeChip'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import Icon from '@/components/ui/Icon'
import s from './JobCard.module.css'

type Tag = { key: string; node: React.ReactNode }

export default function JobCard({ job, onSaveToggle, onOpen, onApply, onCheckCompany, alreadyApplied, more = [], employerScore = null }: { job: Job; index?: number; onSaveToggle: (id: string) => void; onOpen: (job: Job) => void; onApply: (job: Job) => void; onCheckCompany: (company: string) => void; alreadyApplied?: boolean; /** Same employer + title at other addresses (lib/jobs/groupListings.js) — one card, "+N more locations". */ more?: Job[]; /** The employer's overall score when it is GRADEABLE (useJobSearch coScores — already grade-gated), else null. */ employerScore?: number | null }) {
  const [saved, setSaved] = useState(() => SavedJobsStore.isSaved(job.id))
  const [reportedInactive, setReportedInactive] = useState(false)
  const [reportingInactive, setReportingInactive] = useState(false)
  // After a plain "Apply" the existing tracker checkpoint offers "Did you apply? → track it".
  const [checkpoint, setCheckpoint] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const { user, isLoggedIn } = useAuth()
  const pro = useProStatus()
  // The employer as a person names it: "PLS", not the board slug "plscareers" (lib/companyDisplay.ts).
  // job.company stays the data key for the company lookup behind "Check".
  const companyName = displayCompanyName(job.company) || job.company
  const logoLetter = (companyName || '?')[0].toUpperCase()
  const pay = displayPay(job)
  // An Adzuna row is a ~500-char teaser of the posting, never its text: say so and link the full posting.
  // Optimize still shows: the server follows the row's own link for the posting before it ever asks the
  // person to paste it (lib/server/fullPosting.js) — owner 2026-10-27, "the option to optimize is just gone".
  const preview = isDescriptionPreview(job)
  const applyHref = httpHref(job.apply_url)
  const canOptimize = !takesSeenApply(job) && !!applyHref
  // This person already optimized this listing on this device within 7 days (a hint; the modal asks the
  // server cache before it ever offers to charge). Read after mount so server and client HTML agree.
  const [optimizedHere, setOptimizedHere] = useState(false)
  useEffect(() => { setOptimizedHere(wasOptimized(user?.id, job.id)) }, [user?.id, job.id])

  async function reportInactive(e: React.MouseEvent) {
    e.stopPropagation()
    if (!user) { notify({ title: 'Sign in to report listings', severity: 'info', duration: 2600 }); return }
    setReportingInactive(true)
    try {
      await fetch('/api/user-sync', {
        method: 'POST',
        headers: await aiHeaders(),
        // Send a listing snapshot so admin can see/investigate the report even when this is a live search
        // result (j_<hash> id) never saved to the board. Mirrors app/jobs/[id].
        body: JSON.stringify({
          action: 'report_job_availability',
          job_id: String(job.id),
          status: 'expired',
          snapshot: { company: job.company || null, title: job.title || null, city: job.location || null, apply_url: job.apply_url || null },
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

  // At most three badges, most useful first. Warnings (closed / preview / high wasted-effort risk) beat
  // the nice-to-know ones; the employer's grade always leads when it exists.
  const src = (job.source || '').toLowerCase()
  const remote = (job.location || '').toLowerCase().includes('remote') || (job.type || '').toLowerCase().includes('remote')
  const wt = job.waste != null ? wastedEffortTone(job.waste) : null
  const tags: Tag[] = []
  if (job.availability_status === 'expired' || job.availability_status === 'closed') tags.push({ key: 'closed', node: <Badge tone="bad">Likely closed</Badge> })
  else if (job.availability_status === 'stale') tags.push({ key: 'stale', node: <Badge tone="caution">May be closed</Badge> })
  if (wt === 'bad' || wt === 'caution') tags.push({ key: 'waste', node: <Badge tone={wt} title="The chance applying here costs effort for nothing (ghosting, unpaid work, long processes)">{job.waste}% wasted-effort risk</Badge> })
  if (preview) tags.push({ key: 'preview', node: <Badge icon="scissors" title="This source gives Seen only a short preview of the posting">Preview only</Badge> })
  if (job.featured) tags.push({ key: 'featured', node: <Badge tone="accent" icon="star">Featured</Badge> })
  if (job.employer_posted) tags.push({ key: 'seen', node: <Badge tone="good" title="Posted directly on Seen by the employer">Posted on Seen</Badge> })
  if (alreadyApplied) tags.push({ key: 'applied', node: <Badge tone="accent" icon="check">Applied</Badge> })
  if (remote) tags.push({ key: 'remote', node: <Badge icon="house">Remote</Badge> })
  if (src.includes('greenhouse') || src.includes('lever') || src.includes('workday')) tags.push({ key: 'ats', node: <Badge icon="check">Apply direct</Badge> })

  return (
    <article className={s.card}>
      <div
        className={s.main}
        onClick={() => onOpen(job)}
        role="button"
        tabIndex={0}
        aria-label={`${job.title} at ${companyName} — open details`}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(job) } }}
      >
        <div className={s.logo} aria-hidden="true">{logoLetter}</div>
        <div className={s.body}>
          <h3 className={s.title}>{job.title}</h3>
          <p className={s.meta}>
            <span className={s.co}>{companyName}</span>
            {job.location && <span className={s.place}><Icon name="map-pin" size={12} />{job.location}</span>}
            {pay && <span className={`${s.pay} tnum`}>{pay}</span>}
            {job.type && <span>{job.type}</span>}
          </p>
          <div className={s.tags}>
            {typeof employerScore === 'number'
              ? <EmployerGradeChip company={job.company} score={employerScore} compact />
              : (
                <button type="button" className={s.check} onClick={e => { e.stopPropagation(); onCheckCompany(job.company) }}>
                  <Icon name="building-2" size={12} />Check {companyName}
                </button>
              )}
            {tags.slice(0, 2).map(t => <span key={t.key} className={s.tag}>{t.node}</span>)}
          </div>
        </div>
        <ListingScoreRing score={job.score} size={40} />
      </div>

      {more.length > 0 && (
        <div className={s.more}>
          <button type="button" className={s.moreBtn} onClick={e => { e.stopPropagation(); setMoreOpen(o => !o) }} aria-expanded={moreOpen}>
            <Icon name="map-pin" size={12} />{moreOpen ? 'Hide' : 'Show'} {more.length} more location{more.length !== 1 ? 's' : ''}
            <Icon name="chevron-down" size={14} className={moreOpen ? s.flip : undefined} />
          </button>
          {moreOpen && (
            <ul className={s.moreList}>
              {more.map(m => (
                <li key={m.id}>
                  <button type="button" className={s.moreRow} onClick={e => { e.stopPropagation(); onOpen(m) }}>
                    <span>{m.location}</span><Icon name="arrow-right" size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* "Apply" is FREE — it opens the listing in a new tab and offers tracking; "Optimize · 1 credit" is
          the paid optimizer. One tap never spends a credit the person did not ask for. Apply is a
          secondary button here: the page's one gradient is its Search button (audit #10, #26). */}
      <div className={s.actions}>
        <button type="button" className={s.save} data-saved={saved ? '1' : '0'} onClick={toggleSave} aria-label={saved ? 'Remove from saved' : 'Save'} aria-pressed={saved}>
          <Icon name="heart" size={16} />
        </button>
        {takesSeenApply(job) ? (
          <Button size="sm" variant="secondary" onClick={e => { e.stopPropagation(); onApply(job) }} iconRight="arrow-right">Apply on Seen</Button>
        ) : applyHref ? (
          <Button
            size="sm"
            variant="secondary"
            href={applyHref}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="apply-link"
            iconRight="arrow-up-right"
            onClick={e => { e.stopPropagation(); trackApplyClick(job); setCheckpoint(true) }}
          >
            {preview ? 'Full posting' : 'Apply'}
          </Button>
        ) : (
          <Button size="sm" variant="secondary" disabled>No apply link</Button>
        )}
        {canOptimize && (
          <Button
            size="sm"
            variant="ghost"
            data-testid="optimize-btn"
            title={optimizedHere ? 'Open your optimization for this job — kept for 7 days, no credit' : `Optimize your résumé for this job · ${priceLabel(RESUME_OPTIMIZE_COST, pro)}`}
            onClick={e => { e.stopPropagation(); onApply(job) }}
          >
            {/* opening the modal never charges; it checks the server cache first (C2/E6) */}
            {optimizedHere ? 'Optimize · cached' : <>Optimize · {priceLabel(RESUME_OPTIMIZE_COST, pro).replace(' ', ' ')}</>}
          </Button>
        )}
        {/* A real link to the listing's own page; the detail page probes the insight cache when it opens. */}
        <Button size="sm" variant="ghost" href={`/jobs/${pathSegment(job.id)}`} prefetch={false} data-testid="view-details" onClick={e => { e.stopPropagation(); JobCache.set(job) }} className={s.details}>
          Details
        </Button>
        {!reportedInactive ? (
          <button type="button" className={s.flag} onClick={reportInactive} disabled={reportingInactive} aria-label="Not active? Report this listing" title="Not active? Report this listing">
            <Icon name="flag" size={16} />
          </button>
        ) : (
          <span className={s.reported}><Icon name="check" size={14} />Reported</span>
        )}
      </div>
      {checkpoint && <ApplyCheckpoint job={job} onClose={() => setCheckpoint(false)} />}
    </article>
  )
}

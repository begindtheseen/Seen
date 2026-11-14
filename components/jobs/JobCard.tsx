'use client'

// One search result (DESIGN.md §5: one title, one line of support, one row of meta). The card used to
// carry ~9 targets (a dashed "Check <company>" chip, "Preview only", ♡ / Full posting / Optimize /
// Details, a flag and the score ring — design review 2026-11-02). Now:
//   title · ONE meta line (company · location · pay · type) · ONE chip row (posting score, the
//   employer's grade when known — else "Check company", one quiet status) · ONE action row: Details + ♡.
// Optimize, the posting link and "Not active? Report it" live in the drawer / the listing page.
import { useState } from 'react'
import { SavedJobsStore } from '@/lib/stores/SavedJobs'
import { useAuth } from '@/lib/auth'
import { notify } from '@/lib/notify'
import type { Job } from '@/lib/types'
import { displayCompanyName } from '@/lib/companyDisplay'
import { displayPay } from '@/lib/jobs/pay.js'
import { LISTING_SCORE_TITLE } from '@/components/jobs/ListingScoreRing'
import EmployerGradeChip from '@/components/jobs/EmployerGradeChip'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import Icon from '@/components/ui/Icon'
import s from './JobCard.module.css'
import { displayLocation } from '@/lib/jobs/displayLocation.js'
import { distanceLabel } from '@/lib/jobs/distanceLabel.js'

export default function JobCard({ job, onSaveToggle, onOpen, onCheckCompany, alreadyApplied, more = [], employerScore = null }: {
  job: Job
  index?: number
  onSaveToggle: (id: string) => void
  onOpen: (job: Job) => void
  /** Opens the company preview (the card's company chip when the employer has no grade yet). */
  onCheckCompany: (company: string) => void
  alreadyApplied?: boolean
  /** Same employer + title at other addresses (lib/jobs/groupListings.js) — one card, "+N more locations". */
  more?: Job[]
  /** The employer's overall score when it is GRADEABLE (useJobSearch coScores — already grade-gated), else null. */
  employerScore?: number | null
}) {
  const [saved, setSaved] = useState(() => SavedJobsStore.isSaved(job.id))
  const [moreOpen, setMoreOpen] = useState(false)
  const { isLoggedIn } = useAuth()
  // The employer as a person names it: "PLS", not the board slug "plscareers" (lib/companyDisplay.ts).
  // job.company stays the data key for the company lookup behind the chip.
  const companyName = displayCompanyName(job.company) || job.company
  const logoLetter = (companyName || '?')[0].toUpperCase()
  const pay = displayPay(job)

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

  // ONE quiet status at most: a closed warning beats "Applied", which beats "Featured". Everything
  // else the card used to badge (waste risk, preview, remote, source) is in the drawer.
  const status = (job.availability_status === 'expired' || job.availability_status === 'closed')
    ? <Badge tone="bad">Likely closed</Badge>
    : job.availability_status === 'stale'
      ? <Badge tone="caution">May be closed</Badge>
      : alreadyApplied
        ? <Badge icon="check">Applied</Badge>
        : job.featured
          ? <Badge icon="star">Featured</Badge>
          : null

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
            {job.location && <span className={s.place} title={job.location}><Icon name="map-pin" size={12} />{displayLocation(job.location)}{job.also_in ? ` · +${job.also_in} ${job.also_in === 1 ? 'city' : 'cities'}` : ''}{distanceLabel(job as never) ? ` · ${distanceLabel(job as never)}` : ''}</span>}
            {pay && <span className="tnum">{pay}</span>}
            {job.type && <span>{job.type}</span>}
          </p>
          <div className={s.chips}>
            {job.score != null && (
              <span className={`${s.chip} tnum`} title={LISTING_SCORE_TITLE} aria-label={`Posting score ${job.score} out of 100`}>
                Posting score <b>{job.score}</b>
              </span>
            )}
            {/* The posting says it takes people with no experience and trains them (lib/jobs/trainsBeginners.js) — ink, no fill. */}
            {job.trains_beginners === true && (
              <span className={s.chip} title="The posting says it takes people with no experience and trains them" data-testid="chip-paid-training">Paid training</span>
            )}
            {typeof employerScore === 'number'
              ? <EmployerGradeChip company={job.company} score={employerScore} compact />
              : (
                <button type="button" className={`${s.chip} ${s.chipBtn}`} onClick={e => { e.stopPropagation(); onCheckCompany(job.company) }} title={`How ${companyName} treats applicants`}>
                  <Icon name="building-2" size={12} />Check company
                </button>
              )}
            {status && <span className={s.status}>{status}</span>}
          </div>
        </div>
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

      {/* Exactly two actions. Details opens the drawer (the posting, Apply, Optimize and the company check
          live there); ♡ saves. The page's one filled button is its Search button. */}
      <div className={s.actions}>
        <Button size="sm" variant="secondary" data-testid="view-details" onClick={e => { e.stopPropagation(); onOpen(job) }} iconRight="chevron-right">
          Details
        </Button>
        <button type="button" className={s.save} data-saved={saved ? '1' : '0'} onClick={toggleSave} aria-label={saved ? 'Remove from saved' : 'Save'} aria-pressed={saved}>
          <Icon name="heart" size={16} />
        </button>
      </div>
    </article>
  )
}

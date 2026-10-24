'use client'

// Tracker "Outcome" share card: a typographic poster of this one application's story, drawn by
// the shared kit (lib/cardKit.ts) in square and story formats, shared through the one modal
// shell (components/CardShareModal.tsx) and lib/shareCard.ts. Maps the tracked Application
// (events, dates, status, platform, city) into the kit's outcome model. The company's Seen grade,
// when it has one, is looked up (bounded) so the card can carry one honest line of context —
// never invented when absent.

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Application } from '@/lib/types'
import { drawOutcomeCard, type CardFormat, type OutcomeCardData, type CompanyGradeContext } from '@/lib/cardKit'
import { ACCENTS, accentKeyForOutcome } from '@/lib/cardTheme.js'
import { outcomeShareText, outcomeHeadline, companyHref, daysBetween } from '@/lib/cardCopy.js'
import { gradeLetter } from '@/lib/companyDisplay'
import { isGradeableScore } from '@/lib/gradeGate'
import { track } from '@/lib/analytics'
import CardShareModal from '@/components/CardShareModal'

interface Props {
  app: Application
  onClose: () => void
  // Fired once when the card is shared to a destination or downloaded. Used by the
  // tracker→report→share loop to record a light outcome_card_shares analytics row.
  onShared?: (via: string) => void
  /** Letter grades of the person's OTHER tracked companies (when the tracker knows them) — lets a
   *  hired post compare: "The other 3 places I applied were a C or worse on seenjobs.io". */
  otherGrades?: string[]
}

export function buildOutcome(app: Application): OutcomeCardData {
  const events = app.events || []
  const appliedMs = events.find(e => e.type === 'application_submitted')?.date || app.appliedAt || Date.now()
  const offerEvt = events.find(e => e.type === 'offer_received')
  const rejEvt = events.find(e => e.type === 'rejected')
  const ghostEvt = events.find(e => e.type === 'ghosted')
  const intEvt = events.find(e => e.type === 'interview_received')
  const outcomeMs = (offerEvt || rejEvt || ghostEvt)?.date || app.updatedAt || Date.now()
  const outcome = (app.status === 'hired' || offerEvt) ? 'hired'
    : (app.status === 'ghosted' || ghostEvt) ? 'ghosted'
    : 'rejected'
  return {
    company: app.company || 'Company',
    role: app.role,
    outcome,
    days: daysBetween(appliedMs, outcomeMs),
    reachedInterview: !!intEvt,
    platform: app.platform,
    appliedMs,
    // The tracker's real events: the grid marks their days and the timeline line names them.
    events: events.filter(e => Number.isFinite(e.date)).map(e => ({ type: String(e.type), date: e.date })),
  }
}

// The company's grade for the context strip, from the same batch_scores the tracker reads
// (api/reports.js → gateScore). Bounded so the card never waits on a slow network; a miss or a
// non-gradeable company simply means no strip.
async function lookupGrade(company: string): Promise<CompanyGradeContext | null> {
  const name = company.toLowerCase().trim()
  if (!name) return null
  try {
    const r = await fetch('/api/reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'batch_scores', names: [name] }),
      signal: AbortSignal.timeout(1500),
    })
    if (!r.ok) return null
    const d = await r.json() as { scores?: Record<string, { gradeable?: boolean | null; overall_score?: number | null; ghost_rate?: number | null; response_rate?: number | null; avg_wait_days?: number | null; first_party_report_count?: number | null }> }
    const s = d.scores?.[name]
    if (!isGradeableScore(s)) return null
    return {
      grade: gradeLetter(s.overall_score), score: Math.round(s.overall_score),
      ghostRate: s.ghost_rate ?? null, responseRate: s.response_rate ?? null,
      avgWaitDays: s.avg_wait_days ?? null,
      // First-party only — the fused count is a web claim and never reads as "reports".
      reports: s.first_party_report_count ?? null,
    }
  } catch {
    return null
  }
}

export default function OutcomeCard({ app, onClose, onShared, otherGrades }: Props) {
  const data = useMemo(() => buildOutcome(app), [app])
  const status = data.outcome
  const accent = ACCENTS[accentKeyForOutcome(status)].hex
  const head = outcomeHeadline({ outcome: status, company: data.company, days: data.days, reachedInterview: data.reachedInterview })
  // No public per-outcome page exists, so unfurl the company page (which has a dynamic OG image).
  // The slug must round-trip through /company/[slug]'s decoder — one scheme (lib/cardCopy.js).
  const unfurlUrl = companyHref(data.company)

  // One grade lookup shared by both formats and by the post text (which quotes the real rate).
  const gradePromise = useMemo(() => lookupGrade(data.company), [data.company])
  const [grade, setGrade] = useState<CompanyGradeContext | null>(null)
  useEffect(() => { let on = true; gradePromise.then(g => { if (on) setGrade(g) }); return () => { on = false } }, [gradePromise])
  const shareText = outcomeShareText({ outcome: status, company: data.company, days: data.days, reachedInterview: data.reachedInterview, grade, others: otherGrades })
  const draw = useCallback(async (canvas: HTMLCanvasElement, format: CardFormat) => {
    const companyGrade = await gradePromise
    drawOutcomeCard(canvas, { ...data, companyGrade }, format)
  }, [data, gradePromise])

  return (
    <CardShareModal
      kicker="Outcome card"
      title={head.text}
      sub={head.parts.length > 1 ? 'Share it. The next applicant deserves to know what to expect.' : `${data.company}. Share it so the next applicant knows what to expect.`}
      accent={accent}
      draw={draw}
      shareText={shareText}
      shareUrl={unfurlUrl}
      fileBase={`${status}_${(data.company || 'c').replace(/[^a-z0-9]/gi, '_')}`}
      onClose={onClose}
      onGenerated={(format) => track('card_generated', { card_type: 'outcome', outcome: status, format })}
      onShareAttempt={(dest) => onShared?.(dest)}
      onShared={(dest, method) => track('card_shared', { card_type: 'outcome', method, destination: dest, outcome: status })}
      skipLabel="Skip, don't share"
    />
  )
}

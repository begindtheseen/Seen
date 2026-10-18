// Client + server helper for the grade gate (owner decision 2026-10-17): a company gets a letter
// grade, overall score, ghost rate, response rate or risk badge ONLY when at least
// MIN_REPORTS_FOR_GRADE real reports stand behind it. Every score payload from the API and from
// lib/growth.ts carries `gradeable`; below the bar its verdict fields are null (see gateScore in
// lib/server/reportCounts.js). Surfaces use these helpers so the wording is the same everywhere.

import { MIN_REPORTS_FOR_GRADE, firstPartyReportCount, gradeEvidenceCount, mentionCount } from '@/lib/server/reportCounts.js'

export { MIN_REPORTS_FOR_GRADE }

type MaybeScore = {
  gradeable?: boolean | null
  overall_score?: number | null
  first_party_report_count?: number | null
  data_source?: string | null
  report_count?: number | null
  mention_count?: number | null
} | null | undefined

/**
 * True only when a score may be shown as a verdict. `gradeable: false` OR a null overall_score both
 * mean "no grade" (a CDN-cached payload from before the gate has no `gradeable` field — its null
 * score still reads correctly).
 */
export function isGradeableScore<T extends MaybeScore>(s: T): s is NonNullable<T> & { overall_score: number } {
  return !!s && s.gradeable !== false && typeof s.overall_score === 'number' && Number.isFinite(s.overall_score)
}

/** Real reports behind a score payload (never the web-research claim). */
export function realReportCount(s: MaybeScore): number {
  return firstPartyReportCount(s ?? null)
}

/** Reports + half of each online mention (owner rule), capped at the bar, e.g. "3.5". */
function progress(s: MaybeScore): string {
  const n = Math.min(gradeEvidenceCount(s ?? null), MIN_REPORTS_FOR_GRADE)
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

/** "Not enough reviews to grade yet (2 of 5)" — the one wording every surface uses. */
export function notEnoughReviewsLabel(s: MaybeScore): string {
  return `Not enough reviews to grade yet (${progress(s)} of ${MIN_REPORTS_FOR_GRADE})`
}

/** Short form for tight spaces (cards, chips): "2 of 5 reviews". */
export function notEnoughReviewsShort(s: MaybeScore): string {
  return `${progress(s)} of ${MIN_REPORTS_FOR_GRADE} reviews`
}

/** "12 reports + 6 online mentions" — what a score stands on (mentions count half each). */
export function gradeBasisLabel(s: MaybeScore): string {
  const r = realReportCount(s), m = mentionCount(s ?? null)
  const reports = `${r} report${r === 1 ? '' : 's'}`
  return m > 0 ? `${reports} + ${m} online mention${m === 1 ? '' : 's'} (count half)` : reports
}

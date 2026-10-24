// ONE summary object for a company page. Every count, rate, confidence label and verdict sentence a
// visitor can read — hero, odds panel, "how the grade is built", the reports list headers, the share
// card — is read from here, computed once from the score payload and the listed report rows.
//
// Why (audit 2026-10-23/24, seenjobs.io): Walmart's hero said "48 applicant reports" while the same page
// said "77 community reports" and "from public discussion · 77"; Insight Global's hero said "Most
// applicants never hear back" while its odds panel said "Most applicants here hear back"; Chipotle showed
// "77% … the share of 2 applicant reports"; Target's card said "High confidence" under a "Moderate
// confidence" hero. Each surface had its own arithmetic. Now each has none.
//
// Vocabulary (fixed — copy must use these words):
//   applicant reports  = first-party rows WITH an outcome, the rows the grade is built from
//                        (score.first_party_report_count; lib/server/reportCounts.js).
//   still waiting      = listed hiring rows with no outcome yet — listed, never counted.
//   employee reviews   = workplace accounts; their letter grades nudge the score, never hiring outcomes.
//   online mentions    = quoted accounts behind the score (score.mention_count; each counts ½).
//   rows               = everything the page lists, whatever its kind.
//
// Pure; relative .js/.ts imports only so `node --test lib/companyPageSummary.test.mjs` runs it as is.

import { NONTERMINAL_OUTCOMES } from '../api/_utils/companyIntel.js'
import { firstPartyReportCount, mentionCount, webClaimCount, isScorableReport } from './server/reportCounts.js'
import { isEmployeeReview, isImportedReview, isPublicDiscussion } from './reportSource.ts'

/** Below this many applicant reports no response / ghost PERCENTAGE is shown — "too few reports" instead. */
export const MIN_REPORTS_FOR_RATES = 5

export type ScoreLike = {
  gradeable?: boolean | null
  overall_score?: number | null
  response_rate?: number | null
  ghost_rate?: number | null
  avg_wait_days?: number | null
  report_count?: number | null
  first_party_report_count?: number | null
  web_report_count?: number | null
  mention_count?: number | null
  employee_review_count?: number | null
  data_quality?: string | null
  data_source?: string | null
} | null | undefined

export type ReportLike = {
  outcome?: string | null
  platform?: string | null
  report_text?: string | null
  trust_reason?: string | null
  needs_review?: boolean | null
}

export type ResponseVerdict = 'most_hear_back' | 'mixed' | 'few_hear_back'
export type ConfidenceLevel = 'high' | 'moderate' | 'low'

export interface ListedCounts {
  /** Every row the page lists. */
  rows: number
  /** Rows that are hiring accounts (not employee reviews). */
  hiring: number
  /** Hiring rows with a decided outcome. */
  withOutcome: number
  /** Hiring rows with no outcome yet — listed, never counted. */
  waiting: number
  employee: number
  /** Rows compiled from public discussion (Reddit / "Public review · <host>"). */
  publicDiscussion: number
  publicWithOutcome: number
  publicWaiting: number
  /** Rows imported from review sites (Glassdoor / Indeed / LinkedIn / Blind). */
  imported: number
  importedWithOutcome: number
  /** Rows submitted to Seen directly. */
  seen: number
  seenWithOutcome: number
}

export interface OutcomeCounts { ghosted: number; rejected: number; interview: number; hired: number; waiting: number }

export interface CompanySummary {
  graded: boolean
  /** First-party applicant reports with an outcome — THE "N applicant reports" everywhere. */
  applicantReports: number
  mentions: number
  employeeReviews: number
  webClaim: number
  listed: ListedCounts
  outcomes: OutcomeCounts
  responseRate: number | null
  ghostRate: number | null
  /** Rates are shown as percentages only when graded AND applicantReports >= MIN_REPORTS_FOR_RATES. */
  ratesShown: boolean
  responsePct: number | null
  ghostPct: number | null
  verdictKind: ResponseVerdict | null
  /** The hero sentence. '' when not graded. */
  verdict: string
  /** The odds panel's one-line context, built from the SAME response rate as the verdict. */
  oddsContext: string
  /** "48 applicant reports · 32 online mentions" — what the grade stands on. */
  evidenceLine: string
  /** `word` is the bare "High confidence" the share card prints; `label` adds the evidence line. */
  confidence: { level: ConfidenceLevel; word: string; label: string; emoji: string } | null
  /** Set when the listed rows with an outcome differ from the grade's count (a stale stored score). */
  listedNote: string
}

const toRate = (v: number | null | undefined): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : null)
export const pctOf = (v: number | null | undefined): number | null => { const r = toRate(v); return r == null ? null : Math.round(r * 100) }
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export const isResolved = (outcome: string | null | undefined): boolean => !NONTERMINAL_OUTCOMES.has(String(outcome ?? '').toLowerCase().trim())

/** One threshold set for every sentence about hearing back. */
export function responseVerdict(responseRate: number | null | undefined): ResponseVerdict | null {
  const r = toRate(responseRate)
  if (r == null) return null
  if (r >= 0.75) return 'most_hear_back'
  if (r >= 0.5) return 'mixed'
  return 'few_hear_back'
}

/** The odds panel's wording for a verdict kind (no numbers — the panel prints its own percentage). */
export function oddsPhrase(kind: ResponseVerdict | null): string {
  if (kind === 'most_hear_back') return 'Most applicants here hear back'
  if (kind === 'mixed') return 'Mixed — about half hear back; apply with a tailored résumé'
  if (kind === 'few_hear_back') return 'Few applicants here hear back'
  return ''
}

/** "Too few applicant reports (2) to estimate a response chance — 5 needed." */
export function tooFewReportsLine(n: number): string {
  return `Too few applicant reports (${n}) to estimate a response chance — ${MIN_REPORTS_FOR_RATES} needed.`
}

/** The ONE confidence label, from the stored data_quality — never re-derived from a row count elsewhere. */
export function confidenceFrom(dataQuality: string | null | undefined, evidence: string): CompanySummary['confidence'] {
  const dq = String(dataQuality ?? '').toLowerCase().trim()
  if (!dq) return null
  const level: ConfidenceLevel = dq === 'strong' || dq === 'high' ? 'high' : dq === 'moderate' || dq === 'medium' ? 'moderate' : 'low'
  const word = `${level === 'high' ? 'High' : level === 'moderate' ? 'Moderate' : 'Low'} confidence`
  const emoji = level === 'high' ? '🟢' : level === 'moderate' ? '🟡' : '🔴'
  return { level, word, emoji, label: `${word} · ${evidence}` }
}

/** "48 applicant reports · 32 online mentions · 12 employee reviews" — every kind of evidence behind the grade. */
export function evidenceLineOf(applicantReports: number, mentions = 0, employeeReviews = 0): string {
  const parts = [plural(applicantReports, 'applicant report')]
  if (employeeReviews > 0) parts.push(plural(employeeReviews, 'employee review'))
  if (mentions > 0) parts.push(plural(mentions, 'online mention'))
  return parts.join(' · ')
}

export function countListed(reports: ReportLike[] | null | undefined): { listed: ListedCounts; outcomes: OutcomeCounts; scorableWithOutcome: number } {
  const rows = Array.isArray(reports) ? reports : []
  const listed: ListedCounts = { rows: rows.length, hiring: 0, withOutcome: 0, waiting: 0, employee: 0, publicDiscussion: 0, publicWithOutcome: 0, publicWaiting: 0, imported: 0, importedWithOutcome: 0, seen: 0, seenWithOutcome: 0 }
  const outcomes: OutcomeCounts = { ghosted: 0, rejected: 0, interview: 0, hired: 0, waiting: 0 }
  let scorableWithOutcome = 0
  for (const r of rows) {
    const pub = isPublicDiscussion(r.platform)
    const imp = !pub && isImportedReview(r.platform, r.trust_reason)
    if (pub) listed.publicDiscussion += 1
    else if (imp) listed.imported += 1
    else listed.seen += 1
    if (isEmployeeReview(r)) { listed.employee += 1; continue }
    listed.hiring += 1
    const oc = String(r.outcome ?? '').toLowerCase().trim()
    if (!isResolved(oc)) {
      listed.waiting += 1
      outcomes.waiting += 1
      if (pub) listed.publicWaiting += 1
      continue
    }
    listed.withOutcome += 1
    if (pub) listed.publicWithOutcome += 1
    else if (imp) listed.importedWithOutcome += 1
    else listed.seenWithOutcome += 1
    if (isScorableReport(r)) scorableWithOutcome += 1
    if (oc === 'ghosted') outcomes.ghosted += 1
    else if (oc === 'rejected' || oc === 'autoreject') outcomes.rejected += 1
    else if (oc === 'interview' || oc === 'interviewing' || oc === 'human') outcomes.interview += 1
    else if (oc === 'hired' || oc === 'offer') outcomes.hired += 1
  }
  return { listed, outcomes, scorableWithOutcome }
}

/**
 * Build the summary. `graded` follows the API's gate (gradeable !== false and a numeric overall_score —
 * lib/gradeGate.ts isGradeableScore); every rate and sentence is null/'' below it.
 */
export function buildCompanySummary(score: ScoreLike, reports: ReportLike[] | null | undefined): CompanySummary {
  const s = score ?? null
  const graded = !!s && s.gradeable !== false && typeof s.overall_score === 'number' && Number.isFinite(s.overall_score)
  const applicantReports = firstPartyReportCount(s)
  const mentions = mentionCount(s)
  const employeeReviews = Math.max(0, Math.floor(Number(s?.employee_review_count) || 0))
  const webClaim = webClaimCount(s)
  const { listed, outcomes, scorableWithOutcome } = countListed(reports)
  const responseRate = graded ? toRate(s!.response_rate) : null
  const ghostRate = graded ? toRate(s!.ghost_rate) : null
  const ratesShown = graded && applicantReports >= MIN_REPORTS_FOR_RATES && responseRate != null
  const responsePct = ratesShown ? pctOf(responseRate) : null
  const ghostPct = ratesShown ? pctOf(ghostRate) : null
  const evidenceLine = evidenceLineOf(applicantReports, mentions, employeeReviews)
  const verdictKind = ratesShown ? responseVerdict(responseRate) : null

  let verdict = ''
  let oddsContext = ''
  if (graded) {
    const wait = s!.avg_wait_days != null && Number.isFinite(Number(s!.avg_wait_days)) ? ` Typical wait to hear back: ${Math.round(Number(s!.avg_wait_days))} days.` : ''
    if (!ratesShown) {
      verdict = `Graded from ${evidenceLine} — too few applicant reports for a reliable response rate (${MIN_REPORTS_FOR_RATES} needed).${wait}`
      oddsContext = tooFewReportsLine(applicantReports)
    } else {
      const g = ghostPct ?? 0
      if (verdictKind === 'most_hear_back') verdict = `Most applicants hear back — ${responsePct}% get a response.${wait}`
      else if (verdictKind === 'mixed') verdict = `Mixed: about ${responsePct}% of applicants hear back, ${g}% are ghosted.${wait}`
      else verdict = `Most applicants never hear back — only ${responsePct}% get a response${g > 0 ? `, ${g}% are ghosted` : ''}.${wait}`
      const basis = mentions > 0
        ? `the share of ${plural(applicantReports, 'applicant report')} (and ${plural(mentions, 'online mention')}, each counting half) that heard back`
        : `the share of ${plural(applicantReports, 'applicant report')} that heard back`
      oddsContext = `${oddsPhrase(verdictKind)} · ${basis}`
    }
  }

  const confidence = applicantReports > 0 ? confidenceFrom(s?.data_quality, evidenceLine) : null
  // The list is read at a different moment than the stored score, and the API self-repairs a stale
  // score on the next request — but a visitor must never see two unexplained numbers.
  const listedNote = graded && scorableWithOutcome > 0 && scorableWithOutcome !== applicantReports
    ? `The grade was last built from ${plural(applicantReports, 'applicant report')}; this page lists ${scorableWithOutcome} with an outcome — it is refreshed on the next recompute.`
    : ''

  return { graded, applicantReports, mentions, employeeReviews, webClaim, listed, outcomes, responseRate, ghostRate, ratesShown, responsePct, ghostPct, verdictKind, verdict, oddsContext, evidenceLine, confidence, listedNote }
}

/** "77 rows from public discussion & review sites · 48 with an outcome · 29 still waiting (not counted)". */
export function publicRowsHeading(listed: ListedCounts): string {
  const n = listed.publicDiscussion + listed.imported
  const withOutcome = listed.publicWithOutcome + listed.importedWithOutcome
  const parts = [`${plural(n, 'row')} from public discussion & review sites`]
  if (withOutcome !== n) {
    parts.push(`${withOutcome} with an outcome`)
    if (listed.publicWaiting > 0) parts.push(`${listed.publicWaiting} still waiting (not counted)`)
    const employee = n - withOutcome - listed.publicWaiting
    if (employee > 0) parts.push(plural(employee, 'employee review'))
  }
  return parts.join(' · ')
}

/** The reports section's one-line summary under its title. */
export function reportsSectionSummary(sum: CompanySummary): string {
  if (sum.listed.rows === 0) return 'None yet — be the first to report'
  const { listed, outcomes } = sum
  return [
    plural(listed.withOutcome, 'applicant report'),
    listed.waiting > 0 ? `${listed.waiting} still waiting (no outcome yet)` : '',
    listed.employee > 0 ? plural(listed.employee, 'employee review') : '',
    `${outcomes.ghosted} ghosted`, `${outcomes.interview} interviewed`, `${outcomes.hired} hired`,
    listed.publicWithOutcome > 0 ? `${listed.publicWithOutcome} from public discussion` : '',
  ].filter(Boolean).join(' · ')
}

/** The reports section's provenance line (what the list holds, by kind). */
export function reportsProvenanceLine(sum: CompanySummary): string {
  const { listed } = sum
  if (listed.rows === 0) return 'Reports are anonymous claims, labeled by source and weighted by trust.'
  const mixed = listed.publicDiscussion > 0 || listed.imported > 0 || listed.employee > 0 || listed.waiting > 0
  if (!mixed) return `${plural(listed.rows, 'report')} submitted to Seen · anonymous applicant claims`
  return [
    `${plural(listed.withOutcome, 'applicant report')} with an outcome — the rows the grade is built from`,
    listed.seenWithOutcome > 0 ? `${listed.seenWithOutcome} submitted to Seen` : '',
    listed.importedWithOutcome > 0 ? `${listed.importedWithOutcome} imported from review sites (reduced weight)` : '',
    listed.publicWithOutcome > 0 ? `${listed.publicWithOutcome} found in public discussion (reduced weight)` : '',
    listed.waiting > 0 ? `${listed.waiting} more still waiting — listed, not counted until they resolve` : '',
    listed.employee > 0 ? `${plural(listed.employee, 'employee review')} (their letter grades adjust the score; they are not hiring outcomes)` : '',
  ].filter(Boolean).join(' · ')
}

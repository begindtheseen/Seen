// ONE set of facts for a company page's server-rendered metadata: the <meta description>, the
// Organization / WebPage / FAQPage JSON-LD, the crawlable H1 paragraph and the OG card all read it,
// built from the SAME score row the page renders (lib/growth.ts getScore) with the same first-party
// count, the same rates and the same letter scale.
//
// Audit 2026-10-24 (money/legal report L-1): /company/walmart's <meta description> and WebPage node said
// "62 reports … 73% / 27% … 81/100" (a company_summaries paragraph frozen on 2026-10-17) while the H1,
// the FAQPage node and the OG card said 48 / 13% / 87% / 91. A stored summary paragraph is now used ONLY
// when its numbers still match the live score; otherwise the description is built from the facts.
//
// Pure; relative .js/.ts imports only so `node --test lib/companyMeta.test.mjs` runs it as is.

import { gradeLetter } from './gradeScale.js'
import { firstPartyReportCount, mentionCount, MIN_REPORTS_FOR_GRADE } from './server/reportCounts.js'
import { MIN_REPORTS_FOR_RATES, pctOf, responseVerdict, type ResponseVerdict } from './companyPageSummary.ts'

export type MetaScore = {
  gradeable?: boolean | null
  overall_score?: number | null
  ghost_rate?: number | null
  response_rate?: number | null
  avg_wait_days?: number | null
  report_count?: number | null
  first_party_report_count?: number | null
  mention_count?: number | null
  data_source?: string | null
} | null | undefined

export type MetaSummary = {
  summary: string
  report_count_at_generation: number
  generated_at?: string | null
  data_basis?: string | null
} | null | undefined

export interface CompanyMetaFacts {
  name: string
  gradeable: boolean
  score: number | null
  grade: string | null
  /** First-party applicant reports with an outcome — the only count that may be published as "reports". */
  reportCount: number
  mentions: number
  /** Percentages are null below MIN_REPORTS_FOR_RATES applicant reports (same rule as the page). */
  ratesShown: boolean
  ghostPct: number | null
  respPct: number | null
  waitDays: number | null
  verdictKind: ResponseVerdict | null
  /** The stored company_summaries paragraph may be quoted only while its numbers match the live score. */
  summaryUsable: boolean
  /** The <meta description>: the usable stored paragraph, else one built from these facts. */
  description: string
  /** "48 applicant reports and 32 online mentions" — what the grade stands on. */
  basis: string
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

/** Meta descriptions are cut by search engines; keep whole sentences up to ~max chars. */
export function clipSentences(text: string, max = 300): string {
  if (text.length <= max) return text
  const parts = text.split(/(?<=[.!?])\s+/)
  let out = ''
  for (const p of parts) {
    if ((out ? out.length + 1 : 0) + p.length > max) break
    out = out ? `${out} ${p}` : p
  }
  return out || `${text.slice(0, max - 1).trimEnd()}…`
}

/**
 * A stored summary paragraph still describes the live score when it was built from the same number of
 * first-party reports and, if it quotes a "/100" score, quotes the current one.
 */
export function summaryMatchesScore(summary: MetaSummary, reportCount: number, score: number | null): boolean {
  if (!summary || !summary.summary) return false
  if (Number(summary.report_count_at_generation) !== reportCount) return false
  const quoted = [...summary.summary.matchAll(/\b(\d{1,3})\s*\/\s*100\b/g)].map((m) => Number(m[1]))
  if (quoted.length === 0) return true
  return score != null && quoted.every((q) => q === score)
}

export function companyMetaFacts(name: string, s: MetaScore, summary: MetaSummary): CompanyMetaFacts {
  const gradeable = !!s && s.gradeable !== false && typeof s.overall_score === 'number' && Number.isFinite(s.overall_score)
  const score = gradeable ? Math.round(s!.overall_score as number) : null
  const grade = score != null ? gradeLetter(score) : null
  const reportCount = firstPartyReportCount(s ?? null)
  const mentions = mentionCount(s ?? null)
  const ratesShown = gradeable && reportCount >= MIN_REPORTS_FOR_RATES && s!.response_rate != null
  const ghostPct = ratesShown ? pctOf(s!.ghost_rate) : null
  const respPct = ratesShown ? pctOf(s!.response_rate) : null
  const waitDays = gradeable && s!.avg_wait_days != null && Number.isFinite(Number(s!.avg_wait_days)) ? Math.round(Number(s!.avg_wait_days)) : null
  const verdictKind = ratesShown ? responseVerdict(s!.response_rate) : null
  const basis = reportCount > 0
    ? `${plural(reportCount, 'applicant report')}${mentions > 0 ? ` and ${plural(mentions, 'online mention')}` : ''}`
    : 'aggregated hiring data'
  const summaryUsable = gradeable && summaryMatchesScore(summary, reportCount, score)

  let description: string
  if (summaryUsable) description = clipSentences(summary!.summary)
  else if (gradeable && ratesShown) {
    const hear = verdictKind === 'most_hear_back' ? 'Most applicants hear back' : verdictKind === 'mixed' ? 'About half of applicants hear back' : 'Most applicants never hear back'
    description = `${name} has a Seen Grade of ${grade} (${score}/100) from ${basis}: ${respPct}% of applicants hear back, ${ghostPct}% are ghosted${waitDays != null ? `, typical wait ${plural(waitDays, 'day')}` : ''}. ${hear}. Self-reported outcomes from Seen users and public discussion — claims, not verified facts.`
  } else if (gradeable) {
    description = `${name} has a Seen Grade of ${grade} (${score}/100) from ${basis} — too few applicant reports for a response rate (${MIN_REPORTS_FOR_RATES} needed). Self-reported outcomes from Seen users and public discussion — claims, not verified facts.`
  } else {
    description = `${name} is not graded on Seen yet (${plural(reportCount, 'applicant report')} so far; a grade needs ${MIN_REPORTS_FOR_GRADE} pieces of evidence). See what applicants report about its hiring process — response time, interview rounds and ghosting.`
  }

  return { name, gradeable, score, grade, reportCount, mentions, ratesShown, ghostPct, respPct, waitDays, verdictKind, summaryUsable, description, basis }
}

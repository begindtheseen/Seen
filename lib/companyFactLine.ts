// THE one quotable sentence about a company's hiring record — what llms.txt, llms-full.txt, the open
// dataset (/data) and the monthly lists (/lists/*) print, and what the company page can adopt, so an AI
// answer engine or a journalist quoting any of them quotes the same numbers:
//
//   "Walmart: 87% of applicants hear back, 13% never do (48 applicant reports and 32 online mentions, Oct 2026)"
//
// Built ONLY from lib/companyMeta.ts companyMetaFacts output (the same facts the company page's metadata,
// H1 paragraph, FAQ and OG card use): first-party applicant report count, rates only when the page shows
// them (MIN_REPORTS_FOR_RATES), the one letter scale. Nothing is invented: an ungraded company has no line.
//
// Copy rules (owner 2026-10-24, lib/cardCopy.js): no em/en dashes, natural plurals, neutral wording.
// Pure; relative imports only so `node --test lib/companyFactLine.test.mjs` runs it as is.

import type { CompanyMetaFacts } from './companyMeta.ts'
import { companySlug } from './cardCopy.js'
import { formatPacific } from './time/pacific.js'

export const SITE_ORIGIN = 'https://seenjobs.io'

/** The fields of companyMetaFacts a fact line reads. */
export type FactInputs = Pick<CompanyMetaFacts, 'name' | 'gradeable' | 'score' | 'grade' | 'reportCount' | 'mentions' | 'ratesShown' | 'respPct' | 'ghostPct' | 'basis'>

export interface FactLine {
  /** Display name, e.g. "Walmart". */
  name: string
  /** Canonical company page, e.g. "https://seenjobs.io/company/walmart". */
  url: string
  /** The finding without the name: "87% of applicants hear back, 13% never do". */
  claim: string
  /** What it stands on: "48 applicant reports and 32 online mentions". */
  basis: string
  /** "Oct 2026" (California time). */
  month: string
  /** The quotable sentence: "Walmart: 87% of applicants hear back, 13% never do (48 applicant reports …, Oct 2026)". */
  sentence: string
  /** sentence + " " + url — the form printed in plain-text files. */
  line: string
}

/** "Oct 2026" — the short month a fact line is dated with (California time). */
export function factMonth(asOf: Date = new Date()): string {
  return formatPacific(asOf, { month: 'short', year: 'numeric' })
}

/** "October 2026" — the long month for "Updated …" and the attribution line (California time). */
export function longMonth(asOf: Date = new Date()): string {
  return formatPacific(asOf, { month: 'long', year: 'numeric' })
}

/** The attribution every reuse of Seen's data carries (CC BY 4.0). */
export function attributionLine(asOf: Date = new Date()): string {
  return `Source: Seen (seenjobs.io), applicant reports, ${longMonth(asOf)}`
}

/** Canonical company page URL from a stored or display name (the ONE slug scheme, lib/cardCopy.js). */
export function companyPageUrl(storedName: string): string {
  return `${SITE_ORIGIN}/company/${companySlug(storedName)}`
}

/**
 * The canonical fact line, or null when there is nothing honest to say (not graded).
 *
 * @param facts companyMetaFacts(...) output for the company.
 * @param opts.asOf  the snapshot time the numbers were read (dates the line).
 * @param opts.agency true for a staffing agency: the name is followed by "(staffing agency)".
 * @param opts.storedName the stored company_scores name, used for the URL (defaults to facts.name).
 */
export function companyFactLine(
  facts: FactInputs | null | undefined,
  opts: { asOf?: Date; agency?: boolean; storedName?: string } = {},
): FactLine | null {
  if (!facts || !facts.gradeable || facts.score == null || !facts.grade) return null
  const name = String(facts.name || '').trim()
  if (!name) return null
  const month = factMonth(opts.asOf ?? new Date())
  const url = companyPageUrl(opts.storedName || name)
  const label = opts.agency ? `${name} (staffing agency)` : name

  let claim: string
  if (facts.ratesShown && facts.respPct != null && facts.ghostPct != null) {
    claim = facts.ghostPct === 0
      ? `${facts.respPct}% of applicants hear back, none report being ghosted`
      : `${facts.respPct}% of applicants hear back, ${facts.ghostPct}% never do`
  } else {
    // Graded, but too few applicant reports for a percentage (the company page shows none either).
    claim = `Seen Grade ${facts.grade} (${facts.score}/100), too few applicant reports for a response rate`
  }
  const basis = facts.basis
  const sentence = `${label}: ${claim} (${basis}, ${month})`
  return { name, url, claim, basis, month, sentence, line: `${sentence} ${url}` }
}

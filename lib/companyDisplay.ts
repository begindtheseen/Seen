// ONE place for how a company is shown: its display name, its letter grade, the "last updated"
// line under a grade, and the spelling of a stored platform label. Pure (no I/O) — imported by client
// components, server components, the OG image and the api/*.js handlers alike, so the page, the share
// card, the leaderboard, the feed and the unfurl can never disagree (audit 2026-10-23: the page said
// "A · 91" while the grade card said "A+", /companies showed "aaa" and "united wholesale mortgage",
// the ticker "albertsons"; 2026-10-24: /companies "Jpmorganchase", quotes labelled "Reddit r/r/walmart").
//
// Stored data is never changed here: company_scores / reports keep their lowercase names.

import { NONTERMINAL_OUTCOMES } from '@/api/_utils/companyIntel.js'
import { formatPacific } from '@/lib/time/pacific.js'
import { displayCompanyName as displayCompanyNameJs, KNOWN_BRANDS } from '@/lib/companyNames.js'
import { displayPlatform as displayPlatformJs } from '@/lib/reports/platformLabel.js'

// ── Letter grade ─────────────────────────────────────────────────────────────────────────────────
// The one scale. 80+ A · 65+ B · 50+ C · 35+ D · else F (matches lib/growth.ts grade(), the OG
// image, the leaderboard and the score modal; the share card used a 13-step A+/A/A- scale that
// disagreed with the page it was opened from).
export function gradeLetter(score: number): string {
  if (score >= 80) return 'A'
  if (score >= 65) return 'B'
  if (score >= 50) return 'C'
  if (score >= 35) return 'D'
  return 'F'
}

// ── Display name ─────────────────────────────────────────────────────────────────────────────────
// The map and the casing rules live in lib/companyNames.js (plain JS) so the api/*.js handlers and the
// enrichment pipeline read the SAME map as the client. Re-exported here for TypeScript callers.
export { KNOWN_BRANDS }

/**
 * How a stored company name is shown: "walmart" → "Walmart", "united wholesale mortgage" →
 * "United Wholesale Mortgage", "aaa" → "AAA", "jpmorganchase" → "JPMorgan Chase", "mcdonald's" →
 * "McDonald's", "bank of america" → "Bank of America". A name that already carries mixed case (an
 * employer-typed "DoorDash") is returned as is. Empty input → ''.
 */
export function displayCompanyName(name: string | null | undefined): string {
  return displayCompanyNameJs(name)
}

// ── Platform label ───────────────────────────────────────────────────────────────────────────────
/** A stored platform / source label as it is shown: "Reddit r/r/walmart" → "Reddit r/walmart" (lib/reports/platformLabel.js). */
export function displayPlatform(platform: string | null | undefined): string {
  return displayPlatformJs(platform)
}

// ── Outcomes ─────────────────────────────────────────────────────────────────────────────────────
/** A report with a decided outcome (ghosted / rejected / interview / offer …) — the rows a grade is built from. */
export function isResolvedOutcome(outcome: string | null | undefined): boolean {
  return !NONTERMINAL_OUTCOMES.has(String(outcome ?? '').toLowerCase().trim())
}

// ── Last updated ─────────────────────────────────────────────────────────────────────────────────
/** "Last updated Oct 20, 2026" in California time (owner decision 2026-10-21: no UTC anywhere). '' when unknown. */
export function lastUpdatedLabel(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `Last updated ${formatPacific(d, { dateStyle: 'medium' })}`
}

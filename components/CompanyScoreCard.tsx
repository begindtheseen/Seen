'use client'

// Company "Grade" share card: the company name, its grade letter as a watermark, the score,
// three typographic stat pairs and the confidence line, drawn by the shared kit (lib/cardKit.ts)
// in square and story formats and shared through the one modal shell (CardShareModal.tsx).

import { useCallback } from 'react'
import { drawCompanyCard, type CardFormat, type CompanyCardData } from '@/lib/cardKit'
import { ACCENTS, accentKeyForRisk, riskForScore } from '@/lib/cardTheme.js'
import { companyShareText, companyHref } from '@/lib/cardCopy.js'
import { track } from '@/lib/analytics'
import { gradeLetter, displayCompanyName } from '@/lib/companyDisplay'
import CardShareModal from '@/components/CardShareModal'

// Only ever rendered for a GRADEABLE score (lib/gradeGate.ts) — the company page hides the
// "Grade card" action below MIN_REPORTS_FOR_GRADE real reports, so no PNG is minted from 2 reviews.
export interface CompanyScoreCardData {
  company: string
  industry?: string
  overall_score: number
  ghost_rate: number      // 0–1
  response_rate: number   // 0–1
  avg_wait_days: number
  waste: number           // 0–100
  report_count: number
  risk?: 'safe' | 'warn' | 'danger'
  tags?: string[]
  /** When the score was last (re)computed — printed on the card as "updated <date>". */
  updated_at?: string | null
  /** The page's confidence word (lib/companySummary.ts) — the card prints this, never its own. */
  confidence?: string
}

export default function CompanyScoreCard({ data, shareUrl, onClose, onShared }: { data: CompanyScoreCardData; shareUrl?: string; onClose: () => void; onShared?: (via: string) => void }) {
  const score = Math.round(data.overall_score || 0)
  const risk = data.risk ?? riskForScore(score)
  const accent = ACCENTS[accentKeyForRisk(risk)].hex
  // The SAME letter the page shows (lib/companyDisplay.ts) — the card once used its own 13-step
  // A+/A/A- scale, so a page that said "A · 91" minted a card that said "A+" (audit 2026-10-23).
  const grade = gradeLetter(score)
  const company = displayCompanyName(data.company) || 'Company'
  // The unfurl URL: the company page (which has a dynamic OG image) — one slug scheme (lib/cardCopy.js).
  const unfurlUrl = shareUrl || companyHref(data.company)
  const shareText = companyShareText({ company, grade, score, ghostRate: data.ghost_rate, responseRate: data.response_rate, risk })

  const draw = useCallback((canvas: HTMLCanvasElement, format: CardFormat) => {
    const payload: CompanyCardData = {
      company,
      grade,
      overall_score: score,
      ghost_rate: data.ghost_rate,
      response_rate: data.response_rate,
      avg_wait_days: data.avg_wait_days,
      report_count: data.report_count,
      risk,
      updatedAt: data.updated_at ?? null,
      // The page's confidence word (lib/companyPageSummary.ts) — the card prints it, never its own count-based one.
      confidence: data.confidence,
    }
    drawCompanyCard(canvas, payload, format)
  }, [company, grade, score, data, risk])

  return (
    <CardShareModal
      kicker={`Seen grade ${grade}`}
      title={`${company}: ${score}/100`}
      sub="Share this company's grade so the next applicant knows before they apply."
      accent={accent}
      draw={draw}
      shareText={shareText}
      shareUrl={unfurlUrl}
      fileBase={`grade_${(data.company || 'c').replace(/[^a-z0-9]/gi, '_')}`}
      onClose={onClose}
      onGenerated={(format) => track('card_generated', { card_type: 'company', risk, format })}
      onShareAttempt={(dest) => onShared?.(dest)}
      onShared={(dest, method) => track('card_shared', { card_type: 'company', method, destination: dest, risk })}
    />
  )
}

'use client'

import { displayCompanyName, gradeLetter } from '@/lib/companyDisplay'
import { useState, useEffect } from 'react'
import { firstPartyReportCount } from '@/lib/server/reportCounts'
import { isGradeableScore, notEnoughReviewsLabel } from '@/lib/gradeGate'
import { gradeTone, toneText, ghostRateTone, responseRateTone, ghostRateWord, responseRateWord } from '@/lib/ui/tone.js'
import { accountsLabel } from '@/lib/glossary.js'
import Dialog from '@/components/ui/Dialog'
import Button from '@/components/ui/Button'
import StatTile from '@/components/ui/StatTile'
import s from './CoPreviewModal.module.css'

// ── Company Preview Modal ─────────────────────────────────────────────────────

interface CoPreviewScore {
  overall_score: number
  ghost_rate: number
  response_rate: number
  avg_wait_days: number
  avg_rounds: number
  waste: number
  report_count: number // FUSED (first-party + web claim) — never rendered as "reports"
  first_party_report_count?: number
  data_source?: string
  data_quality?: string
}

// What /api/reports actually returns: below the grade gate (≥5 real reports, lib/gradeGate.ts)
// `gradeable` is false and every verdict field is null. Only a gradeable payload becomes a
// CoPreviewScore (the graded shape the card renders).
type CoPreviewPayload = { [K in keyof CoPreviewScore]?: CoPreviewScore[K] | null } & { gradeable?: boolean | null }

// A quick look at the employer from a job card. The Dialog primitive gives it role=dialog, aria-modal,
// a focus trap and Escape (it had none — audit #15). The letter comes from the ONE grade scale
// (lib/companyDisplay gradeLetter; this file used to carry its own A-at-80 scale) and its tone from the
// letter (lib/ui/tone.js gradeTone).
export default function CoPreviewModal({ company, onClose }: { company: string; onClose: () => void }) {
  const [sc, setSc] = useState<CoPreviewPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const slug = encodeURIComponent(company.toLowerCase().replace(/\s+/g, '-'))

  useEffect(() => {
    setLoading(true)
    setSc(null)
    fetch('/api/reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: company }),
    })
      .then(r => r.ok ? r.json() : {})
      .then((d: { score?: CoPreviewPayload }) => { if (d.score) setSc(d.score) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [company])

  const graded: CoPreviewScore | null = sc && isGradeableScore(sc) ? (sc as CoPreviewScore) : null
  const name = displayCompanyName(company)
  const fp = graded ? firstPartyReportCount(graded) : 0
  const gt = graded ? ghostRateTone(graded.ghost_rate) : null
  const rt = graded ? responseRateTone(graded.response_rate) : null

  return (
    <Dialog open onClose={onClose} title={name} size="sm"
      footer={<Button variant="primary" href={`/company/${slug}`} full iconRight="arrow-right">{graded ? 'View the full company page' : 'View company page'}</Button>}>
      {loading ? (
        <p className={s.muted} role="status">Checking hiring data…</p>
      ) : graded ? (
        <>
          <div className={s.grade}>
            <span className={s.letter} style={{ color: toneText(gradeTone(graded.overall_score)) }} aria-hidden="true">{gradeLetter(graded.overall_score)}</span>
            <div>
              <p className="ui-eyebrow">Seen Grade</p>
              <p className={s.score}><span className="sr-only">{`Seen Grade ${gradeLetter(graded.overall_score)}, `}</span><b className="tnum">{graded.overall_score}</b>/100</p>
              <p className={s.muted}>{fp > 0 ? accountsLabel(fp) : 'Estimated from public web data'}</p>
            </div>
          </div>
          <div className={s.stats}>
            <StatTile label="Hear back" value={Math.round((graded.response_rate || 0) * 100)} suffix="%" tone={rt} toneWord={responseRateWord(rt)} />
            <StatTile label="Ghosted" value={Math.round((graded.ghost_rate || 0) * 100)} suffix="%" tone={gt} toneWord={ghostRateWord(gt)} />
            <StatTile label="Avg wait" value={graded.avg_wait_days ? graded.avg_wait_days : null} suffix="d" />
          </div>
        </>
      ) : sc ? (
        <>
          {/* Grade gate: real accounts exist but fewer than the bar — no verdict, just the facts. */}
          <p className="ui-eyebrow">Seen Grade</p>
          <p className={s.ungraded}>{notEnoughReviewsLabel(sc)}</p>
          <p className={s.muted}>Seen grades a company only once enough applicants have reported. Read what it has so far on the company page.</p>
        </>
      ) : (
        <p className={s.muted}>No data found for this company yet.</p>
      )}
    </Dialog>
  )
}

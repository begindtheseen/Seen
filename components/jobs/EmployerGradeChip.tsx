'use client'

// The EMPLOYER's Seen Grade next to a listing ("Walmart · Seen Grade A-"), linking to its company page.
// The /jobs description promises whether the company responds; the ring only grades the post
// (ListingScoreRing). Shown only for a gradeable company (the callers pass scores already through the
// grade gate — lib/gradeGate.ts); the ONE letter scale is lib/companyDisplay.ts gradeLetter and its tone
// comes from the letter (lib/ui/tone.js gradeTone → lib/gradeScale.js gradeRisk).

import Link from 'next/link'
import { gradeLetter, displayCompanyName } from '@/lib/companyDisplay'
import { companySlug } from '@/lib/searchRoute'
import { gradeTone, toneText } from '@/lib/ui/tone.js'
import s from './EmployerGradeChip.module.css'

export default function EmployerGradeChip({ company, score, onClick, compact = false }: { company: string; score: number; onClick?: (e: React.MouseEvent) => void; /** Card size (24px tall; 44px on phones). */ compact?: boolean }) {
  const name = displayCompanyName(company) || company
  return (
    <Link
      href={`/company/${companySlug(company)}`}
      prefetch={false}
      onClick={e => { e.stopPropagation(); onClick?.(e) }}
      title={`${name}'s Seen Grade from applicant accounts — how it treats applicants, not this posting`}
      className={compact ? `${s.chip} ${s.compact}` : s.chip}
    >
      <span className={s.name}>{compact ? 'Seen Grade' : `${name} · Seen Grade`}</span>
      <b className={s.letter} style={{ color: toneText(gradeTone(score)) }}>{gradeLetter(score)}</b>
    </Link>
  )
}

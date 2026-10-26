'use client'

// The EMPLOYER's Seen grade next to a listing ("Walmart · Seen grade A"), linking to its company page.
// The /jobs description promises whether the company responds; the listing ring only grades the post
// (ListingScoreRing). Shown only for a gradeable company (the callers pass scores already through the
// grade gate — lib/gradeGate.ts); the ONE letter scale is lib/companyDisplay.ts gradeLetter.

import Link from 'next/link'
import { Score } from '@/lib/score'
import { gradeLetter, displayCompanyName } from '@/lib/companyDisplay'
import { companySlug } from '@/lib/searchRoute'
import { gradeRisk } from '@/lib/gradeScale.js'

export default function EmployerGradeChip({ company, score, onClick }: { company: string; score: number; onClick?: (e: React.MouseEvent) => void }) {
  const name = displayCompanyName(company) || company
  return (
    <Link
      href={`/company/${companySlug(company)}`}
      prefetch={false}
      onClick={e => { e.stopPropagation(); onClick?.(e) }}
      title={`${name}'s Seen grade from applicant reports — how it treats applicants, not this posting`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem', minHeight: 44, padding: '.15rem .7rem', border: '1px solid var(--line2)', borderRadius: 999, background: 'var(--raised)', textDecoration: 'none', fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', color: 'var(--sub)', maxWidth: '100%', minWidth: 0 }}
    >
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{name} · Seen grade</span>
      <b style={{ fontFamily: 'var(--display)', fontWeight: 800, color: Score.color((gradeRisk(score) ?? 'unrated') as ReturnType<typeof Score.risk>), flexShrink: 0 }}>{gradeLetter(score)}</b>
    </Link>
  )
}

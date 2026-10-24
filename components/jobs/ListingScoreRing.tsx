'use client'

// The LISTING score (lib/server/jobScore.js: salary disclosure, source, description quality) drawn as
// a neutral ring with a "Listing" caption. It grades the posting, never the employer — so it carries no SAFE / CAUTION / DANGER word and no traffic-light colour. The conversion
// audit (2026-10-24) found a grade-A Walmart listing inside an orange "67 CAUTION" ring, read by a
// visitor as Walmart's grade. The employer's grade is its own chip (EmployerGradeChip).
//
// One component for every place a listing score is drawn (cards, the swipe deck, the drawer, the
// résumé matches, the listing page), so the label can't drift back.

export const LISTING_SCORE_TITLE = 'Listing score: how much this posting tells you (pay, source, description). It grades the post, not the employer.'

export default function ListingScoreRing({ score, size = 46, caption = true }: { score: number | null | undefined; size?: number; caption?: boolean }) {
  const unrated = score == null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '.2rem', flexShrink: 0 }} title={unrated ? 'Not enough in this posting to score it' : LISTING_SCORE_TITLE}>
      <div
        aria-label={unrated ? 'Listing not scored' : `Listing score ${score} out of 100`}
        role="img"
        style={{ width: size, height: size, borderRadius: '50%', border: '2px solid var(--line2)', background: 'var(--card)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--mono)', fontWeight: 500, fontSize: size >= 44 ? '.9rem' : '.78rem', lineHeight: 1, color: unrated ? 'var(--dim)' : 'var(--white)' }}
      >
        {unrated ? '–' : score}
      </div>
      {caption && <span aria-hidden="true" style={{ fontFamily: 'var(--body)', fontSize: '.75rem', lineHeight: 1, color: 'var(--muted)' }}>Listing</span>}
    </div>
  )
}

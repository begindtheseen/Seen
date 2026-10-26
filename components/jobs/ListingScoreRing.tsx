// The POSTING score (lib/server/jobScore.js: salary disclosure, source, description quality) drawn as a
// neutral ring with a "Posting" caption (glossary: "Posting score"). It grades the posting, never the
// employer — so it carries no SAFE / CAUTION / DANGER word and no traffic-light colour. The conversion
// audit (2026-10-24) found a grade-A Walmart listing inside an orange "67 CAUTION" ring, read by a
// visitor as Walmart's grade. The employer's grade is its own chip (EmployerGradeChip).
//
// One component for every place a posting score is drawn (cards, the swipe deck, the drawer, the
// résumé matches, the listing page), so the label can't drift back.

export const LISTING_SCORE_TITLE = 'Posting score: how much this posting tells you (pay, source, description). It grades the post, not the employer.'

export default function ListingScoreRing({ score, size = 46, caption = true }: { score: number | null | undefined; size?: number; caption?: boolean }) {
  const unrated = score == null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flexShrink: 0 }} title={unrated ? 'Not enough in this posting to score it' : LISTING_SCORE_TITLE}>
      <div
        aria-label={unrated ? 'Posting not scored' : `Posting score ${score} out of 100`}
        role="img"
        style={{ width: size, height: size, borderRadius: '50%', border: '2px solid var(--border-2)', background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--body)', fontWeight: 600, fontSize: size >= 44 ? 'var(--fs-body)' : 'var(--fs-ui)', lineHeight: 1, fontVariantNumeric: 'tabular-nums', color: unrated ? 'var(--text-4)' : 'var(--text-1)' }}
      >
        {unrated ? '–' : score}
      </div>
      {caption && <span aria-hidden="true" style={{ fontFamily: 'var(--body)', fontSize: 'var(--fs-meta)', lineHeight: 1, color: 'var(--text-4)' }}>Posting</span>}
    </div>
  )
}

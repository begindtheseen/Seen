// Which "What people say online" entries (company_scores.web_reviews) may be shown AS QUOTES.
// Only an entry with a source link is a quote a visitor can check. An entry without one is the old
// web-research pipeline's paraphrase ("Aggregated research · 2025") — conversion audit 2026-10-24: to a
// skeptical visitor those read as machine-written and made the page look like a content farm. They are
// kept (the section count and the score are unchanged) but folded into one plainly labelled note.
//
// Pure; no imports so `node --test lib/webReviewQuotes.test.mjs` runs it as is.

export type WebReviewLike = { text?: string | null; url?: string | null; source?: string | null }

const hasLink = (rv: WebReviewLike): boolean => /^https?:\/\//i.test(String(rv?.url ?? '').trim())

/** Linked quotes first in their stored order, then the unlinked summaries. */
export function splitWebReviews<T extends WebReviewLike>(reviews: T[] | null | undefined): { quotes: T[]; summaries: T[] } {
  const quotes: T[] = []
  const summaries: T[] = []
  for (const rv of Array.isArray(reviews) ? reviews : []) (hasLink(rv) ? quotes : summaries).push(rv)
  return { quotes, summaries }
}

/** "6 summaries from web research — no source link, so not shown as quotes". */
export function webResearchNote(n: number): string {
  return `${n} ${n === 1 ? 'summary' : 'summaries'} from web research — no source link, so not shown as quotes`
}

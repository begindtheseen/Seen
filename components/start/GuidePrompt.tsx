'use client'

/**
 * The one card right above /jobs results when the search belongs to a start guide (lib/start/guideFor.js — a
 * per-guide keyword table; only live guides answer, the most specific wins, never more than one card). A quiet
 * bordered card on the dark field — the guide's title, one line of what it gives, "Open the guide →" — the whole
 * card is the link. No filled button, no colour fill: it invites the tap without competing with the results.
 */
import { useMemo } from 'react'
import Link from 'next/link'
import Icon from '@/components/ui/Icon'
import { guideForQuery } from '@/lib/start/guideFor.js'
import st from './guide.module.css'

export default function GuidePrompt({ query }: { query: string }) {
  const g = useMemo(() => guideForQuery(query), [query])
  if (!g) return null
  return (
    <Link href={g.path} prefetch={false} className={st.prompt} data-testid="guide-prompt">
      <span className={st.promptIcon} aria-hidden><Icon name="book-open" size={20} /></span>
      <span className={st.promptBody}>
        <span className={st.promptTitle}>{g.label}</span>
        <span className={st.promptLine}>{g.prompt}</span>
        <span className={st.promptGo}>Open the guide <Icon name="arrow-right" size={14} /></span>
      </span>
    </Link>
  )
}

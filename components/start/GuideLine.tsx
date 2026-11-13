'use client'

/**
 * One quiet text line under the /jobs results when the search is an oilfield or trades search
 * ("New to oilfield work? How people get in →"). Small ink text, no card, no button. The family lookup
 * (lib/start/guideFor.js, which reads search's own role families) is loaded only once a search has run, so it
 * never weighs on the page's first load.
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import st from './guide.module.css'

type Line = { href: string; text: string } | null

export default function GuideLine({ query }: { query: string }) {
  const [line, setLine] = useState<Line>(null)
  useEffect(() => {
    let alive = true
    const q = query.trim()
    if (!q) { setLine(null); return }
    import('@/lib/start/guideFor.js')
      .then((m) => { if (!alive) return; const g = m.guideForQuery(q); setLine(g ? m.GUIDE_LINES[g] : null) })
      .catch(() => { if (alive) setLine(null) })
    return () => { alive = false }
  }, [query])
  if (!line) return null
  return (
    <p className={st.guideLine} data-testid="guide-line">
      <Link href={line.href} prefetch={false} className={st.guideLink}>{line.text} →</Link>
    </p>
  )
}

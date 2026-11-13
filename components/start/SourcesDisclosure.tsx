'use client'

/**
 * The guides' numbered source list, closed by default at the bottom of the page. A "Sources: 3" number anywhere on
 * the page opens it before the browser jumps (capture-phase click), and so does a page loaded or navigated to with
 * a #<prefix>-src-N hash — not every browser opens a <details> for a fragment by itself.
 */
import { useEffect, useRef, type ReactNode } from 'react'
import Icon from '@/components/ui/Icon'
import st from './guide.module.css'

export default function SourcesDisclosure({ prefix, count, children }: { prefix: string; count: number; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    const mark = `#${prefix}-src-`
    const fromHash = () => {
      if (!ref.current || !window.location.hash.startsWith(mark)) return
      ref.current.open = true
      document.getElementById(window.location.hash.slice(1))?.scrollIntoView({ block: 'center' })
    }
    const onClick = (e: MouseEvent) => {
      const t = e.target as Element | null
      if (ref.current && t && typeof t.closest === 'function' && t.closest(`a[href^="${mark}"]`)) ref.current.open = true
    }
    fromHash()
    document.addEventListener('click', onClick, true)
    window.addEventListener('hashchange', fromHash)
    return () => { document.removeEventListener('click', onClick, true); window.removeEventListener('hashchange', fromHash) }
  }, [prefix])
  return (
    <details ref={ref} className={st.srcBox} id={`${prefix}-sources`}>
      <summary className={st.srcSum}>
        <span className={st.srcTitle}>Sources ({count})</span>
        <span className={st.srcHint}>Every figure on this page, with its link and date</span>
        <Icon name="chevron-down" size={16} className={st.chev} />
      </summary>
      <div className={st.srcBody}>{children}</div>
    </details>
  )
}

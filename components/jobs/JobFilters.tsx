'use client'

// Job search filters: ONE "Filters" button that opens a panel with the four selects, plus a
// chip per active filter next to the button (each chip clears its own filter). The filter
// STATE and its effect on results are unchanged — this only changes how the controls sit.

import { useEffect, useRef, useState } from 'react'
import type { NicheFilter, LevelFilter, TypeFilter, PostedFilter } from '@/lib/hooks/useJobSearch'
import styles from './JobFilters.module.css'

const NICHE: Array<[NicheFilter, string]> = [
  ['', 'Any industry'], ['tech', 'Tech / Software'], ['healthcare', 'Healthcare'], ['retail', 'Retail / Food Service'],
  ['logistics', 'Logistics / Warehouse'], ['finance', 'Finance'], ['other', 'Other'],
]
const LEVEL: Array<[LevelFilter, string]> = [['', 'Any level'], ['entry', 'Entry level'], ['mid', 'Mid level'], ['senior', 'Senior']]
const TYPE: Array<[TypeFilter, string]> = [['', 'Any type'], ['Full-time', 'Full-time'], ['Part-time', 'Part-time'], ['Contract', 'Contract']]
const POSTED: Array<[PostedFilter, string]> = [['', 'Any time'], ['1', 'Last 24 hours'], ['7', 'Last week'], ['30', 'Last month']]

const label = <T extends string>(opts: Array<[T, string]>, v: T) => opts.find(o => o[0] === v)?.[1] ?? v

function SlidersIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 6h10M18 6h2M4 12h3M11 12h9M4 18h12M20 18h0" />
      <circle cx="16" cy="6" r="2" /><circle cx="8" cy="12" r="2" /><circle cx="18" cy="18" r="2" />
    </svg>
  )
}

export default function JobFilters({
  niche, setNiche,
  level, setLevel,
  jobType, setJobType,
  posted, setPosted,
  hasFilters, clearFilters,
}: {
  niche: NicheFilter; setNiche: (v: NicheFilter) => void
  level: LevelFilter; setLevel: (v: LevelFilter) => void
  jobType: TypeFilter; setJobType: (v: TypeFilter) => void
  posted: PostedFilter; setPosted: (v: PostedFilter) => void
  hasFilters: boolean; clearFilters: () => void
  /** Kept for call-site compatibility; the panel styles its own controls. */
  selectStyle?: React.CSSProperties
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Click outside / Escape closes the panel.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  const active: Array<{ k: string; text: string; clear: () => void }> = []
  if (niche) active.push({ k: 'niche', text: label(NICHE, niche), clear: () => setNiche('' as NicheFilter) })
  if (level) active.push({ k: 'level', text: label(LEVEL, level), clear: () => setLevel('' as LevelFilter) })
  if (jobType) active.push({ k: 'type', text: label(TYPE, jobType), clear: () => setJobType('' as TypeFilter) })
  if (posted) active.push({ k: 'posted', text: label(POSTED, posted), clear: () => setPosted('' as PostedFilter) })

  return (
    <div className={styles.wrap} ref={ref}>
      <button
        type="button"
        className={`${styles.btn}${open ? ' ' + styles.btnOpen : ''}${hasFilters ? ' ' + styles.btnActive : ''}`}
        onClick={() => setOpen(v => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <SlidersIcon />
        Filters
        {active.length > 0 && <span className={styles.count}>{active.length}</span>}
      </button>

      {active.map(a => (
        <button key={a.k} type="button" className={styles.chip} onClick={a.clear} title="Remove this filter">
          {a.text} <b>✕</b>
        </button>
      ))}
      {active.length > 1 && (
        <button type="button" className={styles.clear} onClick={clearFilters}>Clear all</button>
      )}

      {open && (
        <div className={styles.pop} role="dialog" aria-label="Filter jobs">
          <label className={styles.row}>
            <span className={styles.label}>Industry</span>
            <select className={styles.select} value={niche} onChange={e => setNiche(e.target.value as NicheFilter)}>
              {NICHE.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
            </select>
          </label>
          <label className={styles.row}>
            <span className={styles.label}>Level</span>
            <select className={styles.select} value={level} onChange={e => setLevel(e.target.value as LevelFilter)}>
              {LEVEL.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
            </select>
          </label>
          <label className={styles.row}>
            <span className={styles.label}>Type</span>
            <select className={styles.select} value={jobType} onChange={e => setJobType(e.target.value as TypeFilter)}>
              {TYPE.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
            </select>
          </label>
          <label className={styles.row}>
            <span className={styles.label}>Posted</span>
            <select className={styles.select} value={posted} onChange={e => setPosted(e.target.value as PostedFilter)}>
              {POSTED.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
            </select>
          </label>
          <div className={styles.foot}>
            <button type="button" className={styles.clear} onClick={clearFilters} disabled={!hasFilters} style={{ opacity: hasFilters ? 1 : 0.4 }}>Clear all</button>
            <button type="button" className={styles.done} onClick={() => setOpen(false)}>Done</button>
          </div>
        </div>
      )}
    </div>
  )
}

'use client'

// The /data table: every graded company, searchable and sortable. Server-rendered in full (crawlers and
// no-JS readers get every row in the HTML); search and sort only re-order what is already there.

import Link from 'next/link'
import { useMemo, useState } from 'react'
import styles from './openData.module.css'
import { gradeTone } from '@/lib/ui/tone.js'

export type TableRow = {
  /** company (display) */ c: string
  /** company page path */ p: string
  /** grade letter */ g: string
  /** score 0–100 */ s: number
  /** response % or null */ r: number | null
  /** ghost % or null */ gh: number | null
  /** applicant accounts */ n: number
  /** of n, from public posts (null = unknown) */ pub: number | null
  /** staffing agency */ a: boolean
  /** last updated YYYY-MM-DD */ u: string | null
}

type Key = 'c' | 's' | 'r' | 'gh' | 'n' | 'u'
const COLS: { key: Key; label: string; num: boolean; first: 'asc' | 'desc' }[] = [
  { key: 'c', label: 'Company', num: false, first: 'asc' },
  { key: 's', label: 'Grade', num: true, first: 'desc' },
  { key: 'r', label: 'Hear back', num: true, first: 'desc' },
  { key: 'gh', label: 'Never hear back', num: true, first: 'desc' },
  { key: 'n', label: 'Applicant accounts', num: true, first: 'desc' },
  { key: 'u', label: 'Last updated', num: true, first: 'desc' },
]

// The letter's own tone (lib/gradeScale gradeRisk via lib/ui/tone.js) — one map with every other surface.
const gradeClass = (s: number) => { const t = gradeTone(s); return t === 'good' ? styles.gGood : t === 'caution' ? styles.gMid : styles.gBad }

function cmp(a: TableRow, b: TableRow, key: Key): number {
  const va = a[key], vb = b[key]
  // Empty values (no rate yet) always sort last, whichever direction.
  if (va == null && vb == null) return 0
  if (va == null) return 1
  if (vb == null) return -1
  if (typeof va === 'string' && typeof vb === 'string') return va.localeCompare(vb)
  return Number(va) - Number(vb)
}

export default function DataTable({ rows }: { rows: TableRow[] }) {
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<{ key: Key; dir: 'asc' | 'desc' }>({ key: 'n', dir: 'desc' })

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const list = needle ? rows.filter((r) => r.c.toLowerCase().includes(needle)) : rows.slice()
    list.sort((a, b) => {
      const base = cmp(a, b, sort.key)
      const nullish = a[sort.key] == null || b[sort.key] == null
      const v = nullish ? base : sort.dir === 'asc' ? base : -base
      return v || b.n - a.n || a.c.localeCompare(b.c)
    })
    return list
  }, [rows, q, sort])

  const onSort = (key: Key, first: 'asc' | 'desc') =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: first }))

  return (
    <div>
      <div className={styles.tools}>
        <label htmlFor="data-search" className="sr-only" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Search companies</label>
        <input
          id="data-search"
          type="search"
          className={styles.search}
          placeholder="Search a company"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoComplete="off"
        />
        <span className={styles.count} aria-live="polite">
          {shown.length === rows.length ? `${rows.length.toLocaleString('en-US')} companies` : `${shown.length.toLocaleString('en-US')} of ${rows.length.toLocaleString('en-US')} companies`}
        </span>
      </div>
      <div className={styles.tableWrap} role="region" aria-label="Employer response rates" tabIndex={0}>
        <table className={styles.table}>
          <thead>
            <tr>
              {COLS.map((col) => {
                const active = sort.key === col.key
                return (
                  <th
                    key={col.key}
                    scope="col"
                    className={col.num ? `${styles.num} ${styles.thNum}` : styles.colCo}
                    aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  >
                    <button type="button" className={styles.sortBtn} data-active={active} onClick={() => onSort(col.key, col.first)}>
                      {col.label}
                      <span aria-hidden>{active ? (sort.dir === 'asc' ? '↑' : '↓') : ''}</span>
                    </button>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.p}>
                <td className={styles.colCo}>
                  <Link href={r.p} prefetch={false} className={styles.coLink}>{r.c}</Link>
                  {r.a && <span className={styles.tag}>agency</span>}
                </td>
                <td className={styles.num}><span className={`${styles.grade} ${gradeClass(r.s)}`}>{r.g}</span> <span className={styles.dash}>{r.s}</span></td>
                <td className={styles.num}>{r.r == null ? <span className={styles.dash} title="Too few applicant accounts for a rate">n/a</span> : `${r.r}%`}</td>
                <td className={styles.num}>{r.gh == null ? <span className={styles.dash} title="Too few applicant accounts for a rate">n/a</span> : `${r.gh}%`}</td>
                <td className={styles.num}>
                  {r.n.toLocaleString('en-US')}
                  {r.pub != null && r.pub > 0 && <span className={styles.tag} title="Found in public posts (Reddit threads, review sites)">{r.pub === r.n ? 'all public posts' : `${r.pub.toLocaleString('en-US')} public`}</span>}
                </td>
                <td className={styles.num}>{r.u ?? <span className={styles.dash}>n/a</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length === 0 && <p className={styles.p} style={{ padding: '1rem' }}>No graded company matches “{q}”. Its page may still have reports: <Link href={`/companies`} prefetch={false}>search all companies</Link>.</p>}
      </div>
    </div>
  )
}

/**
 * Building blocks for the "getting in" guides (/start/oilfield, /start/trades). Server-safe (no hooks), so the pages
 * stay server components and every word ships in the HTML.
 *
 * The page reads like a Seen screen, not a paper: readings (stat tiles), checklists, rows and chips. Sources are
 * still there for every figure, but out of the reading line: each part ends with ONE quiet "Sources: 1, 4, 6" line
 * whose numbers open the collapsed list at the bottom (SourcesDisclosure). Both are built from the same data module
 * (lib/start/*.js `sectionEntries()`), so a figure can never appear without its source and date.
 */
import type { ReactNode } from 'react'
import Icon from '@/components/ui/Icon'
import StatTile from '@/components/ui/StatTile'
import { formatSourceDate, sourceHost } from '@/lib/start/guides.js'
import SourcesDisclosure from './SourcesDisclosure'
import st from './guide.module.css'

export type Source = { label: string; url: string; date: string; note?: string }
export type Entry = { text?: string | null; src: string[]; firstHand?: boolean }
export type Nums = Record<string, number>

/** The source numbers a set of entries cites, each once, in list order. */
export function sourceNumbers(entries: Array<{ src: string[] } | null>, nums: Nums): number[] {
  const set = new Set<number>()
  for (const e of entries) for (const k of e?.src || []) if (nums[k]) set.add(nums[k])
  return [...set].sort((a, b) => a - b)
}

/** Consecutive numbers as ranges: [1,2,3,5,7,8] → [[1,3],[5,5],[7,8]]. */
function ranges(list: number[]): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (const n of list) {
    const last = out[out.length - 1]
    if (last && n === last[1] + 1) last[1] = n
    else out.push([n, n])
  }
  return out
}

/** "Sources 1–6, 16–23" — one quiet line at the end of a part; each number opens its line in the list at the bottom. */
export function SrcLine({ entries, nums, prefix, lead }: { entries: Array<{ src: string[] } | null>; nums: Nums; prefix: string; lead?: ReactNode }) {
  const list = sourceNumbers(entries, nums)
  if (!list.length) return null
  return (
    <p className={st.srcLine}>
      {lead ? <>{lead} </> : null}
      <span>{list.length > 1 ? 'Sources' : 'Source'} </span>
      {ranges(list).map(([a, b], i) => (
        <span key={a}>
          {i > 0 ? ', ' : ''}
          <a href={`#${prefix}-src-${a}`} className={st.srcNum} aria-label={`Source ${a}`}>{a}</a>
          {b > a ? <>{b === a + 1 ? ', ' : '–'}<a href={`#${prefix}-src-${b}`} className={st.srcNum} aria-label={`Source ${b}`}>{b}</a></> : null}
        </span>
      ))}
    </p>
  )
}

export function Section({ id, title, sub, icon, children, foot, first }: {
  id: string
  /** The part right under the hero: no hairline above it. */
  first?: boolean
  title: string
  sub?: ReactNode
  icon?: 'caution'
  children: ReactNode
  foot?: ReactNode
}) {
  return (
    <section id={id} className={first ? `${st.section} ${st.sectionFirst}` : st.section} aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} className={st.h2}>
        {icon === 'caution'
          ? <span className={st.h2Icon}><Icon name="triangle-alert" size={20} className={st.cautionIcon} />{title}</span>
          : title}
      </h2>
      {sub ? <p className={st.sub}>{sub}</p> : null}
      {children}
      {foot}
    </section>
  )
}

/** The hero readings: THE stat tile (components/ui/StatTile), three across; one compact panel on a phone. */
export function Tiles({ tiles }: { tiles: Array<{ label: string; value: string; text: string }> }) {
  return (
    <div className={st.tiles}>
      {tiles.map((t) => <StatTile key={t.label} label={t.label} value={t.value} note={t.text} />)}
    </div>
  )
}

/** A requirement list: a check glyph (ink, not a state colour), the requirement, one quiet line of detail. */
export function Checklist({ items, cols }: { items: Array<{ name: string; text?: string | null }>; cols?: boolean }) {
  return (
    <ul className={`${st.check}${cols ? ' ' + st.checkCols : ''}`}>
      {items.map((i) => (
        <li key={i.name} className={st.checkItem}>
          <span className={st.checkMark} aria-hidden><Icon name="check" size={14} strokeWidth={2.6} /></span>
          <span className={st.checkBody}>
            <span className={st.checkName}>{i.name}</span>
            {i.text ? <span className={st.checkText}>{i.text}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  )
}

export function Chips({ items, strong }: { items: string[]; strong?: boolean }) {
  if (!items.length) return null
  return (
    <ul className={st.chips}>
      {items.map((c) => <li key={c} className={strong ? st.chipStrong : st.chip}>{c}</li>)}
    </ul>
  )
}

/** Numbered steps: the short line people scan, then the rest. */
export function Steps({ items }: { items: Array<{ step: string; text: string }> }) {
  return (
    <ol className={st.steps}>
      {items.map((s, i) => (
        <li key={s.step} className={st.stepItem}>
          <span className={st.stepNum} aria-hidden>{i + 1}</span>
          <span className={st.checkBody}>
            <span className={st.checkName}>{s.step}</span>
            <span className={st.checkText}>{s.text}</span>
          </span>
        </li>
      ))}
    </ol>
  )
}

/** Short plain rows under a small ink label (first-hand accounts carry their label here). */
export function NoteList({ label, items, icon, caution }: { label?: string; items: Array<{ text?: string | null; lead?: string }>; icon?: 'x' | 'dot'; caution?: boolean }) {
  return (
    <div className={st.notes}>
      {label ? <p className={st.label}>{caution ? <Icon name="triangle-alert" size={14} className={st.cautionIcon} /> : null}{label}</p> : null}
      <ul className={st.noteList}>
        {items.map((e, i) => (
          <li key={i} className={st.note}>
            {icon === 'x'
              ? <span className={st.noteMark} aria-hidden><Icon name="x" size={14} strokeWidth={2.4} /></span>
              : <span className={st.noteDot} aria-hidden />}
            <span>{e.lead ? <><span className={st.noteLead}>{e.lead}</span> </> : null}{e.text}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** A list where each item is a disclosure: the short line people scan in the summary, the rest one tap away. */
export function DiscList({ items }: { items: Array<{ lead: string; text: string }> }) {
  return (
    <div className={st.faq}>
      {items.map((m) => (
        <details key={m.lead} className={st.qa}>
          <summary className={st.qSum}>
            <span className={st.q}>{m.lead}</span>
            <Icon name="chevron-down" size={16} className={st.chev} />
          </summary>
          <p className={st.a}>{m.text}</p>
        </details>
      ))}
    </div>
  )
}

/** A quiet "more detail" disclosure: hairline row, chevron, closed by default. */
export function More({ title, children, id }: { title: ReactNode; children: ReactNode; id?: string }) {
  return (
    <details className={st.more} id={id}>
      <summary className={st.moreSum}>
        <span>{title}</span>
        <Icon name="chevron-down" size={16} className={st.chev} />
      </summary>
      <div className={st.moreBody}>{children}</div>
    </details>
  )
}

export type Column = { key: string; label: string; num?: boolean }
/** A compact figures table (columns on wide screens, one block per row on phones). */
export function GuideTable({ caption, columns, rows }: {
  caption: string
  columns: Column[]
  rows: Array<Record<string, unknown>>
}) {
  return (
    <div className={st.tableWrap}>
      <table className={st.table}>
        <caption className="sr-only">{caption}</caption>
        <thead><tr>{columns.map((c) => <th key={c.key} scope="col" className={c.num ? st.num : undefined}>{c.label}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {columns.map((c) => {
                const v = r[c.key]
                return <td key={c.key} data-label={c.label} className={c.num ? st.num : undefined}>{typeof v === 'string' ? v : '—'}</td>
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** The FAQ: one native disclosure per question (the same Q&As go into the FAQPage JSON-LD). */
export function Faq({ items }: { items: Array<{ q: string; a: Entry }> }) {
  return (
    <div className={st.faq}>
      {items.map(({ q, a }) => (
        <details key={q} className={st.qa}>
          <summary className={st.qSum}>
            <h3 className={st.q}>{q}</h3>
            <Icon name="chevron-down" size={16} className={st.chev} />
          </summary>
          <p className={st.a}>{a.text}</p>
        </details>
      ))}
    </div>
  )
}

/** FAQPage JSON-LD built from the SAME Q&As the page shows (answers as plain text, no reference numbers). */
export function faqJsonLd(items: Array<{ q: string; a: Entry }>) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map(({ q, a }) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a.text } })),
  }
}

/** The numbered sources, collapsed at the bottom, in the order lib/start/guides.js numberSources gives. */
export function Sources({ ordered, prefix }: { ordered: Array<[string, Source]>; prefix: string }) {
  return (
    <SourcesDisclosure prefix={prefix} count={ordered.length}>
      <p className={st.srcIntro}>Dates are when each page was posted, updated or read.</p>
      <ol className={st.sources}>
        {ordered.map(([k, s], i) => (
          <li key={k} id={`${prefix}-src-${i + 1}`}>
            {s.label}. <a href={s.url} className={st.srcLink} target="_blank" rel="noopener noreferrer">{sourceHost(s.url)}</a>
            {', '}{s.note ? `${s.note} ` : ''}{formatSourceDate(s.date)}.
          </li>
        ))}
      </ol>
    </SourcesDisclosure>
  )
}

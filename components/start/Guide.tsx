/**
 * Building blocks for the "getting in" guides (/start/oilfield, /start/trades). Server-safe (no hooks), so the pages
 * stay server components and every word ships in the HTML. Each fact is rendered with its numbered source
 * reference, and the numbered list at the bottom is built from the same data module, so a figure can never appear
 * without the source and date beside it.
 */
import type { ReactNode } from 'react'
import Icon from '@/components/ui/Icon'
import { formatSourceDate, sourceHost } from '@/lib/start/guides.js'
import st from './guide.module.css'

export type Source = { label: string; url: string; date: string; note?: string }
export type Entry = { text: string; src: string[]; firstHand?: boolean }
export type Nums = Record<string, number>

/** "[3, 7]" — each number links to its line in the Sources list. */
export function Refs({ src, nums, prefix }: { src: string[]; nums: Nums; prefix: string }) {
  const list = [...new Set(src)].filter((k) => nums[k]).sort((a, b) => nums[a] - nums[b])
  if (!list.length) return null
  return (
    <span className={st.refs}>
      [{list.map((k, i) => (
        <span key={k}>{i > 0 ? ', ' : ''}<a href={`#${prefix}-src-${nums[k]}`} className={st.ref} aria-label={`Source ${nums[k]}`}>{nums[k]}</a></span>
      ))}]
    </span>
  )
}

/** One sentence (or a few) with its references. */
export function Fact({ e, nums, prefix }: { e: Entry; nums: Nums; prefix: string }) {
  return <>{e.text}<Refs src={e.src} nums={nums} prefix={prefix} /></>
}

export function Section({ id, title, children, icon }: { id: string; title: string; children: ReactNode; icon?: 'caution' }) {
  return (
    <section id={id} className={st.section} aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} className={st.h2}>
        {icon === 'caution'
          ? <span className={st.h2Icon}><Icon name="triangle-alert" size={20} className={st.cautionIcon} />{title}</span>
          : title}
      </h2>
      {children}
    </section>
  )
}

export function FactList({ items, nums, prefix }: { items: Entry[]; nums: Nums; prefix: string }) {
  return (
    <ul className={st.list}>
      {items.map((e, i) => <li key={i}><Fact e={e} nums={nums} prefix={prefix} /></li>)}
    </ul>
  )
}

/** First-hand accounts, set apart and labelled: what people say, not facts. */
export function SaidList({ label, items, nums, prefix }: { label: string; items: Entry[]; nums: Nums; prefix: string }) {
  return (
    <div className={st.said}>
      <p className={st.saidLabel}>{label}</p>
      <FactList items={items} nums={nums} prefix={prefix} />
    </div>
  )
}

export type Column = { key: string; label: string; num?: boolean }
export function GuideTable({ caption, columns, rows, nums, prefix }: {
  caption: string
  columns: Column[]
  rows: Array<Record<string, string | null | string[]> & { src: string[] }>
  nums: Nums
  prefix: string
}) {
  return (
    <div className={st.tableWrap}>
      <table className={st.table}>
        <caption className="sr-only">{caption}</caption>
        <thead><tr>{columns.map((c) => <th key={c.key} scope="col">{c.label}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {columns.map((c, ci) => {
                const v = r[c.key]
                const text = typeof v === 'string' ? v : '—'
                const last = ci === columns.length - 1
                return (
                  <td key={c.key} data-label={c.label} className={c.num ? st.num : undefined}>
                    {text}{last && <Refs src={r.src} nums={nums} prefix={prefix} />}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function Toc({ items }: { items: Array<{ id: string; label: string }> }) {
  return (
    // A div, not <nav>: globals.css styles every <nav> element as the fixed site bar.
    <div className={st.toc} role="navigation" aria-label="On this page">
      <p className={st.tocTitle}>On this page</p>
      <ul className={st.tocList}>
        {items.map((t) => <li key={t.id}><a href={`#${t.id}`} className={st.tocLink}>{t.label}</a></li>)}
      </ul>
    </div>
  )
}

export function Faq({ items, nums, prefix }: { items: Array<{ q: string; a: Entry }>; nums: Nums; prefix: string }) {
  return (
    <>
      {items.map(({ q, a }) => (
        <div key={q} className={st.qa}>
          <h3 className={st.q}>{q}</h3>
          <p className={st.a}><Fact e={a} nums={nums} prefix={prefix} /></p>
        </div>
      ))}
    </>
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

/** The numbered list at the bottom, in the order lib/start/guides.js numberSources gives (first appearance). */
export function SourceList({ ordered, prefix }: { ordered: Array<[string, Source]>; prefix: string }) {
  return (
    <ol className={st.sources}>
      {ordered.map(([k, s], i) => (
        <li key={k} id={`${prefix}-src-${i + 1}`}>
          {s.label}. <a href={s.url} className={st.srcLink} target="_blank" rel="noopener noreferrer">{sourceHost(s.url)}</a>
          {', '}{s.note ? `${s.note} ` : ''}{formatSourceDate(s.date)}.
        </li>
      ))}
    </ol>
  )
}

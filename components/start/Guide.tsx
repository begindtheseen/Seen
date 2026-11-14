/**
 * Building blocks for the start guides (/start/<field>). Server-safe (no hooks), so the page stays a server
 * component and every word ships in the HTML. The page reads like a Seen screen: readings (stat tiles), a listings
 * block, then openable rows (`MenuRow`, a native <details>) holding checklists, cards, rows and chips. Each row's
 * content is DATA — the guide module's `menu` — rendered by `Blocks` from the block vocabulary below, so a new guide
 * is a new data module, never new markup. No citations are printed: the references behind each fact live in the
 * data module, and readers reach the links through the grouped "Additional resources" row.
 */
import type { ReactNode } from 'react'
import Link from 'next/link'
import Icon from '@/components/ui/Icon'
import StatTile from '@/components/ui/StatTile'
import { sourceHost } from '@/lib/start/guides.js'
import st from './guide.module.css'

export type Source = { label: string; url: string; date: string; note?: string }
export type Entry = { text?: string | null; src: string[]; firstHand?: boolean }

/** The hero readings: THE stat tile (components/ui/StatTile), three across; one compact panel on a phone. */
export function Tiles({ tiles }: { tiles: Array<{ label: string; value: string; text: string }> }) {
  return (
    <div className={st.tiles}>
      {tiles.map((t) => <StatTile key={t.label} label={t.label} value={t.value} note={t.text} />)}
    </div>
  )
}

/** One openable row of the page: the title (an h2), one line of what is inside, a chevron; closed by default. */
export function MenuRow({ id, title, summary, icon, children }: { id: string; title: string; summary: string; icon?: 'caution'; children: ReactNode }) {
  return (
    <details className={st.menuRow} id={id}>
      <summary className={st.menuSum}>
        {icon === 'caution' ? <span className={st.menuIcon} aria-hidden><Icon name="triangle-alert" size={18} className={st.cautionIcon} /></span> : null}
        <span className={st.menuText}>
          <h2 className={st.menuTitle}>{title}</h2>
          <span className={st.menuLine}>{summary}</span>
        </span>
        <Icon name="chevron-down" size={20} className={`${st.chev} ${st.menuChev}`} />
      </summary>
      <div className={st.menuBody}>{children}</div>
    </details>
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

/** Short plain rows under a small ink label. */
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

/** A quiet "more detail" disclosure inside a row: hairline, chevron, closed by default. */
export function More({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <details className={st.more}>
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
export function GuideTable({ caption, columns, rows }: { caption: string; columns: Column[]; rows: Array<Record<string, unknown>> }) {
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

/** FAQPage JSON-LD built from the SAME Q&As the page shows (answers as plain text). */
export function faqJsonLd(items: Array<{ q: string; a: Entry }>) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map(({ q, a }) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a.text } })),
  }
}

/** "Additional resources": every reference behind the page as plain grouped links — no numbers, no dates. */
export function Resources({ groups, sources }: { groups: Array<{ title: string; items: Array<{ key: string; name: string }> }>; sources: Record<string, Source> }) {
  return (
    <div className={st.resGroups}>
      {groups.map((g) => (
        <div key={g.title} className={st.resGroup}>
          <h3 className={st.resTitle}>{g.title}</h3>
          <ul className={st.resList}>
            {g.items.filter((i) => sources[i.key]).map((i) => (
              <li key={i.key}>
                <a href={sources[i.key].url} className={st.resLink} target="_blank" rel="noopener noreferrer">
                  <span className={st.resName}>{i.name}</span>
                  <span className={st.resHost}>{sourceHost(sources[i.key].url)}<span className="sr-only"> (opens in a new tab)</span></span>
                  <Icon name="arrow-up-right" size={14} className={st.resIcon} />
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

/** The resources row's one-line summary, from its group titles ("Employers’ job boards, entry postings, … and more"). */
export function resourcesSummary(groups: Array<{ title: string }>) {
  const names = groups.slice(0, 3).map((g, i) => (i === 0 ? g.title : g.title.charAt(0).toLowerCase() + g.title.slice(1)))
  return `${names.join(', ')}${groups.length > 3 ? ' and more' : ''}`
}

// ── The block vocabulary a guide's `menu` rows are written in ─────────────────────────────────────────────────────
/* eslint-disable @typescript-eslint/no-explicit-any */
export type Block = { type: string; [k: string]: any }

function Employers({ items, shown, moreTitle, sources }: { items: any[]; shown: number; moreTitle: string; sources: Record<string, Source> }) {
  const row = (e: any) => (
    <li key={e.name} className={st.erow}>
      <h3 className={st.erowName}>{e.name}</h3>
      {e.pay && <p className={st.erowPay}><b>{e.pay.value}</b><span>{e.pay.note}</span></p>}
      <div className={st.erowRoles}><Chips items={e.roles} /></div>
      <p className={st.erowText}>
        {e.evidence.text}{' '}
        {sources[e.board] ? (
          <a href={sources[e.board].url} className={st.boardLink} target="_blank" rel="noopener noreferrer">
            Job board<span className="sr-only"> of {e.name} (opens in a new tab)</span>&nbsp;<Icon name="arrow-up-right" size={12} />
          </a>
        ) : null}
      </p>
    </li>
  )
  return (
    <>
      <ul className={st.list}>{items.slice(0, shown).map(row)}</ul>
      {items.length > shown ? (
        <More title={`${items.length - shown} ${moreTitle}`}>
          <ul className={st.list}>{items.slice(shown).map(row)}</ul>
        </More>
      ) : null}
    </>
  )
}

function Doors({ items }: { items: any[] }) {
  return (
    <div className={st.doors}>
      {items.map((d) => (
        <div key={d.title} className={st.card}>
          <h3 className={st.cardName}>{d.title}</h3>
          <p className={st.cardText}>{d.lead.text}</p>
          <ul className={st.figRows}>
            {d.examples.map((x: any) => (
              <li key={x.who} className={st.figRow}>
                <span className={st.figWho}>{x.who}</span>
                <span className={st.figVal}>{x.figure}</span>
                <span className={st.figText}>{x.text}</span>
              </li>
            ))}
          </ul>
          {d.note && <p className={st.cardNote}>{d.note.text}</p>}
        </div>
      ))}
    </div>
  )
}

function TradeRows({ items }: { items: any[] }) {
  return (
    <div className={st.list}>
      {items.map((t) => (
        <details key={t.trade} className={st.trow}>
          <summary className={st.trowSum}>
            <span className={st.trowName}>
              <span>{t.trade}</span>
              <span className={st.trowLen}>{t.length}</span>
            </span>
            <span className={st.trowLenWide}>{t.length}</span>
            <span className={st.trowFig}>{t.median}<small>median a year</small></span>
            <Icon name="chevron-down" size={16} className={st.chev} />
          </summary>
          <div className={st.trowBody}>
            <p><span>Way in</span>{t.path}</p>
            <p><span>How to apply</span>{t.apply}</p>
          </div>
        </details>
      ))}
    </div>
  )
}

function Cards({ items }: { items: any[] }) {
  return (
    <ul className={st.cards}>
      {items.map((c) => (
        <li key={c.name} className={st.card}>
          <div className={st.cardTop}>
            <div className={st.cardHead}>
              <h3 className={st.cardName}>{c.name}</h3>
              {c.aka ? <span className={st.cardAka}>{c.aka}</span> : null}
            </div>
            {c.link ? (
              <a href={c.link} className={st.boardLink} target="_blank" rel="noopener noreferrer">
                {sourceHost(c.link)}<span className="sr-only"> (opens in a new tab)</span> <Icon name="arrow-up-right" size={14} />
              </a>
            ) : null}
          </div>
          {c.body?.text ? <p className={st.cardText}>{c.body.text}</p> : null}
          {c.chips?.length ? <Chips items={c.chips.map((x: Entry) => x.text || '').filter(Boolean)} strong /> : null}
        </li>
      ))}
    </ul>
  )
}

/** Render a row's blocks. `sources` resolves an employer's job-board link. */
export function Blocks({ blocks, sources }: { blocks: Block[]; sources: Record<string, Source> }) {
  return (
    <>
      {blocks.map((b, i) => {
        switch (b.type) {
          case 'text':
            if (b.entries) return <p key={i} className={st.p}>{b.entries.map((e: Entry) => e.text).join(' ')}</p>
            return <p key={i} className={st.p}>{b.lead ? <>{b.lead} </> : null}{b.plain ?? b.entry?.text}</p>
          case 'note': return <p key={i} className={st.note2}>{b.entry.text}</p>
          case 'heading': return <h3 key={i} className={st.subhead}>{b.text}</h3>
          case 'callout': return <p key={i} className={st.callout}>{b.entry.text}</p>
          case 'checklist': return <Checklist key={i} items={b.items} cols={b.cols} />
          case 'cards': return <Cards key={i} items={b.items} />
          case 'doors': return <Doors key={i} items={b.items} />
          case 'tradeRows': return <TradeRows key={i} items={b.items} />
          case 'employers': return <Employers key={i} items={b.items} shown={b.shown} moreTitle={b.moreTitle} sources={sources} />
          case 'table': return <GuideTable key={i} caption={b.caption} columns={b.columns} rows={b.rows} />
          case 'steps': return <Steps key={i} items={b.items} />
          case 'notes': return <NoteList key={i} label={b.label} items={b.items} icon={b.icon} caution={b.caution} />
          case 'notesGrid':
            return (
              <div key={i} className={st.notesGrid}>
                {b.groups.map((g: any) => <NoteList key={g.label} label={g.label} items={g.items} icon={g.icon} caution={g.caution} />)}
              </div>
            )
          case 'disclosures': return <DiscList key={i} items={b.items} />
          case 'faq': return <Faq key={i} items={b.items} />
          case 'more': return <More key={i} title={b.title}><Blocks blocks={b.blocks} sources={sources} /></More>
          case 'resumeLink':
            return (
              <p key={i} className={st.p}>
                {b.before} <Link href="/resume" prefetch={false} className={st.inlineLink}>{b.label}</Link>.
              </p>
            )
          default: return null
        }
      })}
    </>
  )
}

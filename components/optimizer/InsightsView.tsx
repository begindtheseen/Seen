'use client'

// Job Insights as the server reads them (lib/server/jobInsights.js v5, Track B): every item is a posting
// statement with the sentence it came from — dealbreakers first, then what it asks for, the work, preferred last
// (labelled); the conditions it states, each with its quote; the pay with its source; the tip only when there is
// one. An older cached answer (no `items`) falls back to the legacy list. Shared by the job drawer and job page.

import Icon from '@/components/ui/Icon'
import s from './InsightsView.module.css'

export interface InsightItem { text: string; kind?: string; importance?: string; source?: string; gate?: boolean }
export interface InsightCondition { text: string; label?: string; kind?: string; source?: string; gate?: boolean }
export interface InsightsData {
  what_they_want?: string[]
  hidden_requirements?: string[]
  insider_tip?: string
  tip_source?: string | null
  description_summary?: string
  items?: InsightItem[]
  hidden_items?: InsightCondition[]
  conditions_note?: string
  posting_note?: string
  pay?: { text: string; source?: string } | null
  requirements_read?: number
  shared?: boolean
}
/** The probe's counts before a credit (api/job-insights.js on a miss). */
export interface InsightsProbe { requirements_read?: number; item_count?: number; condition_count?: number; has_pay?: boolean }

// Some stored postings carry raw entities; the quote is verbatim on purpose, so decode on screen only.
const ENT: Record<string, string> = { amp: '&', mdash: '—', ndash: '–', nbsp: ' ', quot: '"', apos: "'", rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', hellip: '…', bull: '•', middot: '·' }
export const decode = (t?: string | null) => String(t || '').replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) => e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e.toLowerCase()] ?? m).replace(/\s+/g, ' ').trim()

/** What a credit buys for THIS posting, in the probe's counts (or null when the probe sent none). */
export function insightsOfferSentence(p: InsightsProbe | null | undefined): string | null {
  if (!p || typeof p.requirements_read !== 'number') return null
  const n = p.item_count ?? p.requirements_read
  const parts = [`${n} thing${n === 1 ? '' : 's'} this posting asks for, dealbreakers first, each with the sentence it comes from`]
  if (p.condition_count) parts.push(`${p.condition_count} condition${p.condition_count === 1 ? '' : 's'} it states about the job`)
  if (p.has_pay) parts.push('the pay it lists')
  return `${parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`}.`
}

function Quote({ text }: { text?: string | null }) {
  const t = decode(text)
  if (!t) return null
  return <p className={s.quote}>“{t}”</p>
}

export default function InsightsView({ data }: { data: InsightsData }) {
  const items = Array.isArray(data.items) ? data.items.filter((i) => i && decode(i.text)) : null
  if (!items || !items.length) {
    // legacy answer (v4 and older)
    return (
      <div className={s.wrap}>
        <ul className={s.plain}>{(data.what_they_want || []).map((t, i) => <li key={i}><Icon name="check" size={14} />{t}</li>)}</ul>
        {data.insider_tip && <p className={s.tip}><b>Tip: </b>{data.insider_tip}</p>}
      </div>
    )
  }
  const gates = items.filter((i) => i.gate)
  const req = items.filter((i) => !i.gate && i.importance !== 'preferred' && i.importance !== 'duty')
  const duty = items.filter((i) => !i.gate && i.importance === 'duty')
  const pref = items.filter((i) => !i.gate && i.importance === 'preferred')
  const conds = (data.hidden_items || []).filter((c) => c && decode(c.text))
  const group = (label: string, rows: InsightItem[], tag?: string) => rows.length > 0 && (
    <div className={s.group}>
      <p className={s.label}>{label}</p>
      <ul className={s.list}>
        {rows.map((r, i) => (
          <li key={i} className={s.item} data-testid="insight-item">
            <p className={s.text}>{decode(r.text)}{tag ? <span className={s.tag}> · {tag}</span> : null}</p>
            {r.source && decode(r.source) !== decode(r.text) && <Quote text={r.source} />}
          </li>
        ))}
      </ul>
    </div>
  )
  return (
    <div className={s.wrap} data-testid="insights-view">
      {data.posting_note && <p className={s.note}>{decode(data.posting_note)}</p>}
      {group('Dealbreakers — required to apply', gates)}
      {group('What it asks for', req)}
      {group('The work', duty)}
      {group('Preferred — not required', pref)}
      <div className={s.group}>
        <p className={s.label}>What the posting states about the job</p>
        {conds.length
          ? <ul className={s.list}>{conds.map((c, i) => <li key={i} className={s.item} data-testid="insight-condition"><p className={s.text}>{decode(c.text)}{c.gate ? <span className={s.tag}> · required</span> : null}</p></li>)}</ul>
          : data.conditions_note ? <p className={s.note}>{decode(data.conditions_note)}</p> : null}
      </div>
      {data.pay && decode(data.pay.text) && (
        <div className={s.group} data-testid="insight-pay">
          <p className={s.label}>Pay</p>
          <p className={s.text}>{decode(data.pay.text)}</p>
          <Quote text={data.pay.source} />
        </div>
      )}
      {data.insider_tip && <p className={s.tip}><b>Tip: </b>{decode(data.insider_tip)}</p>}
    </div>
  )
}

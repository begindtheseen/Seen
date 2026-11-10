'use client'

// THE fit read (free): the verdict's band and sentence, the graded gates in plain words, then every
// requirement as the posting states it with its state (icon + word) and the person's own line as proof.
// Used by the Optimize sheet (choose + result), /resume and the Studio Tailor panel. Every word on it is the
// server's (components/optimizer/fitRead.js only groups and orders); an answer with no `statements` (an older
// cached response) falls back to the verdict's requirement list.

import { useState } from 'react'
import Icon from '@/components/ui/Icon'
import type { IconName } from '@/components/ui/Icon'
import { RequirementsView, type Verdict, type RequirementRow, type ConstraintRow } from './Verdict'
import { fitGroups, groupHeading, partlySentence, gateRows, differentField, verdictSentence, STATE_WORD } from './fitRead.js'
import s from './FitRead.module.css'

export interface Statement { id: string; text: string; source?: string; kind?: string; importance?: string; status?: string; evidence?: { line: string; why?: string }[]; missing?: string[] }
export interface FieldMatch { level?: string; known?: boolean; sentence?: string; transferable?: string[]; resumeField?: string; postingField?: string }
export interface FitData {
  verdict?: Verdict | null
  statements?: Statement[]
  matched_requirements?: RequirementRow[]
  unsupported_requirements?: RequirementRow[]
  constraints?: (ConstraintRow & { grade?: string; sentence?: string; caps?: boolean; posting_quote?: string })[]
  field_match?: FieldMatch | null
}

type State = 'shown' | 'partly' | 'not_shown' | 'ask'
const ICON: Record<State, IconName> = { shown: 'circle-check', partly: 'circle-dot', not_shown: 'circle-alert', ask: 'circle-help' }
const LIMIT: Record<string, number> = { required: 8, ask: 3, duty: 4, preferred: 4 }

function StateMark({ state }: { state: State }) {
  return <span className={s.mark} data-state={state}><Icon name={ICON[state]} size={16} />{STATE_WORD[state]}</span>
}

interface Row { id: string; text: string; state: State; preferred: boolean; line: string; lineIsJob?: boolean; missing: string[]; question: string; sameAs?: string }

function StatementRow({ r }: { r: Row }) {
  return (
    <li className={s.row} data-state={r.state} data-testid="fit-row">
      <StateMark state={r.state} />
      <p className={s.text}>{r.state === 'ask' ? r.question : r.text}{r.preferred && r.state !== 'ask' ? <span className={s.tag}> · preferred</span> : null}</p>
      {r.line && !r.sameAs && <p className={s.quote}>{r.lineIsJob ? 'Your job' : 'Your line'}: “{r.line.length > 200 ? `${r.line.slice(0, 200).replace(/\s+\S*$/, '')}…` : r.line}”</p>}
      {r.line && r.sameAs && <p className={s.quote}>Shown by the same {r.lineIsJob ? 'job' : 'line'} as “{r.sameAs.length > 60 ? `${r.sameAs.slice(0, 60).replace(/\s+\S*$/, '')}…` : r.sameAs}” above.</p>}
      {r.state === 'partly' && <p className={s.note}>{partlySentence(r)}</p>}
    </li>
  )
}

function Group({ g }: { g: { key: string; rows: Row[] } }) {
  const [all, setAll] = useState(false)
  const lim = LIMIT[g.key] || 6
  const rows = all ? g.rows : g.rows.slice(0, lim)
  const h = groupHeading(g)
  return (
    <div className={s.group} data-group={g.key}>
      <p className={s.gHead}><span className={s.gLabel}>{h.label}</span><span className={s.gTally}>{h.tally}</span></p>
      <ul className={s.list}>{rows.map((r) => <StatementRow key={r.id} r={r} />)}</ul>
      {g.rows.length > lim && <button type="button" className={s.more} aria-expanded={all} onClick={() => setAll((v) => !v)}>{all ? 'Show fewer' : `Show all ${g.rows.length}`}</button>}
    </div>
  )
}

/**
 * @param data   the free check (or the paid package — a superset of it)
 * @param compact the result screen: band line + sentence only, statements behind a disclosure
 */
export default function FitRead({ data, note, compact = false, brief = false }: { data: FitData; note?: string; compact?: boolean; brief?: boolean }) {
  const v = data.verdict || null
  const diff = differentField(data.field_match || null)
  const model = fitGroups(data)
  const gates = gateRows(data.constraints || [])
  const band = diff ? 'Different field' : (v?.band || (v?.score == null ? 'No score' : ''))
  const sentence = diff ? diff.sentence : verdictSentence(v)
  const body = (
    <>
      {gates.length > 0 && (
        <div className={s.group} data-group="gates">
          <p className={s.gHead}><span className={s.gLabel}>What they count</span></p>
          <ul className={s.list}>
            {gates.map((g, i) => (
              <li key={i} className={s.row} data-state={g.state} data-testid="fit-gate">
                <StateMark state={g.state as State} />
                <p className={s.text}>{g.text}{g.caps ? <span className={s.tag}> · this decides the application</span> : null}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
      {model
        ? model.groups.map((g) => <Group key={g.key} g={g as { key: string; rows: Row[] }} />)
        : <RequirementsView matched={data.matched_requirements || []} missing={data.unsupported_requirements || []} />}
      {model && model.promises.length > 0 && (
        <div className={s.promises} data-testid="fit-promises">
          <p className={s.gLabel}>What the posting promises</p>
          <ul className={s.plain}>{model.promises.map((p) => <li key={p.id}>“{p.text}”</li>)}</ul>
        </div>
      )}
    </>
  )
  return (
    <section className={s.fit} data-testid="fit-read" aria-label="Your fit for this job">
      <div className={s.head}>
        {v?.gate && !diff && !brief && <p className={s.gate}><Icon name="triangle-alert" size={16} label="Gate" /><span>{v.gate}</span></p>}
        <p className={s.band}>
          {v && v.score != null && !diff ? <span className={s.score}>{v.score}</span> : null}
          <span>{band}</span>
          {note ? <span className={s.bandNote}>{note}</span> : null}
        </p>
        {sentence && !brief && <p className={s.sentence} data-testid="fit-sentence">{sentence}</p>}
        {diff && !brief && diff.carries.length > 0 && !/carries over/i.test(sentence) && <p className={s.carries}>What carries over: {diff.carries.join(', ')}.</p>}
      </div>
      {compact
        ? <details className={s.disclose}><summary>{model ? `Every requirement, one by one (${model.total})` : 'What the posting asks for'}</summary>{body}</details>
        : body}
    </section>
  )
}

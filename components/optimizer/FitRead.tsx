'use client'

// THE fit read (free): the verdict's band and sentence, the graded gates in plain words, then what matters most —
// the top five requirements (required first; what is not shown or only partly shown before what is), with the
// person's own line as proof. "Show all" opens every line, grouped; questions only the person can answer (lifting,
// hours, eligibility) take a Yes / No / Skip that is kept for this job and sent with the optimize request — the screen
// never writes an answer into the résumé. Every word is the server's (fitRead.js only groups and orders); an
// answer with no `statements` (an older cached response) falls back to the verdict's requirement list.

import { useState } from 'react'
import Icon from '@/components/ui/Icon'
import type { IconName } from '@/components/ui/Icon'
import { RequirementsView, type Verdict, type RequirementRow, type ConstraintRow } from './Verdict'
import { fitGroups, groupHeading, partlySentence, gateRows, differentField, verdictSentence, topRows, STATE_WORD } from './fitRead.js'
import s from './FitRead.module.css'

export interface Statement { id: string; text: string; source?: string; kind?: string; importance?: string; status?: string; display?: boolean; evidence?: { line: string; why?: string }[]; missing?: string[] }
export interface FieldMatch { level?: string; known?: boolean; sentence?: string; transferable?: string[]; resumeField?: string; postingField?: string }
export interface FitData {
  verdict?: Verdict | null
  statements?: Statement[]
  matched_requirements?: RequirementRow[]
  unsupported_requirements?: RequirementRow[]
  constraints?: (ConstraintRow & { grade?: string; sentence?: string; caps?: boolean; posting_quote?: string })[]
  field_match?: FieldMatch | null
}
export type Answer = 'yes' | 'no' | 'skip'
export type Answers = Record<string, Answer>

type State = 'shown' | 'partly' | 'not_shown' | 'ask'
const ICON: Record<State, IconName> = { shown: 'circle-check', partly: 'circle-dot', not_shown: 'circle-alert', ask: 'circle-help' }
const LIMIT: Record<string, number> = { required: 8, ask: 8, duty: 6, preferred: 6 }
const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n).replace(/\s+\S*$/, '')}…` : t)

function StateMark({ state }: { state: State }) {
  return <span className={s.mark} data-state={state}><Icon name={ICON[state]} size={16} />{STATE_WORD[state]}</span>
}

interface Row { id: string; text: string; state: State; preferred: boolean; line: string; lineIsJob?: boolean; missing: string[]; question: string; sameAs?: string }

function AnswerControls({ r, answer, onAnswer }: { r: Row; answer?: Answer; onAnswer?: (id: string, a: Answer | null) => void }) {
  if (!onAnswer) return null
  if (answer) return (
    <p className={s.said} data-testid="fit-said">
      <span>{answer === 'skip' ? 'You skipped this one' : `You said: ${answer} — ${r.text.charAt(0).toLowerCase()}${r.text.slice(1)}`}</span>
      <button type="button" className={s.change} onClick={() => onAnswer(r.id, null)}>Change</button>
    </p>
  )
  return (
    <div className={s.answers} role="group" aria-label="Your answer">
      {(['yes', 'no', 'skip'] as const).map((a) => <button key={a} type="button" className={s.ans} onClick={() => onAnswer(r.id, a)} data-testid={`fit-ans-${a}`}>{a === 'yes' ? 'Yes' : a === 'no' ? 'No' : 'Skip'}</button>)}
    </div>
  )
}

function StatementRow({ r, answer, onAnswer, quoted }: { r: Row; answer?: Answer; onAnswer?: (id: string, a: Answer | null) => void; quoted?: Set<string> }) {
  // in a partial list a "same line as … above" reference can point at a row that is not on screen: quote it instead
  const ref = r.sameAs && (!quoted || quoted.has(r.line.toLowerCase())) ? r.sameAs : ''
  if (quoted && r.line) quoted.add(r.line.toLowerCase())
  return (
    <li className={s.row} data-state={r.state} data-testid="fit-row">
      <StateMark state={r.state} />
      <p className={s.text}>{r.state === 'ask' ? r.question : r.text}{r.preferred && r.state !== 'ask' ? <span className={s.tag}> · preferred</span> : null}</p>
      {r.line && !ref && <p className={s.quote}>{r.lineIsJob ? 'Your job' : 'Your line'}: “{clip(r.line, 200)}”</p>}
      {r.line && ref && <p className={s.quote}>Shown by the same {r.lineIsJob ? 'job' : 'line'} as “{clip(ref, 60)}” above.</p>}
      {r.state === 'partly' && <p className={s.note}>{partlySentence(r)}</p>}
      {r.state === 'ask' && <AnswerControls r={r} answer={answer} onAnswer={onAnswer} />}
    </li>
  )
}

function Group({ g, answers, onAnswer }: { g: { key: string; rows: Row[] }; answers?: Answers; onAnswer?: (id: string, a: Answer | null) => void }) {
  const [all, setAll] = useState(false)
  const lim = LIMIT[g.key] || 6
  const rows = all ? g.rows : g.rows.slice(0, lim)
  const h = groupHeading(g)
  return (
    <div className={s.group} data-group={g.key}>
      <p className={s.gHead}><span className={s.gLabel}>{h.label}</span><span className={s.gTally}>{h.tally}</span></p>
      <ul className={s.list}>{rows.map((r) => <StatementRow key={r.id} r={r} answer={answers?.[r.id]} onAnswer={onAnswer} />)}</ul>
      {g.rows.length > lim && <button type="button" className={s.more} aria-expanded={all} onClick={() => setAll((v) => !v)}>{all ? 'Show fewer' : `Show all ${g.rows.length}`}</button>}
    </div>
  )
}

/**
 * @param data    the free check (or the paid package — a superset of it)
 * @param compact the result screen: band line + sentence only, every line behind one disclosure
 * @param brief   blocked: band only (the blocked card says why)
 * @param answers / onAnswer  the person's Yes / No / Skip on what only they can say (kept by the caller)
 */
export default function FitRead({ data, note, compact = false, brief = false, answers, onAnswer }: { data: FitData; note?: string; compact?: boolean; brief?: boolean; answers?: Answers; onAnswer?: (id: string, a: Answer | null) => void }) {
  const [open, setOpen] = useState(false)
  const [asking, setAsking] = useState(false)
  const v = data.verdict || null
  const diff = differentField(data.field_match || null)
  const model = fitGroups(data)
  const gates = gateRows(data.constraints || [])
  const band = diff ? 'Different field' : (v?.band || (v?.score == null ? 'No score' : ''))
  const sentence = diff ? diff.sentence : verdictSentence(v)
  const asks = model ? ((model.groups.find((g) => g.key === 'ask') || { rows: [] }).rows as Row[]) : []
  const answered = asks.filter((r) => answers?.[r.id]).length
  const gatesBlock = gates.length > 0 && (
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
  )
  const everything = (
    <>
      {model
        ? model.groups.map((g) => <Group key={g.key} g={g as { key: string; rows: Row[] }} answers={answers} onAnswer={onAnswer} />)
        : <RequirementsView matched={data.matched_requirements || []} missing={data.unsupported_requirements || []} />}
      {model && model.promises.length > 0 && (
        <div className={s.promises} data-testid="fit-promises">
          <p className={s.gLabel}>What the posting promises</p>
          <ul className={s.plain}>{model.promises.map((p) => <li key={p.id}>“{p.text}”</li>)}</ul>
        </div>
      )}
    </>
  )
  // the free step: the five rows that matter most, then one tap for the rest (and one for the questions)
  const top = model ? (topRows(model, 5) as Row[]) : []
  const quoted = new Set<string>()
  const lead = (
    <>
      {gatesBlock}
      {model && top.length > 0 && !open && (
        <div className={s.group} data-group="top">
          <p className={s.gHead}><span className={s.gLabel}>What matters most</span></p>
          <ul className={s.list}>{top.map((r) => <StatementRow key={r.id} r={r} quoted={quoted} />)}</ul>
        </div>
      )}
      {model && asks.length > 0 && !open && onAnswer && (
        asking
          ? <Group g={{ key: 'ask', rows: asks }} answers={answers} onAnswer={onAnswer} />
          : <button type="button" className={s.more} onClick={() => setAsking(true)} data-testid="fit-ask-open">
              {answered ? `You answered ${answered} of ${asks.length} questions only you can answer — review` : `Answer ${asks.length} question${asks.length === 1 ? '' : 's'} only you can answer (lifting, hours, eligibility)`}
            </button>
      )}
      {model && open && everything}
      {model && (
        <button type="button" className={s.more} aria-expanded={open} onClick={() => setOpen((x) => !x)} data-testid="fit-show-all">
          {open ? 'Show what matters most' : `Show all ${model.total} lines the posting asks for`}
        </button>
      )}
      {!model && everything}
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
      {compact || brief
        ? <details className={s.disclose}><summary>{model ? `Every line the posting asks for (${model.total})` : 'What the posting asks for'}</summary>{gatesBlock}{everything}</details>
        : lead}
    </section>
  )
}

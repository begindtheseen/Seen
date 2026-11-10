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

interface Row { id: string; text: string; state: State; preferred: boolean; line: string; lineIsJob?: boolean; missing: string[]; question: string; sameAs?: string; candidate?: { line: string; why: string } | null; byYou?: boolean }
type OnAnswer = (id: string, a: Answer | null, line?: string) => void

function YesNo({ onYes, onNo, onSkip }: { onYes: () => void; onNo: () => void; onSkip?: () => void }) {
  return (
    <div className={s.answers} role="group" aria-label="Your answer">
      <button type="button" className={s.ans} onClick={onYes} data-testid="fit-ans-yes">Yes</button>
      <button type="button" className={s.ans} onClick={onNo} data-testid="fit-ans-no">No</button>
      {onSkip && <button type="button" className={s.ans} onClick={onSkip} data-testid="fit-ans-skip">Skip</button>}
    </div>
  )
}

function StatementRow({ r, answer, onAnswer, quoted, dense = false }: { r: Row; answer?: Answer; onAnswer?: OnAnswer; quoted?: Set<string>; dense?: boolean }) {
  // in a partial list a "same line as … above" reference can point at a row that is not on screen: quote it instead
  const ref = r.sameAs && (!quoted || quoted.has(r.line.toLowerCase())) ? r.sameAs : ''
  if (quoted && r.line) quoted.add(r.line.toLowerCase())
  // The row says what the SERVER decided. An answer changes it only when the server sends the row back `by: 'you'`;
  // until then a Yes leaves the question standing (the screen never claims what the server did not accept). A No on a
  // close line takes the question away: the row is then a plain "not on your résumé".
  const askCandidate = !!r.candidate && !r.byYou && answer !== 'no'
  return (
    <li className={dense ? s.dense : s.row} data-state={r.state} data-testid="fit-row">
      {!dense && <StateMark state={r.state} />}
      <p className={s.text}>{dense && <><StateMark state={r.state} />{' '}</>}{r.state === 'ask' ? r.question : r.text}{r.preferred && r.state !== 'ask' ? <span className={s.tag}> · preferred</span> : null}</p>
      {r.byYou && (
        <p className={s.said} data-testid="fit-said">
          <span>{r.candidate ? `You said this line shows it: “${clip(r.candidate.line, 160)}”` : r.state === 'ask' || !r.line ? `You said yes to: “${r.text}”` : 'You said this shows it.'}</span>
          {onAnswer && <button type="button" className={s.change} onClick={() => onAnswer(r.id, null)}>Change</button>}
        </p>
      )}
      {r.line && !ref && <p className={dense ? `${s.quote} ${s.clamp}` : s.quote}>{r.lineIsJob ? 'On your résumé' : 'Your line'}: “{clip(r.line, 200)}”</p>}
      {r.line && ref && <p className={s.quote}>Shown by the same {r.lineIsJob ? 'job' : 'line'} as “{clip(ref, 60)}” above.</p>}
      {r.state === 'partly' && r.missing.map((m, i) => <p key={i} className={s.note}>{m}</p>)}
      {r.state === 'partly' && !r.missing.length && <p className={s.note}>{partlySentence(r)}</p>}
      {askCandidate && (
        <div className={s.candidate} data-testid="fit-candidate">
          <p className={s.quote}>Closest line we found: “{clip(r.candidate!.line, 200)}”{onAnswer ? '. Does this show it?' : '.'}</p>
          {r.candidate!.why && <p className={s.note}>{r.candidate!.why}</p>}
          {onAnswer && <YesNo onYes={() => onAnswer(r.id, 'yes', r.candidate!.line)} onNo={() => onAnswer(r.id, 'no', r.candidate!.line)} />}
        </div>
      )}
      {r.candidate && !r.byYou && answer === 'no' && (
        <p className={s.note} data-testid="fit-candidate-no">Not on your résumé — you said “{clip(r.candidate.line, 80)}” does not show it.{onAnswer && <> <button type="button" className={s.change} onClick={() => onAnswer(r.id, null)}>Change</button></>}</p>
      )}
      {r.state === 'ask' && !r.byYou && onAnswer && (answer === 'skip'
        ? <p className={s.said}><span>You skipped this one</span><button type="button" className={s.change} onClick={() => onAnswer(r.id, null)}>Change</button></p>
        : <YesNo onYes={() => onAnswer(r.id, 'yes')} onNo={() => onAnswer(r.id, 'no')} onSkip={() => onAnswer(r.id, 'skip')} />)}
    </li>
  )
}

function Group({ g, answers, onAnswer }: { g: { key: string; rows: Row[] }; answers?: Answers; onAnswer?: OnAnswer }) {
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
export default function FitRead({ data, note, compact = false, brief = false, answers, onAnswer }: { data: FitData; note?: string; compact?: boolean; brief?: boolean; answers?: Answers; onAnswer?: OnAnswer }) {
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
  const gateList = (list: typeof gates) => list.length > 0 && (
    <div className={s.group} data-group="gates">
      <p className={s.gHead}><span className={s.gLabel}>What they count</span></p>
      <ul className={s.denseList}>
        {list.map((g, i) => (
          <li key={i} className={s.dense} data-state={g.state} data-testid="fit-gate">
            <p className={s.gateText}><StateMark state={g.state as State} />{' '}{g.text}{g.caps ? <span className={s.tag}> · this decides the application</span> : null}</p>
          </li>
        ))}
      </ul>
    </div>
  )
  const gatesBlock = gateList(gates)
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
  // the first screen says what stands between the person and the job: the gates not met (met ones are under
  // "Show all"), then the rows that matter most — fewer of them when gates already take the room
  const leadGates = gates.filter((g) => g.state !== 'shown')
  const top = model ? (topRows(model, Math.max(3, 5 - leadGates.length), gates.map((g) => g.statementId)) as Row[]) : []
  const quoted = new Set<string>()
  const lead = (
    <>
      {open ? gatesBlock : gateList(leadGates)}
      {model && top.length > 0 && !open && (
        <div className={s.group} data-group="top">
          <p className={s.gHead}><span className={s.gLabel}>What matters most</span></p>
          <ul className={s.denseList}>{top.map((r) => <StatementRow key={r.id} r={r} quoted={quoted} dense />)}</ul>
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

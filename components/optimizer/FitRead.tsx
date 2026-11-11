'use client'

// THE fit read (free): the verdict's band and sentence, the graded gates in plain words, then what matters most —
// the top five requirements (required first; what is not shown or only partly shown before what is), with the
// person's own line as proof. "Show all" opens every line, grouped; questions only the person can answer (lifting,
// hours, eligibility) take a Yes / No / Skip that is kept for this job and sent with the optimize request — the screen
// never writes an answer into the résumé. Every word is the server's (fitRead.js only groups and orders); an
// answer with no `statements` (an older cached response) falls back to the verdict's requirement list.

import { useLayoutEffect, useRef, useState } from 'react'
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

function StatementRow({ r, answer, answerLine, onAnswer, quoted, dense = false, saidBelow = false, rowRef, minH, panel = false }: { panel?: boolean; r: Row; answer?: Answer; answerLine?: string; onAnswer?: OnAnswer; quoted?: Set<string>; dense?: boolean; saidBelow?: boolean; rowRef?: (el: HTMLLIElement | null) => void; minH?: number }) {
  // in a partial list a "same line as … above" reference can point at a row that is not on screen: quote it instead
  const ref = r.sameAs && (!quoted || quoted.has(r.line.toLowerCase())) ? r.sameAs : ''
  if (quoted && r.line) quoted.add(r.line.toLowerCase())
  // The row says what the SERVER decided. An answer changes it only when the server sends the row back `by: 'you'`;
  // until then a Yes leaves the question standing (the screen never claims what the server did not accept). A No on a
  // close line takes the question away: the row is then a plain "not on your résumé".
  // on the first screen (dense) the close-line question is asked in the questions panel below, not inline
  const askCandidate = !!r.candidate && !r.byYou && answer !== 'no' && !dense
  return (
    <li ref={rowRef} style={minH ? { minHeight: minH } : undefined} className={dense ? s.dense : s.row} data-state={r.state} data-testid="fit-row" data-id={r.id} data-panel={panel ? '1' : undefined}>
      {!dense && <StateMark state={r.state} />}
      <p className={s.text}>{dense && <><StateMark state={r.state} />{' '}</>}{r.state === 'ask' ? r.question : r.text}{r.preferred && r.state !== 'ask' ? <span className={s.tag}> · preferred</span> : null}</p>
      {r.byYou && !saidBelow && (
        <p className={s.said} data-testid="fit-said">
          <span>{r.state === 'not_shown' ? `You said no to: “${r.text}”` : (answerLine || r.candidate?.line) ? `You said “${clip(answerLine || r.candidate?.line || '', 160)}” shows it.` : `You said yes to: “${r.text}”`}</span>
          {onAnswer && <button type="button" className={s.change} onClick={() => onAnswer(r.id, null)}>Change</button>}
        </p>
      )}
      {r.line && !ref && !r.byYou && <p className={dense ? `${s.quote} ${s.clamp}` : s.quote}>{r.lineIsJob ? 'On your résumé' : 'Your line'}: “{clip(r.line, 200)}”</p>}
      {r.line && ref && !r.byYou && <p className={s.quote}>Shown by the same {r.lineIsJob ? 'job' : 'line'} as “{clip(ref, 60)}” above.</p>}
      {r.state === 'partly' && r.missing.length > 0 && (dense
        ? <p className={`${s.note} ${s.clamp}`}>{r.missing.map((m, i) => <span key={i} className={s.miss}>{m}</span>)}</p>
        : r.missing.map((m, i) => <p key={i} className={s.note}>{m}</p>))}
      {r.state === 'partly' && !r.missing.length && <p className={s.note}>{partlySentence(r)}</p>}
      {askCandidate && (
        <div className={s.candidate} data-testid="fit-candidate">
          <p className={dense ? `${s.quote} ${s.clamp}` : s.quote}>Closest line we found: “{clip(r.candidate!.line, 200)}”{onAnswer ? '. Does this show it?' : '.'}</p>
          {r.candidate!.why && !dense && <p className={s.note}>{r.candidate!.why}</p>}
          {onAnswer && <YesNo onYes={() => onAnswer(r.id, 'yes', r.candidate!.line)} onNo={() => onAnswer(r.id, 'no', r.candidate!.line)} />}
        </div>
      )}
      {!r.byYou && answer === 'no' && (r.candidate || answerLine) && (
        <p className={s.note} data-testid="fit-candidate-no">Not on your résumé — you said “{clip((r.candidate?.line || answerLine || ''), 80)}” does not show it.{onAnswer && <> <button type="button" className={s.change} onClick={() => onAnswer(r.id, null)}>Change</button></>}</p>
      )}
      {r.state === 'ask' && !r.byYou && onAnswer && (answer === 'skip'
        ? <p className={s.said}><span>You skipped this one</span><button type="button" className={s.change} onClick={() => onAnswer(r.id, null)}>Change</button></p>
        : <YesNo onYes={() => onAnswer(r.id, 'yes')} onNo={() => onAnswer(r.id, 'no')} onSkip={() => onAnswer(r.id, 'skip')} />)}
    </li>
  )
}

function Group({ g, answers, answerLines, onAnswer }: { g: { key: string; rows: Row[] }; answers?: Answers; answerLines?: Record<string, string>; onAnswer?: OnAnswer }) {
  const [all, setAll] = useState(false)
  const lim = LIMIT[g.key] || 6
  const rows = all ? g.rows : g.rows.slice(0, lim)
  const h = groupHeading(g)
  return (
    <div className={s.group} data-group={g.key}>
      <p className={s.gHead}><span className={s.gLabel}>{h.label}</span><span className={s.gTally}>{h.tally}</span></p>
      <ul className={s.list}>{rows.map((r) => <StatementRow key={r.id} r={r} answer={answers?.[r.id]} answerLine={answerLines?.[r.id]} onAnswer={onAnswer} />)}</ul>
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
export default function FitRead({ data, note, compact = false, brief = false, answers, answerLines, onAnswer }: { data: FitData; note?: string; compact?: boolean; brief?: boolean; answers?: Answers; answerLines?: Record<string, string>; onAnswer?: OnAnswer }) {
  const [open, setOpen] = useState(false)
  const [asking, setAsking] = useState(false)
  // every row that has been in the questions panel stays there for this visit — answered or not — so an answer never
  // moves a row (or anything above the person's finger) to another part of the screen
  const panelIds = useRef<Set<string>>(new Set())
  const panelOrder = useRef<Map<string, number>>(new Map())
  const frozenTop = useRef<string[] | null>(null)
  // each first-list row keeps at least the height it had before the first answer (its text may get shorter)
  const rowHeights = useRef<Map<string, number>>(new Map())
  // the verdict sentence and the gates above the questions may be re-worded by the server after an answer: their
  // blocks keep at least the height they had, so nothing under the person's finger moves
  const blockHeights = useRef<Map<string, number>>(new Map())
  // scroll anchor: the row the person just answered stays exactly where their finger was, whatever the server re-words
  // above it (the verdict sentence can grow) — measured before the answer, corrected right after the new reading paints
  const anchor = useRef<{ id: string; top: number } | null>(null)
  const sectionRef = useRef<HTMLElement | null>(null)
  const answerWithAnchor: OnAnswer | undefined = onAnswer ? (id, a, line) => {
    const el = sectionRef.current?.querySelector(`[data-testid=fit-row][data-id="${CSS.escape(id)}"][data-panel="1"]`) || sectionRef.current?.querySelector(`[data-testid=fit-row][data-id="${CSS.escape(id)}"]`)
    if (el) anchor.current = { id, top: el.getBoundingClientRect().top }
    onAnswer(id, a, line)
  } : undefined
  useLayoutEffect(() => {
    const a = anchor.current
    if (!a || !sectionRef.current) return
    const el = sectionRef.current.querySelector(`[data-testid=fit-row][data-id="${CSS.escape(a.id)}"][data-panel="1"]`) || sectionRef.current.querySelector(`[data-testid=fit-row][data-id="${CSS.escape(a.id)}"]`)
    if (!el) return
    const delta = el.getBoundingClientRect().top - a.top
    if (Math.abs(delta) < 1) return
    let sc: HTMLElement | null = el.parentElement
    while (sc && !/(auto|scroll)/.test(getComputedStyle(sc).overflowY)) sc = sc.parentElement
    if (sc) sc.scrollTop += delta; else window.scrollBy(0, delta)
  }, [data])
  const v = data.verdict || null
  const diff = differentField(data.field_match || null)
  const model = fitGroups(data)
  const gates = gateRows(data.constraints || [])
  const band = diff ? 'Different field' : (v?.band || (v?.score == null ? 'No score' : ''))
  const sentence = diff ? diff.sentence : verdictSentence(v)
  const askRows = model ? ((model.groups.find((g) => g.key === 'ask') || { rows: [] }).rows as Row[]) : []
  // the questions panel: what only the person can say, and every "Closest line we found — does this show it?"
  const allRows = model ? (model.groups.flatMap((g) => g.rows) as Row[]) : []
  const candRows = allRows.filter((r) => !askRows.includes(r) && ((r.candidate && !r.byYou && answers?.[r.id] !== 'no') || panelIds.current.has(r.id)))
  // a row the server moved out of the ask group after an answer ("You said yes") stays where it was asked
  const keptAsk = allRows.filter((r) => !askRows.includes(r) && !candRows.includes(r) && panelIds.current.has(r.id))
  const asks = [...askRows, ...candRows, ...keptAsk].sort((a, b) => (panelOrder.current.get(a.id) ?? 1e6) - (panelOrder.current.get(b.id) ?? 1e6))
  for (const r of asks) { panelIds.current.add(r.id); if (!panelOrder.current.has(r.id)) panelOrder.current.set(r.id, panelOrder.current.size) }
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
        ? model.groups.map((g) => <Group key={g.key} g={g as { key: string; rows: Row[] }} answers={answers} answerLines={answerLines} onAnswer={answerWithAnchor} />)
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
  // a close-line question takes two rows' room: the first screen holds fewer rows when it carries them
  const firstPass = model ? (topRows(model, Math.max(3, 5 - leadGates.length), gates.map((g) => g.statementId)) as Row[]) : []
  const asking3 = firstPass.filter((r) => r.candidate && !r.byYou).length
  // rows that live in the questions panel are not repeated (or pinned) in the first list
  const computedTop = model && asking3 ? (topRows(model, Math.max(3, 5 - leadGates.length - Math.ceil(asking3 / 2)), gates.map((g) => g.statementId)) as Row[]) : firstPass
  // once the person starts answering, the first list keeps the rows it had: an answer never adds, drops or reorders a
  // row ABOVE the question they are tapping (no layout shift); a fresh visit computes it again
  const answeredAny = Object.keys(answers || {}).length > 0
  if (!answeredAny || !frozenTop.current) frozenTop.current = computedTop.map((r) => r.id)
  const byIdRow = new Map(allRows.map((r) => [r.id, r]))
  const top = answeredAny ? frozenTop.current.map((id) => byIdRow.get(id)).filter((r): r is Row => !!r) : computedTop
  const quoted = new Set<string>()
  const lead = (
    <>
      {(open ? gates.length > 0 : leadGates.length > 0) && (<div ref={(el) => { if (el && !answeredAny) blockHeights.current.set('gates', el.offsetHeight) }} style={answeredAny && blockHeights.current.get('gates') ? { minHeight: blockHeights.current.get('gates') } : undefined}>{open ? gatesBlock : gateList(leadGates)}</div>)}
      {model && top.length > 0 && !open && (
        <div className={s.group} data-group="top">
          <p className={s.gHead}><span className={s.gLabel}>What matters most</span></p>
          <ul className={s.denseList}>{top.map((r) => <StatementRow key={r.id} r={r} quoted={quoted} dense answer={answers?.[r.id]} answerLine={answerLines?.[r.id]} onAnswer={answerWithAnchor} saidBelow={asking && panelIds.current.has(r.id)} rowRef={(el) => { if (el && !answeredAny) rowHeights.current.set(r.id, el.offsetHeight) }} minH={answeredAny ? rowHeights.current.get(r.id) : undefined} />)}</ul>
        </div>
      )}
      {model && asks.length > 0 && !open && onAnswer && (
        asking
          ? <div className={s.group} data-group="questions">
              <p className={s.gHead}><span className={s.gLabel}>Questions only you can answer</span><span className={s.gTally}>{asks.length}</span></p>
              <ul className={s.list}>{asks.map((r) => <StatementRow key={r.id} r={r} answer={answers?.[r.id]} answerLine={answerLines?.[r.id]} onAnswer={answerWithAnchor} panel />)}</ul>
            </div>
          : <button type="button" className={s.more} onClick={() => setAsking(true)} data-testid="fit-ask-open">
              {answered ? `You answered ${answered} of ${asks.length} questions only you can answer — review` : `Answer ${asks.length} question${asks.length === 1 ? '' : 's'} only you can answer${candRows.length ? ' (incl. lines of yours that may show what they ask)' : ' (lifting, hours, eligibility)'}`}
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
    <section ref={sectionRef} className={s.fit} data-testid="fit-read" aria-label="Your fit for this job">
      <div className={s.head} ref={(el) => { if (el && !answeredAny) blockHeights.current.set('head', el.offsetHeight) }} style={answeredAny && blockHeights.current.get('head') ? { minHeight: blockHeights.current.get('head') } : undefined}>
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

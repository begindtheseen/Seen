'use client'

// THE paid result = a finished résumé (director's decision F). Built only from what the paid package returned
// (lib/server/optimizePackage.js / lib/resume/tailor/paid.js): `tailored.doc` (the plan applied), `tailored.changes`
// (every difference, before → after, with the requirement it serves and why), `charge` (what the credit bought,
// or exactly why it was free), `questions` (≤3, by kind), `blocked`. Toggles re-apply in the browser through
// components/optimizer/applyChanges.js — no network, no credit.
//
// Exports:
//  - usePaidVersion(result, key): the person's current version (toggles + answered lines, kept per tab)
//  - PaidResult: the top line, the Changes / Document switch, the change cards, the question cards
//  - BlockedResult: a different field / a failed hard gate — no changes, no questions, no message
//  - PaidOffer + BuildSteps: what a credit will do for THIS job, from the probe's counts

import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from '@/components/ui/Icon'
import Button from '@/components/ui/Button'
import DocPage from '@/components/resume/DocPage'
import { bulletFromAnswer } from '@/lib/resume/engine-client'
import type { ResumeDoc } from '@/lib/resume/types'
import { applyToggles, isToggleable, defaultOn, promptFor, questionKind, blankLine } from './applyChanges.js'
import s from './PaidResult.module.css'

// ── server shapes (lib/resume/tailor/paid.js §1 of reports/t3-paid.md) ──
export interface FormatItem { kind: string; before?: string | string[]; after?: string | string[]; line?: string; from?: string; to?: string; from_section?: string; to_section?: string }
export interface Change {
  id: string; type: string; where?: string; before?: string; after?: string; requirement?: string | null; why?: string
  default?: 'applied' | 'needs_ok'; substantive?: boolean
  moved?: { text: string; from: number; to: number; requirement?: string | null; statement?: string | null }[]
  added?: { term: string; line?: string; requirement?: string | null }[]
  items?: FormatItem[]
}
export interface Charge { charge: boolean; reason: string; sentence: string | null; headline?: string | null; detail?: string | null }
export interface Blocked { reason: string; sentence: string; what_would_change_it?: string[]; carries_over?: { requirement: string; line: string }[] }
export interface Question { id: string; kind: string; question: string; unit?: string; requirement?: string | null; statement?: string | null; answer_kind?: string | null; term?: string; itemId?: string; role?: string; company?: string; template?: string; why?: string; bulletId?: string; line?: string; slot?: string }
export interface Tailored { doc: ResumeDoc; text?: string; changes: Change[]; kept_as_is?: string | null; visibility?: { of: number; before: number; after: number }; charge?: Charge; score_before?: number | null; score_after?: number | null; export_token?: string | null; export_key?: string | null }
export interface ChangeCounts { reorder?: number; summary?: number; skills?: number; rewrites?: number; proposals?: number; questions?: number; availability?: number; formatting?: number }

const SUB_ORDER = ['summary', 'reorder', 'skills', 'rewrite', 'cut', 'heading', 'format']
const KIND_LABEL: Record<string, string> = { summary: 'New summary', reorder: 'Lines moved up', skills: 'Skills', rewrite: 'Reworded', cut: 'Left off for space', heading: 'Heading', format: 'Formatting' }

// ── the person's version: toggles + answered lines, kept for this tab (a reload restores it) ──
type Answered = { id: string; itemId?: string; bulletId?: string; kind?: string; answerKind?: string | null; line: string }
// `key` carries the user id; an empty key (no account) keeps the toggles in memory only — never under a shared key
export function usePaidVersion(t: Tailored | null | undefined, key: string) {
  const store = key ? `seen_paid_v1:${key}` : ''
  const [on, setOn] = useState<Record<string, boolean>>({})
  const [answered, setAnswered] = useState<Answered[]>([])
  const loaded = useRef('')
  useEffect(() => {
    if (!t || loaded.current === store) return
    loaded.current = store
    if (!store) return
    try { const v = JSON.parse(sessionStorage.getItem(store) || 'null'); if (v) { setOn(v.on || {}); setAnswered(v.answered || []) } else { setOn({}); setAnswered([]) } } catch { /* storage unavailable */ }
  }, [t, store])
  useEffect(() => {
    if (!t || !store || loaded.current !== store) return
    try { sessionStorage.setItem(store, JSON.stringify({ on, answered })) } catch { /* storage unavailable */ }
  }, [t, store, on, answered])
  const applied = useMemo(() => (t && t.doc ? applyToggles(t.doc, t.changes || [], on, answered) : null), [t, on, answered])
  return {
    doc: (applied?.doc || null) as ResumeDoc | null,
    marks: applied?.marks || { summary: null, bullets: {}, skills: {}, certs: {} },
    stuck: applied?.stuck || [],
    on, setOn, answered, setAnswered,
    isOn: (c: Change) => on[c.id] ?? defaultOn(c),
  }
}
export type PaidVersion = ReturnType<typeof usePaidVersion>

const q = (t?: string | null, n = 160) => { const x = String(t || '').replace(/\s+/g, ' ').trim(); return x.length > n ? `${x.slice(0, n).replace(/\s+\S*$/, '')}…` : x }
const arr = (v?: string | string[]) => (Array.isArray(v) ? v : v ? [v] : [])

// The re-typesetting, in plain words, one line per kind of change (the server's structured items — never its
// parser prose). Collapsed by default: it is how the document is laid out, not what the credit bought.
const titleCase = (t?: string) => String(t || '').toLowerCase().replace(/(^|\s|\/)([a-z])/g, (m, p1, c) => p1 + c.toUpperCase())
const bare = (t?: string) => q(String(t || '').replace(/^[-•·*]\s*/, ''), 80)
export function formatLines(items: FormatItem[]): { text: string; warn?: boolean }[] {
  const out: { text: string; warn?: boolean }[] = []
  const of = (k: string) => items.filter((x) => x.kind === k)
  for (const x of of('heading_renamed')) out.push({ text: `Your heading “${x.from}” is printed as “${titleCase(x.to)}” — the name applicant systems look for.` })
  const seenMoved = new Set<string>()
  for (const x of of('line_moved')) {
    const k = bare(x.line).toLowerCase(); if (seenMoved.has(k)) continue; seenMoved.add(k)
    if (!x.to_section) continue
    out.push({ text: `“${bare(x.line)}” now sits under ${titleCase(x.to_section)}${x.from_section ? ` (it was under ${titleCase(x.from_section)})` : ''}.` })
  }
  const joined = of('lines_joined').reduce((n, x) => n + arr(x.before).length, 0)
  if (joined) out.push({ text: `${joined === 1 ? 'A line that stood on its own (a date or a place) was' : `${joined} lines that stood on their own (dates, places) were`} joined to the job ${joined === 1 ? 'it belongs' : 'they belong'} to.` })
  const split = of('line_split').length
  if (split) out.push({ text: `${split === 1 ? 'A line that ran two parts together was' : `${split} lines that ran two parts together were`} split where they belong.` })
  const restyled = of('line_restyled').filter((x) => arr(x.before)[0]).length
  if (restyled) out.push({ text: `${restyled === 1 ? 'One line keeps' : `${restyled} lines keep`} the same words with the separators applicant systems read (“|” between title, employer and dates).` })
  for (const x of of('line_restyled').filter((y) => !arr(y.before)[0])) out.push({ text: `“${bare(arr(x.after)[0])}” now sits on a line of its own.` })
  for (const x of of('unplaced')) out.push({ text: `“${bare(x.line)}” could not be placed — check where it sits before you send.`, warn: true })
  return out
}
function FormatCard({ c }: { c: Change }) {
  const lines = formatLines(c.items || [])
  if (!lines.length) return null
  return (
    <li id={`chg-${c.id}`} className={s.card} data-type="format" data-testid="change-card">
      <details className={s.fmtBox}>
        <summary className={s.fmtSum}>Formatting ({lines.length}) — your words are unchanged</summary>
        <ul className={s.fmt}>{lines.map((l, i) => <li key={i} className={l.warn ? s.warnLine : undefined}>{l.warn && <Icon name="triangle-alert" size={14} label="Check" />}{l.text}</li>)}</ul>
      </details>
    </li>
  )
}

function ChangeCard({ c, v, stuck, readOnly = false }: { c: Change; v: PaidVersion; stuck: boolean; readOnly?: boolean }) {
  const toggle = isToggleable(c) && !readOnly
  const on = v.isOn(c)
  const proposal = c.default === 'needs_ok'
  const set = (val: boolean) => v.setOn((o) => ({ ...o, [c.id]: val }))
  const label = c.type === 'skills' ? ((c.added || []).length ? 'Skills added from your own lines' : 'Skills reordered') : proposal ? 'Wording idea — yours to accept' : (KIND_LABEL[c.type] || 'Change')
  return (
    <li id={`chg-${c.id}`} className={s.card} data-on={on ? '1' : '0'} data-type={c.type} data-testid="change-card">
      <div className={s.cardHead}>
        <p className={s.kind}>{label}</p>
        {toggle && !stuck && (
          proposal
            ? <button type="button" className={s.toggle} aria-pressed={on} onClick={() => set(!on)} data-testid="change-toggle">{on ? 'Accepted · undo' : 'Accept this wording'}</button>
            : <button type="button" className={s.toggle} aria-pressed={on} onClick={() => set(!on)} data-testid="change-toggle">{on ? 'Undo' : 'Put it back'}</button>
        )}
      </div>
      {c.where && c.type !== 'format' && c.type !== 'heading' && <p className={s.where}>{c.where}</p>}
      {c.type === 'reorder' && (c.moved || []).length > 0 ? (
        <ul className={s.moves}>
          {(c.moved || []).filter((m) => m.to < m.from).map((m, i) => <li key={i}><span className={s.moveNum}>line {m.from} → {m.to}</span> {m.text}</li>)}
        </ul>
      ) : (
        <div className={s.pair}>
          {c.before ? <p className={s.before}>{c.type === 'cut' ? c.before : c.before}</p> : null}
          {c.after ? <p className={s.after}>{c.after}</p> : null}
        </div>
      )}
      {c.type === 'skills' && (c.added || []).length > 0 && (
        <ul className={s.fmt}>{(c.added || []).map((a, i) => <li key={i}>“{a.term}” — from your line “{q(a.line, 90)}”</li>)}</ul>
      )}
      {c.why && <p className={s.why}>{c.why}</p>}
      {stuck && <p className={s.warnLine}><Icon name="triangle-alert" size={14} label="Note" />This one can&apos;t be switched here — edit it in Résumé Studio.</p>}
      {!on && toggle && !proposal && <p className={s.offNote}>Not in the version you download.</p>}
    </li>
  )
}

const KIND_OF_Q: Record<string, string> = { number: 'A number for one of your lines', tool: 'A tool they name', credential: 'A credential they ask for', duty: 'Work they ask for' }
function QuestionCard({ qn, v }: { qn: Question; v: PaidVersion }) {
  const kind = questionKind(qn)
  const prompt = promptFor(qn)
  const existing = v.answered.find((a) => a.id === qn.id)
  const [answer, setAnswer] = useState('')
  // a number added to the END of a line needs what it counts too ("…WMS (Manhattan), 25." says nothing)
  // a line with two blanks ("Do [number] cycle counts [a shift / a week]") needs the number AND how often
  const slots = (String(qn.template || '').match(/\[[^\]]+\]/g) || []).length
  const bare = kind === 'number' && (qn.slot !== 'insert' || slots > 1) && answer.trim().split(/\s+/).length < 2
  const line = answer.trim() && !bare ? bulletFromAnswer(prompt as Parameters<typeof bulletFromAnswer>[0], answer) : ''
  const add = () => { if (!line) return; v.setAnswered((xs) => [...xs.filter((x) => x.id !== qn.id), { id: qn.id, itemId: qn.itemId, bulletId: qn.bulletId, kind: qn.kind, answerKind: prompt.answerKind, line }]) }
  const remove = () => v.setAnswered((xs) => xs.filter((x) => x.id !== qn.id))
  const where = qn.role ? `${qn.role}${qn.company ? ` · ${qn.company}` : ''}` : ''
  return (
    <li id={`chg-q:${qn.id}`} className={s.card} data-testid="question-card" data-kind={kind} data-slot={qn.slot || undefined}>
      <p className={s.kind}>{KIND_OF_Q[kind]}</p>
      {where && <p className={s.where}>{kind === 'credential' ? 'Goes under Certifications' : where}</p>}
      {existing ? (
        <>
          <p className={s.after}>{existing.line}</p>
          <p className={s.why}>Added to your version{kind === 'number' ? ' in place of the line it completes' : ''}.</p>
          <div><button type="button" className={s.toggle} onClick={remove}>Take it out</button></div>
        </>
      ) : (
        <>
          <label className={s.qLabel}>
            {qn.question}
            {kind === 'credential' ? null : (
              <input autoComplete="off" className={s.input} value={answer} maxLength={kind === 'number' ? 60 : 160}
                // a number slot inside the line ("Do ___ cycle counts") takes digits; a number added to the end of a line
                // takes the number AND what it counts ("about 150 orders a shift")
                inputMode={kind === 'number' && qn.slot === 'insert' && slots < 2 ? 'decimal' : 'text'}
                placeholder={kind === 'number' ? (qn.slot === 'insert' ? (slots > 1 ? 'The number, and how often' : 'The number') : 'The number and what it counts') : kind === 'tool' ? 'Where you used it, and for what' : 'What you did, in your words'}
                onChange={(e) => setAnswer(e.target.value)} data-testid="question-input" />
            )}
          </label>
          {kind === 'number' && qn.template && <p className={s.why}>Your line becomes: “{line || blankLine(qn.template)}”</p>}
          {kind !== 'number' && kind !== 'credential' && line && <p className={s.after}>“{line}”</p>}
          {kind !== 'number' && kind !== 'credential' && answer.trim() && !line && <p className={s.why}>Start with what you did (“Ran…”, “Used…”), in a few words.</p>}
          {kind === 'number' && answer.trim() && !line && <p className={s.why}>{slots > 1 ? 'Give the number and how often — both blanks in the line.' : qn.slot === 'insert' ? 'Type the number itself (digits).' : bare ? 'Add what the number counts, so the line still reads as a sentence.' : 'Include the number itself, in digits.'}</p>}
          {qn.why && <p className={s.why}>{qn.why}</p>}
          <div className={s.qActions}>
            {kind === 'credential'
              ? <button type="button" className={s.toggle} onClick={() => { const l = bulletFromAnswer(prompt as Parameters<typeof bulletFromAnswer>[0], 'yes'); if (l) v.setAnswered((xs) => [...xs, { id: qn.id, kind: qn.kind, answerKind: 'credential', line: l }]) }} data-testid="question-yes">Yes, I hold it — add it</button>
              : <button type="button" className={s.toggle} disabled={!line} onClick={add} data-testid="question-add">Add this line</button>}
          </div>
        </>
      )}
    </li>
  )
}

/** The changes the person can read, accept and undo — most substantive first, the re-typesetting last. */
export function ChangeList({ t, v, readOnly = false }: { t: Tailored; v: PaidVersion; readOnly?: boolean }) {
  const changes = [...(t.changes || [])].sort((a, b) => SUB_ORDER.indexOf(a.type) - SUB_ORDER.indexOf(b.type))
  if (!changes.length) return null
  return <ol className={s.list} data-testid="change-list">{changes.map((c) => c.type === 'format' ? <FormatCard key={c.id} c={c} /> : <ChangeCard key={c.id} c={c} v={v} stuck={!readOnly && v.stuck.includes(c.id)} readOnly={readOnly} />)}</ol>
}

export function QuestionList({ questions, v }: { questions: Question[]; v: PaidVersion }) {
  const qs = (questions || []).slice(0, 3)
  if (!qs.length) return null
  return (
    <section className={s.section} aria-label="Questions only you can answer">
      <h3 className={s.h3}>{qs.length === 1 ? 'One question only you can answer' : `${qs.length} questions only you can answer`}</h3>
      <ol className={s.list}>{qs.map((x) => <QuestionCard key={x.id} qn={x} v={v} />)}</ol>
    </section>
  )
}

/** The top line: what the credit bought (the server's own measure) and the charge truth. */
export function ResultTopLine({ charge, charged, cached, pro, balance, cost }: { charge?: Charge | null; charged?: boolean; cached?: boolean; pro?: boolean | null; balance?: number | null; cost: string }) {
  const truth = cached ? 'Already built for this job — no credit used'
    : charged && pro !== true ? `${cost} used${balance != null ? ` · ${balance} left` : ''}`
    : pro === true && charge?.charge ? 'Included with Pro'
    : 'No credit used'
  return (
    <div className={s.top} data-testid="result-top">
      {charge?.headline
        ? <><p className={`${s.bought} ${s.headline}`} data-testid="result-headline">{charge.headline}</p>{charge.detail && <p className={s.why}>{charge.detail}</p>}</>
        : charge?.sentence && <p className={s.bought}>{charge.sentence}</p>}
      <p className={s.truth}><Icon name={charged && !cached ? 'circle-dollar-sign' : 'circle-check'} size={16} />{truth}</p>
    </div>
  )
}

export function PaidResult({ t, questions, v, defaultView }: { t: Tailored; questions: Question[]; v: PaidVersion; defaultView?: 'changes' | 'document' }) {
  const [view, setView] = useState<'changes' | 'document'>(defaultView || 'changes')
  useEffect(() => { if (!defaultView && typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches) setView('document') }, [defaultView])
  const openChange = (id: string) => {
    setView('changes')
    requestAnimationFrame(() => { const el = document.getElementById(`chg-${id}`); if (el) el.scrollIntoView({ block: 'center' }) })
  }
  const n = (t.changes || []).filter((c) => c.type !== 'format' && c.type !== 'heading').length
  return (
    <div className={s.result}>
      <div className={s.switch} role="group" aria-label="View">
        <button type="button" className={s.seg} aria-pressed={view === 'changes'} onClick={() => setView('changes')} data-testid="view-changes">Changes{n ? ` (${n})` : ''}</button>
        <button type="button" className={s.seg} aria-pressed={view === 'document'} onClick={() => setView('document')} data-testid="view-document">Your résumé</button>
      </div>
      {view === 'changes'
        ? <>
            <ChangeList t={t} v={v} />
            <QuestionList questions={questions} v={v} />
          </>
        : v.doc && <>
            <p className={s.hint}>Lines marked in the margin changed for this job — tap one to see why.</p>
            <DocPage doc={v.doc} marks={v.marks} onMark={openChange} testId="result-doc" />
          </>}
    </div>
  )
}

/** A different field or a failed hard gate: the server's sentence, what carries over, what would change it. */
// "what would change it" is shown only as whole sentences the server wrote — a fragment is left out, never patched
const isSentence = (t: string) => /^[A-Z“"]/.test(t.trim()) && /[.!?]["”]?$/.test(t.trim()) && t.trim().split(/\s+/).length >= 5

export function BlockedResult({ b, jobsHref, showLink = true, fieldHref = '', fieldLabel = '' }: { b: Blocked; jobsHref: string; showLink?: boolean; fieldHref?: string; fieldLabel?: string }) {
  const changes = (b.what_would_change_it || []).filter(isSentence)
  return (
    <section className={s.blocked} data-testid="blocked" aria-label="Why nothing was changed">
      <p className={s.blockedText}>{b.sentence}</p>
      {(b.carries_over || []).length > 0 && (
        <div className={s.section}>
          <p className={s.label}>What carries over from your résumé</p>
          <ul className={s.plain}>{(b.carries_over || []).map((c, i) => <li key={i}><b>{c.requirement}</b> — “{q(c.line, 120)}”</li>)}</ul>
        </div>
      )}
      {changes.length > 0 && (
        <div className={s.section}>
          <p className={s.label}>What would change this</p>
          <ul className={s.plain}>{changes.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </div>
      )}
      {fieldHref && fieldLabel && <a className={s.textLink} href={fieldHref} data-testid="blocked-field-jobs">{fieldLabel}<Icon name="arrow-right" size={14} /></a>}
      {showLink && <a className={s.textLink} href={jobsHref}>Jobs matched to your résumé<Icon name="arrow-right" size={14} /></a>}
    </section>
  )
}

/** "3 changes: a new summary, 2 lines moved up — and 2 questions only you can answer" from the probe's counts. */
export function countsSentence(c: ChangeCounts | null | undefined): string | null {
  if (!c) return null
  const parts: string[] = []
  if (c.summary) parts.push('a new summary')
  if (c.reorder) parts.push(`${c.reorder} line${c.reorder === 1 ? '' : 's'} moved up`)
  if (c.skills) parts.push(c.skills === 1 ? 'your skills reordered' : `${c.skills} skills lists reordered`)
  if (c.rewrites) parts.push(`${c.rewrites} wording change${c.rewrites === 1 ? '' : 's'}`)
  if (c.proposals) parts.push(`${c.proposals} wording idea${c.proposals === 1 ? '' : 's'} for you to accept`)
  const nChanges = (c.summary || 0) + (c.reorder || 0) + (c.skills || 0) + (c.rewrites || 0) + (c.proposals || 0)
  const qs = c.questions ? `${c.questions} question${c.questions === 1 ? '' : 's'} only you can answer` : ''
  if (!nChanges && !qs) return null
  const list = parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
  return nChanges ? `${nChanges} change${nChanges === 1 ? '' : 's'}: ${list}${qs ? ` — and ${qs}` : ''}.` : `No change to your lines — ${qs}.`
}

/** Real steps with the server's real counts; shown as a short reveal of the finished counts (≤ 450 ms in all). */
export function BuildSteps({ steps }: { steps: string[] }) {
  const [shown, setShown] = useState(0)
  useEffect(() => {
    setShown(0)
    if (!steps.length) return
    const reduce = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) { setShown(steps.length); return }
    const step = Math.min(150, Math.floor(450 / steps.length))
    const ts = steps.map((_, i) => setTimeout(() => setShown(i + 1), step * (i + 1)))
    return () => ts.forEach(clearTimeout)
  }, [steps.join('|')]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!steps.length) return null
  return (
    <ol className={s.steps} aria-label="What Seen did" data-testid="build-steps">
      {steps.map((x, i) => <li key={i} data-done={i < shown ? '1' : '0'}><Icon name="check" size={14} />{x}</li>)}
    </ol>
  )
}

/** The offer before paying: from the probe, what a credit does for THIS job — or that it is free, or blocked. */
export function PaidOffer({ probe, price, onPay, fallback }: { probe: { charge?: Charge | null; change_counts?: ChangeCounts | null; blocked?: Blocked | null; cost?: number } | null; price: string; onPay?: () => void; fallback: string }) {
  if (!probe || (!probe.charge && !probe.change_counts)) return <div className={s.offer} data-testid="modal-offer"><p className={s.p}>{fallback}</p></div>
  if (probe.blocked) return null
  const counts = countsSentence(probe.change_counts)
  const free = probe.cost === 0
  return (
    <div className={s.offer} data-testid="modal-offer">
      <h3 className={s.h3}>{free ? 'This one is free' : `For ${price}: your résumé, rebuilt for this job`}</h3>
      {counts && <p className={s.p} data-testid="offer-counts">{counts}</p>}
      {probe.charge?.sentence && <p className={s.why}>{free ? probe.charge.sentence : `What it changes: ${probe.charge.sentence.charAt(0).toLowerCase()}${probe.charge.sentence.slice(1)}`}</p>}
      {onPay ? <Button variant="secondary" onClick={onPay}>Build it</Button> : null}
    </div>
  )
}

/** A version bought with a credit downloads without Seen's footer: the server signs a token for that result
 *  (lib/server/paidExport.js) and the export call must carry it — a free result has none and keeps the footer. */
export type PaidExport = { export_token?: string | null; export_key?: string | null }
export function paidExportFields(t?: PaidExport | null): { exportToken?: string; exportKey?: string } {
  return t && t.export_token && t.export_key ? { exportToken: t.export_token, exportKey: t.export_key } : {}
}

/** Download the person's CURRENT version (accepted changes only) through the Studio export — never the upload. */
export function DownloadVersion({ doc, paid }: { doc: ResumeDoc | null; paid?: PaidExport | null }) {
  const [state, setState] = useState<'idle' | 'busy' | 'failed'>('idle')
  if (!doc) return null
  const name = (() => { const n = String(doc.basics?.name || '').replace(/[^\w .'-]/g, '').trim(); return /^[A-Za-z][\w.'-]*(\s+[A-Za-z][\w.'-]*){1,3}$/.test(n) ? `${n} - Resume` : 'Resume' })()
  async function get(format: 'pdf' | 'docx') {
    setState('busy')
    try {
      const { aiHeaders } = await import('@/lib/aiHeaders')
      const res = await fetch('/api/resume', { method: 'POST', headers: await aiHeaders(), body: JSON.stringify({ action: 'export', doc, format, ...paidExportFields(paid) }) })
      if (!res.ok) { setState('failed'); return }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = `${name}.${format}`
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10000)
      setState('idle')
    } catch { setState('failed') }
  }
  return (
    <div className={s.qActions} data-testid="download-version">
      <Button variant="primary" icon="download" onClick={() => { void get('pdf') }} disabled={state === 'busy'}>{state === 'busy' ? 'Preparing…' : state === 'failed' ? 'Try the download again' : 'Download this version'}</Button>
      <button type="button" className={s.toggle} onClick={() => { void get('docx') }} disabled={state === 'busy'}>Word (.docx)</button>
    </div>
  )
}

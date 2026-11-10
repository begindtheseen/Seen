'use client'

// The ONE verdict, the ONE requirement list and the paid changes — shared by the Optimize sheet, /resume
// and the legacy fit panel (2026-10-24 audits D4/E7/C3; UX audit 2026-11-10 F3/F4/F9/F12).
//  - VerdictCard: a score (or none, with why), a band word, ONE sentence; the hard gate first.
//  - RequirementsView: "You show 6 of 14 requirements this posting states", then two groups — shown on
//    your résumé (rows that share one proof line are one group, quoted once) and not shown — most important
//    first, five each, "Show all N". This replaces the old capped WhyYouMatch + MissingList pair and the
//    sheet's second "Write a bullet for …" card list (one list of what is missing per screen).
//  - PlanChanges: what the credit bought, as ordered changes with before → after and the why.
// Everything the person might copy that they did not write is labelled "add only if true".

import { useState } from 'react'
import Icon from '@/components/ui/Icon'
import { bulletFromAnswer } from '@/lib/resume/engine-client'
// display spelling of canonical skills — the same table the verdict sentence uses
import { displaySkill } from '@/lib/optimizer/explainScore.js'
import { requirementCounts, groupByProof, countHeadline } from '@/lib/requirementList.js'
import { bandTone } from './fitRead.js'
import s from './Verdict.module.css'

export interface Verdict {
  score: number | null
  band: string | null
  sentence: string
  gate: string | null
  withheld: string | null
  requirement_count: number
}
export interface RequirementRow {
  requirement: string
  surface: string
  importance: string
  matched: boolean
  via: string
  inferred?: boolean
  evidence: string | null
  soft?: boolean
  hard?: boolean
}
export interface ConstraintRow { kind: string; label: string; status: 'met' | 'unmet' | 'ask'; gate: boolean; message: string; conflict?: boolean }
export interface RewriteProposal { bulletId: string; from: string; to: string; rules: string[] }
export interface ReorderProposal { itemId: string; role: string; company: string; text: string; from: number; to: number; why: string }
export interface NumberQuestion { id: string; question: string; unit: string; template: string; roles: { itemId: string; title: string; company: string }[] }
export interface PaidPlan {
  rewrite_plan?: RewriteProposal[]
  reorder?: ReorderProposal[]
  questions?: NumberQuestion[]
  availability?: { text: string; why: string; conflict: string | null } | null
  summary?: { text: string; replaces: string; why: string; kept?: boolean } | null
  application_message?: string
}

// display spelling (P&L, SQL…), first letter up so a row reads as a label ("Customer service")
const show = (x: string): string => { const d = displaySkill(x); return /^[a-z]/.test(d) ? d[0].toUpperCase() + d.slice(1) : d }
// tone from the server's band word (fitBand), never a client threshold
const tone = (band: string | null | undefined): 'good' | 'caution' | undefined => bandTone(band) as 'good' | 'caution' | undefined

/** Score ring (or a dash) + band word + the one sentence; the hard gate is the first line. */
export function VerdictCard({ verdict, title = 'Fit', note, cached }: { verdict: Verdict; title?: string; note?: string; cached?: boolean }) {
  const sc = verdict.score
  // the sentence starts with the number; show it once, in the ring
  const why = verdict.sentence.replace(/^\d+ — /, '')
  return (
    <div data-testid="verdict" className={s.verdict}>
      {verdict.gate && (
        <p data-testid="verdict-gate" className={s.gate}><Icon name="triangle-alert" size={16} /><span>{verdict.gate}</span></p>
      )}
      <div className={s.vTop}>
        <div aria-label={sc == null ? 'No score' : `Score ${sc} of 100`} className={s.ring} data-tone={tone(verdict.band)}>{sc == null ? '–' : sc}</div>
        <div className={s.vText}>
          <div className={s.band}>{verdict.band || 'No score'}</div>
          <div className={s.vMeta}>{title}{note ? ` · ${note}` : ''}{cached ? ' · already built, no credit used' : ''}</div>
        </div>
      </div>
      <p className={s.sentence}>{verdict.withheld ? verdict.sentence : why}</p>
    </div>
  )
}

/** The verdict as one line (the paid result leads with the work, not a second copy of the free card). */
export function VerdictStrip({ verdict, total, extra }: { verdict: Verdict; total: number; extra?: string }) {
  const sc = verdict.score
  return (
    <p className={s.strip} data-testid="verdict-strip">
      <span>Fit <b>{sc == null ? 'no score' : sc}</b>{[verdict.band, total > 0 ? `${total} requirement${total === 1 ? '' : 's'} read` : '', extra || ''].filter(Boolean).map((x) => ` · ${x}`).join('')}</span>
    </p>
  )
}

function ShowAll({ n, open, onToggle, what }: { n: number; open: boolean; onToggle: () => void; what: string }) {
  return <button type="button" className={s.more} aria-expanded={open} onClick={onToggle}>{open ? 'Show fewer' : `Show all ${n} ${what}`}</button>
}

/**
 * THE requirement list. Counts say what they count and add up to the rows below them.
 * @param limit rows (or proof groups) shown per group before "Show all N"
 */
export function RequirementsView({ matched, missing, limit = 5, heading = true }: { matched: RequirementRow[]; missing: RequirementRow[]; limit?: number; heading?: boolean }) {
  const c = requirementCounts({ matched, missing })
  const groups = groupByProof(c.shown)
  const [allShown, setAllShown] = useState(false)
  const [allMissing, setAllMissing] = useState(false)
  if (!c.total) return null
  const g = allShown ? groups : groups.slice(0, limit)
  const m = allMissing ? c.missing : c.missing.slice(0, limit)
  return (
    <section className={s.section} data-testid="requirements" aria-label="What the posting asks for">
      {heading && <h3 className={s.h3}>{countHeadline(c)}</h3>}
      {c.shown.length > 0 && (
        <div className={s.group}>
          <p className={s.eyebrow}>Shown on your résumé ({c.shown.length})</p>
          <ul className={s.list}>
            {g.map((grp, i) => (
              <li key={i} className={s.item}>
                <Icon name="circle-check" size={16} className={s.good} label="Shown" />
                <div className={s.itemBody}>
                  {grp.rows.length === 1
                    ? <div className={s.req}>{show(grp.rows[0].surface)}{grp.rows[0].inferred ? <span className={s.tag}> · from related work, no line says it</span> : grp.rows[0].via === 'related' ? <span className={s.tag}> · related experience</span> : null}</div>
                    : <div className={s.reqs}>{grp.rows.map((r) => <span key={r.surface} className={s.reqTag}>{show(r.surface)}</span>)}</div>}
                  {grp.line && <p className={s.quote}>“{grp.line.length > 180 ? `${grp.line.slice(0, 180).replace(/\s+\S*$/, '')}…` : grp.line}”</p>}
                </div>
              </li>
            ))}
          </ul>
          {groups.length > limit && <ShowAll n={c.shown.length} what="shown" open={allShown} onToggle={() => setAllShown((v) => !v)} />}
        </div>
      )}
      {c.missing.length > 0 && (
        <div className={s.group}>
          <p className={s.eyebrow}>Not shown on your résumé ({c.missing.length}) — add only if true</p>
          <ul className={s.list}>
            {m.map((r) => (
              <li key={r.surface} className={s.item}>
                <Icon name="triangle-alert" size={16} className={s.caution} label="Not shown" />
                <div className={s.itemBody}>
                  <div className={s.req}>{show(r.surface)}<span className={s.tag}>{r.importance === 'preferred' ? ' · preferred' : r.hard ? ' · required' : ''}</span></div>
                </div>
              </li>
            ))}
          </ul>
          {c.missing.length > limit && <ShowAll n={c.missing.length} what="not shown" open={allMissing} onToggle={() => setAllMissing((v) => !v)} />}
        </div>
      )}
    </section>
  )
}

/** Legacy pair kept for the old fit panel — both now render the one list's halves. */
export function WhyYouMatch({ matched, limit = 6 }: { matched: RequirementRow[]; limit?: number }) {
  return <RequirementsView matched={matched} missing={[]} limit={limit} heading={false} />
}
export function MissingList({ missing, limit = 8 }: { missing: RequirementRow[]; limit?: number }) {
  return <RequirementsView matched={[]} missing={missing} limit={limit} heading={false} />
}

/** Screens the résumé cannot answer (availability, lifting, a licence): yes/no for the person. */
export function Checklist({ constraints }: { constraints: ConstraintRow[] }) {
  const rows = (constraints || []).filter((c) => c.status === 'ask' || (c.status === 'unmet' && !c.gate))
  if (!rows.length) return null
  return (
    <section className={s.section} aria-label="This job also screens on">
      <h3 className={s.h3}>This job also screens on</h3>
      <ul className={s.list}>
        {rows.slice(0, 8).map((c, i) => (
          <li key={i} className={s.check} data-conflict={c.conflict ? '1' : undefined}>
            <Icon name={c.conflict ? 'triangle-alert' : 'circle'} size={16} label={c.conflict ? 'Conflict' : undefined} /><span>{c.message}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function CopyBtn({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false)
  return (
    <button type="button" className={s.copy} data-done={done ? '1' : undefined}
      onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500) } catch { /* ignore */ } }}>
      {done ? 'Copied' : label}
    </button>
  )
}

/** One number question → the person's answer → a bullet written by the SAME composer the Studio uses. */
function QuestionChange({ q, onAnswer }: { q: NumberQuestion; onAnswer?: (id: string, bullet: string) => void }) {
  const [answer, setAnswer] = useState('')
  const bullet = answer.trim() ? bulletFromAnswer({ unit: q.unit } as Parameters<typeof bulletFromAnswer>[0], answer) : ''
  const role = q.roles?.[0]
  return (
    <li className={s.change}>
      <p className={s.kind}>{!/your number/i.test(q.template) ? 'Answer to add a line — only if it’s true' : 'Add a number — only one you can defend'}</p>
      {role && <p className={s.where}>For {role.title}{role.company ? ` · ${role.company}` : ''}</p>}
      <label className={s.qLabel}>
        {q.question}
        <input autoComplete="off" className={s.input} value={answer} inputMode="text" placeholder={/your number/i.test(q.template) ? 'e.g. 200' : 'Your answer, in your words'} maxLength={60}
          onChange={(e) => { setAnswer(e.target.value); const b = e.target.value.trim() ? bulletFromAnswer({ unit: q.unit } as Parameters<typeof bulletFromAnswer>[0], e.target.value) : ''; onAnswer?.(q.id, b) }} />
      </label>
      {bullet
        ? <div className={s.row}><p className={s.after}>“{bullet}”</p><CopyBtn text={bullet} /></div>
        : <p className={s.why}>Your answer becomes: “{q.template}”</p>}
    </li>
  )
}

/** How many changes the plan holds (what the header counts). */
export function planChangeCount(plan: PaidPlan): number {
  return (plan.reorder || []).length + (plan.rewrite_plan || []).length + (plan.questions || []).length
    + (plan.availability ? 1 : 0) + (plan.summary && !plan.summary.kept ? 1 : 0)
}

/** The paid work as ordered changes: before → after, where, and why. */
export function PlanChanges({ plan, onAnswer }: { plan: PaidPlan; onAnswer?: (id: string, bullet: string) => void }) {
  const reorder = plan.reorder || []
  const rewrites = plan.rewrite_plan || []
  const questions = plan.questions || []
  return (
    <ol className={s.list} data-testid="plan-changes">
      {reorder.map((r, i) => (
        <li key={`m${i}`} className={s.change}>
          <p className={s.kind}>Move up — no words change</p>
          <p className={s.where}>{r.role}{r.company ? ` · ${r.company}` : ''} · line {r.from} → {r.to || 1}</p>
          <p className={s.after}>{r.text}</p>
          {r.why && <p className={s.why}>Why: {r.why}</p>}
        </li>
      ))}
      {plan.summary && !plan.summary.kept && (
        <li className={s.change}>
          <p className={s.kind}>New summary — from your own facts</p>
          <div className={s.row}><p className={s.after}>{plan.summary.text}</p><CopyBtn text={plan.summary.text} /></div>
          {plan.summary.replaces && (
            <details className={s.details}><summary>Your current summary</summary><p className={s.before}>{plan.summary.replaces}</p></details>
          )}
        </li>
      )}
      {rewrites.map((r, i) => (
        <li key={`r${i}`} className={s.change}>
          <p className={s.kind}>Reword — use it only if it reads right to you</p>
          <p className={s.before}>{r.from}</p>
          <div className={s.row}><p className={s.after}>{r.to}</p><CopyBtn text={r.to} /></div>
        </li>
      ))}
      {questions.map((q) => <QuestionChange key={q.id} q={q} onAnswer={onAnswer} />)}
      {plan.availability && (
        <li className={s.change}>
          <p className={s.kind}>Availability line — add only if true</p>
          {plan.availability.conflict && <p className={s.conflict}><Icon name="triangle-alert" size={14} label="Conflict" />{plan.availability.conflict}</p>}
          <div className={s.row}><p className={s.after}>{plan.availability.text}</p><CopyBtn text={plan.availability.text} /></div>
          <p className={s.why}>From this posting&apos;s schedule — edit it to what you can actually work.</p>
        </li>
      )}
    </ol>
  )
}

/** Legacy name: the /resume Rewrite tab renders the same changes. */
export function PaidPlanView({ plan }: { plan: PaidPlan }) {
  return <PlanChanges plan={plan} />
}

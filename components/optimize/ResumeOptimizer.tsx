'use client'

// Seen's résumé optimizer (v3) — ONE flow for every place a résumé is optimized for a job.
//
//   1. Read (free): how the résumé reads for this job — what it already proves, what it does not,
//      honest gaps — and up to 6 short questions whose answers would make a line stronger.
//   2. Write (1 credit, Pro free): rewrites built only from the résumé and the answers, each one
//      checked by Seen (grammar and tense, every number and name traced, no new claims, no word swaps).
//   3. Review: every change before → after with why; keep or skip each; nothing is applied silently.
//   4. Done: the updated résumé, ready to copy, download or save.
//
// What people keep and skip is recorded (facts only) so Seen learns which changes people use.

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  diagnoseResume, rewriteResume, recordDecisions, applyAccepted, isOptimizeError,
  type OptimizeDiagnosis, type OptimizeResult, type OptimizeInput, type OptimizeError,
} from '@/lib/optimizeClient'
import s from './ResumeOptimizer.module.css'

type Phase = 'reading' | 'questions' | 'writing' | 'review' | 'done' | 'error'

export interface ResumeOptimizerProps extends OptimizeInput {
  /** Price line for the write step, e.g. "1 credit" — rendered from the credit rules by the caller. */
  priceLabel: string
  isPro?: boolean
  /** Ask before spending (the caller's credit-confirm dialog). Resolve false to stay on the questions. */
  confirmSpend?: () => Promise<boolean>
  /** Out of credits / signed out / Pro needed. */
  onNeedCredits?: (e: OptimizeError) => void
  /** The updated résumé text, when the person applies their kept changes. */
  onApply?: (text: string) => void | Promise<void>
  applyLabel?: string
  onClose?: () => void
}

const STRENGTH: Record<string, { label: string; tone: 'good' | 'ok' | 'gap' }> = {
  strong: { label: 'Shown in a bullet', tone: 'good' },
  weak: { label: 'Shown, could be clearer', tone: 'ok' },
  stated: { label: 'Listed, not shown', tone: 'ok' },
  implied: { label: 'Your titles show it', tone: 'ok' },
  none: { label: 'Not on your résumé', tone: 'gap' },
}

export default function ResumeOptimizer(props: ResumeOptimizerProps) {
  const { resume, job, company, jobDescription, jobId, priceLabel, isPro, confirmSpend, onNeedCredits, onApply, applyLabel = 'Use this résumé', onClose } = props
  const input = useMemo(() => ({ resume, job, company, jobDescription, jobId }), [resume, job, company, jobDescription, jobId])
  const [phase, setPhase] = useState<Phase>('reading')
  const [error, setError] = useState<string>('')
  const [diag, setDiag] = useState<OptimizeDiagnosis | null>(null)
  const [key, setKey] = useState('')
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [result, setResult] = useState<OptimizeResult | null>(null)
  const [kept, setKept] = useState<Set<string>>(new Set())
  const [keepSummary, setKeepSummary] = useState(true)
  const [finalText, setFinalText] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [copied, setCopied] = useState(false)
  const started = useRef(false)

  // 1. Read
  useEffect(() => {
    if (started.current) return
    started.current = true
    ;(async () => {
      const r = await diagnoseResume(input)
      if (isOptimizeError(r)) return fail(r)
      setDiag(r.diagnosis)
      setKey(r.key)
      setPhase('questions')
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // a visible clock while Seen writes and checks (one server call; no invented progress steps)
  useEffect(() => {
    if (phase !== 'writing' && phase !== 'reading') return
    setElapsed(0)
    const t0 = Date.now()
    const id = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 1000)
    return () => clearInterval(id)
  }, [phase])

  function fail(e: OptimizeError) {
    if (e.credits_required || e.pro_required || e.status === 401 || e.status === 402) { onNeedCredits?.(e); }
    setError(e.message || (e.error === 'no_requirements'
      ? "This listing doesn't list its requirements, so there's nothing to optimize against. Nothing was charged."
      : e.error === 'RESUME_CORRUPTED' ? "Seen couldn't read your résumé text. Upload it again and try once more."
      : e.status === 429 ? "You've hit this hour's limit. Try again in a little while — nothing was charged."
      : 'Something went wrong — nothing was charged. Try again in a minute.'))
    setPhase('error')
  }

  // 2. Write
  async function write() {
    if (confirmSpend && !isPro && !(await confirmSpend())) return
    setPhase('writing')
    const list = Object.entries(answers).map(([id, answer]) => ({ id, answer: answer.trim() })).filter((a) => a.answer)
    let r = await rewriteResume(input, list)
    if (isOptimizeError(r) && r.error === 'diagnose_first') {
      // the reading expired (7 days) — read again, then write
      const d = await diagnoseResume(input)
      if (isOptimizeError(d)) return fail(d)
      setDiag(d.diagnosis); setKey(d.key)
      r = await rewriteResume(input, list)
    }
    if (isOptimizeError(r)) return fail(r)
    setResult(r)
    setKept(new Set(r.proposals.map((p) => p.id)))
    setKeepSummary(!!r.summary)
    setPhase('review')
    try { window.dispatchEvent(new Event('seen:credits-updated')) } catch { /* no window */ }
  }

  // 3 → 4. Apply what they kept
  async function finish() {
    if (!result) return
    const text = applyAccepted(resume, result.proposals, kept, result.summary, keepSummary)
    setFinalText(text)
    const accepted = [...kept, ...(result.summary && keepSummary ? ['summary'] : [])]
    const rejected = [...result.proposals.filter((p) => !kept.has(p.id)).map((p) => p.id), ...(result.summary && !keepSummary ? ['summary'] : [])]
    recordDecisions(result.key || key, accepted, rejected)
    setPhase('done')
  }

  const toggle = (id: string) => setKept((k) => { const n = new Set(k); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const answeredCount = Object.values(answers).filter((a) => a.trim()).length

  return (
    <div className={s.root}>
      <header className={s.head}>
        <p className={s.kicker}>Résumé for this job</p>
        <h2 className={s.title}>{job}{company ? <span className={s.at}> at {company}</span> : null}</h2>
        <Steps phase={phase} />
      </header>

      {phase === 'reading' && (
        <Busy line="Reading the posting and your résumé" sub={`Seen maps what the job asks for to what your résumé shows. ${elapsed}s`} />
      )}

      {phase === 'error' && (
        <div className={s.block}>
          <p className={s.errorText} role="alert">{error}</p>
          {onClose && <button type="button" className={s.secondary} onClick={onClose}>Close</button>}
        </div>
      )}

      {phase === 'questions' && diag && (
        <>
          {diag.target && <p className={s.lede}>{diag.target}</p>}
          <section className={s.block} aria-labelledby="opt-req">
            <h3 id="opt-req" className={s.h3}>What this job asks for</h3>
            <ul className={s.reqs}>
              {diag.requirements.map((r) => {
                const st = STRENGTH[r.strength] || STRENGTH.none
                return (
                  <li key={r.label} className={s.req}>
                    <span className={s.reqLabel}>{r.label}</span>
                    <span className={`${s.chip} ${s[st.tone]}`}>{st.label}</span>
                  </li>
                )
              })}
            </ul>
          </section>

          {diag.resume_check?.length > 0 && (
            <section className={`${s.block} ${s.warn}`}>
              <h3 className={s.h3}>Fix before you send it</h3>
              <ul className={s.plain}>{diag.resume_check.map((c) => <li key={c.line}><strong>{c.line}</strong> — {c.note}</li>)}</ul>
            </section>
          )}

          {diag.questions.length > 0 ? (
            <section className={s.block} aria-labelledby="opt-q">
              <h3 id="opt-q" className={s.h3}>A few questions first</h3>
              <p className={s.note}>Seen only writes what is true. Answer what you can — skip anything you're unsure of, and Seen leaves it out.</p>
              <ol className={s.questions}>
                {diag.questions.map((q) => (
                  <li key={q.id} className={s.question}>
                    <label htmlFor={`opt-${q.id}`} className={s.ask}>{q.ask}</label>
                    {q.why && <p className={s.why}>{q.why}</p>}
                    {q.choices.length > 0 && (
                      <div className={s.choices} role="group" aria-label="Quick answers">
                        {q.choices.map((c) => (
                          <button key={c} type="button" className={`${s.choice} ${answers[q.id] === c ? s.choiceOn : ''}`} aria-pressed={answers[q.id] === c}
                            onClick={() => setAnswers((a) => ({ ...a, [q.id]: a[q.id] === c ? '' : c }))}>{c}</button>
                        ))}
                      </div>
                    )}
                    <input id={`opt-${q.id}`} className={s.input} value={answers[q.id] || ''} maxLength={300} placeholder="Your answer, in your words (optional)"
                      onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))} />
                  </li>
                ))}
              </ol>
            </section>
          ) : (
            <p className={s.note}>Seen has what it needs from your résumé — no questions this time.</p>
          )}

          {diag.gaps.length > 0 && (
            <section className={s.block} aria-labelledby="opt-gaps">
              <h3 id="opt-gaps" className={s.h3}>What your résumé can&apos;t show</h3>
              <p className={s.note}>Seen won&apos;t write these in. Here&apos;s how to handle each one honestly.</p>
              <ul className={s.gaps}>{diag.gaps.map((g) => <li key={g.label}><strong>{g.label}</strong><span>{g.advice}</span></li>)}</ul>
            </section>
          )}

          <div className={s.actions}>
            <button type="button" className={s.primary} onClick={write}>
              Write my changes · {isPro ? 'included with Pro' : priceLabel}
            </button>
            <p className={s.fine}>{answeredCount ? `Uses your ${answeredCount} answer${answeredCount > 1 ? 's' : ''}. ` : ''}Every line is checked against your résumé before you see it. You choose what to keep.</p>
          </div>
        </>
      )}

      {phase === 'writing' && (
        <Busy line="Writing and checking your changes" sub={`Each line is checked for tense, grammar and facts against your résumé${answeredCount ? ' and answers' : ''}. Usually about a minute — ${elapsed}s`} />
      )}

      {phase === 'review' && result && (
        <>
          <p className={s.lede}>
            {result.proposals.length
              ? `${result.proposals.length} change${result.proposals.length > 1 ? 's' : ''} for this job. Keep what sounds like you.`
              : 'Your bullets already say what they can for this job — Seen found no honest change worth making.'}
            {result.cached ? ' (Reopened — no credit used.)' : result.charged ? '' : ' No credit used.'}
          </p>

          {result.summary && (
            <section className={s.block}>
              <div className={s.changeHead}><h3 className={s.h3}>Summary</h3>
                <Keep on={keepSummary} onClick={() => setKeepSummary((v) => !v)} />
              </div>
              <p className={`${s.after} ${keepSummary ? '' : s.skipped}`}>{result.summary.text}</p>
            </section>
          )}

          {result.proposals.length > 0 && (
            <section className={s.block} aria-label="Bullet changes">
              <ul className={s.changes}>
                {result.proposals.map((p) => (
                  <li key={p.id} className={`${s.change} ${kept.has(p.id) ? '' : s.skipped}`}>
                    <div className={s.changeHead}>
                      <span className={s.why}>{p.why}</span>
                      <Keep on={kept.has(p.id)} onClick={() => toggle(p.id)} />
                    </div>
                    <p className={s.before}><span className={s.tag}>Now</span>{p.before}</p>
                    {(p.merged_text || []).map((m) => <p key={m} className={s.before}><span className={s.tag}>Merged in</span>{m}</p>)}
                    <p className={s.after}><span className={s.tag}>New</span>{p.after}</p>
                    {p.used_answers.length > 0 && <p className={s.fine}>Uses your answer{p.used_answers.length > 1 ? 's' : ''}.</p>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {(result.order.length > 0 || result.cut.length > 0 || result.skills.length > 0) && (
            <section className={s.block}>
              <h3 className={s.h3}>Also worth doing</h3>
              <ul className={s.plain}>
                {result.order.length > 0 && <li>Move these up — they matter most for this job: {result.order.map((id) => lineOf(diag, result, id)).filter(Boolean).map((t) => `“${short(t)}”`).join(', ')}</li>}
                {result.cut.map((c) => <li key={c.id}>Consider cutting “{short(lineOf(diag, result, c.id))}” — {c.why}</li>)}
                {result.skills.length > 0 && <li>Skills to list (all on your résumé or in your answers): {result.skills.join(', ')}</li>}
              </ul>
            </section>
          )}

          {result.refused.length > 0 && (
            <details className={s.block}>
              <summary className={s.disclose}>What Seen refused to suggest ({result.refused.length})</summary>
              <ul className={s.plain}>{result.refused.map((r) => <li key={r.id + r.text}><span className={s.struck}>{r.text}</span> — {r.reason}</li>)}</ul>
            </details>
          )}

          <div className={s.actions}>
            <button type="button" className={s.primary} onClick={finish} disabled={!kept.size && !(result.summary && keepSummary)}>
              {kept.size || (result.summary && keepSummary) ? `Apply ${kept.size + (result.summary && keepSummary ? 1 : 0)} change${kept.size + (result.summary && keepSummary ? 1 : 0) === 1 ? '' : 's'}` : 'Keep at least one change'}
            </button>
            {onClose && <button type="button" className={s.secondary} onClick={onClose}>Not now</button>}
          </div>
        </>
      )}

      {phase === 'done' && (
        <>
          <p className={s.lede}>Your résumé for this job. Read it once in your own voice before you send it.</p>
          <pre className={s.resume} aria-label="Updated résumé">{finalText}</pre>
          <div className={s.actions}>
            {onApply && <button type="button" className={s.primary} onClick={() => onApply(finalText)}>{applyLabel}</button>}
            <button type="button" className={s.secondary} onClick={async () => { try { await navigator.clipboard.writeText(finalText); setCopied(true); setTimeout(() => setCopied(false), 1800) } catch { /* clipboard blocked */ } }}>
              {copied ? 'Copied' : 'Copy text'}
            </button>
            <button type="button" className={s.secondary} onClick={() => setPhase('review')}>Back to changes</button>
          </div>
        </>
      )}
    </div>
  )
}

function lineOf(diag: OptimizeDiagnosis | null, result: OptimizeResult, id: string): string {
  return result.proposals.find((x) => x.id === id)?.before || diag?.bullets.find((b) => b.id === id)?.text || ''
}
const short = (t: string) => (t.length > 70 ? `${t.slice(0, t.lastIndexOf(' ', 68))}…` : t)

function Keep({ on, onClick }: { on: boolean; onClick: () => void }) {
  return <button type="button" className={`${s.keep} ${on ? s.keepOn : ''}`} aria-pressed={on} onClick={onClick}>{on ? '✓ Keep' : 'Skip'}</button>
}

function Busy({ line, sub }: { line: string; sub: string }) {
  return (
    <div className={s.busy} role="status" aria-live="polite">
      <span className={s.spinner} aria-hidden="true" />
      <div><p className={s.busyLine}>{line}</p><p className={s.note}>{sub}</p></div>
    </div>
  )
}

function Steps({ phase }: { phase: Phase }) {
  const order: Phase[] = ['reading', 'questions', 'writing', 'review', 'done']
  const names = ['Read', 'Ask', 'Write', 'Review', 'Done']
  const at = Math.max(0, order.indexOf(phase === 'error' ? 'reading' : phase))
  return (
    <ol className={s.steps} aria-label="Steps">
      {names.map((n, i) => <li key={n} className={i < at ? s.stepDone : i === at ? s.stepNow : ''} aria-current={i === at ? 'step' : undefined}>{n}</li>)}
    </ol>
  )
}

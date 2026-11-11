'use client'

// The person's Yes / No on what only they can say and on "Closest line we found" — the same contract everywhere
// (x-integration "Confirmations" + "Claims": `confirmed: [{ statementId, answer: 'yes'|'no', line?, claim? }]` in; statements an answer
// changed come back `by: 'you'`). Stored per user and job under `seen_confirm_v1:<uid>:<jobKey>` (swept on sign-out,
// lib/sessionLocalKeys.js); with no account nothing is stored. The caller re-asks the server with `confirmedOf(next)`
// and renders what comes back — a row never flips on the screen's say-so.
import { useEffect, useMemo, useState } from 'react'
import type { Answer, Answers } from './FitRead'

export type Confirmed = { statementId: string; answer: 'yes' | 'no'; line?: string; claim?: true }
export type Stored = { answers: Answers; lines: Record<string, string> }

/** The stored answers as the server reads them. A claim ("I've done this") is `{ answer: 'yes', claim: true }`, "That's
 * right" on a partly line `{ answer: 'no', claim: true }` — neither ever carries a line; Skip is never sent. */
export function confirmedOf(st: Stored): Confirmed[] {
  const out: Confirmed[] = []
  for (const [statementId, a] of Object.entries(st.answers)) {
    if (a === 'claim') out.push({ statementId, answer: 'yes', claim: true })
    else if (a === 'settle') out.push({ statementId, answer: 'no', claim: true })
    else if (a === 'yes' || a === 'no') out.push({ statementId, answer: a, ...(st.lines[statementId] ? { line: st.lines[statementId] } : {}) })
  }
  return out
}
/** One answer recorded on a stored set (a claim or "That's right" never keeps a line; clearing an answer drops its line). */
export function withAnswer(st: Stored, id: string, a: Answer | null, line?: string): Stored {
  const n: Stored = { answers: { ...st.answers }, lines: { ...st.lines } }
  if (a) n.answers[id] = a; else delete n.answers[id]
  if (a && line && a !== 'claim' && a !== 'settle') n.lines[id] = line; else if (!a || a === 'claim' || a === 'settle') delete n.lines[id]
  return n
}

export function useConfirmations(userId: string | null | undefined, jobKey: string | null | undefined) {
  const key = userId && jobKey ? `seen_confirm_v1:${userId}:${jobKey}` : ''
  const read = (): Stored => {
    if (!key) return { answers: {}, lines: {} }
    try { const v = JSON.parse(localStorage.getItem(key) || '{}'); return v && v.answers ? { answers: v.answers, lines: v.lines || {} } : { answers: v || {}, lines: {} } } catch { return { answers: {}, lines: {} } }
  }
  const [stored, setStored] = useState<Stored>({ answers: {}, lines: {} })
  // a different job or account reads its own answers (never the last job's)
  useEffect(() => { setStored(read()) }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  const confirmed = useMemo(() => confirmedOf(stored), [stored])
  /** Record an answer; returns the `confirmed` list to send with the re-ask (skip is never sent). */
  const answer = (id: string, a: Answer | null, line?: string): Confirmed[] => {
    const n = withAnswer(stored, id, a, line)
    setStored(n)
    if (key) { try { localStorage.setItem(key, JSON.stringify(n)) } catch { /* storage unavailable */ } }
    return confirmedOf(n)
  }
  return { answers: stored.answers, lines: stored.lines, confirmed, answer }
}

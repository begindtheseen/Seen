'use client'

// The person's Yes / No on what only they can say and on "Closest line we found" — the same contract everywhere
// (x-integration "Confirmations": `confirmed: [{ statementId, answer: 'yes'|'no', line? }]` in; statements an answer
// changed come back `by: 'you'`). Stored per user and job under `seen_confirm_v1:<uid>:<jobKey>` (swept on sign-out,
// lib/sessionLocalKeys.js); with no account nothing is stored. The caller re-asks the server with `confirmedOf(next)`
// and renders what comes back — a row never flips on the screen's say-so.
import { useEffect, useMemo, useState } from 'react'
import type { Answer, Answers } from './FitRead'

export type Confirmed = { statementId: string; answer: 'yes' | 'no'; line?: string }
type Stored = { answers: Answers; lines: Record<string, string> }

export function confirmedOf(st: Stored): Confirmed[] {
  return Object.entries(st.answers).filter(([, a]) => a === 'yes' || a === 'no').map(([statementId, answer]) => ({ statementId, answer: answer as 'yes' | 'no', ...(st.lines[statementId] ? { line: st.lines[statementId] } : {}) }))
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
    const n: Stored = { answers: { ...stored.answers }, lines: { ...stored.lines } }
    if (a) n.answers[id] = a; else delete n.answers[id]
    if (a && line) n.lines[id] = line; else if (!a) delete n.lines[id]
    setStored(n)
    if (key) { try { localStorage.setItem(key, JSON.stringify(n)) } catch { /* storage unavailable */ } }
    return confirmedOf(n)
  }
  return { answers: stored.answers, lines: stored.lines, confirmed, answer }
}

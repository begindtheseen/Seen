'use client'

// The browser side of /api/optimize (Seen's résumé optimizer v3). One client for every surface that
// optimizes a résumé for a job, so they all show the same diagnosis, ask the same questions and
// ship the same checked lines.

import { aiHeaders } from './aiHeaders'

export interface OptimizeQuestion {
  id: string
  bullet: string | null
  ask: string
  why: string
  kind: string
  choices: string[]
}
export interface OptimizeRequirement {
  label: string
  evidence: string[]
  /** strong / weak: a bullet shows it · stated: summary or skills say it · implied: a past title shows it · none */
  strength: 'strong' | 'weak' | 'stated' | 'implied' | 'none'
  note?: string
}
export interface OptimizeBulletPlan { id: string; level: number; action: 'keep' | 'rewrite' | 'cut' | 'move_up'; why: string; text: string }
export interface OptimizeGap { label: string; advice: string }
export interface OptimizeDiagnosis {
  target: string
  bullets: OptimizeBulletPlan[]
  requirements: OptimizeRequirement[]
  questions: OptimizeQuestion[]
  gaps: OptimizeGap[]
  constraints: { kind: string; label: string; status: string; message: string }[]
  fit: { score: number; band: string; sentence: string } | null
  resume_check: { line: string; note: string }[]
  model: boolean
}
export interface OptimizeProposal {
  id: string
  job: string
  before: string
  after: string
  why: string
  uses: string[]
  used_answers: string[]
  checks: string[]
  merges?: string[]
  merged_text?: string[]
  repaired?: boolean
  /** a new bullet from the person's answer, inserted after insert_after */
  add?: boolean
  insert_after?: string
  repeated_lead?: boolean
}
export interface OptimizeResult {
  ok: true
  key: string
  cached: boolean
  charged: boolean
  pro?: boolean
  balance?: number
  proposals: OptimizeProposal[]
  summary: { text: string } | null
  skills: string[]
  order: string[]
  cut: { id: string; why: string }[]
  gaps: OptimizeGap[]
  requirements: OptimizeRequirement[]
  rejected_count: number
  repaired: number
  refused: { id: string; text: string; reason: string }[]
}
export interface OptimizeError {
  ok: false
  status: number
  error: string
  message?: string
  credits_required?: boolean
  pro_required?: boolean
  balance?: number
}
export interface OptimizeInput {
  resume: string
  job: string
  company: string
  jobDescription: string
  jobId?: string
}

async function post<T>(body: object): Promise<T | OptimizeError> {
  try {
    const r = await fetch('/api/optimize', { method: 'POST', headers: await aiHeaders(), body: JSON.stringify(body) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) return { ok: false, status: r.status, error: String(j.error || 'error'), message: j.message, credits_required: j.credits_required, pro_required: j.pro_required, balance: j.balance }
    return j as T
  } catch {
    return { ok: false, status: 0, error: 'network', message: 'Could not reach Seen. Check your connection and try again.' }
  }
}

export const isOptimizeError = (x: unknown): x is OptimizeError => !!x && (x as OptimizeError).ok === false

/** Step 1, free: how the résumé reads for this job, and what Seen needs to ask. */
export function diagnoseResume(input: OptimizeInput) {
  return post<{ ok: true; key: string; cached: boolean; diagnosis: OptimizeDiagnosis }>({ action: 'diagnose', ...input })
}

/** Step 2, 1 credit (Pro: free; reopening the same answers is free). */
export function rewriteResume(input: OptimizeInput, answers: { id: string; answer: string }[]) {
  return post<OptimizeResult>({ action: 'rewrite', ...input, answers })
}

/** What the person kept and turned down — facts only, so Seen learns which changes people use. */
export function recordDecisions(key: string, accepted: string[], rejected: string[]) {
  return post<{ ok: true; saved: boolean }>({ action: 'decide', key, accepted, rejected })
}

/**
 * The résumé with the accepted changes: each accepted bullet replaced in place, merged lines removed,
 * the summary replaced when accepted. Same rules as the server's applyProposals.
 */
export function applyAccepted(resume: string, proposals: OptimizeProposal[], accepted: Set<string>, summary: { text: string } | null, summaryAccepted: boolean): string {
  let out = String(resume || '')
  const strip = (l: string) => l.replace(/^[\s•●▪◦*·\-–—]+/, '').trim()
  for (const p of proposals) {
    if (!accepted.has(p.id)) continue
    if (p.add) {
      const lines = out.split('\n')
      const at = lines.findIndex((l) => !!p.insert_after && l.includes(p.insert_after))
      if (at >= 0) { const mark = (lines[at].match(/^\s*[•●▪◦*·\-–—]\s*/) || ['• '])[0]; lines.splice(at + 1, 0, `${mark}${p.after}`); out = lines.join('\n') }
      continue
    }
    const idx = out.indexOf(p.before)
    if (idx >= 0) out = out.slice(0, idx) + p.after + out.slice(idx + p.before.length)
    for (const m of p.merged_text || []) out = out.split('\n').filter((l) => strip(l) !== m).join('\n')
  }
  if (summary && summaryAccepted) {
    const lines = out.split('\n')
    const h = lines.findIndex((l) => /^\s*(summary|professional summary|profile|professional profile|about|about me|objective|career objective)\s*:?\s*$/i.test(l))
    if (h >= 0) {
      let end = h + 1
      while (end < lines.length && lines[end].trim() && !/^[A-Z][A-Z &/]{3,}$/.test(lines[end].trim())) end++
      lines.splice(h + 1, end - (h + 1), summary.text)
      out = lines.join('\n')
    } else {
      // No summary yet: it goes above the first section heading (after the name and contact lines).
      const first = lines.findIndex((l, i) => i > 0 && /^[A-Z][A-Z &/]{3,}$/.test(l.trim()))
      const at = first >= 0 ? first : Math.min(lines.length, 2)
      lines.splice(at, 0, 'SUMMARY', summary.text, '')
      out = lines.join('\n')
    }
  }
  return out
}

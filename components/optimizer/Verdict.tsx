'use client'

// The ONE verdict and the paid plan, shared by the jobs-page Optimize modal and the /resume panel
// (2026-10-24 audits, D4/E7/C3). Every surface shows the same thing: a score (or none, with why),
// a band, ONE sentence, the hard-gate line first; "Why you match" is built from the matched
// requirements with their résumé evidence — never from which bullets happened to be rewritten.
// Everything the person might copy into a résumé that they did not write is labelled
// "add only if true" and stays a proposal.

import { useState } from 'react'
import { bulletFromAnswer } from '@/lib/resume/engine-client'
// display spelling of canonical skills — the same table the verdict sentence uses
import { displaySkill } from '@/lib/optimizer/explainScore.js'

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
  summary?: { text: string; replaces: string; why: string } | null
}

const kicker: React.CSSProperties = { fontFamily: 'var(--mono)', fontSize: 'var(--fs-55)', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--dim)', marginBottom: '.45rem' }
const card: React.CSSProperties = { background: 'var(--card)', border: '1px solid var(--line2)', borderRadius: 10, padding: '.6rem .75rem' }
const amberCard: React.CSSProperties = { background: 'rgba(245,158,11,.06)', border: '1px solid rgba(245,158,11,.22)', borderRadius: 8, padding: '.55rem .75rem' }
const show = (s: string): string => displaySkill(s)

function bandColor(score: number | null): string {
  if (score == null) return 'var(--muted)'
  return score >= 65 ? 'var(--green)' : score >= 45 ? 'var(--amber)' : 'var(--sub)'
}

/** Score circle (or a dash) + band + the one sentence; the hard gate is the first line. */
export function VerdictCard({ verdict, title = 'SeenFit match', note, cached }: { verdict: Verdict; title?: string; note?: string; cached?: boolean }) {
  const s = verdict.score
  // the sentence starts with the number; show it once, in the circle
  const why = verdict.sentence.replace(/^\d+ — /, '')
  return (
    <div data-testid="verdict" style={{ background: 'var(--gdim)', border: '1px solid var(--line)', borderRadius: 12, padding: '.9rem 1rem' }}>
      {verdict.gate && (
        <div data-testid="verdict-gate" style={{ display: 'flex', gap: '.45rem', alignItems: 'flex-start', marginBottom: '.65rem', color: 'var(--amber)', fontSize: 'var(--fs-72)', lineHeight: 1.5, fontWeight: 600 }}>
          <span aria-hidden style={{ flexShrink: 0 }}>⚠</span><span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{verdict.gate}</span>
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: '.85rem' }}>
        <div aria-label={s == null ? 'No score' : `Score ${s} of 100`} style={{ flexShrink: 0, width: 52, height: 52, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', border: `3px solid ${bandColor(s)}` }}>
          <span style={{ fontFamily: 'var(--display)', fontWeight: 800, fontSize: '1.15rem', color: bandColor(s) }}>{s == null ? '–' : s}</span>
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--display)', fontWeight: 800, color: 'var(--white)', fontSize: '.9rem' }}>{verdict.band || 'No score'}{cached ? <span style={{ marginLeft: '.45rem', fontFamily: 'var(--mono)', fontWeight: 400, fontSize: 'var(--fs-55)', color: 'var(--green)' }}>· cached, no credit used</span> : null}</div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-58)', color: 'var(--dim)', lineHeight: 1.5 }}>{title}{note ? ` · ${note}` : ''}</div>
        </div>
      </div>
      <p style={{ margin: '.7rem 0 0', fontSize: 'var(--fs-72)', color: 'var(--sub)', lineHeight: 1.6, overflowWrap: 'anywhere' }}>{verdict.withheld ? verdict.sentence : why}</p>
    </div>
  )
}

/** "Why you match" — every matched requirement with the sentence of the résumé that proves it. */
export function WhyYouMatch({ matched, limit = 6 }: { matched: RequirementRow[]; limit?: number }) {
  const rows = (matched || []).filter((m) => m.matched).sort((a, b) => Number(a.via === 'related') - Number(b.via === 'related')).slice(0, limit)
  if (!rows.length) return null
  return (
    <div>
      <div style={{ ...kicker, color: 'var(--green)' }}>Why you match</div>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '.4rem' }}>
        {rows.map((m, i) => (
          <li key={i} style={{ display: 'flex', gap: '.5rem', fontSize: 'var(--fs-72)', color: 'var(--sub)', lineHeight: 1.5 }}>
            <span style={{ color: 'var(--green)', flexShrink: 0 }}>✓</span>
            <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
              <strong style={{ color: 'var(--white)' }}>{show(m.surface)}</strong>{m.via === 'related' ? ' (related experience)' : ''}
              {m.evidence ? <span style={{ color: 'var(--muted)' }}> — “{m.evidence.replace(/^[•\-*\s]+/, '').slice(0, 140)}{m.evidence.length > 140 ? '…' : ''}”</span> : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** The posting's requirements the résumé does not show (hard ones first). Amber: a to-do, not a failure. */
export function MissingList({ missing, limit = 8 }: { missing: RequirementRow[]; limit?: number }) {
  const rows = (missing || []).filter((m) => !m.matched).sort((a, b) => Number(!!b.hard) - Number(!!a.hard) || Number(a.importance !== 'required') - Number(b.importance !== 'required')).slice(0, limit)
  if (!rows.length) return null
  return (
    <div>
      <div style={{ ...kicker, color: 'var(--amber)' }}>The posting asks for — add only if true</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.3rem' }}>
        {rows.map((m, i) => (
          <span key={i} style={{ background: 'rgba(245,158,11,.08)', border: '1px solid rgba(245,158,11,.28)', color: 'var(--amber)', borderRadius: 5, padding: '.18rem .55rem', fontFamily: 'var(--mono)', fontSize: 'var(--fs-62)', maxWidth: '100%', overflowWrap: 'anywhere' }}>{show(m.surface)}{m.importance === 'preferred' ? ' · preferred' : ''}</span>
        ))}
      </div>
    </div>
  )
}

/** Screens the résumé cannot answer (availability, lifting, a licence): yes/no for the person. */
export function Checklist({ constraints }: { constraints: ConstraintRow[] }) {
  const rows = (constraints || []).filter((c) => c.status === 'ask' || (c.status === 'unmet' && !c.gate))
  if (!rows.length) return null
  return (
    <div>
      <div style={kicker}>This job also screens on</div>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '.3rem' }}>
        {rows.slice(0, 6).map((c, i) => (
          <li key={i} style={{ display: 'flex', gap: '.45rem', fontSize: 'var(--fs-70)', color: c.conflict ? 'var(--amber)' : 'var(--sub)', lineHeight: 1.5 }}>
            <span style={{ flexShrink: 0 }}>{c.conflict ? '⚠' : '☐'}</span><span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{c.message}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function CopyBtn({ text, label = 'copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false)
  return (
    <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500) } catch { /* ignore */ } }}
      style={{ background: 'none', border: '1px solid var(--line2)', borderRadius: 6, padding: '.3rem .55rem', minHeight: 32, fontFamily: 'var(--mono)', fontSize: 'var(--fs-55)', color: done ? 'var(--green)' : 'var(--muted)', cursor: 'pointer', flexShrink: 0 }}>
      {done ? '✓' : label}
    </button>
  )
}

/** One number question → the person's answer → a bullet written by the SAME composer the Studio uses. */
function QuestionRow({ q }: { q: NumberQuestion }) {
  const [answer, setAnswer] = useState('')
  const bullet = answer.trim() ? bulletFromAnswer({ unit: q.unit } as Parameters<typeof bulletFromAnswer>[0], answer) : ''
  return (
    <div style={card}>
      <label style={{ display: 'block', fontSize: 'var(--fs-72)', color: 'var(--white)', lineHeight: 1.5, marginBottom: '.4rem' }}>
        {q.question}
        <input value={answer} onChange={(e) => setAnswer(e.target.value)} inputMode="text" placeholder="e.g. 200" maxLength={60}
          style={{ display: 'block', width: '100%', marginTop: '.35rem', background: 'var(--surface)', border: '1px solid var(--line2)', borderRadius: 7, padding: '.5rem .65rem', color: 'var(--white)', fontSize: '.85rem', boxSizing: 'border-box' }} />
      </label>
      {bullet ? (
        <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}>
          <span style={{ flex: 1, minWidth: 0, fontSize: 'var(--fs-72)', color: 'var(--sub)', overflowWrap: 'anywhere' }}>“{bullet}”</span>
          <CopyBtn text={bullet} />
        </div>
      ) : (
        <div style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-58)', color: 'var(--muted)' }}>Your answer becomes: “{q.template}” — only a number you can defend.</div>
      )}
    </div>
  )
}

/** The paid work: what to move, what to reword (proposals), what to add once you confirm it. */
export function PaidPlanView({ plan }: { plan: PaidPlan }) {
  const reorder = plan.reorder || []
  const rewrites = plan.rewrite_plan || []
  const questions = plan.questions || []
  return (
    <>
      {plan.availability && (
        <div>
          <div style={{ ...kicker, color: 'var(--amber)' }}>Availability line — add only if true</div>
          <div style={amberCard}>
            {plan.availability.conflict && <div style={{ fontSize: 'var(--fs-70)', color: 'var(--amber)', lineHeight: 1.5, marginBottom: '.4rem' }}>⚠ {plan.availability.conflict}</div>}
            <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}>
              <span style={{ flex: 1, minWidth: 0, fontSize: 'var(--fs-72)', color: 'var(--white)', overflowWrap: 'anywhere' }}>{plan.availability.text}</span>
              <CopyBtn text={plan.availability.text} />
            </div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-58)', color: 'var(--muted)', marginTop: '.35rem', lineHeight: 1.5 }}>{plan.availability.why}</div>
          </div>
        </div>
      )}
      {reorder.length > 0 && (
        <div>
          <div style={kicker}>Move to the top — no words change</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.4rem' }}>
            {reorder.map((r, i) => (
              <div key={i} style={card}>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-58)', color: 'var(--dim)', marginBottom: '.25rem' }}>{r.role}{r.company ? ` · ${r.company}` : ''} · line {r.from} → 1</div>
                <div style={{ fontSize: 'var(--fs-72)', color: 'var(--white)', lineHeight: 1.55, overflowWrap: 'anywhere' }}>{r.text}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      {questions.length > 0 && (
        <div>
          <div style={{ ...kicker, color: 'var(--amber)' }}>Add a number — your answer writes the bullet</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.45rem' }}>
            {questions.map((q) => <QuestionRow key={q.id} q={q} />)}
          </div>
        </div>
      )}
      {plan.summary && (
        <div>
          <div style={kicker}>Summary for this job</div>
          <div style={card}>
            <div style={{ display: 'flex', gap: '.5rem', alignItems: 'flex-start' }}>
              <span style={{ flex: 1, minWidth: 0, fontSize: 'var(--fs-72)', color: 'var(--white)', lineHeight: 1.6, overflowWrap: 'anywhere' }}>{plan.summary.text}</span>
              <CopyBtn text={plan.summary.text} />
            </div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-58)', color: 'var(--muted)', marginTop: '.35rem' }}>{plan.summary.why}</div>
          </div>
        </div>
      )}
      {rewrites.length > 0 && (
        <div>
          <div style={kicker}>Wording proposals — use only the ones that read right to you</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.45rem' }}>
            {rewrites.map((r, i) => (
              <div key={i} style={{ ...card, padding: 0, overflow: 'hidden' }}>
                <div style={{ padding: '.5rem .75rem', borderBottom: '1px solid var(--line)', fontSize: 'var(--fs-70)', color: 'var(--muted)', overflowWrap: 'anywhere' }}>{r.from}</div>
                <div style={{ padding: '.5rem .75rem', display: 'flex', gap: '.5rem', alignItems: 'center' }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 'var(--fs-72)', color: 'var(--white)', overflowWrap: 'anywhere' }}>{r.to}</span>
                  <CopyBtn text={r.to} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}

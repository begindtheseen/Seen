'use client'

// ApplicationIntelligencePanel — renders the Application Intelligence V2 package returned by
// /api/optimizer action:'optimize' under `application_intelligence` (may be null). Purely
// additive: the caller renders this ONLY when the package is present and keeps the legacy
// SeenFit UI as the fallback. No fabrication — `unsupported` bullets are never shown as usable
// copy; `needs_confirmation` bullets are visually gated and never presented as final copy.

import { useState } from 'react'

// ── V2 package shape (mirrors lib/application-intelligence/index.js pubMatch/pubBullet) ──
export type MatchType = 'exact' | 'adjacent' | 'transferable' | 'weak' | 'missing'

export interface AiMatch {
  requirement: string
  importance: string
  category: string
  matchType: MatchType
  confidence: number
  evidence: string[]
  explanation: string
  missSeverity?: string | null
}
export interface AiBullet {
  id: string
  type: string
  text: string
  evidenceUsed: string[]
  requirementsAddressed: string[]
  matchType: MatchType
  confidence: number
  riskLevel: string
  whySafe: string
  classification: string
  confirmBeforeUsing: string[]
  warnings: string[]
}
export interface AiAts {
  ats_score: number
  exact_coverage?: number
  normalized_coverage?: number
  missing_exact_keywords: string[]
  missing_required_keywords?: string[]
  notes: string[]
  recommendations: string[]
  disclaimer: string
}
export interface AiQuestion {
  id: string
  question: string
  forRequirement: string | null
  unit: string | null
  category: string | null
}
export interface AiInterviewNote { bulletId: string; code: string; severity: string; message: string }
export interface AiSkillRec { skill: string; matchType: MatchType; why: string }

export interface ApplicationIntelligence {
  engine_version?: string
  fit_score: number
  confidence: number
  confidence_label: string
  role_family?: string
  role_family_label: string
  why_you_match: AiMatch[]
  transferable_proof: AiMatch[]
  weak_matches: AiMatch[]
  missing_recoverable: AiMatch[]
  missing_risky: AiMatch[]
  ats: AiAts
  safe_bullets: AiBullet[]
  needs_confirmation: AiBullet[]
  not_recommended: AiBullet[]
  unsupported: AiBullet[]
  summary_recommendation: { text: string } | null
  skills_recommendation: AiSkillRec[]
  application_message: string
  interview_defense: AiInterviewNote[]
  questions_to_improve: AiQuestion[]
}

export interface ConfirmedAnswer { id: string; forRequirement: string | null; unit: string | null; answer: string }

// ── shared style helpers (match the résumé/optimizer design system) ──
const mono = 'var(--mono)'
function scoreColor(s: number): string { return s >= 70 ? 'var(--green)' : s >= 45 ? 'var(--amber)' : 'var(--red)' }
function pct(n: number): string { return `${Math.round((n || 0) * 100)}%` }

function matchColor(t: MatchType): string {
  return t === 'exact' ? 'var(--green)'
    : t === 'adjacent' ? 'var(--green)'
    : t === 'transferable' ? 'var(--blue)'
    : t === 'weak' ? 'var(--amber)'
    : 'var(--red)'
}
function matchLabel(t: MatchType): string {
  return t === 'exact' ? 'Exact'
    : t === 'adjacent' ? 'Adjacent'
    : t === 'transferable' ? 'Transferable'
    : t === 'weak' ? 'Weak'
    : 'Missing'
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div className="ai-card" style={{ marginBottom: '1rem', ...style }}>{children}</div>
}
function kicker(text: string, color = 'var(--dim)') {
  return <div style={{ fontFamily: mono, fontSize: '.58rem', textTransform: 'uppercase', letterSpacing: '.08em', color, marginBottom: '.6rem' }}>{text}</div>
}
function tag(t: MatchType) {
  const c = matchColor(t)
  return <span style={{ flexShrink: 0, fontFamily: mono, fontSize: '.5rem', textTransform: 'uppercase', letterSpacing: '.06em', color: c, border: `1px solid ${c}`, borderRadius: 4, padding: '.08rem .32rem', opacity: .9 }}>{matchLabel(t)}</span>
}

// A single requirement/match row — requirement + match tag + explanation + first evidence line.
function MatchRow({ m }: { m: AiMatch }) {
  const c = matchColor(m.matchType)
  return (
    <li style={{ display: 'flex', flexDirection: 'column', gap: '.25rem', background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 8, padding: '.6rem .75rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
        <span style={{ fontSize: '.76rem', color: 'var(--white)', fontWeight: 600, minWidth: 0, overflowWrap: 'anywhere', flex: 1 }}>{m.requirement}</span>
        {tag(m.matchType)}
      </div>
      {m.explanation && <div style={{ fontFamily: mono, fontSize: '.62rem', color: 'var(--sub)', lineHeight: 1.55, overflowWrap: 'anywhere' }}>{m.explanation}</div>}
      {m.evidence && m.evidence.length > 0 && (
        <div style={{ fontFamily: mono, fontSize: '.58rem', color: c, lineHeight: 1.5, overflowWrap: 'anywhere' }}>▸ {m.evidence[0].slice(0, 140)}</div>
      )}
      {m.importance && <div style={{ fontFamily: mono, fontSize: '.52rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em' }}>{m.importance}{m.missSeverity ? ` · ${m.missSeverity}` : ''}</div>}
    </li>
  )
}

function MatchSection({ title, color, items }: { title: string; color: string; items: AiMatch[] }) {
  if (!items?.length) return null
  return (
    <Card>
      {kicker(title, color)}
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
        {items.map((m, i) => <MatchRow key={i} m={m} />)}
      </ul>
    </Card>
  )
}

// ── Improve-this-result: answer the engine's questions, re-run with confirmed evidence ──
function ImproveSection({ questions, onAnswers, rerunning }: {
  questions: AiQuestion[]
  onAnswers: (a: ConfirmedAnswer[]) => void
  rerunning?: boolean
}) {
  const [vals, setVals] = useState<Record<string, string>>({})
  if (!questions?.length) return null
  const answered = questions
    .map(q => ({ id: q.id, forRequirement: q.forRequirement, unit: q.unit, answer: (vals[q.id] || '').trim() }))
    .filter(a => a.answer.length > 0)
  return (
    <Card>
      {kicker('Improve this result', 'var(--indigo)')}
      <div style={{ fontFamily: mono, fontSize: '.58rem', color: 'var(--sub)', marginBottom: '.75rem', lineHeight: 1.55 }}>
        Answer any of these with a real number or detail — we fold your confirmed evidence back in and re-score. Nothing is invented from a blank answer.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '.6rem' }}>
        {questions.map(q => (
          <div key={q.id}>
            <label style={{ display: 'block', fontSize: '.72rem', color: 'var(--sub)', lineHeight: 1.5, marginBottom: '.3rem', overflowWrap: 'anywhere' }}>
              {q.question}{q.unit ? <span style={{ color: 'var(--muted)', fontFamily: mono, fontSize: '.58rem' }}> ({q.unit})</span> : null}
            </label>
            <input
              type="text"
              value={vals[q.id] || ''}
              onChange={e => setVals(v => ({ ...v, [q.id]: e.target.value }))}
              placeholder="Your real answer…"
              style={{ width: '100%', background: 'var(--surface)', border: '1.5px solid var(--line2)', borderRadius: 8, padding: '.5rem .75rem', color: 'var(--white)', fontFamily: mono, fontSize: '.7rem', outline: 'none', caretColor: 'var(--indigo)', boxSizing: 'border-box' }}
            />
          </div>
        ))}
      </div>
      <button
        onClick={() => onAnswers(answered)}
        disabled={rerunning || answered.length === 0}
        style={{ marginTop: '.85rem', width: '100%', background: answered.length ? 'linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%)' : 'var(--raised)', color: answered.length ? '#fff' : 'var(--muted)', border: 'none', borderRadius: 8, padding: '.65rem 1rem', fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.78rem', cursor: (rerunning || !answered.length) ? 'not-allowed' : 'pointer', opacity: rerunning ? 0.6 : 1 }}
      >
        {rerunning ? 'Re-scoring…' : answered.length ? `Re-run with ${answered.length} answer${answered.length !== 1 ? 's' : ''} →` : 'Add an answer to re-run'}
      </button>
    </Card>
  )
}

export default function ApplicationIntelligencePanel({
  pkg,
  compact = false,
  onAnswers,
  rerunning,
}: {
  pkg: ApplicationIntelligence
  compact?: boolean
  onAnswers?: (a: ConfirmedAnswer[]) => void
  rerunning?: boolean
}) {
  const [copied, setCopied] = useState<string | null>(null)
  async function copy(text: string, key: string) {
    try { await navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied(null), 1600) } catch { /* ignore */ }
  }

  const ats = pkg.ats

  return (
    <div style={{ animation: 'fadeUp .3s ease both' }}>
      {/* Header — role family + fit + confidence */}
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ flexShrink: 0, width: 60, height: 60, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', border: `3px solid ${scoreColor(pkg.fit_score)}` }}>
            <span style={{ fontFamily: 'var(--display)', fontWeight: 800, fontSize: '1.3rem', color: scoreColor(pkg.fit_score) }}>{pkg.fit_score}</span>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--display)', fontWeight: 800, color: 'var(--white)', fontSize: '.95rem' }}>Deep match analysis</div>
            <div style={{ fontFamily: mono, fontSize: '.6rem', color: 'var(--dim)', marginTop: '.2rem', overflowWrap: 'anywhere' }}>
              {pkg.role_family_label} · {pkg.confidence_label} confidence ({pct(pkg.confidence)})
            </div>
          </div>
        </div>
        {pkg.summary_recommendation?.text && (
          <p style={{ fontFamily: mono, fontSize: '.64rem', color: 'var(--sub)', lineHeight: 1.6, marginTop: '.85rem', overflowWrap: 'anywhere' }}>{pkg.summary_recommendation.text}</p>
        )}
      </Card>

      {/* ATS simulation */}
      {ats && (
        <Card>
          {kicker('ATS simulation')}
          <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', marginBottom: '.7rem' }}>
            <span style={{ fontFamily: 'var(--display)', fontWeight: 800, fontSize: '1.1rem', color: scoreColor(ats.ats_score) }}>{Math.round(ats.ats_score)}<span style={{ fontSize: '.6rem', color: 'var(--muted)' }}>/100</span></span>
            <span style={{ fontFamily: mono, fontSize: '.6rem', color: 'var(--muted)' }}>keyword-match score (simulated)</span>
          </div>
          {ats.missing_exact_keywords?.length > 0 && (
            <>
              <div style={{ fontFamily: mono, fontSize: '.56rem', color: 'var(--amber)', marginBottom: '.4rem', lineHeight: 1.5 }}>Missing exact keywords — add the ones genuinely yours:</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.35rem', marginBottom: ats.recommendations?.length ? '.7rem' : 0 }}>
                {ats.missing_exact_keywords.slice(0, 14).map((k, i) => (
                  <span key={i} style={{ background: 'rgba(245,158,11,.08)', border: '1px solid rgba(245,158,11,.25)', color: 'var(--amber)', borderRadius: 5, padding: '.2rem .55rem', fontFamily: mono, fontSize: '.62rem', maxWidth: '100%', overflowWrap: 'anywhere' }}>{k}</span>
                ))}
              </div>
            </>
          )}
          {ats.recommendations?.length > 0 && (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '.35rem' }}>
              {ats.recommendations.slice(0, 6).map((r, i) => (
                <li key={i} style={{ display: 'flex', gap: '.5rem', fontSize: '.72rem', color: 'var(--sub)', lineHeight: 1.5 }}><span style={{ color: 'var(--blue)', flexShrink: 0, marginTop: '.1rem' }}>›</span><span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{r}</span></li>
              ))}
            </ul>
          )}
          {ats.disclaimer && <div style={{ fontFamily: mono, fontSize: '.52rem', color: 'var(--muted)', marginTop: '.6rem', lineHeight: 1.5, overflowWrap: 'anywhere' }}>{ats.disclaimer}</div>}
        </Card>
      )}

      {/* Match views */}
      <MatchSection title="Why you match" color="var(--green)" items={pkg.why_you_match} />
      <MatchSection title="Transferable proof" color="var(--blue)" items={pkg.transferable_proof} />
      <MatchSection title="Missing but recoverable" color="var(--amber)" items={pkg.missing_recoverable} />
      <MatchSection title="Missing and risky" color="var(--red)" items={pkg.missing_risky} />

      {!compact && (
        <>
          {/* Skills to add (only evidenced) */}
          {pkg.skills_recommendation?.length > 0 && (
            <Card>
              {kicker('Skills worth surfacing', 'var(--green)')}
              <div style={{ fontFamily: mono, fontSize: '.56rem', color: 'var(--muted)', marginBottom: '.6rem', lineHeight: 1.5 }}>Evidenced by your résumé but not in your skills section.</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '.4rem' }}>
                {pkg.skills_recommendation.map((s, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '.5rem', fontSize: '.72rem', color: 'var(--sub)', lineHeight: 1.5 }}>
                    {tag(s.matchType)}<span style={{ minWidth: 0, overflowWrap: 'anywhere' }}><strong style={{ color: 'var(--white)' }}>{s.skill}</strong>{s.why ? ` — ${s.why}` : ''}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Safe to use — copy-ready */}
          {pkg.safe_bullets?.length > 0 && (
            <Card>
              {kicker('Safe to use', 'var(--green)')}
              <div style={{ fontFamily: mono, fontSize: '.56rem', color: 'var(--green)', marginBottom: '.6rem' }}>✓ Fully backed by your résumé — no invented numbers, tools, or claims.</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '.55rem' }}>
                {pkg.safe_bullets.map((b, i) => (
                  <div key={b.id || i} style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 8, padding: '.7rem .85rem' }}>
                    <div style={{ display: 'flex', gap: '.6rem', alignItems: 'flex-start' }}>
                      <span style={{ fontSize: '.76rem', color: 'var(--sub)', lineHeight: 1.6, flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{b.text}</span>
                      <button onClick={() => copy(b.text, `sb${i}`)} style={{ background: 'none', border: '1px solid var(--line2)', borderRadius: 6, padding: '.25rem .5rem', fontFamily: mono, fontSize: '.55rem', color: copied === `sb${i}` ? 'var(--green)' : 'var(--muted)', cursor: 'pointer', flexShrink: 0 }}>{copied === `sb${i}` ? '✓' : 'copy'}</button>
                    </div>
                    {b.whySafe && <div style={{ fontFamily: mono, fontSize: '.54rem', color: 'var(--muted)', marginTop: '.4rem', lineHeight: 1.45, overflowWrap: 'anywhere' }}>{b.whySafe}</div>}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Confirm before using — visually distinct, NOT final copy */}
          {pkg.needs_confirmation?.length > 0 && (
            <Card style={{ border: '1px solid rgba(245,158,11,.28)' }}>
              {kicker('⚠ Confirm before using', 'var(--amber)')}
              <div style={{ fontFamily: mono, fontSize: '.56rem', color: 'var(--amber)', marginBottom: '.6rem', lineHeight: 1.5 }}>Not final copy. Each needs a real detail from you — we will not invent it.</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '.55rem' }}>
                {pkg.needs_confirmation.map((b, i) => (
                  <div key={b.id || i} style={{ background: 'rgba(245,158,11,.06)', border: '1px solid rgba(245,158,11,.2)', borderRadius: 8, padding: '.7rem .85rem' }}>
                    <div style={{ fontSize: '.74rem', color: 'var(--sub)', lineHeight: 1.6, overflowWrap: 'anywhere' }}>{b.text}</div>
                    {(b.confirmBeforeUsing || []).map((c, j) => (
                      <div key={j} style={{ fontFamily: mono, fontSize: '.56rem', color: 'var(--amber)', marginTop: '.35rem', lineHeight: 1.5, overflowWrap: 'anywhere' }}>→ {c}</div>
                    ))}
                    {(b.warnings || []).map((w, j) => (
                      <div key={`w${j}`} style={{ fontFamily: mono, fontSize: '.54rem', color: 'var(--muted)', marginTop: '.3rem', lineHeight: 1.45, overflowWrap: 'anywhere' }}>{w}</div>
                    ))}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Interview defense */}
          {pkg.interview_defense?.length > 0 && (
            <Card>
              {kicker('Interview defense', 'var(--amber)')}
              <div style={{ fontFamily: mono, fontSize: '.56rem', color: 'var(--muted)', marginBottom: '.6rem', lineHeight: 1.5 }}>If you use the flagged phrasing, be ready to back it up in the interview.</div>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '.4rem' }}>
                {pkg.interview_defense.map((n, i) => (
                  <li key={i} style={{ display: 'flex', gap: '.5rem', fontSize: '.72rem', color: n.severity === 'high' ? 'var(--red)' : n.severity === 'medium' ? 'var(--amber)' : 'var(--muted)', lineHeight: 1.5 }}>
                    <span style={{ flexShrink: 0 }}>{n.severity === 'high' ? '✕' : '⚠'}</span><span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{n.message}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {/* Application message */}
          {pkg.application_message && (
            <Card>
              {kicker('Application message')}
              <p style={{ fontSize: '.76rem', color: 'var(--sub)', lineHeight: 1.7, margin: 0, overflowWrap: 'anywhere' }}>{pkg.application_message}</p>
              <button onClick={() => copy(pkg.application_message, 'aimsg')} style={{ marginTop: '.75rem', background: 'var(--green)', color: 'var(--ink)', border: 'none', borderRadius: 7, padding: '.45rem .9rem', fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.7rem', cursor: 'pointer' }}>{copied === 'aimsg' ? '✓ Copied' : 'Copy message'}</button>
            </Card>
          )}

          {/* Improve this result */}
          {onAnswers && <ImproveSection questions={pkg.questions_to_improve} onAnswers={onAnswers} rerunning={rerunning} />}
        </>
      )}
    </div>
  )
}

'use client'

// Canonical MatchAnalysis renderer — the single, simple view over the Resume Intelligence Engine's
// one source of truth. Deliberately NOT an NLP dump: it shows the match score, critical-requirement
// coverage, what the résumé strongly proves, what's transferable/partial, what's genuinely missing
// (with fabrication flags), and the top evidence-backed improvements. Every match carries its
// résumé evidence in a tooltip.

import { useState } from 'react'
import type { MatchAnalysis, Match, Recommendation } from '@/lib/resume-intelligence/engine'

const C = {
  green: 'var(--good-text)', amber: 'var(--caution-text)', red: 'var(--bad-text)', dim: 'var(--dim)', sub: 'var(--sub)',
  white: 'var(--white)', line: 'var(--line2)', raised: 'var(--raised)', mono: 'var(--mono)',
}

function scoreColor(n: number) { return n >= 75 ? C.green : n >= 50 ? C.amber : C.red }

function Bar({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ marginBottom: '.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: C.mono, fontSize: 'var(--fs-meta)', color: C.dim, marginBottom: '.25rem' }}>
        <span>{label}</span><span style={{ color: scoreColor(value) }}>{value}%</span>
      </div>
      <div style={{ height: 5, borderRadius: 4, background: 'rgba(255,255,255,.07)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${Math.max(2, value)}%`, background: scoreColor(value), borderRadius: 4, transition: 'width .5s ease' }} />
      </div>
    </div>
  )
}

function Chip({ m, tone }: { m: Match; tone: 'green' | 'amber' | 'red' }) {
  const [open, setOpen] = useState(false)
  const color = tone === 'green' ? C.green : tone === 'amber' ? C.amber : C.red
  const bg = tone === 'green' ? 'rgba(52,211,153,.12)' : tone === 'amber' ? 'rgba(251,191,36,.12)' : 'rgba(248,113,113,.12)'
  const border = tone === 'green' ? 'rgba(52,211,153,.3)' : tone === 'amber' ? 'rgba(251,191,36,.3)' : 'rgba(248,113,113,.3)'
  return (
    <div style={{ display: 'inline-block', margin: '0 .25rem .25rem 0' }}>
      <button
        onClick={() => setOpen(o => !o)}
        title={m.explanation}
        style={{ background: bg, border: `1px solid ${border}`, borderRadius: 999, padding: '.25rem .5rem', fontFamily: C.mono, fontSize: 'var(--fs-meta)', color, cursor: 'pointer', textTransform: 'capitalize' }}
      >
        {m.requirement}{m.mustNotInvent ? ' ⚠' : ''}
      </button>
      {open && (
        <div style={{ marginTop: '.25rem', maxWidth: 320, background: C.raised, border: `1px solid ${C.line}`, borderRadius: 7, padding: '.5rem .5rem', fontFamily: C.mono, fontSize: 'var(--fs-meta)', color: C.sub, lineHeight: 1.5 }}>
          <div style={{ color: C.white, marginBottom: '.25rem' }}>{m.explanation}</div>
          {m.evidence?.length > 0 && <div style={{ color: C.dim, fontStyle: 'italic' }}>“{m.evidence[0]}”</div>}
          <div style={{ color: C.dim, marginTop: '.25rem' }}>{m.matchType.replace(/_/g, ' ').toLowerCase()} · {Math.round(m.confidence * 100)}% confidence</div>
        </div>
      )}
    </div>
  )
}

function Section({ title, count, color, children }: { title: string; count: number; color: string; children: React.ReactNode }) {
  if (!count) return null
  return (
    <div style={{ marginBottom: '1rem' }}>
      <div style={{ fontFamily: C.mono, fontSize: 'var(--fs-meta)', color: C.dim, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: '.5rem' }}>
        {title} <span style={{ color }}>{count}</span>
      </div>
      <div>{children}</div>
    </div>
  )
}

const recIcon: Record<Recommendation['type'], string> = {
  name_transferable_skill: '↗', surface_buried_skill: '⬆', align_terminology: '≈', add_metric: '#', real_gap: '△',
}

export default function MatchAnalysisPanel({ analysis }: { analysis: MatchAnalysis }) {
  const a = analysis
  const transferable = [...a.transferableMatches, ...a.partialMatches]
  const critical = a.missingRequirements.filter(m => m.missSeverity === 'fatal')

  return (
    <div style={{ animation: 'fadeUp .3s ease both' }}>
      {/* headline */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 92 }}>
          <div style={{ fontFamily: C.mono, fontSize: 'var(--fs-fig-m)', fontWeight: 800, color: scoreColor(a.overallScore), lineHeight: 1 }}>{a.overallScore}</div>
          <div style={{ fontFamily: C.mono, fontSize: 'var(--fs-meta)', color: C.dim, textTransform: 'uppercase', letterSpacing: 1 }}>Match</div>
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontFamily: C.mono, fontSize: 'var(--fs-meta)', color: C.sub, marginBottom: '.125rem' }}>
            Critical requirements met: <span style={{ color: scoreColor(a.criticalRequirementCoverage) }}>{a.criticalRequirementCoverage}%</span>
            {a.job.roleFamilyLabel && <span style={{ color: C.dim }}> · {a.job.roleFamilyLabel}</span>}
          </div>
          <div style={{ fontFamily: C.mono, fontSize: 'var(--fs-meta)', color: C.dim, lineHeight: 1.5 }}>{a.disclaimer}</div>
        </div>
      </div>

      {/* score dimensions */}
      <div style={{ background: C.raised, border: `1px solid ${C.line}`, borderRadius: 9, padding: '.75rem .75rem', marginBottom: '1rem' }}>
        <Bar label="Critical requirement coverage" value={a.criticalRequirementCoverage} />
        <Bar label="Skill alignment" value={a.skillAlignment} />
        <Bar label="Evidence strength" value={a.evidenceStrength} />
        <Bar label="Terminology alignment (ATS keywords)" value={a.terminologyAlignment} />
      </div>

      <Section title="Strong matches" count={a.strongMatches.length} color={C.green}>
        {a.strongMatches.map(m => <Chip key={m.requirement} m={m} tone="green" />)}
      </Section>

      <Section title="Transferable / partial" count={transferable.length} color={C.amber}>
        {transferable.map(m => <Chip key={m.requirement} m={m} tone="amber" />)}
      </Section>

      <Section title="Missing" count={a.missingRequirements.length} color={C.red}>
        {critical.length > 0 && (
          <div style={{ fontFamily: C.mono, fontSize: 'var(--fs-meta)', color: C.red, marginBottom: '.25rem' }}>⚠ = a credential/gate you can’t claim unless you truly hold it.</div>
        )}
        {a.missingRequirements.map(m => <Chip key={m.requirement} m={m} tone="red" />)}
      </Section>

      {/* recommendations */}
      {a.recommendations.length > 0 && (
        <div style={{ marginTop: '.5rem' }}>
          <div style={{ fontFamily: C.mono, fontSize: 'var(--fs-meta)', color: C.dim, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: '.5rem' }}>Top improvements</div>
          {a.recommendations.slice(0, 6).map((r, i) => (
            <div key={i} style={{ display: 'flex', gap: '.5rem', marginBottom: '.5rem', background: C.raised, border: `1px solid ${C.line}`, borderRadius: 7, padding: '.5rem .5rem' }}>
              <span style={{ color: r.priority === 'high' ? C.red : r.priority === 'medium' ? C.amber : C.dim, fontFamily: C.mono, fontSize: 'var(--fs-meta)' }}>{recIcon[r.type] || '•'}</span>
              <div>
                <div style={{ fontFamily: C.mono, fontSize: 'var(--fs-meta)', color: C.white, marginBottom: '.125rem' }}>{r.title}</div>
                <div style={{ fontFamily: C.mono, fontSize: 'var(--fs-meta)', color: C.sub, lineHeight: 1.5 }}>{r.detail}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ fontFamily: C.mono, fontSize: 'var(--fs-meta)', color: C.dim, marginTop: '.5rem', textAlign: 'right' }}>
        Resume Intelligence Engine · {a.semantic_backend === 'neural' ? 'neural + deterministic' : 'deterministic, no external AI'}
      </div>
    </div>
  )
}

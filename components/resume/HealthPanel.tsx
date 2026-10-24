'use client'

// Health panel — the job-independent résumé score (lib/resume/health) with every finding
// anchored to the bullet it is about and one-click fixes. Runs entirely in the browser.

import { useState } from 'react'
import s from './studio.module.css'
import type { Health, HealthFinding, ResumeDoc } from '@/lib/resume/types'

type Props = {
  health: Health
  doc: ResumeDoc
  onJump: (bulletId: string | null, itemId?: string) => void
  onApplyRewrite: (bulletId: string, text: string) => void
  onApplyVerb: (bulletId: string, verb: string) => void
  onFixAll: () => void
  fixAllCount: number
}

const DIM_ORDER = ['impact', 'language', 'structure', 'timeline', 'length', 'ats']
const SEV_ICON: Record<string, string> = { error: '✕', warn: '⚠', info: '◦' }
const SEV_COLOR: Record<string, string> = { error: 'var(--red)', warn: 'var(--amber)', info: 'var(--dim)' }

export function scoreColor(n: number): string { return n >= 85 ? 'var(--green)' : n >= 70 ? 'var(--blue)' : n >= 50 ? 'var(--amber)' : 'var(--red)' }

function bulletText(doc: ResumeDoc, bulletId?: string): string {
  if (!bulletId) return ''
  for (const e of doc.experience) for (const b of e.bullets) if (b.id === bulletId) return b.text
  for (const p of doc.projects) for (const b of p.bullets) if (b.id === bulletId) return b.text
  for (const e of doc.education) for (const b of e.details) if (b.id === bulletId) return b.text
  for (const x of doc.extra) for (const b of x.items) if (b.id === bulletId) return b.text
  return ''
}

function Finding({ f, doc, onJump, onApplyRewrite, onApplyVerb }: { f: HealthFinding; doc: ResumeDoc } & Pick<Props, 'onJump' | 'onApplyRewrite' | 'onApplyVerb'>) {
  const ctx = bulletText(doc, f.anchor.bulletId)
  const fix = f.fix
  return (
    <div className={s.finding}>
      <span className={s.findingIcon} style={{ color: SEV_COLOR[f.severity] }}>{SEV_ICON[f.severity]}</span>
      <div className={s.findingBody}>
        <div className={s.findingMsg}>{f.message}</div>
        {ctx && <div className={s.findingCtx} title={ctx} onClick={() => onJump(f.anchor.bulletId || null, f.anchor.itemId)}>↳ {ctx}</div>}
        {fix && fix.kind === 'rewrite' && fix.text && f.anchor.bulletId && (
          <div className={s.findingActions} style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
            <div className={s.diff}><span className={s.del}>{ctx}</span><br /><span className={s.ins}>{fix.text}</span></div>
            <button type="button" className={s.fixBtn} onClick={() => onApplyRewrite(f.anchor.bulletId!, fix.text!)}>✦ Apply rewrite</button>
          </div>
        )}
        {fix && fix.kind === 'verbs' && (fix.options || fix.verbs || []).length > 0 && f.anchor.bulletId && (
          <div className={s.findingActions}>
            <span className={s.muted} style={{ alignSelf: 'center' }}>Lead with:</span>
            {(fix.options || fix.verbs || []).slice(0, 5).map((v) => <button key={v} type="button" className={`${s.chip} ${s.chipGreen} ${s.chipBtn}`} onClick={() => onApplyVerb(f.anchor.bulletId!, v)}>{v}</button>)}
          </div>
        )}
        {fix && fix.kind === 'prompt' && fix.text && <div className={s.muted} style={{ marginTop: '.3rem' }}>{fix.text}</div>}
      </div>
    </div>
  )
}

export default function HealthPanel({ health, doc, onJump, onApplyRewrite, onApplyVerb, onFixAll, fixAllCount }: Props) {
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const color = scoreColor(health.score)
  const dims = DIM_ORDER.filter((k) => health.dimensions[k]).map((k) => [k, health.dimensions[k]] as const)
  return (
    <div style={{ animation: 'fadeUp .3s ease both' }}>
      <div className={s.card}>
        <div className={s.scoreRow}>
          <div className={s.ring} style={{ borderColor: color }}><span className={s.ringNum} style={{ color }}>{health.score}</span></div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className={s.grade}>Résumé health · {health.grade}</div>
            <div className={s.dim} style={{ marginTop: '.15rem' }}>{health.band} · {health.words} words{health.years != null ? ` · ${health.years} yrs experience` : ''}</div>
          </div>
        </div>
        <p className={s.dim} style={{ marginTop: '.75rem', color: 'var(--sub)', fontSize: '.7rem' }}>{health.summary}</p>
        {fixAllCount > 0 && (
          <div className={s.findingActions} style={{ marginTop: '.6rem' }}>
            <button type="button" className={s.btnGreen} data-testid="fix-all" onClick={onFixAll}>✦ Review {fixAllCount} bullet fix{fixAllCount === 1 ? '' : 'es'}</button>
            <span className={s.muted} style={{ alignSelf: 'center' }}>Verbs, tense, passive voice, filler — shown as before → after first; never a new fact.</span>
          </div>
        )}
      </div>

      <div className={s.card}>
        <div className={s.bars}>
          {dims.map(([k, d]) => (
            <div key={k}>
              <div className={s.barHead}><span>{d.label}</span><span style={{ color: 'var(--white)' }}>{d.score}<span style={{ color: 'var(--muted)' }}>/100 · {d.weight} pts</span></span></div>
              <div className={s.bar}><div className={s.barFill} style={{ width: `${Math.max(2, Math.min(100, d.score))}%`, background: scoreColor(d.score) }} /></div>
            </div>
          ))}
        </div>
      </div>

      {health.findings.length === 0 ? (
        <div className={s.okBox}>✓ Nothing to fix. This résumé is as strong as the engine can make it without new facts from you.</div>
      ) : dims.map(([k, d]) => d.findings.length ? (
        <div key={k} className={s.card}>
          <button type="button" onClick={() => setOpen((o) => ({ ...o, [k]: !(o[k] ?? d.findings.some((f) => f.severity !== 'info')) }))} style={{ background: 'none', border: 'none', padding: 0, width: '100%', textAlign: 'left', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className={s.secTitle} style={{ color: scoreColor(d.score) }}>{d.label} · {d.findings.length}</span>
            <span className={s.muted}>{(open[k] ?? d.findings.some((f) => f.severity !== 'info')) ? '▾' : '▸'}</span>
          </button>
          {(open[k] ?? d.findings.some((f) => f.severity !== 'info')) && (
            <div style={{ marginTop: '.6rem' }}>
              {d.findings.map((f, i) => <Finding key={`${f.code}${f.anchor.bulletId || f.anchor.itemId || i}`} f={f} doc={doc} onJump={onJump} onApplyRewrite={onApplyRewrite} onApplyVerb={onApplyVerb} />)}
            </div>
          )}
        </div>
      ) : null)}
    </div>
  )
}

'use client'

// Tailor panel — a job-targeted VARIANT of the résumé (lib/resume/tailor via /api/resume
// action:'tailor', 1 credit). Shows the plan honestly: score before → after, what moved, the
// composed summary, skills surfaced from the résumé's own words, terminology to mirror, and the
// gaps the résumé does not cover (never papered over). The optional LLM polish is Pro-only.

import { useEffect, useMemo, useState } from 'react'
import s from './studio.module.css'
import { aiHeaders } from '@/lib/aiHeaders'
import type { ResumeDoc, TailorPlan, TailorResponse, PolishResult } from '@/lib/resume/types'
import type { SavedJob } from '@/lib/types'
import { scoreColor } from './HealthPanel'

export interface TailorJob { title: string; company: string; description: string; jobId: string; url?: string }
type Props = {
  doc: ResumeDoc
  isLoggedIn: boolean
  pro: boolean | null
  savedJobs: SavedJob[]
  initialJob: TailorJob | null
  onNeed: (reason: 'credits' | 'pro' | 'signin') => void
  onUseVariant: (variant: ResumeDoc, meta: { role: string; company: string; jobId: string; scoreBefore: number; scoreAfter: number }) => void
}

function clone<T>(v: T): T { return JSON.parse(JSON.stringify(v)) as T }

export default function TailorPanel({ doc, isLoggedIn, pro, savedJobs, initialJob, onNeed, onUseVariant }: Props) {
  const [job, setJob] = useState<TailorJob>(initialJob || { title: '', company: '', description: '', jobId: '' })
  const [savedId, setSavedId] = useState('')
  const [polish, setPolish] = useState(false)
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [error, setError] = useState('')
  const [plan, setPlan] = useState<TailorPlan | null>(null)
  const [variant, setVariant] = useState<ResumeDoc | null>(null)
  const [polishRes, setPolishRes] = useState<PolishResult | null>(null)
  const [useSummary, setUseSummary] = useState(true)
  const [mirror, setMirror] = useState(false)
  const [rejected, setRejected] = useState<Set<string>>(new Set())

  useEffect(() => { if (initialJob) setJob(initialJob) }, [initialJob])

  function pickSaved(id: string) {
    setSavedId(id)
    const sj = savedJobs.find((j) => String(j.job_id) === id)
    if (!sj) return
    const snap = sj.snapshot as { title?: string; company?: string; description?: string; apply_url?: string } | undefined
    setJob({ title: sj.role || snap?.title || '', company: sj.company || snap?.company || '', description: snap?.description || '', jobId: String(sj.job_id), url: sj.apply_url || snap?.apply_url || '' })
  }

  async function run() {
    if (!job.title.trim() && !job.description.trim()) { setError('Add the job title or paste the job description.'); return }
    if (!isLoggedIn) { onNeed('signin'); return }
    setState('loading'); setError('')
    try {
      const res = await fetch('/api/resume', {
        method: 'POST', headers: await aiHeaders(),
        body: JSON.stringify({ action: 'tailor', doc, jobTitle: job.title, company: job.company, jobDescription: job.description, jobId: job.jobId || undefined, polish: polish && pro === true }),
      })
      const data = (await res.json().catch(() => ({}))) as TailorResponse
      if (res.status === 401 || res.status === 402 || data.credits_required || data.pro_required) {
        setState('idle'); onNeed(data.pro_required ? 'pro' : 'credits'); return
      }
      if (!res.ok || !data.plan) { setError(data.error || 'Could not tailor this résumé. Try again.'); setState('error'); return }
      window.dispatchEvent(new Event('seen:credits-updated'))
      setPlan(data.plan); setVariant(data.variant); setPolishRes(data.polish); setRejected(new Set()); setUseSummary(true); setMirror(false)
      setState('done')
    } catch { setError('Network error — try again.'); setState('error') }
  }

  // The variant the user will take: server variant ± summary ± mirrored terminology ± rejected polish.
  const finalVariant = useMemo(() => {
    if (!variant || !plan) return null
    const v = clone(variant)
    if (!useSummary && plan.summary) { v.basics.summary = plan.summary.replaced; v.meta.provenance = v.meta.provenance.filter((p) => p.kind !== 'summary'); if (!v.basics.summary) v.sectionOrder = v.sectionOrder.filter((k) => k !== 'summary') }
    for (const t of plan.terminology) {
      for (const e of v.experience) { const b = e.bullets.find((x) => x.id === t.bulletId); if (b) { if (mirror) { b.text = b.text.replace(t.from, t.to) === b.text ? t.to : b.text.replace(t.from, t.to); v.meta.provenance.push({ kind: 'terminology', bulletId: b.id, from: t.from, to: t.to, reason: `The posting says "${t.term}".` }) } } }
    }
    if (polishRes) for (const ch of polishRes.changes) if (rejected.has(ch.id)) { for (const e of v.experience) { const b = e.bullets.find((x) => x.id === ch.id); if (b) b.text = ch.from } v.meta.provenance = v.meta.provenance.filter((p) => !(p.kind === 'polish' && p.bulletId === ch.id)) }
    return v
  }, [variant, plan, useSummary, mirror, polishRes, rejected])

  const roleOf = (id: string) => doc.experience.find((e) => e.id === id)

  return (
    <div style={{ animation: 'fadeUp .3s ease both' }}>
      <div className={s.card}>
        <div className={s.cardTitle}>Tailor to a job</div>
        <p className={s.dim} style={{ marginBottom: '.75rem' }}>Reorders what you already proved, surfaces skills you wrote but never listed, drafts a summary from your own facts, and names the gaps honestly. Nothing is invented.</p>
        {savedJobs.length > 0 && (
          <div style={{ marginBottom: '.55rem' }}>
            <span className={s.label}>Saved job</span>
            <select className={s.input} value={savedId} onChange={(e) => pickSaved(e.target.value)}>
              <option value="">📌 Choose a saved job…</option>
              {savedJobs.map((j) => <option key={String(j.job_id)} value={String(j.job_id)}>{j.role || 'Role'}{j.company ? ` — ${j.company}` : ''}</option>)}
            </select>
          </div>
        )}
        <div className={s.row}>
          <div><span className={s.label}>Job title</span><input className={s.input} value={job.title} onChange={(e) => setJob({ ...job, title: e.target.value })} placeholder="Commercial Electrician" /></div>
          <div><span className={s.label}>Company</span><input className={s.input} value={job.company} onChange={(e) => setJob({ ...job, company: e.target.value })} placeholder="Desert Sun Mechanical" /></div>
        </div>
        <span className={s.label}>Job description</span>
        <textarea className={`${s.input} ${s.area}`} rows={5} value={job.description} onChange={(e) => setJob({ ...job, description: e.target.value })} placeholder="Paste the posting — requirements, responsibilities, the lot." />
        <div className={s.opts} style={{ marginTop: '.6rem', justifyContent: 'space-between' }}>
          <label className={s.dim} style={{ display: 'flex', alignItems: 'center', gap: '.4rem', cursor: pro ? 'pointer' : 'default' }}>
            <input type="checkbox" checked={polish && pro === true} disabled={pro !== true} onChange={(e) => { if (pro !== true) { onNeed('pro'); return } setPolish(e.target.checked) }} />
            Polish wording with AI {pro === true ? '' : '· Pro'}
          </label>
          <button type="button" className={s.btnPrimary} onClick={run} disabled={state === 'loading'}>
            {state === 'loading' ? 'Tailoring…' : 'Tailor my résumé →'}<span style={{ marginLeft: '.45rem', fontSize: '.55rem', opacity: .7, fontFamily: 'var(--mono)', fontWeight: 400 }}>· 1 credit</span>
          </button>
        </div>
        {error && <div className={s.err} style={{ marginTop: '.6rem', marginBottom: 0 }}>{error}</div>}
      </div>

      {state === 'done' && plan && finalVariant && (
        <>
          <div className={s.card}>
            <div className={s.beforeAfter}>
              <span style={{ color: scoreColor(plan.score.before) }}>{plan.score.before}</span>
              <span className={s.arrow}>→</span>
              <span style={{ color: scoreColor(plan.score.after) }}>{plan.score.after}</span>
              <span className={s.dim} style={{ fontWeight: 400, fontSize: '.62rem' }}>match score · keywords {Math.round(plan.keywords.coverage * 100)}% covered · {plan.job.requirementCount} requirements read</span>
            </div>
            <p className={s.dim} style={{ marginTop: '.5rem' }}>
              {plan.score.after > plan.score.before ? 'The variant scores higher because its wording now matches the posting where your experience already did.' : 'Reordering and surfacing never changes the facts, so the match score only moves when wording is mirrored or a summary is added. The variant is still the stronger read.'}
            </p>
            <div className={s.findingActions} style={{ marginTop: '.7rem' }}>
              <button type="button" className={s.btnGreen} onClick={() => onUseVariant(finalVariant, { role: job.title, company: job.company, jobId: job.jobId, scoreBefore: plan.score.before, scoreAfter: plan.score.after })}>Use this tailored version →</button>
            </div>
          </div>

          {plan.summary && (
            <div className={s.card}>
              <span className={s.secTitle}>Summary · from your own facts</span>
              <p style={{ fontSize: '.8rem', color: 'var(--text)', lineHeight: 1.6, margin: '.5rem 0' }}>{plan.summary.text}</p>
              {plan.summary.replaced && <div className={s.diff} style={{ marginBottom: '.4rem' }}><span className={s.muted}>Replaces: </span><span className={s.del}>{plan.summary.replaced}</span></div>}
              <label className={s.dim} style={{ display: 'flex', gap: '.4rem', alignItems: 'center', cursor: 'pointer' }}><input type="checkbox" checked={useSummary} onChange={(e) => setUseSummary(e.target.checked)} />Use this summary</label>
            </div>
          )}

          {(plan.skills.added.length > 0 || plan.provenance.some((p) => p.kind === 'reorder_bullets')) && (
            <div className={s.card}>
              <span className={s.secTitle}>What moved</span>
              {plan.provenance.filter((p) => p.kind === 'reorder_bullets').map((p, i) => { const r = roleOf(String(p.itemId)); return <div key={i} className={s.dim} style={{ marginTop: '.4rem' }}>↕ {r ? `${r.title || r.company}` : 'A role'}: bullets that evidence the posting now lead.</div> })}
              {plan.skills.added.map((a) => (
                <div key={a.term} style={{ marginTop: '.5rem' }}>
                  <span className={`${s.chip} ${s.chipGreen}`}>+ {a.term}</span>
                  <div className={s.muted} style={{ marginTop: '.2rem' }}>{a.why}{a.evidence ? ` — "${a.evidence.slice(0, 110)}${a.evidence.length > 110 ? '…' : ''}"` : ''}</div>
                </div>
              ))}
            </div>
          )}

          {plan.terminology.length > 0 && (
            <div className={s.card}>
              <span className={s.secTitle}>Mirror the posting’s wording</span>
              <label className={s.dim} style={{ display: 'flex', gap: '.4rem', alignItems: 'center', cursor: 'pointer', margin: '.45rem 0' }}><input type="checkbox" checked={mirror} onChange={(e) => setMirror(e.target.checked)} />Swap your aliases for the exact terms ({plan.terminology.length})</label>
              {plan.terminology.map((t) => <div key={t.bulletId} className={s.diff} style={{ marginTop: '.3rem' }}><span className={s.del}>{t.alias}</span> → <span className={s.ins}>{t.term}</span></div>)}
            </div>
          )}

          {polishRes && (
            <div className={s.card}>
              <span className={s.secTitle}>AI polish {polishRes.available ? `· ${polishRes.changes.length} bullet${polishRes.changes.length === 1 ? '' : 's'}` : ''}</span>
              {!polishRes.available ? (
                <div className={s.dim} style={{ marginTop: '.4rem' }}>{polishRes.reason === 'pro_required' ? 'Polish is a Pro feature.' : 'The AI polish is not available right now — the deterministic tailoring above is complete without it.'}</div>
              ) : polishRes.changes.length === 0 ? (
                <div className={s.dim} style={{ marginTop: '.4rem' }}>No wording changes passed the fabrication check — your bullets were already tight.</div>
              ) : polishRes.changes.map((ch) => (
                <div key={ch.id} style={{ marginTop: '.5rem', borderTop: '1px solid var(--line)', paddingTop: '.5rem' }}>
                  <div className={s.diff}><span className={s.del}>{ch.from}</span><br /><span className={s.ins}>{ch.text}</span></div>
                  <div className={s.findingActions}><button type="button" className={`${s.tiny}${rejected.has(ch.id) ? '' : ` ${s.chipGreen}`}`} onClick={() => setRejected((r) => { const n = new Set(r); if (n.has(ch.id)) n.delete(ch.id); else n.add(ch.id); return n })}>{rejected.has(ch.id) ? 'Rejected — keep original' : '✓ Accepted'}</button>{ch.reason && <span className={s.muted} style={{ alignSelf: 'center' }}>{ch.reason}</span>}</div>
                </div>
              ))}
              {polishRes.rejected.length > 0 && <div className={s.muted} style={{ marginTop: '.4rem' }}>{polishRes.rejected.length} suggestion{polishRes.rejected.length === 1 ? '' : 's'} blocked by the fabrication firewall.</div>}
            </div>
          )}

          {plan.gaps.length > 0 && (
            <div className={s.card}>
              <span className={s.secTitle} style={{ color: 'var(--amber)' }}>Gaps — honest list</span>
              <div style={{ marginTop: '.5rem' }}>
                {plan.gaps.map((g) => (
                  <div key={g.requirement} className={`${s.gap} ${g.severity === 'likely_covered' ? s.gapCovered : g.severity === 'fatal' ? s.gapFatal : s.gapWarn}`}>
                    <strong style={{ color: 'var(--white)' }}>{g.requirement}</strong>{g.level ? <span className={s.muted}> · {g.level}</span> : null}
                    <div className={s.muted} style={{ marginTop: '.15rem', color: 'var(--sub)' }}>{g.explanation}{g.mustNotInvent ? ' Do not add this unless it is true.' : ''}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {plan.strengths.length > 0 && (
            <div className={s.card}>
              <span className={s.secTitle}>Your strongest evidence</span>
              <div style={{ marginTop: '.5rem', display: 'flex', flexDirection: 'column', gap: '.35rem' }}>
                {plan.strengths.slice(0, 6).map((m) => <div key={m.requirement} style={{ fontSize: '.76rem', color: 'var(--sub)', lineHeight: 1.5 }}><span style={{ color: 'var(--green)' }}>✓ </span><strong style={{ color: 'var(--white)' }}>{m.requirement}</strong>{m.evidence ? ` — ${m.evidence.slice(0, 100)}` : ''}</div>)}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

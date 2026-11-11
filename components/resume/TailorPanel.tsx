'use client'

// Tailor panel — the optimizer's plan for ONE application, with every decision visible and
// overridable. The server computes the plan once (1 credit); everything the user changes here
// (keep a role anyway, drop a composed bullet, answer a prompt, switch the layout, keep their own
// summary) is re-applied in the browser with applyTailorPlan — instant, no credit.

import { useEffect, useMemo, useState } from 'react'
import s from './studio.module.css'
import { aiHeaders } from '@/lib/aiHeaders'
import type { ResumeDoc, TailorPlan, TailorResponse, TailorDecision, TailorOverrides } from '@/lib/resume/types'
import type { SavedJob } from '@/lib/types'
import { applyTailorPlan } from '@/lib/resume/engine-client'
import { useAuth } from '@/lib/auth'
import CreditConfirmDialog from '@/components/CreditConfirmDialog'
import { hasConfirmedCreditUse } from '@/lib/creditConfirm'
import { markQuiet } from '@/lib/quietWindow'
import { RESUME_OPTIMIZE_COST, priceLabel } from '@/lib/creditRules'
import { httpHref } from '@/lib/safeHref.js'
import { ResumeDocStore } from '@/lib/stores/ResumeDocStore'
import PostingInput from '@/components/jobs/PostingInput'
import { needsSignIn, outOfCredits } from '@/lib/toolAuth.js'
import FitRead, { type FitData, type Answer } from '@/components/optimizer/FitRead'
import { useConfirmations, type Confirmed } from '@/components/optimizer/useConfirmations'
import { serializeToText } from '@/lib/resume/engine-client'
import { ChangeList, BlockedResult, ResultTopLine, usePaidVersion, QuestionCard, AlreadyRightBlock, type Tailored, type Charge, type Blocked, type AlreadyRight, type Question } from '@/components/optimizer/PaidResult'
import { composeAnswer } from '@/lib/resume/engine-client'
import { creditCostLabel } from '@/lib/creditRules'

const LINES_PER_PAGE = 46
// What the tailor answer carries besides the plan (reports/t3-paid.md §1, `action:'tailor'`): the shared charge
// rule, the blocked verdict, the structured change list — feature-detected (an older stored result has none).
type TailorExtra = { tailored?: Tailored | null; charge?: Charge | null; blocked?: Blocked | null; charged?: boolean; balance?: number; fit?: FitData | null; already_right?: AlreadyRight | null; questions_note?: string | null }
type Layout = 'chronological' | 'relevance' | 'as_written'

export interface TailorJob { title: string; company: string; description: string; jobId: string; url?: string }
type Props = {
  doc: ResumeDoc
  isLoggedIn: boolean
  pro: boolean | null
  savedJobs: SavedJob[]
  initialJob: TailorJob | null
  onNeed: (reason: 'credits' | 'pro' | 'signin') => void
  onUseVariant: (variant: ResumeDoc, meta: { role: string; company: string; jobId: string; scoreBefore: number | null; scoreAfter: number | null; exportToken?: string; exportKey?: string }) => void
}

const TIER_LABEL: Record<string, string> = { core: 'Core', supporting: 'Supporting', context: 'Context', omit: 'Not relevant' }
const TIER_CLASS: Record<string, string> = { core: 'chipGreen', supporting: 'chipBlue', context: 'chipAmber', omit: 'chip' }
const DECISION_LABEL: Record<string, string> = { keep: 'Keep in full', trim: 'Trim to the relevant bullets', condense: 'One line (Additional Experience)', drop: 'Leave off this version' }

function clone<T>(v: T): T { return JSON.parse(JSON.stringify(v)) as T }

// the export token of a credit-bought result travels with the version it bought (an unbought result carries none)
function paidTokenOf(x: TailorExtra): { exportToken?: string; exportKey?: string } {
  const t = (x && x.charged ? x.tailored : null) as unknown as { export_token?: string; export_key?: string } | null
  return t && t.export_token && t.export_key ? { exportToken: t.export_token, exportKey: t.export_key } : {}
}

export default function TailorPanel({ doc, isLoggedIn, pro, savedJobs, initialJob, onNeed, onUseVariant }: Props) {
  const { user } = useAuth()
  const [job, setJob] = useState<TailorJob>(initialJob || { title: '', company: '', description: '', jobId: '' })
  const [previewLink, setPreviewLink] = useState('')
  // The first paid action on this account/device is confirmed once (lib/creditConfirm) — the
  // 2026-10-24 audits found the Tailor charging with no dialog while every other paid button asked.
  const [confirming, setConfirming] = useState(false)
  const [savedId, setSavedId] = useState('')
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [error, setError] = useState('')
  const [note, setNote] = useState('') // the server's own sentence when a tailor ran free (no_gain)
  const [plan, setPlan] = useState<TailorPlan | null>(null)
  const [baseDoc, setBaseDoc] = useState<ResumeDoc | null>(null) // the doc the plan was built for
  const [overrides, setOverrides] = useState<TailorOverrides>({})
  const [answers, setAnswers] = useState<Record<string, string>>({})
  // the job a claimed line goes under, when the person had to pick one (prompt id → experience item id)
  const [roleFor, setRoleFor] = useState<Record<string, string>>({})
  const [showAll, setShowAll] = useState(false)
  // the question cards' drafts and skips (a typed answer becomes a line only when the person adds it: answers[id])
  const [qDrafts, setQDrafts] = useState<Record<string, string>>({})
  const [qSkipped, setQSkipped] = useState<string[]>([])
  const [extra, setExtra] = useState<TailorExtra>({})
  // the person's Yes / No answers for THIS job (same store and contract as the Optimize sheet)
  const confirm = useConfirmations(user?.id, job.jobId || (job.title || job.company ? `studio-${job.company}-${job.title}`.toLowerCase().replace(/\s+/g, '-').slice(0, 80) : ''))
  // read-only list of every change the server made (the overrides below are how a person overrules them here)
  const changeView = usePaidVersion(extra.tailored && extra.tailored.doc ? extra.tailored : null, '') // read-only list: nothing stored

  useEffect(() => { if (initialJob) setJob(initialJob) }, [initialJob])

  // The last result comes back on a reload (it cost a credit): plan, the doc it was built for, and
  // every overrule the person made. A new run replaces it.
  const [restored, setRestored] = useState(false)
  useEffect(() => {
    if (restored) return
    setRestored(true)
    const rec = ResumeDocStore.getTailor(user?.id)
    if (!rec) return
    setPlan(rec.plan as TailorPlan); setBaseDoc(rec.baseDoc); setOverrides((rec.overrides || {}) as TailorOverrides); setAnswers(rec.answers || {})
    const rj = rec.job as (TailorJob & { result?: TailorExtra; roleFor?: Record<string, string> }) | undefined
    if (rj && rj.roleFor) setRoleFor(rj.roleFor)
    if (rj && !initialJob) { const { result, roleFor: _r, ...j } = rj; setJob(j) }
    if (rj && rj.result) setExtra(rj.result)
    setState('done')
  }, [restored, user?.id, initialJob])
  useEffect(() => {
    if (state !== 'done' || !plan || !baseDoc) return
    ResumeDocStore.putTailor(user?.id, { job: { ...job, result: extra, roleFor }, plan, baseDoc, overrides, answers })
  }, [state, plan, baseDoc, overrides, answers, job, extra, user?.id, roleFor])

  function pickSaved(id: string) {
    setSavedId(id)
    const sj = savedJobs.find((j) => String(j.job_id) === id)
    if (!sj) return
    const snap = sj.snapshot as { title?: string; company?: string; description?: string; apply_url?: string } | undefined
    setJob({ title: sj.role || snap?.title || '', company: sj.company || snap?.company || '', description: snap?.description || '', jobId: String(sj.job_id), url: sj.apply_url || snap?.apply_url || '' })
  }

  function run() {
    if (!job.title.trim() && !job.description.trim()) { setError('Add the job title or paste the job description.'); return }
    if (!isLoggedIn) { onNeed('signin'); return }
    if (pro !== true && !hasConfirmedCreditUse(user?.id)) { setConfirming(true); return }
    void doRun()
  }
  async function doRun() {
    setConfirming(false)
    setState('loading'); setError('')
    try {
      const res = await fetch('/api/resume', {
        method: 'POST', headers: await aiHeaders(),
        body: JSON.stringify({ action: 'tailor', doc, jobTitle: job.title, company: job.company, jobDescription: job.description, jobId: job.jobId || undefined, ...(confirm.confirmed.length ? { confirmed: confirm.confirmed } : {}) }),
      })
      const data = (await res.json().catch(() => ({}))) as TailorResponse & { message?: string }
      // an expired session is a sign-in, never "out of credits" (UX audit F2)
      if (needsSignIn(res.status, data)) { setState('idle'); onNeed('signin'); return }
      if (outOfCredits(res.status, data)) { setState('idle'); onNeed(data.pro_required ? 'pro' : 'credits'); return }
      // A listing that is only a teaser (an Adzuna summary ending in "…") is refused BEFORE any
      // credit is spent — paste the full posting above and run again.
      if (res.status === 422 && data.error === 'preview_only') {
        // Seen tried the listing's own link first (lib/server/fullPosting.js) and could not read the posting;
        // the person can open it and paste it into the box above
        // re-serialized from a parsed URL (lib/safeHref.js) — the link came back from the server
        const link = httpHref((data as { apply_url?: string | null }).apply_url || job.url || '') || ''
        setPreviewLink(link)
        const gone = (data as { reason?: string }).reason === 'gone'
        if (gone) { setError('The site Seen got this listing from says the job was taken down, so there is no posting left to read. If you still have it, paste it into the job box above and press again. No credit was used.'); setState('idle'); return }
        setError(link ? 'Seen could only read a summary of this listing, and its page would not open from here. Open the listing, copy the posting, paste it into the job box above, and press again.' : (data.message || 'This listing only has a summary. Paste the full posting into the job box above, then press again.'))
        setState('idle'); return
      }
      // A posting that states no requirements is refused free, before the credit gate (api/resume.js) — say so in words.
      if (res.status === 422 && data.error === 'no_requirements') {
        // a long paste is a full posting: the fault is what Seen could read from it, never the paste
        const n = Number((data as { requirement_count?: number }).requirement_count) || 0
        const fullPaste = job.description.trim().length >= 600
        setError(fullPaste
          ? `Seen could read only ${n === 0 ? 'no requirements' : `${n} requirement${n === 1 ? '' : 's'}`} from this posting — too few to tailor against. Check that the requirements section is in the paste and add the job title, then run again. No credit was used.`
          : 'This text lists no requirements to tailor against. Paste the full posting — the responsibilities and requirements — and run again. No credit was used.')
        setState('idle'); return
      }
      if (!res.ok || !data.plan) { setError(data.error || 'Could not tailor this résumé. Try again.'); setState('error'); return }
      window.dispatchEvent(new Event('seen:credits-updated'))
      setNote((data as { no_gain?: boolean; note?: string }).no_gain ? ((data as { note?: string }).note || '') : '')
      const x = data as unknown as TailorExtra & { statements?: unknown; matched_requirements?: unknown; unsupported_requirements?: unknown; constraints?: unknown; field_match?: unknown }
      // the fit read rides along only when the answer carries the reader's statements (server request: tailor → statements)
      const fit = x.statements ? ({ verdict: data.plan.score?.verdict, statements: x.statements, matched_requirements: x.matched_requirements, unsupported_requirements: x.unsupported_requirements, constraints: x.constraints, field_match: x.field_match } as FitData) : null
      setExtra({ questions_note: (x as { questions_note?: string | null }).questions_note || null, already_right: (x as { already_right?: AlreadyRight | null }).already_right || null, tailored: x.tailored || null, charge: x.charge || (x.tailored && x.tailored.charge) || null, blocked: x.blocked || null, charged: !!x.charged, balance: typeof x.balance === 'number' ? x.balance : undefined, fit })
      setPlan(data.plan); setBaseDoc(clone(doc)); setOverrides({}); setAnswers({}); setRoleFor({})
      setState('done')
      markQuiet() // nothing optional pops over a result the person just paid for
    } catch { setError('Network error — try again.'); setState('error') }
  }

  // An answer re-asks the FREE check in place (no credit, no reload, no scroll jump) and the fit read shows the server's
  // answer — a changed statement comes back `by: 'you'`. The next tailor run carries the answers too.
  async function answerAndReask(id: string, a: Answer | null, line?: string) {
    const next: Confirmed[] = confirm.answer(id, a, line)
    if (a === 'skip') return
    try {
      const res = await fetch('/api/optimizer', { method: 'POST', headers: await aiHeaders(), body: JSON.stringify({ action: 'optimize', resumeText: serializeToText(baseDoc || doc), jobTitle: job.title, company: job.company, jobDescription: job.description, postingPasted: !!job.description.trim(), jobId: job.jobId || undefined, ...(next.length ? { confirmed: next } : {}) }) })
      const d = await res.json().catch(() => null)
      if (res.ok && d && d.statements) setExtra((x) => ({ ...x, fit: { verdict: d.verdict, statements: d.statements, matched_requirements: d.matched_requirements, unsupported_requirements: d.unsupported_requirements, constraints: d.constraints, field_match: d.field_match } }))
    } catch { /* the rows keep the last answer the server gave */ }
  }

  // The variant the user will take: the plan re-applied with their overrides.
  const finalVariant = useMemo(() => {
    if (!plan || !baseDoc) return null
    // a claimed line goes under the job the person picked; a credential (placed under Certifications whatever the job)
    // rides on the first job so the plan's per-job apply loop reaches it
    const first = baseDoc.experience?.[0]?.id
    const prompts = (plan.prompts || []).map((p) => {
      const pp = p as unknown as { kind?: string; answerKind?: string | null }
      if (pp.kind !== 'claim') return p
      if (roleFor[p.id]) return { ...p, itemId: roleFor[p.id] }
      return pp.answerKind === 'credential' && !p.itemId && first ? { ...p, itemId: first } : p
    })
    return applyTailorPlan(baseDoc, plan, { ...overrides, prompts, answers })
  }, [plan, baseDoc, overrides, answers, roleFor])

  const setDecision = (itemId: string, decision: TailorDecision['decision']) => setOverrides((o) => ({ ...o, decisions: { ...(o.decisions || {}), [itemId]: decision } }))
  // Lines written from what a title implies are suggestions: added only when the person says so.
  const toggleAdded = (key: string) => setOverrides((o) => { const cur = new Set(o.includeAdded || []); if (cur.has(key)) cur.delete(key); else cur.add(key); return { ...o, includeAdded: [...cur] } })
  const decisions = plan?.decisions || []
  const visibleDecisions = showAll ? decisions : decisions.slice(0, 8)
  const added = finalVariant ? finalVariant.meta.provenance.filter((p) => p.kind === 'transferable_bullet' || p.kind === 'transferable_suggestion') : []
  // What the export will actually carry for a role — never a guess ("Keep in full · 5 of 5" while
  // the PDF had 3, Dev 2026-10-25).
  const shownBullets = (itemId: string) => finalVariant ? (finalVariant.experience.find((e) => e.id === itemId)?.bullets.length ?? 0) : 0
  const summaryOn = overrides.summary !== false
  const layout: Layout = (overrides.layout as Layout | undefined) || (plan?.strategy?.layout as Layout | undefined) || 'chronological'
  const setLayout = (l: Layout) => setOverrides((o) => ({ ...o, layout: l as TailorOverrides['layout'] }))
  const rewrites = plan?.rewrites || []
  const accepted = new Set(Array.isArray(overrides.rewrites) ? overrides.rewrites : overrides.rewrites === true ? rewrites.map((r) => r.bulletId) : [])
  const toggleRewrite = (id: string) => setOverrides((o) => { const cur = new Set(Array.isArray(o.rewrites) ? o.rewrites : o.rewrites === true ? rewrites.map((r) => r.bulletId) : []); if (cur.has(id)) cur.delete(id); else cur.add(id); return { ...o, rewrites: [...cur] } })
  const noRequirements = !!plan && plan.job.requirementCount === 0
  const topRelevance = decisions.length ? decisions[0].relevance : 0

  return (
    <div style={{ animation: 'fadeUp .3s ease both' }}>
      {confirming && (
        <CreditConfirmDialog cost={RESUME_OPTIMIZE_COST} action={`tailor your résumé for ${job.title || 'this job'}${job.company ? ` at ${job.company}` : ''}`} onConfirm={() => { void doRun() }} onCancel={() => setConfirming(false)} />
      )}
      <div className={s.card}>
        <div className={s.cardTitle}>Tailor to a job</div>
        <p className={s.dim} style={{ marginBottom: '.75rem' }}>The optimizer reads what each of your jobs <em>is</em>, decides which roles lead, which shrink to a line and which stay off this version, picks the bullets that speak to the posting inside a one-page budget, and writes a summary from your own facts. Every decision shows its reason and you can overrule any of it. Nothing is invented.</p>
        {savedJobs.length > 0 && (
          <div style={{ marginBottom: '.5rem' }}>
            <span className={s.label}>Saved job</span>
            <select className={s.input} value={savedId} onChange={(e) => pickSaved(e.target.value)}>
              <option value="">Choose a saved job…</option>
              {savedJobs.map((j) => <option key={String(j.job_id)} value={String(j.job_id)}>{j.role || 'Role'}{j.company ? ` — ${j.company}` : ''}</option>)}
            </select>
          </div>
        )}
        <div className={s.row}>
          <div><span className={s.label}>Job title</span><input autoComplete="off" className={s.input} value={job.title} onChange={(e) => setJob({ ...job, title: e.target.value })} placeholder="Job title" /></div>
          <div><span className={s.label}>Company</span><input autoComplete="off" className={s.input} value={job.company} onChange={(e) => setJob({ ...job, company: e.target.value })} placeholder="Company" /></div>
        </div>
        {/* the one "paste a job" box (UX audit F8): the posting's link or its text */}
        <PostingInput value={job.description} rows={5} testId="tailor-posting" onChange={(t) => { setJob({ ...job, description: t }); if (previewLink || error) { setPreviewLink(''); setError('') } }} />
        <div className={s.opts} style={{ marginTop: '.5rem', justifyContent: 'flex-end' }}>
          {/* one filled button per screen: once a plan is on screen, "Use this version" is it and a re-run is outlined */}
          <button type="button" className={plan ? s.btnOutline : s.btnPrimary} onClick={run} disabled={state === 'loading'}>
            {state === 'loading' ? 'Optimizing…' : plan ? 'Re-run for this job →' : 'Optimize for this job →'}<span style={{ marginLeft: '.5rem', fontSize: 'var(--fs-meta)', opacity: .7, fontFamily: 'var(--mono)', fontWeight: 400 }}>· {priceLabel(RESUME_OPTIMIZE_COST, pro)}</span>
          </button>
        </div>
        {error && <div className={s.err} style={{ marginTop: '.5rem', marginBottom: 0 }}>{error}{previewLink && <> <a href={previewLink} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', fontWeight: 600 }}>Open the listing ↗</a></>}</div>}
      </div>

      {state === 'done' && plan && extra.blocked && (
        <div className={s.card}>
          <ResultTopLine charge={extra.charge} charged={!!extra.charged} pro={pro} balance={extra.balance ?? null} cost={creditCostLabel(RESUME_OPTIMIZE_COST)} />
          <div style={{ marginTop: 'var(--sp-3)' }}><BlockedResult b={extra.blocked} jobsHref="/jobs" note={extra.questions_note || null} /></div>
          {extra.fit && <div style={{ marginTop: 'var(--sp-4)' }}><FitRead data={extra.fit} compact brief /></div>}
        </div>
      )}
      {state === 'done' && plan && finalVariant && !extra.blocked && (
        <>
          {extra.charge && <ResultTopLine charge={extra.charge} charged={!!extra.charged} pro={pro} balance={extra.balance ?? null} cost={creditCostLabel(RESUME_OPTIMIZE_COST)} vis={extra.tailored?.visibility || null} />}
          {extra.fit && <div className={s.card}><FitRead data={extra.fit} compact answers={confirm.answers} answerLines={confirm.lines} onAnswer={(id, a, line) => { void answerAndReask(id, a, line) }} /></div>}
          <div className={s.card}>
            {noRequirements || plan.score.after == null || plan.score.before == null ? (
              <div className={s.dim} style={{ color: 'var(--amber)' }}>{plan.score.verdict?.withheld ? plan.score.verdict.sentence : 'The posting text gave us no requirements to match — this version is arranged from the job title and family only.'} Paste the full posting (requirements and responsibilities) for a real match score.</div>
            ) : (
              <>
                <div className={s.beforeAfter}>
                  <span>{plan.score.before}</span>
                  <span className={s.arrow}>→</span>
                  <span>{plan.score.after}</span>
                  <span className={s.dim} style={{ fontWeight: 400, fontSize: 'var(--fs-meta)' }}>SeenFit match · {plan.job.familyLabel || plan.job.roleFamily} posting · {plan.score.requirementCount ?? plan.job.requirementCount} requirements read{plan.strategy ? ` · about ${plan.strategy.estimatedLines} lines · fits on ${Math.max(1, Math.ceil(plan.strategy.estimatedLines / LINES_PER_PAGE))} page${Math.max(1, Math.ceil(plan.strategy.estimatedLines / LINES_PER_PAGE)) === 1 ? '' : 's'}` : ''}</span>
                </div>
                {/* the same one-sentence why the Optimize modal and /resume show; the gate first */}
                {plan.score.verdict && <p className={s.dim} style={{ marginTop: '.5rem', color: plan.score.verdict.gate ? 'var(--amber)' : undefined }}>{plan.score.verdict.sentence.replace(/^\d+ — /, '')}</p>}
                {note && !extra.charge && <p className={s.dim} style={{ marginTop: '.5rem' }}>{note}</p>}
                {plan.summaryKept && <p className={s.dim} style={{ marginTop: '.25rem' }}>Your own summary stays — it scored higher against this posting than a rewritten one.</p>}
              </>
            )}
            <p className={s.dim} style={{ marginTop: '.5rem' }}>
              {decisions.length ? `${decisions.filter((d) => d.tier === 'core').map((d) => d.title).join(' and ') || 'Your most relevant roles'} lead this version. ${decisions.filter((d) => d.decision === 'condense').length ? `${decisions.filter((d) => d.decision === 'condense').length} role${decisions.filter((d) => d.decision === 'condense').length === 1 ? '' : 's'} became one line, ` : ''}${decisions.filter((d) => d.decision === 'drop').length ? `${decisions.filter((d) => d.decision === 'drop').length} left off, ` : ''}bullets that speak to the posting lead each role.` : 'No roles to optimize — add experience first.'}
            </p>
            <div className={s.opts} style={{ marginTop: '.5rem' }}>
              <span className={s.label} style={{ margin: 0 }}>Layout</span>
              {/* one option always shows as selected — the plan's own layout may be "as written" */}
              <button type="button" aria-pressed={layout === 'as_written'} className={`${s.tiny}${layout === 'as_written' ? ` ${s.chipGreen}` : ''}`} onClick={() => setLayout('as_written')}>As you wrote it</button>
              <button type="button" aria-pressed={layout === 'relevance'} className={`${s.tiny}${layout === 'relevance' ? ` ${s.chipGreen}` : ''}`} onClick={() => setLayout('relevance')}>Relevant first</button>
              <button type="button" aria-pressed={layout === 'chronological'} className={`${s.tiny}${layout === 'chronological' ? ` ${s.chipGreen}` : ''}`} onClick={() => setLayout('chronological')}>Chronological</button>
              <span className={s.muted}>{layout === 'relevance' ? 'Relevant Experience leads; other roles are lines under Additional Experience.' : layout === 'as_written' ? 'Your roles in the order you wrote them.' : 'Most recent first; irrelevant roles condensed.'}</span>
            </div>
            {layout === 'relevance' && plan.strategy?.layout !== 'relevance' && (
              <div className={s.muted} style={{ color: 'var(--amber)', marginTop: '.25rem' }}>⚠ This puts an older role above your current job. Store-level and hourly recruiters read that top-down as a gap — keep Chronological unless the older role is the only relevant one.</div>
            )}
            <div className={s.findingActions} style={{ marginTop: '.75rem' }}>
              <button type="button" className={s.btnGreen} onClick={() => onUseVariant(finalVariant, { role: job.title, company: job.company, jobId: job.jobId, scoreBefore: plan.score.before, scoreAfter: plan.score.after, ...paidTokenOf(extra) })}>Use this version →</button>
              <span className={s.muted} style={{ alignSelf: 'center' }}>Your base résumé stays exactly as it is.</span>
            </div>
          </div>

          {extra.already_right && <AlreadyRightBlock a={extra.already_right} />}
          {extra.tailored && (extra.tailored.changes || []).length > 0 && (
            <div className={s.card} data-testid="tailor-changes">
              <span className={s.secTitle}>Every change, before → after</span>
              <div className={s.dim} style={{ margin: '.25rem 0 .5rem' }}>What this version changes from your résumé, with the requirement each one serves. Overrule them below.</div>
              <ChangeList t={extra.tailored} v={changeView} readOnly />
            </div>
          )}

          {decisions.length > 0 && (
            <div className={s.card}>
              <span className={s.secTitle}>Role decisions · overrule any</span>
              <div style={{ marginTop: '.5rem', display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
                {visibleDecisions.map((d) => {
                  const current = (overrides.decisions && overrides.decisions[d.itemId]) || d.decision
                  // Absolute relevance (0–100), never renormalised: three near-ties must read as
                  // near-ties, not as 100 / 99 / 95.
                  const pct = Math.round(Math.min(1, d.relevance) * 100)
                  const tie = d.itemId !== decisions[0].itemId && Math.abs(d.relevance - topRelevance) < 0.03
                  return (
                    <div key={d.itemId} className={s.finding} style={{ flexDirection: 'column', gap: '.25rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '.5rem', alignItems: 'baseline', flexWrap: 'wrap' }}>
                        <div style={{ minWidth: 0 }}>
                          <strong style={{ color: 'var(--white)', fontSize: 'var(--fs-sm)' }}>{d.title || d.company}</strong>{d.company && d.title ? <span className={s.dim}> · {d.company}</span> : null}
                          <span className={s.dim}> · {d.familyLabel}{d.current ? ' · current' : ''}{d.dateless ? ' · no dates' : ''}</span>
                        </div>
                        <span className={`${s.chip} ${s[TIER_CLASS[d.tier]] || s.chip}`} title="How much of what this posting asks for the role covers">{TIER_LABEL[d.tier]} · {pct}% fit{tie ? ' · tie' : ''}</span>
                      </div>
                      <div className={s.bar}><div className={s.barFill} style={{ width: `${Math.max(3, pct)}%` }} /></div>
                      <div className={s.muted} style={{ color: 'var(--sub)' }}>{d.reasons.slice(0, 2).join(' ')}</div>
                      {d.shared.length > 0 && <div className={s.chips}>{d.shared.slice(0, 4).map((c) => <span key={c.competency} className={`${s.chip}${c.evidenced ? ` ${s.chipGreen}` : ''}`} title={c.evidenced ? 'shown in your bullets' : 'implied by the title'}>{c.competency}{c.evidenced ? ' ✓' : ''}</span>)}</div>}
                      <div className={s.opts}>
                        <span className={s.label} style={{ margin: 0 }}>On this version</span>
                        <select className={s.input} style={{ maxWidth: 300, padding: '.25rem .5rem', fontSize: 'var(--fs-meta)' }} value={current} onChange={(e) => setDecision(d.itemId, e.target.value as TailorDecision['decision'])}>
                          {(['keep', 'trim', 'condense', 'drop'] as const).map((k) => <option key={k} value={k} disabled={k === 'drop' && d.current}>{DECISION_LABEL[k]}{k === d.decision ? ' (suggested)' : ''}</option>)}
                        </select>
                        {d.bullets > 0 && (current === 'keep' || current === 'trim') && <span className={s.muted} data-testid="tailor-bullet-count">{shownBullets(d.itemId)} of {d.bullets} bullets on this version{current === 'keep' && shownBullets(d.itemId) < d.bullets ? ' (page budget — choose “Keep in full” bullets by editing the role)' : ''}</span>}
                      </div>
                    </div>
                  )
                })}
                {decisions.length > 8 && <button type="button" className={s.tiny} onClick={() => setShowAll((v) => !v)}>{showAll ? 'Show fewer' : `Show all ${decisions.length} roles`}</button>}
              </div>
            </div>
          )}

          {rewrites.length > 0 && (
            <div className={s.card}>
              <span className={s.secTitle}>Wording proposals · {accepted.size} of {rewrites.length} accepted</span>
              <div className={s.dim} style={{ margin: '.25rem 0 .5rem' }}>Tense, lead verbs and filler — proposed, never applied on their own. Your bullets stay exactly as written unless you accept a change.</div>
              {rewrites.map((r) => (
                <div key={r.bulletId} style={{ marginTop: '.5rem', borderTop: '1px solid var(--line)', paddingTop: '.5rem' }}>
                  <div className={s.diff}><span className={s.del}>{r.from}</span><br /><span className={s.ins}>{r.to}</span></div>
                  <div className={s.findingActions}>
                    <button type="button" className={`${s.tiny}${accepted.has(r.bulletId) ? ` ${s.chipGreen}` : ''}`} data-testid="tailor-rewrite-toggle" onClick={() => toggleRewrite(r.bulletId)}>{accepted.has(r.bulletId) ? '✓ Accepted' : 'Accept this wording'}</button>
                    <span className={s.muted} style={{ alignSelf: 'center' }}>{r.rules.includes('tense') ? (r.tense === 'present' ? 'Present tense for a current role' : 'Past tense for a past role') : r.rules.join(', ')}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {(plan.prompts || []).length > 0 && (
            <div className={s.card} data-testid="tailor-questions">
              <span className={s.secTitle}>{(plan.prompts || []).length === 1 ? 'One question only you can answer' : `${(plan.prompts || []).length} questions only you can answer`}</span>
              {/* the same question card as the paid result: the composer's line or its one sentence, confirmed before it is added */}
              <ol style={{ listStyle: 'none', margin: 'var(--sp-2) 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
                {(plan.prompts || []).map((p) => {
                  const qn = { ...(p as unknown as Question), role: p.roleTitle, company: p.company, roles: (baseDoc?.experience || []).filter((e) => e.title || e.company).map((e) => ({ itemId: e.id, title: e.title, company: e.company })) } as Question
                  const raw = answers[p.id] || ''
                  return (
                    <QuestionCard key={p.id} qn={qn} io={{
                      draft: qDrafts[p.id] ?? raw,
                      setDraft: (t) => setQDrafts((d) => ({ ...d, [p.id]: t })),
                      added: raw ? (composeAnswer(qn as unknown as Record<string, unknown>, raw).line || null) : null,
                      add: (_line, typed, itemId) => { if (itemId) setRoleFor((r) => ({ ...r, [p.id]: itemId })); setAnswers((a) => ({ ...a, [p.id]: typed })) },
                      remove: () => setAnswers((a) => { const n = { ...a }; delete n[p.id]; return n }),
                      skipped: qSkipped.includes(p.id),
                      skip: () => setQSkipped((x) => [...x.filter((y) => y !== p.id), p.id]),
                      unskip: () => setQSkipped((x) => x.filter((y) => y !== p.id)),
                    }} />
                  )
                })}
              </ol>
            </div>
          )}

          {added.length > 0 && (
            <div className={s.card}>
              <span className={s.secTitle} style={{ color: 'var(--amber)' }}>Suggested lines — not on your résumé until you add them</span>
              <div className={s.dim} style={{ margin: '.25rem 0 .5rem' }}>Written from what a job like yours usually involves, not from anything you wrote. Add a line only if it is true for you; nothing here is exported unless you add it.</div>
              {added.map((a) => {
                const key = String(a.key || `${String(a.itemId)}:${String(a.competency)}`)
                const on = (overrides.includeAdded || []).includes(key)
                return (
                  <div key={key} className={s.finding}>
                    <span className={s.findingIcon} style={{ color: on ? 'var(--green)' : 'var(--amber)' }}>{on ? '✓' : '?'}</span>
                    <div className={s.findingBody}>
                      <div className={s.findingMsg}>{String(a.text)}</div>
                      <div className={s.muted}>{String(a.basis)}</div>
                      <div className={s.findingActions}><button type="button" className={`${s.tiny}${on ? ` ${s.chipGreen}` : ''}`} data-testid="tailor-added-toggle" onClick={() => toggleAdded(key)}>{on ? '✓ Added — remove' : 'True for me — add it'}</button></div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {plan.summary && (
            <div className={s.card}>
              <span className={s.secTitle}>Summary · for this posting</span>
              <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text)', lineHeight: 1.6, margin: '.5rem 0' }}>{finalVariant.basics.summary || plan.summary.text}</p>
              {plan.summary.replaced && <div className={s.diff} style={{ marginBottom: '.5rem' }}><span className={s.muted}>Replaces: </span><span className={s.del}>{plan.summary.replaced}</span></div>}
              <label className={s.dim} style={{ display: 'flex', gap: 'var(--sp-1)', alignItems: 'center', cursor: 'pointer', minHeight: 44 }}><span className={s.check44}><input type="checkbox" checked={summaryOn} onChange={(e) => setOverrides((o) => ({ ...o, summary: e.target.checked }))} /><span className={s.checkBox} aria-hidden="true" /></span>Use this summary</label>
            </div>
          )}

          {plan.skills && (plan.skills.added.length > 0 || plan.skills.reordered) && (
            <div className={s.card}>
              <span className={s.secTitle}>Skills · {plan.skills.added.length ? `+${plan.skills.added.length} from your own résumé` : 'matched skills first'}</span>
              {plan.skills.added.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.25rem', margin: '.5rem 0' }}>
                  {plan.skills.added.map((a) => <span key={a.term} className={s.chip} title={a.evidence}>{a.term}</span>)}
                </div>
              )}
              <p className={s.dim} style={{ margin: '.25rem 0 .5rem' }}>{plan.skills.added.length ? 'Each term is already written in your résumé — listing it under Skills makes keyword scans find it.' : ''}{plan.skills.reordered ? ' The skills this posting asks for lead each list.' : ''}</p>
              <label className={s.dim} style={{ display: 'flex', gap: 'var(--sp-1)', alignItems: 'center', cursor: 'pointer', minHeight: 44 }}><span className={s.check44}><input type="checkbox" checked={overrides.skills !== false} onChange={(e) => setOverrides((o) => ({ ...o, skills: e.target.checked }))} /><span className={s.checkBox} aria-hidden="true" /></span>Apply these skills edits</label>
            </div>
          )}

          {plan.gaps.length > 0 && (
            <div className={s.card}>
              <span className={s.secTitle} style={{ color: 'var(--amber)' }}>Gaps — honest list</span>
              <div style={{ marginTop: '.5rem' }}>
                {plan.gaps.map((g) => (
                  <div key={g.requirement} className={`${s.gap} ${g.severity === 'likely_covered' ? s.gapCovered : g.severity === 'fatal' ? s.gapFatal : s.gapWarn}`}>
                    <strong style={{ color: 'var(--white)' }}>{g.requirement}</strong>{g.level ? <span className={s.muted}> · {g.level}</span> : null}
                    <div className={s.muted} style={{ marginTop: '.125rem', color: 'var(--sub)' }}>{g.explanation}{g.mustNotInvent ? ' Do not add this unless it is true.' : ''}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {plan.strengths.length > 0 && (
            <div className={s.card}>
              <span className={s.secTitle}>Your strongest evidence</span>
              <div style={{ marginTop: '.5rem', display: 'flex', flexDirection: 'column', gap: '.25rem' }}>
                {plan.strengths.slice(0, 6).map((m) => <div key={m.requirement} style={{ fontSize: 'var(--fs-meta)', color: 'var(--sub)', lineHeight: 1.5 }}><span style={{ color: 'var(--green)' }}>✓ </span><strong style={{ color: 'var(--white)' }}>{m.requirement}</strong>{m.evidence ? ` — ${m.evidence.slice(0, 100)}` : ''}</div>)}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

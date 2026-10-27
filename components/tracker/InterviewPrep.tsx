'use client'

// Interview Prep on a tracker card (owner decision 2026-10-25). It appears the moment an application
// reaches Phone Screen / Interview / Final Round — the one moment all four willingness-to-pay test users
// said they would pay. The top half is FREE and comes from Seen's own data (what happened to applicants
// after interviewing at this company, what they say the process involved, the pay on its listings, how this
// company's interviews usually run, when to follow up). The prep pack itself — the company's known questions,
// answers built from the person's résumé that they finish on the card, intro, emails — is $9.99 once (14 days
// of Pro), or free for anyone who already has Pro. Server: api/interview-prep.js, lib/server/prepLocal.js,
// lib/server/interviewGuides.js.
//
// Round 3 of the test (2026-10-26): nobody paid because the prep was "a worksheet" — résumé lines with
// [blanks], nothing about the company, no pay, a posting pasted before paying was lost. So now: the blanks
// are fields the person types into and the answer becomes theirs (saved with the prep, every device); the
// company's own process and questions lead; the posting is kept through checkout and can be added after.
// This card only renders on ACTIVE applications at an interview stage (app/tracker/page.tsx).

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { aiHeaders } from '@/lib/aiHeaders'
import { signupHref } from '@/lib/signupIntent.js'
import { PREP, PASS, PREP_PRICE, PASS_PRICE, ONE_TIME_NOTE } from '@/lib/pricing'
import { useCheckout } from '@/lib/useCheckout'
import { funnelEvent } from '@/lib/funnel'
import { splitAnswer, composeAnswer, isFinished, blankCount } from './prepAnswer'
import { localDay, localTime, isoFrom } from '@/lib/interviewTime'
import s from './InterviewPrep.module.css'

const SKU = PREP
const PRICE = PREP_PRICE

type Guide = { company: string; format: string; framework: { name: string; note: string } | null; questions: number; confidence?: string }
type Preview = { questions: { q: string; why: string; company?: boolean }[]; answer: { q: string; answer: string; resume_fact: string } | null; has_resume: boolean; total_questions?: number; practice_items?: number; guide?: Guide | null }

type Quote = { text: string; role: string | null; outcome: string; source: string | null; url: string | null }
type InterviewRecord = {
  accounts: number
  after: { offer: number; rejected: number; ghosted: number; waiting: number }
  resolved: number
  ghostedAfterInterviewPct: number | null
  offerAfterInterviewPct: number | null
  rounds: number | null
  waitDays: number | null
  quotes: Quote[]
  process?: { label: string; n: number }[]
}
type Pay = { unit: 'hour' | 'year'; low: number; high: number; listings: number; scope: 'role' | 'company' | 'market' }
type FollowUp = { thankYouBy: string; followUpOn: string; lastCheckOn: string }
type RecordData = { record: InterviewRecord; pay: Pay | null; follow_up: FollowUp; guide?: Guide | null; sample_question?: { q: string; why: string; principle: string | null } | null }
type Answer = { q: string; answer: string; resume_fact: string; coached?: boolean; script?: boolean; frame?: boolean; exercise?: boolean; practice?: string; reference?: string; hint?: string; company?: boolean; principle?: string | null }
type Pack = {
  questions: { q: string; why: string; company?: boolean; principle?: string | null }[]
  answers: Answer[]
  intro: string | null
  resume_check?: { line: string; note: string }[]
  job_match?: { label: string; status: 'shown' | 'stated' | 'gap' | 'expired' | 'in progress'; proof?: string; say: string; duty?: boolean; cert?: boolean }[]
  ask_them?: { q: string; company?: boolean }[]
  format?: string
  guide?: { company: string; confidence: string; framework: { name: string; note: string } | null; tips: string[]; watch: string } | null
  emails: { thankYou: { subject: string; body: string }; followUp: { subject: string; body: string } }
  follow_up: FollowUp
  fills?: Record<string, string[]>
  /** The person's words from a sentence a rebuild changed — theirs to copy, never shown as finished. */
  notes?: Record<string, string[]>
  /** the sentence each note was typed into, so a rebuild that brings it back restores the answer */
  noteKeys?: Record<string, string>
  job_text?: string
  posting_pay?: string | null
}
// The fillable things beside the questions: the intro and the two emails (lib/server/prepFills.js).
const INTRO_KEY = '__intro__'
const THANKS_KEY = '__thankyou__'
const FOLLOW_KEY = '__followup__'
/** "Ross Stores'" and "Amazon's" (round 4, Maria: "Ross Stores's"). */
const poss = (name: string) => (/s$/i.test(name.trim()) ? `${name.trim()}’` : `${name.trim()}’s`)

// One read per company + role per page view, shared by every card that names it.
const recordCache = new Map<string, Promise<RecordData | null>>()
function loadRecord(company: string, role: string, interviewAt: string) {
  const key = `${company.toLowerCase()}|${role.toLowerCase()}|${interviewAt}`
  if (!recordCache.has(key)) {
    recordCache.set(key, fetch('/api/interview-prep', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'record', company, role, interview_at: interviewAt }),
    }).then(r => (r.ok ? r.json() : null)).catch(() => null))
  }
  return recordCache.get(key)!
}

// "1 got an offer, 2 were rejected" — zero counts left out, singular/plural right.
function afterLine(a: InterviewRecord['after']): string {
  const parts: string[] = []
  if (a.offer) parts.push(`${a.offer} got an offer`)
  if (a.rejected) parts.push(`${a.rejected} ${a.rejected === 1 ? 'was' : 'were'} rejected`)
  if (a.ghosted) parts.push(`${a.ghosted} heard nothing after`)
  if (a.waiting) parts.push(`${a.waiting} ${a.waiting === 1 ? 'is' : 'are'} still waiting`)
  return parts.join(', ')
}
// "a video interview (3), an online assessment (2) and a background check (2)"
function processLine(p: { label: string; n: number }[]): string {
  const top = p.slice(0, 3).map(x => `${x.label} (${x.n})`)
  return top.length <= 1 ? top.join('') : `${top.slice(0, -1).join(', ')} and ${top[top.length - 1]}`
}
const article = (w: string) => (/^[aeiou]/i.test(w.trim()) ? 'an' : 'a')

const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', month: 'short', day: 'numeric' })
const money = (p: Pay) => p.unit === 'hour'
  ? `$${p.low % 1 ? p.low.toFixed(2) : p.low}–$${p.high % 1 ? p.high.toFixed(2) : p.high}/hr`
  : `$${Math.round(p.low / 1000)}k–$${Math.round(p.high / 1000)}k/yr`

// The interview's date and time as the person's own clock shows them: lib/interviewTime.ts (shared with the
// dashboard).

// The posting pasted before buying is kept on the SERVER (action 'stash', used by the first build on any
// device — round 4: all four personas lost it); this device keeps a copy as a backstop for a stash that failed.
const postingKey = (appId: string) => `seen_prep_posting_${appId}`
const stashPosting = (appId: string, text: string) => { try { if (text.trim()) localStorage.setItem(postingKey(appId), text.slice(0, 6000)); else localStorage.removeItem(postingKey(appId)) } catch { /* private mode */ } }
const takePosting = (appId: string): string => { try { const v = localStorage.getItem(postingKey(appId)) || ''; return v } catch { return '' } }
const dropPosting = (appId: string) => { try { localStorage.removeItem(postingKey(appId)) } catch { /* ignore */ } }

function CopyBtn({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false)
  return (
    <button type="button" className={s.copy} onClick={() => { navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1600) }).catch(() => {}) }}>
      {done ? 'Copied ✓' : label}
    </button>
  )
}

export default function InterviewPrep({ appId, company, role, interviewAt, isPro, autoBuild, jobId, stage, onSchedule, guest = false, lead = false }: {
  /** A guest on this device: the free record and date work; the prep needs a free account first. */
  guest?: boolean
  /** The card reached an interview a moment ago: open, scrolled into view, the offer leads. */
  lead?: boolean
  appId: string
  company: string
  role: string
  /** The interview date the person entered (ISO), or '' — follow-up days are only shown once it is known. */
  interviewAt: string
  isPro: boolean
  /** Set when the person just came back from buying Interview Prep for this card. */
  autoBuild?: boolean
  /** The card's own listing, so the prep is built from the real posting. */
  jobId?: string
  stage: string
  /** Saves the interview date on the application (an interview_scheduled event). */
  onSchedule: (iso: string) => void
}) {
  const [data, setData] = useState<RecordData | null>(null)
  const [open, setOpen] = useState(true)
  const [pack, setPack] = useState<Pack | null>(null)
  const [state, setState] = useState<'idle' | 'building' | 'need_resume' | 'error'>('idle')
  const [err, setErr] = useState('')
  const shown = useRef(false)
  const built = useRef(false)
  const [hasResume, setHasResume] = useState<boolean | null>(null)
  const [posting, setPosting] = useState('')
  const [pending, setPending] = useState(false)
  const postingRef = useRef('')
  const setPostingBoth = (v: string) => { postingRef.current = v; setPosting(v) }

  useEffect(() => {
    let live = true
    loadRecord(company, role, interviewAt).then(d => { if (live && d?.record) setData(d) })
    return () => { live = false }
  }, [company, role, interviewAt])

  // The phone's floating "+ Track application" steps aside while a prep is open (round 3: it covered the
  // fine print). The page counts open panels.
  useEffect(() => {
    if (!open) return
    window.dispatchEvent(new CustomEvent('seen:prep-toggle', { detail: { open: true } }))
    return () => { window.dispatchEvent(new CustomEvent('seen:prep-toggle', { detail: { open: false } })) }
  }, [open])

  // A prep this person already has (bought, or built with Pro) shows on every device and after Pro ends.
  useEffect(() => {
    let live = true
    if (guest) return () => { live = false }
    aiHeaders().then(h => {
      if (!h.Authorization) return null
      return fetch('/api/interview-prep', { method: 'POST', headers: h, body: JSON.stringify({ action: 'mine', company, role }) }).then(r => (r.ok ? r.json() : null))
    }).then(d => {
      if (!live || !d) return
      if (d.pack) setPack(d.pack)
      if (typeof d.has_resume === 'boolean') setHasResume(d.has_resume)
      // the posting stashed before checkout: back in the box, and the prep builds with it as soon as Pro is on
      // (round 4, Dev: "Build my prep" with an empty box after paying)
      if (!d.pack && typeof d.pending_job_text === 'string' && d.pending_job_text.trim()) { if (!postingRef.current) setPostingBoth(d.pending_job_text); setPending(true) }
    }).catch(() => {})
    return () => { live = false }
  }, [company, role, guest])

  // The free preview, from the same engine as the paid pack (no model, no cost): the company's own question
  // when Seen has a guide, the stage's questions, and one story from the résumé.
  const [preview, setPreview] = useState<Preview | null>(null)
  useEffect(() => {
    let live = true
    if (guest || isPro || pack) return () => { live = false }
    aiHeaders().then(h => {
      if (!h.Authorization) return null
      return fetch('/api/interview-prep', { method: 'POST', headers: h, body: JSON.stringify({ action: 'preview', company, role, stage }) }).then(r => (r.ok ? r.json() : null))
    }).then((d: (Preview & { ok?: boolean }) | null) => {
      if (!live || !d?.ok) return
      setPreview({ questions: d.questions || [], answer: d.answer || null, has_resume: !!d.has_resume, total_questions: d.total_questions, practice_items: d.practice_items, guide: d.guide || null })
      if (typeof d.has_resume === 'boolean') setHasResume(h => (h == null ? d.has_resume : h))
    }).catch(() => {})
    return () => { live = false }
  }, [company, role, stage, guest, isPro, pack])

  // Count the offer once per card per browser session (the funnel's "offer shown" step), and the preview.
  useEffect(() => {
    if (shown.current || isPro || pack) return
    shown.current = true
    funnelEvent('offer_shown', { surface: 'tracker_prep', sku: 'interview', company, once: appId })
  }, [appId, company, isPro, pack])
  useEffect(() => {
    if (preview && preview.questions.length) funnelEvent('prep_preview_shown', { surface: 'tracker_prep', company, once: appId })
  }, [preview, appId, company])

  // Reached an interview a moment ago: open and bring the prep into view (the moment the offer is for).
  const boxRef = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!lead) return
    setOpen(true)
    const t = setTimeout(() => boxRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 450)
    return () => clearTimeout(t)
  }, [lead])

  const checkout = useCheckout('tracker_prep', { isLoggedIn: !guest, guestHref: () => signupHref({ intent: 'prep', company, next: '/tracker' }) })

  const build = useCallback(async (opts: { refresh?: boolean; jobText?: string } = {}) => {
    setState('building'); setErr('')
    try {
      const h = await aiHeaders()
      const jobText = (opts.jobText ?? postingRef.current).trim().slice(0, 6000)
      const r = await fetch('/api/interview-prep', { method: 'POST', headers: h, body: JSON.stringify({ action: 'build', company, role, application_id: appId, interview_at: interviewAt, job_id: jobId || '', job_text: jobText, stage, ...(opts.refresh ? { refresh: true } : {}) }) })
      const d = await r.json().catch(() => ({}))
      if (r.status === 409 && d.need_resume) { setState('need_resume'); return }
      if (r.status === 402) { setState('idle'); setErr('This needs Interview Prep or Pro.'); return }
      if (!r.ok || !d.pack) { setState('error'); setErr(d.error || 'Could not build your prep right now — try again in a minute.'); return }
      // an older prep came back for a build that carried the posting: rebuild with it rather than drop it
      // (round 4, Maria: the buyer's return landed on `cached:true` and the posting vanished)
      if (d.cached && jobText && !opts.refresh && !d.pack.job_text && !(d.pack.job_match || []).length) { void build({ refresh: true, jobText }); return }
      setPack(d.pack); setState('idle'); setPending(false); dropPosting(appId)
      // the server built it but could not keep it: say so, never show a prep no other device will ever see
      if (d.saved === false) setErr('Your prep was built but could not be saved just now — your other devices still have the earlier version. Press "Rebuild with this posting" again in a minute.')
    } catch {
      setState('error'); setErr('Network error — check your connection and try again.')
    }
  }, [appId, company, role, interviewAt, jobId, stage])

  // Back from Stripe (or Pro already on with a stashed posting): the prep builds with the posting pasted before
  // paying — from the server stash, or this device's copy (round 3: it was lost at checkout).
  useEffect(() => {
    if ((autoBuild || pending) && isPro && !pack && !built.current) {
      built.current = true
      const kept = postingRef.current || takePosting(appId)
      if (kept && !postingRef.current) setPostingBoth(kept)
      void build({ jobText: kept })
    }
  }, [autoBuild, pending, isPro, pack, appId, build])

  // Both products come back to THIS card with the prep building (api/stripe.js success_url ?prep=<id>). The
  // posting goes to the server first so any device, any browser, builds with it.
  const buy = async (sku: 'interview' | 'pass30') => {
    setErr('')
    const text = postingRef.current.trim()
    stashPosting(appId, text)
    if (text && !guest) {
      try {
        const h = await aiHeaders()
        await Promise.race([
          fetch('/api/interview-prep', { method: 'POST', headers: h, body: JSON.stringify({ action: 'stash', company, role, application_id: appId, job_text: text.slice(0, 6000) }), keepalive: true }),
          new Promise(res => setTimeout(res, 2500)),
        ])
      } catch { /* the device copy still carries it */ }
    }
    void checkout.start(sku, { application_id: appId, company, role })
  }

  // The person's words for an answer's blanks: shown at once, saved with the prep (every device).
  // Saves run one after another: two quick saves on the same answer used to land out of order and the
  // shorter one won (round 4, Ray: a third line typed and lost).
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve())
  // the session headers, kept ready so a save fired as the page goes away needs no await (round 6: a reload
  // within a second of typing lost the box — the timer had not fired and nothing was sent)
  const hdrRef = useRef<Record<string, string> | null>(null)
  useEffect(() => { aiHeaders().then(h => { hdrRef.current = h as Record<string, string> }).catch(() => {}) }, [])
  const saveFill = useCallback((q: string, values: string[], urgent = false) => {
    setPack(p => (p ? { ...p, fills: { ...(p.fills || {}), [q]: values }, notes: Object.fromEntries(Object.entries(p.notes || {}).filter(([k]) => k !== q)) } : p))
    const body = JSON.stringify({ action: 'fill', company, role, q, values })
    // the page is going away (pagehide fires BEFORE visibilitychange on a reload or a back tap — round 7, Tasha:
    // the "hidden" check sent the save down the async path and nothing reached the server): one keepalive
    // request with the headers already in hand, no queue to wait on
    if ((urgent || document.visibilityState === 'hidden') && hdrRef.current) {
      try { void fetch('/api/interview-prep', { method: 'POST', headers: hdrRef.current, body, keepalive: true }) } catch { /* nothing more can be done here */ }
      return
    }
    saveQueue.current = saveQueue.current.then(async () => {
      try {
        const h = await aiHeaders()
        hdrRef.current = h as Record<string, string>
        await fetch('/api/interview-prep', { method: 'POST', headers: h, body, keepalive: true })
      } catch { /* kept on screen; saved on the next edit */ }
    })
  }, [company, role])

  const rec = data?.record
  const guide = data?.guide || preview?.guide || null
  // Dated advice only for a dated interview (round 2: "send a thank-you by Mon" before a Thursday screen).
  const fu = interviewAt ? data?.follow_up : null
  const dayVal = interviewAt ? localDay(interviewAt) : ''
  const timeVal = interviewAt ? localTime(interviewAt) : ''
  const pickDay = (
    <div className={s.dateRow}>
      <span>When is your interview?</span>
      <input type="date" className={s.date} aria-label="Interview date" value={dayVal}
        onChange={e => { if (e.target.value) onSchedule(isoFrom(e.target.value, timeVal)) }} />
      <input type="time" className={s.date} aria-label="Interview time" value={dayVal ? timeVal : ''} disabled={!dayVal}
        onChange={e => { if (dayVal && e.target.value) onSchedule(isoFrom(dayVal, e.target.value)) }} />
    </div>
  )
  // One real question for free, so the offer is not a blind buy (round 2: "nothing to preview").
  const sample = data?.sample_question
    ? { q: data.sample_question.q, why: data.sample_question.why, company: true }
    : data?.pay
      ? { q: 'What are your pay expectations?', why: data.pay.scope === 'market' ? `${role || 'This job'} listings at other employers on Seen pay about ${money(data.pay)} (${poss(company)} own listings don't say). Give a range you would accept.` : `${poss(company)} similar listings on Seen pay about ${money(data.pay)}. Give a range you would accept.` }
      : { q: `What do you know about ${company}?`, why: 'Name what they sell, who their customers are, and one recent thing you read about them.' }

  return (
    <section ref={boxRef} className={`${s.box}${lead ? ` ${s.lead}` : ''}`} onClick={e => e.stopPropagation()} aria-label={`Interview prep for ${company}`} data-testid="interview-prep">
      <button type="button" className={s.head} aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className={s.kicker}>Interview at {company}</span>
        <span className={s.toggle}>{open ? 'Hide' : 'Show'}</span>
      </button>

      {open && (
        <>
          {lead && !pack && <p className={s.leadLine} data-testid="prep-lead">They called you in. Here is what Seen knows about {company}&apos;s interviews, and a first look at your prep.</p>}
          {/* FREE — Seen's own data, for everyone */}
          <div className={s.facts}>
            {guide && (
              <div className={s.guide} data-testid="prep-guide">
                <div className={s.label}>How {guide.company} interviews usually run</div>
                <p className={s.fact}>{guide.format}</p>
                {guide.framework && <p className={s.factDim}><b className={s.fw}>{guide.framework.name}.</b> {guide.framework.note}</p>}
              </div>
            )}
            {rec && rec.accounts > 0 ? (
              <p className={s.fact}>
                <b>{rec.accounts} applicant {rec.accounts === 1 ? 'account' : 'accounts'}</b> on Seen mention interviewing at {company}
                {afterLine(rec.after) && <>: {afterLine(rec.after)}</>}.
                {rec.ghostedAfterInterviewPct != null && rec.ghostedAfterInterviewPct >= 20 && <> {rec.ghostedAfterInterviewPct}% were ghosted after interviewing — follow up on time.</>}
                {rec.rounds != null && rec.rounds > 1 && <> Usually {rec.rounds} rounds.</>}
              </p>
            ) : rec ? (
              <p className={s.fact}>No one has told Seen about interviewing at {company} yet. When you hear back, your answer helps the next person.</p>
            ) : (
              <p className={s.factDim}>Reading what applicants report about {company}…</p>
            )}
            {!!rec?.process?.length && (
              <p className={s.fact}>Applicants to {company} mention {processLine(rec.process)}.</p>
            )}
            {data?.pay && (
              <p className={s.fact}>{data.pay.scope === 'market' ? <>Pay for this job at other employers on Seen ({poss(company)} listings don&apos;t say): </> : <>Pay on {poss(company)} {data.pay.scope === 'role' ? 'similar ' : ''}listings: </>}<b>{money(data.pay)}</b> <span className={s.dim}>({data.pay.listings} listings)</span></p>
            )}
            {pickDay}
            {fu ? (
              <p className={s.fact}>Send a thank-you by <b>{day(fu.thankYouBy)}</b>. No word? Follow up <b>{day(fu.followUpOn)}</b>, and once more <b>{day(fu.lastCheckOn)}</b>.</p>
            ) : (
              <p className={s.factDim}>Add the date and Seen times your thank-you and follow-ups.</p>
            )}
            {!!rec?.quotes?.length && (
              <details className={s.quotes}>
                <summary>What applicants said ({rec.quotes.length})</summary>
                {rec.quotes.map((q, i) => (
                  <blockquote key={i} className={s.quote}>
                    “{q.text}”
                    <span className={s.qsrc}>{q.role ? `${q.role} · ` : ''}{q.source || 'applicant account'}</span>
                  </blockquote>
                ))}
              </details>
            )}
          </div>

          {/* PAID — the prep pack */}
          {pack ? (
            <PackView pack={pack} company={company} fu={fu} onFill={saveFill} onRebuild={(text) => { setPostingBoth(text); void build({ refresh: true, jobText: text }) }} building={state === 'building'} />
          ) : (
            <div className={s.offer}>
              <div className={s.offerTitle}>Walk in ready for {company}</div>
              {preview && preview.questions.length > 0 ? (
                <div className={s.sample} data-testid="prep-preview">
                  <div className={s.label}>Free preview of your prep{preview.total_questions ? ` · ${preview.total_questions} questions${preview.practice_items ? ` and ${preview.practice_items} practice ${preview.practice_items === 1 ? 'item' : 'items'}` : ''} in the full prep` : ''}</div>
                  {preview.questions.map((q, i) => (
                    <div key={i} className={s.previewQ}><b>{q.company && <span className={s.chip}>{company}</span>}{q.q}</b><span className={s.why}>{q.why}</span></div>
                  ))}
                  {preview.answer && (
                    <div className={s.previewA}>
                      <div className={s.label}>A story from your résumé — you finish the [blank] on the card</div>
                      <b>{preview.answer.q}</b>
                      <span className={s.prose}>{preview.answer.answer}</span>
                    </div>
                  )}
                </div>
              ) : (
                <div className={s.sample}>
                  <div className={s.label}>A question from your prep</div>
                  <b>{'company' in sample && sample.company && <span className={s.chip}>{company}</span>}{sample.q}</b>
                  <span className={s.why}>{sample.why}</span>
                </div>
              )}
              <div className={s.label} style={{ marginTop: '.2rem' }}>The full prep</div>
              <ul className={s.list}>
                {guide ? <li>{guide.questions} questions {guide.company} is known for{guide.framework ? `, each tied to ${guide.framework.name}` : ''}, plus the ones for {role ? `${article(role)} ${role}` : 'this role'}</li> : <li>Likely questions for {role ? `${article(role)} ${role}` : 'this role'}, and what each one checks</li>}
                <li>Answers built from <b>your</b> résumé — no invented jobs or numbers. You finish each one in your own words on the card, and it stays yours</li>
                <li>Your 30-second “tell me about yourself”</li>
                <li>What the posting asks for, and your proof or your honest answer for each</li>
                <li>Thank-you and follow-up emails, ready to send on the right day</li>
              </ul>
              {!jobId && !guest && (
                <label className={s.paste}>
                  <span>Paste the job posting (optional — it makes the questions match this exact job; it is kept if you buy)</span>
                  <textarea rows={3} value={posting} onChange={e => setPostingBoth(e.target.value)} autoComplete="off" />
                </label>
              )}
              {guest ? (
                <>
                  <Link href={signupHref({ intent: 'prep', company, next: '/tracker' })} onClick={() => funnelEvent('offer_clicked', { surface: 'tracker_prep', sku: 'interview', company })} className={s.cta} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none' }}>Make a free account to get your prep →</Link>
                  <p className={s.fine}>Free. Your tracker comes with you. The prep itself is {PRICE} once.</p>
                </>
              ) : state === 'need_resume' || hasResume === false ? (
                <p className={s.fact}>Your answers are built from your résumé, so add it first (free). <Link href="/resume?back=tracker" className={s.link}>Add your résumé →</Link></p>
              ) : isPro ? (
                <button type="button" className={s.cta} disabled={state === 'building'} onClick={() => void build()}>
                  {state === 'building' ? 'Building your prep…' : 'Build my prep →'}
                </button>
              ) : (
                <>
                  <button type="button" className={s.cta} disabled={checkout.busy !== null} onClick={() => buy('interview')} data-testid="prep-buy">
                    {checkout.busy === 'interview' ? 'Opening checkout…' : `Get my prep — ${PRICE}`}
                  </button>
                  <p className={s.fine}>{ONE_TIME_NOTE}. Includes {SKU.pro_days} days of Seen Pro.</p>
                  <div className={s.passAlt} data-testid="prep-pass-alt">
                    <span>Interviewing at more than one place? The <b>{PASS.name}</b> ({PASS_PRICE}) covers every interview for {PASS.pro_days} days.</span>
                    <button type="button" className={s.passBtn} disabled={checkout.busy !== null} onClick={() => buy('pass30')}>
                      {checkout.busy === 'pass30' ? 'Opening checkout…' : `Get the pass — ${PASS_PRICE}`}
                    </button>
                    <span className={s.fine} style={{ margin: 0 }}>{ONE_TIME_NOTE}</span>
                  </div>
                </>
              )}
              {(err || checkout.error) && <p className={s.err} role="alert">{err || checkout.error}</p>}
            </div>
          )}
        </>
      )}
    </section>
  )
}

const MATCH_WORD = { shown: 'your résumé shows it', stated: 'listed, not shown in a line', gap: 'not on your résumé', expired: 'lapsed', 'in progress': 'in progress' } as const

// One answer: the résumé's words as text, each [blank] as a field; the finished answer below once typed.
// A box grows with what is typed; it starts two lines tall so the prompt inside it can be read (round 4: one-
// line boxes clipped the only instruction, and three-sentence stories).
function grow(el: HTMLTextAreaElement | null) { if (!el) return; el.style.height = 'auto'; el.style.height = `${Math.max(el.scrollHeight, 56)}px` }
function AnswerEditor({ a, company, values, notes, onSave, defaultOpen, title, tagText, pre }: { a: Answer; company: string; values: string[]; notes?: string[]; onSave: (values: string[], urgent?: boolean) => void; defaultOpen: boolean; title?: string; tagText?: string; pre?: boolean }) {
  const [vals, setVals] = useState<string[]>(values)
  // What the account holds only replaces what is typed here when it is NEW (another device, a rebuild) —
  // never because the parent re-rendered with the same words, and never over a box still being typed in
  // (round 5, Ray: the first of three boxes typed in a row came back empty; a pay answer never saved).
  const seen = useRef(values.join('\u0000'))
  const saved = useRef(values.join('\u0000'))
  // the sentence the boxes belong to: when a rebuild changes it, the words typed into the OLD sentence are not
  // kept in the new one (round 6, Dev: a redrafted pay answer showed "✓ finished" with the old typed words while
  // the server had moved them to notes — the screen lied until a reload)
  const sentence = useRef(a.answer)
  useEffect(() => {
    const key = values.join('\u0000')
    if (sentence.current !== a.answer) {
      sentence.current = a.answer; seen.current = key; saved.current = key
      setVals(values); latest.current = values
      return
    }
    if (key === seen.current) return
    seen.current = key
    setVals(prev => values.map((v, i) => (prev[i]?.trim() && !v?.trim() ? prev[i] : v)).concat(prev.slice(values.length)))
  }, [values, a.answer])
  const latest = useRef(vals)
  latest.current = vals
  // typing saves on its own after a pause, so a tab or a reload mid-answer loses nothing
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flush = useCallback((urgent = false) => { const v = latest.current; const key = v.join('\u0000'); if (key !== saved.current) { saved.current = key; onSave(v, urgent) } }, [onSave])
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  // leaving the page (a reload, a tab switch, the phone's back button) saves what is typed, timer or not
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') { if (timer.current) clearTimeout(timer.current); flush(true) } }
    const onPageHide = () => { if (timer.current) clearTimeout(timer.current); flush(true) }
    document.addEventListener('visibilitychange', onHide); window.addEventListener('pagehide', onPageHide)
    return () => { document.removeEventListener('visibilitychange', onHide); window.removeEventListener('pagehide', onPageHide) }
  }, [flush])
  const parts = splitAnswer(a.answer)
  const n = blankCount(a.answer)
  const finished = isFinished(a.answer, vals)
  const composed = composeAnswer(a.answer, vals)
  const touched = vals.some(v => v && v.trim())
  const tag = tagText || (a.exercise ? 'Practised at a keyboard, not answered out loud' : a.company ? `${company} question${a.principle ? ` · ${a.principle}` : ''}` : a.script ? 'From your résumé’s dates and the posting' : a.frame ? `No line on your résumé fits this one yet — answer in ${n} short lines` : 'From your résumé')
  const save = () => { if (timer.current) clearTimeout(timer.current); flush() }
  const queue = () => { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => flush(), 600) }
  return (
    <details className={`${s.answer}${finished && n ? ` ${s.done}` : ''}`} open={defaultOpen}>
      <summary>{a.company && <span className={s.chip}>{company}</span>}{title || a.q}{n > 0 && <span className={s.state}>{finished ? '✓ finished' : touched ? `${vals.filter(v => v?.trim()).length}/${n} filled` : `${n} ${n === 1 ? 'blank' : 'blanks'} to fill`}</span>}</summary>
      <p className={s.tag}>{tag}</p>
      {a.exercise ? (
        <p className={s.prose}>{a.practice}</p>
      ) : (
        <div className={s.editor}>
          {parts.map((p, i) => ('blank' in p ? (
            <textarea key={i} ref={grow} className={s.fill} rows={2} value={vals[p.index] || ''} placeholder={p.blank} aria-label={p.blank}
              onChange={e => { const next = [...vals]; next[p.index] = e.target.value; setVals(next); latest.current = next; grow(e.target); queue() }} onBlur={save} />
          ) : (
            <span key={i} className={pre ? s.givenPre : s.given}>{p.text}</span>
          )))}
        </div>
      )}
      {a.reference && <p className={s.ref}>{a.reference}</p>}
      {a.hint && !touched && <p className={s.ref}>A line of yours that might hold this story: “{a.hint}” — if it does, tell it in the three boxes above.</p>}
      {!!notes?.length && (
        <div className={s.notes}>
          <div className={s.label}>Your words from before the rebuild</div>
          <p className={s.dim} style={{ margin: '0 0 .3rem' }}>This answer changed when the posting changed, so what you typed is kept here for you to reuse — not shown as finished.</p>
          {notes.map((t, i) => <p key={i} className={s.prose}>{t}</p>)}
          <CopyBtn text={notes.join('\n')} />
        </div>
      )}
      {touched && (
        <div className={s.finished}>
          <div className={s.label}>{finished ? 'Your finished answer' : 'Your answer so far'}</div>
          {pre ? <pre className={s.email}>{composed}</pre> : <p className={s.prose}>{composed}</p>}
          <CopyBtn text={composed} />
        </div>
      )}
      {a.resume_fact && <span className={s.dim}>Built on: “{a.resume_fact}”</span>}
    </details>
  )
}

function PackView({ pack, company, fu, onFill, onRebuild, building }: { pack: Pack; company: string; fu: FollowUp | null | undefined; onFill: (q: string, values: string[]) => void; onRebuild: (posting: string) => void; building: boolean }) {
  const intro = pack.intro
  const fills = pack.fills || {}
  const notes = pack.notes || {}
  const special = new Set([INTRO_KEY, THANKS_KEY, FOLLOW_KEY])
  const orphanNotes = Object.entries(notes).filter(([q, v]) => v?.length && !special.has(q) && !pack.answers.some(a => a.q === q))
  const done = pack.answers.filter(a => !a.exercise && isFinished(a.answer, fills[a.q] || [])).length
  const [addPosting, setAddPosting] = useState('')
  const [editing, setEditing] = useState(false)
  const needsPosting = !pack.job_text && !(pack.job_match && pack.job_match.length)
  return (
    <div className={s.pack}>
      <div className={s.offerTitle}>Your prep for {company}</div>
      {pack.guide && (
        <div className={s.block}>
          <div className={s.label}>How {pack.guide.company} interviews</div>
          {pack.format && <p className={s.prose}>{pack.format}</p>}
          {pack.guide.framework && <p className={s.prose}><b>{pack.guide.framework.name}.</b> {pack.guide.framework.note}</p>}
          {!!pack.guide.tips?.length && (
            <ul className={s.qs}>
              {pack.guide.tips.map((t, i) => <li key={i}>{t}</li>)}
            </ul>
          )}
          {pack.guide.watch && <p className={s.watch}>Watch out: {pack.guide.watch}</p>}
          <p className={s.dim}>From {poss(pack.guide.company)} own hiring pages and consistent public accounts — how it usually runs, not a guarantee. Your recruiter&apos;s email wins.</p>
        </div>
      )}
      {!!pack.resume_check?.length && (
        <div className={s.block}>
          <div className={s.label}>Fix on your résumé before the interview</div>
          <ul className={s.qs}>
            {pack.resume_check.map((c, i) => (
              <li key={i}><strong>“{c.line}”</strong> — {c.note}</li>
            ))}
          </ul>
        </div>
      )}
      {intro && (
        <div className={s.block}>
          <div className={s.label}>Your 30-second intro</div>
          {blankCount(intro) ? (
            <AnswerEditor a={{ q: INTRO_KEY, answer: intro, resume_fact: '' }} title="Tell me about yourself" tagText="From your résumé — finish the one line only you know" company={company} values={fills[INTRO_KEY] || []} notes={notes[INTRO_KEY]} onSave={vals => onFill(INTRO_KEY, vals)} defaultOpen />
          ) : (
            <><p className={s.prose}>{intro}</p><CopyBtn text={intro} /></>
          )}
        </div>
      )}
      <div className={s.block}>
        <div className={s.label}>Your answers · {done}/{pack.answers.filter(a => !a.exercise).length} finished</div>
        <p className={s.dim} style={{ margin: '0 0 .45rem' }}>Every answer starts from your résumé or the posting. Type the part only you know into each blank, and the finished answer is yours — saved here, on every device.</p>
        {pack.answers.map((a, i) => (
          <AnswerEditor key={a.q} a={a} company={company} values={fills[a.q] || []} notes={notes[a.q]} onSave={vals => onFill(a.q, vals)} defaultOpen={i === 0} />
        ))}
        {orphanNotes.length > 0 && (
          <div className={s.notes}>
            <div className={s.label}>Your words for questions no longer on the card</div>
            {orphanNotes.map(([q, vals]) => (
              <div key={q} style={{ marginBottom: '.4rem' }}><b className={s.prose}>{q}</b>{vals.map((t, i) => <p key={i} className={s.prose}>{t}</p>)}<CopyBtn text={vals.join('\n')} /></div>
            ))}
          </div>
        )}
      </div>
      {!!pack.job_match?.length && (
        <div className={s.block}>
          <div className={s.label}>What this job asks for — and your answer</div>
          {pack.posting_pay && <p className={s.fact}>This posting lists <b>{pack.posting_pay}</b>.</p>}
          <ul className={s.qs}>
            {pack.job_match.map((m, i) => (
              <li key={i}>
                <b>{m.label}</b> <span className={s.dim}>· {MATCH_WORD[m.status]}</span>
                {m.proof ? <span className={s.why}>Your line: “{m.proof}”</span> : <span className={s.why}>{m.say}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {(needsPosting || editing) ? (
        <div className={s.block}>
          <div className={s.label}>{needsPosting ? 'What this job asks for' : 'The posting this prep was built from'}</div>
          <label className={s.paste}>
            <span>{needsPosting ? 'Paste the job posting and Seen adds each requirement with your proof line, or your honest answer for a gap, and rebuilds the questions to match.' : 'Change the posting and rebuild.'} Your finished answers are kept where their sentence is unchanged; the rest are kept as your notes.</span>
            <textarea rows={needsPosting ? 3 : 6} value={addPosting} onChange={e => setAddPosting(e.target.value)} autoComplete="off" />
          </label>
          <button type="button" className={s.passBtn} disabled={building || addPosting.trim().length < 80 || (!needsPosting && addPosting.trim() === String(pack.job_text || '').trim())} onClick={() => onRebuild(addPosting)}>
            {building ? 'Rebuilding…' : needsPosting ? 'Add the posting and rebuild →' : 'Rebuild with this posting →'}
          </button>
        </div>
      ) : (
        // the posting can be changed after a build (round 5, Tasha: no way to touch it once built)
        <p className={s.dim}><button type="button" className={s.copy} onClick={() => { setAddPosting(String(pack.job_text || '')); setEditing(true) }}>Edit the posting and rebuild</button></p>
      )}
      {!!pack.format && !pack.guide && (
        <div className={s.block}>
          <div className={s.label}>How this interview usually runs</div>
          <p className={s.prose}>{pack.format}</p>
        </div>
      )}
      {!!pack.ask_them?.length && (
        <div className={s.block}>
          <div className={s.label}>Questions to ask them</div>
          <ul className={s.qs}>
            {pack.ask_them.map((q, i) => <li key={i}>{q.company && <span className={s.chip}>{company}</span>}{q.q}</li>)}
          </ul>
        </div>
      )}
      <div className={s.block}>
        <div className={s.label}>Emails</div>
        <p className={s.mono}>Subject: {pack.emails.thankYou.subject}</p>
        <AnswerEditor pre a={{ q: THANKS_KEY, answer: pack.emails.thankYou.body, resume_fact: '' }} title={`Thank-you · ${fu ? `send by ${day(fu.thankYouBy)}` : 'send within a day of the interview'}`} tagText="Fill in the name and the one thing they told you; the finished email is below" company={company} values={fills[THANKS_KEY] || []} notes={notes[THANKS_KEY]} onSave={vals => onFill(THANKS_KEY, vals)} defaultOpen={false} />
        <p className={s.mono}>Subject: {pack.emails.followUp.subject}</p>
        <AnswerEditor pre a={{ q: FOLLOW_KEY, answer: pack.emails.followUp.body, resume_fact: '' }} title={`Follow-up · ${fu ? `send ${day(fu.followUpOn)}` : 'send 5 working days after'} if you have not heard back`} tagText="Fill in the name; the finished email is below" company={company} values={fills[FOLLOW_KEY] || []} notes={notes[FOLLOW_KEY]} onSave={vals => onFill(FOLLOW_KEY, vals)} defaultOpen={false} />
      </div>
    </div>
  )
}

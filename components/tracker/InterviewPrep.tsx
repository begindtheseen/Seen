'use client'

// Interview Prep on a tracker card (owner decision 2026-10-25). It appears the moment an application
// reaches Phone Screen / Interview / Final Round — the one moment all four willingness-to-pay test users
// said they would pay. The top half is FREE and comes from Seen's own data (what happened to applicants
// after interviewing at this company, the pay on its listings, when to follow up). The prep pack itself —
// questions, answers built from the person's résumé, intro, emails — is $9.99 once (14 days of Pro), or
// free for anyone who already has Pro. Server: api/interview-prep.js, lib/server/interviewPrep.js.

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { aiHeaders } from '@/lib/aiHeaders'
import { ONE_TIME_SKUS } from '@/lib/creditRules'
import { signupHref } from '@/lib/signupIntent.js'
import s from './InterviewPrep.module.css'

const SKU = ONE_TIME_SKUS.interview
const PRICE = `$${(SKU.amount_cents / 100).toFixed(2)}`

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
}
type Pay = { unit: 'hour' | 'year'; low: number; high: number; listings: number; scope: 'role' | 'company' }
type FollowUp = { thankYouBy: string; followUpOn: string; lastCheckOn: string }
type Pack = {
  questions: { q: string; why: string }[]
  answers: { q: string; answer: string; resume_fact: string; coached?: boolean }[]
  intro: string | null
  resume_check?: { line: string; note: string }[]
  emails: { thankYou: { subject: string; body: string }; followUp: { subject: string; body: string } }
  follow_up: FollowUp
}

// One read per company + role per page view, shared by every card that names it.
const recordCache = new Map<string, Promise<{ record: InterviewRecord; pay: Pay | null; follow_up: FollowUp } | null>>()
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

function beacon(event: string, company: string) {
  aiHeaders().then(h => fetch('/api/interview-prep', { method: 'POST', headers: h, body: JSON.stringify({ action: 'event', event, company }), keepalive: true })).catch(() => {})
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
const article = (w: string) => (/^[aeiou]/i.test(w.trim()) ? 'an' : 'a')

const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', month: 'short', day: 'numeric' })
const money = (p: Pay) => p.unit === 'hour'
  ? `$${p.low % 1 ? p.low.toFixed(2) : p.low}–$${p.high % 1 ? p.high.toFixed(2) : p.high}/hr`
  : `$${Math.round(p.low / 1000)}k–$${Math.round(p.high / 1000)}k/yr`

function CopyBtn({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false)
  return (
    <button type="button" className={s.copy} onClick={() => { navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1600) }).catch(() => {}) }}>
      {done ? 'Copied ✓' : label}
    </button>
  )
}

export default function InterviewPrep({ appId, company, role, interviewAt, isPro, autoBuild, jobId, stage, onSchedule, guest = false }: {
  /** A guest on this device: the free record and date work; the prep needs a free account first. */
  guest?: boolean
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
  const [data, setData] = useState<{ record: InterviewRecord; pay: Pay | null; follow_up: FollowUp } | null>(null)
  const [open, setOpen] = useState(true)
  const [pack, setPack] = useState<Pack | null>(null)
  const [state, setState] = useState<'idle' | 'building' | 'buying' | 'need_resume' | 'error'>('idle')
  const [err, setErr] = useState('')
  const shown = useRef(false)
  const built = useRef(false)
  const [hasResume, setHasResume] = useState<boolean | null>(null)
  const [posting, setPosting] = useState('')

  useEffect(() => {
    let live = true
    loadRecord(company, role, interviewAt).then(d => { if (live && d?.record) setData(d) })
    return () => { live = false }
  }, [company, role, interviewAt])

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
    }).catch(() => {})
    return () => { live = false }
  }, [company, role, guest])

  // Count the offer once per card per browser session (the funnel's "offer shown" step).
  useEffect(() => {
    if (shown.current || isPro) return
    shown.current = true
    const k = `seen_prep_shown_${appId}`
    try { if (sessionStorage.getItem(k)) return; sessionStorage.setItem(k, '1') } catch { /* private mode */ }
    beacon('prep_offer_shown', company)
  }, [appId, company, isPro])

  async function build() {
    setState('building'); setErr('')
    try {
      const h = await aiHeaders()
      const r = await fetch('/api/interview-prep', { method: 'POST', headers: h, body: JSON.stringify({ action: 'build', company, role, application_id: appId, interview_at: interviewAt, job_id: jobId || '', job_text: posting.trim().slice(0, 6000), stage }) })
      const d = await r.json().catch(() => ({}))
      if (r.status === 409 && d.need_resume) { setState('need_resume'); return }
      if (r.status === 402) { setState('idle'); setErr('This needs Interview Prep or Pro.'); return }
      if (!r.ok || !d.pack) { setState('error'); setErr(d.error || 'Could not build your prep right now — try again in a minute.'); return }
      setPack(d.pack); setState('idle')
    } catch {
      setState('error'); setErr('Network error — check your connection and try again.')
    }
  }

  useEffect(() => {
    if (autoBuild && isPro && !built.current) { built.current = true; build() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoBuild, isPro])

  async function buy() {
    setState('buying'); setErr('')
    beacon('prep_offer_clicked', company)
    try {
      const h = await aiHeaders()
      const r = await fetch('/api/stripe?action=checkout', { method: 'POST', headers: h, body: JSON.stringify({ sku: 'interview', application_id: appId, company, role }) })
      const d = await r.json().catch(() => ({}))
      if (d.url) { window.location.href = d.url; return }
      setState('error'); setErr(d.error || 'Checkout is unavailable right now — try again.')
    } catch {
      setState('error'); setErr('Network error — check your connection and try again.')
    }
  }

  const rec = data?.record
  // Dated advice only for a dated interview (round 2: "send a thank-you by Mon" before a Thursday screen).
  const fu = interviewAt ? data?.follow_up : null
  const pickDay = (
    <label className={s.dateRow}>
      <span>When is your interview?</span>
      <input type="date" className={s.date} value={interviewAt ? interviewAt.slice(0, 10) : ''}
        onChange={e => { if (e.target.value) onSchedule(new Date(`${e.target.value}T19:00:00Z`).toISOString()) }} />
    </label>
  )
  // One real question for free, so the offer is not a blind buy (round 2: "nothing to preview").
  const sample = data?.pay
    ? { q: 'What are your pay expectations?', why: `${company}'s similar listings on Seen pay about ${money(data.pay)}. Give a range you would accept.` }
    : { q: `What do you know about ${company}?`, why: 'Name what they sell, who their customers are, and one recent thing you read about them.' }

  return (
    <section className={s.box} onClick={e => e.stopPropagation()} aria-label={`Interview prep for ${company}`}>
      <button type="button" className={s.head} aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className={s.kicker}>🎯 Interview at {company}</span>
        <span className={s.toggle}>{open ? 'Hide' : 'Show'}</span>
      </button>

      {open && (
        <>
          {/* FREE — Seen's own data, for everyone */}
          <div className={s.facts}>
            {rec && rec.accounts > 0 ? (
              <p className={s.fact}>
                <b>{rec.accounts} {rec.accounts === 1 ? 'account' : 'accounts'}</b> of interviewing at {company} on Seen
                {afterLine(rec.after) && <>: {afterLine(rec.after)}</>}.
                {rec.ghostedAfterInterviewPct != null && rec.ghostedAfterInterviewPct >= 20 && <> {rec.ghostedAfterInterviewPct}% were ghosted after interviewing — follow up on time.</>}
                {rec.rounds != null && rec.rounds > 1 && <> Usually {rec.rounds} rounds.</>}
              </p>
            ) : rec ? (
              <p className={s.fact}>No one has told Seen about interviewing at {company} yet. When you hear back, your answer helps the next person.</p>
            ) : (
              <p className={s.factDim}>Reading what applicants report about {company}…</p>
            )}
            {data?.pay && (
              <p className={s.fact}>Pay on {company}&apos;s {data.pay.scope === 'role' ? 'similar ' : ''}listings: <b>{money(data.pay)}</b> <span className={s.dim}>({data.pay.listings} listings)</span></p>
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
                    <span className={s.qsrc}>{q.role ? `${q.role} · ` : ''}{q.source || 'applicant report'}</span>
                  </blockquote>
                ))}
              </details>
            )}
          </div>

          {/* PAID — the prep pack */}
          {pack ? (
            <PackView pack={pack} company={company} fu={fu} />
          ) : (
            <div className={s.offer}>
              <div className={s.offerTitle}>Walk in ready for {company}</div>
              <div className={s.sample}>
                <div className={s.label}>A question from your prep</div>
                <b>{sample.q}</b>
                <span className={s.why}>{sample.why}</span>
              </div>
              <ul className={s.list}>
                <li>Likely questions for {role ? `${article(role)} ${role}` : 'this role'}, and what each one checks</li>
                <li>Answers built from <b>your</b> résumé — no invented jobs or numbers</li>
                <li>Your 30-second “tell me about yourself”</li>
                <li>Thank-you and follow-up emails, ready to send on the right day</li>
              </ul>
              {!jobId && !guest && (
                <label className={s.paste}>
                  <span>Paste the job posting (optional — it makes the questions match this exact job)</span>
                  <textarea rows={3} value={posting} onChange={e => setPosting(e.target.value)} autoComplete="off" />
                </label>
              )}
              {guest ? (
                <>
                  <Link href={signupHref({ next: '/tracker' })} className={s.cta} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none' }}>Make a free account to get your prep →</Link>
                  <p className={s.fine}>Free. Your tracker comes with you. The prep itself is {PRICE} once.</p>
                </>
              ) : state === 'need_resume' || hasResume === false ? (
                <p className={s.fact}>Your answers are built from your résumé, so add it first (free). <Link href="/resume?back=tracker" className={s.link}>Add your résumé →</Link></p>
              ) : isPro ? (
                <button type="button" className={s.cta} disabled={state === 'building'} onClick={build}>
                  {state === 'building' ? 'Building and fact-checking your prep… (about a minute)' : 'Build my prep →'}
                </button>
              ) : (
                <>
                  <button type="button" className={s.cta} disabled={state === 'buying'} onClick={buy}>
                    {state === 'buying' ? 'Opening checkout…' : `Get my prep — ${PRICE}`}
                  </button>
                  <p className={s.fine}>One-time, never renews. Includes {SKU.pro_days} days of Seen Pro.</p>
                </>
              )}
              {err && <p className={s.err} role="alert">{err}</p>}
            </div>
          )}
        </>
      )}
    </section>
  )
}

function PackView({ pack, company, fu }: { pack: Pack; company: string; fu: FollowUp | null | undefined }) {
  const intro = pack.intro
  return (
    <div className={s.pack}>
      <div className={s.offerTitle}>Your prep for {company}</div>
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
          <p className={s.prose}>{intro}</p>
          <CopyBtn text={intro} />
        </div>
      )}
      <div className={s.block}>
        <div className={s.label}>Likely questions · prepared by Seen for this role</div>
        <ol className={s.qs}>
          {pack.questions.map((q, i) => (
            <li key={i}><b>{q.q}</b>{q.why && <span className={s.why}>{q.why}</span>}</li>
          ))}
        </ol>
      </div>
      <div className={s.block}>
        <div className={s.label}>Answers from your résumé</div>
        <p className={s.dim} style={{ margin: '0 0 .45rem' }}>Fill in anything in [brackets], practise them out loud, and change any detail that isn&apos;t exactly what happened.</p>
        {pack.answers.map((a, i) => (
          <details key={i} className={s.answer} open={i === 0}>
            <summary>{a.q}</summary>
            <p className={s.prose}>{a.answer}</p>
            <span className={s.dim}>Built on: “{a.resume_fact}”</span>
          </details>
        ))}
      </div>
      <div className={s.block}>
        <div className={s.label}>Emails</div>
        <details className={s.answer}>
          <summary>Thank-you · {fu ? `send by ${day(fu.thankYouBy)}` : 'send within a day of the interview'}</summary>
          <p className={s.mono}>Subject: {pack.emails.thankYou.subject}</p>
          <pre className={s.email}>{pack.emails.thankYou.body}</pre>
          <CopyBtn text={`Subject: ${pack.emails.thankYou.subject}\n\n${pack.emails.thankYou.body}`} />
        </details>
        <details className={s.answer}>
          <summary>Follow-up · {fu ? `send ${day(fu.followUpOn)}` : 'send 5 working days after'} if you have not heard back</summary>
          <p className={s.mono}>Subject: {pack.emails.followUp.subject}</p>
          <pre className={s.email}>{pack.emails.followUp.body}</pre>
          <CopyBtn text={`Subject: ${pack.emails.followUp.subject}\n\n${pack.emails.followUp.body}`} />
        </details>
      </div>
    </div>
  )
}

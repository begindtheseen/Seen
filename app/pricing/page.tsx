'use client'

// /pricing — one clear menu (owner decisions 2026-10-25):
//   Free forever (no card) · Interview Prep, the lead product, for one interview · the 30-day Job Search
//   Pass, which covers every interview in those 30 days. Both paid products are one-time and never renew.
// There is no subscription and no trial to start. Someone still on a Seen Pro subscription started
// before the change manages it here (cancel / resume — api/stripe.js subscription_status etc.).
// Every price renders from lib/server/creditRules.js through lib/pricing.ts (lib/pricing.test.mjs fails
// on a hand-typed price). No "most popular", no decoy, no countdown, no discount (research 2026-10-25).

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth'
import { aiHeaders } from '@/lib/aiHeaders'
import { signupHref } from '@/lib/signupIntent.js'
import { FREE_DAILY_CREDITS, WELCOME_CREDITS, MAX_DAILY_EARN, CREDIT_RESET_LABEL, ONE_TIME_SKUS } from '@/lib/creditRules'
import { REPORT_REWARD_PRO_DAYS, REPORT_REWARD_MONTHLY_CAP_DAYS, REPORT_REWARD_MIN_TRACKED_DAYS, REFERRAL_REWARD_PRO_DAYS, REFERRAL_MAX_REWARDED, dayWord, proDaysLabel } from '@/lib/creditRules'
import { PREP, PASS, PREP_PRICE, PASS_PRICE, ONE_TIME_NOTE, FREE_FOREVER, FREE_LINE, PREP_INCLUDES, PASS_INCLUDES, type OfferSku } from '@/lib/pricing'
import { useCheckout } from '@/lib/useCheckout'
import { funnelEvent } from '@/lib/funnel'
import { formatPacific } from '@/lib/time/pacific.js'
import Icon from '@/components/ui/Icon'
import s from './pricing.module.css'

const CREDIT_WORD = FREE_DAILY_CREDITS === 1 ? 'credit' : 'credits'

const FAQ: { id?: string; q: string; a: string }[] = [
  { q: 'What is free?', a: `Company grades and ghost rates, what applicants report about each company, the tracker and its day 7, 14 and 30 check-ins, job search, and the résumé match that shows what a job asks for that your résumé is missing. Free forever, no card. You also get ${FREE_DAILY_CREDITS} free AI ${CREDIT_WORD} a day (reset at ${CREDIT_RESET_LABEL}) for tools like tailoring your résumé to a job, plus a ${WELCOME_CREDITS}-credit welcome bonus the day you first use one.` },
  { q: `What is ${PREP.name}?`, a: `When an application on your tracker reaches an interview, Seen shows what applicants report about interviewing at that company, the pay on its listings and when to follow up — free — with a free preview of your prep. ${PREP.name} (${PREP_PRICE}, once) adds likely questions for the role, answers built only from your own résumé, a 30-second intro, and thank-you and follow-up emails. It also opens ${PREP.pro_days} days of Pro, so another interview in those days gets its prep too.` },
  { q: `What does the ${PASS.name} include?`, a: `${PASS.pro_days} days of everything in Seen Pro for ${PASS_PRICE}, once: ${PREP.name} for every interview in those days, a résumé tailored to every job you apply to with no daily limit, job insights on any listing with a full description, HumanProof rewrites, AI polish in Résumé Studio and downloads without the Seen footer. If you buy it while you still have Pro time, the ${PASS.pro_days} days are added after the time you have.` },
  { q: 'Does anything renew?', a: `No. ${PREP.name} and the ${PASS.name} are one payment each. When the time runs out, access simply ends — there is no subscription to cancel and nothing is charged again.` },
  { q: 'Which one should I get?', a: `One interview coming up: ${PREP.name}, from that application's card on your tracker, where it is built for that company and role. Interviewing at more than one place, or tailoring a résumé for many jobs: the ${PASS.name} covers all of it for ${PASS.pro_days} days.` },
  { q: 'What is HumanProof?', a: 'AI-written résumé lines often sound generic. HumanProof rewrites your optimized bullets so they read like you — varied sentences, natural rhythm, every keyword kept, nothing added that your résumé does not say. With Pro access, every résumé optimization also comes back in that voice.' },
  { q: 'Does paying change a company’s grade?', a: 'Never. Grades come only from what applicants report. No employer and no job seeker can pay to change a score.' },
  { id: 'get-pro-free', q: 'Can I get Pro without paying?', a: `Yes. Report what happened with an application on your tracker and get ${proDaysLabel(REPORT_REWARD_PRO_DAYS)}, once per application that has been on your tracker for at least ${dayWord(REPORT_REWARD_MIN_TRACKED_DAYS)}, up to ${dayWord(REPORT_REWARD_MONTHLY_CAP_DAYS)} a month. Every outcome earns the same. Invite a friend with your link from the dashboard: when they track their first application, you both get ${proDaysLabel(REFERRAL_REWARD_PRO_DAYS)} (you are rewarded for up to ${REFERRAL_MAX_REWARDED} friends). Earned time is added on top of any you have, and it never renews or charges you.` },
  { q: 'How do free AI credits work?', a: `You get ${FREE_DAILY_CREDITS} free AI ${CREDIT_WORD} a day, reset at ${CREDIT_RESET_LABEL} (California time), and a ${WELCOME_CREDITS}-credit welcome bonus the first day you use an AI tool. Every button that spends one says so. Uploading your résumé, checking your fit for a job and reading insights someone already generated are free. You can earn up to ${MAX_DAILY_EARN} more a day by tracking the jobs you apply to from Seen and answering quick surveys. With Pro access there is no daily limit.` },
  { q: 'I already have a Seen Pro subscription. What happens to it?', a: 'Nothing changes for you: it keeps the price and renewal date you signed up with until you cancel, and you can cancel any time here or in Settings → Plan & billing. You keep Pro to the end of the period you paid for. Seen no longer starts new subscriptions or trials.' },
  // What the code does (api/user-sync.js save_resume → profiles.resume_text; delete_resume / delete_account
  // clear it): the résumé is STORED on the profile.
  { q: 'Is my data sold to employers?', a: 'Never. We work for job seekers. Your résumé is stored on your profile so your own tools can use it — job matching, fit scores and rewrites — until you replace it or delete your account (both in Settings). It is never shown to, shared with, or sold to recruiters or employers unless you send it with an application through Seen, and nothing else about you is either.' },
]

type Sub = { status: string; cancel_at_period_end: boolean; current_period_end: number | null; amount: number | null; interval: string | null }

export default function PricingPage() {
  const router = useRouter()
  const { isLoggedIn } = useAuth()
  const { start, busy, error, setError } = useCheckout('pricing', { isLoggedIn })
  const [upgraded, setUpgraded] = useState(false)
  // Which one-time SKU the user just bought — drives the success-screen copy.
  const [purchasedSku, setPurchasedSku] = useState<string | null>(null)
  // null = unknown (optimistic), false = Stripe not wired up yet → an honest "not switched on" note
  // instead of a broken checkout. Flips to true once STRIPE_SECRET_KEY is set.
  const [paymentsEnabled, setPaymentsEnabled] = useState<boolean | null>(null)
  const [isPro, setIsPro] = useState(false)
  const [proUntil, setProUntil] = useState<string | null>(null)
  const [sub, setSub] = useState<Sub | null>(null)
  const [manageBusy, setManageBusy] = useState(false)

  // The Stripe return (?upgraded=1&purchase=&session_id=) is read from window.location after mount, so
  // the page itself is in the server HTML (no Suspense boundary turning it into a client render).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('upgraded') === '1') {
      setUpgraded(true)
      const bought = params.get('purchase')
      if (bought && ONE_TIME_SKUS[bought as keyof typeof ONE_TIME_SKUS]) setPurchasedSku(bought)
      // Fulfil on return without relying on the webhook: confirm verifies ownership and fulfils once
      // (it shares the webhook's idempotency claim).
      const sid = params.get('session_id')
      if (sid) {
        aiHeaders()
          .then(hdrs => fetch('/api/stripe?action=confirm', { method: 'POST', headers: hdrs, body: JSON.stringify({ session_id: sid }) }))
          .catch(() => { /* the webhook still covers it */ })
      }
      return
    }
    funnelEvent('pricing_view', { once: 'page' })
  }, [])

  // ?buy=<sku>: a guest pressed a buy button, signed up, and came back here — finish what they started.
  const buyResumed = useRef(false)
  useEffect(() => {
    if (!isLoggedIn || buyResumed.current) return
    const buy = new URLSearchParams(window.location.search).get('buy')
    if (buy !== 'interview' && buy !== 'pass30') return
    buyResumed.current = true
    try { window.history.replaceState(null, '', '/pricing') } catch { /* ignore */ }
    void start(buy)
  }, [isLoggedIn, start])

  useEffect(() => {
    fetch('/api/stripe?action=status')
      .then(r => r.json())
      .then(d => setPaymentsEnabled(!!d.payments_enabled))
      .catch(() => setPaymentsEnabled(true)) // optimistic on a network error — never hide a working checkout
  }, [])

  // Pro access from any source (a pass, Interview Prep's days, an earned reward, a comp, an old subscription).
  useEffect(() => {
    if (!isLoggedIn) { setIsPro(false); return }
    let alive = true
    ;(async () => {
      try {
        const h = await aiHeaders()
        const d = await fetch('/api/user-sync', { method: 'POST', headers: h, body: JSON.stringify({ action: 'get_credits' }) }).then(r => r.json())
        if (!alive || !d?.pro) return
        setIsPro(true)
        const st = await fetch('/api/stripe?action=subscription_status', { method: 'POST', headers: h, body: '{}' }).then(r => r.json())
        if (!alive) return
        setSub(st?.subscription || null)
        setProUntil(typeof st?.pro_until === 'string' ? st.pro_until : null)
        if (typeof st?.pro === 'boolean') setIsPro(st.pro)
      } catch { /* assume not Pro */ }
    })()
    return () => { alive = false }
  }, [isLoggedIn])

  // The offer is on screen (once per browser session) — only when it can be bought.
  const offerable = !isPro && paymentsEnabled !== false && !upgraded
  useEffect(() => {
    if (!offerable) return
    funnelEvent('offer_shown', { surface: 'pricing', once: 'pricing' })
  }, [offerable])

  // Cancel (at period end) or resume an existing subscription — in-app, no Stripe portal.
  async function manage(act: 'cancel_subscription' | 'resume_subscription') {
    setManageBusy(true); setError('')
    try {
      const r = await fetch(`/api/stripe?action=${act}`, { method: 'POST', headers: await aiHeaders(), body: '{}' })
      const d = await r.json()
      if (d?.ok) { setSub(d.subscription || null); if (typeof d?.pro === 'boolean') setIsPro(d.pro) }
      else setError(d?.error || 'Could not update your subscription — try again or email hello@seenjobs.io')
    } catch {
      setError('Network error — please try again')
    }
    setManageBusy(false)
  }

  if (upgraded) {
    const title = purchasedSku === 'interview' ? `${PREP.name} is on.`
      : purchasedSku === 'pass30' ? `Your ${PASS.name} is on.`
      : purchasedSku === 'credits20' ? 'Credits added.'
      : 'Your Pro access is on.'
    const body = purchasedSku === 'interview'
      ? `Open your tracker: every application at an interview stage now has a Build my prep button, and you have full Pro for the next ${PREP.pro_days} days. Nothing renews.`
      : purchasedSku === 'pass30'
      ? `You have everything in Seen Pro for ${PASS.pro_days} days, including ${PREP.name} for every interview on your tracker. It ends on its own — nothing renews.`
      : purchasedSku === 'credits20'
      ? `${ONE_TIME_SKUS.credits20.credits} AI credits are on your account. Purchased credits never expire. Nothing renews.`
      : 'Your Seen Pro access is active.'
    return (
      <div className={`page-full ${s.done}`}>
        <div className={s.doneIn}>
          <h1 className={s.h1}>{title}</h1>
          <p className={s.lede}>{body}</p>
          <div className={s.doneBtns}>
            <button type="button" className={`${s.btn} ${s.btnLead}`} onClick={() => router.push(purchasedSku === 'credits20' ? '/resume' : '/tracker')}>
              {purchasedSku === 'credits20' ? 'Open Résumé →' : 'Open my tracker →'}
            </button>
            <button type="button" className={`${s.btn} ${s.btnFree}`} onClick={() => router.push('/jobs')}>Find jobs to apply to</button>
          </div>
        </div>
      </div>
    )
  }

  const until = proUntil ? formatPacific(Date.parse(proUntil), { dateStyle: 'medium' }) : null
  const buyBtn = (sku: OfferSku, cls: string, label: string) => (
    <>
      <button type="button" className={`${s.btn} ${cls}`} onClick={() => void start(sku)} disabled={busy !== null} data-testid={`buy-${sku}`}>
        {busy === sku ? 'Opening checkout…' : label}
      </button>
      <p className={s.note}>{ONE_TIME_NOTE}</p>
    </>
  )
  const notOn = <p className={s.status}>Payments are not switched on yet — during early launch every feature is unlocked, so there is nothing to buy.</p>

  return (
    <div className="page-full">
      <div className={s.wrap}>
        <div className={s.hero}>
          <div className={s.eyebrow}>Pricing</div>
          <h1 className={s.h1}>Free while you search. Pay once when they call you in.</h1>
          <p className={s.lede}><b>{FREE_LINE}</b> Company grades, the tracker, job search and résumé match. When an application reaches an interview, get ready for it with one payment that never renews.</p>
        </div>

        {error && <div className={s.err} role="alert">{error}</div>}

        {/* Pro already: what it is and until when; an old subscription is managed here. */}
        {isPro && (
          <div className={s.manage} data-testid="pro-status">
            <p className={s.manageT}>You have Seen Pro access</p>
            {sub ? (
              <>
                <p className={s.manageS}>
                  Seen Pro subscription{sub.amount != null ? ` · $${sub.amount}/${sub.interval === 'year' ? 'yr' : 'mo'}` : ''}
                  {sub.current_period_end ? (sub.cancel_at_period_end
                    ? ` · ends ${formatPacific(sub.current_period_end, { dateStyle: 'medium' })}`
                    : ` · renews ${formatPacific(sub.current_period_end, { dateStyle: 'medium' })}`) : ''}.
                  {' '}Seen no longer sells subscriptions; yours keeps working until you cancel.
                </p>
                <button type="button" className={`${s.ghostBtn} ${sub.cancel_at_period_end ? '' : s.danger}`} disabled={manageBusy} onClick={() => manage(sub.cancel_at_period_end ? 'resume_subscription' : 'cancel_subscription')}>
                  {manageBusy ? 'Working…' : sub.cancel_at_period_end ? 'Keep my subscription' : 'Cancel my subscription'}
                </button>
              </>
            ) : (
              <p className={s.manageS}>
                {until ? `Everything is unlocked until ${until}, including ${PREP.name} for every interview. Nothing renews.` : `Everything is unlocked, including ${PREP.name} for every interview.`}
              </p>
            )}
          </div>
        )}

        <div className={s.cards}>
          {/* Free */}
          <section className={`${s.card} ${s.free}`} aria-label="Free">
            <div className={s.name}>Free</div>
            <div className={s.priceRow}><span className={s.price}>$0</span><span className={s.per}>forever · no card</span></div>
            <p className={s.pitch}>Everything you need to decide where to apply and keep track of it.</p>
            <button type="button" className={`${s.btn} ${s.btnFree}`} onClick={() => router.push(isLoggedIn ? '/tracker' : signupHref({ intent: 'track', next: '/tracker' }))}>
              {isLoggedIn ? 'Open my tracker' : 'Start free'}
            </button>
            <ul className={s.list}>{FREE_FOREVER.map(f => <li key={f}>{f}</li>)}</ul>
          </section>

          {/* Interview Prep — the lead product */}
          <section className={`${s.card} ${s.lead}`} aria-label={PREP.name} data-testid="offer-prep">
            <span className={s.tag}>When they call you in</span>
            <div className={s.name}>{PREP.name}</div>
            <div className={s.priceRow}><span className={s.price}>{PREP_PRICE}</span><span className={s.per}>for one interview</span></div>
            <p className={s.pitch}>Questions for the role and answers from your own résumé, ready before you walk in.</p>
            {isPro ? <p className={s.status}>Included in your Pro access.</p>
              : paymentsEnabled === false ? notOn
              : buyBtn('interview', s.btnLead, `Get ${PREP.name}`)}
            <ul className={s.list}>{PREP_INCLUDES.map(f => <li key={f}>{f}</li>)}</ul>
            <p className={s.small}>Best bought from the interview card on your tracker, where it is built for that company and role. It also opens {PREP.pro_days} days of Pro.</p>
          </section>

          {/* Job Search Pass */}
          <section className={`${s.card} ${s.pass}`} aria-label={PASS.name} data-testid="offer-pass">
            <div className={s.name}>{PASS.name}</div>
            <div className={s.priceRow}><span className={s.price}>{PASS_PRICE}</span><span className={s.per}>{PASS.pro_days} days of everything</span></div>
            <p className={s.pitch}>Interviewing at more than one place? One price covers every interview for {PASS.pro_days} days.</p>
            {isPro && (sub || !proUntil) ? <p className={s.status}>Included in your Pro access.</p>
              : paymentsEnabled === false ? notOn
              : buyBtn('pass30', s.btnPass, isPro ? `Add ${PASS.pro_days} more days` : 'Get the pass')}
            <ul className={s.list}>{PASS_INCLUDES.map(f => <li key={f}>{f}</li>)}</ul>
          </section>
        </div>

        <ol className={s.steps} aria-label="How it works">
          <li><b>Track your applications — free.</b>Seen checks in on day 7, 14 and 30 and shows how each company treats applicants.</li>
          <li><b>They call you in.</b>Move the card to Interview. Seen shows what applicants report about that company&apos;s interviews and a free preview of your prep.</li>
          <li><b>Get ready, once.</b>{PREP.name} for that interview, or the {PASS.name} if you have several. Neither renews.</li>
        </ol>

        <p className={s.promise}>
          <span>No subscription.</span> <span>Nothing renews.</span> <span>Money never changes a company&apos;s grade.</span>
        </p>

        <h2 className={s.h2}>Questions</h2>
        {FAQ.map(item => (
          <details key={item.q} id={item.id} className={s.faq}>
            <summary><span>{item.q}</span><Icon name="chevron-down" size={18} className={s.chev} /></summary>
            <div className={s.faqA}>{item.a}</div>
          </details>
        ))}
      </div>
    </div>
  )
}

'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth'
import { aiHeaders } from '@/lib/aiHeaders'
import { signupHref, trialSignupHref } from '@/lib/signupIntent.js'
import { FREE_DAILY_CREDITS, WELCOME_CREDITS, MAX_DAILY_EARN, PRO_TRIAL_DAYS, ONE_TIME_SKUS, PRO_PRICING, CREDIT_RESET_LABEL, RESUME_PARSE_COST } from '@/lib/creditRules'
import { formatPacific } from '@/lib/time/pacific.js'
import { REPORT_REWARD_PRO_DAYS, REPORT_REWARD_MONTHLY_CAP_DAYS, REPORT_REWARD_MIN_TRACKED_DAYS, REFERRAL_REWARD_PRO_DAYS, REFERRAL_MAX_REWARDED, dayWord, proDaysLabel } from '@/lib/creditRules'

// UI copy is generated from the SAME constants the server enforces — never a hand-typed
// number that drifts. Free tier is 1 AI credit/day (owner decision 2026-07-02).
const CREDIT_WORD = FREE_DAILY_CREDITS === 1 ? 'credit' : 'credits'
const FREE_DAILY_LABEL = `${FREE_DAILY_CREDITS} AI ${CREDIT_WORD} per day`
// Résumé upload/parse is free (RESUME_PARSE_COST = 0 — it makes no model call).
const PARSE_LINE = RESUME_PARSE_COST === 0 ? 'Résumé upload & parse — always free' : `Résumé upload & parse — ${RESUME_PARSE_COST} credit`

// Pro prices come from the SAME constants Stripe is charged with (api/stripe.js).
const MONTHLY = `$${PRO_PRICING.monthly.toFixed(2)}`
const YEARLY  = `$${PRO_PRICING.yearly_per_month.toFixed(2)}`
const MONTHLY_NUM = PRO_PRICING.monthly
const YEARLY_TOTAL = PRO_PRICING.yearly_total                        // 83.88
const ANNUAL_SAVINGS = +(MONTHLY_NUM * 12 - YEARLY_TOTAL).toFixed(2) // ~35.99
const ANNUAL_SAVE_PCT = Math.round((1 - YEARLY_TOTAL / (MONTHLY_NUM * 12)) * 100)
// "Get Pro free" — the cheapest way to Pro, from the SAME constants the server grants with
// (lib/server/growthRewards.js). It used to be FAQ question 5, collapsed at the bottom.
const FREE_PRO_LINE = `Or get Pro free: ${proDaysLabel(REPORT_REWARD_PRO_DAYS)} for each application outcome you report, ${proDaysLabel(REFERRAL_REWARD_PRO_DAYS)} for each friend you invite.`

// One-time SKUs — prices/grants come from the SAME constants the server fulfills with.
const SPRINT = ONE_TIME_SKUS.sprint       // $14.99 · 30 credits + 7 days Pro
const CREDITS20 = ONE_TIME_SKUS.credits20 // $4.99 · 20 credits
const skuPrice = (cents: number) => `$${(cents / 100).toFixed(2)}`

const FREE_FEATURES = [
  `${FREE_DAILY_LABEL} — optimize, score, job insights (resets at ${CREDIT_RESET_LABEL})`,
  // The welcome bonus is real but narrow (lib/server/credits.js gateAI + consume_credit SQL): the
  // ai_credits row is created on the FIRST AI action with WELCOME_CREDITS for that day, and the next
  // daily reset brings it back to FREE_DAILY_CREDITS. Say exactly that — nowhere else did.
  `${WELCOME_CREDITS}-credit welcome bonus on the day you first use an AI tool`,
  PARSE_LINE,
  'Earn credits by tracking apps & surveys',
  'Company ghost rates & trust scores',
  'Job listings filtered by trust',
  'Application tracker (unlimited)',
  'Community feed — live hiring reports',
  'Report your own experience',
]

// Outcome first (what a job seeker gets), then the mechanics. Each line is something Pro's code grants:
// unlimited job insights + résumé optimize/scan/tailor (gateAI with no daily cap), Human Voice (proOnly),
// unbranded résumé downloads (lib/server/resumeStudio.js). Never list a feature Pro's code does not grant.
const PRO_FEATURES = [
  'Know what a job really wants before you apply — AI insights on every listing, unlimited',
  'A résumé tailored to every application — no daily credit cap',
  'Résumé downloads without the Seen footer',
  'Human Voice — rewrites that sound like you, not a bot',
  'Priority support',
  'Early access to every new feature',
]

const COMPARISON: [string, string | boolean, string | boolean][] = [
  ['AI credits',                `${FREE_DAILY_CREDITS}/day · resets ${CREDIT_RESET_LABEL}`, 'Unlimited'],
  ['Résumé upload & parse',     RESUME_PARSE_COST === 0 ? 'Free' : `${RESUME_PARSE_COST} credit`, 'Free'],
  ['Resume AI — scan & optimize', '1 credit each', 'Unlimited'],
  ['AI job insights',           '1 credit each (free once cached)', 'Unlimited'],
  ['Company ghost rates',       true,         true],
  ['Ghost-risk warnings on your tracker', true, true],
  ['Résumé downloads without the Seen footer', false, true],
  ['Human Voice (natural rewrite)', false,    true],
  ['Job tracker',               'Unlimited',  'Unlimited'],
  ['Community feed',            true,         true],
  ['Priority support',          false,        true],
]

const FAQ = [
  // Growth rewards (lib/server/growthRewards.js) — rendered from the same constants the server grants with.
  { q: 'Can I get Pro without paying?', a: `Yes. Report what happened with an application on your tracker and get ${proDaysLabel(REPORT_REWARD_PRO_DAYS)}, once per application that has been on your tracker for at least ${dayWord(REPORT_REWARD_MIN_TRACKED_DAYS)}, up to ${dayWord(REPORT_REWARD_MONTHLY_CAP_DAYS)} a month. Every outcome earns the same. Invite a friend with your link from the dashboard: when they track their first application, you both get ${proDaysLabel(REFERRAL_REWARD_PRO_DAYS)} (you are rewarded for up to ${REFERRAL_MAX_REWARDED} friends). Earned Pro time is added on top of any you have, and it never renews or charges you.` },
  { q: 'What is Human Voice?', a: 'AI-optimized résumés often sound generic — and some companies auto-filter applications that read as machine-written. Human Voice rewrites your optimized bullets so they sound like you: varied sentence structure, natural rhythm, every keyword kept. Your words, your voice, still ATS-ready.' },
  { q: 'How do free AI credits work?', a: `The first time you use an AI tool you get a ${WELCOME_CREDITS}-credit welcome bonus for that day (the first action uses one of them). From then on you get ${FREE_DAILY_CREDITS} free AI ${CREDIT_WORD} a day, reset at ${CREDIT_RESET_LABEL} (California time). Each credit covers one AI action, and every button that spends one says so: optimize your résumé for a job, run the ATS scanner, build your application advantage, or generate AI insights for a listing nobody has analyzed yet. Uploading and parsing your résumé is free. You can earn up to ${MAX_DAILY_EARN} more credits a day by tracking your applications and answering quick surveys about companies you've worked with. Purchased credits never reset.` },
  { q: 'How does the free trial work?', a: `Pro starts with ${PRO_TRIAL_DAYS} days free — no card required. If you add a payment method before the trial ends, your plan renews at the price you chose; cancel anytime. If you don't add one, nothing is charged and access simply ends.` },
  { q: 'What if I don\'t want a subscription?', a: `Pay once, own it: the Interview Sprint (${skuPrice(SPRINT.amount_cents)}) gives you ${SPRINT.credits} AI credits plus ${SPRINT.pro_days} days of full Pro access, and the Credit Pack (${skuPrice(CREDITS20.amount_cents)}) adds ${CREDITS20.credits} AI credits. Purchased credits never expire and roll over every day — no auto-renewal, ever.` },
  { q: 'Can I cancel Pro?', a: 'Yes, anytime — no contracts. You keep Pro until the end of your billing period. We don\'t trap you.' },
  // What the code does (api/user-sync.js save_resume → profiles.resume_text; delete_resume / delete_account
  // clear it): the résumé is STORED on the profile — the old answer ("processed in-memory … immediately
  // discarded") was false while Settings showed the file "On file".
  { q: 'Is my data sold to employers?', a: 'Never. We work for job seekers. Your résumé is stored on your profile so your own tools can use it — job matching, fit scores and rewrites — until you replace it or delete your account (both in Settings). It is never shown to, shared with, or sold to recruiters or employers, and neither is anything else about you.' },
  { q: 'When does Pro activate?', a: 'Instantly after payment. Credits update in real-time — no waiting, no manual activation.' },
  { q: 'What if I hit the daily limit?', a: `Free users get ${FREE_DAILY_CREDITS} ${CREDIT_WORD}/day, back at ${CREDIT_RESET_LABEL}. Track an application to earn one back. Answer a 10-second survey to earn more — up to ${MAX_DAILY_EARN} a day. Or upgrade to Pro for unlimited.` },
]

export default function PricingPage() {
  const router = useRouter()
  const { isLoggedIn } = useAuth()
  // Monthly first: a cold visitor's first price is the monthly one, not the yearly total (conversion
  // audit 2026-10-24: the first price seen was "$83.88"). Yearly stays one tap away with its saving.
  const [yearly, setYearly] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [upgraded, setUpgraded] = useState(false)
  // Which one-time SKU (if any) the user just bought — drives the success-screen copy.
  const [purchasedSku, setPurchasedSku] = useState<string | null>(null)
  const [skuLoading, setSkuLoading] = useState<string | null>(null)
  // null = unknown (optimistic), false = Stripe not wired up yet → show "launching soon"
  // instead of a broken checkout. Flips to true automatically once Stripe keys are set.
  const [paymentsEnabled, setPaymentsEnabled] = useState<boolean | null>(null)
  const [isPro, setIsPro] = useState(false)
  const [portalLoading, setPortalLoading] = useState(false)
  const [sub, setSub] = useState<{ status: string; cancel_at_period_end: boolean; current_period_end: number | null; amount: number | null; interval: string | null } | null>(null)
  // One live Checkout Session per click: `disabled` only takes effect after React re-renders, so a
  // double-tap created two Stripe sessions (audit 2026-10-24). The ref closes the gap synchronously.
  const checkoutInFlight = useRef(false)

  // The Stripe return (?upgraded=1&purchase=&session_id=) is read from window.location after mount.
  // useSearchParams needed a <Suspense> boundary that turned the WHOLE page into a client render, so a
  // cold visitor saw nothing until the bundle hydrated (LCP ~3.8 s on a throttled phone — conversion
  // audit 2026-10-24); now the page is in the server HTML.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('upgraded') === '1') {
      setUpgraded(true)
      const bought = params.get('purchase')
      if (bought && ONE_TIME_SKUS[bought as keyof typeof ONE_TIME_SKUS]) setPurchasedSku(bought)
      // Fulfill/grant on return from Stripe Checkout without relying on a webhook: confirm
      // the session server-side, which verifies ownership, then grants Pro (subscription)
      // or fulfills the one-time SKU (idempotent — shares a claim with the webhook).
      const sid = params.get('session_id')
      if (sid) {
        aiHeaders()
          .then(hdrs => fetch('/api/stripe?action=confirm', { method: 'POST', headers: hdrs, body: JSON.stringify({ session_id: sid }) }))
          .catch(() => { /* webhook still covers it if confirm fails */ })
      }
    }
  }, [])

  useEffect(() => {
    fetch('/api/stripe?action=status')
      .then(r => r.json())
      .then(d => setPaymentsEnabled(!!d.payments_enabled))
      .catch(() => setPaymentsEnabled(true)) // optimistic on network error — don't hide a working checkout
  }, [])

  // Is this user already Pro? If so we show the membership-management view.
  useEffect(() => {
    if (!isLoggedIn) { setIsPro(false); return }
    aiHeaders()
      .then(h => fetch('/api/user-sync', { method: 'POST', headers: h, body: JSON.stringify({ action: 'get_credits' }) }))
      .then(r => r.json())
      .then(d => { setIsPro(!!d?.pro); if (d?.pro) loadSub() })
      .catch(() => { /* assume not pro */ })
  }, [isLoggedIn])

  // Pull the live subscription (plan, renewal date, cancel state) for the manage view.
  async function loadSub() {
    try {
      const h = await aiHeaders()
      const r = await fetch('/api/stripe?action=subscription_status', { method: 'POST', headers: h, body: '{}' })
      const d = await r.json()
      setSub(d?.subscription || null)
      // If Stripe says the subscription has ended, drop back to the non-Pro view so the
      // manage buttons disappear (the server has already flipped the pro flag too).
      if (typeof d?.pro === 'boolean') setIsPro(d.pro)
    } catch { /* ignore */ }
  }

  // Cancel (at period end) or resume the membership — handled in-app, no Stripe portal.
  async function manage(act: 'cancel_subscription' | 'resume_subscription') {
    setPortalLoading(true)
    setError('')
    try {
      const hdrs = await aiHeaders()
      const r = await fetch(`/api/stripe?action=${act}`, { method: 'POST', headers: hdrs, body: '{}' })
      const d = await r.json()
      if (d?.ok) { setSub(d.subscription || null); if (typeof d?.pro === 'boolean') setIsPro(d.pro) }
      else setError(d?.error || 'Could not update your membership — try again or email hello@seenjobs.io')
    } catch {
      setError('Network error — please try again')
    }
    setPortalLoading(false)
  }

  async function handleUpgrade() {
    if (!isLoggedIn) {
      router.push(trialSignupHref(yearly ? 'yearly' : 'monthly'))
      return
    }
    if (checkoutInFlight.current) return
    checkoutInFlight.current = true
    setLoading(true)
    setError('')
    try {
      const hdrs = await aiHeaders()
      const r = await fetch('/api/stripe?action=checkout', {
        method: 'POST',
        headers: hdrs,
        body: JSON.stringify({ plan: yearly ? 'yearly' : 'monthly' }),
      })
      const d = await r.json()
      if (d.url) {
        window.location.href = d.url // the ref stays set: this page is leaving
      } else {
        setError(d.error || 'Checkout failed — please try again or email hello@seenjobs.io')
        setLoading(false)
        checkoutInFlight.current = false
      }
    } catch {
      setError('Network error — please try again')
      setLoading(false)
      checkoutInFlight.current = false
    }
  }

  // One-time purchase (mode:'payment' on the server) — same checkout endpoint, sku body.
  async function handleOneTime(sku: 'sprint' | 'credits20') {
    if (!isLoggedIn) {
      router.push(signupHref({ next: '/pricing' }))
      return
    }
    if (checkoutInFlight.current) return
    checkoutInFlight.current = true
    setSkuLoading(sku)
    setError('')
    try {
      const hdrs = await aiHeaders()
      const r = await fetch('/api/stripe?action=checkout', {
        method: 'POST',
        headers: hdrs,
        body: JSON.stringify({ sku }),
      })
      const d = await r.json()
      if (d.url) {
        window.location.href = d.url
      } else {
        setError(d.error || 'Checkout failed — please try again or email hello@seenjobs.io')
        setSkuLoading(null)
        checkoutInFlight.current = false
      }
    } catch {
      setError('Network error — please try again')
      setSkuLoading(null)
      checkoutInFlight.current = false
    }
  }

  const checkStyle = (val: string | boolean): React.ReactNode => {
    if (val === true) return <span style={{ color: 'var(--green)', fontSize: '1rem' }}>✓</span>
    if (val === false) return <span style={{ color: 'var(--line2)' }}>—</span>
    return <span style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-68)', color: 'var(--white)' }}>{val}</span>
  }

  if (upgraded) {
    const successTitle = purchasedSku === 'sprint' ? 'Sprint unlocked.'
      : purchasedSku === 'credits20' ? 'Credits added.'
      : "You're Pro."
    const successBody = purchasedSku === 'sprint'
      ? `${SPRINT.credits} AI credits are on your account, plus full Pro access for the next ${SPRINT.pro_days} days. Purchased credits never expire. No subscription — nothing renews.`
      : purchasedSku === 'credits20'
      ? `${CREDITS20.credits} AI credits are on your account. Purchased credits never expire and roll over every day. No subscription — nothing renews.`
      : `Your ${PRO_TRIAL_DAYS}-day free trial is live — unlimited AI credits and Human Voice, right now. No card on file means nothing is ever charged; access simply ends after the trial unless you add one.`
    return (
      <div className="page-full" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '80vh' }}>
        <div style={{ textAlign: 'center', maxWidth: 420, padding: '2rem' }}>
          <div style={{ fontSize: '3.5rem', marginBottom: '1rem' }}>🎉</div>
          <h1 style={{ fontFamily: 'var(--display)', fontSize: '1.8rem', fontWeight: 800, color: 'var(--white)', marginBottom: '.5rem' }}>{successTitle}</h1>
          <p style={{ color: 'var(--sub)', fontFamily: 'var(--body)', fontSize: '.78rem', lineHeight: 1.7, marginBottom: '1.75rem' }}>
            {successBody}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.65rem' }}>
            <button
              onClick={() => router.push('/resume')}
              style={{ padding: '.85rem', background: 'linear-gradient(135deg,#4f46e5,#7c3aed)', border: 'none', borderRadius: 10, fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.88rem', color: '#fff', cursor: 'pointer', boxShadow: '0 0 28px rgba(99,102,241,.4)' }}
            >
              Try Resume AI →
            </button>
            <button
              onClick={() => router.push('/jobs')}
              style={{ padding: '.75rem', background: 'none', border: '1px solid var(--line2)', borderRadius: 10, fontFamily: 'var(--mono)', fontSize: 'var(--fs-72)', color: 'var(--sub)', cursor: 'pointer' }}
            >
              Find jobs to apply
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="page-full">
      <div style={{ maxWidth: 880, margin: '0 auto', padding: '4rem 1.5rem 5rem', width: '100%', boxSizing: 'border-box' }}>

        {/* Hero */}
        <div style={{ textAlign: 'center', marginBottom: '2.75rem' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-52)', textTransform: 'uppercase', letterSpacing: '.22em', color: '#818cf8', marginBottom: '.6rem' }}>
            Transparent pricing
          </div>
          <h1 style={{ fontFamily: 'var(--display)', fontSize: 'clamp(1.8rem,5vw,2.6rem)', fontWeight: 900, color: 'var(--white)', letterSpacing: '-.04em', marginBottom: '.5rem', lineHeight: 1.1 }}>
            You already know who ghosts.<br />
            <span style={{ color: '#818cf8' }}>Now get through to the ones who don't.</span>
          </h1>
          <p style={{ color: 'var(--sub)', fontSize: '.85rem', lineHeight: 1.7, maxWidth: 480, margin: '0 auto 1.75rem' }}>
            Seen shows you which companies actually respond — free. Pro gives you unlimited AI help for the ones worth your time: what each job really wants, and a résumé tailored to it.
          </p>

          {/* Billing toggle — monthly by default; yearly shows its saving */}
          <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: '.55rem' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', maxWidth: '100%', gap: '.5rem .75rem', background: 'var(--card)', border: `1px solid ${yearly ? 'rgba(99,102,241,.4)' : 'var(--line)'}`, borderRadius: 24, padding: '.4rem .95rem', transition: 'border-color .2s', boxShadow: yearly ? '0 0 22px rgba(99,102,241,.18)' : 'none' }}>
              <span id="bill-monthly" style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-68)', color: yearly ? 'var(--muted)' : 'var(--white)' }}>Monthly</span>
              {/* role="switch": assistive tech reads "Yearly billing, switch, on/off" (audit 2026-10-24: the
                  old aria-pressed button never said which period was active). Space/Enter toggle natively. */}
              <button
                type="button"
                onClick={() => setYearly(!yearly)}
                role="switch"
                aria-checked={yearly}
                aria-label="Yearly billing"
                aria-describedby="bill-monthly bill-yearly"
                /* 44×44 hit area around the 38×20 switch; the negative margin keeps the pill the height it was. */
                style={{ width: 44, height: 44, margin: '-12px -3px', padding: 0, display: 'grid', placeItems: 'center', background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0 }}
              >
                <span style={{ display: 'block', width: 38, height: 20, borderRadius: 10, background: yearly ? '#4f46e5' : 'var(--line2)', position: 'relative', transition: 'background .2s' }}>
                  <span style={{ position: 'absolute', top: 2, left: yearly ? 20 : 2, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left .2s' }} />
                </span>
              </button>
              <span id="bill-yearly" style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-68)', color: yearly ? 'var(--white)' : 'var(--muted)' }}>
                Yearly
              </span>
              <span style={{ background: 'linear-gradient(90deg,#4f46e5,#7c3aed)', color: '#fff', fontFamily: 'var(--mono)', fontSize: 'var(--fs-52)', fontWeight: 700, letterSpacing: '.05em', padding: '.18rem .55rem', borderRadius: 100, whiteSpace: 'nowrap' }}>
                {`BEST VALUE · SAVE ${ANNUAL_SAVE_PCT}%`}
              </span>
            </div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-60)', color: yearly ? 'var(--green)' : 'var(--muted)', minHeight: '.9rem' }}>
              {yearly ? `$${YEARLY_TOTAL}/yr — save $${ANNUAL_SAVINGS} vs monthly` : `Switch to yearly and save $${ANNUAL_SAVINGS}/yr`}
            </div>
          </div>
        </div>

        {/* Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: '1.25rem', marginBottom: '3.5rem' }}>

          {/* Free */}
          <div className="spot" style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 16, padding: '1.75rem' }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-58)', textTransform: 'uppercase', letterSpacing: '.14em', color: 'var(--dim)', marginBottom: '.6rem' }}>Free</div>
            <div style={{ fontFamily: 'var(--display)', fontSize: '2.2rem', fontWeight: 900, color: 'var(--white)', marginBottom: '.1rem' }}>$0</div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-62)', color: 'var(--muted)', marginBottom: '1.5rem' }}>forever — no card required</div>
            <div style={{ marginBottom: '1.5rem' }}>
              {FREE_FEATURES.map(f => (
                <div key={f} style={{ display: 'flex', gap: '.5rem', marginBottom: '.45rem', fontFamily: 'var(--body)', fontSize: 'var(--fs-72)', color: 'var(--sub)', lineHeight: 1.45 }}>
                  <span style={{ color: 'var(--dim)', flexShrink: 0 }}>✓</span>{f}
                </div>
              ))}
            </div>
            <button
              onClick={() => router.push(isLoggedIn ? '/resume' : signupHref({ next: '/tracker' }))}
              style={{ width: '100%', background: 'none', border: '1px solid var(--line2)', borderRadius: 9, padding: '.75rem', fontFamily: 'var(--display)', fontWeight: 700, fontSize: '.82rem', color: 'var(--sub)', cursor: 'pointer' }}
            >
              {isLoggedIn ? 'Go to Resume AI' : 'Get started free'}
            </button>
          </div>

          {/* Pro */}
          <div className="spot" style={{ background: 'linear-gradient(150deg,rgba(79,70,229,.12) 0%,rgba(124,58,237,.08) 100%)', border: '1.5px solid rgba(99,102,241,.45)', borderRadius: 16, padding: '1.75rem', position: 'relative' }}>
            <div style={{ position: 'absolute', top: -13, left: '50%', transform: 'translateX(-50%)', background: 'linear-gradient(90deg,#4f46e5,#7c3aed)', color: '#fff', fontFamily: 'var(--mono)', fontSize: 'var(--fs-56)', fontWeight: 700, letterSpacing: '.08em', padding: '.25rem .9rem', borderRadius: 100, whiteSpace: 'nowrap' }}>
              MOST POPULAR
            </div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-58)', textTransform: 'uppercase', letterSpacing: '.14em', color: '#a5b4fc', marginBottom: '.6rem' }}>Pro</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '.35rem', marginBottom: '.1rem' }}>
              <div style={{ fontFamily: 'var(--display)', fontSize: '2.2rem', fontWeight: 900, color: 'var(--white)' }}>
                {yearly ? YEARLY : MONTHLY}
              </div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-65)', color: 'var(--muted)' }}>/mo</div>
            </div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-62)', color: 'var(--muted)', marginBottom: yearly ? '.4rem' : '1.5rem' }}>
              {yearly ? `billed $${YEARLY_TOTAL.toFixed(2)}/year` : 'billed monthly'}
            </div>
            {yearly && (
              <div style={{ display: 'inline-block', fontFamily: 'var(--mono)', fontSize: 'var(--fs-58)', fontWeight: 700, color: 'var(--green)', background: 'rgba(16,185,129,.1)', border: '1px solid rgba(16,185,129,.25)', borderRadius: 6, padding: '.18rem .5rem', marginBottom: '1.5rem' }}>
                Save ${ANNUAL_SAVINGS}/yr vs monthly
              </div>
            )}
            <div style={{ marginBottom: '1.5rem' }}>
              {PRO_FEATURES.map(f => (
                <div key={f} style={{ display: 'flex', gap: '.5rem', marginBottom: '.45rem', fontFamily: 'var(--body)', fontSize: 'var(--fs-72)', color: 'rgba(165,180,252,.85)', lineHeight: 1.45 }}>
                  <span style={{ color: '#818cf8', flexShrink: 0 }}>✓</span>{f}
                </div>
              ))}
            </div>

            {error && (
              <div style={{ background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)', borderRadius: 8, padding: '.55rem .85rem', marginBottom: '.85rem', fontFamily: 'var(--mono)', fontSize: 'var(--fs-62)', color: 'var(--red)', lineHeight: 1.5 }}>
                {error}
              </div>
            )}

            {isPro ? (
              <>
                {/* Already Pro — manage the membership in-app (cancel / resume). */}
                <div
                  style={{
                    width: '100%', boxSizing: 'border-box', textAlign: 'center',
                    background: 'rgba(16,185,129,.12)', border: '1px solid rgba(16,185,129,.3)',
                    borderRadius: 9, padding: '.7rem',
                    fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.82rem', color: 'var(--green)',
                    marginBottom: '.7rem',
                  }}
                >
                  ★ You&apos;re on Seen Pro
                </div>
                {sub && (
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-62)', color: 'var(--sub)', textAlign: 'center', marginBottom: '.7rem', lineHeight: 1.6 }}>
                    {sub.amount != null ? `$${sub.amount}/${sub.interval === 'year' ? 'yr' : 'mo'}` : 'Active'}
                    {sub.current_period_end ? (sub.cancel_at_period_end
                      ? ` · ends ${formatPacific(sub.current_period_end, { dateStyle: 'medium' })}`
                      : ` · renews ${formatPacific(sub.current_period_end, { dateStyle: 'medium' })}`) : ''}
                  </div>
                )}
                {sub?.cancel_at_period_end ? (
                  <button
                    onClick={() => manage('resume_subscription')}
                    disabled={portalLoading}
                    style={{ width: '100%', background: portalLoading ? 'var(--line)' : 'linear-gradient(135deg,#4f46e5 0%,#7c3aed 100%)', border: 'none', borderRadius: 9, padding: '.85rem', fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.88rem', color: '#fff', cursor: portalLoading ? 'default' : 'pointer', boxShadow: portalLoading ? 'none' : '0 0 32px rgba(99,102,241,.4)' }}
                  >
                    {portalLoading ? 'Working…' : 'Resume membership'}
                  </button>
                ) : (
                  <button
                    onClick={() => manage('cancel_subscription')}
                    disabled={portalLoading || !sub}
                    style={{ width: '100%', background: 'none', border: '1px solid rgba(239,68,68,.4)', borderRadius: 9, padding: '.8rem', fontFamily: 'var(--mono)', fontWeight: 600, fontSize: 'var(--fs-72)', color: 'var(--red)', cursor: (portalLoading || !sub) ? 'default' : 'pointer', opacity: (portalLoading || !sub) ? .55 : 1 }}
                  >
                    {portalLoading ? 'Working…' : 'Cancel membership'}
                  </button>
                )}
                <div style={{ fontFamily: 'var(--body)', fontSize: 'var(--fs-66)', color: 'var(--sub)', textAlign: 'center', lineHeight: 1.6, marginTop: '.7rem' }}>
                  {sub?.cancel_at_period_end
                    ? 'Your membership is set to cancel — you keep Pro until the date above.'
                    : "Cancel anytime — you keep Pro through the month you've already paid for."}
                </div>
              </>
            ) : paymentsEnabled === false ? (
              <>
                {/* Stripe not wired up yet — early-launch state. Everything's already unlocked
                    for signed-in users, so this is an honest "coming soon", not a wall. */}
                <div
                  style={{
                    width: '100%', boxSizing: 'border-box', textAlign: 'center',
                    background: 'rgba(99,102,241,.12)', border: '1px solid rgba(99,102,241,.3)',
                    borderRadius: 9, padding: '.85rem',
                    fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.88rem', color: '#a5b4fc',
                  }}
                >
                  ✦ Pro is launching soon
                </div>
                <div style={{ fontFamily: 'var(--body)', fontSize: 'var(--fs-66)', color: 'var(--sub)', textAlign: 'center', lineHeight: 1.6, marginTop: '.7rem' }}>
                  We&apos;re in early launch — <strong style={{ color: 'var(--white)' }}>every feature is unlocked and free</strong> right now.
                  Paid plans turn on shortly; nothing to do.
                </div>
              </>
            ) : (
              <>
                <button
                  className="btn-shine"
                  onClick={handleUpgrade}
                  disabled={loading}
                  style={{
                    width: '100%',
                    background: loading ? 'var(--line)' : 'linear-gradient(135deg,#4f46e5 0%,#7c3aed 100%)',
                    border: 'none', borderRadius: 9, padding: '.85rem',
                    fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.88rem', color: '#fff',
                    cursor: loading ? 'default' : 'pointer',
                    boxShadow: loading ? 'none' : '0 0 32px rgba(99,102,241,.4)',
                  }}
                >
                  {loading ? 'Redirecting…' : `Start ${PRO_TRIAL_DAYS}-day free trial →`}
                </button>
                <div style={{ display: 'flex', justifyContent: 'center', gap: '1.25rem', marginTop: '.75rem' }}>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-52)', color: 'var(--dim)' }}>🚫 No card required</span>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-52)', color: 'var(--dim)' }}>💳 Stripe secure</span>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-52)', color: 'var(--dim)' }}>⚡ Instant access</span>
                </div>
                {/* Trial + auto-renewal disclosure (FTC / state ARL compliance). */}
                <div style={{ fontFamily: 'var(--body)', fontSize: 'var(--fs-62)', color: 'var(--sub)', textAlign: 'center', lineHeight: 1.6, marginTop: '.65rem' }}>
                  Free for {PRO_TRIAL_DAYS} days. No card required. If you add a payment method, renews at
                  {yearly ? ` $${YEARLY_TOTAL.toFixed(2)}/yr` : ` ${MONTHLY}/mo`} after the trial — cancel anytime;
                  without one, access simply ends and you&apos;re never charged.
                </div>
                <div data-testid="free-pro-line" style={{ marginTop: '.8rem', padding: '.6rem .75rem', border: '1px solid rgba(16,185,129,.3)', background: 'rgba(16,185,129,.08)', borderRadius: 8, fontFamily: 'var(--body)', fontSize: 'var(--fs-72)', color: 'var(--text)', textAlign: 'center', lineHeight: 1.55 }}>
                  {FREE_PRO_LINE}{' '}
                  <a href="#get-pro-free" onClick={() => { const d = document.getElementById('get-pro-free'); if (d instanceof HTMLDetailsElement) d.open = true }} style={{ color: 'var(--green)', textDecoration: 'none', whiteSpace: 'nowrap' }}>How it works ↓</a>
                </div>
              </>
            )}
          </div>
        </div>

        {/* One-time purchases — no subscription */}
        <div style={{ marginBottom: '3.5rem' }}>
          <div style={{ textAlign: 'center', marginBottom: '1.25rem' }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-52)', textTransform: 'uppercase', letterSpacing: '.22em', color: 'var(--green)', marginBottom: '.4rem' }}>
              No subscription. Pay once.
            </div>
            <h2 style={{ fontFamily: 'var(--display)', fontSize: '1.2rem', fontWeight: 800, color: 'var(--white)', margin: 0 }}>
              Not ready for a membership?
            </h2>
            <p style={{ color: 'var(--sub)', fontFamily: 'var(--body)', fontSize: 'var(--fs-72)', lineHeight: 1.6, maxWidth: 440, margin: '.4rem auto 0' }}>
              One payment, no renewals. Purchased credits never expire and roll over every day.
            </p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: '1.25rem' }}>
            {/* Interview Sprint */}
            <div style={{ background: 'var(--card)', border: '1px solid rgba(16,185,129,.35)', borderRadius: 16, padding: '1.5rem', position: 'relative' }}>
              <div style={{ position: 'absolute', top: -11, left: '50%', transform: 'translateX(-50%)', background: 'var(--green)', color: '#052e22', fontFamily: 'var(--mono)', fontSize: 'var(--fs-52)', fontWeight: 700, letterSpacing: '.08em', padding: '.2rem .7rem', borderRadius: 100, whiteSpace: 'nowrap' }}>
                BEST FOR AN ACTIVE SEARCH
              </div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-58)', textTransform: 'uppercase', letterSpacing: '.14em', color: 'var(--green)', marginBottom: '.5rem' }}>{SPRINT.name}</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '.35rem', marginBottom: '1rem' }}>
                <div style={{ fontFamily: 'var(--display)', fontSize: '1.9rem', fontWeight: 900, color: 'var(--white)' }}>{skuPrice(SPRINT.amount_cents)}</div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-62)', color: 'var(--muted)' }}>one-time</div>
              </div>
              {[`${SPRINT.credits} AI credits — never expire`, `${SPRINT.pro_days} days of full Pro access`, 'Human Voice + unlimited AI during your sprint', 'No renewal — it just ends'].map(f => (
                <div key={f} style={{ display: 'flex', gap: '.5rem', marginBottom: '.45rem', fontFamily: 'var(--body)', fontSize: 'var(--fs-72)', color: 'var(--sub)', lineHeight: 1.45 }}>
                  <span style={{ color: 'var(--green)', flexShrink: 0 }}>✓</span>{f}
                </div>
              ))}
              <button
                onClick={() => handleOneTime('sprint')}
                disabled={skuLoading !== null}
                style={{ width: '100%', marginTop: '1rem', background: skuLoading === 'sprint' ? 'var(--line)' : 'rgba(16,185,129,.14)', border: '1px solid rgba(16,185,129,.4)', borderRadius: 9, padding: '.8rem', fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.84rem', color: 'var(--green)', cursor: skuLoading ? 'default' : 'pointer' }}
              >
                {skuLoading === 'sprint' ? 'Redirecting…' : `Get the Sprint · ${skuPrice(SPRINT.amount_cents)}`}
              </button>
            </div>
            {/* Credit Pack */}
            <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 16, padding: '1.5rem' }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-58)', textTransform: 'uppercase', letterSpacing: '.14em', color: 'var(--dim)', marginBottom: '.5rem' }}>{CREDITS20.name}</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '.35rem', marginBottom: '1rem' }}>
                <div style={{ fontFamily: 'var(--display)', fontSize: '1.9rem', fontWeight: 900, color: 'var(--white)' }}>{skuPrice(CREDITS20.amount_cents)}</div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-62)', color: 'var(--muted)' }}>one-time</div>
              </div>
              {[`${CREDITS20.credits} AI credits — never expire`, 'Use them any day, at your pace', 'No renewal, no membership'].map(f => (
                <div key={f} style={{ display: 'flex', gap: '.5rem', marginBottom: '.45rem', fontFamily: 'var(--body)', fontSize: 'var(--fs-72)', color: 'var(--sub)', lineHeight: 1.45 }}>
                  <span style={{ color: 'var(--dim)', flexShrink: 0 }}>✓</span>{f}
                </div>
              ))}
              <button
                onClick={() => handleOneTime('credits20')}
                disabled={skuLoading !== null}
                style={{ width: '100%', marginTop: '1rem', background: 'none', border: '1px solid var(--line2)', borderRadius: 9, padding: '.8rem', fontFamily: 'var(--display)', fontWeight: 700, fontSize: '.84rem', color: 'var(--sub)', cursor: skuLoading ? 'default' : 'pointer' }}
              >
                {skuLoading === 'credits20' ? 'Redirecting…' : `Get ${CREDITS20.credits} credits · ${skuPrice(CREDITS20.amount_cents)}`}
              </button>
            </div>
          </div>
        </div>

        {/* Human Voice callout */}
        <div style={{ background: 'linear-gradient(135deg,rgba(124,58,237,.12),rgba(79,70,229,.08))', border: '1px solid rgba(124,58,237,.3)', borderRadius: 14, padding: '1.5rem 1.75rem', marginBottom: '3rem', display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '1.25rem', alignItems: 'center' }}>
          <div style={{ fontSize: '2.5rem' }}>🗣</div>
          <div>
            <div style={{ fontFamily: 'var(--display)', fontSize: '1rem', fontWeight: 800, color: 'var(--white)', marginBottom: '.25rem' }}>Human Voice — Pro exclusive</div>
            <div style={{ fontFamily: 'var(--body)', fontSize: 'var(--fs-72)', color: 'var(--sub)', lineHeight: 1.65 }}>
              Human Voice rewrites your optimized bullets so they sound like you — varied sentence structure, natural
              rhythm, every keyword kept. Your words, your voice, still ATS-ready.
            </div>
          </div>
        </div>

        {/* Comparison table */}
        <h2 style={{ fontFamily: 'var(--display)', fontSize: '1.2rem', fontWeight: 800, color: 'var(--white)', marginBottom: '1rem' }}>Full comparison</h2>
        <div style={{ border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden', overflowX: 'auto', marginBottom: '3rem' }}>
          <div className="pr-cmp-row pr-cmp-head">
            <span style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-58)', color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '.1em' }}>Feature</span>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-58)', color: 'var(--dim)', textAlign: 'center' }}>Free</span>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-58)', color: '#818cf8', textAlign: 'center' }}>Pro</span>
          </div>
          {COMPARISON.map(([feature, freeVal, proVal]) => (
            <div key={feature} className="pr-cmp-row">
              <span style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-68)', color: 'var(--sub)' }}>{feature}</span>
              <span style={{ textAlign: 'center' }}>{checkStyle(freeVal)}</span>
              <span style={{ textAlign: 'center' }}>{checkStyle(proVal)}</span>
            </div>
          ))}
        </div>

        {/* FAQ */}
        <h2 style={{ fontFamily: 'var(--display)', fontSize: '1.2rem', fontWeight: 800, color: 'var(--white)', marginBottom: '1rem' }}>Questions</h2>
        {FAQ.map(item => (
          <details key={item.q} id={item.q === 'Can I get Pro without paying?' ? 'get-pro-free' : undefined} style={{ marginBottom: '.6rem', background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10, scrollMarginTop: '5rem' }}>
            <summary style={{ padding: '.85rem 1.25rem', fontFamily: 'var(--display)', fontSize: '.82rem', fontWeight: 700, color: 'var(--white)', cursor: 'pointer', listStyle: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.5rem' }}>
              <span>{item.q}</span>
              <span className="dt-chev" style={{ color: 'var(--dim)', fontWeight: 400, fontSize: 'var(--fs-70)', flexShrink: 0 }}>▾</span>
            </summary>
            <div style={{ padding: '0 1.25rem .85rem', fontFamily: 'var(--body)', fontSize: 'var(--fs-72)', color: 'var(--sub)', lineHeight: 1.75 }}>
              {item.a}
            </div>
          </details>
        ))}

        {/* Bottom CTA */}
        <div style={{ textAlign: 'center', marginTop: '3rem' }}>
          <button
            className="btn-shine"
            onClick={handleUpgrade}
            disabled={loading || skuLoading !== null}
            style={{ padding: '.95rem 3rem', background: 'linear-gradient(135deg,#4f46e5,#7c3aed)', border: 'none', borderRadius: 12, fontFamily: 'var(--display)', fontWeight: 800, fontSize: '1rem', color: '#fff', cursor: 'pointer', boxShadow: '0 0 40px rgba(99,102,241,.4)' }}
          >
            {loading ? 'Redirecting…' : `Start ${PRO_TRIAL_DAYS}-day free trial →`}
          </button>
          {/* The renewal figure follows the toggle: the yearly plan is billed once a year (its per-month
              figure is an equivalent, not a charge); monthly is billed monthly. */}
          <div style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-58)', color: 'var(--dim)', marginTop: '.75rem' }}>
            No card required · then {yearly ? `$${YEARLY_TOTAL.toFixed(2)}/yr (${YEARLY}/mo)` : `${MONTHLY}/mo`} if you continue · Cancel anytime
          </div>
        </div>

      </div>
    </div>
  )
}


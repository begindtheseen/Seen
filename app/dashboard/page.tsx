'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/lib/auth'
import { AppStore } from '@/lib/stores/AppStore'
import { EventStore } from '@/lib/stores/EventStore'
import { BadgeStore } from '@/lib/stores/BadgeStore'
import WelcomeOnboarding from '@/components/WelcomeOnboarding'
import type { Application } from '@/lib/types'
import { isGradeableScore } from '@/lib/gradeGate'
import Odometer from '@/components/motion/Odometer'
import styles from './dashboard.module.css'

function companySlug(name: string) {
  return encodeURIComponent(name.toLowerCase().replace(/\s+/g, '-'))
}

// Survey insight — maps onboarding survey frustration → enabled-feature card (index.html:9272)
const FRUSTRATION_MAP: Record<string, { label: string; desc: string }> = {
  ghosting: { label: 'Ghosting alerts on', desc: "We'll flag companies with high ghost rates before you apply." },
  fake: { label: 'Fake listing detection on', desc: 'AI research fires automatically on companies with sparse data.' },
  salary: { label: 'Salary transparency on', desc: 'We show salary ranges upfront. No more guessing.' },
  rounds: { label: 'Process transparency on', desc: 'We track how many rounds each company typically runs.' },
  all: { label: 'Full transparency mode on', desc: 'Everything Seen has is working for you.' },
}

function surveyFrustration(onboarding: string | Record<string, unknown> | undefined): string | null {
  if (!onboarding) return null
  try {
    const o = typeof onboarding === 'string' ? JSON.parse(onboarding) : onboarding
    const f = o?.frustration
    return typeof f === 'string' && FRUSTRATION_MAP[f] ? f : null
  } catch {
    return null
  }
}

const RESPONSE_EVENTS = new Set(['response_received', 'interview_received', 'interview_completed', 'offer_received'])
/** The company engaged: a decision (hired/rejected) or a logged response/interview. Ghosted and withdrawn are not responses. */
function responded(a: Application): boolean {
  return a.status === 'hired' || a.status === 'rejected' || (a.events || []).some(e => RESPONSE_EVENTS.has(e.type))
}
function hadInterview(a: Application): boolean {
  return a.status === 'hired' || (a.events || []).some(e => e.type === 'interview_received' || e.type === 'interview_completed')
}

function calcJobSearchHealth(apps: Application[]) {
  if (apps.length < 3) return null
  const terminal = apps.filter(a => a.status !== 'active')
  const responseRate = Math.round((apps.filter(responded).length / apps.length) * 100)
  const ghostRate = Math.round((apps.filter(a => a.status === 'ghosted').length / apps.length) * 100)
  const interviewRate = Math.round((apps.filter(hadInterview).length / apps.length) * 100)
  const score = Math.max(0, Math.min(100, Math.round(50 + responseRate * 0.3 - ghostRate * 0.4 + interviewRate * 0.5)))
  return { score, responseRate, ghostRate, interviewRate, terminal: terminal.length }
}

export default function DashboardPage() {
  const router = useRouter()
  const { user, profile, isLoggedIn, isSeeker, ready, token } = useAuth()
  const [apps, setApps] = useState<Application[]>([])
  const [loading, setLoading] = useState(true)
  const [isPro, setIsPro] = useState(false)
  const [surges, setSurges] = useState<string[]>([])
  const [recentCos, setRecentCos] = useState<Array<{name: string; slug: string}>>([])
  // Greeting by the visitor's local hour — set after mount so the server HTML (UTC) never mismatches.
  const [greeting, setGreeting] = useState('Hey')
  useEffect(() => {
    const h = new Date().getHours()
    setGreeting(h < 5 ? 'Still up' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : h < 22 ? 'Good evening' : 'Late one')
  }, [])
  const [coScores, setCoScores] = useState<Record<string, {ghost_rate: number; overall_score: number; avg_wait_days: number}>>({})
  // Start hidden to avoid a flash for returning users; the effect flips it on for anyone
  // who hasn't dismissed the first-run guide.
  const [onboardHidden, setOnboardHidden] = useState(true)

  useEffect(() => {
    if (!user?.id) return
    try { setOnboardHidden(localStorage.getItem(`seen_onboarding_hidden_${user.id}`) === '1') } catch { setOnboardHidden(false) }
  }, [user?.id])

  useEffect(() => {
    if (!isSeeker) return
    token().then(tok => {
      if (!tok) return
      fetch('/api/user-sync', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` }, body: JSON.stringify({ action: 'get_credits' }) })
        .then(r => r.json()).then(d => setIsPro(!!d?.pro)).catch(() => {})
    })
  }, [isSeeker, token])

  // Inbox Autopilot tile: shown once the feature is live (null = not live yet / unknown → hidden).
  const [inbox, setInbox] = useState<{ ready: boolean; enabled?: boolean; received_count?: number } | null>(null)
  useEffect(() => {
    if (!isSeeker) return
    token().then(tok => {
      if (!tok) return
      fetch('/api/user-sync', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` }, body: JSON.stringify({ action: 'inbox_status' }) })
        .then(r => r.ok ? r.json() : null).then(d => setInbox(d && typeof d.ready === 'boolean' ? d : null)).catch(() => {})
    })
  }, [isSeeker, token])

  useEffect(() => {
    try {
      const raw = localStorage.getItem('seen_recent_cos')
      if (raw) setRecentCos(JSON.parse(raw).slice(0, 5))
    } catch {}
  }, [])

  useEffect(() => {
    if (!ready) return // wait for the session to resolve — redirecting early bounced signed-in users
    if (!isLoggedIn) { router.replace('/login'); return }
    // Employers have no seeker dashboard — route them to their portal. Safety net for a stale
    // link or a post-login redirect race; the login page already sends employers to /employers.
    if (isLoggedIn && !isSeeker) { router.replace('/employers'); return }
  }, [ready, isLoggedIn, isSeeker, router])

  useEffect(() => {
    if (!isLoggedIn) return
    AppStore.load(true).then(data => { setApps(data); setLoading(false) })
  }, [isLoggedIn])

  // Ghost-surge alerts for the companies you're waiting on — served by api/reports.js
  // (action:'ghost_surges', ≥3 scorable ghosted reports in the last 7 days, exact-name match).
  useEffect(() => {
    if (!isLoggedIn || apps.length === 0) return
    const tracked = [...new Set(apps.filter(a => a.status === 'active').map(a => a.company.trim()).filter(Boolean))].slice(0, 20)
    if (!tracked.length) return
    let cancelled = false
    fetch('/api/reports', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'ghost_surges', names: tracked }),
    })
      .then(r => (r.ok ? r.json() : null))
      .then((d: { surges?: Array<{ name: string }> } | null) => {
        if (cancelled || !d?.surges?.length) return
        const hit = new Set(d.surges.map(s => s.name))
        setSurges(tracked.filter(co => hit.has(co.toLowerCase())))
      })
      .catch(() => { /* stale-only fallback */ })
    return () => { cancelled = true }
  }, [isLoggedIn, apps])

  // Reference rates for the benchmark column — the server's ONE set (GET /api/reports?type=industry),
  // labeled as reference estimates. Without them the column is simply not shown.
  const [refRates, setRefRates] = useState<{ response_rate: number; interview_rate: number; offer_rate: number; ghost_rate: number } | null>(null)
  useEffect(() => {
    let cancelled = false
    fetch('/api/reports?type=industry').then(r => (r.ok ? r.json() : null))
      .then((d: { benchmarks?: { response_rate?: number; interview_rate?: number; offer_rate?: number; ghost_rate?: number } } | null) => {
        const b = d?.benchmarks
        if (cancelled || !b || [b.response_rate, b.interview_rate, b.offer_rate, b.ghost_rate].some(v => typeof v !== 'number')) return
        setRefRates({ response_rate: b.response_rate!, interview_rate: b.interview_rate!, offer_rate: b.offer_rate!, ghost_rate: b.ghost_rate! })
      }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  // Batch-fetch company scores for active applications
  useEffect(() => {
    if (!apps.length) return
    const cos = [...new Set(apps.filter(a => a.status === 'active').map(a => a.company.toLowerCase().trim()).filter(Boolean))].slice(0, 20)
    if (!cos.length) return
    fetch('/api/reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'batch_scores', names: cos }),
    })
      .then(r => r.ok ? r.json() : { scores: {} })
      .then((d: { scores?: Record<string, { ghost_rate?: number | null; overall_score?: number | null; avg_wait_days?: number | null; gradeable?: boolean | null; first_party_report_count?: number | null }> }) => {
        if (!d.scores) return
        // Grade gate (lib/gradeGate.ts): only companies with enough real reports feed ghost badges,
        // stale-application thresholds and the average company score.
        const graded: Record<string, {ghost_rate: number; overall_score: number; avg_wait_days: number}> = {}
        for (const [k, v] of Object.entries(d.scores)) {
          if (isGradeableScore(v) && typeof v.ghost_rate === 'number') graded[k] = { ghost_rate: v.ghost_rate, overall_score: v.overall_score, avg_wait_days: v.avg_wait_days ?? 0 }
        }
        setCoScores(graded)
      })
      .catch(() => {})
  }, [apps])

  if (!isLoggedIn || !isSeeker) return null
  if (loading) return <div className="page-full"><div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}><div className="spinner" /></div></div>

  const active = apps.filter(a => a.status === 'active')
  const ghosted = apps.filter(a => a.status === 'ghosted')
  const hired = apps.filter(a => a.status === 'hired')
  const dueChecks = EventStore.dueChecks(apps)
  const staleApps = active.filter(a => {
    const sc = coScores[a.company.toLowerCase()]
    const threshold = sc?.avg_wait_days ? Math.round(sc.avg_wait_days * 1.4) : 30
    return Math.floor((Date.now() - a.appliedAt) / 86400000) > threshold
  })
  const alertCount = staleApps.length + surges.length
  const allEvents = EventStore.get()

  // Survey insight (index.html:9272)
  const frustration = surveyFrustration(profile?.onboarding_survey)
  const surveyInsight = frustration ? FRUSTRATION_MAP[frustration] : null

  // Career Benchmarks — gated n>=3 && terminal>=2
  const benchmarks = (() => {
    const n = apps.length
    const terminal = apps.filter(a => ['hired', 'rejected', 'ghosted'].includes(a.status))
    if (n < 3 || terminal.length < 2) return null
    const rr = Math.round((apps.filter(responded).length / n) * 100)
    const ir = Math.round((apps.filter(hadInterview).length / n) * 100)
    const or = Math.round((hired.length / n) * 100)
    const gr = Math.round((ghosted.length / n) * 100)
    const AVG = refRates ? { rr: Math.round(refRates.response_rate * 100), ir: Math.round(refRates.interview_rate * 100), or: Math.round(refRates.offer_rate * 100), gr: Math.round(refRates.ghost_rate * 100) } : null
    const pct = (v: number, avg: number, hi: boolean) => {
      if (v === 0 && hi) return 5
      const ratio = hi ? v / Math.max(avg, 1) : avg / Math.max(v, 1)
      return Math.min(99, Math.max(1, Math.round(50 * ratio)))
    }
    const col = (v: number, avg: number | null, hi: boolean) => v === 0 || avg == null ? 'var(--muted)' : (hi ? (v >= avg ? 'var(--green)' : 'var(--amber)') : (v <= avg ? 'var(--green)' : v < avg * 1.4 ? 'var(--amber)' : 'var(--red)'))
    const row = (lbl: string, v: number, avg: number | null, hi: boolean) => ({ lbl, val: `${v}%`, pct: avg == null ? 50 : pct(v, avg, hi), avg: avg == null ? 'reference pending' : `${avg}% reference`, col: col(v, avg, hi) })
    return {
      n,
      hasRef: !!AVG,
      metrics: [
        row('Response Rate', rr, AVG?.rr ?? null, true),
        row('Interview Rate', ir, AVG?.ir ?? null, true),
        row('Offer Rate', or, AVG?.or ?? null, true),
        row('Ghost Rate', gr, AVG?.gr ?? null, false),
      ],
    }
  })()

  const badges = BadgeStore.compute(apps, allEvents)
  const health = calcJobSearchHealth(apps)

  const rawName = profile?.name || user?.user_metadata?.name || ''
  const name = rawName ? rawName.charAt(0).toUpperCase() + rawName.slice(1).split(/[^a-zA-Z]/)[0] : 'there'
  const responseNum = apps.length ? Math.round((apps.filter(responded).length / apps.length) * 100) : null

  // Health ring visuals
  const healthColor = health ? (health.score >= 75 ? 'var(--green)' : health.score >= 55 ? 'var(--amber)' : 'var(--red)') : 'var(--muted)'
  const healthDeg = health ? Math.round((health.score / 100) * 360) : 0

  // Status line — "open" = currently in-progress; distinct from "tracked total" (all-time).
  const statusLine = active.length
    ? `${active.length} open application${active.length !== 1 ? 's' : ''}${dueChecks.length ? ` · ${dueChecks.length} check${dueChecks.length > 1 ? 's' : ''} due` : ''}`
    : 'No open applications right now'

  // Next best move
  type Move = { icon: string; title: string; sub: string; go: () => void }
  const moves: Move[] = []
  if (apps.length > 0) {
    if (staleApps[0]) moves.push({ icon: '⏰', title: `Follow up with ${staleApps[0].company}`, sub: 'Past its typical response window', go: () => router.push('/tracker') })
    if (dueChecks.length) moves.push({ icon: '📮', title: `Report ${dueChecks.length} outcome${dueChecks.length > 1 ? 's' : ''}`, sub: 'Unlocks your real response & ghost rates', go: () => router.push('/tracker') })
    if (active[0]) moves.push({ icon: '🔎', title: `Find more roles like ${active[0].company}`, sub: 'Keep your pipeline full', go: () => router.push('/jobs') })
    if (!moves.length) moves.push({ icon: '🔎', title: 'Find your next role', sub: 'Jobs sorted by transparency', go: () => router.push('/jobs') })
  }
  const topMoves = moves.slice(0, 3)

  const hasResume = !!(profile?.resume_file_name || (profile?.resume_word_count ?? 0) > 0)
  const onboardComplete = hasResume && apps.length > 0 && recentCos.length > 0
  const showOnboarding = !onboardHidden && !onboardComplete
  const dismissOnboarding = () => {
    setOnboardHidden(true)
    try { if (user?.id) localStorage.setItem(`seen_onboarding_hidden_${user.id}`, '1') } catch {}
  }

  // Health headline: one plain sentence instead of a caption line.
  const healthHead = !health
    ? { t: 'Your score unlocks soon.', s: `Track ${Math.max(1, 3 - apps.length)} more application${Math.max(1, 3 - apps.length) !== 1 ? 's' : ''} and Seen scores how your search is going.`, badge: 'Getting started', tone: 'muted' }
    : health.terminal < 2
      ? { t: 'Too early to call.', s: 'Report what happened with a couple of applications and this becomes a real read on your search.', badge: 'Early days', tone: 'muted' }
      : health.score >= 75
        ? { t: "You're getting noticed.", s: `${health.interviewRate}% of your applications reached an interview and ${health.responseRate}% got a reply. Keep doing what works.`, badge: 'Strong', tone: 'green' }
        : health.score >= 55
          ? { t: "You're on track.", s: `${health.responseRate}% of your applications got a reply. A follow-up on the quiet ones could tip it.`, badge: 'On track', tone: 'amber' }
          : { t: 'Room to improve.', s: `${health.ghostRate}% of your applications went silent. Check a company's ghost rate before applying and tailor your résumé.`, badge: 'Needs attention', tone: 'red' }
  const signalCount = alertCount + (surveyInsight ? 1 : 0)
  const today = new Date().toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', year: 'numeric' })

  return (
    <div className="page-full">
      <div className={styles.dash}>

        {/* ── First-run getting-started guide ── */}
        {showOnboarding && (
          <WelcomeOnboarding
            name={name}
            state={{ hasResume, appsCount: apps.length, companiesChecked: recentCos.length }}
            onDismiss={dismissOnboarding}
          />
        )}

        {/* ── Intro: who, what matters today, one primary action. (Settings / sign-out live in the
            nav's account menu; Pro shows in the nav.) ── */}
        <header className={styles.intro}>
          <div style={{ minWidth: 0 }}>
            <div className={styles.eyebrow}>✦ Command Center · {today}</div>
            <h1 className={styles.hello}>{greeting}, {name}<span className={styles.dot}>.</span></h1>
            <p className={styles.status}>{statusLine}{apps.length ? <span className={styles.statusDim}> · {apps.length} tracked total</span> : null}</p>
          </div>
          <Link href="/tracker?add=1" className={`${styles.primary} btn-shine`}>+ Track application</Link>
        </header>

        {/* ── Row 1: search health | next best move ── */}
        <div className={styles.row}>
          <section className={`${styles.card} ${styles.health} spot`}>
            <div className={styles.cardHead}>
              <span className={styles.eyebrow}>Job search health</span>
              <span className={`${styles.badge} ${styles[healthHead.tone]}`}>● {healthHead.badge}</span>
            </div>
            <div className={styles.healthBody}>
              <div className={styles.ring} style={{ background: `conic-gradient(${healthColor} ${healthDeg}deg, rgba(255,255,255,.1) 0deg)` }}>
                <span style={{ color: healthColor }}>{health ? <Odometer value={health.score} /> : '—'}</span>
              </div>
              <div style={{ minWidth: 0 }}>
                <h2 className={styles.healthT}>{healthHead.t}</h2>
                <p className={styles.healthS}>{healthHead.s}</p>
              </div>
            </div>
            <div className={styles.pills}>
              <div className={styles.pill}><small>Open</small><b style={{ color: '#93b4ff' }}><Odometer value={active.length} /></b></div>
              <div className={styles.pill}><small>Response</small><b style={{ color: '#a5a2ff' }}>{responseNum == null ? '—' : <Odometer value={responseNum} suffix="%" />}</b></div>
              <div className={styles.pill}><small>Hired</small><b style={{ color: 'var(--green)' }}><Odometer value={hired.length} /></b></div>
              <div className={styles.pill}><small>Ghosted</small><b style={{ color: '#f87185' }}><Odometer value={ghosted.length} /></b></div>
            </div>
            {apps.length > 0 && <p className={styles.caption}>Based on {apps.length} tracked application{apps.length !== 1 ? 's' : ''}</p>}
          </section>

          <section className={`${styles.card} spot`}>
            <div className={styles.cardHead}>
              <h2 className={styles.cardT}>Next best move</h2>
              {topMoves.length > 0 && <span className={styles.eyebrow}>{topMoves.length} action{topMoves.length !== 1 ? 's' : ''}</span>}
            </div>
            {topMoves.length ? topMoves.map((m, i) => (
              <button key={i} type="button" className={styles.move} onClick={m.go}>
                <span className={styles.sym}>{m.icon}</span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <b>{m.title}</b>
                  <small>{m.sub}</small>
                </span>
                <span className={styles.go} aria-hidden="true">→</span>
              </button>
            )) : (
              <div className={styles.empty}>
                <b>Start tracking applications</b>
                <p>Your real response rate, ghost rate and company benchmarks fill in from here.</p>
                <div className={styles.emptyBtns}>
                  <Link href="/jobs" className={`${styles.primary} btn-shine`}>Find jobs</Link>
                  <Link href="/tracker?add=1" className={styles.ghostBtn}>Add one I applied to</Link>
                </div>
              </div>
            )}
          </section>
        </div>

        {/* ── Row 2: active pipeline | signals ── */}
        <div className={styles.secHead}>
          <h2 className={styles.secT}>Active pipeline</h2>
          {active.length > 0 && <Link href="/tracker" className={styles.link}>View all →</Link>}
        </div>
        <div className={styles.row}>
          <section className={`${styles.card} ${styles.tight}`}>
            {active.length === 0 ? (
              <div className={styles.empty}>
                <b>No open applications</b>
                <p>Apply to a job and it appears here until you report what happened.</p>
                <div className={styles.emptyBtns}><Link href="/jobs" className={styles.ghostBtn}>Find your next job →</Link></div>
              </div>
            ) : active.slice(0, 4).map(app => {
              const days = Math.floor((Date.now() - app.appliedAt) / 86400000)
              const sc = coScores[app.company.toLowerCase()]
              const ghostPct = sc ? Math.round(sc.ghost_rate * 100) : null
              const tone = sc ? (sc.ghost_rate > 0.55 ? 'var(--red)' : sc.ghost_rate > 0.35 ? 'var(--amber)' : 'var(--green)') : undefined
              return (
                <Link key={app.id} href={`/tracker#app_${app.id}`} className={styles.job}>
                  <span className={styles.jobIco}>{(app.company || '?').charAt(0).toUpperCase()}</span>
                  <span className={styles.jobInfo}>
                    <b>{app.company}</b>
                    <small>{app.role || 'Role'}</small>
                    <small className={styles.jobMeta}>Day {days}{ghostPct != null && <> · <span style={{ color: tone }}>{ghostPct}% reported ghost rate</span></>}</small>
                  </span>
                  <span className={styles.stage}>{app.stage}</span>
                </Link>
              )
            })}
          </section>

          <section className={`${styles.card} ${styles.tight}`}>
            <div className={styles.cardHead}>
              <h2 className={styles.cardT}>Signals</h2>
              {signalCount > 0 && <span className={`${styles.badge} ${styles.red}`}>{signalCount} to review</span>}
            </div>
            {signalCount === 0 && <p className={styles.allClear}>All clear. Nothing needs you right now.</p>}
            {surveyInsight && (
              <div className={styles.signal}>
                <span style={{ color: 'var(--green)' }}>✓</span>
                <span><b>{surveyInsight.label}</b><small>{surveyInsight.desc}</small></span>
              </div>
            )}
            {surges.map(co => (
              <button key={`surge-${co}`} type="button" className={styles.signal} onClick={() => router.push(`/company/${companySlug(co)}`)}>
                <span>👻</span>
                <span><b style={{ color: '#fca5a5' }}>{co}: ghost surge</b><small>3+ ghost reports this week. Check before you follow up.</small></span>
              </button>
            ))}
            {staleApps.slice(0, 3).map(a => {
              const days = Math.floor((Date.now() - a.appliedAt) / 86400000)
              return (
                <button key={`stale-${a.id}`} type="button" className={styles.signal} onClick={() => router.push(`/tracker#app_${a.id}`)}>
                  <span style={{ color: 'var(--amber)' }}>⚠</span>
                  <span><b>{a.company} has been quiet for {days} days</b><small>Past its usual response window. Follow up or update the outcome.</small></span>
                </button>
              )
            })}
            {!isPro && (
              <Link href="/pricing" className={styles.lock}>
                <span>🔒 Unlimited AI credits and deeper company analysis</span><span className={styles.link}>Pro →</span>
              </Link>
            )}
          </section>
        </div>

        {/* ── Benchmarks (only once there is enough of your own data) ── */}
        {benchmarks && (
          <>
            <div className={styles.secHead}>
              <h2 className={styles.secT}>Career benchmarks</h2>
              <span className={styles.eyebrow}>{benchmarks.hasRef ? 'You vs reference estimates' : 'Your rates'}</span>
            </div>
            <div className={styles.metrics}>
              {benchmarks.metrics.map(m => (
                <div key={m.lbl} className={styles.metric}>
                  <span className={styles.eyebrow}>{m.lbl}</span>
                  <b style={{ color: m.col }}>{m.val}</b>
                  <small>{m.avg}</small>
                </div>
              ))}
            </div>
            <p className={styles.caption}>Based on {benchmarks.n} tracked applications. Treat small samples as directional.{benchmarks.hasRef ? ' Reference figures are industry-wide estimates, not Seen user data.' : ''}</p>
          </>
        )}

        {/* ── Toolkit (the résumé status lives on its tile) ── */}
        <div className={styles.secHead}>
          <h2 className={styles.secT}>Your toolkit</h2>
        </div>
        <div className={styles.tools}>
          <Link href="/resume" className={`${styles.tool} spot`}>
            <span className={styles.sym}>🧠</span>
            <b>Résumé AI</b>
            <small>{hasResume ? `${profile?.resume_file_name || 'Résumé on file'} · Scan fit →` : 'Add your résumé →'}</small>
          </Link>
          <Link href="/tracker" className={`${styles.tool} spot`}>
            <span className={styles.sym}>📋</span>
            <b>Applications</b>
            <small>{dueChecks.length ? `${dueChecks.length} check-in${dueChecks.length > 1 ? 's' : ''} waiting →` : 'Manage your pipeline →'}</small>
          </Link>
          {inbox?.ready && (
            <Link href="/tracker#autopilot" className={`${styles.tool} spot`}>
              <span className={styles.sym}>✉️</span>
              <b>Inbox Autopilot</b>
              <small>{inbox.enabled ? `On · ${inbox.received_count || 0} email${inbox.received_count === 1 ? '' : 's'} read →` : 'Forward job emails — tracking fills itself →'}</small>
            </Link>
          )}
          <Link href="/companies" className={`${styles.tool} spot`}>
            <span className={styles.sym}>🏢</span>
            <b>Company intel</b>
            <small>See who actually responds →</small>
          </Link>
          <Link href="/report" className={`${styles.tool} spot`}>
            <span className={styles.sym}>📣</span>
            <b>Report an outcome</b>
            <small>Warn the next applicant →</small>
          </Link>
        </div>

        {/* ── Quiet footer rows: recently checked + badges ── */}
        {(recentCos.length > 0 || badges.length > 0) && (
          <div className={styles.quiet}>
            {recentCos.length > 0 && (
              <div className={styles.quietRow}>
                <span className={styles.eyebrow}>Recently checked</span>
                <div className={styles.chips}>
                  {recentCos.map((co, i) => <a key={i} href={`/company/${co.slug}`} className="dchip">{co.name}</a>)}
                </div>
              </div>
            )}
            {badges.length > 0 && (
              <div className={styles.quietRow}>
                <span className={styles.eyebrow}>Badges</span>
                <div className={styles.chips}>
                  {badges.map(b => <span key={b.id} className={styles.badgeChip} title={b.desc}>{b.icon} {b.label}</span>)}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

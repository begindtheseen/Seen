'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { AppStore } from '@/lib/stores/AppStore'
import { EventStore } from '@/lib/stores/EventStore'
import { BadgeStore } from '@/lib/stores/BadgeStore'
import WelcomeOnboarding from '@/components/WelcomeOnboarding'
import type { Application } from '@/lib/types'

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

function calcJobSearchHealth(apps: Application[]) {
  if (apps.length < 3) return null
  const terminal = apps.filter(a => a.status !== 'active')
  const responseRate = terminal.length > 0 ? Math.round((apps.filter(a => a.status !== 'active' && a.status !== 'ghosted').length / apps.length) * 100) : 0
  const ghostRate = Math.round((apps.filter(a => a.status === 'ghosted').length / apps.length) * 100)
  const interviewRate = Math.round((apps.filter(a => (a.events || []).some(e => e.type === 'interview_received' || e.type === 'interview_completed')).length / apps.length) * 100)
  const score = Math.max(0, Math.min(100, Math.round(50 + responseRate * 0.3 - ghostRate * 0.4 + interviewRate * 0.5)))
  return { score, responseRate, ghostRate, interviewRate, avgCompanyScore: 65 }
}

export default function DashboardPage() {
  const router = useRouter()
  const { user, profile, isLoggedIn, isSeeker, ready, token } = useAuth()
  const [apps, setApps] = useState<Application[]>([])
  const [loading, setLoading] = useState(true)
  const [isPro, setIsPro] = useState(false)
  const [surges, setSurges] = useState<string[]>([])
  const [recentCos, setRecentCos] = useState<Array<{name: string; slug: string}>>([])
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

  // Ghost-surge alerts — read public reports via the anon client (parity: index.html:9447).
  useEffect(() => {
    if (!isLoggedIn || apps.length === 0) return
    const tracked = [...new Set(apps.filter(a => a.status !== 'ghosted').map(a => a.company).filter(Boolean))].slice(0, 4)
    if (!tracked.length) return
    const cutoff = new Date(Date.now() - 7 * 86400000).toISOString()
    ;(async () => {
      try {
        const { data, error } = await supabase
          .from('reports').select('company_name').eq('outcome', 'ghosted').gte('created_at', cutoff).limit(300)
        if (error || !data?.length) return
        const counts: Record<string, number> = {}
        for (const r of data as { company_name: string | null }[]) {
          if (r.company_name) { const k = r.company_name.toLowerCase(); counts[k] = (counts[k] || 0) + 1 }
        }
        const found = tracked.filter(co => {
          const ck = co.toLowerCase()
          return Object.entries(counts).some(([k, c]) => (k.includes(ck) || ck.includes(k)) && c >= 3)
        })
        if (found.length) setSurges(found)
      } catch { /* RLS / network — stale-only fallback */ }
    })()
  }, [isLoggedIn, apps])

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
      .then((d: { scores?: Record<string, {ghost_rate: number; overall_score: number; avg_wait_days: number}> }) => {
        if (d.scores) setCoScores(d.scores)
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
    const withInt = apps.filter(a => (a.events || []).some(e => e.type === 'interview_received' || e.type === 'interview_completed'))
    const rr = Math.round((terminal.length / n) * 100)
    const ir = Math.round((withInt.length / n) * 100)
    const or = Math.round((hired.length / n) * 100)
    const gr = Math.round((ghosted.length / n) * 100)
    const AVG = { rr: 22, ir: 10, or: 4, gr: 55 }
    const pct = (v: number, avg: number, hi: boolean) => {
      if (v === 0 && hi) return 5
      const ratio = hi ? v / Math.max(avg, 1) : avg / Math.max(v, 1)
      return Math.min(99, Math.max(1, Math.round(50 * ratio)))
    }
    const col = (v: number, avg: number, hi: boolean) => v === 0 ? 'var(--muted)' : (hi ? (v >= avg ? 'var(--green)' : 'var(--amber)') : (v <= avg ? 'var(--green)' : v < avg * 1.4 ? 'var(--amber)' : 'var(--red)'))
    return {
      n,
      metrics: [
        { lbl: 'Response Rate', val: `${rr}%`, pct: pct(rr, AVG.rr, true), avg: `${AVG.rr}% avg`, col: col(rr, AVG.rr, true) },
        { lbl: 'Interview Rate', val: `${ir}%`, pct: pct(ir, AVG.ir, true), avg: `${AVG.ir}% avg`, col: col(ir, AVG.ir, true) },
        { lbl: 'Offer Rate', val: `${or}%`, pct: pct(or, AVG.or, true), avg: `${AVG.or}% avg`, col: col(or, AVG.or, true) },
        { lbl: 'Ghost Rate', val: `${gr}%`, pct: pct(gr, AVG.gr, false), avg: `${AVG.gr}% avg`, col: col(gr, AVG.gr, false) },
      ],
    }
  })()

  const badges = BadgeStore.compute(apps, allEvents)
  const health = calcJobSearchHealth(apps)
  if (health && Object.keys(coScores).length > 0) {
    const appliedScores = active
      .map(a => coScores[a.company.toLowerCase()]?.overall_score)
      .filter((s): s is number => typeof s === 'number')
    if (appliedScores.length) {
      health.avgCompanyScore = Math.round(appliedScores.reduce((a, b) => a + b, 0) / appliedScores.length)
    }
  }

  const rawName = profile?.name || user?.user_metadata?.name || ''
  const name = rawName ? rawName.charAt(0).toUpperCase() + rawName.slice(1).split(/[^a-zA-Z]/)[0] : 'there'
  const responseRate = apps.length ? Math.round((apps.filter(a => a.status !== 'active' && a.status !== 'ghosted').length / apps.length) * 100) + '%' : '—'

  // Health ring visuals
  const healthColor = health ? (health.score >= 75 ? 'var(--green)' : health.score >= 55 ? 'var(--amber)' : 'var(--red)') : 'var(--muted)'
  const healthDeg = health ? Math.round((health.score / 100) * 360) : 0

  // Status line — "open" = currently in-progress; distinct from "tracked total" (all-time).
  const statusLine = active.length
    ? `${active.length} open application${active.length !== 1 ? 's' : ''}${dueChecks.length ? ` · ${dueChecks.length} check${dueChecks.length > 1 ? 's' : ''} due` : ''}`
    : 'No open applications right now'
  // Historical context — only shown once the user has tracked anything.
  const contextLine = apps.length
    ? `${apps.length} tracked total · ${hired.length} hired · ${ghosted.length} ghosted`
    : "Hit 'Apply' on any job to start tracking"

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

  return (
    <div className="page-full">
      <div className="dash">

        {/* ── A. First-run getting-started guide ─────────────────── */}
        {showOnboarding && (
          <WelcomeOnboarding
            name={name}
            state={{ hasResume, appsCount: apps.length, companiesChecked: recentCos.length }}
            onDismiss={dismissOnboarding}
          />
        )}

        {/* ── B. Hero Command Center ─────────────────────────────── */}
        <section className="dhero">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.5rem', marginBottom: '.9rem' }}>
            <span className="deyebrow">✦ Command Center</span>
            <div style={{ display: 'flex', gap: '.4rem', alignItems: 'center', flexShrink: 0 }}>
              {isPro && (
                <Link href="/pricing" title="Seen Pro — manage membership" style={{ fontFamily: 'var(--mono)', fontSize: '.56rem', fontWeight: 700, letterSpacing: '.05em', color: 'var(--green)', background: 'rgba(16,185,129,.14)', border: '1px solid rgba(16,185,129,.4)', borderRadius: 7, padding: '.24rem .5rem', textDecoration: 'none' }}>★ PRO</Link>
              )}
              <Link href="/profile" title="Settings" style={{ fontFamily: 'var(--mono)', fontSize: '.66rem', color: 'var(--sub)', border: '1px solid var(--line2)', borderRadius: 7, padding: '.24rem .5rem', textDecoration: 'none' }}>⚙</Link>
              <button onClick={async () => { await supabase.auth.signOut(); router.push('/') }} style={{ fontFamily: 'var(--mono)', fontSize: '.56rem', color: 'var(--muted)', background: 'none', border: '1px solid var(--line2)', borderRadius: 7, padding: '.24rem .5rem', cursor: 'pointer' }}>Sign out</button>
            </div>
          </div>

          <h1 className="dhero-name">Hey, {name}.</h1>
          <p className="dhero-status" style={{ marginBottom: apps.length ? '.25rem' : '1rem' }}>{statusLine}</p>
          {apps.length > 0 && (
            <p style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--dim)', marginBottom: '1rem' }}>{contextLine}</p>
          )}

          {/* Job Search Health — historical performance across all tracked apps */}
          <div className="dhealth">
            <div className="dring" style={{ background: `conic-gradient(${healthColor} ${healthDeg}deg, var(--line2) 0deg)` }}>
              <span style={{ color: healthColor }}>{health ? health.score : '—'}</span>
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: 'var(--display)', fontSize: '.82rem', fontWeight: 700, color: 'var(--white)' }}>Job Search Health</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--sub)', marginTop: '.15rem', lineHeight: 1.5 }}>
                {health
                  ? `${health.score >= 75 ? 'Performing above average' : health.score >= 55 ? 'On track' : 'Room to improve'} · based on ${apps.length} tracked app${apps.length !== 1 ? 's' : ''}`
                  : `Track ${Math.max(1, 3 - apps.length)} more application${Math.max(1, 3 - apps.length) !== 1 ? 's' : ''} to unlock your score`}
              </div>
            </div>
          </div>

          {/* Stat pills — "Open" is current; Response/Hired/Ghosted are all-time (see caption) */}
          <div className="dpills">
            <div className="dpill"><div className="dpill-l">Open</div><div className="dpill-n" style={{ color: 'var(--blue)' }}>{active.length}</div></div>
            <div className="dpill"><div className="dpill-l">Response</div><div className="dpill-n" style={{ color: 'var(--indigo)' }}>{responseRate}</div></div>
            <div className="dpill"><div className="dpill-l">Hired</div><div className="dpill-n" style={{ color: 'var(--green)' }}>{hired.length}</div></div>
            <div className="dpill"><div className="dpill-l">Ghosted</div><div className="dpill-n" style={{ color: 'var(--red)' }}>{ghosted.length}</div></div>
          </div>
          {apps.length > 0 && (
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.5rem', color: 'var(--muted)', textAlign: 'center', marginTop: '.45rem', letterSpacing: '.04em' }}>
              Response · Hired · Ghosted based on {apps.length} tracked app{apps.length !== 1 ? 's' : ''}
            </div>
          )}

          {/* CTAs */}
          <div className="dhero-cta">
            <Link href="/jobs" className="dbtn dbtn-primary">Find jobs →</Link>
            <Link href="/report" className="dbtn dbtn-ghost">Report outcome</Link>
          </div>
        </section>

        {/* ── B2. Résumé — always-visible upload / status entry ──── */}
        <section>
          <div className="dcard dcard-pad" style={{ display: 'flex', alignItems: 'center', gap: '.8rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '1.5rem', flexShrink: 0 }}>📄</span>
            <div style={{ minWidth: 0, flex: '1 1 160px' }}>
              {hasResume ? (
                <>
                  <div style={{ fontFamily: 'var(--display)', fontSize: '.85rem', fontWeight: 700, color: 'var(--white)' }}>Résumé on file</div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--muted)', marginTop: '.15rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {profile?.resume_file_name || 'Résumé'}{profile?.resume_word_count ? ` · ${profile.resume_word_count} words` : ''}
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontFamily: 'var(--display)', fontSize: '.85rem', fontWeight: 700, color: 'var(--white)' }}>Add your résumé</div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--muted)', marginTop: '.15rem', lineHeight: 1.45 }}>Upload a PDF or Word doc to unlock résumé-fit scoring and earn AI credits</div>
                </>
              )}
            </div>
            <div style={{ display: 'flex', gap: '.45rem', flexShrink: 0 }}>
              {hasResume ? (
                <>
                  <Link href="/resume" className="dbtn dbtn-primary" style={{ flex: 'none', padding: '.5rem .9rem' }}>Scan résumé fit →</Link>
                  <Link href="/resume" className="dbtn dbtn-ghost" style={{ flex: 'none', padding: '.5rem .8rem' }}>Replace</Link>
                </>
              ) : (
                <Link href="/resume" className="dbtn dbtn-primary" style={{ flex: 'none', padding: '.5rem 1rem' }}>Upload résumé →</Link>
              )}
            </div>
          </div>
        </section>

        {/* ── C. Next Best Move ──────────────────────────────────── */}
        <section>
          <div className="dsec-head"><div className="dsec-title">Next best move</div></div>
          {active.length === 0 ? (
            <div className="dcard dcard-pad">
              <div style={{ fontFamily: 'var(--display)', fontSize: '.92rem', fontWeight: 800, color: 'var(--white)', marginBottom: '.35rem', letterSpacing: '-.02em' }}>
                {apps.length ? 'Start your next tracked application' : 'Start tracking applications'}
              </div>
              <p style={{ fontSize: '.78rem', color: 'var(--sub)', lineHeight: 1.6, marginBottom: '.9rem' }}>
                {apps.length
                  ? `You've tracked ${apps.length} application${apps.length !== 1 ? 's' : ''} and landed ${hired.length} hire${hired.length !== 1 ? 's' : ''}. Keep the streak going by adding your next role.`
                  : 'Start tracking applications to unlock your real response rate, ghost rate, and company benchmarks.'}
              </p>
              <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
                <Link href="/jobs" className="dbtn dbtn-primary" style={{ flex: '1 1 auto' }}>Find jobs</Link>
                <Link href="/tracker" className="dbtn dbtn-ghost" style={{ flex: '1 1 auto' }}>Add application</Link>
                <Link href="/resume" className="dbtn dbtn-ghost" style={{ flex: '1 1 auto' }}>Upload résumé</Link>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
              {topMoves.map((m, i) => (
                <button key={i} className="dmove" onClick={m.go}>
                  <span className="dmove-ic">{m.icon}</span>
                  <span style={{ minWidth: 0 }}>
                    <span className="dmove-t" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.title}</span>
                    <span className="dmove-s" style={{ display: 'block' }}>{m.sub}</span>
                  </span>
                  <span className="dmove-x">→</span>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* ── D. Active Pipeline ─────────────────────────────────── */}
        <section>
          <div className="dsec-head">
            <div className="dsec-title">Active pipeline</div>
            {active.length > 0 && <Link href="/tracker" className="dsec-link">View all →</Link>}
          </div>
          {active.length === 0 ? (
            <div className="dpipe-empty">
              <div style={{ fontSize: '1.6rem', marginBottom: '.4rem' }}>📋</div>
              <div style={{ fontFamily: 'var(--display)', fontSize: '.85rem', fontWeight: 700, color: 'var(--white)', marginBottom: '.25rem' }}>No open applications</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--muted)', lineHeight: 1.6, marginBottom: '1rem' }}>When you apply to a new job, it&apos;ll appear here until you report the outcome.</div>
              <Link href="/jobs" className="dbtn dbtn-primary" style={{ display: 'inline-flex', flex: 'none', padding: '.6rem 1.2rem' }}>Find your next tracked job →</Link>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
              {active.slice(0, 4).map(app => {
                const days = Math.floor((Date.now() - app.appliedAt) / 86400000)
                const sc = coScores[app.company.toLowerCase()]
                const ghostPct = sc ? Math.round(sc.ghost_rate * 100) : null
                const risk = sc ? (sc.ghost_rate > 0.55 ? { c: 'var(--red)', t: 'high ghost risk' } : sc.ghost_rate > 0.35 ? { c: 'var(--amber)', t: `${ghostPct}% ghost` } : { c: 'var(--green)', t: `${ghostPct}% ghost` }) : null
                return (
                  <div key={app.id} className="dpipe">
                    <div className="dpipe-logo">{(app.company || '?').charAt(0).toUpperCase()}</div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontFamily: 'var(--display)', fontSize: '.83rem', fontWeight: 700, color: 'var(--white)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{app.company}</div>
                      <div style={{ fontFamily: 'var(--mono)', fontSize: '.56rem', color: 'var(--muted)', marginTop: '.12rem', display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{app.role || 'Role'}</span>
                        <span>· Day {days}</span>
                        {risk && <span style={{ color: risk.c }}>· {risk.t}</span>}
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '.3rem', flexShrink: 0 }}>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', background: 'var(--raised)', border: '1px solid var(--line)', borderRadius: 6, padding: '.18rem .45rem', color: 'var(--sub)' }}>{app.stage}</span>
                      <button onClick={() => router.push('/tracker')} style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--blue)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Update outcome →</button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        {/* ── E. Quick Actions ───────────────────────────────────── */}
        <section>
          <div className="dqa">
            <Link href="/resume" className="dqa-tile"><span className="dqa-ic">🧠</span><div className="dqa-t">Resume AI</div><div className="dqa-s">Optimize before applying</div></Link>
            <Link href="/tracker" className="dqa-tile"><span className="dqa-ic">📋</span><div className="dqa-t">All applications</div><div className="dqa-s">View your pipeline</div></Link>
            <Link href="/demand" className="dqa-tile"><span className="dqa-ic">🗺️</span><div className="dqa-t">Demand map</div><div className="dqa-s">See where hiring is hot</div></Link>
            <Link href="/report" className="dqa-tile"><span className="dqa-ic">📢</span><div className="dqa-t">Report outcome</div><div className="dqa-s">Help the community</div></Link>
          </div>
        </section>

        {/* ── F. Signals / Alerts ────────────────────────────────── */}
        <section>
          <div className="dsec-head"><div className="dsec-title">Signals</div>
            {alertCount > 0 && <span style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', background: 'var(--rdim)', color: 'var(--red)', border: '1px solid #ff3b5c28', borderRadius: 100, padding: '.1rem .45rem' }}>{alertCount}</span>}
          </div>
          <div className="dcard">
            {surveyInsight && (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '.6rem', padding: '.7rem .9rem', borderBottom: (alertCount > 0) ? '1px solid var(--line)' : 'none' }}>
                <span style={{ color: 'var(--green)', flexShrink: 0 }}>✓</span>
                <div><div style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--green)', fontWeight: 600 }}>{surveyInsight.label}</div><div style={{ fontSize: '.68rem', color: 'var(--sub)', fontWeight: 300, marginTop: '.1rem' }}>{surveyInsight.desc}</div></div>
              </div>
            )}
            {alertCount === 0 && !surveyInsight && (
              <div style={{ padding: '.9rem 1rem', fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'var(--muted)', textAlign: 'center' }}>All clear ✓</div>
            )}
            {surges.map(co => (
              <button key={`surge-${co}`} onClick={() => router.push(`/company/${companySlug(co)}`)} style={{ width: '100%', textAlign: 'left', padding: '.7rem .9rem', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'flex-start', gap: '.55rem', cursor: 'pointer', background: 'rgba(239,68,68,.04)', border: 'none' }}>
                <span style={{ flexShrink: 0 }}>👻</span>
                <span><span style={{ display: 'block', fontSize: '.72rem', fontWeight: 600, color: 'var(--red)' }}>{co} — ghost surge</span><span style={{ display: 'block', fontFamily: 'var(--mono)', fontSize: '.56rem', color: 'var(--muted)', marginTop: '.1rem' }}>3+ ghost reports this week · check before you follow up</span></span>
              </button>
            ))}
            {staleApps.slice(0, 3).map(a => {
              const days = Math.floor((Date.now() - a.appliedAt) / 86400000)
              return (
                <button key={`stale-${a.id}`} onClick={() => router.push('/tracker')} style={{ width: '100%', textAlign: 'left', padding: '.7rem .9rem', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'flex-start', gap: '.55rem', cursor: 'pointer', background: 'none', border: 'none' }}>
                  <span style={{ color: 'var(--amber)', flexShrink: 0 }}>⚠</span>
                  <span><span style={{ display: 'block', fontSize: '.72rem', fontWeight: 600, color: 'var(--white)' }}>{a.company} — {a.role}</span><span style={{ display: 'block', fontFamily: 'var(--mono)', fontSize: '.56rem', color: 'var(--muted)', marginTop: '.1rem' }}>{days}d no update · past expected window</span></span>
                </button>
              )
            })}
            {/* Subtle Pro upsell — a small locked row, not a huge CTA */}
            {!isPro && (
              <button onClick={() => router.push('/pricing')} style={{ width: '100%', textAlign: 'left', padding: '.6rem .9rem', display: 'flex', alignItems: 'center', gap: '.55rem', cursor: 'pointer', background: 'none', border: 'none' }}>
                <span style={{ flexShrink: 0, opacity: .7 }}>🔒</span>
                <span style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--muted)', flex: 1 }}>Ghost-surge email alerts before you apply</span>
                <span style={{ fontFamily: 'var(--mono)', fontSize: '.56rem', color: 'var(--blue)', flexShrink: 0 }}>Pro →</span>
              </button>
            )}
          </div>
        </section>

        {/* ── G. Recently Checked Companies ──────────────────────── */}
        {recentCos.length > 0 && (
          <section>
            <div className="dsec-head"><div className="dsec-title" style={{ fontSize: '.82rem' }}>Recently checked companies</div></div>
            <div style={{ display: 'flex', gap: '.45rem', flexWrap: 'wrap' }}>
              {recentCos.map((co, i) => (
                <a key={i} href={`/company/${co.slug}`} className="dchip">{co.name}</a>
              ))}
            </div>
          </section>
        )}

        {/* ── H. Career Benchmarks ───────────────────────────────── */}
        {benchmarks && (
          <section>
            <div className="dsec-head"><div className="dsec-title" style={{ fontSize: '.82rem' }}>Career benchmarks</div><span className="deyebrow">Based on {benchmarks.n} tracked app{benchmarks.n !== 1 ? 's' : ''} · vs industry avg</span></div>
            <div className="dbench">
              {benchmarks.metrics.map(m => (
                <div key={m.lbl} className="dbench-c">
                  <div style={{ fontFamily: 'var(--mono)', fontSize: '.5rem', textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--muted)', marginBottom: '.3rem' }}>{m.lbl}</div>
                  <div style={{ fontFamily: 'var(--display)', fontSize: '1.35rem', fontWeight: 800, color: m.col, lineHeight: 1 }}>{m.val}</div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', color: 'var(--dim)', marginTop: '.2rem' }}>Top {m.pct}% · {m.avg}</div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── I. Earned Badges ───────────────────────────────────── */}
        {badges.length > 0 && (
          <section>
            <div className="dsec-head"><div className="dsec-title" style={{ fontSize: '.82rem' }}>Earned badges</div><span className="deyebrow">Your achievements</span></div>
            <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
              {badges.map(b => (
                <div key={b.id} style={{ background: 'var(--surface)', border: '1px solid var(--line2)', borderRadius: 10, padding: '.5rem .75rem', display: 'flex', alignItems: 'center', gap: '.45rem' }}>
                  <span style={{ fontSize: '1rem' }}>{b.icon}</span>
                  <div><div style={{ fontFamily: 'var(--display)', fontSize: '.7rem', fontWeight: 700, color: 'var(--white)', lineHeight: 1.2 }}>{b.label}</div><div style={{ fontFamily: 'var(--mono)', fontSize: '.5rem', color: 'var(--muted)' }}>{b.desc}</div></div>
                </div>
              ))}
            </div>
          </section>
        )}

      </div>
    </div>
  )
}

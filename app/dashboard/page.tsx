'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { AppStore } from '@/lib/stores/AppStore'
import { EventStore } from '@/lib/stores/EventStore'
import { BadgeStore } from '@/lib/stores/BadgeStore'
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
  const { user, profile, isLoggedIn, isSeeker } = useAuth()
  const [apps, setApps] = useState<Application[]>([])
  const [loading, setLoading] = useState(true)
  const [surges, setSurges] = useState<string[]>([])
  const [recentCos, setRecentCos] = useState<Array<{name: string; slug: string}>>([])
  const [coScores, setCoScores] = useState<Record<string, {ghost_rate: number; overall_score: number; avg_wait_days: number}>>({})

  useEffect(() => {
    try {
      const raw = localStorage.getItem('seen_recent_cos')
      if (raw) setRecentCos(JSON.parse(raw).slice(0, 5))
    } catch {}
  }, [])

  useEffect(() => {
    if (!isLoggedIn) { router.replace('/login'); return }
    if (isLoggedIn && !isSeeker) { router.replace('/'); return }
  }, [isLoggedIn, isSeeker, router])

  useEffect(() => {
    if (!isLoggedIn) return
    AppStore.load(true).then(data => { setApps(data); setLoading(false) })
  }, [isLoggedIn])

  // Ghost-surge alerts — read public reports via the anon client (parity: index.html:9447).
  // Degrades gracefully (stale-only alerts) if the read is blocked by RLS or returns empty.
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
  if (loading) return <div className="page"><div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}><div className="spinner" /></div></div>

  const active = apps.filter(a => a.status === 'active')
  const ghosted = apps.filter(a => a.status === 'ghosted')
  const hired = apps.filter(a => a.status === 'hired')
  const dueChecks = EventStore.dueChecks(apps)
  // Stale: active apps with no update for 30+ days (flat threshold — no per-company wait data client-side)
  const staleApps = active.filter(a => Math.floor((Date.now() - a.appliedAt) / 86400000) > 30)
  const alertCount = staleApps.length + surges.length
  const allEvents = EventStore.get()

  // Survey insight (index.html:9272)
  const frustration = surveyFrustration(profile?.onboarding_survey)
  const surveyInsight = frustration ? FRUSTRATION_MAP[frustration] : null

  // Career Benchmarks (index.html:9516) — gated n>=3 && terminal>=2
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

  // Pipeline insight (index.html:9355) — gated apps>=2. avgRT omitted (responseTimeDays not tracked);
  // overdue uses flat >33d threshold (30*1.1 — no COS client data).
  const pipelineParts: { text: string; color?: string; onClick?: () => void }[] = (() => {
    if (apps.length < 2) return []
    const resolved = apps.filter(a => a.status !== 'active')
    const personalRR = apps.length ? Math.round((apps.filter(a => a.status === 'hired' || a.status === 'rejected').length / apps.length) * 100) : null
    const overdue = active.filter(a => Math.floor((Date.now() - a.appliedAt) / 86400000) > 33)
    const parts: { text: string; color?: string; onClick?: () => void }[] = []
    if (dueChecks.length) parts.push({ text: `${dueChecks.length} check${dueChecks.length > 1 ? 's' : ''} due →`, color: 'var(--amber)', onClick: () => router.push('/tracker') })
    if (overdue.length) parts.push({ text: `⚠ ${overdue.length} app${overdue.length > 1 ? 's' : ''} past response window`, color: 'var(--red)' })
    if (personalRR !== null && resolved.length >= 2) parts.push({ text: `your response rate: ${personalRR}%` })
    if (ghosted.length) parts.push({ text: `${ghosted.length} ghosted` })
    if (hired.length) parts.push({ text: `${hired.length} hired 🎉` })
    return parts
  })()
  const badges = BadgeStore.compute(apps, allEvents)
  const health = calcJobSearchHealth(apps)

  const hour = new Date().getHours()
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const rawName = profile?.name || user?.user_metadata?.name || ''
  const name = rawName ? rawName.charAt(0).toUpperCase() + rawName.slice(1).split(/[^a-zA-Z]/)[0] : 'there'

  const responseRate = apps.length ? Math.round((apps.filter(a => a.status !== 'active' && a.status !== 'ghosted').length / apps.length) * 100) + '%' : '—'

  return (
    <div
      className="page-full"
    >
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '1.5rem 1.25rem 3rem' }}>

        {/* Greeting */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '.75rem', marginBottom: '1.75rem' }}>
          <div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', textTransform: 'uppercase', letterSpacing: '.22em', color: 'var(--green)', marginBottom: '.6rem', display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ width: 22, height: 1, background: 'var(--green)', display: 'inline-block', flexShrink: 0 }} />
              <span>{greet}</span>
            </div>
            <h1 style={{ fontFamily: 'var(--display)', fontSize: '2.2rem', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.045em', marginBottom: '.2rem', lineHeight: 1.05 }}>
              Hey, {name}.
            </h1>
            <p style={{ fontSize: '.8rem', color: 'var(--sub)', fontWeight: 300, marginBottom: '.75rem' }}>
              {active.length ? `You have ${active.length} active application${active.length !== 1 ? 's' : ''}.` : "No applications tracked yet. Hit 'Apply' on any job."}
              {dueChecks.length > 0 && (
                <>
                  {' '}
                  <button
                    onClick={() => router.push('/tracker')}
                    style={{ background: 'none', border: 'none', padding: 0, fontFamily: 'inherit', fontSize: 'inherit', color: 'var(--amber)', cursor: 'pointer' }}
                  >
                    {dueChecks.length} check{dueChecks.length > 1 ? 's' : ''} due →
                  </button>
                </>
              )}
            </p>
          </div>
          <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexShrink: 0 }}>
            <a href="/profile" style={{ background: 'none', border: '1px solid var(--line2)', color: 'var(--sub)', borderRadius: 8, padding: '.32rem .7rem', fontFamily: 'var(--mono)', fontSize: '.62rem', cursor: 'pointer', textDecoration: 'none', whiteSpace: 'nowrap' }}>
              ⚙ Settings
            </a>
            <button
              onClick={async () => { await supabase.auth.signOut(); router.push('/') }}
              style={{ background: 'none', border: '1px solid var(--line2)', color: 'var(--muted)', borderRadius: 8, padding: '.32rem .7rem', fontFamily: 'var(--mono)', fontSize: '.62rem', cursor: 'pointer', whiteSpace: 'nowrap' }}
            >
              Sign out
            </button>
          </div>
        </div>

        {/* Survey insight */}
        {surveyInsight && (
          <div style={{ background: 'var(--gdim)', border: '1px solid var(--gmid)', borderRadius: 8, padding: '.65rem .9rem', display: 'flex', alignItems: 'flex-start', gap: '.65rem', marginBottom: '1rem' }}>
            <span style={{ color: 'var(--green)', fontSize: '.9rem', flexShrink: 0 }}>✓</span>
            <div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--green)', fontWeight: 600, marginBottom: '.1rem' }}>{surveyInsight.label}</div>
              <div style={{ fontSize: '.72rem', color: 'var(--sub)', fontWeight: 300 }}>{surveyInsight.desc}</div>
            </div>
          </div>
        )}

        {/* Open loops — unfinished intelligence */}
        {(dueChecks.length > 0 || staleApps.length > 0) && (
          <div style={{ background: 'rgba(245,158,11,0.05)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 12, padding: '.85rem 1rem', marginBottom: '1.25rem' }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', textTransform: 'uppercase', letterSpacing: '.12em', color: 'var(--amber)', fontWeight: 700, marginBottom: '.6rem', display: 'flex', alignItems: 'center', gap: '.5rem' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--amber)', display: 'inline-block', animation: 'pulse 2s infinite' }} />
              Open loops
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '.45rem' }}>
              {dueChecks.length > 0 && (
                <button onClick={() => router.push('/tracker')} style={{ background: 'none', border: 'none', display: 'flex', alignItems: 'center', gap: '.65rem', cursor: 'pointer', textAlign: 'left', padding: '.3rem 0' }}>
                  <span style={{ fontSize: '.85rem', flexShrink: 0 }}>📅</span>
                  <div>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'var(--white)', fontWeight: 600 }}>{dueChecks.length} check-in{dueChecks.length > 1 ? 's' : ''} due</div>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--amber)' }}>Answer to unlock your timeline insight →</div>
                  </div>
                </button>
              )}
              {staleApps.length > 0 && (
                <button onClick={() => router.push('/tracker')} style={{ background: 'none', border: 'none', display: 'flex', alignItems: 'center', gap: '.65rem', cursor: 'pointer', textAlign: 'left', padding: '.3rem 0' }}>
                  <span style={{ fontSize: '.85rem', flexShrink: 0 }}>⏰</span>
                  <div>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'var(--white)', fontWeight: 600 }}>{staleApps.length} app{staleApps.length > 1 ? 's' : ''} past response window</div>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--amber)' }}>Ghost risk rising — update what happened →</div>
                  </div>
                </button>
              )}
            </div>
          </div>
        )}

        {/* Health Score */}
        {health && (
          <div style={{ marginBottom: '1.25rem', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, padding: '1rem 1.25rem' }}>
            <div style={{ fontFamily: 'var(--display)', fontSize: '.8rem', fontWeight: 700, color: 'var(--white)', marginBottom: '.5rem' }}>Job Search Health Score</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '.35rem', marginBottom: '.5rem' }}>
              <span style={{ fontFamily: 'var(--mono)', fontSize: '2rem', fontWeight: 600, color: health.score >= 75 ? 'var(--green)' : health.score >= 55 ? 'var(--amber)' : 'var(--red)' }}>{health.score}</span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: '.75rem', color: 'var(--muted)' }}>/100</span>
            </div>
            <div style={{ height: 4, background: 'var(--line2)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${health.score}%`, borderRadius: 2, background: health.score >= 75 ? 'var(--green)' : health.score >= 55 ? 'var(--amber)' : 'var(--red)', transition: 'width .6s ease' }} />
            </div>
          </div>
        )}

        {/* Career Benchmarks */}
        {benchmarks && (
          <div style={{ marginBottom: '1.25rem', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: '.85rem 1.1rem', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontFamily: 'var(--display)', fontSize: '.82rem', fontWeight: 700, color: 'var(--white)' }}>Career Benchmarks</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '.54rem', color: 'var(--muted)' }}>{benchmarks.n} app{benchmarks.n !== 1 ? 's' : ''} · vs industry avg</div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
              {benchmarks.metrics.map((m, i) => (
                <div key={m.lbl} style={{ padding: '.85rem 1rem', ...(i % 2 === 0 ? { borderRight: '1px solid var(--line)' } : {}), ...(i < 2 ? { borderBottom: '1px solid var(--line)' } : {}) }}>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--muted)', marginBottom: '.3rem' }}>{m.lbl}</div>
                  <div style={{ fontFamily: 'var(--display)', fontSize: '1.45rem', fontWeight: 800, color: m.col, lineHeight: 1 }}>{m.val}</div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: '.54rem', color: 'var(--dim)', marginTop: '.2rem' }}>Top {m.pct}% · {m.avg}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Badges */}
        {badges.length > 0 && (
          <div style={{ marginBottom: '1.25rem' }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', textTransform: 'uppercase', letterSpacing: '.09em', color: 'var(--dim)', marginBottom: '.65rem' }}>Earned badges</div>
            <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
              {badges.map(b => (
                <div key={b.id} style={{ background: 'var(--surface)', border: '1px solid var(--line2)', borderRadius: 8, padding: '.5rem .85rem', display: 'flex', alignItems: 'center', gap: '.4rem' }}>
                  <span style={{ fontSize: '1rem' }}>{b.icon}</span>
                  <div>
                    <div style={{ fontFamily: 'var(--display)', fontSize: '.72rem', fontWeight: 700, color: 'var(--white)', lineHeight: 1.2 }}>{b.label}</div>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', color: 'var(--muted)' }}>{b.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Stats row */}
        <div className="dstat-row" style={{ marginBottom: '1.25rem' }}>
          <div className="dstat ds-blue">
            <div className="dstat-l">Active</div>
            <div className="dstat-n">{active.length}</div>
          </div>
          <div className="dstat ds-indigo">
            <div className="dstat-l">Response rate</div>
            <div className="dstat-n" style={{ color: 'var(--blue)' }}>{responseRate}</div>
          </div>
          <div className="dstat ds-red">
            <div className="dstat-l">Ghosted</div>
            <div className="dstat-n" style={{ color: 'var(--red)' }}>{ghosted.length}</div>
          </div>
          <div className="dstat ds-green">
            <div className="dstat-l">Hired</div>
            <div className="dstat-n" style={{ color: 'var(--green)' }}>{hired.length}</div>
          </div>
        </div>

        {/* Recently checked companies */}
        {recentCos.length > 0 && (
          <div style={{ marginBottom: '1.5rem' }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--dim)', marginBottom: '.6rem' }}>
              Recently checked
            </div>
            <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
              {recentCos.map((co, i) => (
                <a key={i} href={`/company/${co.slug}`} style={{ fontFamily: 'var(--mono)', fontSize: '.65rem', background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 7, padding: '.3rem .75rem', color: 'var(--sub)', textDecoration: 'none', transition: 'border-color .15s' }}>
                  {co.name}
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Active applications */}
        <div style={{ marginBottom: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '.75rem' }}>
            <div style={{ fontFamily: 'var(--display)', fontSize: '.9rem', fontWeight: 700, color: 'var(--white)', letterSpacing: '-.02em' }}>Active applications</div>
            <Link href="/tracker" className="btn btn-ghost" style={{ fontSize: '.7rem', textDecoration: 'none' }}>View all →</Link>
          </div>

          {/* Pipeline insight */}
          {pipelineParts.length > 0 && (
            <div style={{ background: 'var(--raised)', border: '1px solid var(--line2)', borderRadius: 9, padding: '.65rem .95rem', fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--dim)', display: 'flex', flexWrap: 'wrap', gap: '.55rem', alignItems: 'center', marginBottom: '.85rem' }}>
              <span style={{ color: 'var(--muted)', fontSize: '.54rem', textTransform: 'uppercase', letterSpacing: '.07em' }}>Your pipeline</span>
              {pipelineParts.map((p, i) => (
                <span key={i} style={{ display: 'flex', alignItems: 'center', gap: '.55rem' }}>
                  {i > 0 && <span style={{ color: 'var(--line2)' }}>·</span>}
                  {p.onClick
                    ? <button onClick={p.onClick} style={{ background: 'none', border: 'none', padding: 0, fontFamily: 'inherit', fontSize: 'inherit', color: p.color || 'inherit', cursor: 'pointer' }}>{p.text}</button>
                    : <span style={{ color: p.color || 'inherit' }}>{p.text}</span>
                  }
                </span>
              ))}
            </div>
          )}

          {/* Company ghost rate intel */}
          {active.length > 0 && Object.keys(coScores).length > 0 && (
            <div style={{ marginBottom: '1.25rem' }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '.5rem', textTransform: 'uppercase', letterSpacing: '.14em', color: 'var(--muted)', marginBottom: '.5rem' }}>Company intel · your active applications</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '.35rem' }}>
                {active.slice(0, 8).map(app => {
                  const sc = coScores[app.company.toLowerCase()]
                  if (!sc) return null
                  const ghostPct = Math.round(sc.ghost_rate * 100)
                  const col = sc.ghost_rate > 0.55 ? 'var(--red)' : sc.ghost_rate > 0.35 ? 'var(--amber)' : 'var(--green)'
                  return (
                    <div key={app.id} style={{ display: 'flex', alignItems: 'center', gap: '.5rem', justifyContent: 'space-between' }}>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--sub)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{app.company}</span>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: col, flexShrink: 0 }}>
                        {ghostPct}% ghost · {sc.overall_score}/100
                      </span>
                    </div>
                  )
                }).filter(Boolean)}
              </div>
            </div>
          )}

          {active.length === 0 ? (
            <div style={{ padding: '1.5rem', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10, textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '.7rem', color: 'var(--muted)' }}>
              No active applications yet
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
              {active.slice(0, 4).map(app => {
                const days = Math.floor((Date.now() - app.appliedAt) / 86400000)
                return (
                  <div key={app.id} style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10, padding: '.75rem 1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
                    <div>
                      <div style={{ fontFamily: 'var(--display)', fontSize: '.85rem', fontWeight: 700, color: 'var(--white)' }}>{app.company}</div>
                      <div style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--muted)', marginTop: '.1rem' }}>{app.role} · Day {days}</div>
                    </div>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', background: 'var(--raised)', border: '1px solid var(--line)', borderRadius: 6, padding: '.2rem .5rem', color: 'var(--sub)', flexShrink: 0 }}>{app.stage}</span>
                  </div>
                )
              })}
            </div>
          )}

          <Link href="/jobs" className="btn btn-green" style={{ width: '100%', justifyContent: 'center', fontSize: '.82rem', marginTop: '.85rem', display: 'flex', textDecoration: 'none' }}>
            Find more jobs →
          </Link>
        </div>

        {/* Alerts */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden', marginBottom: '1.25rem' }}>
          <div style={{ padding: '.85rem 1.1rem', borderBottom: '1px solid var(--line)', fontFamily: 'var(--display)', fontSize: '.82rem', fontWeight: 700, color: 'var(--white)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>Alerts</span>
            {alertCount > 0 && (
              <span style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', background: 'var(--rdim)', color: 'var(--red)', border: '1px solid #ff3b5c28', borderRadius: 100, padding: '.1rem .45rem' }}>{alertCount}</span>
            )}
          </div>

          {alertCount === 0 ? (
            <div style={{ padding: '.85rem 1.1rem', fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'var(--muted)', textAlign: 'center' }}>All clear ✓</div>
          ) : (
            <div>
              {/* Ghost-surge alerts first (parity: prepended in old) */}
              {surges.map(co => (
                <button
                  key={`surge-${co}`}
                  onClick={() => router.push(`/company/${companySlug(co)}`)}
                  style={{ width: '100%', textAlign: 'left', padding: '.65rem 1.1rem', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'flex-start', gap: '.55rem', cursor: 'pointer', background: 'rgba(239,68,68,.04)', border: 'none', borderTop: 'none', borderLeft: 'none', borderRight: 'none' }}
                >
                  <span style={{ fontSize: '.75rem', flexShrink: 0 }}>👻</span>
                  <span>
                    <span style={{ display: 'block', fontSize: '.75rem', fontWeight: 500, color: 'var(--red)', marginBottom: '.1rem' }}>{co} — ghost surge</span>
                    <span style={{ display: 'block', fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--muted)' }}>3+ ghost reports this week · check before you follow up</span>
                  </span>
                </button>
              ))}
              {/* Stale application alerts (top 3) */}
              {staleApps.slice(0, 3).map(a => {
                const days = Math.floor((Date.now() - a.appliedAt) / 86400000)
                return (
                  <button
                    key={`stale-${a.id}`}
                    onClick={() => router.push('/tracker')}
                    style={{ width: '100%', textAlign: 'left', padding: '.65rem 1.1rem', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'flex-start', gap: '.55rem', cursor: 'pointer', background: 'none', border: 'none' }}
                  >
                    <span style={{ color: 'var(--amber)', fontSize: '.75rem', flexShrink: 0 }}>⚠</span>
                    <span>
                      <span style={{ display: 'block', fontSize: '.75rem', fontWeight: 500, color: 'var(--text)', marginBottom: '.1rem' }}>{a.company} — {a.role}</span>
                      <span style={{ display: 'block', fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--muted)' }}>{days}d no update · past expected window</span>
                    </span>
                  </button>
                )
              })}
            </div>
          )}

          <div style={{ padding: '.65rem 1.1rem', borderTop: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.75rem', background: 'rgba(239,68,68,.03)' }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--muted)', lineHeight: 1.55 }}>👻 Get <strong style={{ color: 'var(--text)' }}>ghost surge email alerts</strong> before you apply</div>
            <button style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--white)', background: 'rgba(239,68,68,.18)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 100, padding: '.22rem .65rem', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>Pro →</button>
          </div>
        </div>

        {/* Quick actions */}
        <div style={{ marginBottom: '1.25rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.5rem' }}>
            <Link href="/resume" className="btn btn-ghost qact" style={{ textDecoration: 'none' }}><span className="qact-ic">🧠</span>Resume AI</Link>
            <Link href="/tracker" className="btn btn-ghost qact" style={{ textDecoration: 'none' }}><span className="qact-ic">📋</span>All applications</Link>
            <Link href="/demand" className="btn btn-ghost qact" style={{ textDecoration: 'none' }}><span className="qact-ic">🗺️</span>Demand map</Link>
            <Link href="/report" className="btn btn-ghost qact" style={{ textDecoration: 'none' }}><span className="qact-ic">📢</span>Report outcome</Link>
          </div>
        </div>

      </div>
    </div>
  )
}

'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/lib/auth'
import { AppStore } from '@/lib/stores/AppStore'
import { EventStore } from '@/lib/stores/EventStore'
import { BadgeStore } from '@/lib/stores/BadgeStore'
import type { Application } from '@/lib/types'

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

  useEffect(() => {
    if (!isLoggedIn) { router.replace('/login'); return }
    if (isLoggedIn && !isSeeker) { router.replace('/'); return }
  }, [isLoggedIn, isSeeker, router])

  useEffect(() => {
    if (!isLoggedIn) return
    AppStore.load(true).then(data => { setApps(data); setLoading(false) })
  }, [isLoggedIn])

  if (!isLoggedIn || !isSeeker) return null
  if (loading) return <div className="page"><div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}><div className="spinner" /></div></div>

  const active = apps.filter(a => a.status === 'active')
  const ghosted = apps.filter(a => a.status === 'ghosted')
  const hired = apps.filter(a => a.status === 'hired')
  const allEvents = EventStore.get()
  const badges = BadgeStore.compute(apps, allEvents)
  const health = calcJobSearchHealth(apps)

  const hour = new Date().getHours()
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const rawName = profile?.name || user?.user_metadata?.name || ''
  const name = rawName ? rawName.charAt(0).toUpperCase() + rawName.slice(1).split(/[^a-zA-Z]/)[0] : 'there'

  const responseRate = apps.length ? Math.round((apps.filter(a => a.status !== 'active' && a.status !== 'ghosted').length / apps.length) * 100) + '%' : '—'

  return (
    <div
      className="page"
      style={{ background: 'radial-gradient(ellipse at 18% 0%,rgba(29,78,216,0.1) 0%,transparent 48%),radial-gradient(ellipse at 82% 8%,rgba(124,58,237,0.07) 0%,transparent 42%)' }}
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
            </p>
          </div>
        </div>

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

        {/* Badges */}
        {badges.length > 0 && (
          <div style={{ display: 'none', marginBottom: '1.25rem' }}>
            <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
              {badges.map(b => (
                <div key={b.id} style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, padding: '.4rem .75rem', display: 'flex', alignItems: 'center', gap: '.35rem', fontSize: '.75rem', color: 'var(--sub)' }}>
                  <span>{b.icon}</span> {b.label}
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

        {/* Active applications */}
        <div style={{ marginBottom: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '.75rem' }}>
            <div style={{ fontFamily: 'var(--display)', fontSize: '.9rem', fontWeight: 700, color: 'var(--white)', letterSpacing: '-.02em' }}>Active applications</div>
            <Link href="/tracker" className="btn btn-ghost" style={{ fontSize: '.7rem', textDecoration: 'none' }}>View all →</Link>
          </div>

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
            Alerts
          </div>
          <div style={{ padding: '.85rem 1.1rem', fontFamily: 'var(--mono)', fontSize: '.65rem', color: 'var(--muted)', textAlign: 'center' }}>All clear ✓</div>
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

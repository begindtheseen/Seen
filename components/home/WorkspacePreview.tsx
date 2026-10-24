'use client'

// The landing page's "this is your workspace" window. Every tab mirrors a screen Seen actually
// ships, so a visitor sees what they get, not a concept:
//   Dashboard   → app/dashboard (Command Center: health, pills, next best move, pipeline)
//   Tracker     → app/tracker (stage pipe, ghost tags, the inline day-N check-in)
//   Company     → app/company/[slug] — REAL, live-refreshed data (HomeHero passes the Amazon score)
//   Résumé AI   → app/resume (SeenFit score before/after tailoring)
// Dashboard / Tracker / Résumé use EXAMPLE data and say so on screen. No visitor counts or
// community-size claims: Seen does not have them (brain: seen:growth state_2026_10_18).
//
// Motion: the window rises in on scroll; tabs auto-advance every CYCLE_MS while the window is in
// view and the visitor hasn't touched it (a hairline under the active tab fills to show the
// timer); numbers roll with the shared Odometer. prefers-reduced-motion: no auto-advance.

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { gradeLetter } from '@/lib/companyDisplay'
import Link from 'next/link'
import Odometer from '@/components/motion/Odometer'
import styles from './WorkspacePreview.module.css'

export interface ProofScore {
  name: string
  industry: string
  overall_score: number
  ghost_rate: number
  response_rate: number
  avg_wait_days: number
  waste: number
  /** FUSED total (first-party + web-research claim) — never rendered as "reports". */
  report_count: number
  /** Real applicant-report rows — the only count the card may call "applicant reports". */
  first_party_report_count: number
}

type Tab = 'dashboard' | 'tracker' | 'company' | 'resume'
const TABS: Array<{ id: Tab; label: string; icon: string; title: string; sub: string }> = [
  { id: 'dashboard', label: 'Dashboard', icon: '◫', title: 'Hey, Alex.', sub: '6 open applications · 2 check-ins due' },
  { id: 'tracker', label: 'Tracker', icon: '▤', title: 'My applications', sub: 'Every application, with the next thing to do on each one.' },
  { id: 'company', label: 'Company intel', icon: '◈', title: 'Check before you apply', sub: 'Real data, live from Seen.' },
  { id: 'resume', label: 'Résumé AI', icon: '✧', title: 'SeenFit', sub: 'Your résumé, scored against one exact role.' },
]
const CYCLE_MS = 6500

// The one grade scale the company page and grade card use (lib/companyDisplay).
const letterGrade = gradeLetter

export default function WorkspacePreview({ proof, live = false }: { proof: ProofScore; live?: boolean }) {
  const [tab, setTab] = useState<Tab>('dashboard')
  const [inView, setInView] = useState(false)
  const [seen, setSeen] = useState(false) // has ever been in view — gates the first number roll
  const [touched, setTouched] = useState(false)
  const [hover, setHover] = useState(false)
  const [reduced, setReduced] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setReduced(!!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
    const el = ref.current
    if (!el || !('IntersectionObserver' in window)) { setInView(true); setSeen(true); return }
    const io = new IntersectionObserver(([e]) => {
      setInView(e.isIntersecting)
      if (e.isIntersecting) setSeen(true)
    }, { threshold: 0.3 })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  // Auto-advance while visible, untouched and not hovered.
  const cycling = inView && !touched && !hover && !reduced
  useEffect(() => {
    if (!cycling) return
    const t = setTimeout(() => {
      setTab(cur => TABS[(TABS.findIndex(x => x.id === cur) + 1) % TABS.length].id)
    }, CYCLE_MS)
    return () => clearTimeout(t)
  }, [cycling, tab])

  const pick = (id: Tab) => { setTouched(true); setTab(id) }
  const meta = TABS.find(t => t.id === tab)!

  return (
    <section className={styles.section} aria-label="What your Seen workspace looks like">
      <div className={`${styles.window}${seen ? ' ' + styles.windowIn : ''}`} ref={ref}
        onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
        <div className={styles.chrome} aria-hidden="true">
          <i /><i /><i />
          <span className={styles.url}>seenjobs.io/{tab === 'company' ? 'company/amazon' : tab === 'resume' ? 'resume' : tab}</span>
        </div>

        <div className={styles.app}>
          {/* A div, not <nav>: app/globals.css styles every nav element as the fixed site bar. */}
          <div className={styles.side}>
            <div className={styles.brand}><span className={styles.brandDot} />Your workspace</div>
            <div role="tablist" aria-label="Workspace sections" className={styles.tabs}>
              {TABS.map(t => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.id}
                  className={`${styles.tab}${tab === t.id ? ' ' + styles.tabOn : ''}`}
                  onClick={() => pick(t.id)}
                >
                  <span className={styles.tabIco} aria-hidden="true">{t.icon}</span>
                  {t.label}
                  {tab === t.id && cycling && (
                    <span className={styles.timer} style={{ '--cycle': `${CYCLE_MS}ms` } as CSSProperties} aria-hidden="true" />
                  )}
                </button>
              ))}
            </div>
            <div className={styles.pro}>
              <b>★ Seen Pro</b>
              Unlimited AI credits and ghost alerts.
            </div>
          </div>

          <div className={styles.main} role="tabpanel">
            <div className={styles.top}>
              <div style={{ minWidth: 0 }}>
                <h2 className={styles.title} key={`t-${tab}`}>{meta.title}</h2>
                <div className={styles.sub}>{meta.sub}</div>
              </div>
              {tab === 'company'
                ? (live
                    ? <span className={`${styles.tag} ${styles.tagLive}`}><span className={styles.liveDot} />Live data</span>
                    : <span className={styles.tag} title="Last stored snapshot — the live figures load in a moment">Real data · snapshot</span>)
                : <span className={styles.tag}>Example data</span>}
            </div>

            <div className={styles.body} key={tab}>
              {tab === 'dashboard' && <DashboardTab start={seen} onTracker={() => pick('tracker')} />}
              {tab === 'tracker' && <TrackerTab />}
              {tab === 'company' && <CompanyTab proof={proof} />}
              {tab === 'resume' && <ResumeTab />}
            </div>
          </div>
        </div>
      </div>
      <p className={styles.foot}>
        Dashboard, tracker and résumé tabs show example data. Yours fills in as you track applications.
      </p>
    </section>
  )
}

/* ── Dashboard (app/dashboard Command Center) ─────────────────────────────────────────── */
function DashboardTab({ start, onTracker }: { start: boolean; onTracker: () => void }) {
  return (
    <>
      <div className={styles.stats}>
        <Stat label="Open applications" value={6} note="↑ 3 this week" start={start} />
        <Stat label="Response rate" value={41} suffix="%" note="↑ 12 pts since you started" start={start} />
        <Stat label="Interviews" value={3} note="↑ 2 this month" start={start} />
        <Stat label="Job search health" value={78} suffix="/100" note="Above average" start={start} />
      </div>
      <div className={styles.split}>
        <div className={styles.panel}>
          <div className={styles.panelHd}>Active pipeline</div>
          <Row logo="N" co="Northwind Health" role="Patient Care Tech · Day 4" ghost={{ pct: 12, tone: 'ok' }} pill={{ t: 'Interview', tone: 'ok' }} />
          <Row logo="A" co="Atlas Robotics" role="Systems Technician · Day 9" ghost={{ pct: 31, tone: 'warn' }} pill={{ t: 'Phone screen', tone: 'info' }} />
          <Row logo="H" co="Harbor Logistics" role="Operations Lead · Day 12" ghost={{ pct: 58, tone: 'bad' }} pill={{ t: 'Check-in due', tone: 'warn' }} />
        </div>
        <div className={styles.panel}>
          <div className={styles.panelHd}>Next best move</div>
          <Move icon="⏰" t="Follow up with Atlas Robotics" s="Past its typical response window" />
          <Move icon="📮" t="Report 2 outcomes" s="Unlocks your real response & ghost rates" />
          <Move icon="🔎" t="Find more roles like Northwind" s="Keep your pipeline full" />
        </div>
      </div>
      <div className={styles.insight}>
        <div>
          <b>✦ Northwind usually replies in about 6 days.</b>
          <p>You&apos;re on day 4. Hold the follow-up; Harbor Logistics is the one going quiet.</p>
        </div>
        <button type="button" onClick={onTracker}>Open tracker →</button>
      </div>
    </>
  )
}

/* ── Tracker (app/tracker: stage pipe + inline check-in) ─────────────────────────────── */
const STAGES = ['Applied', 'Viewed', 'Phone screen', 'Interview', 'Offer']
function TrackerTab() {
  const [answer, setAnswer] = useState<string | null>(null)
  return (
    <div className={styles.trackList}>
      <TrackCard logo="N" co="Northwind Health" role="Patient Care Tech" day={4} stage={3} />
      <div className={styles.trackCard}>
        <TrackHead logo="H" co="Harbor Logistics" role="Operations Lead" day={12} ghost={58} />
        <Pipe stage={0} />
        <div className={styles.check}>
          <div className={styles.checkTag}><span className={styles.checkDot} />Day 12 check-in</div>
          {answer ? (
            <div className={styles.checkDone}>✓ Logged “{answer}”. It adds to Harbor Logistics&apos; public record, so the next applicant knows.</div>
          ) : (
            <>
              <div className={styles.checkQ}>Did they respond to your application?</div>
              <div className={styles.checkOpts}>
                {['Got a response', 'Interview', 'Rejected', 'Ghosted'].map((a, i) => (
                  <button key={a} type="button" className={`${styles.opt}${i < 2 ? ' ' + styles.optHi : ''}`} onClick={() => setAnswer(a)}>{a}</button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      <TrackCard logo="A" co="Atlas Robotics" role="Systems Technician" day={9} stage={2} ghost={31} />
    </div>
  )
}
function TrackHead({ logo, co, role, day, ghost }: { logo: string; co: string; role: string; day: number; ghost?: number }) {
  return (
    <div className={styles.trackHead}>
      <span className={styles.logo}>{logo}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className={styles.rowCo}>{co}</div>
        <div className={styles.rowRole}>{role}</div>
      </div>
      <div className={styles.trackMeta}>
        {ghost != null && <span className={`${styles.ghost} ${ghost > 50 ? styles.bad : styles.warn}`}>{ghost}% ghost</span>}
        <span className={styles.day}>Day {day}</span>
      </div>
    </div>
  )
}
function TrackCard({ logo, co, role, day, stage, ghost }: { logo: string; co: string; role: string; day: number; stage: number; ghost?: number }) {
  return (
    <div className={styles.trackCard}>
      <TrackHead logo={logo} co={co} role={role} day={day} ghost={ghost} />
      <Pipe stage={stage} />
    </div>
  )
}
function Pipe({ stage }: { stage: number }) {
  return (
    <div className={styles.pipe}>
      {STAGES.map((s, i) => (
        <span key={s} className={`${styles.step}${i < stage ? ' ' + styles.stepDone : ''}${i === stage ? ' ' + styles.stepCur : ''}`}>{s}</span>
      ))}
    </div>
  )
}

/* ── Company intel: REAL data (same seed + live refresh the old proof card used) ─────── */
function CompanyTab({ proof }: { proof: ProofScore }) {
  const ghostPct = Math.round(proof.ghost_rate * 100)
  const respPct = Math.round(proof.response_rate * 100)
  const grade = letterGrade(proof.overall_score)
  const risk = proof.overall_score >= 70 ? 'safe' : proof.overall_score >= 40 ? 'warn' : 'danger'
  const tone = (good: boolean, mid: boolean) => good ? 'var(--green)' : mid ? 'var(--amber)' : 'var(--red)'
  const [ring, setRing] = useState(0)
  useEffect(() => { const t = requestAnimationFrame(() => setRing(ghostPct)); return () => cancelAnimationFrame(t) }, [ghostPct])
  return (
    <div className={styles.company}>
      <div className={styles.coHead}>
        <span className={styles.logoLg}>{proof.name[0]}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className={styles.coName}>{proof.name}</div>
          <div className={styles.rowRole}>
            {proof.first_party_report_count > 0
              ? `${proof.first_party_report_count.toLocaleString()} applicant report${proof.first_party_report_count === 1 ? '' : 's'}`
              : 'Estimated from public web data'}
          </div>
        </div>
        <span className={`${styles.grade} ${styles[risk]}`}>{grade}</span>
      </div>
      <div className={styles.coBody}>
        <div className={styles.gauge} style={{ '--p': ring, '--c': tone(proof.ghost_rate <= 0.3, proof.ghost_rate <= 0.5) } as CSSProperties}>
          <div className={styles.gaugeIn}>
            <b><Odometer value={ghostPct} suffix="%" /></b>
            <small>ghosted</small>
          </div>
        </div>
        <div className={styles.coStats}>
          <div><span>Responds to applicants</span><b style={{ color: tone(proof.response_rate >= 0.5, proof.response_rate >= 0.3) }}><Odometer value={respPct} suffix="%" /></b></div>
          {/* 0 means no wait data yet (the company page shows "—" for the same case). */}
          <div><span>Average wait to hear back</span>{proof.avg_wait_days > 0
            ? <b style={{ color: tone(proof.avg_wait_days <= 21, proof.avg_wait_days <= 45) }}><Odometer value={proof.avg_wait_days} suffix={'\u00a0days'} /></b>
            : <b style={{ color: 'var(--dim)' }}>—</b>}</div>
          <div><span>Wasted-effort risk</span><b style={{ color: tone(proof.waste <= 30, proof.waste <= 60) }}><Odometer value={proof.waste} suffix="%" /></b></div>
        </div>
      </div>
      <div className={styles.coFoot}>
        <span>Seen grade {proof.overall_score}/100 · from {proof.first_party_report_count} applicant reports</span>
        <Link href="/company/amazon">Full report →</Link>
      </div>
    </div>
  )
}

/* ── Résumé AI (app/resume SeenFit) ──────────────────────────────────────────────────── */
function ResumeTab() {
  return (
    <div className={styles.resume}>
      <div className={styles.fitRow}>
        <div className={styles.fit}>
          <small>Before</small>
          <b className={styles.fitBefore}><Odometer value={64} /></b>
        </div>
        <span className={styles.fitArrow} aria-hidden="true">→</span>
        <div className={styles.fit}>
          <small>After tailoring</small>
          <b className={styles.fitAfter}><Odometer value={88} delay={350} /></b>
        </div>
        <div className={styles.fitFor}>
          SeenFit score for<br /><b>Patient Care Tech · Northwind Health</b>
        </div>
      </div>
      <div className={styles.panel}>
        <div className={styles.panelHd}>Keywords this role screens for</div>
        <div className={styles.kws}>
          {['Patient intake', 'Vitals', 'EHR (Epic)', 'BLS certified'].map((k, i) => (
            <span key={k} className={styles.kwOk} style={{ animationDelay: `${0.15 + i * 0.07}s` }}>✓ {k}</span>
          ))}
          {['Phlebotomy', 'HIPAA'].map((k, i) => (
            <span key={k} className={styles.kwAdd} style={{ animationDelay: `${0.45 + i * 0.07}s` }}>+ {k}</span>
          ))}
        </div>
      </div>
      <div className={styles.bullets}>
        <div className={styles.bulletOld}><small>Your line</small><s>Helped patients and assisted nurses with daily tasks.</s></div>
        <div className={styles.bulletNew}><small>Tailored, in your voice</small>Roomed 25+ patients a shift: intake, vitals and Epic charting, so nurses saw patients on time.</div>
      </div>
    </div>
  )
}

/* ── small pieces ───────────────────────────────────────────────────────────────────── */
function Stat({ label, value, suffix, note, start }: { label: string; value: number; suffix?: string; note: string; start: boolean }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statK}>{label}</span>
      <b className={styles.statV}><Odometer value={value} suffix={suffix} start={start} /></b>
      <span className={styles.statN}>{note}</span>
    </div>
  )
}
function Row({ logo, co, role, ghost, pill }: { logo: string; co: string; role: string; ghost: { pct: number; tone: 'ok' | 'warn' | 'bad' }; pill: { t: string; tone: 'ok' | 'info' | 'warn' } }) {
  return (
    <div className={styles.row}>
      <span className={styles.logo}>{logo}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className={styles.rowCo}>{co}</div>
        <div className={styles.rowRole}>{role}</div>
      </div>
      <span className={`${styles.ghost} ${styles[ghost.tone]}`}>{ghost.pct}% ghost</span>
      <span className={`${styles.pill} ${styles['pill_' + pill.tone]}`}>{pill.t}</span>
    </div>
  )
}
function Move({ icon, t, s }: { icon: string; t: string; s: string }) {
  return (
    <div className={styles.move}>
      <span className={styles.moveIco}>{icon}</span>
      <div style={{ minWidth: 0 }}>
        <div className={styles.rowCo}>{t}</div>
        <div className={styles.rowRole}>{s}</div>
      </div>
    </div>
  )
}

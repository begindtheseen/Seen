'use client'

// EmployerHub — the unified, tabbed employer surface. One header + one reputation hero shared across
// four tabs (Overview · Listings · Analytics · Updates), replacing the four disconnected long-scroll
// pages (dashboard / analytics / notifications / login-scoped listings). An employer navigates by
// switching tabs, never jumping pages.
//
// SCOPING (copied verbatim from the old dashboard — the no-data-bleed boundary):
//   • A logged-in approved employer (ready && claimsReady && isEmployer && employerCompany && !godview)
//     is pinned to their claimed company; the ?company= param is ignored for them.
//   • Everyone else (a visitor, or an admin in ?godview=1) honors the ?company= param via a lookup
//     input + Refresh. God-view shows the purple "Admin god-view" banner.
//
// The reputation hero + Overview read PUBLIC aggregate data by company name (score / reports-feed /
// company_jobs) exactly like the old dashboard. The Listings / Analytics / Updates tabs are
// login-scoped: they self-fetch via the Bearer token and resolve the company from the caller's
// approved claim, so they render their own graceful sign-in / pending states for anyone unscoped.

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/lib/auth'
import { useCountUp } from '@/lib/hooks/useCountUp'
import { recentInteractions, summarizeInteractions } from '@/lib/server/employerDashboard'
import { EmployerListingsManager } from '@/components/employer/EmployerListingsManager'
import { EmployerAnalyticsView } from '@/components/employer/EmployerAnalyticsView'
import { EmployerLiveNotifications } from '@/components/employer/EmployerLiveNotifications'
import IndustryBenchmark, { type Benchmark } from '@/components/IndustryBenchmark'
import EmployerActivationChecklist from '@/components/employer/EmployerActivationChecklist'
import { EmployerReplyManager } from '@/components/employer/EmployerReplyManager'
import { EmployerPerkBanner } from '@/components/employer/EmployerPerkBanner'

type Score = {
  overall_score: number | null
  ghost_rate: number | null
  response_rate: number | null
  avg_wait_days: number | null
  report_count: number
} | null

type RawPosting = { title?: string }
type RawReport = {
  role?: string | null; outcome?: string | null; created_at?: string | null; experience_level?: string | null
}
type InteractionView = {
  role: string; rawOutcome: string; bucket: string; label: string
  tone: string; experienceLevel: string; createdAt: string | null
}
type Summary = { total: number; counts: Record<string, number>; ghostRate: number | null; responseRate: number | null }
type ListingsSummary = { total: number; active: number; employerPosted: number; applications: number; openDisputes: number }

type TabKey = 'overview' | 'listings' | 'analytics' | 'updates'
const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'listings', label: 'Listings' },
  { key: 'analytics', label: 'Analytics' },
  { key: 'updates', label: 'Updates' },
]
const isTab = (v: string | null): v is TabKey => v === 'overview' || v === 'listings' || v === 'analytics' || v === 'updates'

const wrap = { maxWidth: 960, margin: '0 auto', padding: '0 1.5rem', width: '100%', boxSizing: 'border-box' as const }

const gradeOf = (s: number) => (s >= 80 ? 'A' : s >= 65 ? 'B' : s >= 50 ? 'C' : s >= 35 ? 'D' : 'F')
const gradeColor = (s: number) => (s >= 65 ? 'var(--green)' : s >= 50 ? 'var(--amber)' : 'var(--red)')
const pct = (v: number | null | undefined) => (v == null ? null : Math.round(v * 100))
const toneColor = (tone: string) =>
  tone === 'bad' ? 'var(--red)' : tone === 'warn' ? 'var(--amber)' : tone === 'good' ? 'var(--green)' : 'var(--muted)'

function fmtDate(iso: string | null) {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  try { return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) } catch { return '' }
}

export function EmployerHub() {
  const router = useRouter()
  const params = useSearchParams()
  const { profile, isEmployer, ready, employerCompany, claimsReady } = useAuth()

  // ── Scoping (verbatim from the old dashboard) ──────────────────────────────
  const godview = params.get('godview') === '1'
  const scoped = ready && claimsReady && isEmployer && !!employerCompany && !godview

  const initial = (params.get('company') || '').trim()
  const [companyInput, setCompanyInput] = useState(initial)
  const [company, setCompany] = useState(initial)
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [err, setErr] = useState('')
  const [postings, setPostings] = useState<RawPosting[]>([])
  const [reports, setReports] = useState<RawReport[]>([])
  const [score, setScore] = useState<Score>(null)
  const [benchmark, setBenchmark] = useState<Benchmark | null>(null)

  // ── Tab state (from ?tab=, default 'overview'; shallow URL update, lazy mount) ──
  const initialTab: TabKey = isTab(params.get('tab')) ? (params.get('tab') as TabKey) : 'overview'
  const [tab, setTab] = useState<TabKey>(initialTab)
  const [opened, setOpened] = useState<Set<TabKey>>(() => new Set<TabKey>([initialTab]))

  const selectTab = useCallback((next: TabKey) => {
    setTab(next)
    setOpened(prev => (prev.has(next) ? prev : new Set(prev).add(next)))
    // Shallow URL update — no navigation/reload, preserves the other query params.
    try {
      const usp = new URLSearchParams(window.location.search)
      usp.set('tab', next)
      window.history.replaceState(null, '', `${window.location.pathname}?${usp.toString()}`)
    } catch { /* history unavailable — the in-memory tab still switches */ }
  }, [])

  // ── Sliding tab indicator — measure the active button and slide a gradient pill
  //    behind it. Recomputes on tab change, on data load, and on resize. ──────────
  const tablistRef = useRef<HTMLDivElement | null>(null)
  const tabRefs = useRef<Record<TabKey, HTMLButtonElement | null>>({ overview: null, listings: null, analytics: null, updates: null })
  const [ind, setInd] = useState<{ left: number; top: number; width: number; height: number } | null>(null)

  const measureInd = useCallback(() => {
    const btn = tabRefs.current[tab]
    if (!btn) return
    setInd({ left: btn.offsetLeft, top: btn.offsetTop, width: btn.offsetWidth, height: btn.offsetHeight })
  }, [tab])

  // Measure after the tablist mounts (data loaded) and whenever the active tab changes.
  useEffect(() => { measureInd() }, [measureInd, loaded])

  // Re-measure on layout changes (button reflow / viewport resize).
  useEffect(() => {
    const el = tablistRef.current
    if (!el) return
    if (typeof ResizeObserver === 'undefined') {
      const onResize = () => measureInd()
      window.addEventListener('resize', onResize)
      return () => window.removeEventListener('resize', onResize)
    }
    const ro = new ResizeObserver(() => measureInd())
    ro.observe(el)
    window.addEventListener('resize', measureInd)
    return () => { ro.disconnect(); window.removeEventListener('resize', measureInd) }
  }, [measureInd, loaded])

  // ── Panel crossfade — replay `.emp-panel-in` on the visible panel each time the
  //    tab changes, without remounting the self-fetching tab components (no refetch).
  const panelHostRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const host = panelHostRef.current
    if (!host) return
    const active = host.querySelector<HTMLElement>('[data-active-panel="1"]')
    if (!active) return
    active.classList.remove('emp-panel-in')
    void active.offsetWidth // force reflow so the animation restarts
    active.classList.add('emp-panel-in')
  }, [tab, loaded])

  const load = useCallback(async (name: string) => {
    const q = name.trim()
    if (!q) return
    setLoading(true); setErr(''); setLoaded(false)
    try {
      const [jobsRes, scoreRes, feedRes, benchRes] = await Promise.all([
        fetch('/api/jobs', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'company_jobs', company: q }),
        }).then(r => (r.ok ? r.json() : { jobs: [] })).catch(() => ({ jobs: [] })),
        fetch('/api/reports', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'company_score', name: q }),
        }).then(r => (r.ok ? r.json() : { score: null })).catch(() => ({ score: null })),
        fetch(`/employers/dashboard/reports-feed?company=${encodeURIComponent(q)}`)
          .then(r => (r.ok ? r.json() : { reports: [] })).catch(() => ({ reports: [] })),
        fetch('/api/reports', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'industry_benchmark', name: q }),
        }).then(r => (r.ok ? r.json() : { benchmark: null })).catch(() => ({ benchmark: null })),
      ])
      setPostings(Array.isArray(jobsRes?.jobs) ? jobsRes.jobs : [])
      setScore((scoreRes?.score as Score) || null)
      setReports(Array.isArray(feedRes?.reports) ? feedRes.reports : [])
      setBenchmark((benchRes?.benchmark as Benchmark) || null)
      setLoaded(true)
    } catch {
      setErr('Could not load this company’s dashboard — please try again.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { if (company) load(company) }, [company, load])

  // A logged-in approved employer is pinned to their claimed company (overrides ?company=).
  useEffect(() => {
    if (scoped && employerCompany && employerCompany !== company) {
      setCompany(employerCompany)
      setCompanyInput(employerCompany)
    }
  }, [scoped, employerCompany, company])

  function lookup() {
    const q = companyInput.trim()
    if (!q) return
    setCompany(q)
    const usp = new URLSearchParams(); usp.set('company', q)
    if (tab !== 'overview') usp.set('tab', tab)
    router.replace(`/employers/dashboard?${usp.toString()}`)
  }

  // ── Derived hero + overview numbers (same helpers as the old dashboard) ──────
  const recent = recentInteractions(reports, 5) as InteractionView[]
  const summary = summarizeInteractions(reports) as Summary
  const totalReports = score?.report_count ?? summary.total
  const overall = score?.overall_score ?? null
  const ghost = pct(score?.ghost_rate)
  const reply = pct(score?.response_rate)
  const hasRep = overall != null && (score?.report_count ?? 0) > 0

  return (
    <div style={{ minHeight: '100vh', background: 'radial-gradient(ellipse at 15% -5%,rgba(29,78,216,0.12) 0%,transparent 55%),radial-gradient(ellipse at 100% 5%,rgba(124,58,237,0.09) 0%,transparent 45%)' }}>
      {/* Employer-first header (seeker Nav/Footer hide on /employers) */}
      <header style={{ borderBottom: '1px solid var(--line)', background: 'rgba(5,7,15,.7)', backdropFilter: 'blur(12px)', position: 'sticky', top: 0, zIndex: 50 }}>
        <div style={{ ...wrap, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '.9rem 1.5rem' }}>
          <Link href="/employers" style={{ display: 'flex', alignItems: 'center', gap: '.55rem', textDecoration: 'none' }}>
            <span style={{ width: 8, height: 8, borderRadius: 999, background: 'var(--blue)', boxShadow: '0 0 8px var(--blue)' }} />
            <span style={{ fontFamily: 'var(--display)', fontWeight: 800, fontSize: '1.05rem', color: 'var(--white)', letterSpacing: '-.02em' }}>Seen</span>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '.12em' }}>for employers</span>
          </Link>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <Link href="/employers" style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--sub)', textDecoration: 'none' }}>Reputation &amp; promote</Link>
            <Link href="/jobs" style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--dim)', textDecoration: 'none' }}>Looking for a job? →</Link>
          </div>
        </div>
      </header>

      <div style={{ ...wrap, padding: '2.4rem 1.5rem 4rem' }}>
        {/* Persistent header — kicker + scope badges + title */}
        <div className="emp-reveal" style={{ marginBottom: '1.4rem', animationDelay: '0ms' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', flexWrap: 'wrap', marginBottom: '.55rem' }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', textTransform: 'uppercase', letterSpacing: '.22em', color: 'var(--blue)' }}>Employer dashboard</span>
            {godview && (
              <span style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: '#a78bfa', background: 'rgba(124,58,237,.12)', border: '1px solid rgba(124,58,237,.35)', borderRadius: 7, padding: '.16rem .5rem' }}>
                Admin god-view
              </span>
            )}
            {ready && isEmployer && !godview && (
              <span style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--green)', background: 'rgba(16,185,129,.12)', border: '1px solid rgba(16,185,129,.35)', borderRadius: 7, padding: '.16rem .5rem' }}>
                {scoped ? 'Your company' : `Signed in as ${profile?.name || 'employer'}`}
              </span>
            )}
          </div>
          <h1 style={{ fontFamily: 'var(--display)', fontSize: 'clamp(1.5rem,4.5vw,2.1rem)', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.03em', lineHeight: 1.08, margin: '0 0 .4rem' }}>
            Your postings &amp; applicant activity
            {company ? <span style={{ color: 'var(--sub)' }}> — {company}</span> : <span style={{ color: 'var(--sub)' }}>, in one place</span>}
          </h1>
          <p style={{ color: 'var(--sub)', fontSize: '.82rem', lineHeight: 1.65, margin: 0, maxWidth: 620 }}>
            Every live listing, applicant outcome, analytic, and update for your company — one place, four tabs, the same signals candidates see about you before they apply.
          </p>
        </div>

        {/* Signed-in employer who hasn't finished claiming → the activation checklist is the primary
            surface (not a bare "type any company" box). It self-scopes off the auth claim state and
            disappears the moment an approved claim pins the company. */}
        {ready && claimsReady && isEmployer && !employerCompany && !godview && (
          <EmployerActivationChecklist />
        )}

        {/* Renewal nudge — a scoped employer whose Featured/Verified is lapsing gets a re-buy CTA. */}
        {scoped && <EmployerPerkBanner />}

        {/* Scope chip (logged-in) OR public lookup (visitor / god-view) */}
        {scoped ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', flexWrap: 'wrap', marginBottom: '1.6rem', padding: '.7rem .9rem', background: 'rgba(16,185,129,.05)', border: '1px solid rgba(16,185,129,.25)', borderRadius: 10 }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--green)', textTransform: 'uppercase', letterSpacing: '.1em' }}>Viewing your company</span>
            <span style={{ fontFamily: 'var(--display)', fontSize: '.9rem', fontWeight: 700, color: 'var(--white)', textTransform: 'capitalize' }}>{employerCompany}</span>
            <button className="emp-btn" onClick={() => company && load(company)} disabled={loading} style={{ marginLeft: 'auto', background: 'transparent', border: '1px solid var(--line2)', borderRadius: 8, padding: '.4rem .8rem', fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--sub)', cursor: loading ? 'default' : 'pointer' }}>
              {loading ? 'Loading…' : '↻ Refresh'}
            </button>
          </div>
        ) : (
          <>
            {godview && (
              <div style={{ marginBottom: '1rem', padding: '.6rem .9rem', background: 'rgba(124,58,237,.06)', border: '1px solid rgba(124,58,237,.28)', borderRadius: 10, fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--sub)', lineHeight: 1.6 }}>
                Admin god-view — this is the same public data any visitor sees, scoped to the company in the URL. Change the company below to view another.
              </div>
            )}
            <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap', marginBottom: '1.6rem' }}>
              <input
                value={companyInput}
                onChange={e => setCompanyInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') lookup() }}
                placeholder="Your company name"
                aria-label="Your company name"
                style={{ flex: 1, minWidth: 220, background: 'var(--raised)', border: '1px solid var(--line2)', borderRadius: 9, padding: '.7rem .9rem', fontFamily: 'var(--mono)', fontSize: '.75rem', color: 'var(--white)', outline: 'none' }}
              />
              <button onClick={lookup} disabled={loading || !companyInput.trim()} style={{ background: 'linear-gradient(135deg,#1d4ed8,#7c3aed)', border: 'none', borderRadius: 9, padding: '.7rem 1.4rem', fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.8rem', color: '#fff', cursor: loading ? 'default' : 'pointer', opacity: loading || !companyInput.trim() ? .6 : 1 }}>
                {loading ? 'Loading…' : company ? 'Refresh →' : 'View dashboard →'}
              </button>
            </div>
          </>
        )}
        {err && <div style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--red)', marginBottom: '1.2rem' }}>{err}</div>}

        {/* Entry state — no company chosen yet */}
        {!company && !loading && (
          <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 16, padding: '2.2rem', textAlign: 'center' }}>
            <div style={{ fontSize: '1.8rem', marginBottom: '.6rem' }}>🏢</div>
            <div style={{ fontFamily: 'var(--display)', fontSize: '1.05rem', fontWeight: 800, color: 'var(--white)', marginBottom: '.4rem' }}>Enter your company to open your dashboard</div>
            <p style={{ color: 'var(--sub)', fontSize: '.8rem', lineHeight: 1.65, margin: '0 auto', maxWidth: 460 }}>
              We&apos;ll pull your live listings on Seen and every applicant outcome candidates have reported for you — no account required.
            </p>
          </div>
        )}

        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '30vh' }}>
            <div className="spinner" />
          </div>
        )}

        {company && loaded && !loading && (
          <>
            {/* ── Reputation hero (always visible above the tabs) ──────────────── */}
            <section className="emp-reveal" style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 16, padding: '1.6rem', marginBottom: '1.4rem', animationDelay: '70ms' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1.4rem', flexWrap: 'wrap' }}>
                <GradeRing score={hasRep ? overall! : null} />
                <div style={{ display: 'flex', gap: '1.6rem', flexWrap: 'wrap' }}>
                  <CountStat value={postings.length} label="live postings" color="var(--blue)" />
                  <CountStat value={totalReports} label="applicant reports" color="var(--white)" />
                  <CountStat value={ghost} suffix="%" label="ghost rate" color="var(--red)" />
                  <CountStat value={reply} suffix="%" label="response rate" color="var(--green)" />
                </div>
              </div>
              <p style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--muted)', lineHeight: 1.6, margin: '1.1rem 0 0' }}>
                {hasRep
                  ? 'Grade, ghost rate and response rate are your public Seen reputation — what candidates see before applying.'
                  : `No applicant outcomes reported for ${company} yet — a clean slate. Your live postings still show below.`}
              </p>
            </section>

            {/* Industry benchmark — the never-empty layer. Shows how this company compares to its
                sector on Seen even when it has zero first-party reports, so the hub is never a blank
                "clean slate" for a real employer looking themselves up. */}
            {benchmark && (
              <div className="emp-reveal" style={{ marginBottom: '1.4rem', animationDelay: '105ms' }}>
                <IndustryBenchmark benchmark={benchmark} variant="employer" />
              </div>
            )}

            {/* ── Tab bar (segmented control with sliding gradient pill) ────────── */}
            <div ref={tablistRef} role="tablist" aria-label="Employer hub sections" className="emp-reveal" style={{ position: 'relative', display: 'flex', flexWrap: 'wrap', gap: 4, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, padding: 4, marginBottom: '1.6rem', animationDelay: '140ms' }}>
              {ind && (
                <span
                  aria-hidden
                  className="emp-tab-ind"
                  style={{
                    position: 'absolute', left: 0, top: 0, width: ind.width, height: ind.height,
                    transform: `translate(${ind.left}px, ${ind.top}px)`,
                    background: 'linear-gradient(135deg,#1d4ed8,#7c3aed)', borderRadius: 9,
                    boxShadow: '0 0 20px rgba(124,58,237,.32)', pointerEvents: 'none', zIndex: 0,
                  }}
                />
              )}
              {TABS.map(t => {
                const active = tab === t.key
                return (
                  <button
                    key={t.key}
                    ref={el => { tabRefs.current[t.key] = el }}
                    role="tab"
                    aria-selected={active}
                    onClick={() => selectTab(t.key)}
                    style={{
                      position: 'relative', zIndex: 1,
                      flex: '1 1 auto', minWidth: 96, textAlign: 'center',
                      background: 'transparent',
                      border: 'none', borderRadius: 9, padding: '.55rem 1rem',
                      fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.78rem',
                      color: active ? '#fff' : 'var(--sub)', cursor: active ? 'default' : 'pointer',
                      transition: 'color .2s ease',
                    }}
                  >
                    {t.label}
                  </button>
                )
              })}
            </div>

            {/* ── Tab panels (lazy-mounted, kept alive once opened) ────────────── */}
            {/* panelHostRef scopes the crossfade effect; each wrapper is flagged
                data-active-panel so only the visible one replays `.emp-panel-in`. */}
            <div ref={panelHostRef}>
              {opened.has('overview') && (
                <div role="tabpanel" data-active-panel={tab === 'overview' ? '1' : '0'} style={{ display: tab === 'overview' ? 'block' : 'none' }}>
                  <OverviewTab company={company} recent={recent} canRespond={scoped} onManage={() => selectTab('listings')} />
                </div>
              )}
              {opened.has('listings') && (
                <div role="tabpanel" data-active-panel={tab === 'listings' ? '1' : '0'} style={{ display: tab === 'listings' ? 'block' : 'none' }}>
                  <EmployerListingsManager />
                </div>
              )}
              {opened.has('analytics') && (
                <div role="tabpanel" data-active-panel={tab === 'analytics' ? '1' : '0'} style={{ display: tab === 'analytics' ? 'block' : 'none' }}>
                  <EmployerAnalyticsView />
                </div>
              )}
              {opened.has('updates') && (
                <div role="tabpanel" data-active-panel={tab === 'updates' ? '1' : '0'} style={{ display: tab === 'updates' ? 'block' : 'none' }}>
                  <UpdatesTab />
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Employer-first footer */}
      <footer style={{ borderTop: '1px solid var(--line)', padding: '1.4rem 1.5rem' }}>
        <div style={{ ...wrap, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '.6rem' }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--dim)' }}>© 2026 Seen · for employers</span>
          <div style={{ display: 'flex', gap: '1.1rem' }}>
            <Link href="/employers" style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--dim)', textDecoration: 'none' }}>Reputation</Link>
            <Link href="/legal" style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--dim)', textDecoration: 'none' }}>Legal</Link>
            <a href="mailto:hello@seenjobs.io" style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--dim)', textDecoration: 'none' }}>Contact</a>
          </div>
        </div>
      </footer>
    </div>
  )
}

// ── Overview tab: short by design — recent interactions (top 5) + a compact listings summary ──
function OverviewTab({ company, recent, canRespond, onManage }: { company: string; recent: InteractionView[]; canRespond: boolean; onManage: () => void }) {
  return (
    <>
      {/* Respond surface — an approved employer can reply to the reports below (reviewed before public,
          never a score input). Non-scoped viewers (visitor / god-view) just see the read-only feed. */}
      {canRespond && <EmployerReplyManager company={company} />}

      <section style={{ marginBottom: '1.6rem' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '.5rem', marginBottom: '.7rem' }}>
          <h2 style={{ fontFamily: 'var(--display)', fontSize: '1.05rem', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.02em', margin: 0 }}>Recent applicant interactions</h2>
          <span style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--dim)' }}>candidate-reported</span>
        </div>
        {recent.length === 0 ? (
          <div className="emp-card" style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 14, padding: '1.6rem', textAlign: 'center' }}>
            <div style={{ fontFamily: 'var(--display)', fontSize: '.9rem', fontWeight: 700, color: 'var(--white)', marginBottom: '.3rem' }}>No applicant outcomes reported yet</div>
            <p style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--muted)', lineHeight: 1.6, margin: 0 }}>
              When candidates report what happened after applying to {company}, it shows up here.
            </p>
          </div>
        ) : (
          <div className="emp-card" style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 14, overflow: 'hidden' }}>
            {recent.map((r, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '.7rem', padding: '.7rem .95rem', borderBottom: i < recent.length - 1 ? '1px solid var(--line)' : 'none' }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: '.5rem', fontWeight: 700, color: toneColor(r.tone), background: 'var(--raised)', border: `1px solid ${toneColor(r.tone)}`, borderRadius: 6, padding: '.16rem .45rem', flexShrink: 0, whiteSpace: 'nowrap' }}>{r.label}</span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontFamily: 'var(--display)', fontSize: '.78rem', fontWeight: 600, color: 'var(--white)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.role}</div>
                  {r.experienceLevel && <div style={{ fontFamily: 'var(--mono)', fontSize: '.5rem', color: 'var(--muted)' }}>{r.experienceLevel}</div>}
                </div>
                {r.createdAt && <span style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', color: 'var(--dim)', flexShrink: 0 }}>{fmtDate(r.createdAt)}</span>}
              </div>
            ))}
          </div>
        )}
      </section>

      <ListingsSummaryCard onManage={onManage} />

      {/* Honest disclosure — what these numbers are and aren't */}
      <div className="emp-card" style={{ background: 'var(--surface)', border: '1px solid var(--line2)', borderRadius: 12, padding: '1rem 1.2rem' }}>
        <p style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--muted)', lineHeight: 1.7, margin: 0 }}>
          Postings are live public listings Seen has indexed for your company. Applicant interactions are outcomes candidates reported on Seen — public, aggregate signal, never private applicant contact data. Seen has no employer login yet for public lookups, so the reputation hero is scoped by company name, exactly like your public reputation; the Listings, Analytics and Updates tabs are scoped to your approved claim.
        </p>
      </div>
    </>
  )
}

// Compact login-scoped listings summary for Overview. Self-fetches via the Bearer token; renders a
// graceful prompt (not an error) for anyone without an approved claim, always linking through to the
// full Listings tab.
function ListingsSummaryCard({ onManage }: { onManage: () => void }) {
  const { ready, isLoggedIn, isEmployer, claimsReady, token } = useAuth()
  const [loading, setLoading] = useState(true)
  const [summary, setSummary] = useState<ListingsSummary | null>(null)
  const [company, setCompany] = useState('')
  const [pending, setPending] = useState(false)

  const load = useCallback(async () => {
    try {
      const authToken = await token()
      if (!authToken) { setLoading(false); return }
      const r = await fetch('/api/employer-listings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ action: 'list' }),
      })
      if (r.status === 403) {
        const d = await r.json().catch(() => ({}))
        if (d?.reason === 'no_approved_claim') { setPending(true); setLoading(false); return }
      }
      const d = await r.json().catch(() => ({}))
      if (r.ok) { setSummary((d?.summary as ListingsSummary) || null); setCompany(d?.company || '') }
    } catch { /* graceful — the card just shows the sign-in prompt */ } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    if (!ready || !claimsReady) return
    if (!isLoggedIn || !isEmployer) { setLoading(false); return }
    load()
  }, [ready, claimsReady, isLoggedIn, isEmployer, load])

  const manageBtn = (
    <button className="emp-btn" onClick={onManage} style={{ background: 'transparent', border: '1px solid var(--line2)', borderRadius: 8, padding: '.45rem .9rem', fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.72rem', color: 'var(--white)', cursor: 'pointer' }}>
      Manage listings →
    </button>
  )

  const header = (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '.6rem', flexWrap: 'wrap', marginBottom: '.9rem' }}>
      <h2 style={{ fontFamily: 'var(--display)', fontSize: '1.05rem', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.02em', margin: 0 }}>Your listings</h2>
      {company ? <span style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--dim)', textTransform: 'capitalize' }}>{company}</span> : null}
    </div>
  )

  return (
    <section className="emp-card" style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 16, padding: '1.5rem', marginBottom: '1.6rem' }}>
      {header}
      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem' }}>
          <div className="spinner" />
          <span style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--dim)' }}>Loading your listings…</span>
        </div>
      ) : summary ? (
        <>
          <div style={{ display: 'flex', gap: '1.6rem', flexWrap: 'wrap', marginBottom: '1.1rem' }}>
            <Stat value={String(summary.total)} label="total" color="var(--white)" />
            <Stat value={String(summary.active)} label="active" color="var(--green)" />
            <Stat value={String(summary.employerPosted)} label="posted by you" color="var(--blue)" />
            <Stat value={String(summary.applications)} label="applications" color="var(--white)" />
            <Stat value={String(summary.openDisputes)} label="open disputes" color={summary.openDisputes > 0 ? 'var(--amber)' : 'var(--dim)'} />
          </div>
          {manageBtn}
        </>
      ) : (
        <>
          <p style={{ color: 'var(--sub)', fontSize: '.78rem', lineHeight: 1.65, margin: '0 0 1rem', maxWidth: 520 }}>
            {pending
              ? 'Your company claim is pending admin approval. Once approved, your listings summary shows here and you can post, edit, and dispute listings.'
              : 'Sign in with an approved company claim to manage the listings Seen has indexed for you — post your own roles, and dispute anything inaccurate.'}
          </p>
          {manageBtn}
        </>
      )}
    </section>
  )
}

// ── Updates tab: the persisted + derived live feed (self-scoped via the token). ──
function UpdatesTab() {
  return (
    <>
      <div style={{ marginBottom: '1.2rem' }}>
        <h2 style={{ fontFamily: 'var(--display)', fontSize: '1.15rem', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.02em', margin: '0 0 .3rem' }}>Updates to your postings</h2>
        <p style={{ color: 'var(--sub)', fontSize: '.8rem', lineHeight: 1.65, margin: 0, maxWidth: 620 }}>
          New applicants, dispute verdicts, and listings going stale or expiring — a merged feed of stored updates (which keep their read state) and live-derived signals, scoped to your approved company.
        </p>
      </div>

      <EmployerLiveNotifications />

      {/* Stable reference card — what the feed surfaces (also the tab's non-empty base when there
          are no updates or you're not signed in with an approved claim). */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 16, padding: '1.5rem' }}>
        <div style={{ fontFamily: 'var(--display)', fontSize: '.95rem', fontWeight: 700, color: 'var(--white)', marginBottom: '1rem' }}>What you&apos;ll see here</div>
        <div style={{ display: 'grid', gap: '.9rem' }}>
          {[
            { emoji: '👥', t: 'New applicants', d: 'How many candidates reported applying to each of your roles recently.' },
            { emoji: '⚖️', t: 'Dispute verdicts', d: 'When an admin resolves a report you disputed, the outcome lands here with its dispute number.' },
            { emoji: '⏳', t: 'Listings aging off', d: 'Indexed listings drop off Seen when their source stops showing them (stale at 7 days, gone at 14). Still hiring? Post the role yourself to keep it live.' },
          ].map(r => (
            <div key={r.t} style={{ display: 'flex', gap: '.8rem', alignItems: 'flex-start' }}>
              <span style={{ fontSize: '1.1rem', lineHeight: 1.3 }} aria-hidden>{r.emoji}</span>
              <div>
                <div style={{ fontFamily: 'var(--display)', fontSize: '.85rem', fontWeight: 700, color: 'var(--white)' }}>{r.t}</div>
                <p style={{ color: 'var(--sub)', fontSize: '.76rem', lineHeight: 1.6, margin: '.15rem 0 0' }}>{r.d}</p>
              </div>
            </div>
          ))}
        </div>
        <p style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--muted)', lineHeight: 1.7, margin: '1.2rem 0 0' }}>
          Your live feed appears above when you&apos;re signed in with an approved claim and there&apos;s something to show. Email and push delivery of these updates are coming next.
        </p>
      </div>
    </>
  )
}

function Stat({ value, label, color }: { value: string; label: string; color: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '.2rem' }}>
      <div style={{ fontFamily: 'var(--display)', fontSize: '1.5rem', fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', color: 'var(--dim)' }}>{label}</div>
    </div>
  )
}

// A hero stat whose numeric value counts up on mount (rAF, ease-out, reduced-motion
// aware). A null value renders as "—" and never animates.
function CountStat({ value, label, color, suffix = '' }: { value: number | null; label: string; color: string; suffix?: string }) {
  const n = useCountUp(value ?? 0)
  const display = value == null ? '—' : `${Math.round(n).toLocaleString()}${suffix}`
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '.2rem' }}>
      <div style={{ fontFamily: 'var(--display)', fontSize: '1.5rem', fontWeight: 800, color, lineHeight: 1 }}>{display}</div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', color: 'var(--dim)' }}>{label}</div>
    </div>
  )
}

// Animated grade ring — an SVG track + a foreground arc that "draws in" from empty to
// the score's fraction via `.emp-ring` (CSS `empRingDraw`, target offset in --emp-dash).
// The SVG is rotated -90° so the arc fills from the top; the grade letter + score sit
// centered on top as HTML. score == null → a plain track ring (empty / unrated state).
function GradeRing({ score }: { score: number | null }) {
  const animated = useCountUp(score ?? 0)
  const R = 38
  const CIRC = 2 * Math.PI * R
  if (score == null) {
    return (
      <div style={{ position: 'relative', width: 84, height: 84, flexShrink: 0 }}>
        <svg width={84} height={84} viewBox="0 0 84 84">
          <circle cx={42} cy={42} r={R} fill="none" stroke="var(--line2)" strokeWidth={6} />
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--display)', fontSize: '1.4rem', fontWeight: 800, color: 'var(--muted)' }}>—</div>
      </div>
    )
  }
  const color = gradeColor(score)
  const dashStyle = { ['--emp-dash']: String(CIRC * (1 - score / 100)) } as React.CSSProperties
  return (
    <div style={{ position: 'relative', width: 84, height: 84, flexShrink: 0 }}>
      <svg width={84} height={84} viewBox="0 0 84 84" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={42} cy={42} r={R} fill="none" stroke="var(--line2)" strokeWidth={6} />
        <circle
          className="emp-ring"
          cx={42} cy={42} r={R}
          fill="none" stroke={color} strokeWidth={6} strokeLinecap="round"
          strokeDasharray={CIRC} strokeDashoffset={CIRC}
          style={dashStyle}
        />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontFamily: 'var(--display)', fontSize: '1.85rem', fontWeight: 800, color, lineHeight: 1 }}>{gradeOf(score)}</div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: '.5rem', color: 'var(--dim)', marginTop: 2 }}>{Math.round(animated)}/100</div>
      </div>
    </div>
  )
}

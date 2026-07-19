'use client'

// Employer dashboard — the signed-in-employer view of "my postings + applicant activity",
// in one place. Reachable at /employers/dashboard (nav linking is a later PR).
//
// SCHEMA / AUTH REALITY (verified in code, stated honestly in the UI):
//   • There is no employer-owned postings table and no employer→company link on a profile
//     (lib/types.ts UserProfile has no company field). Migration 050 is explicit: the
//     employer portal creates NO accounts yet. So — exactly like the portal's anchor
//     reputation lookup (components/employer/EmployerReputation.tsx) — this dashboard is
//     COMPANY-SCOPED BY NAME. When employer accounts land (profile.type==='employer' +
//     a company link) it can auto-scope with zero data-shape change; the useAuth() gate
//     below already recognizes a signed-in employer.
//   • "Job postings" = the company's live (non-expired) listings Seen indexes, via
//     /api/jobs `company_jobs` (real Supabase read, server-side service key).
//   • "Applicant interactions" = public community outcome reports (reports table,
//     reports_public_read — migration 017), read straight from the anon client the same
//     way the seeker dashboard reads reports. No private applicant PII is exposed (there
//     is none to expose — applications are seeker-private under RLS).
//
// Data shaping lives in lib/server/employerDashboard.js (pure + unit-tested); this file is
// a thin fetch-and-render shell that matches the /employers portal visual idiom.

import { Suspense, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/lib/auth'
import {
  postingsWithInteractions,
  summarizeInteractions,
  recentInteractions,
} from '@/lib/server/employerDashboard'

// ── Types (the JS helper is inferred as loose; these annotate the render layer) ──
type Score = {
  overall_score: number | null
  ghost_rate: number | null
  response_rate: number | null
  avg_wait_days: number | null
  report_count: number
} | null

type RawPosting = {
  title?: string; company?: string; location?: string; salary?: string | null
  url?: string | null; apply_url?: string | null; type?: string; level?: string
  source?: string; score?: number | null; posted_at?: string | null
}
type RawReport = {
  role?: string | null; outcome?: string | null; created_at?: string | null
  experience_level?: string | null; company_name?: string | null
}
type PostingView = {
  title: string; location: string; type: string; level: string; salary: string
  source: string; score: number | null; url: string | null; postedAt: string | null
  applicantCount: number; counts: Record<string, number>
}
type InteractionView = {
  role: string; rawOutcome: string; bucket: string; label: string
  tone: string; experienceLevel: string; createdAt: string | null
}
type Summary = { total: number; counts: Record<string, number>; ghostRate: number | null; responseRate: number | null }

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

// Order + labels for the compact per-posting outcome chips.
const BUCKET_ORDER: Array<{ key: string; short: string; tone: string }> = [
  { key: 'ghosted', short: 'ghosted', tone: 'bad' },
  { key: 'interviewing', short: 'interviewing', tone: 'good' },
  { key: 'hired', short: 'hired', tone: 'good' },
  { key: 'rejected', short: 'rejected', tone: 'warn' },
  { key: 'waiting', short: 'awaiting', tone: 'neutral' },
]

function EmployerDashboardInner() {
  const router = useRouter()
  const params = useSearchParams()
  const { profile, isEmployer, ready } = useAuth()

  const initial = (params.get('company') || '').trim()
  const [companyInput, setCompanyInput] = useState(initial)
  const [company, setCompany] = useState(initial)
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [err, setErr] = useState('')
  const [postings, setPostings] = useState<RawPosting[]>([])
  const [reports, setReports] = useState<RawReport[]>([])
  const [score, setScore] = useState<Score>(null)

  const load = useCallback(async (name: string) => {
    const q = name.trim()
    if (!q) return
    setLoading(true); setErr(''); setLoaded(false)
    try {
      // All three reads are server-side (service key) — employers have no login and neither
      // `jobs` nor `reports` is granted to the anon role. Postings + reputation reuse the
      // existing shared endpoints; the recent public reports come from this route's own
      // in-directory handler (reports-feed).
      const [jobsRes, scoreRes, feedRes] = await Promise.all([
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
      ])
      setPostings(Array.isArray(jobsRes?.jobs) ? jobsRes.jobs : [])
      setScore((scoreRes?.score as Score) || null)
      setReports(Array.isArray(feedRes?.reports) ? feedRes.reports : [])
      setLoaded(true)
    } catch {
      setErr('Could not load this company’s dashboard — please try again.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { if (company) load(company) }, [company, load])

  function lookup() {
    const q = companyInput.trim()
    if (!q) return
    setCompany(q)
    const usp = new URLSearchParams(); usp.set('company', q)
    router.replace(`/employers/dashboard?${usp.toString()}`)
  }

  // Derived (pure, tested helper).
  const postingRows = postingsWithInteractions(postings, reports) as PostingView[]
  const recent = recentInteractions(reports, 10) as InteractionView[]
  const summary = summarizeInteractions(reports) as Summary
  const totalReports = score?.report_count ?? summary.total
  const overall = score?.overall_score ?? null
  const ghost = pct(score?.ghost_rate)
  const reply = pct(score?.response_rate)
  const hasRep = overall != null && (score?.report_count ?? 0) > 0

  return (
    <div style={{ minHeight: '100vh', background: 'radial-gradient(ellipse at 15% -5%,rgba(29,78,216,0.12) 0%,transparent 55%),radial-gradient(ellipse at 100% 5%,rgba(124,58,237,0.09) 0%,transparent 45%)' }}>
      {/* Employer-first header (seeker Nav/Footer hide on /employers — components/Nav.tsx) */}
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

      <div style={{ ...wrap, padding: '2.6rem 1.5rem 4rem' }}>
        {/* Intro */}
        <div style={{ marginBottom: '1.6rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', flexWrap: 'wrap', marginBottom: '.55rem' }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', textTransform: 'uppercase', letterSpacing: '.22em', color: 'var(--blue)' }}>Employer dashboard</span>
            {ready && isEmployer && (
              <span style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--green)', background: 'rgba(16,185,129,.12)', border: '1px solid rgba(16,185,129,.35)', borderRadius: 7, padding: '.16rem .5rem' }}>
                Signed in as {profile?.name || 'employer'}
              </span>
            )}
          </div>
          <h1 style={{ fontFamily: 'var(--display)', fontSize: 'clamp(1.6rem,5vw,2.3rem)', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.03em', lineHeight: 1.08, margin: '0 0 .5rem' }}>
            Your postings &amp; applicant activity
            {company ? <span style={{ color: 'var(--sub)' }}> — {company}</span> : <span style={{ color: 'var(--sub)' }}>, in one place</span>}
          </h1>
          <p style={{ color: 'var(--sub)', fontSize: '.85rem', lineHeight: 1.7, margin: 0, maxWidth: 620 }}>
            Every live listing Seen has indexed for your company, alongside the real outcomes candidates reported after applying — the same signals they see about you before they apply.
          </p>
        </div>

        {/* Company lookup (mirrors the reputation lookup idiom — no employer login exists yet) */}
        <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap', marginBottom: '1.8rem' }}>
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
        {err && <div style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--red)', marginBottom: '1.2rem' }}>{err}</div>}

        {/* Entry state — no company chosen yet (honest, no placeholder data) */}
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
            {/* ── Overview: reputation + headline counts ─────────────────────── */}
            <section style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 16, padding: '1.6rem', marginBottom: '1.4rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1.4rem', flexWrap: 'wrap' }}>
                {hasRep ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: 84, height: 84, borderRadius: 999, border: `4px solid ${gradeColor(overall!)}`, flexShrink: 0 }}>
                    <div style={{ fontFamily: 'var(--display)', fontSize: '2rem', fontWeight: 800, color: gradeColor(overall!), lineHeight: 1 }}>{gradeOf(overall!)}</div>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: '.5rem', color: 'var(--dim)', marginTop: 2 }}>{overall}/100</div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: 84, height: 84, borderRadius: 999, border: '4px solid var(--line2)', flexShrink: 0 }}>
                    <div style={{ fontFamily: 'var(--display)', fontSize: '1.4rem', fontWeight: 800, color: 'var(--muted)', lineHeight: 1 }}>—</div>
                  </div>
                )}
                <div style={{ display: 'flex', gap: '1.6rem', flexWrap: 'wrap' }}>
                  <Stat value={String(postingRows.length)} label="live postings" color="var(--blue)" />
                  <Stat value={totalReports.toLocaleString()} label="applicant reports" color="var(--white)" />
                  <Stat value={ghost != null ? `${ghost}%` : '—'} label="ghost rate" color="var(--red)" />
                  <Stat value={reply != null ? `${reply}%` : '—'} label="response rate" color="var(--green)" />
                </div>
              </div>
              <p style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--muted)', lineHeight: 1.6, margin: '1.1rem 0 0' }}>
                {hasRep
                  ? 'Grade, ghost rate and response rate are your public Seen reputation — what candidates see before applying.'
                  : `No applicant outcomes reported for ${company} yet — a clean slate. Your live postings still show below.`}
              </p>
            </section>

            {/* ── Job postings ──────────────────────────────────────────────── */}
            <section style={{ marginBottom: '1.4rem' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '.5rem', marginBottom: '.7rem' }}>
                <h2 style={{ fontFamily: 'var(--display)', fontSize: '1.05rem', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.02em', margin: 0 }}>Your job postings on Seen</h2>
                <span style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--dim)' }}>{postingRows.length} live</span>
              </div>

              {postingRows.length === 0 ? (
                <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 14, padding: '1.6rem', textAlign: 'center' }}>
                  <div style={{ fontFamily: 'var(--display)', fontSize: '.9rem', fontWeight: 700, color: 'var(--white)', marginBottom: '.3rem' }}>No live postings indexed for {company} yet</div>
                  <p style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--muted)', lineHeight: 1.6, margin: 0 }}>
                    Seen indexes public job listings. When a listing for your company is live, it appears here with the outcomes candidates report.
                  </p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '.55rem' }}>
                  {postingRows.map((p, i) => (
                    <div key={`${p.title}-${i}`} style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 12, padding: '1rem 1.1rem', display: 'flex', gap: '.9rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                      <div style={{ minWidth: 0, flex: '1 1 260px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
                          <span style={{ width: 7, height: 7, borderRadius: 999, background: 'var(--green)', flexShrink: 0 }} title="Live on Seen" />
                          {p.url
                            ? <a href={p.url} target="_blank" rel="noopener noreferrer" style={{ fontFamily: 'var(--display)', fontSize: '.9rem', fontWeight: 700, color: 'var(--white)', textDecoration: 'none' }}>{p.title}</a>
                            : <span style={{ fontFamily: 'var(--display)', fontSize: '.9rem', fontWeight: 700, color: 'var(--white)' }}>{p.title}</span>}
                        </div>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: '.56rem', color: 'var(--muted)', marginTop: '.25rem', display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
                          {p.location && <span>{p.location}</span>}
                          {p.type && <span>· {p.type}</span>}
                          {p.salary && <span>· {p.salary}</span>}
                          {p.postedAt && <span>· posted {fmtDate(p.postedAt)}</span>}
                          <span>· {p.source}</span>
                          <span>· {p.score != null ? `Seen score ${p.score}` : 'unrated'}</span>
                        </div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '.3rem', flexShrink: 0 }}>
                        <span style={{ fontFamily: 'var(--display)', fontSize: '1.1rem', fontWeight: 800, color: p.applicantCount ? 'var(--white)' : 'var(--muted)', lineHeight: 1 }}>{p.applicantCount}</span>
                        <span style={{ fontFamily: 'var(--mono)', fontSize: '.5rem', color: 'var(--dim)' }}>reported outcome{p.applicantCount === 1 ? '' : 's'}</span>
                        {p.applicantCount > 0 && (
                          <div style={{ display: 'flex', gap: '.3rem', flexWrap: 'wrap', justifyContent: 'flex-end', marginTop: '.1rem' }}>
                            {BUCKET_ORDER.filter(b => (p.counts?.[b.key] || 0) > 0).map(b => (
                              <span key={b.key} style={{ fontFamily: 'var(--mono)', fontSize: '.5rem', color: toneColor(b.tone), border: `1px solid ${toneColor(b.tone)}`, opacity: .85, borderRadius: 5, padding: '.05rem .3rem' }}>
                                {p.counts[b.key]} {b.short}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* ── Recent applicant interactions ─────────────────────────────── */}
            <section style={{ marginBottom: '1.8rem' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '.5rem', marginBottom: '.7rem' }}>
                <h2 style={{ fontFamily: 'var(--display)', fontSize: '1.05rem', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.02em', margin: 0 }}>Recent applicant interactions</h2>
                <span style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--dim)' }}>candidate-reported</span>
              </div>

              {recent.length === 0 ? (
                <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 14, padding: '1.6rem', textAlign: 'center' }}>
                  <div style={{ fontFamily: 'var(--display)', fontSize: '.9rem', fontWeight: 700, color: 'var(--white)', marginBottom: '.3rem' }}>No applicant outcomes reported yet</div>
                  <p style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--muted)', lineHeight: 1.6, margin: 0 }}>
                    When candidates report what happened after applying to {company}, it shows up here.
                  </p>
                </div>
              ) : (
                <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 14, overflow: 'hidden' }}>
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

            {/* Honest disclosure — what these numbers are and aren't */}
            <div style={{ background: 'var(--surface)', border: '1px solid var(--line2)', borderRadius: 12, padding: '1rem 1.2rem' }}>
              <p style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--muted)', lineHeight: 1.7, margin: 0 }}>
                Postings are live public listings Seen has indexed for your company. Applicant interactions are outcomes candidates reported on Seen — public, aggregate signal, never private applicant contact data. Per-posting counts match a report&apos;s role to a listing&apos;s title. Seen has no employer login yet, so this dashboard is scoped by company name, exactly like your public reputation.
              </p>
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

function Stat({ value, label, color }: { value: string; label: string; color: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '.2rem' }}>
      <div style={{ fontFamily: 'var(--display)', fontSize: '1.5rem', fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', color: 'var(--dim)' }}>{label}</div>
    </div>
  )
}

export default function EmployerDashboardPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><div className="spinner" /></div>}>
      <EmployerDashboardInner />
    </Suspense>
  )
}

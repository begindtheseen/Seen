import type { Metadata } from 'next'
import Link from 'next/link'
import { deriveEmployerNotifications } from '@/lib/server/employerNotifications'
import { NotificationsFeed } from './NotificationsFeed'
import { EmployerScopeGuard } from '@/components/employer/EmployerScopeGuard'

// Employer notifications — the signed-in-less employer's LIVE feed of updates to their postings.
//
// "Notify" honestly, given this codebase: there is no employer login and no email/push delivery
// (the only mail path is api/apply.js's Resend call for candidate→employer application emails, with
// no employer addresses to send to). So notifications are DERIVED and computed live on load — new
// applicant reports + postings going stale/expired — from data that already exists. Email/push is a
// named follow-up (see the PR). Employer identity = company name, exactly like the reputation lookup
// (components/employer/EmployerReputation.tsx). Rendered here as a distinct employer-first surface;
// wiring it into the portal nav is a separate shared-file change (noted in the PR, not done here).

export const dynamic = 'force-dynamic' // the feed is recomputed on every load — "timely" means live

export const metadata: Metadata = {
  title: 'Your posting updates — Seen for Employers',
  description:
    'Live updates for your job postings on Seen: new applicants and postings about to go stale or expire — computed the moment you open the page.',
  alternates: { canonical: 'https://seenjobs.io/employers/notifications' },
  robots: { index: false }, // per-company feed keyed by a query param — not an indexable surface
}

const wrap = { maxWidth: 820, margin: '0 auto', padding: '0 1.5rem', width: '100%', boxSizing: 'border-box' as const }

type Job = {
  id?: string | number
  title?: string | null
  company?: string | null
  city?: string | null
  location?: string | null
  availability_status?: string | null
  last_seen_at?: string | null
  created_at?: string | null
}
type Application = { role?: string | null; city?: string | null; status?: string | null; created_at?: string | null }

// Server-only fetch: this employer's postings + applicant reports, matched by company NAME (the same
// identity the reputation tool uses). Service key stays server-side; only non-identifying application
// fields (role/city/status/when) are read. Read-only — this page never writes.
async function loadEmployerData(company: string): Promise<{ jobs: Job[]; applications: Application[]; configured: boolean; error: boolean }> {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) return { jobs: [], applications: [], configured: false, error: false }
  const enc = encodeURIComponent(company) // `ilike.<name>` with no wildcards = case-insensitive exact match
  const headers = { apikey: key, Authorization: `Bearer ${key}` }
  try {
    const [jr, ar] = await Promise.all([
      fetch(
        `${url}/rest/v1/jobs?company=ilike.${enc}&select=id,title,company,city,availability_status,last_seen_at,created_at&order=last_seen_at.asc&limit=200`,
        { headers, cache: 'no-store', signal: AbortSignal.timeout(8000) },
      ),
      fetch(
        `${url}/rest/v1/applications?company_name=ilike.${enc}&select=role,city,status,created_at&order=created_at.desc&limit=200`,
        { headers, cache: 'no-store', signal: AbortSignal.timeout(8000) },
      ),
    ])
    const jobs = jr.ok ? await jr.json() : []
    const applications = ar.ok ? await ar.json() : []
    return {
      jobs: Array.isArray(jobs) ? jobs : [],
      applications: Array.isArray(applications) ? applications : [],
      configured: true,
      error: false,
    }
  } catch {
    return { jobs: [], applications: [], configured: true, error: true }
  }
}

export default async function EmployerNotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string | string[]; godview?: string | string[] }>
}) {
  const sp = await searchParams
  const raw = Array.isArray(sp.company) ? sp.company[0] : sp.company
  const company = (raw || '').trim().slice(0, 120)
  const godview = (Array.isArray(sp.godview) ? sp.godview[0] : sp.godview) === '1'

  let feed: ReturnType<typeof deriveEmployerNotifications> | null = null
  let configured = true
  let fetchError = false
  let hadAnyData = false

  if (company) {
    const { jobs, applications, configured: cfg, error } = await loadEmployerData(company)
    configured = cfg
    fetchError = error
    hadAnyData = jobs.length > 0 || applications.length > 0
    feed = deriveEmployerNotifications({ jobs, applications, now: Date.now() })
  }

  return (
    <div style={{ minHeight: '100vh', background: 'radial-gradient(ellipse at 15% -5%,rgba(29,78,216,0.12) 0%,transparent 55%),radial-gradient(ellipse at 100% 5%,rgba(124,58,237,0.09) 0%,transparent 45%)' }}>
      {/* Employer-first header — no seeker nav (mirrors /employers) */}
      <header style={{ borderBottom: '1px solid var(--line)', background: 'rgba(5,7,15,.7)', backdropFilter: 'blur(12px)', position: 'sticky', top: 0, zIndex: 50 }}>
        <div style={{ ...wrap, maxWidth: 900, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '.9rem 1.5rem' }}>
          <Link href="/employers" style={{ display: 'flex', alignItems: 'center', gap: '.55rem', textDecoration: 'none' }}>
            <span style={{ width: 8, height: 8, borderRadius: 999, background: 'var(--blue)', boxShadow: '0 0 8px var(--blue)' }} />
            <span style={{ fontFamily: 'var(--display)', fontWeight: 800, fontSize: '1.05rem', color: 'var(--white)', letterSpacing: '-.02em' }}>Seen</span>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '.12em' }}>for employers</span>
          </Link>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <Link href="/employers" style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--sub)', textDecoration: 'none' }}>Your reputation</Link>
            <Link href="/employers#promote" style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--sub)', textDecoration: 'none' }}>Pricing</Link>
          </div>
        </div>
      </header>

      <div style={{ ...wrap, padding: '3rem 1.5rem 5rem' }}>
        {/* Login-scoping (migration 053): redirects a logged-in approved employer to their company;
            shows the god-view banner for admins. No-op for logged-out visitors. */}
        <EmployerScopeGuard param={company} godview={godview} />
        {/* Hero */}
        <div style={{ marginBottom: '2rem' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', textTransform: 'uppercase', letterSpacing: '.22em', color: 'var(--blue)', marginBottom: '.7rem' }}>For employers · updates</div>
          <h1 style={{ fontFamily: 'var(--display)', fontSize: 'clamp(1.7rem,5vw,2.4rem)', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.03em', lineHeight: 1.08, margin: '0 0 .7rem' }}>
            Updates to your job postings
          </h1>
          <p style={{ color: 'var(--sub)', fontSize: '.9rem', lineHeight: 1.7, maxWidth: 620, margin: 0 }}>
            New applicants and postings about to go stale or expire — computed live from your listings on Seen the moment you open this page. Look up your company to see your feed.
          </p>
        </div>

        {/* Company lookup — a plain GET form so it works with or without JS (same identity the
            reputation tool uses). Submitting navigates to ?company=<name>. */}
        <form method="get" style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap', marginBottom: '2rem' }}>
          <input
            name="company"
            defaultValue={company}
            placeholder="Your company name"
            aria-label="Your company name"
            autoComplete="organization"
            style={{ flex: 1, minWidth: 220, background: 'var(--raised)', border: '1px solid var(--line2)', borderRadius: 9, padding: '.7rem .9rem', fontFamily: 'var(--mono)', fontSize: '.75rem', color: 'var(--white)', outline: 'none' }}
          />
          <button type="submit" style={{ background: 'linear-gradient(135deg,#1d4ed8,#7c3aed)', border: 'none', borderRadius: 9, padding: '.7rem 1.4rem', fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.8rem', color: '#fff', cursor: 'pointer' }}>
            Show my updates →
          </button>
        </form>

        {/* States */}
        {!company && <IntroState />}

        {company && !configured && (
          <Notice tone="muted" title="Live feed unavailable">
            This environment isn&apos;t connected to the postings database, so there&apos;s nothing to show. On production this feed reads your live listings.
          </Notice>
        )}

        {company && configured && fetchError && (
          <Notice tone="warn" title="Couldn&apos;t load your feed">
            We hit an error reading your postings. Refresh to try again.
          </Notice>
        )}

        {company && configured && !fetchError && feed && (
          feed.items.length === 0 ? (
            hadAnyData ? (
              <Notice tone="ok" title={`You're all caught up on “${company}”.`}>
                No postings going stale and no new applicants in the last {feed.thresholds.APPLICANT_WINDOW_DAYS} days. Postings stay active as long as they&apos;re seen on their source; they go stale after {feed.thresholds.STALE_AFTER_DAYS} days and expire after {feed.thresholds.EXPIRE_AFTER_DAYS}.
              </Notice>
            ) : (
              <Notice tone="muted" title={`No postings found for “${company}” on Seen yet.`}>
                We don&apos;t have any listings or applicant reports matched to that company name. Check the spelling, or if you post through an aggregator your listings may appear under a slightly different name.
              </Notice>
            )
          ) : (
            <NotificationsFeed
              company={company}
              items={feed.items}
              summary={feed.summary}
              thresholds={feed.thresholds}
            />
          )
        )}
      </div>

      {/* Employer-first footer */}
      <footer style={{ borderTop: '1px solid var(--line)', padding: '1.4rem 1.5rem' }}>
        <div style={{ ...wrap, maxWidth: 900, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '.6rem' }}>
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

function IntroState() {
  const rows: { emoji: string; t: string; d: string }[] = [
    { emoji: '👥', t: 'New applicants', d: 'How many candidates reported applying to each of your roles recently, and when the most recent one came in.' },
    { emoji: '⏳', t: 'Postings going stale', d: 'Listings that haven’t been seen on their source in a while — they go stale at 7 days and expire at 14, dropping out of search.' },
    { emoji: '⚠️', t: 'Expired postings', d: 'Listings that have expired and are being removed — so you can re-post before you lose applicant flow.' },
  ]
  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 16, padding: '1.6rem' }}>
      <div style={{ fontFamily: 'var(--display)', fontSize: '1rem', fontWeight: 700, color: 'var(--white)', marginBottom: '1rem' }}>What you&apos;ll see</div>
      <div style={{ display: 'grid', gap: '.9rem' }}>
        {rows.map((r) => (
          <div key={r.t} style={{ display: 'flex', gap: '.8rem', alignItems: 'flex-start' }}>
            <span style={{ fontSize: '1.1rem', lineHeight: 1.3 }} aria-hidden>{r.emoji}</span>
            <div>
              <div style={{ fontFamily: 'var(--display)', fontSize: '.85rem', fontWeight: 700, color: 'var(--white)' }}>{r.t}</div>
              <p style={{ color: 'var(--sub)', fontSize: '.76rem', lineHeight: 1.6, margin: '.15rem 0 0' }}>{r.d}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function Notice({ tone, title, children }: { tone: 'muted' | 'ok' | 'warn'; title: string; children: React.ReactNode }) {
  const border = tone === 'ok' ? 'rgba(16,185,129,.25)' : tone === 'warn' ? 'rgba(245,158,11,.28)' : 'var(--line)'
  const bg = tone === 'ok' ? 'rgba(16,185,129,.06)' : tone === 'warn' ? 'rgba(245,158,11,.05)' : 'var(--card)'
  return (
    <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: 14, padding: '1.4rem 1.5rem' }}>
      <div style={{ fontFamily: 'var(--display)', fontSize: '.95rem', fontWeight: 700, color: 'var(--white)', marginBottom: '.35rem' }}>{title}</div>
      <p style={{ color: 'var(--sub)', fontSize: '.8rem', lineHeight: 1.65, margin: 0 }}>{children}</p>
    </div>
  )
}

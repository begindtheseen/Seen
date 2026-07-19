import type { Metadata } from 'next'
import Link from 'next/link'
import { fetchEmployerAnalytics } from '@/lib/server/employerAnalytics'

// Employer posting analytics — issue #96 ("Employers can view analytics on their job posting
// performance, including applicant sources and application rates").
//
// HONEST BY DESIGN. Every number here comes from the SAME real applicant-reported outcomes that
// power company_scores and the public company page (the `reports` table) — the exact data a
// candidate sees before applying. What Seen genuinely does NOT have, we do not invent:
//   • No employer-owned job postings + no impression/view tracking anywhere in the schema, so there
//     is no applications-per-view conversion to show. We report application VOLUME over time and
//     response/ghost RATES — the honest read of "application rates" — never a fabricated funnel.
//   • No employer login exists in this repo (the /employers portal is explicitly no-account). So an
//     employer identifies by company name via ?company=, mirroring the EmployerReputation lookup.
//     A real employer identity/auth is a shared change to make later (see PR notes), not here.
//   • "Per-posting" is shown per-role (reports.role) — the finest posting granularity that exists.
//
// Server component, service-key reads server-only (lib/server/employerAnalytics.js mirrors the
// lib/growth.ts access idiom). Dynamic (per-company, live) and noindex (per-company query surface).

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Your posting analytics — Seen for Employers',
  description:
    'See how your job postings actually perform on Seen: applicant sources, application volume over time, response and ghost rates, and a per-role breakdown — all from real applicant-reported outcomes.',
  robots: { index: false, follow: false },
  alternates: { canonical: 'https://seenjobs.io/employers/analytics' },
}

const wrap = { maxWidth: 940, margin: '0 auto', padding: '0 1.5rem', width: '100%', boxSizing: 'border-box' as const }
const mono = (size: string, color: string): React.CSSProperties => ({ fontFamily: 'var(--mono)', fontSize: size, color })
const card: React.CSSProperties = { background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 16, padding: '1.6rem 1.7rem', marginBottom: '1.4rem' }
const kicker: React.CSSProperties = { fontFamily: 'var(--mono)', fontSize: '.55rem', textTransform: 'uppercase', letterSpacing: '.16em', color: 'var(--blue)', marginBottom: '.55rem' }
const h2: React.CSSProperties = { fontFamily: 'var(--display)', fontSize: '1.15rem', fontWeight: 800, color: 'var(--white)', margin: '0 0 .2rem', letterSpacing: '-.02em' }
const sub: React.CSSProperties = { color: 'var(--sub)', fontSize: '.78rem', lineHeight: 1.6, margin: '.15rem 0 1.1rem' }

const fmtPct = (v: number | null | undefined) => (v == null ? '—' : `${Number.isInteger(v) ? v : v.toFixed(1)}%`)
const gradeColor = (g: string | null) => (g === 'A' || g === 'B' ? 'var(--green)' : g === 'C' ? 'var(--amber)' : 'var(--red)')
const monthLabel = (m: string) => {
  const [y, mm] = m.split('-')
  const d = new Date(Date.UTC(Number(y), Number(mm) - 1, 1))
  return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' })
}

function Bar({ pct, color = 'var(--blue)' }: { pct: number; color?: string }) {
  return (
    <div style={{ height: 8, background: 'var(--raised)', borderRadius: 999, overflow: 'hidden', minWidth: 60 }}>
      <div style={{ width: `${Math.max(2, Math.min(100, pct))}%`, height: '100%', background: color, borderRadius: 999 }} />
    </div>
  )
}

// A labeled breakdown table: [{ key, count, pct }] with a proportional bar (relative to the top row).
function BreakdownTable({ rows, color = 'var(--blue)' }: { rows: { key: string; count: number; pct: number }[]; color?: string }) {
  const max = Math.max(...rows.map(r => r.count), 1)
  return (
    <div style={{ display: 'grid', gap: '.6rem' }}>
      {rows.map(r => (
        <div key={r.key} style={{ display: 'grid', gridTemplateColumns: 'minmax(120px,1.4fr) 2fr auto', gap: '.8rem', alignItems: 'center' }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: '.68rem', color: 'var(--white)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.key}</span>
          <Bar pct={(r.count / max) * 100} color={color} />
          <span style={{ fontFamily: 'var(--mono)', fontSize: '.66rem', color: 'var(--dim)', whiteSpace: 'nowrap' }}>{r.count.toLocaleString()} · {fmtPct(r.pct)}</span>
        </div>
      ))}
    </div>
  )
}

function StatTile({ value, label, color = 'var(--white)', note }: { value: string; label: string; color?: string; note?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '.25rem', minWidth: 90 }}>
      <div style={{ fontFamily: 'var(--display)', fontSize: '1.7rem', fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '.08em' }}>{label}</div>
      {note ? <div style={{ fontFamily: 'var(--mono)', fontSize: '.52rem', color: 'var(--muted)' }}>{note}</div> : null}
    </div>
  )
}

// Plain server-rendered GET lookup — navigates to ?company=…, no client JS. Mirrors the
// EmployerReputation "look up your company" pattern.
function LookupForm({ company }: { company?: string }) {
  return (
    <form method="get" action="/employers/analytics" style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap' }}>
      <input
        name="company"
        defaultValue={company || ''}
        placeholder="Your company name"
        aria-label="Company name"
        autoComplete="organization"
        style={{ flex: 1, minWidth: 240, background: 'var(--raised)', border: '1px solid var(--line2)', borderRadius: 9, padding: '.7rem .9rem', fontFamily: 'var(--mono)', fontSize: '.75rem', color: 'var(--white)', outline: 'none' }}
      />
      <button type="submit" style={{ background: 'linear-gradient(135deg,#1d4ed8,#7c3aed)', border: 'none', borderRadius: 9, padding: '.7rem 1.4rem', fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.8rem', color: '#fff', cursor: 'pointer' }}>
        View analytics →
      </button>
    </form>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: 'radial-gradient(ellipse at 15% -5%,rgba(29,78,216,0.12) 0%,transparent 55%),radial-gradient(ellipse at 100% 5%,rgba(124,58,237,0.09) 0%,transparent 45%)' }}>
      <header style={{ borderBottom: '1px solid var(--line)', background: 'rgba(5,7,15,.7)', backdropFilter: 'blur(12px)', position: 'sticky', top: 0, zIndex: 50 }}>
        <div style={{ ...wrap, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '.9rem 1.5rem' }}>
          <Link href="/employers" style={{ display: 'flex', alignItems: 'center', gap: '.55rem', textDecoration: 'none' }}>
            <span style={{ width: 8, height: 8, borderRadius: 999, background: 'var(--blue)', boxShadow: '0 0 8px var(--blue)' }} />
            <span style={{ fontFamily: 'var(--display)', fontWeight: 800, fontSize: '1.05rem', color: 'var(--white)', letterSpacing: '-.02em' }}>Seen</span>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '.12em' }}>for employers</span>
          </Link>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <Link href="/employers" style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--sub)', textDecoration: 'none' }}>Reputation</Link>
            <Link href="/employers#promote" style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--dim)', textDecoration: 'none' }}>Get featured →</Link>
          </div>
        </div>
      </header>
      <div style={{ ...wrap, padding: '3rem 1.5rem 5rem' }}>{children}</div>
      <footer style={{ borderTop: '1px solid var(--line)', padding: '1.4rem 1.5rem' }}>
        <div style={{ ...wrap, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '.6rem' }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--dim)' }}>© 2026 Seen · for employers</span>
          <div style={{ display: 'flex', gap: '1.1rem' }}>
            <Link href="/employers" style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--dim)', textDecoration: 'none' }}>Reputation</Link>
            <Link href="/legal" style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--dim)', textDecoration: 'none' }}>Legal</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}

function Intro({ company }: { company?: string }) {
  return (
    <div style={{ marginBottom: '2rem' }}>
      <div style={kicker}>Posting analytics</div>
      <h1 style={{ fontFamily: 'var(--display)', fontSize: 'clamp(1.6rem,5vw,2.2rem)', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.03em', lineHeight: 1.08, margin: '0 0 .7rem', maxWidth: 640 }}>
        How your postings actually perform.
      </h1>
      <p style={{ color: 'var(--sub)', fontSize: '.9rem', lineHeight: 1.7, maxWidth: 620, margin: '0 0 1.4rem' }}>
        Every number below comes from real applicant-reported outcomes — the same record candidates
        see before they apply. Look up your company to see where your applicants come from, how
        application volume moves over time, and how often you actually respond.
      </p>
      <LookupForm company={company} />
    </div>
  )
}

export default async function EmployerAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string | string[] }>
}) {
  const sp = await searchParams
  const raw = Array.isArray(sp.company) ? sp.company[0] : sp.company
  const company = (raw || '').trim()

  // No company yet → the honest lookup prompt.
  if (!company) {
    return (
      <Shell>
        <Intro />
        <div style={{ ...card, textAlign: 'center', padding: '2.4rem 1.7rem' }}>
          <div style={{ fontFamily: 'var(--display)', fontSize: '1rem', fontWeight: 700, color: 'var(--white)', marginBottom: '.4rem' }}>Enter your company name to begin.</div>
          <p style={{ ...mono('.66rem', 'var(--muted)'), lineHeight: 1.7, maxWidth: 460, margin: '0 auto' }}>
            We match the name against the public applicant-outcome record. Names with no reports yet
            show an honest blank slate — never an invented number.
          </p>
        </div>
      </Shell>
    )
  }

  const result = await fetchEmployerAnalytics(company)

  // Infra/credentials unavailable — say so plainly rather than render a fake zero-state.
  if (!result.ok || !result.analytics) {
    return (
      <Shell>
        <Intro company={company} />
        <div style={card}>
          <div style={{ fontFamily: 'var(--display)', fontSize: '1rem', fontWeight: 700, color: 'var(--white)', marginBottom: '.35rem' }}>Couldn’t load analytics right now.</div>
          <p style={{ ...mono('.66rem', 'var(--sub)'), lineHeight: 1.7 }}>
            The applicant-outcome data source is temporarily unavailable. Try again in a moment.
          </p>
        </div>
      </Shell>
    )
  }

  const { analytics, industry, verified } = result
  const resolvedCompany = result.company || company
  const h = analytics.headline
  const rs = analytics.responseSummary

  // Real empty state — matched by name, but no applicant reports on record.
  if (!analytics.hasData) {
    return (
      <Shell>
        <Intro company={company} />
        <div style={card}>
          <div style={{ fontFamily: 'var(--display)', fontSize: '1.05rem', fontWeight: 700, color: 'var(--white)', marginBottom: '.4rem' }}>No applicant reports for “{resolvedCompany}” yet.</div>
          <p style={{ color: 'var(--sub)', fontSize: '.8rem', lineHeight: 1.7, maxWidth: 540, margin: '0 0 1rem' }}>
            Nothing to chart yet — which is a clean slate, not a bad sign. As candidates report how
            your postings went, their sources, volume, and response outcomes will appear here. This
            is the same record that builds your public reputation, so there are no numbers to show
            until the first real report lands.
          </p>
          <Link href="/employers" style={{ display: 'inline-block', background: 'linear-gradient(135deg,#1d4ed8,#7c3aed)', border: 'none', borderRadius: 8, padding: '.55rem 1.1rem', fontFamily: 'var(--display)', fontWeight: 800, fontSize: '.78rem', color: '#fff', textDecoration: 'none' }}>
            See your reputation →
          </Link>
        </div>
      </Shell>
    )
  }

  const maxMonth = Math.max(...analytics.monthly.map(m => m.count), 1)

  return (
    <Shell>
      <Intro company={company} />

      {/* Identity + headline reputation (what candidates see) */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: '.5rem', marginBottom: '1.2rem' }}>
          <div>
            <div style={kicker}>Reporting on</div>
            <div style={{ fontFamily: 'var(--display)', fontSize: '1.35rem', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.02em', textTransform: 'capitalize' }}>
              {resolvedCompany}
              {verified ? <span style={{ ...mono('.55rem', 'var(--green)'), marginLeft: '.6rem', textTransform: 'uppercase', letterSpacing: '.1em' }}>✓ Verified</span> : null}
            </div>
            {industry ? <div style={mono('.6rem', 'var(--dim)')}>{industry}</div> : null}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: 78, height: 78, borderRadius: 999, border: `4px solid ${gradeColor(h.grade)}`, flexShrink: 0 }}>
            {h.grade ? (
              <>
                <div style={{ fontFamily: 'var(--display)', fontSize: '2rem', fontWeight: 800, color: gradeColor(h.grade), lineHeight: 1 }}>{h.grade}</div>
                <div style={mono('.5rem', 'var(--dim)')}>{h.overallScore}/100</div>
              </>
            ) : (
              <div style={{ ...mono('.5rem', 'var(--dim)'), textAlign: 'center', padding: '0 .3rem' }}>grade<br />pending</div>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '1.8rem', flexWrap: 'wrap', paddingTop: '1.2rem', borderTop: '1px solid var(--line)' }}>
          <StatTile value={h.reportCount.toLocaleString()} label="applicant reports" />
          <StatTile value={fmtPct(h.ghostPct)} label="ghost rate" color="var(--red)" note={h.ratesComputedLive ? 'from reports' : undefined} />
          <StatTile value={fmtPct(h.responsePct)} label="response rate" color="var(--green)" note={h.ratesComputedLive ? 'from reports' : undefined} />
          <StatTile value={h.avgWaitDays == null ? '—' : `${h.avgWaitDays}d`} label="avg reported wait" color="var(--amber)" />
          <StatTile value={String(analytics.roleCount)} label="roles reported" />
        </div>
        {h.ratesWithheld ? (
          <p style={{ ...mono('.58rem', 'var(--muted)'), marginTop: '1rem', lineHeight: 1.6 }}>
            Ghost / response rates need at least {h.rateFloor} reports before we’ll show a percentage — below that,
            a rate would be noise. The raw outcomes are broken out below.
          </p>
        ) : null}
      </div>

      {/* Application volume over time */}
      <div style={card}>
        <div style={kicker}>Application volume over time</div>
        <h2 style={h2}>When applicants reported applying</h2>
        <p style={sub}>
          Count of applicant reports per month. This is real reported volume — Seen doesn’t host your
          postings or track impressions, so there’s no applications-per-view rate to show, and we don’t invent one.
        </p>
        <div style={{ display: 'grid', gap: '.5rem' }}>
          {analytics.monthly.map(m => (
            <div key={m.month} style={{ display: 'grid', gridTemplateColumns: '52px 1fr auto', gap: '.8rem', alignItems: 'center' }}>
              <span style={mono('.62rem', 'var(--dim)')}>{monthLabel(m.month)}</span>
              <Bar pct={(m.count / maxMonth) * 100} color="var(--blue)" />
              <span style={mono('.64rem', 'var(--sub)')}>{m.count.toLocaleString()}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Applicant sources */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: '1.4rem' }}>
        <div style={card}>
          <div style={kicker}>Applicant sources</div>
          <h2 style={h2}>Where applicants applied</h2>
          <p style={sub}>The platform each reported applicant applied through.</p>
          <BreakdownTable rows={analytics.sources} color="var(--blue)" />
        </div>
        <div style={card}>
          <div style={kicker}>Report provenance</div>
          <h2 style={h2}>How each outcome reached Seen</h2>
          <p style={sub}>Whether the outcome was reported directly or gathered from public applicant discussion.</p>
          <BreakdownTable rows={analytics.provenance} color="var(--purple, #7c3aed)" />
        </div>
      </div>

      {/* Response outcomes */}
      <div style={card}>
        <div style={kicker}>Application outcomes</div>
        <h2 style={h2}>What happened after applicants applied</h2>
        <p style={sub}>
          The raw split of every reported outcome. Responded = interview, offer, hired, or a human reply; ghosted =
          no response at all; rejected = auto- or human rejection; pending = still awaiting a reply. The headline
          ghost / response rates above use the same trust-weighted computation as your public grade, so they can
          differ from this raw count.
        </p>
        <div style={{ display: 'flex', gap: '1.8rem', flexWrap: 'wrap', marginBottom: '1.3rem' }}>
          <StatTile value={rs.responded.toLocaleString()} label={`responded · ${fmtPct(rs.respondedPct)}`} color="var(--green)" />
          <StatTile value={rs.ghosted.toLocaleString()} label={`ghosted · ${fmtPct(rs.ghostedPct)}`} color="var(--red)" />
          <StatTile value={rs.rejected.toLocaleString()} label={`rejected · ${fmtPct(rs.rejectedPct)}`} color="var(--amber)" />
          <StatTile value={rs.pending.toLocaleString()} label={`pending · ${fmtPct(rs.pendingPct)}`} color="var(--dim)" />
        </div>
        <BreakdownTable rows={analytics.outcomeBreakdown.map(o => ({ key: o.label, count: o.count, pct: o.pct }))} color="var(--sub)" />
      </div>

      {/* Per-role breakdown */}
      <div style={card}>
        <div style={kicker}>Per-role breakdown</div>
        <h2 style={h2}>Performance by role</h2>
        <p style={sub}>
          Seen doesn’t host individual postings, so role is the finest posting-level cut the data supports —
          the honest stand-in for per-posting performance.
        </p>
        <div style={{ display: 'grid', gap: '.7rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(120px,2fr) 1fr 1fr 1fr', gap: '.6rem', paddingBottom: '.4rem', borderBottom: '1px solid var(--line)' }}>
            {['Role', 'Reports', 'Responded', 'Ghosted'].map((t, i) => (
              <span key={t} style={{ ...mono('.55rem', 'var(--dim)'), textTransform: 'uppercase', letterSpacing: '.08em', textAlign: i === 0 ? 'left' : 'right' }}>{t}</span>
            ))}
          </div>
          {analytics.roles.map(r => (
            <div key={r.role} style={{ display: 'grid', gridTemplateColumns: 'minmax(120px,2fr) 1fr 1fr 1fr', gap: '.6rem', alignItems: 'center' }}>
              <span style={{ fontFamily: 'var(--mono)', fontSize: '.68rem', color: 'var(--white)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.role}</span>
              <span style={{ ...mono('.66rem', 'var(--sub)'), textAlign: 'right' }}>{r.count.toLocaleString()}</span>
              <span style={{ ...mono('.66rem', 'var(--green)'), textAlign: 'right' }}>{r.responded} · {fmtPct(r.respondedPct)}</span>
              <span style={{ ...mono('.66rem', 'var(--red)'), textAlign: 'right' }}>{r.ghosted} · {fmtPct(r.ghostedPct)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Methodology / honesty note */}
      <p style={{ ...mono('.56rem', 'var(--muted)'), lineHeight: 1.7, marginTop: '.4rem' }}>
        Methodology: numbers are computed from applicant-reported outcomes on record for this company (the same
        source as your public grade), excluding reports flagged for review. Seen aggregates listings from external
        sources and does not host employer postings or track views/impressions — so this page reports real applicant
        sources, volume, and response outcomes, never an impression-based conversion rate. Companies with no reports
        show no numbers, never fabricated ones.
      </p>
    </Shell>
  )
}

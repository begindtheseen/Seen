import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'
import Link from 'next/link'
import { getLeaderboard, titleCase, slugify, grade, riskColor, riskLabel } from '@/lib/growth'

// Reddit landing: "Real hiring outcomes from Reddit." Surfaces the worst ghosters and fastest
// responders from real leaderboard data, in Reddit-native voice, with tight internal links.
//
// HONESTY: every list and every "N reports" here uses FIRST-PARTY applicant reports
// (score.first_party_report_count) — never the fused report_count, which adds the web-research
// pipeline's *claimed* mention count (live: McDonald's "12,775 reports" with zero report rows).
// Companies scored only from web research never appear in these "reported" lists.

export const revalidate = 3600

export const metadata: Metadata = pageMetadata({
  title: 'Real Hiring Outcomes from Reddit — Who Ghosts, Who Responds',
  description: 'Tired of "does anyone know if X is ghosting" threads? Seen aggregates real applicant outcomes into ghost rates and response times for hundreds of companies — the data those Reddit threads are missing.',
  keywords: ['reddit hiring', 'does anyone know if they ghost', 'reddit job application ghosted', 'companies that ghost applicants reddit', 'reddit recruiting', 'r/recruitinghell'],
  path: '/reddit',
  ogTitle: 'Real Hiring Outcomes from Reddit',
  ogDescription: 'Ghost rates and response times from real applicant reports — the data Reddit threads are missing.',
})

const wrap = { maxWidth: 760, margin: '0 auto', padding: '3.5rem 1.25rem 5rem', width: '100%', boxSizing: 'border-box' as const }

function CompanyRow({ name, score, ghostRate, responseRate, sub }: { name: string; score: number; ghostRate: number; responseRate: number; sub: string }) {
  const accent = riskColor(score >= 70 ? 'safe' : score >= 40 ? 'warn' : 'danger')
  return (
    <Link href={`/company/${slugify(name)}`} style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '.85rem', background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10, padding: '.85rem 1rem', marginBottom: '.55rem' }}>
      <div style={{ fontFamily: 'var(--display)', fontSize: 'var(--fs-xl)', fontWeight: 800, color: accent, width: 30, textAlign: 'center', flexShrink: 0 }}>{grade(score)}</div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontFamily: 'var(--display)', fontSize: 'var(--fs-body)', fontWeight: 700, color: 'var(--white)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{titleCase(name)}</div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', color: 'var(--dim)', marginTop: '.15rem' }}>{sub}</div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', color: 'var(--red)' }}>{Math.round(ghostRate * 100)}% ghost</div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', color: 'var(--green)' }}>{Math.round(responseRate * 100)}% reply</div>
      </div>
    </Link>
  )
}

export default async function RedditPage() {
  // Ordered by first-party rows so genuinely-reported companies aren't crowded out of the window
  // by web-research claims.
  // getLeaderboard returns only GRADEABLE companies (≥ MIN_REPORTS_FOR_GRADE real reports), so the
  // verdict fields below are always present; the `?? 0` / `!` only satisfy the nullable types.
  const board = await getLeaderboard({ by: 'first_party' })
  const reportsOf = (c: (typeof board)[number]) => c.score.first_party_report_count
  const withReports = board.filter(c => reportsOf(c) > 0)

  // Real "worst ghosters" — highest ghost rate among companies with meaningful report volume.
  const ghosters = [...withReports]
    .filter(c => reportsOf(c) >= 50)
    .sort((a, b) => (b.score.ghost_rate ?? 0) - (a.score.ghost_rate ?? 0))
    .slice(0, 8)

  // Real "fastest responders" — lowest avg wait + high response among safe-ish companies.
  const responders = [...withReports]
    .filter(c => (c.score.response_rate ?? 0) >= 0.6 && reportsOf(c) >= 50)
    .sort((a, b) => (a.score.avg_wait_days ?? 0) - (b.score.avg_wait_days ?? 0))
    .slice(0, 8)

  return (
    <div className="page-full">
      <div style={wrap}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', textTransform: 'uppercase', letterSpacing: '.2em', color: 'var(--blue)', marginBottom: '.7rem', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 20, height: 1, background: 'var(--blue)', display: 'inline-block' }} />
          From the threads
        </div>
        <h1 style={{ fontFamily: 'var(--display)', fontSize: 'clamp(1.7rem,5.5vw,2.5rem)', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.03em', lineHeight: 1.08, margin: '0 0 .9rem' }}>
          Real hiring outcomes from Reddit
        </h1>
        <p style={{ color: 'var(--sub)', fontSize: 'var(--fs-body)', lineHeight: 1.75, fontWeight: 400, margin: '0 0 1.4rem' }}>
          You&apos;ve seen the threads: &ldquo;applied 3 weeks ago, total silence — does anyone know if they ghost?&rdquo; The problem is the answer is buried across a thousand comments. Seen turns those scattered reports into one number per company: a ghost rate, a response rate, and a Seen Grade. No login, no scraping your inbox — just what applicants actually reported.
        </p>
        <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap', margin: '0 0 2.6rem' }}>
          <Link href="/report" className="btn" style={{ background: 'linear-gradient(135deg,var(--g-start),var(--g-mid),var(--g-end))', color: '#fff', padding: '.7rem 1.3rem', fontWeight: 800 }}>Drop your outcome (60 sec)</Link>
          <Link href="/companies" className="btn btn-ghost" style={{ padding: '.7rem 1.3rem' }}>Search a company</Link>
        </div>

        {ghosters.length > 0 && (
          <section style={{ marginBottom: '2.6rem' }}>
            <h2 style={{ fontFamily: 'var(--display)', fontSize: 'var(--fs-lead)', fontWeight: 700, color: 'var(--white)', margin: '0 0 .3rem' }}>The ghosters (apply with your eyes open)</h2>
            <p style={{ color: 'var(--sub)', fontSize: 'var(--fs-sm)', lineHeight: 1.6, margin: '0 0 1rem', fontWeight: 400 }}>Highest reported ghost rates among companies with real report volume. Not a verdict — a heads-up.</p>
            {ghosters.map(c => (
              <CompanyRow key={c.name} name={c.name} score={c.score.overall_score!} ghostRate={c.score.ghost_rate!} responseRate={c.score.response_rate!} sub={`${reportsOf(c).toLocaleString()} reports · ${riskLabel(c.score.risk_level)}`} />
            ))}
          </section>
        )}

        {ghosters.length === 0 && responders.length === 0 && (
          <section style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 12, padding: '1.2rem 1.4rem', marginBottom: '2.6rem' }}>
            <p style={{ color: 'var(--sub)', fontSize: 'var(--fs-ui)', lineHeight: 1.7, margin: 0, fontWeight: 400 }}>
              No company has enough applicant-reported outcomes yet to rank here — we only list ghosters and responders backed by real report volume, never web estimates. <Link href="/report" style={{ color: 'var(--blue)' }}>Your report</Link> is how these lists fill in.
            </p>
          </section>
        )}

        {responders.length > 0 && (
          <section style={{ marginBottom: '2.6rem' }}>
            <h2 style={{ fontFamily: 'var(--display)', fontSize: 'var(--fs-lead)', fontWeight: 700, color: 'var(--white)', margin: '0 0 .3rem' }}>The fast responders (where applying pays off)</h2>
            <p style={{ color: 'var(--sub)', fontSize: 'var(--fs-sm)', lineHeight: 1.6, margin: '0 0 1rem', fontWeight: 400 }}>Shortest reported wait times among companies that actually reply. These are worth your time.</p>
            {responders.map(c => (
              <CompanyRow key={c.name} name={c.name} score={c.score.overall_score!} ghostRate={c.score.ghost_rate!} responseRate={c.score.response_rate!} sub={`avg ${Math.round(c.score.avg_wait_days ?? 0)}d wait · ${reportsOf(c).toLocaleString()} reports`} />
            ))}
          </section>
        )}

        <section style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 12, padding: '1.4rem 1.4rem' }}>
          <h2 style={{ fontFamily: 'var(--display)', fontSize: 'var(--fs-lead)', fontWeight: 700, color: 'var(--white)', margin: '0 0 .6rem' }}>Next time you&apos;d post a thread, do this instead</h2>
          <ul style={{ color: 'var(--sub)', fontSize: 'var(--fs-ui)', lineHeight: 1.8, fontWeight: 400, margin: 0, paddingLeft: '1.1rem' }}>
            <li><Link href="/companies" style={{ color: 'var(--blue)' }}>Search the company</Link> before you apply — see the ghost rate up front.</li>
            <li><Link href="/compare" style={{ color: 'var(--blue)' }}>Compare two companies</Link> head to head when you&apos;re deciding where to spend the effort.</li>
            <li><Link href="/tracker" style={{ color: 'var(--blue)' }}>Track your applications</Link> so you know exactly when silence becomes a ghost.</li>
            <li><Link href="/report" style={{ color: 'var(--blue)' }}>Report what happened</Link> — that&apos;s what makes the next person&apos;s search accurate.</li>
          </ul>
        </section>

        <p style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-meta)', color: 'var(--dim)', marginTop: '2rem', lineHeight: 1.7 }}>
          Seen Grades aggregate real applicant reports into a 0–100 signal. They&apos;re community signals, not verified facts, and update hourly as new reports come in.
        </p>
      </div>
    </div>
  )
}

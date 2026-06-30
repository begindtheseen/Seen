import type { Metadata } from 'next'
import Link from 'next/link'
import { getLeaderboard, titleCase, slugify, grade, riskColor, riskLabel } from '@/lib/growth'

// Reddit landing: "Real hiring outcomes from Reddit." Surfaces the worst ghosters and fastest
// responders from real leaderboard data, in Reddit-native voice, with tight internal links.

export const revalidate = 3600

export const metadata: Metadata = {
  title: 'Real Hiring Outcomes from Reddit — Who Ghosts, Who Responds | Seen',
  description: 'Tired of "does anyone know if X is ghosting" threads? Seen aggregates real applicant outcomes into ghost rates and response times for 47,000+ companies — the data those Reddit threads are missing.',
  keywords: ['reddit hiring', 'does anyone know if they ghost', 'reddit job application ghosted', 'companies that ghost applicants reddit', 'reddit recruiting', 'r/recruitinghell'],
  alternates: { canonical: 'https://seenjobs.io/reddit' },
  openGraph: { title: 'Real Hiring Outcomes from Reddit', description: 'Ghost rates and response times from real applicant reports — the data Reddit threads are missing.', url: 'https://seenjobs.io/reddit', type: 'website', siteName: 'Seen' },
  twitter: { card: 'summary_large_image', title: 'Real Hiring Outcomes from Reddit', description: 'Ghost rates and response times from real applicant reports.' },
}

const wrap = { maxWidth: 760, margin: '0 auto', padding: '3.5rem 1.25rem 5rem', width: '100%', boxSizing: 'border-box' as const }

function CompanyRow({ name, score, ghostRate, responseRate, sub }: { name: string; score: number; ghostRate: number; responseRate: number; sub: string }) {
  const accent = riskColor(score >= 70 ? 'safe' : score >= 40 ? 'warn' : 'danger')
  return (
    <Link href={`/company/${slugify(name)}`} style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '.85rem', background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10, padding: '.85rem 1rem', marginBottom: '.55rem' }}>
      <div style={{ fontFamily: 'var(--display)', fontSize: '1.5rem', fontWeight: 800, color: accent, width: 30, textAlign: 'center', flexShrink: 0 }}>{grade(score)}</div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontFamily: 'var(--display)', fontSize: '.92rem', fontWeight: 700, color: 'var(--white)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{titleCase(name)}</div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--dim)', marginTop: '.15rem' }}>{sub}</div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--red)' }}>{Math.round(ghostRate * 100)}% ghost</div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--green)' }}>{Math.round(responseRate * 100)}% reply</div>
      </div>
    </Link>
  )
}

export default async function RedditPage() {
  const board = await getLeaderboard()
  const withReports = board.filter(c => c.score.report_count > 0)

  // Real "worst ghosters" — highest ghost rate among companies with meaningful report volume.
  const ghosters = [...withReports]
    .filter(c => c.score.report_count >= 50)
    .sort((a, b) => b.score.ghost_rate - a.score.ghost_rate)
    .slice(0, 8)

  // Real "fastest responders" — lowest avg wait + high response among safe-ish companies.
  const responders = [...withReports]
    .filter(c => c.score.response_rate >= 0.6 && c.score.report_count >= 50)
    .sort((a, b) => a.score.avg_wait_days - b.score.avg_wait_days)
    .slice(0, 8)

  return (
    <div className="page-full">
      <div style={wrap}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', textTransform: 'uppercase', letterSpacing: '.2em', color: 'var(--blue)', marginBottom: '.7rem', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 20, height: 1, background: 'var(--blue)', display: 'inline-block' }} />
          From the threads
        </div>
        <h1 style={{ fontFamily: 'var(--display)', fontSize: 'clamp(1.7rem,5.5vw,2.5rem)', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.03em', lineHeight: 1.08, margin: '0 0 .9rem' }}>
          Real hiring outcomes from Reddit
        </h1>
        <p style={{ color: 'var(--sub)', fontSize: '.95rem', lineHeight: 1.75, fontWeight: 300, margin: '0 0 1.4rem' }}>
          You&apos;ve seen the threads: &ldquo;applied 3 weeks ago, total silence — does anyone know if they ghost?&rdquo; The problem is the answer is buried across a thousand comments. Seen turns those scattered reports into one number per company: a ghost rate, a response rate, and a Seen Grade. No login, no scraping your inbox — just what applicants actually reported.
        </p>
        <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap', margin: '0 0 2.6rem' }}>
          <Link href="/report" className="btn" style={{ background: 'linear-gradient(135deg,var(--g-start),var(--g-mid),var(--g-end))', color: '#fff', padding: '.7rem 1.3rem', fontWeight: 800 }}>Drop your outcome (60 sec)</Link>
          <Link href="/companies" className="btn btn-ghost" style={{ padding: '.7rem 1.3rem' }}>Search a company</Link>
        </div>

        {ghosters.length > 0 && (
          <section style={{ marginBottom: '2.6rem' }}>
            <h2 style={{ fontFamily: 'var(--display)', fontSize: '1.1rem', fontWeight: 700, color: 'var(--white)', margin: '0 0 .3rem' }}>The ghosters (apply with your eyes open)</h2>
            <p style={{ color: 'var(--sub)', fontSize: '.8rem', lineHeight: 1.6, margin: '0 0 1rem', fontWeight: 300 }}>Highest reported ghost rates among companies with real report volume. Not a verdict — a heads-up.</p>
            {ghosters.map(c => (
              <CompanyRow key={c.name} name={c.name} score={c.score.overall_score} ghostRate={c.score.ghost_rate} responseRate={c.score.response_rate} sub={`${c.score.report_count.toLocaleString()} reports · ${riskLabel(c.score.risk_level)}`} />
            ))}
          </section>
        )}

        {responders.length > 0 && (
          <section style={{ marginBottom: '2.6rem' }}>
            <h2 style={{ fontFamily: 'var(--display)', fontSize: '1.1rem', fontWeight: 700, color: 'var(--white)', margin: '0 0 .3rem' }}>The fast responders (where applying pays off)</h2>
            <p style={{ color: 'var(--sub)', fontSize: '.8rem', lineHeight: 1.6, margin: '0 0 1rem', fontWeight: 300 }}>Shortest reported wait times among companies that actually reply. These are worth your time.</p>
            {responders.map(c => (
              <CompanyRow key={c.name} name={c.name} score={c.score.overall_score} ghostRate={c.score.ghost_rate} responseRate={c.score.response_rate} sub={`avg ${Math.round(c.score.avg_wait_days)}d wait · ${c.score.report_count.toLocaleString()} reports`} />
            ))}
          </section>
        )}

        <section style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 12, padding: '1.4rem 1.4rem' }}>
          <h2 style={{ fontFamily: 'var(--display)', fontSize: '1.05rem', fontWeight: 700, color: 'var(--white)', margin: '0 0 .6rem' }}>Next time you&apos;d post a thread, do this instead</h2>
          <ul style={{ color: 'var(--sub)', fontSize: '.85rem', lineHeight: 1.8, fontWeight: 300, margin: 0, paddingLeft: '1.1rem' }}>
            <li><Link href="/companies" style={{ color: 'var(--blue)' }}>Search the company</Link> before you apply — see the ghost rate up front.</li>
            <li><Link href="/compare" style={{ color: 'var(--blue)' }}>Compare two companies</Link> head to head when you&apos;re deciding where to spend the effort.</li>
            <li><Link href="/tracker" style={{ color: 'var(--blue)' }}>Track your applications</Link> so you know exactly when silence becomes a ghost.</li>
            <li><Link href="/report" style={{ color: 'var(--blue)' }}>Report what happened</Link> — that&apos;s what makes the next person&apos;s search accurate.</li>
          </ul>
        </section>

        <p style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--dim)', marginTop: '2rem', lineHeight: 1.7 }}>
          Seen Grades aggregate real applicant reports into a 0–100 signal. They&apos;re community signals, not verified facts, and update hourly as new reports come in.
        </p>
      </div>
    </div>
  )
}

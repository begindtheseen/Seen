import type { Metadata } from 'next'
import Link from 'next/link'

// Niche landing page for people who just got ghosted (the r/recruitinghell audience):
// turn the worst moment of a job search into a data point that warns the next person.
// Static copy + ISR; the live numbers live on /agencies and /companies.

export const revalidate = 3600

export const metadata: Metadata = {
  title: 'Been Ghosted? Make It Count | Seen',
  description:
    'Ghosted after an application or interview? Report it in 2 minutes — anonymously. Your report updates a live ghost index of companies and staffing agencies, so the next applicant checks before they apply.',
  keywords: [
    'ghosted after interview', 'ghosted by recruiter', 'job application ghosted',
    'ghosted after final round', 'report ghosting', 'company ghosted me', 'staffing agency ghosted me',
  ],
  alternates: { canonical: 'https://seenjobs.io/ghosted' },
  openGraph: {
    title: 'Been ghosted? Make it count.',
    description: 'Report it in 2 minutes, anonymously. Your report updates a live ghost index the next applicant checks before applying.',
    url: 'https://seenjobs.io/ghosted',
    type: 'website',
    siteName: 'Seen',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Been ghosted? Make it count.',
    description: 'Report it in 2 minutes, anonymously — and put it on the record.',
  },
}

const wrap = { maxWidth: 720, margin: '0 auto', padding: '4rem 1.25rem 5rem', width: '100%', boxSizing: 'border-box' as const }

const STEPS = [
  {
    n: '01',
    title: 'Report it — 2 minutes, anonymous',
    body: 'Company, role, what happened. No account required, no personal data stored. If it was a staffing agency, even better — agencies are the least accountable layer of hiring.',
  },
  {
    n: '02',
    title: 'It goes on the record',
    body: 'Your report updates that company’s ghost rate and Seen Grade in real time, and feeds the Staffing Agency Ghost Index. One report is a data point; a thousand are a reputation.',
  },
  {
    n: '03',
    title: 'The next person checks first',
    body: 'Before their next application, job seekers look up the ghost rate the way you’d check reviews before a restaurant. Silence stops being free.',
  },
]

export default function GhostedPage() {
  return (
    <div className="page-full">
      <div style={wrap}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', textTransform: 'uppercase', letterSpacing: '.2em', color: 'var(--red)', marginBottom: '.7rem', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 20, height: 1, background: 'var(--red)', display: 'inline-block' }} />
          For the ghosted
        </div>
        <h1 style={{ fontFamily: 'var(--display)', fontSize: 'clamp(1.9rem,6.5vw,3rem)', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.03em', lineHeight: 1.06, margin: '0 0 1rem' }}>
          Been ghosted?<br />Make it count.
        </h1>
        <p style={{ color: 'var(--sub)', fontSize: '.98rem', lineHeight: 1.75, fontWeight: 300, margin: '0 0 1rem' }}>
          Three interviews. A take-home. &ldquo;We&apos;ll be in touch by Friday.&rdquo; Then nothing — not even a template rejection. You can vent about it in a thread that disappears by tomorrow, or you can put it on a record that doesn&apos;t.
        </p>
        <p style={{ color: 'var(--sub)', fontSize: '.85rem', lineHeight: 1.75, fontWeight: 300, margin: '0 0 1.6rem' }}>
          You&apos;re not the exception — Criteria Corp&apos;s 2026 hiring research found 53% of job seekers were ghosted in the past year. The only thing that changes it is making it visible, per company, per agency.
        </p>
        <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap', margin: '0 0 3rem' }}>
          <Link href="/report?outcome=ghosted" className="btn" style={{ background: 'linear-gradient(135deg,var(--g-start),var(--g-mid),var(--g-end))', color: '#fff', padding: '.75rem 1.4rem', fontWeight: 800 }}>Report your ghosting (2 min) →</Link>
          <Link href="/agencies" className="btn btn-ghost" style={{ padding: '.75rem 1.4rem' }}>See the Agency Ghost Index</Link>
        </div>

        <section style={{ marginBottom: '2.6rem' }}>
          {STEPS.map(s => (
            <div key={s.n} style={{ display: 'flex', gap: '1rem', background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 12, padding: '1.15rem 1.25rem', marginBottom: '.65rem' }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '.7rem', color: 'var(--blue)', fontWeight: 700, flexShrink: 0, paddingTop: '.15rem' }}>{s.n}</div>
              <div>
                <div style={{ fontFamily: 'var(--display)', fontSize: '.95rem', fontWeight: 700, color: 'var(--white)', marginBottom: '.3rem' }}>{s.title}</div>
                <p style={{ color: 'var(--sub)', fontSize: '.82rem', lineHeight: 1.7, fontWeight: 300, margin: 0 }}>{s.body}</p>
              </div>
            </div>
          ))}
        </section>

        <section style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 12, padding: '1.4rem', marginBottom: '2rem' }}>
          <h2 style={{ fontFamily: 'var(--display)', fontSize: '1.05rem', fontWeight: 700, color: 'var(--white)', margin: '0 0 .6rem' }}>Check before your next application</h2>
          <ul style={{ color: 'var(--sub)', fontSize: '.85rem', lineHeight: 1.8, fontWeight: 300, margin: 0, paddingLeft: '1.1rem' }}>
            <li><Link href="/agencies" style={{ color: 'var(--blue)' }}>The Staffing Agency Ghost Index</Link> — who replies, who disappears.</li>
            <li><Link href="/companies" style={{ color: 'var(--blue)' }}>Company ghost rates</Link> — look any employer up before you spend an evening on their portal.</li>
            <li><Link href="/tracker" style={{ color: 'var(--blue)' }}>Track your applications</Link> — know exactly when silence officially becomes a ghost.</li>
          </ul>
        </section>

        <p style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--dim)', lineHeight: 1.7 }}>
          Reports are anonymous and treated as claims, not verdicts — they&apos;re aggregated with confidence weighting into each company&apos;s score. That&apos;s what keeps the index fair, and worth checking.
        </p>
      </div>
    </div>
  )
}

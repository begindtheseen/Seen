import type { Metadata } from 'next'

type ScoreRow = {
  overall_score?: number
  ghost_rate?: number
  response_rate?: number
  avg_wait_days?: number
  report_count?: number
  risk_level?: 'safe' | 'warn' | 'danger'
  industry?: string
}

const titleCase = (slug: string) => slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

// Fetch the score via the public /api/reports endpoint — the SAME path the client uses and the
// one proven to work in production. (A direct Supabase REST call from this App Router server
// component was returning null in the Vercel runtime, which silently degraded the SEO/GEO
// description + summary; routing through the working serverless function fixes that.) Cached 1h
// and deduped across generateMetadata + the layout render within a request.
async function getScore(slug: string): Promise<ScoreRow | null> {
  try {
    const name = slug.replace(/-/g, ' ')
    const r = await fetch('https://seenjobs.io/api/reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
      next: { revalidate: 3600 },
    })
    if (!r.ok) return null
    const d = await r.json()
    const s = d?.score
    if (!s) return null
    return {
      overall_score: s.overall_score,
      ghost_rate: s.ghost_rate,
      response_rate: s.response_rate,
      avg_wait_days: s.avg_wait_days,
      report_count: s.report_count,
      risk_level: s.risk_level,
      industry: s.industry,
    }
  } catch {
    return null
  }
}

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> }
): Promise<Metadata> {
  const { slug } = await params
  const name = titleCase(slug)
  const s = await getScore(slug)
  const ghostPct = s?.ghost_rate != null ? Math.round(s.ghost_rate * 100) : null

  // Reddit-targeted: LLM/Google searches like "<company> hiring reddit" and "does <company>
  // ghost applicants" should land here. Real ghost % folded in when we have it.
  const description = ghostPct != null
    ? `Does ${name} ghost applicants? ${ghostPct}% ghost rate from real applicant outcomes. See ${name}'s response time, interview rounds, and hiring reviews — aggregated from Reddit, Glassdoor, and verified job-seeker reports.`
    : `Does ${name} ghost applicants? See ${name}'s ghost rate, response time, and hiring reviews — aggregated from Reddit, Glassdoor, and verified job-seeker reports on Seen.`

  return {
    title: `${name} Ghost Rate & Hiring Reviews (Reddit + Real Reports)`,
    description,
    keywords: [
      `${name} hiring`, `${name} ghosting`, `${name} reddit`, `does ${name} ghost applicants`,
      `${name} interview process`, `${name} hiring reviews`, `${name} glassdoor`, `${name} response time`,
    ],
    openGraph: {
      title: `${name} — Hiring Transparency Score`,
      description,
      type: 'website',
      siteName: 'Seen',
      url: `https://seenjobs.io/company/${slug}`,
    },
    twitter: {
      // summary_large_image so the dynamic 1200×630 opengraph-image.tsx renders full-bleed in
      // shares. The image itself is auto-attached by Next.js's file-based metadata convention.
      card: 'summary_large_image',
      title: `${name} Ghost Rate & Hiring Reviews`,
      description,
    },
    alternates: {
      canonical: `https://seenjobs.io/company/${slug}`,
    },
  }
}

const accentFor = (risk?: string): string =>
  risk === 'safe' ? 'var(--green)' : risk === 'danger' ? 'var(--red)' : 'var(--amber)'

// One-sentence plain-English read on the data, for crawlers and humans alike.
function interpret(s: ScoreRow): string {
  const ghost = s.ghost_rate != null ? s.ghost_rate : null
  const score = s.overall_score ?? 0
  if (ghost != null && ghost >= 0.6) return 'Most applicants never hear back, so set expectations accordingly and keep applying elsewhere.'
  if (score >= 80) return 'Applicants are largely kept in the loop, making this one of the more transparent hiring processes we track.'
  if (score >= 50) return 'Outcomes are mixed — some applicants get timely responses while others are left waiting.'
  return 'Hiring transparency here is below average based on the outcomes applicants have reported.'
}

export default async function CompanySlugLayout(
  { children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  const name = titleCase(slug)
  const s = await getScore(slug)

  const org: Record<string, unknown> = {
    '@type': 'Organization',
    name,
    url: `https://seenjobs.io/company/${slug}`,
  }
  if (s?.industry) org.industry = s.industry
  // Only assert an aggregateRating when we have REAL reports behind it.
  if (s && (s.report_count ?? 0) > 0 && s.overall_score != null) {
    org.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: (s.overall_score / 20).toFixed(1),
      bestRating: '5',
      worstRating: '0',
      ratingCount: s.report_count,
      reviewAspect: 'Hiring process and applicant response',
    }
  }

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Companies', item: 'https://seenjobs.io/companies' },
          { '@type': 'ListItem', position: 2, name, item: `https://seenjobs.io/company/${slug}` },
        ],
      },
      org,
    ],
  }

  // Server-rendered factual summary so AI answer engines (ChatGPT, Perplexity, Gemini) and
  // Google can read and cite real hiring data from the initial HTML — the client UI below
  // only hydrates after load. Rendered ONLY when we have a real score. Null-safe.
  const hasFacts = s != null && s.overall_score != null
  const accent = accentFor(s?.risk_level)
  const ghostPct = s?.ghost_rate != null ? Math.round(s.ghost_rate * 100) : null
  const respPct = s?.response_rate != null ? Math.round(s.response_rate * 100) : null
  const waitDays = s?.avg_wait_days != null ? Math.round(s.avg_wait_days) : null
  const reportCount = s?.report_count ?? 0
  const dataPoints = reportCount > 0 ? `${reportCount} applicant report${reportCount === 1 ? '' : 's'}` : 'estimated data'

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      {hasFacts && s && (
        <section
          aria-label={`${name} hiring data summary`}
          style={{
            maxWidth: 880,
            margin: '0 auto',
            padding: '1.4rem 1.25rem 0',
          }}
        >
          <div
            style={{
              background: 'var(--card)',
              border: '1px solid var(--line)',
              borderLeft: `3px solid ${accent}`,
              borderRadius: 12,
              padding: '1.1rem 1.25rem',
            }}
          >
            <h1
              style={{
                fontFamily: 'var(--display)',
                fontSize: '1.05rem',
                fontWeight: 700,
                color: 'var(--white)',
                letterSpacing: '-.01em',
                margin: '0 0 .55rem',
                lineHeight: 1.3,
              }}
            >
              {name} hiring data — Seen Grade {s.overall_score}/100
            </h1>
            <p
              style={{
                fontSize: '.86rem',
                lineHeight: 1.65,
                color: 'var(--sub)',
                margin: 0,
                fontWeight: 300,
              }}
            >
              {name} has a Seen Grade of{' '}
              <strong style={{ color: 'var(--white)', fontWeight: 600 }}>{s.overall_score}/100</strong>.{' '}
              {ghostPct != null && (
                <>Applicants report a{' '}
                  <strong style={{ color: accent, fontWeight: 600 }}>{ghostPct}% ghost rate</strong>
                  {respPct != null ? <> and a {respPct}% response rate</> : null}
                  {waitDays != null ? <>, with an average wait of {waitDays} day{waitDays === 1 ? '' : 's'} to hear back</> : null}
                  {' '}across {dataPoints}.{' '}
                </>
              )}
              {interpret(s)}
            </p>
            {/* Crawlable internal links to the new growth surfaces — present in initial HTML. */}
            <nav
              aria-label={`Explore ${name} hiring`}
              style={{ display: 'flex', flexWrap: 'wrap', gap: '.5rem 1rem', marginTop: '.85rem', paddingTop: '.85rem', borderTop: '1px solid var(--line)' }}
            >
              <a href={`/faq/does-${slug}-ghost-applicants`} style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--blue)', textDecoration: 'none' }}>Does {name} ghost applicants?</a>
              <a href={`/faq/${slug}-hiring-process`} style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--blue)', textDecoration: 'none' }}>{name} hiring process</a>
              <a href={`/compare?a=${encodeURIComponent(name)}`} style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--blue)', textDecoration: 'none' }}>Compare {name} vs another</a>
            </nav>
          </div>
        </section>
      )}
      {children}
    </>
  )
}

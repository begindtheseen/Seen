import type { Metadata } from 'next'

type ScoreRow = {
  overall_score?: number
  ghost_rate?: number
  response_rate?: number
  report_count?: number
  industry?: string
}

const titleCase = (slug: string) => slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

// Server-side fetch of the cached score (service key, never shipped to client). Cached 1h, and
// deduped across generateMetadata + the layout render within a request.
async function getScore(slug: string): Promise<ScoreRow | null> {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) return null
  try {
    const name = slug.replace(/-/g, ' ')
    const r = await fetch(
      `${url}/rest/v1/company_scores?company_name=ilike.${encodeURIComponent(name)}&select=overall_score,ghost_rate,response_rate,report_count,industry&limit=1`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` }, next: { revalidate: 3600 } }
    )
    if (!r.ok) return null
    const rows = await r.json()
    return (Array.isArray(rows) ? rows[0] : null) || null
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
      card: 'summary',
      title: `${name} Ghost Rate & Hiring Reviews`,
      description,
    },
    alternates: {
      canonical: `https://seenjobs.io/company/${slug}`,
    },
  }
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

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      {children}
    </>
  )
}

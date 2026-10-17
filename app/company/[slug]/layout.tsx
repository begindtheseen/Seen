import type { Metadata } from 'next'
// Build-safe score reader — reads the cached score DIRECTLY from Supabase and NEVER self-fetches
// the live https://seenjobs.io/api/reports (which had no build detection here and could hang
// `next build`). generateMetadata + the layout render below both go through this one helper.
import { getScore, firstPartyReportCount, displayCompanyName, type GrowthScore } from '@/lib/growth'
import { buildCompanyFaq } from '@/lib/server/companyFaq'
import { jsonLdHtml } from '@/lib/jsonLd'
// Offline, numerically-grounded "What applicants report" paragraph (company_summaries). No-op when the
// table is missing/empty or the read fails — the page renders exactly as before.
import { getCompanySummary, summaryMonth, type CompanySummary } from '@/lib/companySummary'

const titleCase = (slug: string) => slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
// Slug-mangled fallback only when no score row exists — the stored name keeps real punctuation
// ("lowe's" → "Lowe's", not "Lowe S"), and this name feeds the OG title + schema.org for shares.
const bestName = (slug: string, s: GrowthScore | null) =>
  s?.company_name ? displayCompanyName(s.company_name) : titleCase(slug)

// company_summaries is keyed by the STORED company_scores name; fall back to the slug decoded the one
// way the slug scheme allows (decodeURIComponent + hyphens → spaces).
function summaryKey(slug: string, s: GrowthScore | null): string {
  if (s?.company_name) return s.company_name
  let d = slug
  try { d = decodeURIComponent(slug) } catch { /* malformed escape — use the raw slug */ }
  return d.replace(/-/g, ' ')
}

// Meta descriptions are cut by search engines; keep whole sentences up to ~300 chars.
function clipSentences(text: string, max = 300): string {
  if (text.length <= max) return text
  const parts = text.split(/(?<=[.!?])\s+/)
  let out = ''
  for (const p of parts) {
    if ((out ? out.length + 1 : 0) + p.length > max) break
    out = out ? `${out} ${p}` : p
  }
  return out || `${text.slice(0, max - 1).trimEnd()}…`
}

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> }
): Promise<Metadata> {
  const { slug } = await params
  const s = await getScore(slug)
  const name = bestName(slug, s)
  const ghostPct = s?.ghost_rate != null ? Math.round(s.ghost_rate * 100) : null
  const summary = await getCompanySummary(summaryKey(slug, s))

  // Reddit-targeted: LLM/Google searches like "<company> hiring reddit" and "does <company>
  // ghost applicants" should land here. Real ghost % folded in when we have it. A grounded
  // company summary (same text as the visible paragraph) takes precedence when one exists.
  const description = summary
    ? clipSentences(summary.summary)
    : ghostPct != null
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
      // EXPLICIT stable image URL (no ?<buildhash> query). The file-convention auto-attach
      // rotates the og:image URL every deploy, so crawlers nearly always hit a COLD render —
      // and Reddit permanently caches "no preview" for a URL whose image misses its ~4s
      // budget. A stable URL keeps prior fetches warm across deploys.
      images: [{ url: `/company/${slug}/og`, width: 1200, height: 630, alt: 'Hiring transparency score on Seen' }],
    },
    twitter: {
      // summary_large_image so the dynamic 1200×630 card renders full-bleed in shares.
      card: 'summary_large_image',
      title: `${name} Ghost Rate & Hiring Reviews`,
      description,
      images: [`/company/${slug}/og`],
    },
    alternates: {
      canonical: `https://seenjobs.io/company/${slug}`,
    },
  }
}

const accentFor = (risk?: string): string =>
  risk === 'safe' ? 'var(--green)' : risk === 'danger' ? 'var(--red)' : 'var(--amber)'

// One-sentence plain-English read on the data, for crawlers and humans alike.
function interpret(s: GrowthScore): string {
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
  const s = await getScore(slug)
  const name = bestName(slug, s)
  const summary: CompanySummary | null = await getCompanySummary(summaryKey(slug, s))
  const pageUrl = `https://seenjobs.io/company/${slug}`

  const org: Record<string, unknown> = {
    '@type': 'Organization',
    '@id': `${pageUrl}#organization`,
    name,
    url: pageUrl,
  }
  if (s?.industry) org.industry = s.industry
  // Only assert an aggregateRating when we have REAL reports behind it. "Real" means
  // FIRST-PARTY rows (migration 063) — the fused report_count once fed the LLM's claimed
  // web-mention number into schema.org ratingCount, publishing a fabricated figure to Google.
  const fpSeo = firstPartyReportCount(s)
  if (s && fpSeo > 0 && s.overall_score != null) {
    org.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: (s.overall_score / 20).toFixed(1),
      bestRating: '5',
      worstRating: '0',
      ratingCount: fpSeo,
      reviewAspect: 'Hiring process and applicant response',
    }
  }

  // FAQ built ONLY from real data (percentages gated on first-party reports; grade Q always names
  // its basis). Backs both a FAQPage node AND the visible block below — the format AI answer engines
  // (ChatGPT, Perplexity, Gemini) cite for "does <company> ghost applicants?" queries. Empty → omitted.
  const faq = s
    ? buildCompanyFaq({
        name,
        overallScore: s.overall_score,
        ghostRate: s.ghost_rate,
        responseRate: s.response_rate,
        avgWaitDays: s.avg_wait_days,
        reportCount: fpSeo,
      })
    : []

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
      // The visible "What applicants report" paragraph, as the page description — the quotable,
      // sample-size-labelled summary. Present only when a grounded summary exists.
      ...(summary
        ? [{
            '@type': 'WebPage',
            '@id': pageUrl,
            url: pageUrl,
            name: `${name} hiring — what applicants report`,
            description: summary.summary,
            ...(summary.generated_at ? { dateModified: summary.generated_at } : {}),
            about: { '@id': `${pageUrl}#organization` },
          }]
        : []),
      ...(faq.length
        ? [{
            '@type': 'FAQPage',
            mainEntity: faq.map(f => ({
              '@type': 'Question',
              name: f.question,
              acceptedAnswer: { '@type': 'Answer', text: f.answer },
            })),
          }]
        : []),
    ],
  }

  // Server-rendered factual summary so AI answer engines (ChatGPT, Perplexity, Gemini) and
  // Google can read and cite real hiring data from the initial HTML — the client UI below
  // only hydrates after load. Rendered ONLY when we have a real score or a grounded company
  // summary (company_summaries, status 'ok'). Null-safe.
  const hasFacts = s != null && s.overall_score != null
  const accent = accentFor(s?.risk_level)
  const ghostPct = s?.ghost_rate != null ? Math.round(s.ghost_rate * 100) : null
  const respPct = s?.response_rate != null ? Math.round(s.response_rate * 100) : null
  const waitDays = s?.avg_wait_days != null ? Math.round(s.avg_wait_days) : null
  const reportCount = firstPartyReportCount(s)
  const dataPoints = reportCount > 0 ? `${reportCount} applicant report${reportCount === 1 ? '' : 's'}` : 'estimated data'
  const summaryDate = summary ? summaryMonth(summary.generated_at) : null
  const summaryBlock = summary ? (
    <div style={{ marginTop: hasFacts ? '.85rem' : 0, paddingTop: hasFacts ? '.85rem' : 0, borderTop: hasFacts ? '1px solid var(--line)' : 'none' }}>
      <h2 style={{ fontFamily: 'var(--display)', fontSize: '.86rem', fontWeight: 700, color: 'var(--white)', margin: '0 0 .4rem' }}>
        What applicants report about {name}
      </h2>
      <p style={{ fontSize: '.86rem', lineHeight: 1.65, color: 'var(--sub)', margin: 0, fontWeight: 300 }}>{summary.summary}</p>
      <p style={{ fontFamily: 'var(--mono)', fontSize: '.58rem', color: 'var(--sub)', margin: '.45rem 0 0', opacity: 0.85 }}>
        Based on {summary.data_basis || `${summary.report_count_at_generation} self-reported applicant reports`}
        {summaryDate ? ` · summary generated ${summaryDate}` : ''} · self-reported claims, not verified facts
      </p>
    </div>
  ) : null

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdHtml(jsonLd) }} />
      {/* Layout lives in .co-seo (globals.css): it clears the fixed 58px nav on desktop, and on
          phones it is visually ordered AFTER the interactive page (flex order) so a visitor lands
          on the score, not a wall of text — the HTML order crawlers read is unchanged. */}
      {(hasFacts || summary) && (
        <section className="co-seo" aria-label={`${name} hiring data summary`}>
          <div
            style={{
              background: 'var(--card)',
              border: '1px solid var(--line)',
              borderLeft: `3px solid ${accent}`,
              borderRadius: 12,
              padding: '1.1rem 1.25rem',
            }}
          >
            {hasFacts && s && (<>
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
            </>)}
            {summaryBlock}
            {/* Crawlable internal links to the new growth surfaces — present in initial HTML.
                Uses a div (not <nav>) on purpose: the global CSS `nav{position:fixed}` rule is
                for the site header only, and a <nav> here would get pinned to the top of the
                viewport and overlap the page. role="navigation" keeps the a11y semantics. */}
            <div
              role="navigation"
              aria-label={`Explore ${name} hiring`}
              style={{ display: 'flex', flexWrap: 'wrap', gap: '.5rem 1rem', marginTop: '.85rem', paddingTop: '.85rem', borderTop: '1px solid var(--line)' }}
            >
              <a href={`/faq/does-${slug}-ghost-applicants`} style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--blue)', textDecoration: 'none' }}>Does {name} ghost applicants?</a>
              <a href={`/faq/${slug}-hiring-process`} style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--blue)', textDecoration: 'none' }}>{name} hiring process</a>
              <a href={`/compare?a=${encodeURIComponent(name)}`} style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--blue)', textDecoration: 'none' }}>Compare {name} vs another</a>
            </div>
          </div>

          {/* Visible FAQ backing the FAQPage schema above (Google requires the schema's Q&A text to
              be present on the page). Server-rendered so AI answer engines cite the real numbers from
              the initial HTML. Real-data-gated — no fabricated rates. */}
          {faq.length > 0 && (
            <div style={{ marginTop: '1rem' }}>
              <h2 style={{ fontFamily: 'var(--display)', fontSize: '.9rem', fontWeight: 700, color: 'var(--white)', margin: '0 0 .7rem' }}>
                {name} hiring — frequently asked
              </h2>
              {faq.map(f => (
                <details key={f.question} style={{ borderTop: '1px solid var(--line)', padding: '.65rem 0' }}>
                  <summary style={{ cursor: 'pointer', fontFamily: 'var(--display)', fontSize: '.82rem', fontWeight: 600, color: 'var(--white)', listStyle: 'none' }}>
                    {f.question}
                  </summary>
                  <p style={{ fontSize: '.82rem', lineHeight: 1.65, color: 'var(--sub)', margin: '.5rem 0 0', fontWeight: 300 }}>{f.answer}</p>
                </details>
              ))}
            </div>
          )}
        </section>
      )}
      {children}
    </>
  )
}

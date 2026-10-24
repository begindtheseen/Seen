import type { Metadata } from 'next'
// Build-safe score reader — reads the cached score DIRECTLY from Supabase and NEVER self-fetches
// the live https://seenjobs.io/api/reports (which had no build detection here and could hang
// `next build`). generateMetadata + the layout render below both go through this one helper.
import { getScore, getScoreState, slugToName, displayCompanyName, type GrowthScore } from '@/lib/growth'
import { buildCompanyFaq } from '@/lib/server/companyFaq'
// Living search data (lib/server/searchOpportunities.js): the intents real searchers used for THIS company in
// the last 28 days lead its FAQ, each answered from the page's own facts. Returns [] on any failure.
import { topIntentsForCompany } from '@/lib/server/searchOpportunities.js'
import { mergeIntentFaq } from '@/lib/server/intentAnswers.js'
import { jsonLdHtml } from '@/lib/jsonLd'
// Offline, numerically-grounded "What applicants report" paragraph (company_summaries). No-op when the
// table is missing/empty or the read fails — the page renders exactly as before.
import { getCompanySummary, summaryMonth, type CompanySummary } from '@/lib/companySummary'
import { isStaffingAgency } from '@/lib/agencies'
// ONE set of facts for everything this file publishes (lib/companyMeta.ts): the meta description, the
// JSON-LD nodes, the H1 paragraph and the FAQ read the same count, rates and grade as the page and the
// OG card. Audit 2026-10-24 (L-1): the description said 62 / 73% / 81 while the H1 said 48 / 87% / 91.
import { companyMetaFacts, companyRobots } from '@/lib/companyMeta'

const titleCase = (slug: string) => slugToName(slug).replace(/\b\w/g, c => c.toUpperCase())
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

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> }
): Promise<Metadata> {
  const { slug } = await params
  const { score: s, ok: scoreRead } = await getScoreState(slug)
  const name = bestName(slug, s)
  // The stored paragraph (company_summaries) is quoted only while its numbers still match the live
  // score; otherwise the description is built from the same facts the page shows (lib/companyMeta.ts).
  const summary = s?.gradeable ? await getCompanySummary(summaryKey(slug, s)) : null
  const facts = companyMetaFacts(name, s, summary)
  // "Walmart application status: who hears back (48 reports)" + "87% of applicants hear back from Walmart;
  // 13% never do. …" (lib/cardCopy.js via companyMetaFacts): the same facts as the page, never "Hiring
  // Transparency Score" (owner 2026-10-24), no dashes.
  const { title, description } = facts

  return {
    title,
    description,
    keywords: [
      `${name} application status`, `${name} hiring process`, `${name} hiring`, `${name} response time`,
      `${name} interview process`, `does ${name} ghost applicants`,
      ...(isStaffingAgency(s?.company_name ?? name) ? [`is ${name} legit`] : []),
    ],
    // No grade → noindex, follow (only when the score read succeeded; lib/companyMeta.ts companyRobots).
    ...companyRobots(facts.gradeable, scoreRead),
    openGraph: {
      title,
      description,
      type: 'website',
      siteName: 'Seen',
      url: `https://seenjobs.io/company/${slug}`,
      // EXPLICIT stable image URL (no ?<buildhash> query). The file-convention auto-attach
      // rotates the og:image URL every deploy, so crawlers nearly always hit a COLD render —
      // and Reddit permanently caches "no preview" for a URL whose image misses its ~4s
      // budget. A stable URL keeps prior fetches warm across deploys.
      images: [{ url: `/company/${slug}/og`, width: 1200, height: 630, alt: `${name} on Seen: who replies, who ghosts` }],
    },
    twitter: {
      // summary_large_image so the dynamic 1200×630 card renders full-bleed in shares.
      card: 'summary_large_image',
      title,
      description,
      images: [`/company/${slug}/og`],
    },
    alternates: {
      canonical: `https://seenjobs.io/company/${slug}`,
    },
  }
}

const accentFor = (risk?: string | null): string =>
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
  const storedSummary: CompanySummary | null = s?.gradeable ? await getCompanySummary(summaryKey(slug, s)) : null
  const facts = companyMetaFacts(name, s, storedSummary)
  // A frozen paragraph whose numbers no longer match the live score is not shown or published.
  const summary = facts.summaryUsable ? storedSummary : null
  const pageUrl = `https://seenjobs.io/company/${slug}`

  // No aggregateRating: a Seen Grade is Seen's own assessment, not a rating anyone gave the company
  // or Seen, and a self-asserted Organization rating is an ineligible / spam signal for search engines
  // (money/legal audit 2026-10-24, L-1). The grade is published in the FAQPage answers and the H1.
  const org: Record<string, unknown> = {
    '@type': 'Organization',
    '@id': `${pageUrl}#organization`,
    name,
    url: pageUrl,
  }
  if (s?.industry) org.industry = s.industry
  const fpSeo = facts.reportCount

  // FAQ built ONLY from the same facts (percentages only with MIN_REPORTS_FOR_RATES applicant reports;
  // the grade Q always names its basis). Backs both a FAQPage node AND the visible block below — the
  // format AI answer engines (ChatGPT, Perplexity, Gemini) cite for "does <company> ghost applicants?".
  const baseFaq = s
    ? buildCompanyFaq({
        name,
        overallScore: facts.score,
        ghostRate: facts.ratesShown ? s.ghost_rate : null,
        responseRate: facts.ratesShown ? s.response_rate : null,
        avgWaitDays: facts.waitDays,
        reportCount: fpSeo,
        mentionCount: facts.mentions,
        isAgency: isStaffingAgency(s.company_name ?? name),
      })
    : []
  const searched = facts.gradeable ? await topIntentsForCompany(s?.company_name || name) : []
  const faq = mergeIntentFaq(baseFaq, facts, searched, { avgRounds: s?.avg_rounds ?? null })

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
  const hasFacts = facts.gradeable && s != null
  const accent = accentFor(s?.risk_level)
  // Same numbers as the meta description, the FAQ and the page (lib/companyMeta.ts): rates only with
  // enough applicant reports, first-party count only.
  const ghostPct = facts.ghostPct
  const respPct = facts.respPct
  const waitDays = facts.waitDays
  const reportCount = fpSeo
  const dataPoints = reportCount > 0 ? facts.basis : 'estimated data'
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
          {/* Collapsed by default (native <details>, no JS): the numbers are already on the page above;
              this is the citable prose + FAQ for people and crawlers who want the long form. */}
          <details className="co-seo-details">
            <summary className="co-seo-summary">
              <span className="co-seo-ico" aria-hidden>📄</span>
              <span className="co-seo-txt">
                <span className="co-seo-ttl">About {name}&apos;s hiring data</span>
                <span className="co-seo-sub">{hasFacts && s ? `Seen Grade ${facts.grade} · ${facts.score}/100 in plain English` : 'What applicants report'}{faq.length > 0 ? ` · ${faq.length} frequently asked questions` : ''}</span>
              </span>
              <span className="co-seo-chev" aria-hidden />
            </summary>
          <div
            style={{
              background: 'var(--card)',
              border: '1px solid var(--line)',
              borderLeft: `3px solid ${accent}`,
              borderRadius: 12,
              padding: '1.1rem 1.25rem',
              marginTop: '.6rem',
            }}
          >
            {hasFacts && s && (<>
            <h2
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
              {name} hiring data — Seen Grade {facts.grade} · {facts.score}/100
            </h2>
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
              <strong style={{ color: 'var(--white)', fontWeight: 600 }}>{facts.grade} · {facts.score}/100</strong>
              {' '}from {dataPoints}.{' '}
              {ghostPct != null && (
                <>Applicants report a{' '}
                  <strong style={{ color: accent, fontWeight: 600 }}>{ghostPct}% ghost rate</strong>
                  {respPct != null ? <> and a {respPct}% response rate</> : null}
                  {waitDays != null ? <>, with an average wait of {waitDays} day{waitDays === 1 ? '' : 's'} to hear back</> : null}
                  .{' '}
                </>
              )}
              {ghostPct == null && <>Too few applicant reports yet for a response or ghost rate. </>}
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
              {/* The hiring-process and application-status questions are answered in the FAQ below; the
                  old /faq/<x> pages now point their canonical here, so they are not linked. */}
              <a href="/methods" style={{ fontFamily: 'var(--mono)', fontSize: '.62rem', color: 'var(--blue)', textDecoration: 'none' }}>How grades work</a>
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
          </details>
        </section>
      )}
      {children}
    </>
  )
}

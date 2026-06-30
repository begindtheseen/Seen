import type { Metadata } from 'next'
import Link from 'next/link'
import { getScore, titleCase, pct } from '@/lib/growth'
import ComparePicker from '../ComparePicker'
import CompareView from '../CompareView'

// SEO comparison page: /compare/amazon-vs-google → "Amazon vs Google hiring" intent.
export const revalidate = 3600
export const dynamicParams = true

// Split "amazon-vs-google" → ["amazon","google"]. Handles multi-word slugs by splitting on "-vs-".
function parse(slugs: string): [string, string] | null {
  const s = decodeURIComponent(slugs).toLowerCase()
  const idx = s.indexOf('-vs-')
  if (idx <= 0) return null
  const a = s.slice(0, idx).trim()
  const b = s.slice(idx + 4).trim()
  if (!a || !b) return null
  return [a, b]
}

export async function generateMetadata({ params }: { params: Promise<{ slugs: string }> }): Promise<Metadata> {
  const { slugs } = await params
  const parsed = parse(slugs)
  if (!parsed) return { title: 'Compare Company Hiring — Seen' }
  const aName = titleCase(parsed[0]), bName = titleCase(parsed[1])
  const url = `https://seenjobs.io/compare/${slugs}`
  const title = `${aName} vs ${bName} Hiring: Ghost Rate & Response Time Compared`
  const description = `${aName} vs ${bName} — which treats applicants better? Compare ghost rate, response rate, average wait, and Seen Grade side by side from real applicant reports.`
  return {
    title, description,
    keywords: [`${aName} vs ${bName} hiring`, `${aName} or ${bName}`, `${aName} vs ${bName} ghost rate`, `which is better ${aName} ${bName}`, `${aName} ${bName} interview process`],
    alternates: { canonical: url },
    openGraph: { title, description, url, type: 'website', siteName: 'Seen' },
    twitter: { card: 'summary_large_image', title, description },
  }
}

const wrap = { maxWidth: 760, margin: '0 auto', padding: '3.5rem 1.25rem 5rem', width: '100%', boxSizing: 'border-box' as const }

export default async function CompareSlugsPage({ params }: { params: Promise<{ slugs: string }> }) {
  const { slugs } = await params
  const parsed = parse(slugs)
  if (!parsed) {
    return (
      <div className="page-full"><div style={wrap}>
        <h1 style={{ fontFamily: 'var(--display)', fontWeight: 800, color: 'var(--white)' }}>Compare companies</h1>
        <p style={{ color: 'var(--sub)' }}>Use the format <code>/compare/amazon-vs-google</code>, or <Link href="/compare" style={{ color: 'var(--blue)' }}>pick two companies</Link>.</p>
      </div></div>
    )
  }
  const [aSlug, bSlug] = parsed
  const aName = titleCase(aSlug), bName = titleCase(bSlug)
  const [a, b] = await Promise.all([getScore(aSlug), getScore(bSlug)])

  // JSON-LD: factual comparison answer for AI engines.
  const answer = (a && b)
    ? `${a.overall_score >= b.overall_score ? aName : bName} has the higher hiring transparency grade (${Math.max(a.overall_score, b.overall_score)}/100 vs ${Math.min(a.overall_score, b.overall_score)}/100).`
    : `Not enough applicant reports yet to compare ${aName} and ${bName} fully.`
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: [{
      '@type': 'Question',
      name: `${aName} vs ${bName}: which treats applicants better?`,
      acceptedAnswer: { '@type': 'Answer', text: answer },
    }],
  }

  return (
    <div className="page-full">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <div style={wrap}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', textTransform: 'uppercase', letterSpacing: '.2em', color: 'var(--blue)', marginBottom: '.7rem', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 20, height: 1, background: 'var(--blue)', display: 'inline-block' }} />
          Compare
        </div>
        <h1 style={{ fontFamily: 'var(--display)', fontSize: 'clamp(1.5rem,5vw,2.2rem)', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.03em', lineHeight: 1.1, margin: '0 0 .7rem' }}>
          {aName} vs {bName}: hiring transparency
        </h1>
        <p style={{ color: 'var(--sub)', fontSize: '.92rem', lineHeight: 1.7, fontWeight: 300, margin: '0 0 2rem' }}>
          {answer} {(a && b && pct(a.ghost_rate) != null && pct(b.ghost_rate) != null) ? `Ghost rates: ${aName} ${pct(a.ghost_rate)}% vs ${bName} ${pct(b.ghost_rate)}%.` : 'Add your experience to fill the gaps.'}
        </p>

        <CompareView aName={aName} a={a} bName={bName} b={b} />

        <div style={{ marginTop: '2.5rem' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', textTransform: 'uppercase', letterSpacing: '.12em', color: 'var(--blue)', marginBottom: '1rem', paddingBottom: '.5rem', borderBottom: '1px solid var(--line)' }}>
            Compare a different pair
          </div>
          <ComparePicker initialA={aName} initialB={bName} />
        </div>

        <p style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--dim)', marginTop: '1.5rem', lineHeight: 1.7 }}>
          Seen Grades are community signals from applicant reports, not verified facts. Track your application in the <Link href="/tracker" style={{ color: 'var(--blue)' }}>tracker</Link> or <Link href="/report" style={{ color: 'var(--blue)' }}>report an outcome</Link>.
        </p>
      </div>
    </div>
  )
}

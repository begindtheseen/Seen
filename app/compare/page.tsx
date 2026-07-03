import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { getLeaderboard, titleCase, slugify } from '@/lib/growth'
import ComparePicker, { CompareQuery } from './ComparePicker'

// Compare tool landing — fully STATIC (revalidated hourly). This server component must never
// read searchParams: `await searchParams` on a revalidated page is a dynamic-usage error that
// fails/wedges `next build` static generation. Query handling for the old ?a=&b= deep links
// lives in the CLIENT ComparePicker (useSearchParams inside the Suspense boundary below):
// one param prefills the picker; both params redirect to the canonical SEO route
// /compare/[a]-vs-[b], which remains the real comparison page.

export const revalidate = 3600

export const metadata: Metadata = {
  title: 'Compare Company Hiring: Ghost Rates Side by Side — Seen',
  description: 'Compare any two companies side by side on hiring transparency — ghost rate, response rate, average wait, and Seen Grade — from real applicant reports. Decide where to apply.',
  keywords: ['compare company hiring', 'ghost rate comparison', 'which company responds faster', 'company hiring comparison', 'compare ghost rates'],
  alternates: { canonical: 'https://seenjobs.io/compare' },
  openGraph: { title: 'Compare Company Hiring Side by Side', description: 'Ghost rate, response rate, and Seen Grade for any two companies — from real applicant reports.', url: 'https://seenjobs.io/compare', type: 'website', siteName: 'Seen' },
  twitter: { card: 'summary_large_image', title: 'Compare Company Hiring Side by Side', description: 'Ghost rate, response rate, and Seen Grade for any two companies.' },
}

const wrap = { maxWidth: 760, margin: '0 auto', padding: '3.5rem 1.25rem 5rem', width: '100%', boxSizing: 'border-box' as const }

export default async function ComparePage() {
  const board = await getLeaderboard()

  // Real, interesting matchups: pair adjacent leaderboard companies in the same industry-ish band.
  const top = board.slice(0, 12)
  const matchups: [string, string][] = []
  for (let i = 0; i + 1 < top.length && matchups.length < 6; i += 2) {
    matchups.push([titleCase(top[i].name), titleCase(top[i + 1].name)])
  }

  return (
    <div className="page-full">
      <div style={wrap}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', textTransform: 'uppercase', letterSpacing: '.2em', color: 'var(--blue)', marginBottom: '.7rem', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 20, height: 1, background: 'var(--blue)', display: 'inline-block' }} />
          Compare
        </div>
        <h1 style={{ fontFamily: 'var(--display)', fontSize: 'clamp(1.6rem,5vw,2.3rem)', fontWeight: 800, color: 'var(--white)', letterSpacing: '-.03em', lineHeight: 1.1, margin: '0 0 .7rem' }}>
          Compare hiring, side by side
        </h1>
        <p style={{ color: 'var(--sub)', fontSize: '.95rem', lineHeight: 1.7, fontWeight: 300, margin: '0 0 2rem' }}>
          Two companies, head to head — ghost rate, response rate, average wait, and Seen Grade, all from real applicant reports. Pick where your application actually has a chance.
        </p>

        {/* useSearchParams lives in CompareQuery — the Suspense boundary keeps this page static. */}
        <Suspense fallback={<ComparePicker />}>
          <CompareQuery />
        </Suspense>

        <div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '.55rem', textTransform: 'uppercase', letterSpacing: '.12em', color: 'var(--blue)', marginBottom: '1rem', paddingBottom: '.5rem', borderBottom: '1px solid var(--line)' }}>
            Popular matchups
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.6rem' }}>
            {matchups.map(([x, y]) => (
              <Link key={`${x}-${y}`} href={`/compare/${slugify(x)}-vs-${slugify(y)}`} className="btn btn-ghost" style={{ fontSize: '.74rem', padding: '.55rem .9rem' }}>
                {x} vs {y}
              </Link>
            ))}
          </div>
        </div>

        <p style={{ fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--dim)', marginTop: '2.5rem', lineHeight: 1.7 }}>
          Seen Grades are aggregated community signals from applicant reports, not verified facts. Browse all <Link href="/companies" style={{ color: 'var(--blue)' }}>companies</Link>.
        </p>
      </div>
    </div>
  )
}

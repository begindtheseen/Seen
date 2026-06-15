import type { Metadata } from 'next'

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> }
): Promise<Metadata> {
  const { slug } = await params
  const name = slug
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())

  return {
    title: `${name} Ghost Rate & Hiring Score | Seen`,
    description: `Real ghost rate, response time, and applicant outcomes for ${name}. Based on verified applicant data from real job seekers.`,
    openGraph: {
      title: `${name} — Hiring Transparency Score`,
      description: `Does ${name} ghost applicants? See real ghost rates, interview timelines, and outcome data from verified applicants on Seen.`,
      type: 'website',
      siteName: 'Seen',
    },
    twitter: {
      card: 'summary',
      title: `${name} Ghost Rate & Hiring Score`,
      description: `Real applicant outcomes and ghost rate data for ${name}.`,
    },
    alternates: {
      canonical: `https://seenjobs.io/company/${slug}`,
    },
  }
}

export default function CompanySlugLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}

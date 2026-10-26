import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'

// The listing page is a client component; this layout gives each listing URL its own canonical and a
// plain title (the client renders the real job title once it loads).
//
// Search plan 2026-10-24: ~80,000 short-lived listing pages would dilute the company pages (the
// pages people search for) and are the kind of scaled, near-duplicate content Google demotes. Listing
// pages stay usable and shareable, but are kept out of the index; links on them are still followed.
// They are not in the sitemap (app/sitemap.ts). The search page /jobs stays indexable.
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  return {
    ...pageMetadata({
      title: 'Job listing',
      description: 'A job listing with the company’s applicant response record next to it.',
      path: `/jobs/${encodeURIComponent(id)}`,
    }),
    robots: { index: false, follow: true },
  }
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}

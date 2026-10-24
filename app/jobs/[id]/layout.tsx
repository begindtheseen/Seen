import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'

// The listing page is a client component; this layout gives each listing URL its own canonical and a
// plain title (the client renders the real job title once it loads).
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  return pageMetadata({
    title: 'Job Listing',
    description: 'A job listing with the company’s applicant response record next to it.',
    path: `/jobs/${encodeURIComponent(id)}`,
  })
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}

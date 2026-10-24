import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'

// The page is a client component, which cannot export metadata; this layout carries the route's own
// title, description and canonical (audit 2026-10-24: it inherited the homepage's and declared itself a
// duplicate of /). Rendering is untouched.
export const metadata: Metadata = pageMetadata({
  title: 'Job Search — Listings Scored for Transparency',
  description: 'Search open jobs and see, next to each listing, whether the company responds to applicants, how long it takes, and whether the pay is disclosed — before you spend an hour applying.',
  path: '/jobs',
  ogTitle: 'Job Search on Seen',
})

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}

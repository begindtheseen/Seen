import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'

// The page is a client component, which cannot export metadata; this layout carries the route's own
// title, description and canonical (audit 2026-10-24: it inherited the homepage's and declared itself a
// duplicate of /). Rendering is untouched.
export const metadata: Metadata = pageMetadata({
  title: 'Live Feed — Latest Applicant Reports',
  description: 'The newest hiring outcomes applicants have reported to Seen, company by company, as they come in.',
  path: '/feed',
})

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}

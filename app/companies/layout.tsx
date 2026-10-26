import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'

// The page is a client component, which cannot export metadata; this layout carries the route's own
// title, description and canonical (audit 2026-10-24: it inherited the homepage's and declared itself a
// duplicate of /). Rendering is untouched.
export const metadata: Metadata = pageMetadata({
  title: 'Company Scoreboard — Ghost Rates & Hiring Grades',
  description: 'Every company Seen grades, ranked by real applicant accounts: ghost rate, response rate, average wait and a letter grade. Look up any company before you apply.',
  path: '/companies',
  ogTitle: 'Company Scoreboard',
})

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}

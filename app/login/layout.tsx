import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'

// The page is a client component, which cannot export metadata; this layout carries the route's own
// title, description and canonical (audit 2026-10-24: it inherited the homepage's and declared itself a
// duplicate of /). Rendering is untouched.
export const metadata: Metadata = pageMetadata({
  title: 'Sign In or Create a Free Account',
  description: 'Sign in to Seen or create a free job-seeker account to track applications, save jobs and check companies before you apply.',
  path: '/login',
})

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}

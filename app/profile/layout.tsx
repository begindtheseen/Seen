import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'

// The page is a client component, which cannot export metadata; this layout carries the route's own
// title, description and canonical (audit 2026-10-24: it inherited the homepage's and declared itself a
// duplicate of /). Rendering is untouched.
export const metadata: Metadata = pageMetadata({
  title: 'Profile & Settings',
  description: 'Your account, résumé, notifications and security settings.',
  path: '/profile',
  noindex: true,
})

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}

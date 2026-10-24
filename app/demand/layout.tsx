import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'

// The page is a client component, which cannot export metadata; this layout carries the route's own
// title, description and canonical (audit 2026-10-24: it inherited the homepage's and declared itself a
// duplicate of /). Rendering is untouched.
export const metadata: Metadata = pageMetadata({
  title: 'Hiring Demand by City',
  description: 'Which cities and roles are hiring right now, modeled from live listings and public labor data, with the figures labeled as estimates.',
  path: '/demand',
})

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}

import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'

// The page is a client component, which cannot export metadata; this layout carries the route's own
// title, description and canonical (audit 2026-10-24: it inherited the homepage's and declared itself a
// duplicate of /). Rendering is untouched.
export const metadata: Metadata = pageMetadata({
  title: 'Pricing — Seen Pro with a 7-day free trial',
  description: 'Seen is free for job seekers. Pro adds unlimited AI credits, Human Voice rewrites and résumé downloads without the Seen footer — 7 days free, no card required, then a monthly or yearly plan. Every price on one page.',
  path: '/pricing',
  ogTitle: 'Seen Pricing',
})

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}

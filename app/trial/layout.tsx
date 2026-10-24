import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'

// The page is a client component, which cannot export metadata. A hand-off page (sign-up → Stripe
// Checkout), so it stays out of search.
export const metadata: Metadata = pageMetadata({
  title: 'Start Your Free Trial',
  description: 'Start your Seen Pro free trial. No card needed.',
  path: '/trial',
  noindex: true,
})

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}

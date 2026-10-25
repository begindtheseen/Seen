import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'
import { ONE_TIME_SKUS, skuPrice } from '@/lib/server/creditRules.js'

// The page is a client component, which cannot export metadata; this layout carries the route's own
// title, description and canonical. Prices render from lib/server/creditRules.js like every surface.
export const metadata: Metadata = pageMetadata({
  title: `Pricing — free to search, ${ONE_TIME_SKUS.interview.name} when they call you in`,
  description: `Seen is free for job seekers: company grades, the tracker, job search and résumé match, no card. ${ONE_TIME_SKUS.interview.name} is ${skuPrice('interview')} for one interview; the ${ONE_TIME_SKUS.pass30.name} is ${skuPrice('pass30')} for ${ONE_TIME_SKUS.pass30.pro_days} days of everything. Both are one-time and never renew.`,
  path: '/pricing',
  ogTitle: 'Seen Pricing',
})

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}

import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'

export const metadata: Metadata = pageMetadata({
  title: 'Admin (legacy)',
  description: 'Seen administration — the previous admin, kept until the new one is accepted.',
  path: '/admin/legacy',
  noindex: true,
})

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}

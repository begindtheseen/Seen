import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'

export const metadata: Metadata = pageMetadata({
  title: 'Résumé Studio',
  description: 'Score your résumé, fix every weak bullet without inventing a word, tailor it to a job from your own facts, and export ATS-safe PDF, Word, text, Markdown or JSON Resume in three templates.',
  path: '/resume/studio',
})

export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return children
}

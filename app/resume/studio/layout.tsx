import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Résumé Studio — Seen',
  description: 'Score your résumé, fix every weak bullet without inventing a word, tailor it to a job from your own facts, and export ATS-safe PDF, Word, text, Markdown or JSON Resume in three templates.',
  alternates: { canonical: 'https://seenjobs.io/resume/studio' },
}

export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return children
}

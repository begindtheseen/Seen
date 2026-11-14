import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import PageHeader from '@/components/shell/PageHeader'
import GuidePage, { type GuideContent } from '@/components/start/GuidePage'
import { pageMetadata } from '@/lib/seo'
import { START_GUIDES, startGuide } from '@/lib/start/guides.js'
import { guideContent } from '@/lib/start/registry.js'

// /start/<field> — one template for every start guide (components/start/GuidePage.tsx). Only LIVE guides have a
// route (lib/start/guides.js START_GUIDES ↔ lib/start/registry.js); any other segment is a 404, never a page
// without content. /start/oilfield and /start/trades keep their URLs.

export const dynamicParams = false

export function generateStaticParams() {
  return START_GUIDES.map((g) => ({ field: g.field }))
}

type Props = { params: Promise<{ field: string }> }

function load(field: string) {
  const content = startGuide(field) ? guideContent(field) : null
  return content as (GuideContent & { guide: GuideContent['guide'] & { path: string; crumbLabel: string; eyebrow: string; metaDescription: string; answer: { text: string } } }) | null
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { field } = await params
  const c = load(field)
  if (!c) return {}
  return pageMetadata({ title: c.guide.title, description: c.guide.metaDescription, path: c.guide.path, ogTitle: c.guide.title })
}

export default async function StartGuidePage({ params }: Props) {
  const { field } = await params
  const c = load(field)
  if (!c) notFound()
  return (
    <GuidePage
      content={c}
      header={
        <PageHeader
          size="lg"
          eyebrow={c.guide.eyebrow}
          title={c.guide.title}
          crumbs={[{ href: '/jobs', label: 'Jobs' }]}
          crumbLabel={c.guide.crumbLabel}
          sub={c.guide.answer.text}
        />
      }
    />
  )
}

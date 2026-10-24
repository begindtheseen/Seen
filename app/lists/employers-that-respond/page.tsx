import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo'
import { getOpenDataset } from '@/lib/server/openDataRead'
import { buildList } from '@/lib/openDataset'
import ListView from '@/components/data/ListView'
import ListUnavailable from '@/components/data/ListUnavailable'

// Monthly list built from the open dataset snapshot (lib/openDataset.ts buildList). Rendered per request
// from the 1-hour cached snapshot (lib/server/openDataRead.ts) so a failed read is never frozen in.
export const dynamic = 'force-dynamic'

const SLUG = 'employers-that-respond' as const

export async function generateMetadata(): Promise<Metadata> {
  const d = await getOpenDataset()
  const l = d ? buildList(SLUG, d) : null
  return pageMetadata({
    title: l ? l.title : 'Employers that respond to applicants',
    description: l ? l.description : 'A monthly ranking from applicant reports on Seen.',
    path: `/lists/${SLUG}`,
  })
}

export default async function Page() {
  const d = await getOpenDataset()
  if (!d) return <ListUnavailable />
  return <ListView l={buildList(SLUG, d)} attribution={d.attribution} />
}

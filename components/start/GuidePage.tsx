/**
 * THE start-guide template (/start/<field>): every guide is a data module (lib/start/registry.js) rendered here.
 * First screen: the header (passed in by the route), one quiet "Updated" line, three readings, then the live
 * listings with filters tailored to the field. Everything else is one tap away in openable rows, ending with the
 * grouped "Additional resources" links. No filled button; one <h1> (the header's). Server component — the listings
 * block and the #hash opener are the only client parts.
 */
import type { ReactNode } from 'react'
import { jsonLdHtml } from '@/lib/jsonLd'
import { updatedLine } from '@/lib/start/guides.js'
import { Blocks, MenuRow, Resources, Tiles, faqJsonLd, resourcesSummary, type Block, type Entry, type Source } from './Guide'
import ListingFinder, { type ListingsConfig } from './ListingFinder'
import MenuHash from './MenuHash'
import st from './guide.module.css'

export type GuideContent = {
  guide: { asOf: string; title: string }
  tiles: Array<{ label: string; value: string; text: string }>
  listings: ListingsConfig
  menu: Array<{ id: string; title: string; summary: string; icon?: 'caution'; blocks: Block[] }>
  faq: Array<{ q: string; a: Entry }>
  sources: Record<string, Source>
  resources: Array<{ title: string; items: Array<{ key: string; name: string }> }>
  /** One line for the resources row (else built from the group titles). */
  resourcesSummary?: string
}

export default function GuidePage({ content, header }: { content: GuideContent; header: ReactNode }) {
  const { guide, tiles, listings, menu, faq, sources, resources } = content
  return (
    <div className="page-full">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdHtml(faqJsonLd(faq)) }} />
      <MenuHash />
      <div className={st.wrap}>
        <div className={st.hero}>
          {header}
          <p className={st.updated}>{updatedLine(guide.asOf)}</p>
          <Tiles tiles={tiles} />
        </div>

        <section id="listings" className={st.listings} aria-labelledby="listings-h">
          <h2 id="listings-h" className={st.h2}>Hiring now</h2>
          <ListingFinder config={listings} id="guide" />
        </section>

        <div className={st.menu}>
          {menu.map((row) => (
            <MenuRow key={row.id} id={row.id} title={row.title} summary={row.summary} icon={row.icon}>
              <Blocks blocks={row.blocks} sources={sources} />
            </MenuRow>
          ))}
          <MenuRow id="resources" title="Additional resources" summary={content.resourcesSummary || resourcesSummary(resources)}>
            <Resources groups={resources} sources={sources} />
          </MenuRow>
        </div>
      </div>
    </div>
  )
}

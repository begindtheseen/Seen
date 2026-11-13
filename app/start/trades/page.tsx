import type { Metadata } from 'next'
import Link from 'next/link'
import PageHeader from '@/components/shell/PageHeader'
import { pageMetadata } from '@/lib/seo'
import { jsonLdHtml } from '@/lib/jsonLd'
import { formatSourceDate, numberSources } from '@/lib/start/guides.js'
import {
  sources, guide, doors, tradeRows, tradeNote, test, employers, employerCaveats, freeHelp, mistakes, peopleSay, scams,
  faq, listings, pageEntries,
} from '@/lib/start/trades.js'
import { Fact, FactList, Faq, GuideTable, Refs, SaidList, Section, SourceList, Toc, faqJsonLd, type Source } from '@/components/start/Guide'
import LiveListings from '@/components/start/LiveListings'
import st from '@/components/start/guide.module.css'

// "Getting into the trades" — a calm, exact guide for people with no experience. Every fact and figure comes from
// lib/start/trades.js, where each carries its source and as-of date (lib/start/guides.test.mjs keeps it that way).
// Union rules are local, so every wage, window or cutoff names its local. No filled button on this page.

export const metadata: Metadata = pageMetadata({
  title: guide.title,
  description: guide.metaDescription,
  path: guide.path,
  ogTitle: guide.title,
})

const P = 'tr'
const SRC = sources as Record<string, Source>
const { nums, ordered } = numberSources(SRC, pageEntries()) as { nums: Record<string, number>; ordered: Array<[string, Source]> }

const TOC = [
  { id: 'two-doors', label: 'Two ways in' },
  { id: 'by-trade', label: 'Trade by trade' },
  { id: 'aptitude-test', label: 'The aptitude test' },
  { id: 'paid-training', label: 'Paid training' },
  { id: 'free-help', label: 'Free help' },
  { id: 'mistakes', label: 'Common mistakes' },
  { id: 'scams', label: 'Scams' },
  { id: 'listings', label: 'Live listings' },
  { id: 'questions', label: 'Questions' },
]

export default function TradesGuidePage() {
  return (
    <div className="page-full">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdHtml(faqJsonLd(faq)) }} />
      <div className={st.wrap}>
        <PageHeader
          eyebrow={guide.eyebrow}
          title={guide.title}
          crumbs={[{ href: '/jobs', label: 'Jobs' }]}
          crumbLabel={guide.crumbLabel}
          sub={guide.sub}
        />
        <p className={st.asof}>Read from government pages, union training programs and employers&rsquo; own pages on {formatSourceDate(guide.asOf)}.</p>
        <Toc items={TOC} />

        <Section id="two-doors" title="Two ways in">
          <div className={st.doors}>
            {[doors.apprenticeship, doors.now].map((d) => (
              <div key={d.title} className={st.item}>
                <h3 className={st.itemName}>{d.title}</h3>
                <p className={st.itemText}><Fact e={d.lead} nums={nums} prefix={P} /></p>
                <ul className={st.list}>
                  {d.examples.map((x, i) => <li key={i} className={st.itemText}><Fact e={x} nums={nums} prefix={P} /></li>)}
                </ul>
                {d.note && <p className={st.itemMeta}><Fact e={d.note} nums={nums} prefix={P} /></p>}
              </div>
            ))}
          </div>
        </Section>

        <Section id="by-trade" title="Trade by trade">
          <GuideTable
            caption="How people enter each trade, how long training takes, how to apply, and the national median pay"
            columns={[
              { key: 'trade', label: 'Trade' }, { key: 'path', label: 'Way in' }, { key: 'length', label: 'Length' },
              { key: 'apply', label: 'How to apply' }, { key: 'median', label: 'BLS median', num: true },
            ]}
            rows={tradeRows}
            nums={nums}
            prefix={P}
          />
          <p className={`${st.p} ${st.quiet}`}><Fact e={tradeNote} nums={nums} prefix={P} /></p>
        </Section>

        <Section id="aptitude-test" title="The aptitude test, and what committees weigh">
          <p className={st.p}>The electrical apprenticeship test, as the IBEW/NECA Electrical Training Alliance describes it:</p>
          <FactList items={test.facts} nums={nums} prefix={P} />
          <h3 className={st.h3}>What selection committees say they look for</h3>
          <FactList items={test.weigh} nums={nums} prefix={P} />
          <p className={st.p}><Fact e={test.prep} nums={nums} prefix={P} /></p>
          <p className={`${st.p} ${st.quiet}`}>
            If you send a résumé, you can <Link href="/resume" prefetch={false} className={st.inlineLink}>check it against a posting</Link>: reliability,
            your math and school record, hands-on work, and licenses and cards are what these committees name.
          </p>
        </Section>

        <Section id="paid-training" title="Employers with paid training">
          <ul className={st.items}>
            {employers.map((e) => (
              <li key={e.name} className={st.item}>
                <h3 className={st.itemName}>{e.name}</h3>
                <p className={st.itemText}>{e.text}<Refs src={e.src} nums={nums} prefix={P} /></p>
              </li>
            ))}
          </ul>
          <h3 className={st.h3}>Before you sign</h3>
          <FactList items={employerCaveats} nums={nums} prefix={P} />
        </Section>

        <Section id="free-help" title="Free help">
          <ul className={st.items}>
            {freeHelp.map((f) => (
              <li key={f.name} className={st.item}>
                <h3 className={st.itemName}>{f.name}</h3>
                <p className={st.itemText}>{f.text}<Refs src={f.src} nums={nums} prefix={P} /></p>
                {f.url && (
                  <a href={f.url} className={st.itemLink} target="_blank" rel="noopener noreferrer">
                    {new URL(f.url).hostname.replace(/^www\./, '')}<span className="sr-only"> (opens in a new tab)</span> ↗
                  </a>
                )}
              </li>
            ))}
          </ul>
        </Section>

        <Section id="mistakes" title="Common mistakes">
          <FactList items={mistakes} nums={nums} prefix={P} />
          <p className={st.p}>What people who got in say, from public Reddit threads in 2025 and 2026. These are accounts, not facts.</p>
          <SaidList label="People in the trades say" items={peopleSay} nums={nums} prefix={P} />
        </Section>

        <Section id="scams" title="Scams and red flags" icon="caution">
          <FactList items={scams} nums={nums} prefix={P} />
        </Section>

        <Section id="listings" title="Live apprenticeship listings">
          <p className={st.p}>Apprentice, helper and trainee listings Seen holds right now, nationwide. Each opens the listing&rsquo;s page with the employer&rsquo;s record.</p>
          <LiveListings query={listings.query} seeAllQuery={listings.seeAll} label="Live apprenticeship listings" />
        </Section>

        <Section id="questions" title="Common questions">
          <Faq items={faq} nums={nums} prefix={P} />
        </Section>

        <Section id="sources" title="Sources">
          <p className={`${st.p} ${st.quiet}`}>Each number in brackets above points to one of these. Dates are when the page was posted, updated or read.</p>
          <SourceList ordered={ordered} prefix={P} />
        </Section>
      </div>
    </div>
  )
}

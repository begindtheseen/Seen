import type { Metadata } from 'next'
import Link from 'next/link'
import PageHeader from '@/components/shell/PageHeader'
import { pageMetadata } from '@/lib/seo'
import { jsonLdHtml } from '@/lib/jsonLd'
import { formatSourceDate, numberSources } from '@/lib/start/guides.js'
import {
  sources, guide, entryJobs, asks, payRows, payNote, blsRows, blsNote, employers, howPeopleGetIn, whatEndsIt,
  tickets, ticketsNote, scams, hiringNow, faq, listings, pageEntries,
} from '@/lib/start/oilfield.js'
import { Fact, FactList, Faq, GuideTable, Refs, SaidList, Section, SourceList, Toc, faqJsonLd, type Source } from '@/components/start/Guide'
import LiveListings from '@/components/start/LiveListings'
import st from '@/components/start/guide.module.css'

// "Getting into oilfield work" — a calm, exact guide for people with no experience (owner, 2026-11-13: people will be
// sent "all the listings are here: seenjobs.io/start/oilfield"). Every fact and figure comes from lib/start/oilfield.js,
// where each carries its source and as-of date; lib/start/guides.test.mjs keeps it that way. No filled button here:
// the page is for reading, and its one action is a text link into job search.

export const metadata: Metadata = pageMetadata({
  title: guide.title,
  description: guide.metaDescription,
  path: guide.path,
  ogTitle: guide.title,
})

const P = 'oil'
const SRC = sources as Record<string, Source>
const { nums, ordered } = numberSources(SRC, pageEntries()) as { nums: Record<string, number>; ordered: Array<[string, Source]> }

const TOC = [
  { id: 'entry-jobs', label: 'Entry jobs' },
  { id: 'what-they-ask', label: 'What they ask for' },
  { id: 'starting-pay', label: 'Starting pay' },
  { id: 'who-hires', label: 'Who hires' },
  { id: 'how-people-get-in', label: 'How people get in' },
  { id: 'tickets', label: 'Tickets' },
  { id: 'scams', label: 'Scams' },
  { id: 'listings', label: 'Live listings' },
  { id: 'questions', label: 'Questions' },
]

export default function OilfieldGuidePage() {
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
        <p className={st.asof}>Read from employers&rsquo; own job boards and public records on {formatSourceDate(guide.asOf)}.</p>
        <Toc items={TOC} />

        <Section id="entry-jobs" title="What the entry jobs are">
          <ul className={st.items}>
            {entryJobs.map((j) => (
              <li key={j.role} className={st.item}>
                <h3 className={st.itemName}>{j.role}</h3>
                <p className={st.itemText}><Fact e={j.what} nums={nums} prefix={P} /></p>
                {j.schedule && (
                  <p className={st.itemMeta}><span className={st.itemLabel}>Schedule: </span><Fact e={j.schedule} nums={nums} prefix={P} /></p>
                )}
              </li>
            ))}
          </ul>
        </Section>

        <Section id="what-they-ask" title="What the big companies actually ask for">
          <p className={st.p}><Fact e={asks.intro} nums={nums} prefix={P} /></p>
          <FactList items={asks.items} nums={nums} prefix={P} />
          <p className={st.p}><Fact e={asks.note} nums={nums} prefix={P} /></p>
          <SaidList label="People in the field say" items={[asks.smaller]} nums={nums} prefix={P} />
          <p className={`${st.p} ${st.quiet}`}>
            Before you apply, you can <Link href="/resume" prefetch={false} className={st.inlineLink}>check your résumé against a posting</Link>: stable work history,
            outdoor or physical work, a driver&rsquo;s license and any military service are what these postings name.
          </p>
        </Section>

        <Section id="starting-pay" title="Starting pay on employers’ own postings">
          <GuideTable
            caption="Starting pay stated on employers' own postings, November 2026"
            columns={[{ key: 'company', label: 'Company' }, { key: 'role', label: 'Role' }, { key: 'pay', label: 'Stated pay', num: true }]}
            rows={payRows}
            nums={nums}
            prefix={P}
          />
          <p className={`${st.p} ${st.quiet}`}><Fact e={payNote} nums={nums} prefix={P} /></p>
          <h3 className={st.h3}>What the government&rsquo;s figures say</h3>
          <GuideTable
            caption="BLS pay figures for oilfield occupations, May 2025"
            columns={[{ key: 'occupation', label: 'Occupation' }, { key: 'median', label: 'National median, yearly', num: true }, { key: 'midland', label: 'Midland, TX mean, hourly', num: true }]}
            rows={blsRows}
            nums={nums}
            prefix={P}
          />
          <p className={`${st.p} ${st.quiet}`}><Fact e={blsNote} nums={nums} prefix={P} /></p>
        </Section>

        <Section id="who-hires" title="Who hires people with no experience">
          <FactList items={hiringNow} nums={nums} prefix={P} />
          <ul className={st.items}>
            {employers.map((e) => (
              <li key={e.name} className={st.item}>
                <h3 className={st.itemName}>{e.name}</h3>
                <p className={st.itemText}><Fact e={{ ...e.evidence, src: [...e.evidence.src, e.board] }} nums={nums} prefix={P} /></p>
                <a href={SRC[e.board].url} className={st.itemLink} target="_blank" rel="noopener noreferrer">
                  {e.name} job board<span className="sr-only"> (opens in a new tab)</span> ↗
                </a>
              </li>
            ))}
          </ul>
        </Section>

        <Section id="how-people-get-in" title="How people actually get in">
          <p className={st.p}>What people who got in say, from public r/oilandgasworkers threads in 2026. These are accounts, not facts; each is something several people agreed on.</p>
          <SaidList label="What worked" items={howPeopleGetIn} nums={nums} prefix={P} />
          <SaidList label="What ends an application" items={whatEndsIt} nums={nums} prefix={P} />
        </Section>

        <Section id="tickets" title="Tickets: what they are and who pays">
          <ul className={st.items}>
            {tickets.map((t) => (
              <li key={t.name} className={st.item}>
                <h3 className={st.itemName}>{t.name}</h3>
                <p className={st.itemText}>{t.text}<Refs src={t.src} nums={nums} prefix={P} /></p>
              </li>
            ))}
          </ul>
          <p className={st.p}><Fact e={ticketsNote} nums={nums} prefix={P} /></p>
        </Section>

        <Section id="scams" title="Scams and red flags" icon="caution">
          <FactList items={scams} nums={nums} prefix={P} />
        </Section>

        <Section id="listings" title="Live entry listings">
          <p className={st.p}>Oilfield listings Seen holds right now, nationwide. Each opens the listing&rsquo;s page with the employer&rsquo;s record.</p>
          <LiveListings query={listings.query} seeAllQuery={listings.seeAll} label="Live oilfield listings" />
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

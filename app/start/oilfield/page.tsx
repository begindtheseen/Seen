import type { Metadata } from 'next'
import Link from 'next/link'
import PageHeader from '@/components/shell/PageHeader'
import Icon from '@/components/ui/Icon'
import { pageMetadata } from '@/lib/seo'
import { jsonLdHtml } from '@/lib/jsonLd'
import { formatSourceDate, numberSources } from '@/lib/start/guides.js'
import {
  sources, guide, tiles, entryJobs, asks, payRows, payNote, blsRows, blsNote, employers, howPeopleGetIn, alsoSaid,
  whatEndsIt, tickets, ticketsNote, scams, hiringNow, faq, listings, pageEntries, sectionEntries,
} from '@/lib/start/oilfield.js'
import {
  Checklist, Chips, Faq, GuideTable, More, NoteList, Section, Sources, SrcLine, Steps, Tiles, faqJsonLd, type Source,
} from '@/components/start/Guide'
import LiveListings from '@/components/start/LiveListings'
import st from '@/components/start/guide.module.css'

// "Getting into oilfield work" — for someone sent here from a comment ("all the listings are here"). The first
// screen answers: can I get in, what does it pay, who is hiring now — then the listings. Everything after is
// scannable (checklist, cards, rows); detail sits in closed disclosures. Every fact comes from lib/start/oilfield.js,
// where each carries its source and date (lib/start/guides.test.mjs). No filled button: the one action is a text
// link into job search.

export const metadata: Metadata = pageMetadata({
  title: guide.title,
  description: guide.metaDescription,
  path: guide.path,
  ogTitle: guide.title,
})

const P = 'oil'
const SRC = sources as Record<string, Source>
const { nums, ordered } = numberSources(SRC, pageEntries()) as { nums: Record<string, number>; ordered: Array<[string, Source]> }
const parts = sectionEntries()
const SHOWN = 5 // employer rows shown before "more companies"

function employerRow(e: (typeof employers)[number]) {
  return (
    <li key={e.name} className={st.erow}>
      <h3 className={st.erowName}>{e.name}</h3>
      {e.pay && <p className={st.erowPay}><b>{e.pay.value}</b><span>{e.pay.note}</span></p>}
      <div className={st.erowRoles}><Chips items={e.roles} /></div>
      <p className={st.erowText}>
        {e.evidence.text}{' '}
        <a href={SRC[e.board].url} className={st.boardLink} target="_blank" rel="noopener noreferrer">
          Job board<span className="sr-only"> of {e.name} (opens in a new tab)</span>&nbsp;<Icon name="arrow-up-right" size={12} />
        </a>
      </p>
    </li>
  )
}

export default function OilfieldGuidePage() {
  return (
    <div className="page-full">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdHtml(faqJsonLd(faq)) }} />
      <div className={st.wrap}>
        <div className={st.hero}>
          <PageHeader
            size="lg"
            eyebrow={guide.eyebrow}
            title={guide.title}
            crumbs={[{ href: '/jobs', label: 'Jobs' }]}
            crumbLabel={guide.crumbLabel}
            sub={guide.answer.text}
          />
          <Tiles tiles={tiles} />
          <SrcLine entries={parts.hero} nums={nums} prefix={P} lead={`${guide.asOfLine} ${formatSourceDate(guide.asOf)}.`} />
        </div>

        <Section first id="listings" title="Hiring now" sub="Live oilfield listings, nationwide.">
          <LiveListings queries={listings.queries} prefer={listings.prefer} seeAllQuery={listings.seeAll} label="Live oilfield listings" seeAllLabel="See all roustabout jobs" max={8} />
        </Section>

        <Section id="what-you-need" title="What you need" sub={asks.intro.text} foot={<SrcLine entries={parts.needs} nums={nums} prefix={P} />}>
          <Checklist items={asks.items} cols />
          <p className={st.callout}>{asks.ticketsLine.text}</p>
          <More title="Tickets: what each one is, and who pays">
            <p className={st.moreText}>{asks.note.text}</p>
            <p className={st.moreText}>From people in the field: {asks.smaller.text}</p>
            <Checklist items={tickets} />
            <p className={st.moreText}>{ticketsNote.text}</p>
          </More>
        </Section>

        <Section id="entry-jobs" title="Entry jobs" foot={<SrcLine entries={parts.jobs} nums={nums} prefix={P} />}>
          <ul className={st.cards}>
            {entryJobs.map((j) => (
              <li key={j.role} className={st.card}>
                <div className={st.cardHead}>
                  <h3 className={st.cardName}>{j.role}</h3>
                  {j.aka && <span className={st.cardAka}>{j.aka}</span>}
                </div>
                <p className={st.cardText}>{j.what.text}</p>
                <Chips items={j.chips.map((c) => c.text)} strong />
              </li>
            ))}
          </ul>
          <More title="Pay further up, from the government’s figures">
            <GuideTable
              caption="BLS pay figures for oilfield occupations, May 2025"
              columns={[{ key: 'occupation', label: 'Occupation' }, { key: 'median', label: 'U.S. median, yearly', num: true }, { key: 'midland', label: 'Midland, TX, hourly', num: true }]}
              rows={blsRows}
            />
            <p className={st.p}>{blsNote.text}</p>
          </More>
        </Section>

        <Section id="who-hires" title="Who hires green hands" sub={hiringNow.map((h) => h.text).join(' ')} foot={<SrcLine entries={parts.employers} nums={nums} prefix={P} />}>
          <ul className={st.list}>{employers.slice(0, SHOWN).map(employerRow)}</ul>
          <More title={`${employers.length - SHOWN} more companies that hire green hands`}>
            <ul className={st.list}>{employers.slice(SHOWN).map(employerRow)}</ul>
          </More>
          <More title="Pay on each posting">
            <GuideTable
              caption="Starting pay stated on employers' own postings, November 2026"
              columns={[{ key: 'company', label: 'Company' }, { key: 'role', label: 'Role' }, { key: 'pay', label: 'Stated pay', num: true }]}
              rows={payRows}
            />
            <p className={st.moreText}>{payNote.text}</p>
          </More>
        </Section>

        <Section id="how-people-get-in" title="How people get in" sub="From people who got in, on public r/oilandgasworkers threads in 2026. Accounts several people agree on, not facts." foot={<SrcLine entries={parts.getIn} nums={nums} prefix={P} />}>
          <Steps items={howPeopleGetIn} />
          <More title="Two more things people say">
            <NoteList items={alsoSaid} />
          </More>
          <p className={st.p}>
            Before you apply, you can <Link href="/resume" prefetch={false} className={st.inlineLink}>check your résumé against a posting</Link>.
          </p>
        </Section>

        <Section id="watch-out" title="Watch out" icon="caution" foot={<SrcLine entries={parts.watch} nums={nums} prefix={P} />}>
          <div className={st.notesGrid}>
            <NoteList label="What ends an application, people say" items={whatEndsIt} icon="x" />
            <NoteList label="Scams" items={scams} icon="x" />
          </div>
        </Section>

        <Section id="questions" title="Common questions" foot={<SrcLine entries={parts.faq} nums={nums} prefix={P} />}>
          <Faq items={faq} />
        </Section>

        <Sources ordered={ordered} prefix={P} />
      </div>
    </div>
  )
}

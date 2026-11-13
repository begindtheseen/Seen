import type { Metadata } from 'next'
import Link from 'next/link'
import PageHeader from '@/components/shell/PageHeader'
import Icon from '@/components/ui/Icon'
import { pageMetadata } from '@/lib/seo'
import { jsonLdHtml } from '@/lib/jsonLd'
import { formatSourceDate, numberSources, sourceHost } from '@/lib/start/guides.js'
import {
  sources, guide, tiles, doors, tradeRows, tradeNote, test, employers, caveatLine, employerCaveats, freeHelp, mistakes, peopleSay,
  scams, faq, listings, pageEntries, sectionEntries,
} from '@/lib/start/trades.js'
import {
  Checklist, Chips, DiscList, Faq, More, NoteList, Section, Sources, SrcLine, Tiles, faqJsonLd, type Source,
} from '@/components/start/Guide'
import LiveListings from '@/components/start/LiveListings'
import st from '@/components/start/guide.module.css'

// "Getting into the trades" — the first screen answers: does it pay, how hard is it to get in, what does it pay
// once trained — then the live listings. The two doors side by side, the trades as rows (detail one tap away), the
// test as a checklist. Every fact comes from lib/start/trades.js, where each carries its source and date
// (lib/start/guides.test.mjs). Union rules are local, so every wage, window or cutoff names its local. No filled
// button on this page.

export const metadata: Metadata = pageMetadata({
  title: guide.title,
  description: guide.metaDescription,
  path: guide.path,
  ogTitle: guide.title,
})

const P = 'tr'
const SRC = sources as Record<string, Source>
const { nums, ordered } = numberSources(SRC, pageEntries()) as { nums: Record<string, number>; ordered: Array<[string, Source]> }
const parts = sectionEntries()

export default function TradesGuidePage() {
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

        <Section first id="listings" title="Hiring now" sub="Live apprentice, helper and trainee listings, nationwide.">
          <LiveListings queries={listings.queries} prefer={listings.prefer} seeAllQuery={listings.seeAll} label="Live apprenticeship listings" seeAllLabel="See all apprenticeship jobs" max={8} />
        </Section>

        <Section id="two-doors" title="Two ways in" foot={<SrcLine entries={parts.doors} nums={nums} prefix={P} />}>
          <div className={st.doors}>
            {[doors.apprenticeship, doors.now].map((d) => (
              <div key={d.title} className={st.card}>
                <h3 className={st.cardName}>{d.title}</h3>
                <p className={st.cardText}>{d.lead.text}</p>
                <ul className={st.figRows}>
                  {d.examples.map((x) => (
                    <li key={x.who} className={st.figRow}>
                      <span className={st.figWho}>{x.who}</span>
                      <span className={st.figVal}>{x.figure}</span>
                      <span className={st.figText}>{x.text}</span>
                    </li>
                  ))}
                </ul>
                {d.note && <p className={st.cardNote}>{d.note.text}</p>}
              </div>
            ))}
          </div>
        </Section>

        <Section id="by-trade" title="Trade by trade" sub="Tap a trade for the way in and how to apply." foot={<SrcLine entries={parts.trades} nums={nums} prefix={P} lead={tradeNote.text} />}>
          <div className={st.list}>
            {tradeRows.map((t) => (
              <details key={t.trade} className={st.trow}>
                <summary className={st.trowSum}>
                  <span className={st.trowName}>
                    <span>{t.trade}</span>
                    <span className={st.trowLen}>{t.length}</span>
                  </span>
                  <span className={st.trowLenWide}>{t.length}</span>
                  <span className={st.trowFig}>{t.median}<small>median a year</small></span>
                  <Icon name="chevron-down" size={16} className={st.chev} />
                </summary>
                <div className={st.trowBody}>
                  <p><span>Way in</span>{t.path}</p>
                  <p><span>How to apply</span>{t.apply}</p>
                </div>
              </details>
            ))}
          </div>
        </Section>

        <Section id="aptitude-test" title="The aptitude test" sub={test.intro} foot={<SrcLine entries={parts.test} nums={nums} prefix={P} />}>
          <Checklist items={test.facts} cols />
          <p className={st.p}>{test.prep.text}</p>
          <More title="What selection committees say they look for">
            <NoteList items={test.weigh} />
            <p className={st.p}>
              If you send a résumé, you can <Link href="/resume" prefetch={false} className={st.inlineLink}>check it against a posting</Link>.
            </p>
          </More>
        </Section>

        <Section id="paid-training" title="Employers that train you" foot={<SrcLine entries={parts.employers} nums={nums} prefix={P} />}>
          <ul className={st.cards}>
            {employers.map((e) => (
              <li key={e.name} className={st.card}>
                <div className={st.cardTop}>
                  <h3 className={st.cardName}>{e.name}</h3>
                  <Chips items={[e.chip.text]} strong />
                </div>
                <p className={st.cardText}>{e.text}</p>
              </li>
            ))}
          </ul>
          <p className={st.callout}>{caveatLine.text}</p>
          <More title="Before you sign: franchises, CDL contracts, repayment terms">
            <NoteList items={employerCaveats} />
          </More>
        </Section>

        <Section id="free-help" title="Free help" foot={<SrcLine entries={parts.freeHelp} nums={nums} prefix={P} />}>
          <ul className={st.cards}>
            {freeHelp.map((f) => (
              <li key={f.name} className={st.card}>
                <div className={st.cardTop}>
                  <h3 className={st.cardName}>{f.name}</h3>
                  {f.url && (
                    <a href={f.url} className={st.boardLink} target="_blank" rel="noopener noreferrer">
                      {sourceHost(f.url)}<span className="sr-only"> (opens in a new tab)</span> <Icon name="arrow-up-right" size={14} />
                    </a>
                  )}
                </div>
                <p className={st.cardText}>{f.text}</p>
              </li>
            ))}
          </ul>
        </Section>

        <Section id="mistakes" title="Mistakes and scams" foot={<SrcLine entries={parts.mistakes} nums={nums} prefix={P} />}>
          <DiscList items={mistakes} />
          <More title="What people who got in say (accounts, not facts)">
            <p className={st.moreText}>From public Reddit threads in 2025 and 2026, where several accounts agree.</p>
            <NoteList items={peopleSay} />
          </More>
          <NoteList label="Scams" items={scams} icon="x" caution />
        </Section>

        <Section id="questions" title="Common questions" foot={<SrcLine entries={parts.faq} nums={nums} prefix={P} />}>
          <Faq items={faq} />
        </Section>

        <Sources ordered={ordered} prefix={P} />
      </div>
    </div>
  )
}

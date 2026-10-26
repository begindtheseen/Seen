// One monthly list page (/lists/employers-that-respond, /lists/staffing-agencies-ghosting): the finding as
// the H1, one quotable lead sentence, the ranked table with N per row, the rows under the cutoff kept
// apart, the method link and ItemList JSON-LD. Server component; every number comes from lib/openDataset.ts.

import Link from 'next/link'
import PageHeader from '@/components/shell/PageHeader'
import styles from './openData.module.css'
import { jsonLdHtml } from '@/lib/jsonLd'
import { type RankedList, type ListSection, type DatasetRow, listJsonLd, plural, DATA_PATH, METHODS_PATH, MIN_REPORTS_FOR_RATES } from '@/lib/openDataset'

const gradeClass = (s: number) => (s >= 70 ? styles.gGood : s >= 40 ? styles.gMid : styles.gBad)

function Table({ l, section, ranked }: { l: RankedList; section: ListSection; ranked: boolean }) {
  return (
    <div className={styles.section}>
      {section.title && <h3 className={styles.h3}>{section.title}</h3>}
      <div className={styles.tableWrap} role="region" aria-label={section.title || l.title} tabIndex={0}>
        <table className={styles.table}>
          <thead>
            <tr>
              {ranked && <th scope="col" className={styles.rank}>#</th>}
              <th scope="col" className={styles.colCo}>{l.slug === 'employers-that-respond' ? 'Employer' : 'Staffing agency'}</th>
              <th scope="col" className={styles.num}>Hear back</th>
              <th scope="col" className={styles.num}>Never hear back</th>
              <th scope="col" className={styles.num}>Applicant accounts</th>
              <th scope="col" className={styles.num}>Grade</th>
            </tr>
          </thead>
          <tbody>
            {section.rows.map((r: DatasetRow, i) => (
              <tr key={r.path}>
                {ranked && <td className={styles.rank}>{section.startRank + i}</td>}
                <td className={styles.colCo}>
                  <Link href={r.path} className={styles.coLink}>{r.company}</Link>
                  <span className={styles.say}>{l.rowSay(r)}</span>
                </td>
                <td className={styles.num}>{r.responsePct}%</td>
                <td className={styles.num}>{r.ghostPct}%</td>
                <td className={styles.num}>{r.reports.toLocaleString('en-US')}</td>
                <td className={styles.num}><span className={`${styles.grade} ${gradeClass(r.score)}`}>{r.grade}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function ListView({ l, attribution }: { l: RankedList; attribution: string }) {
  const ent = l.slug === 'employers-that-respond' ? { one: 'employer', many: 'employers' } : { one: 'staffing agency', many: 'staffing agencies' }
  return (
    <div className="page-full">
      {l.ranked.length > 0 && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdHtml(listJsonLd(l)) }} />}
      <div className={styles.wrap}>
        <PageHeader
          size="lg"
          eyebrow={l.eyebrow}
          title={l.h1}
          crumbs={[{ href: '/lists', label: 'Lists' }]}
          crumbLabel={l.slug === 'employers-that-respond' ? 'Employers that respond' : 'Agencies that ghost'}
        />
        <p className={styles.lead}>{l.lead}</p>
        <div className={styles.meta}>
          <span>Updated {l.month}</span>
          <span>Cutoff: {l.cutoff} applicant accounts</span>
          <Link className={styles.metaLink} href={METHODS_PATH}>How Seen measures</Link>
          <Link className={styles.metaLink} href={DATA_PATH}>Full dataset</Link>
        </div>

        {l.thin && <p className={styles.note}>{l.thinNote}</p>}

        {l.sections.map((s) => <Table key={s.title || 'all'} l={l} section={s} ranked />)}

        {l.below.length > 0 && (
          <section className={styles.section} aria-labelledby="below-h">
            <h2 id="below-h" className={styles.h2}>Under the {l.cutoff} report cutoff: not ranked</h2>
            <p className={styles.p}>
              {`These ${l.below.length === 1 ? ent.one : ent.many} have between ${MIN_REPORTS_FOR_RATES} and ${l.cutoff - 1} applicant accounts each: enough for a rate on their own page, too few to rank. ${plural(l.below.length, ent.one, ent.many)} in all${l.belowSections.length > 1 ? `; the ${l.belowSections[0].rows.length} at each end are shown, the rest are in the full dataset` : ''}. Read them with care.`}
            </p>
            {l.belowSections.map((s) => <Table key={`below-${s.title || 'all'}`} l={l} section={s} ranked={false} />)}
          </section>
        )}

        <section className={styles.section} aria-labelledby="about-h">
          <h2 id="about-h" className={styles.h2}>About these numbers</h2>
          <p className={styles.p}>
            “Hear back” is the share of applicants who got a reply from a person (a screen, an interview, a rejection or an offer); “never hear back” is the share who reported silence. Automated rejections count as neither, so the two can add up to less than 100%. Applicant accounts are outcomes submitted to Seen or first-hand accounts found in public posts such as Reddit threads and review sites, which count at reduced weight; online mentions count half. They are self-reported claims, not verified facts. Each name links to its page, where every report behind the number is listed.
          </p>
          <p className={styles.small}>{attribution}. Reuse under CC BY 4.0: <Link href={DATA_PATH}>download the data</Link>.</p>
        </section>
      </div>
    </div>
  )
}

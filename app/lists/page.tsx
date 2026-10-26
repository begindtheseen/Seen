import type { Metadata } from 'next'
import Link from 'next/link'
import { pageMetadata } from '@/lib/seo'
import PageHeader from '@/components/shell/PageHeader'
import styles from '@/components/data/openData.module.css'
import { getOpenDataset } from '@/lib/server/openDataRead'
import { buildList, LIST_SLUGS, LIST_MIN_REPORTS, DATA_PATH, METHODS_PATH } from '@/lib/openDataset'

// /lists: the monthly lists, each with its current lead sentence (lib/openDataset.ts buildList).
export const dynamic = 'force-dynamic'

export const metadata: Metadata = pageMetadata({
  title: 'Monthly lists: which employers respond and which agencies ghost',
  description: `Monthly rankings from applicant accounts on Seen: employers that reply to the most applicants, and staffing agencies that ghost the most. Each ranks companies with ${LIST_MIN_REPORTS} or more applicant accounts.`,
  path: '/lists',
})

const NAMES: Record<string, string> = {
  'employers-that-respond': 'Employers that respond to applicants',
  'staffing-agencies-ghosting': 'Staffing agencies that ghost applicants',
}

export default async function ListsIndex() {
  const d = await getOpenDataset()
  return (
    <div className="page-full">
      <div className={styles.wrap}>
        <PageHeader
          size="lg"
          eyebrow={d ? `Monthly lists · Updated ${d.month}` : 'Monthly lists'}
          title="Who replies to applicants, and who ghosts them"
          crumbLabel="Lists"
          sub={`Rankings rebuilt from applicant accounts on Seen. A company is ranked only with ${LIST_MIN_REPORTS} or more applicant accounts; every number links to the reports behind it.`}
        />
        <div className={styles.grid}>
          {LIST_SLUGS.map((slug) => {
            const l = d ? buildList(slug, d) : null
            return (
              <section key={slug} className={styles.card}>
                <h2 className={styles.cardTitle} style={{ margin: 0 }}>
                  <Link className={styles.listTitle} href={`/lists/${slug}`}>{NAMES[slug]}</Link>
                </h2>
                <p className={styles.p}>{l ? l.lead : 'The data behind this list could not be read just now.'}</p>
                {l && <p className={styles.small}>Updated {l.month} · {l.ranked.length} ranked</p>}
              </section>
            )
          })}
        </div>
        <p className={styles.p}>
          Built from the <Link href={DATA_PATH}>open dataset</Link> (CC BY 4.0). How grades and rates are made: <Link href={METHODS_PATH}>methods</Link>. Staffing agencies tracked by name: <Link href="/agencies">the Staffing Agency Ghost Index</Link>.
        </p>
      </div>
    </div>
  )
}

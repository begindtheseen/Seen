import type { Metadata } from 'next'
import Link from 'next/link'
import { pageMetadata } from '@/lib/seo'
import { jsonLdHtml } from '@/lib/jsonLd'
import PageHeader from '@/components/shell/PageHeader'
import DataTable, { type TableRow } from '@/components/data/DataTable'
import styles from '@/components/data/openData.module.css'
import { getOpenDataset } from '@/lib/server/openDataRead'
import { siteOrganization, SITE_ORG_ID } from '@/lib/siteIdentity'
import {
  type Dataset, datasetSummary, plural, DATASET_NAME, CSV_PATH, JSON_PATH, DATA_PATH, METHODS_PATH,
  LICENSE_URL, LICENSE_NAME, MIN_REPORTS_FOR_RATES, FIELD_DESCRIPTIONS,
} from '@/lib/openDataset'

// Seen's open dataset: every graded company's response and ghost rates, from applicant accounts, as a
// server-rendered table plus CSV and JSON files (CC BY 4.0). Numbers come from the snapshot in
// lib/server/openDataRead.ts, mapped by the same helpers as the company page (lib/openDataset.ts).
// Rendered per request from a 1-hour cached snapshot, so a failed read is never frozen into the page.

export const dynamic = 'force-dynamic'

const SITE = 'https://seenjobs.io'

export async function generateMetadata(): Promise<Metadata> {
  const d = await getOpenDataset()
  return pageMetadata({
    title: 'Employer response rates, from applicant accounts (open data)',
    description: d
      ? `${datasetSummary(d)} Free to download as CSV or JSON under ${LICENSE_NAME}.`
      : `Every company Seen grades, with the share of applicants who hear back and who never do. Free to download as CSV or JSON under ${LICENSE_NAME}.`,
    path: DATA_PATH,
    keywords: ['employer response rate', 'ghosting statistics', 'job applicant ghosting data', 'hiring response rate dataset', 'companies that ghost applicants'],
  })
}

function datasetJsonLd(d: Dataset) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      siteOrganization(),
      {
        '@type': 'Dataset',
        '@id': `${SITE}${DATA_PATH}#dataset`,
        name: DATASET_NAME,
        description: `${datasetSummary(d)} For each graded company: Seen Grade, the share of applicants who heard back, the share who never did, and how many applicant accounts stand behind them. Reports are self-reported claims, not verified facts.`,
        url: `${SITE}${DATA_PATH}`,
        license: LICENSE_URL,
        isAccessibleForFree: true,
        creditText: d.attribution,
        creator: { '@id': SITE_ORG_ID },
        publisher: { '@id': SITE_ORG_ID },
        dateModified: d.asOf.toISOString(),
        ...(d.earliest ? { temporalCoverage: `${d.earliest}/${d.asOfDate}` } : {}),
        keywords: ['hiring', 'job applicants', 'ghosting', 'employer response rate', 'staffing agencies'],
        measurementTechnique: 'Applicant-reported hiring outcomes (submitted to Seen, or first-hand accounts found in public posts), weighted by source, with online mentions at half weight.',
        variableMeasured: [
          { '@type': 'PropertyValue', name: 'response_rate_pct', description: FIELD_DESCRIPTIONS.response_rate_pct, unitText: 'percent', minValue: 0, maxValue: 100 },
          { '@type': 'PropertyValue', name: 'ghost_rate_pct', description: FIELD_DESCRIPTIONS.ghost_rate_pct, unitText: 'percent', minValue: 0, maxValue: 100 },
          { '@type': 'PropertyValue', name: 'seen_score', description: FIELD_DESCRIPTIONS.seen_score, minValue: 0, maxValue: 100 },
          { '@type': 'PropertyValue', name: 'applicant_reports', description: FIELD_DESCRIPTIONS.applicant_reports },
          { '@type': 'PropertyValue', name: 'from_public_posts', description: FIELD_DESCRIPTIONS.from_public_posts },
        ],
        distribution: [
          { '@type': 'DataDownload', encodingFormat: 'text/csv', contentUrl: `${SITE}${CSV_PATH}` },
          { '@type': 'DataDownload', encodingFormat: 'application/json', contentUrl: `${SITE}${JSON_PATH}` },
        ],
      },
    ],
  }
}

const tableRows = (d: Dataset): TableRow[] => d.rows.map((r) => ({
  c: r.company, p: r.path, g: r.grade, s: r.score, r: r.responsePct, gh: r.ghostPct, n: r.reports, pub: r.publicReports, a: r.agency, u: r.updated,
}))

export default async function DataPage() {
  const d = await getOpenDataset()

  if (!d) {
    return (
      <div className="page-full">
        <div className={styles.wrap}>
          <PageHeader eyebrow={`Open data · ${LICENSE_NAME}`} title={DATASET_NAME} crumbLabel="Open data" />
          <p className={styles.p}>The dataset could not be read just now, so no numbers are shown. Try again in a few minutes, or browse the <Link href="/companies">company scoreboard</Link>.</p>
        </div>
      </div>
    )
  }

  const example = d.rows.find((r) => r.responsePct != null) ?? d.rows[0]
  const t = d.totals

  return (
    <div className="page-full">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdHtml(datasetJsonLd(d)) }} />
      <div className={styles.wrap}>
        <PageHeader
          size="lg"
          eyebrow={`Open data · ${LICENSE_NAME} · updated hourly`}
          title={DATASET_NAME}
          crumbLabel="Open data"
          sub={datasetSummary(d)}
        />

        <div className={styles.grid}>
          <section className={styles.card} aria-labelledby="dl-h">
            <h2 id="dl-h" className={styles.cardTitle}>Download</h2>
            <div className={styles.btnRow}>
              <a className={styles.btn} href={CSV_PATH}>CSV · {plural(t.companies, 'row')}</a>
              <a className={styles.btn} href={JSON_PATH}>JSON</a>
            </div>
            <p className={styles.small}>
              Free to reuse under <a href={LICENSE_URL} rel="license">{LICENSE_NAME}</a> with attribution. Snapshot of {d.asOfLabel}.
            </p>
          </section>
          <section className={styles.card} aria-labelledby="cite-h">
            <h2 id="cite-h" className={styles.cardTitle}>How to cite</h2>
            <code className={styles.cite}>{d.attribution}</code>
            {example && <p className={styles.small}>Example: “{example.fact.sentence}.” {d.attribution}, {example.url}</p>}
          </section>
        </div>

        <section className={styles.section} aria-labelledby="src-h">
          <h2 id="src-h" className={styles.h2}>Where the reports come from</h2>
          <p className={styles.p}>
            An applicant account is one hiring outcome (heard back, interviewed, rejected, hired, or never heard back) reported by the applicant: either submitted to Seen, or a first-hand account found in a public post such as a Reddit thread or a review site.
            {t.publicReports != null ? ` Of the ${plural(t.reports, 'applicant account')} behind this table, ${t.publicReports.toLocaleString('en-US')} ${t.publicReports === 1 ? 'was' : 'were'} found in public posts; those count at reduced weight.` : ' Reports found in public posts count at reduced weight.'}
            {` Online mentions (${t.mentions.toLocaleString('en-US')} here) count half a report each. Estimates from web research are never counted as reports.`}
          </p>
          <p className={styles.p}>
            Percentages appear only for companies with at least {MIN_REPORTS_FOR_RATES} applicant accounts ({plural(t.withRates, 'company', 'companies')} here); the others show a grade only. Reports are self-reported claims, not verified facts. How grades are built: <Link href={METHODS_PATH}>methods</Link>. Rankings built from this table: <Link href="/lists">monthly lists</Link>.
          </p>
        </section>

        <section className={styles.section} aria-labelledby="tbl-h">
          <h2 id="tbl-h" className={styles.h2}>Every graded company</h2>
          <DataTable rows={tableRows(d)} />
        </section>

        <section className={styles.section} aria-labelledby="def-h">
          <h2 id="def-h" className={styles.h2}>Columns in the files</h2>
          <dl className={styles.defs}>
            {Object.entries(FIELD_DESCRIPTIONS).map(([k, v]) => (
              <div key={k} style={{ display: 'contents' }}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </div>
  )
}

// /llms.txt and /llms-full.txt, built from the open dataset snapshot (lib/openDataset.ts) so every number
// is the one the company page, /data and /lists print (lib/companyFactLine.ts).
//
// Format: the llms.txt convention (https://llmstxt.org): an H1 with the site name, a blockquote summary,
// plain detail paragraphs, then H2 sections of "- [name](url): notes" link lists; "## Optional" holds the
// links an agent can skip. Plain facts only: no instructions aimed at a model, nothing hidden.
//
// Pure; relative imports only so `node --test lib/llmsText.test.mjs` runs it as is.

import { SITE_ORIGIN } from './companyFactLine.ts'
import {
  type Dataset, type DatasetRow, datasetSummary, plural, CSV_PATH, JSON_PATH, DATA_PATH, METHODS_PATH,
  LICENSE_NAME, LICENSE_URL, LIST_MIN_REPORTS, MIN_REPORTS_FOR_RATES,
} from './openDataset.ts'

/** How many companies llms.txt lists by name (the rest are in llms-full.txt). */
export const LLMS_TOP_COMPANIES = 25

const abs = (path: string) => `${SITE_ORIGIN}${path}`

/** "- [Walmart](https://seenjobs.io/company/walmart): 87% of applicants hear back, 13% never do (48 applicant accounts and 32 online mentions, Oct 2026)" */
export function llmsCompanyItem(r: DatasetRow): string {
  const label = r.agency ? `${r.company} (staffing agency)` : r.company
  // Markdown link text: brackets in a name would end the link early.
  const safe = label.replace(/[[\]]/g, '')
  return `- [${safe}](${r.url}): ${r.fact.claim} (${r.fact.basis}, ${r.fact.month})`
}

function header(d: Dataset): string[] {
  return [
    '# Seen',
    '',
    '> Seen (seenjobs.io) publishes how employers treat job applicants: the share who hear back, the share who never do, and a 0 to 100 Seen Grade, from applicant accounts submitted to Seen or found in public posts. Free to read, no account needed.',
    '',
    datasetSummary(d),
    '',
    `Percentages are published only for companies with at least ${MIN_REPORTS_FOR_RATES} applicant accounts. Applicant accounts are self-reported claims, not verified facts; every company page shows how many stand behind its numbers and where they came from. Estimates from web research are never counted as reports.`,
    '',
    `Each line below states one company's figures with its basis and month, in the same words as its company page. Company pages follow the pattern ${SITE_ORIGIN}/company/{slug}, where the slug is the company name in lowercase with spaces as hyphens (for example /company/walmart, /company/bank-of-america).`,
    '',
    `The data is published under ${LICENSE_NAME} (${LICENSE_URL}). Attribution: "${d.attribution}".`,
    '',
    '## Data and methods',
    '',
    `- [Open dataset: employer response rates](${abs(DATA_PATH)}): every graded company in one table, with CSV and JSON downloads`,
    `- [CSV download](${abs(CSV_PATH)}): one row per graded company`,
    `- [JSON download](${abs(JSON_PATH)}): the same rows with field descriptions`,
    `- [How Seen measures](${abs(METHODS_PATH)}): how reports are collected, weighted and graded`,
    '',
    '## Rankings',
    '',
    `- [Employers that respond to applicants](${abs('/lists/employers-that-respond')}): monthly ranking of employers with ${LIST_MIN_REPORTS} or more applicant accounts`,
    `- [Staffing agencies that ghost applicants](${abs('/lists/staffing-agencies-ghosting')}): monthly ranking of staffing agencies with ${LIST_MIN_REPORTS} or more applicant accounts`,
    `- [Staffing Agency Ghost Index](${abs('/agencies')}): major staffing agencies by reported ghost rate`,
    `- [Company scoreboard](${abs('/companies')}): browse and search every company`,
    '',
  ]
}

export function llmsTxt(d: Dataset, top = LLMS_TOP_COMPANIES): string {
  const rows = d.rows.slice(0, top) // dataset rows are already ordered by applicant accounts, most first
  return [
    ...header(d),
    `## Most reported companies (${d.month})`,
    '',
    ...(rows.length ? rows.map(llmsCompanyItem) : ['- [Company scoreboard](' + abs('/companies') + '): no company has enough applicant accounts for a grade yet']),
    '',
    '## Optional',
    '',
    `- [Every graded company, one line each](${abs('/llms-full.txt')}): ${plural(d.totals.companies, 'company', 'companies')}`,
    `- [Jobs](${abs('/jobs')}): job listings with each employer's record`,
    `- [Report a hiring outcome](${abs('/report')}): how applicants add a report`,
    '',
  ].join('\n')
}

export function llmsFullTxt(d: Dataset): string {
  return [
    ...header(d),
    `## Every graded company (${plural(d.totals.companies, 'company', 'companies')}, ${d.month})`,
    '',
    ...d.rows.map(llmsCompanyItem),
    '',
  ].join('\n')
}

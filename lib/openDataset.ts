// Seen's open dataset and monthly lists, shaped from one snapshot of company_scores (lib/server/openDataRead.ts).
//
// Every number here is computed by the SAME helpers the company page uses: rows arrive mapped by
// lib/growth.ts growthScoreFromRow (tenure fold-in + grade gate, exactly getScore()), then go through
// lib/companyMeta.ts companyMetaFacts (first-party count, rates only with MIN_REPORTS_FOR_RATES, the one
// letter scale) and lib/companyFactLine.ts. So /data, /lists/*, llms.txt and /company/<slug> cannot disagree.
//
// Honesty rules (load-bearing):
//   - "applicant reports" = first-party report rows with an outcome (first_party_report_count). They
//     include accounts found in public posts (Reddit threads, review sites); `publicReports` says how many.
//     Nothing here ever calls a count "Seen users".
//   - web_report_count (the web-research claim) is never published as reports.
//   - A percentage appears only where the company page shows one.
//
// Pure; relative imports only so `node --test lib/openDataset.test.mjs` runs it as is.

import { companyMetaFacts, type MetaScore } from './companyMeta.ts'
import { companyFactLine, companyPageUrl, attributionLine, longMonth, SITE_ORIGIN, type FactLine } from './companyFactLine.ts'
import { STAFFING_AGENCIES } from './agencies.ts'
import { displayCompanyName } from './companyNames.js'
import { pacificDate, formatPacific } from './time/pacific.js'
import { MIN_REPORTS_FOR_RATES } from './companyPageSummary.ts'

export { MIN_REPORTS_FOR_RATES }

/** A company must have at least this many applicant reports to be RANKED on a monthly list. */
export const LIST_MIN_REPORTS = 20
/** Fewer ranked rows than this and a list says it is not yet a full ranking. */
export const LIST_FULL_SIZE = 10
/** A ranked table longer than this is shown as its best and worst ends (LIST_END_SIZE each). */
export const LIST_SHOW_ALL_UP_TO = 20
export const LIST_END_SIZE = 10

export const LICENSE_URL = 'https://creativecommons.org/licenses/by/4.0/'
export const LICENSE_NAME = 'CC BY 4.0'
export const DATA_PATH = '/data'
export const CSV_PATH = '/data/employer-response-rates.csv'
export const JSON_PATH = '/data/employer-response-rates.json'
export const METHODS_PATH = '/methods'
export const DATASET_NAME = 'Employer response rates, from applicant reports'

/** A score row as lib/growth.ts growthScoreFromRow returns it (only the fields read here). */
export type ScoreInput = NonNullable<MetaScore> & {
  company_name?: string | null
  industry?: string | null
  updated_at?: string | null
}

export interface DatasetRow {
  /** Display name ("Bank of America"). */
  company: string
  /** Stored company_scores name ("bank of america"). */
  storedName: string
  url: string
  path: string
  agency: boolean
  industry: string | null
  grade: string
  score: number
  /** Share of applicants who hear back, as a whole percent; null when too few reports for a rate. */
  responsePct: number | null
  /** Share of applicants who never hear back, as a whole percent; null when too few reports. */
  ghostPct: number | null
  /** First-party applicant reports with an outcome (the company page's "N applicant reports"). */
  reports: number
  /** Of `reports`, how many were found in public posts (Reddit threads, review sites); null when unknown. */
  publicReports: number | null
  /** Online mentions behind the grade (each counts half). */
  mentions: number
  waitDays: number | null
  /** "YYYY-MM-DD" (California) of the score's last recompute, or null. */
  updated: string | null
  fact: FactLine
}

export interface Dataset {
  asOf: Date
  /** "2026-10-24" */
  asOfDate: string
  /** "October 24, 2026" */
  asOfLabel: string
  /** "October 2026" */
  month: string
  attribution: string
  rows: DatasetRow[]
  totals: {
    companies: number
    reports: number
    /** Sum of publicReports, or null when any row's split is unknown. */
    publicReports: number | null
    mentions: number
    withRates: number
    agencies: number
  }
  /** Earliest score write among the rows ("YYYY-MM-DD"), for temporalCoverage; null when unknown. */
  earliest: string | null
}

const ALIASES: ReadonlySet<string> = new Set(STAFFING_AGENCIES.flatMap((a) => a.aliases))
const norm = (s: string | null | undefined) => String(s ?? '').toLowerCase().trim().replace(/\s+/g, ' ')

/**
 * A staffing / recruiting agency: one of the /agencies index's curated names (exact alias match, the
 * index's own rule), or a company whose stored industry says "staffing".
 */
export function isStaffingAgency(storedName: string | null | undefined, industry?: string | null): boolean {
  if (ALIASES.has(norm(storedName))) return true
  return /\bstaffing\b/i.test(String(industry ?? ''))
}

const byReportsThenName = (a: DatasetRow, b: DatasetRow) => b.reports - a.reports || a.company.localeCompare(b.company)

/**
 * Build the dataset from mapped score rows. `publicCounts` maps a lowercased stored name to the number of
 * its scorable, resolved report rows found in public posts; pass null when that read failed (the split is
 * then unknown everywhere, never guessed).
 */
export function buildDataset(scores: ScoreInput[], publicCounts: Map<string, number> | null, asOf: Date = new Date()): Dataset {
  const rows: DatasetRow[] = []
  const seen = new Set<string>()
  let earliestMs = Infinity
  for (const s of scores) {
    const storedName = String(s?.company_name ?? '').trim()
    const key = norm(storedName)
    if (!key || seen.has(key)) continue
    const name = displayCompanyName(storedName)
    const facts = companyMetaFacts(name, s, null)
    const agency = isStaffingAgency(storedName, s.industry)
    const fact = companyFactLine(facts, { asOf, agency, storedName })
    if (!fact || facts.score == null || !facts.grade) continue // not gradeable: no verdict to publish
    seen.add(key)
    const pub = publicCounts ? Math.min(Math.max(0, Math.floor(publicCounts.get(key) ?? 0)), facts.reportCount) : null
    const updatedMs = s.updated_at ? Date.parse(s.updated_at) : NaN
    if (Number.isFinite(updatedMs)) earliestMs = Math.min(earliestMs, updatedMs)
    rows.push({
      company: name,
      storedName,
      url: fact.url,
      path: fact.url.slice(SITE_ORIGIN.length),
      agency,
      industry: s.industry ?? null,
      grade: facts.grade,
      score: facts.score,
      responsePct: facts.ratesShown ? facts.respPct : null,
      ghostPct: facts.ratesShown ? facts.ghostPct : null,
      reports: facts.reportCount,
      publicReports: pub,
      mentions: facts.mentions,
      waitDays: facts.waitDays,
      updated: Number.isFinite(updatedMs) ? pacificDate(new Date(updatedMs)) : null,
      fact,
    })
  }
  rows.sort(byReportsThenName)
  const totals = {
    companies: rows.length,
    reports: rows.reduce((n, r) => n + r.reports, 0),
    publicReports: publicCounts ? rows.reduce((n, r) => n + (r.publicReports ?? 0), 0) : null,
    mentions: rows.reduce((n, r) => n + r.mentions, 0),
    withRates: rows.filter((r) => r.responsePct != null).length,
    agencies: rows.filter((r) => r.agency).length,
  }
  return {
    asOf,
    asOfDate: pacificDate(asOf),
    asOfLabel: formatPacific(asOf, { dateStyle: 'long' }),
    month: longMonth(asOf),
    attribution: attributionLine(asOf),
    rows,
    totals,
    earliest: Number.isFinite(earliestMs) ? pacificDate(new Date(earliestMs)) : null,
  }
}

// ── Wording helpers ──────────────────────────────────────────────────────────────────────────────

export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`

/** "A", "A and B", "A, B and C". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** The one-sentence summary at the top of /data (also the dataset description's first sentence). */
export function datasetSummary(d: Dataset): string {
  const t = d.totals
  if (t.companies === 0) return `As of ${d.asOfLabel}, no company on Seen has enough applicant reports for a grade.`
  const pub = t.publicReports != null && t.publicReports > 0
    ? `; ${t.publicReports.toLocaleString('en-US')} of those reports ${t.publicReports === 1 ? 'was' : 'were'} found in public posts such as Reddit threads and review sites, not submitted to Seen`
    : ''
  return `As of ${d.asOfLabel}, Seen grades ${plural(t.companies, 'company', 'companies')} from ${plural(t.reports, 'applicant report')}${pub}.`
}

// ── CSV / JSON ───────────────────────────────────────────────────────────────────────────────────

export const CSV_COLUMNS = [
  'company', 'company_page', 'seen_grade', 'seen_score', 'response_rate_pct', 'ghost_rate_pct',
  'applicant_reports', 'from_public_posts', 'online_mentions', 'typical_wait_days', 'staffing_agency',
  'last_updated', 'fact',
] as const

/**
 * One CSV cell (RFC 4180): quoted when it holds a comma, quote, or line break, quotes doubled. A text cell
 * that a spreadsheet would run as a formula (= + - @, tab, CR) is prefixed with an apostrophe.
 */
export function csvCell(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : ''
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  let s = String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function datasetCsv(d: Dataset): string {
  const lines = [CSV_COLUMNS.join(',')]
  for (const r of d.rows) {
    lines.push([
      r.company, r.url, r.grade, r.score, r.responsePct, r.ghostPct, r.reports, r.publicReports,
      r.mentions, r.waitDays, r.agency, r.updated, r.fact.sentence,
    ].map(csvCell).join(','))
  }
  return `${lines.join('\r\n')}\r\n`
}

export const FIELD_DESCRIPTIONS: Record<(typeof CSV_COLUMNS)[number], string> = {
  company: 'Company name as shown on Seen.',
  company_page: 'The company page on Seen, with the reports behind the numbers.',
  seen_grade: 'Letter grade from seen_score: A 80+, B 65+, C 50+, D 35+, F below 35.',
  seen_score: 'Seen Grade score, 0 to 100, from applicant-reported outcomes.',
  response_rate_pct: `Share of applicants who heard back from a person (a screen, interview, rejection or offer), whole percent. Empty below ${MIN_REPORTS_FOR_RATES} applicant reports.`,
  ghost_rate_pct: `Share of applicants who never heard back, whole percent. Automated rejections count in neither rate. Empty below ${MIN_REPORTS_FOR_RATES} applicant reports.`,
  applicant_reports: 'Applicant reports with an outcome behind the numbers: submitted to Seen, or first-hand accounts found in public posts.',
  from_public_posts: 'Of applicant_reports, how many were found in public posts (Reddit threads, review sites) rather than submitted to Seen. Empty when unknown.',
  online_mentions: 'Quoted online accounts of a hiring outcome; each counts half a report in the rates.',
  typical_wait_days: 'Typical days until a first reply, when reported.',
  staffing_agency: 'true for staffing and recruiting agencies.',
  last_updated: 'Date (California time) the company’s grade was last recomputed.',
  fact: 'The one-sentence fact Seen publishes for the company, with its basis and month.',
}

export function datasetJson(d: Dataset) {
  return {
    name: DATASET_NAME,
    description: datasetSummary(d),
    url: `${SITE_ORIGIN}${DATA_PATH}`,
    methods: `${SITE_ORIGIN}${METHODS_PATH}`,
    license: LICENSE_URL,
    license_name: LICENSE_NAME,
    attribution: d.attribution,
    as_of: d.asOf.toISOString(),
    as_of_date: d.asOfDate,
    note: 'Applicant reports are self-reported claims, not verified facts. Rates are shown only for companies with at least '
      + `${MIN_REPORTS_FOR_RATES} applicant reports.`,
    totals: {
      companies: d.totals.companies,
      applicant_reports: d.totals.reports,
      from_public_posts: d.totals.publicReports,
      online_mentions: d.totals.mentions,
      companies_with_rates: d.totals.withRates,
    },
    fields: FIELD_DESCRIPTIONS,
    companies: d.rows.map((r) => ({
      company: r.company,
      company_page: r.url,
      seen_grade: r.grade,
      seen_score: r.score,
      response_rate_pct: r.responsePct,
      ghost_rate_pct: r.ghostPct,
      applicant_reports: r.reports,
      from_public_posts: r.publicReports,
      online_mentions: r.mentions,
      typical_wait_days: r.waitDays,
      staffing_agency: r.agency,
      last_updated: r.updated,
      fact: r.fact.sentence,
    })),
  }
}

// ── Monthly lists ────────────────────────────────────────────────────────────────────────────────

export type ListSlug = 'employers-that-respond' | 'staffing-agencies-ghosting'
export const LIST_SLUGS: ListSlug[] = ['employers-that-respond', 'staffing-agencies-ghosting']

export interface ListSection { title: string; startRank: number; rows: DatasetRow[] }

export interface RankedList {
  slug: ListSlug
  path: string
  /** <title>, no dashes. */
  title: string
  h1: string
  /** The quotable lead sentence(s). */
  lead: string
  /** Meta description (the lead, clipped by sentence). */
  description: string
  eyebrow: string
  cutoff: number
  /** Every row meeting the cutoff, in ranked order (best first for "respond", most ghosting first for "ghosting"). */
  ranked: DatasetRow[]
  /** What the page shows of `ranked`: one table, or its best and worst ends. */
  sections: ListSection[]
  /** True when fewer than LIST_FULL_SIZE rows qualify. */
  thin: boolean
  thinNote: string
  /** Rows with a rate but under the cutoff: shown for reference, never ranked. */
  below: DatasetRow[]
  belowSections: ListSection[]
  /** "N applicant reports say 89% heard back" for one row. */
  rowSay: (r: DatasetRow) => string
  metricLabel: string
  metric: (r: DatasetRow) => number
  month: string
}

const ENTITY: Record<ListSlug, { one: string; many: string }> = {
  'employers-that-respond': { one: 'employer', many: 'employers' },
  'staffing-agencies-ghosting': { one: 'staffing agency', many: 'staffing agencies' },
}

function endsOf(rows: DatasetRow[], kind: ListSlug): ListSection[] {
  if (rows.length === 0) return []
  if (rows.length <= LIST_SHOW_ALL_UP_TO) return [{ title: '', startRank: 1, rows }]
  const [best, worst] = kind === 'employers-that-respond'
    ? ['Replies to the most applicants', 'Replies to the fewest applicants']
    : ['Ghosts the most applicants', 'Ghosts the fewest applicants']
  return [
    { title: best, startRank: 1, rows: rows.slice(0, LIST_END_SIZE) },
    { title: worst, startRank: rows.length - LIST_END_SIZE + 1, rows: rows.slice(-LIST_END_SIZE) },
  ]
}

/** Names sharing the leading value of `metric` (rounded percent) at the start of `rows`. */
function tiedAtTop(rows: DatasetRow[], metric: (r: DatasetRow) => number): string[] {
  if (rows.length === 0) return []
  const v = metric(rows[0])
  return rows.filter((r) => metric(r) === v).map((r) => r.company)
}

export function buildList(slug: ListSlug, d: Dataset, cutoff = LIST_MIN_REPORTS): RankedList {
  const respond = slug === 'employers-that-respond'
  const ent = ENTITY[slug]
  const metric = respond ? (r: DatasetRow) => r.responsePct ?? 0 : (r: DatasetRow) => r.ghostPct ?? 0
  const pool = d.rows.filter((r) => r.responsePct != null && r.ghostPct != null && (respond ? !r.agency : r.agency))
  const sort = (a: DatasetRow, b: DatasetRow) => metric(b) - metric(a) || b.reports - a.reports || a.company.localeCompare(b.company)
  const ranked = pool.filter((r) => r.reports >= cutoff).sort(sort)
  const below = pool.filter((r) => r.reports < cutoff).sort(sort)
  const n = ranked.length
  const verbOne = respond ? 'replies to' : 'ghosts'
  const verbMany = respond ? 'reply to' : 'ghost'
  const unit = respond ? 'hear back' : 'never hear back'

  const top = tiedAtTop(ranked, metric)
  // The bottom end, read from the worst row upward (ties share a value).
  const reversed = [...ranked].reverse()
  const bottom = tiedAtTop(reversed, metric).filter((name) => !top.includes(name))
  const topPct = n ? metric(ranked[0]) : 0
  const bottomPct = n ? metric(reversed[0]) : 0
  const verb = (names: string[]) => (names.length === 1 ? verbOne : verbMany)

  let lead: string
  let h1: string
  if (n === 0) {
    lead = `No ${ent.one} has ${cutoff} or more applicant reports on Seen yet, so there is no ranking this month.`
    h1 = respond ? 'Employers that respond to applicants' : 'Staffing agencies that ghost applicants'
  } else if (n === 1) {
    const r = ranked[0]
    lead = `Only 1 ${ent.one} has ${cutoff} or more applicant reports on Seen: ${r.company}, where ${metric(r)}% of applicants ${unit} (${plural(r.reports, 'applicant report')}).`
    h1 = `${r.company}: ${metric(r)}% of applicants ${unit}`
  } else {
    lead = `Of the ${plural(n, ent.one, ent.many)} with ${cutoff} or more applicant reports on Seen, ${joinNames(top)} ${verb(top)} the most applicants: ${topPct}% ${respond ? 'hear back' : 'never hear back'}.`
    if (bottom.length && bottomPct !== topPct) lead += ` ${joinNames(bottom)} ${verb(bottom)} the fewest: ${bottomPct}%.`
    h1 = `${joinNames(top)} ${verb(top)} the most applicants: ${topPct}% ${unit}`
  }

  const thin = n < LIST_FULL_SIZE
  const thinNote = !thin ? '' : n === 0
    ? `No ${ent.one} meets the ${cutoff} report cutoff yet.`
    : `Only ${plural(n, ent.one, ent.many)} ${n === 1 ? 'meets' : 'meet'} the ${cutoff} report cutoff this month, fewer than ${LIST_FULL_SIZE}, so this is not yet a full ranking. ${n === 1 ? 'It is' : 'All of them are'} shown below.`

  const rowSay = (r: DatasetRow) => respond
    ? `${plural(r.reports, 'applicant report')} say ${r.responsePct}% heard back`
    : `${plural(r.reports, 'applicant report')} say ${r.ghostPct}% never heard back`

  const title = respond ? `Employers that respond to applicants, ${d.month}` : `Staffing agencies that ghost applicants, ${d.month}`
  return {
    slug,
    path: `/lists/${slug}`,
    title,
    h1,
    lead,
    description: lead.length > 300 ? lead.split(/(?<=\.)\s+/)[0] : lead,
    eyebrow: `Monthly list · Updated ${d.month}`,
    cutoff,
    ranked,
    sections: endsOf(ranked, slug),
    thin,
    thinNote,
    below,
    belowSections: endsOf(below, slug),
    rowSay,
    metricLabel: respond ? 'Hear back' : 'Never hear back',
    metric,
    month: d.month,
  }
}

/** schema.org ItemList for a ranked list (ranked rows only; rows under the cutoff are not part of it). */
export function listJsonLd(l: RankedList) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: l.title,
    description: l.lead,
    url: `${SITE_ORIGIN}${l.path}`,
    itemListOrder: 'https://schema.org/ItemListOrderDescending',
    numberOfItems: l.ranked.length,
    itemListElement: l.ranked.map((r, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: r.company,
      url: r.url,
      description: `${l.rowSay(r)} (${r.fact.month}).`,
    })),
  }
}

export { companyPageUrl }

// Companies, made safe for the screen (pure — companies.test.mjs). A count the server could not read is
// null ("couldn't read"), never 0.
import { formatPacific } from '../../../../lib/time/pacific.js'
import { displayCompanyName } from '../../../../lib/companyNames.js'

export const fmt = (n: number) => Math.round(n).toLocaleString('en-US')
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null)
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))

export type CompanyRow = { id: string; name: string; overall_score: number | null; report_count: number | null; ghost_rate: number | null; response_rate: number | null }

export function readCompanyRow(r: unknown): CompanyRow {
  const o = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>
  return { id: str(o.id), name: str(o.name ?? o.company_name), overall_score: num(o.overall_score), report_count: num(o.report_count), ghost_rate: num(o.ghost_rate), response_rate: num(o.response_rate) }
}

const pct = (v: number | null) => (v === null ? null : `${Math.round((v <= 1 ? v * 100 : v))}%`)

/** "Score 63 · 412 applicant accounts counted · 31% ghosted · 54% heard back". */
export function companyLine(c: CompanyRow): string {
  const parts = [
    c.overall_score === null ? 'No score yet' : `Score ${Math.round(c.overall_score)}`,
    c.report_count === null ? '' : `${fmt(c.report_count)} applicant ${c.report_count === 1 ? 'account' : 'accounts'} counted`,
    pct(c.ghost_rate) ? `${pct(c.ghost_rate)} ghosted` : '',
    pct(c.response_rate) ? `${pct(c.response_rate)} heard back` : '',
  ]
  return parts.filter(Boolean).join(' · ')
}

/** Display name: stored names are lower-case keys ("walmart"); show them as a name. */
export function displayName(name: string): string {
  return displayCompanyName(name) || 'Unnamed company'
}

// ── One company (company_detail) ─────────────────────────────────────────────────────────────────
export type Merge = { id: string; created_at: string; primary_name: string; secondary_name: string; undone_at: string | null; moved_reports?: number | null }
export type CompanyDetail = {
  name: string
  score: Record<string, unknown> | null
  reportsTotal: number | null
  held: number | null
  merges: Merge[]
  perks: { featured_until?: string | null; verified_until?: string | null; sponsor_until?: string | null } | null
}

export const readMerge = (m: unknown): Merge => {
  const o = (m && typeof m === 'object' ? m : {}) as Record<string, unknown>
  return { id: str(o.id), created_at: str(o.created_at), primary_name: str(o.primary_name), secondary_name: str(o.secondary_name), undone_at: o.undone_at ? str(o.undone_at) : null, moved_reports: num(o.moved_reports) }
}

export function readCompanyDetail(raw: unknown): CompanyDetail | null {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const d = Array.isArray(o.rows) && o.rows[0] && typeof o.rows[0] === 'object' ? o.rows[0] as Record<string, unknown> : null
  if (!d) return null
  return {
    name: str(d.name),
    score: d.score && typeof d.score === 'object' ? d.score as Record<string, unknown> : null,
    reportsTotal: num(d.reports_total),
    held: num(d.held),
    merges: (Array.isArray(d.merges) ? d.merges : []).map(readMerge),
    perks: d.perks && typeof d.perks === 'object' ? d.perks as CompanyDetail['perks'] : null,
  }
}

export type Evidence = { label: string; value: number | null; what: string }

/** What the grade is built from, each count saying what it counts. Missing columns are left out. */
export function evidence(d: CompanyDetail): Evidence[] {
  const s = d.score || {}
  const out: Evidence[] = []
  const add = (key: string, label: string, what: string) => { if (key in s) out.push({ label, value: num(s[key]), what }) }
  add('first_party_report_count', 'Reports from Seen users', 'sent to Seen by people who applied; these weigh the most')
  add('report_count', 'Applicant accounts in the grade', 'reports from Seen users plus applicant accounts (public posts), each weighted by where it came from')
  add('employee_review_count', 'Employee reviews', 'move the grade a little by their letter grade; never counted as hiring outcomes')
  add('mention_count', 'Online mentions', 'public posts about applying here; each counts half')
  out.push({ label: 'Reports stored under this name', value: d.reportsTotal, what: 'every report row with this name, including held and rejected ones' })
  out.push({ label: 'Held for review', value: d.held, what: 'waiting in Review; not public, some not counted yet' })
  return out
}

export function scoreLine(d: CompanyDetail): string {
  const s = d.score
  if (!s) return 'No score yet: there are reports under this name but not enough to grade.'
  const sc = num(s.overall_score)
  const parts = [sc === null ? 'No score' : `Score ${Math.round(sc)} of 100`]
  const g = pct(num(s.ghost_rate)); if (g) parts.push(`${g} ghosted`)
  const r = pct(num(s.response_rate)); if (r) parts.push(`${r} heard back`)
  const w = num(s.avg_wait_days); if (w !== null) parts.push(`${Math.round(w)} days average wait`)
  return parts.join(' · ')
}

// ── Duplicate names (find_duplicates) ────────────────────────────────────────────────────────────
export type DupeGroup = { key: string; auto: boolean; companies: CompanyRow[] }
export function readDupeGroups(raw: unknown): { groups: DupeGroup[]; total: number | null } {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const src = Array.isArray(o.rows) ? o.rows : Array.isArray(o.duplicates) ? o.duplicates : []
  const groups = src.filter((g) => g && typeof g === 'object').map((g) => {
    const x = g as Record<string, unknown>
    return { key: str(x.key), auto: x.auto === true, companies: (Array.isArray(x.companies) ? x.companies : []).map(readCompanyRow) }
  }).filter((g) => g.companies.length > 1)
  return { groups, total: num(o.total) }
}

export function perkLines(p: CompanyDetail['perks'], now = Date.now()): string[] {
  if (!p) return []
  const out: string[] = []
  const one = (v: string | null | undefined, label: string) => {
    if (!v) return
    const t = Date.parse(v)
    if (!Number.isFinite(t)) return
    out.push(`${label} ${t > now ? 'until' : 'ended'} ${formatPacific(new Date(t), { dateStyle: 'medium' })}`)
  }
  one(p.featured_until, 'Featured listings'); one(p.verified_until, 'Transparency Verified badge'); one(p.sponsor_until, 'Sponsorship')
  return out
}

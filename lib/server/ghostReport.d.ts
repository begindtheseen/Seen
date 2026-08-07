// Type surface for the pure ghostReport.js assembler (JS module, JSDoc-typed at runtime).
// Kept here so both the server page and the admin panel get the real report shape.

export type GhostRisk = 'safe' | 'warn' | 'danger'

export interface GhostReportInputRow {
  name: string
  industry?: string | null
  verified?: boolean
  score: {
    overall_score: number
    ghost_rate: number | null
    response_rate: number | null
    avg_wait_days: number | null
    report_count: number
    risk_level: GhostRisk | string
    waste?: number
  }
}

export interface GhostReportRow {
  name: string
  industry: string | null
  reportCount: number
  ghostPct: number | null
  replyPct: number | null
  avgWaitDays: number | null
  overallScore: number
  riskLevel: GhostRisk | string
  isAgency: boolean
  thin: boolean
}

export interface GhostReportHeadline {
  companiesTracked: number
  agenciesTracked: number
  reportsTotal: number
  avgGhostRatePct: number | null
  avgWaitDays: number | null
  reportedCount: number
  thin: boolean
}

export interface GhostReport {
  weekNumber: number | null
  weekLabel: string | null
  generatedAt: string | null
  headline: GhostReportHeadline
  worstOffenders: GhostReportRow[]
  responseLeaders: GhostReportRow[]
  agencySpotlight: GhostReportRow | null
  hasReported: boolean
}

export interface AssembleGhostReportOptions {
  agencyNames?: string[]
  minReports?: number
  topN?: number
  weekNumber?: number
  weekLabel?: string
  generatedAt?: string
}

export function assembleGhostReport(
  rows: readonly GhostReportInputRow[] | null | undefined,
  opts?: AssembleGhostReportOptions,
): GhostReport

export function pickHeadline(report: GhostReport): string

export function buildCaption(report: GhostReport, site?: string): string

export function weekProvenance(date: Date | number | string): { weekLabel: string; weekNumber: number }

// Server-only reader for public.company_summaries (migration 20261017120100) — the offline,
// numerically-grounded "What applicants report" paragraph on a company page (GEO: real-data-first
// text that search engines and AI answer engines can quote).
//
// SAFE BEFORE THE SCHEMA EXISTS (CLAUDE.md "deploy code before schema"): a missing table (PostgREST
// 404), missing creds, a timeout, or any malformed row all return null, and the page renders exactly
// as it did before. Only status = 'ok' rows with non-empty text are returned.
//
// Same direct-from-Supabase, service-key, timeout-guarded pattern as lib/growth.ts (never a self-fetch
// of the live API; the key is not NEXT_PUBLIC_ and is referenced only inside this server function).
// Wrapped in React cache() so generateMetadata and the layout render share one read per request.

import { cache } from 'react'
import { PACIFIC } from './time/pacific.js';

export type CompanySummary = {
  company_name: string
  summary: string
  data_basis: string | null
  report_count_at_generation: number
  generated_at: string
}

const FETCH_TIMEOUT_MS = 2500

async function readSummary(storedName: string): Promise<CompanySummary | null> {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  const name = String(storedName || '').toLowerCase().trim()
  if (!url || !key || !name) return null
  try {
    const r = await fetch(
      `${url}/rest/v1/company_summaries?company_name=eq.${encodeURIComponent(name)}&status=eq.ok&select=company_name,summary,data_basis,report_count_at_generation,generated_at&limit=1`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
    )
    if (!r.ok) return null
    const row = (await r.json())?.[0]
    if (!row || typeof row.summary !== 'string' || !row.summary.trim()) return null
    return {
      company_name: String(row.company_name),
      summary: row.summary.trim(),
      data_basis: typeof row.data_basis === 'string' && row.data_basis ? row.data_basis : null,
      report_count_at_generation: Number(row.report_count_at_generation) || 0,
      generated_at: String(row.generated_at || ''),
    }
  } catch {
    return null
  }
}

/** One company's summary by its STORED company_scores name (lower(trim)). Null when absent. */
export const getCompanySummary = cache(readSummary)

/** "October 2026" from an ISO timestamp, or null. Fixed locale + California time so SSR output is stable. */
export function summaryMonth(iso: string): string | null {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  return new Date(t).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: PACIFIC })
}

import { NextResponse } from 'next/server'

// Server-side read of the PUBLIC community outcome reports for one company, by name.
//
// Why this exists: employers have no login (migration 050) and the `reports` table is NOT
// granted to the anon Postgres role (a direct anon-key read returns 42501 permission denied —
// only the seeker app's authenticated sessions can read it client-side). So, exactly like the
// rest of the app's server reads (api/reports.js, api/jobs.js), the dashboard reads reports
// with the service key ON THE SERVER and returns only public, aggregate-safe columns
// (role / outcome / date / experience level) — never applicant contact data (there is none in
// this table to leak). This is the same public corpus the company_score aggregate is built
// from; here we return the recent rows so the dashboard can show a per-posting breakdown and a
// recent-activity feed.
//
// In scope for this PR: a NEW file under app/employers/dashboard/. It does not touch the shared
// api/*.js functions. Wildcards follow the repo's PostgREST convention (`ilike.*term*`, see
// api/jobs.js) — PostgREST maps `*` to SQL `%`.

export const dynamic = 'force-dynamic'

const PUBLIC_COLS = 'role,outcome,created_at,experience_level'

export async function GET(req: Request) {
  const raw = (new URL(req.url).searchParams.get('company') || '').trim()
  // Company names never contain PostgREST filter metacharacters; strip them so a crafted
  // value can't alter the filter. Empty after sanitizing → nothing to look up.
  const company = raw.replace(/[,%*()"\\<>`]/g, '').slice(0, 120).trim()
  if (!company) return NextResponse.json({ reports: [] })

  const SUPABASE_URL = process.env.SUPABASE_URL
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY
  // Fail soft (empty, not an error) when the DB isn't configured — mirrors api/jobs.js.
  if (!SUPABASE_URL || !SERVICE_KEY) return NextResponse.json({ reports: [] })

  try {
    const q =
      `${SUPABASE_URL}/rest/v1/reports` +
      `?company_name=ilike.*${encodeURIComponent(company)}*` +
      `&select=${PUBLIC_COLS}` +
      `&order=created_at.desc` +
      `&limit=60`
    const r = await fetch(q, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    })
    if (!r.ok) return NextResponse.json({ reports: [] })
    const rows = await r.json()
    const reports = (Array.isArray(rows) ? rows : []).map((row: Record<string, unknown>) => ({
      role: typeof row.role === 'string' ? row.role : null,
      outcome: typeof row.outcome === 'string' ? row.outcome : null,
      created_at: typeof row.created_at === 'string' ? row.created_at : null,
      experience_level: typeof row.experience_level === 'string' ? row.experience_level : null,
    }))
    // Public aggregate data — cache at the edge like the company_score path does.
    return NextResponse.json(
      { reports },
      { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } },
    )
  } catch {
    return NextResponse.json({ reports: [] })
  }
}

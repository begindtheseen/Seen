// Demand-data grouping — pure business logic for the public GET /api/demand read.
//
// Extracted from api/demand.js so it can be unit-tested in isolation (it has no
// HTTP, env, or Supabase dependencies). The route stays thin and delegates here.
//
// Behavior is a faithful port of the original inline grouping: rows are grouped by
// city, each row becomes a compact job entry, and the newest `updated_at` and first
// non-empty `bls_period` are surfaced.

export interface DemandRow {
  city: string
  urg?: string | null
  src?: string | null
  role_title?: string | null
  niche?: string | null
  level?: string | null
  count?: number | null
  di?: number | null
  note?: string | null
  updated_at?: string | null
  bls_period?: string | null
}

export interface DemandJob {
  t?: string | null
  n?: string | null
  l?: string | null
  count?: number | null
  di?: number | null
  note: string
}

export interface DemandCity {
  city: string
  urg?: string | null
  src?: string | null
  jobs: DemandJob[]
}

export interface GroupedDemand {
  demand: DemandCity[]
  // Newest row `updated_at`, or null when none of the rows carry one. The route
  // applies the `|| now` fallback when shaping the response (kept out of here so
  // this function stays deterministic and testable).
  generated_at: string | null
  bls_period: string | null
  row_count: number
}

export function groupDemandRows(rawRows: DemandRow[]): GroupedDemand {
  const cityMap = new Map<string, DemandCity>()
  let latestUpdatedAt: string | null = null
  let blsPeriod: string | null = null

  for (const row of rawRows) {
    if (!cityMap.has(row.city)) {
      cityMap.set(row.city, { city: row.city, urg: row.urg, src: row.src, jobs: [] })
    }
    cityMap.get(row.city)!.jobs.push({
      t: row.role_title,
      n: row.niche,
      l: row.level,
      count: row.count,
      di: row.di,
      note: row.note || '',
    })
    if (row.updated_at && (!latestUpdatedAt || row.updated_at > latestUpdatedAt)) {
      latestUpdatedAt = row.updated_at
    }
    if (row.bls_period && !blsPeriod) blsPeriod = row.bls_period
  }

  return {
    demand: Array.from(cityMap.values()),
    generated_at: latestUpdatedAt,
    bls_period: blsPeriod,
    row_count: rawRows.length,
  }
}

'use client'

// The company page's FIRST PAINT: the stored score row the layout already reads on the server
// (lib/growth.ts getScore — the same row its <title>, meta description, H1 paragraph and OG card use)
// handed to the client page, so the grade, the answer sentence and the stats are in the server HTML.
// The page then reads the live score from /api/reports as before and replaces it.
//
// Why (conversion audit 2026-10-24): the hero waited for the JS bundle to hydrate AND a client fetch,
// so on a mid-range phone over 4G the answer painted at ~4.1 s. Only a GRADEABLE row is seeded; an
// ungraded or unknown company keeps the loading state until the API answers (no verdict is guessed).

import { createContext, useContext, type ReactNode } from 'react'

export type CompanySeedScore = {
  gradeable: true
  overall_score: number
  response_rate: number | null
  ghost_rate: number | null
  avg_wait_days: number | null
  avg_rounds: number | null
  waste: number | null
  report_count: number
  first_party_report_count: number | null
  web_report_count: number | null
  mention_count: number | null
  risk_level: 'safe' | 'warn' | 'danger' | null
  data_quality: string | null
  data_source: string | null
  industry: string | null
  updated_at: string | null
}

const SeedContext = createContext<CompanySeedScore | null>(null)

export function CompanySeedProvider({ seed, children }: { seed: CompanySeedScore | null; children: ReactNode }) {
  return <SeedContext.Provider value={seed}>{children}</SeedContext.Provider>
}

export function useCompanySeed(): CompanySeedScore | null {
  return useContext(SeedContext)
}

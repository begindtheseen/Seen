'use client'

// What the server knows about a company before the page hydrates (app/company/[slug]/layout.tsx): the three
// answers (lib/company/answers.js) and the listing signals of its own job posts (lib/server/listingSignals.js).
// Handed to the client page through context so both are in the server HTML; the page never recomputes them,
// so the FAQPage JSON-LD the layout publishes and the visible answers are the same strings.

import { createContext, useContext, type ReactNode } from 'react'

export type CompanyAnswer = { id: 'respond' | 'wait' | 'who'; question: string; sentence: string; detail: string; known: boolean }
export type CompanyAnswersData = {
  name: string
  graded: boolean
  accounts: number
  hasData: boolean
  answers: CompanyAnswer[]
}
export type ListingFacts = { open: number; payPct?: number; directPct?: number; longOpenPct?: number | null; datedPosts?: number }
export type ListingSignalsData =
  | { rated: true; listings: number; score: number; band: 'clear' | 'mixed' | 'thin'; label: string; factors: Array<{ key: string; label: string; value: number; weight: number; detail: string }>; basis: string; facts: ListingFacts }
  | { rated: false; listings: number; reason: string; facts?: ListingFacts }

type Seed = { answers: CompanyAnswersData | null; listing: ListingSignalsData | null }
const Ctx = createContext<Seed>({ answers: null, listing: null })

export function CompanyAnswersSeedProvider({ answers, listing, children }: Seed & { children: ReactNode }) {
  return <Ctx.Provider value={{ answers, listing }}>{children}</Ctx.Provider>
}

export function useCompanyAnswersSeed(): Seed {
  return useContext(Ctx)
}

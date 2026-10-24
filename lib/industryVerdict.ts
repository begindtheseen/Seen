// The company page's one-line industry comparison ("Walmart vs its industry"), built from the SAME two
// numbers the card prints under it (this company's reply rate vs the peer average), and never allowed to
// contradict the letter grade above it.
//
// Conversion audit 2026-10-24: "Grade A" sat next to "Walmart is about average for Retail & E-Commerce"
// (87% vs an 81% average) — the old line came from a response PERCENTILE band (45–75 = "about average"),
// a different basis from both the grade and the bars. Now: the sentence states the reply-rate comparison
// the bars show; and when that comparison would read against the grade (an A that replies no more than
// average, a D/F that replies no less), the sentence is replaced by a neutral heading — the bars stay.
//
// Pure; relative .js import only so `node --test lib/industryVerdict.test.mjs` runs it as is.

import { gradeLetter } from './gradeScale.js'

export type BenchmarkLike = {
  scope: 'industry' | 'all'
  industry: string | null
  company: { response: number | null; score: number | null }
  average: { response: number | null }
}

export type IndustryVerdict = { tone: 'good' | 'warn' | 'bad' | 'neutral'; headline: string; detail: string; kind: 'above' | 'below' | 'same' | 'none' }

/** Reply rates this many points apart (as printed, whole percents) count as "about the same". */
export const SAME_BAND_PTS = 3

export function industryVerdict(b: BenchmarkLike, name: string): IndustryVerdict {
  const where = b.scope === 'industry' && b.industry ? b.industry : 'employers on Seen'
  const peer = b.scope === 'industry' && b.industry ? `${b.industry} employer on Seen` : 'employer on Seen'
  const neutral: IndustryVerdict = { tone: 'neutral', kind: 'none', headline: `How ${name} compares with ${where}`, detail: 'Side by side with its peers. The grade above also weighs ghosting, wait time and how much evidence there is.' }
  const c = b.company.response
  const a = b.average.response
  if (c == null || a == null || !Number.isFinite(c) || !Number.isFinite(a)) return neutral
  const you = Math.round(c * 100)
  const avg = Math.round(a * 100)
  const diff = you - avg
  const kind: IndustryVerdict['kind'] = diff >= SAME_BAND_PTS ? 'above' : diff <= -SAME_BAND_PTS ? 'below' : 'same'
  const grade = typeof b.company.score === 'number' && Number.isFinite(b.company.score) ? gradeLetter(b.company.score) : null
  if ((grade === 'A' && kind !== 'above') || ((grade === 'D' || grade === 'F') && kind !== 'below')) return neutral
  const nums = `(${you}% vs ${avg}%)`
  if (kind === 'above') return { tone: 'good', kind, headline: `${name} replies to more applicants than the average ${peer} ${nums}`, detail: 'Better odds of hearing back than at the typical employer in its industry.' }
  if (kind === 'below') return { tone: 'bad', kind, headline: `${name} replies to fewer applicants than the average ${peer} ${nums}`, detail: 'The typical employer in its industry responds more often — factor that into your effort.' }
  return { tone: 'neutral', kind, headline: `${name} replies to about as many applicants as the average ${peer} ${nums}`, detail: 'About the same odds of hearing back as elsewhere in its industry.' }
}

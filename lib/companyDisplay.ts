// ONE place for how a company is shown: its display name, its letter grade, and the "last updated"
// line under a grade. Pure (no I/O) — imported by client components, server components, the OG
// image and the api/*.js handlers alike, so the page, the share card, the leaderboard, the feed and
// the unfurl can never disagree (audit 2026-10-23: the page said "A · 91" while the grade card said
// "A+", /companies showed "aaa" and "united wholesale mortgage", the ticker "albertsons").
//
// Stored data is never changed here: company_scores / reports keep their lowercase names.

import { NONTERMINAL_OUTCOMES } from '@/api/_utils/companyIntel.js'
import { formatPacific } from '@/lib/time/pacific.js'
import { looksLikeSlug, splitSlugWords } from '@/lib/jobs/companyName.js'

// ── Letter grade ─────────────────────────────────────────────────────────────────────────────────
// The one scale. 80+ A · 65+ B · 50+ C · 35+ D · else F (matches lib/growth.ts grade(), the OG
// image, the leaderboard and the score modal; the share card used a 13-step A+/A/A- scale that
// disagreed with the page it was opened from).
export function gradeLetter(score: number): string {
  if (score >= 80) return 'A'
  if (score >= 65) return 'B'
  if (score >= 50) return 'C'
  if (score >= 35) return 'D'
  return 'F'
}

// ── Display name ─────────────────────────────────────────────────────────────────────────────────
// Brands whose casing is not Title Case. Keys are the stored (lowercase) name or a single word of
// it; the value is how the brand writes itself. Small on purpose — add a line when a real company
// on the site renders wrong, never guess.
const BRAND_CASE: Record<string, string> = {
  "mcdonald's": "McDonald's", mcdonalds: "McDonald's", ebay: 'eBay', iheartmedia: 'iHeartMedia', pwc: 'PwC',
  ups: 'UPS', 'at&t': 'AT&T', aaa: 'AAA', ibm: 'IBM', cvs: 'CVS', hp: 'HP', '3m': '3M', kpmg: 'KPMG', ey: 'EY',
  bmw: 'BMW', usaa: 'USAA', fedex: 'FedEx', cdw: 'CDW', saic: 'SAIC', 'h&m': 'H&M', 't-mobile': 'T-Mobile',
  jpmorgan: 'JPMorgan', nvidia: 'NVIDIA', ubs: 'UBS', cbre: 'CBRE', adp: 'ADP', aecom: 'AECOM', bae: 'BAE',
  dhl: 'DHL', dsw: 'DSW', gnc: 'GNC', hca: 'HCA', kfc: 'KFC', lg: 'LG', nbcuniversal: 'NBCUniversal', pnc: 'PNC',
  pepsico: 'PepsiCo', usps: 'USPS', ulta: 'Ulta', wework: 'WeWork', 'o’reilly': 'O’Reilly',
  "o'reilly": "O'Reilly", linkedin: 'LinkedIn', paypal: 'PayPal', youtube: 'YouTube', github: 'GitHub',
  gitlab: 'GitLab', doordash: 'DoorDash', carmax: 'CarMax', petsmart: 'PetSmart', walgreens: 'Walgreens',
  'mistral.ai': 'Mistral AI', openai: 'OpenAI', deepmind: 'DeepMind', spacex: 'SpaceX', 'coca-cola': 'Coca-Cola',
  taskus: 'TaskUs', givewell: 'GiveWell', sosafe: 'SoSafe', adventhealth: 'AdventHealth', arcbest: 'ArcBest',
  sunrun: 'Sunrun', dupont: 'DuPont', servicenow: 'ServiceNow', salesforce: 'Salesforce', snowflake: 'Snowflake', uwm: 'UWM', 'ge': 'GE', 'td': 'TD', 'bny': 'BNY', 'rbc': 'RBC', 'hsbc': 'HSBC',
  'nyu': 'NYU', 'ucla': 'UCLA', 'usc': 'USC', 'mit': 'MIT', 'llc': 'LLC', 'inc': 'Inc', 'usa': 'USA', 'us': 'US',
}
// Words that stay lowercase inside a name ("Bank of America", "Barnes & Noble").
const SMALL_WORDS = new Set(['of', 'and', 'the', 'for', 'at', 'in', 'on', 'de', 'la', 'du', 'von', 'van', 'y'])

function caseWord(word: string, first: boolean): string {
  const lower = word.toLowerCase()
  if (BRAND_CASE[lower]) return BRAND_CASE[lower]
  if (!first && SMALL_WORDS.has(lower)) return lower
  // A short token with no vowel is an initialism ("pls" → "PLS", "ivc" → "IVC", "k2" → "K2");
  // "alo" has one and reads as a word ("Alo").
  if (lower.length <= 4 && /^[a-z0-9]+$/.test(lower) && !/[aeiouy]/.test(lower)) return lower.toUpperCase()
  // Capitalize the first letter and the letter after a hyphen ("e-commerce" → "E-Commerce",
  // "coca-cola" → "Coca-Cola"); never after an apostrophe ("lowe's" stays "Lowe's").
  return lower.replace(/(^|-)([a-zà-ÿ])/g, (_m, sep: string, c: string) => sep + c.toUpperCase())
}

/**
 * How a stored company name is shown: "walmart" → "Walmart", "united wholesale mortgage" →
 * "United Wholesale Mortgage", "aaa" → "AAA", "mcdonald's" → "McDonald's", "bank of america" →
 * "Bank of America". A name that already carries mixed case (an employer-typed "DoorDash") is
 * returned as is. Empty input → ''.
 *
 * ATS board slugs stored as company names (76% of active job rows, 2026-10-24: "plscareers",
 * "tactilemedical", "jpmorganchase") are read through lib/jobs/companyName.js first — board noise
 * dropped, category words split off, then cased here ("PLS", "Tactile Medical", "JPMorgan Chase").
 * A slug no rule can read is Title Cased whole ("Karllagerfeld"): a raw lowercase slug is never
 * shown. Stored data is untouched; the slug stays the data key for lookups.
 */
export function displayCompanyName(name: string | null | undefined): string {
  const raw = String(name ?? '').trim().replace(/\s+/g, ' ')
  if (!raw) return ''
  const whole = BRAND_CASE[raw.toLowerCase()]
  if (whole) return whole
  // Already mixed-case (not all lower, not all upper) → the author chose the casing; keep it.
  if (raw !== raw.toLowerCase() && raw !== raw.toUpperCase()) return raw
  const words = looksLikeSlug(raw) ? splitSlugWords(raw) : raw.split(' ')
  return words.map((w, i) => caseWord(w, i === 0)).join(' ')
}

// ── Outcomes ─────────────────────────────────────────────────────────────────────────────────────
/** A report with a decided outcome (ghosted / rejected / interview / offer …) — the rows a grade is built from. */
export function isResolvedOutcome(outcome: string | null | undefined): boolean {
  return !NONTERMINAL_OUTCOMES.has(String(outcome ?? '').toLowerCase().trim())
}

// ── Last updated ─────────────────────────────────────────────────────────────────────────────────
/** "Last updated Oct 20, 2026" in California time (owner decision 2026-10-21: no UTC anywhere). '' when unknown. */
export function lastUpdatedLabel(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `Last updated ${formatPacific(d, { dateStyle: 'medium' })}`
}

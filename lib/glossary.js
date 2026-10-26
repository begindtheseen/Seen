// THE glossary: one name per feature and one word per idea, so the product reads as one product
// (audit 2026-10-25 #32: reports vs reviews, Seen Grade / hiring grade / transparency score, Résumé AI vs
// Resume AI, Human Voice vs HumanProof, Optimize / Tailor / SeenFit / fit / match). The rewrite that keeps
// your own voice is HumanProof everywhere (the pricing sheet, the lock cards and the menu were unified on
// it; lib/pricing.test.mjs) — "Human Voice" and "Stealth" are the retired names.
// lib/glossary.test.mjs fails when a RETIRED term appears in user-facing copy under app/ or components/
// (string literals and JSX text — identifiers, comments and API field names are not copy).
//
// Plain JS so server components, client components, the api/*.js handlers and the test share it.

/** Feature names, exactly as a visitor reads them. */
export const FEATURES = Object.freeze({
  grade: 'Seen Grade',              // a company's letter (A+ … F) and score out of 100
  postingScore: 'Posting score',    // one job posting's transparency, 0–100 (pay shown, apply direct, …)
  tracker: 'Application tracker',
  resume: 'Résumé',                 // the /resume tools (one name while the tool is rebuilt — audit #1)
  humanProof: 'HumanProof',         // the Pro rewrite that keeps your own voice (never "Human Voice", never "Stealth")
  inboxAutopilot: 'Inbox Autopilot',
  agencyIndex: 'Agency Ghost Index',
  interviewPrep: 'Interview Prep',
  jobSearchPass: 'Job Search Pass',
  ghostReport: 'Ghost Report',
})

/**
 * Words for the evidence behind a grade. The distinction matters (audit #3): most of Seen's evidence
 * is first-hand posts found in public discussion, not reports people filed with Seen.
 *   applicant account  = one first-hand account of applying (a public post OR a report to Seen)
 *   from public posts  = accounts compiled from public discussion (Reddit, public review pages)
 *   from Seen users    = reports submitted to Seen by people who applied
 *   online mention     = a quoted account behind the score, counted at half weight
 *   employee review    = a workplace review; nudges the score, never a hiring outcome
 */
export const TERMS = Object.freeze({
  account: ['applicant account', 'applicant accounts'],
  mention: ['online mention', 'online mentions'],
  employeeReview: ['employee review', 'employee reviews'],
  publicPosts: 'from public posts',
  seenUsers: 'from Seen users',
  ghostRate: 'ghost rate',
  responseRate: 'response rate',
  wastedEffort: 'wasted-effort risk', // was "waste risk": the chance applying here costs effort for nothing
})

const plural = (n, [one, many]) => `${n} ${n === 1 ? one : many}`

/** "48 applicant accounts" */
export function accountsLabel(n) {
  const k = Math.max(0, Math.floor(Number(n) || 0))
  return plural(k, TERMS.account)
}

const seenPart = (n) => (n === 1 ? '1 from a Seen user' : `${n} ${TERMS.seenUsers}`)
const clean = (v) => (v == null ? null : Math.max(0, Math.floor(Number(v) || 0)))

/**
 * Where the accounts came from — "47 from public posts · 1 from a Seen user" (the hero badge). When the
 * split does not add up to the total (a list read at another moment than the stored score) only the
 * Seen-user count is named; when it is unknown, nothing is said. A zero is stated, not hidden: it is
 * the honest part ("48 from public posts · 0 from Seen users").
 * @param {number} total @param {number|null|undefined} fromPublic @param {number|null|undefined} fromSeen
 */
export function accountSources(total, fromPublic, fromSeen) {
  const t = clean(total) || 0
  const seen = clean(fromSeen), pub = clean(fromPublic)
  if (t === 0 || seen == null) return ''
  if (pub != null && pub + seen === t) return pub === 0 ? 'all from Seen users' : `${pub} ${TERMS.publicPosts} · ${seenPart(seen)}`
  return seenPart(seen)
}

/**
 * The full line: "47 applicant accounts from public posts · 1 from a Seen user". Split unknown →
 * "48 applicant accounts"; split partial → "48 applicant accounts · 2 from Seen users".
 */
export function accountsLine(total, fromPublic, fromSeen) {
  const t = clean(total) || 0
  const seen = clean(fromSeen), pub = clean(fromPublic)
  if (t === 0) return accountsLabel(0)
  if (seen == null) return accountsLabel(t)
  if (pub != null && pub + seen === t) {
    return pub === 0 ? `${accountsLabel(t)}, all from Seen users` : `${accountsLabel(pub)} ${TERMS.publicPosts} · ${seenPart(seen)}`
  }
  return `${accountsLabel(t)} · ${seenPart(seen)}`
}

/**
 * Terms that must not appear in user-facing copy. `use` is what to write instead. Checked by
 * lib/glossary.test.mjs over app/ and components/ (and the copy modules in COPY_MODULES).
 */
export const RETIRED_TERMS = Object.freeze([
  { re: /\bHuman Voice\b/, use: FEATURES.humanProof, why: 'one name for the voice-preserving rewrite' },
  { re: /\bStealth\b/, use: FEATURES.humanProof, why: 'authenticity framing (owner decision 2026-07-02)' },
  { re: /\bR[ée]sum[ée] AI\b/i, use: FEATURES.resume, why: 'one name for the résumé tools' },
  { re: /\bvibe tags?\b/i, use: 'say what the label says', why: 'jargon' },
  { re: /\bwaste risk\b/i, use: TERMS.wastedEffort, why: 'jargon; and it was coloured red when low' },
  { re: /Deterministic SeenFit Engine/i, use: 'say what it does in plain words', why: 'jargon' },
  { re: /\bapplicant reports?\b/i, use: 'applicant accounts (public posts) / reports from Seen users', why: 'most of the evidence is public posts, not reports filed with Seen (audit #3)' },
  { re: /\bpieces? of evidence\b/i, use: 'applicant accounts (mentions count half)', why: 'jargon' },
  { re: /\bNot enough reviews\b/i, use: 'Not enough applicant accounts', why: 'a grade is built from applicant accounts, not reviews' },
])

/** Copy modules outside app/ and components/ whose strings are user-facing (also checked). */
export const COPY_MODULES = Object.freeze([
  'lib/companyPageSummary.ts', 'lib/companyFactLine.ts', 'lib/gradeGate.ts', 'lib/cardCopy.js',
  'lib/server/companyFaq.js', 'lib/server/intentAnswers.js', 'lib/llmsText.ts', 'lib/companyMeta.ts',
  'lib/openDataset.ts', 'lib/agencies.ts', 'lib/score.ts', 'lib/growthCopy.js',
])

/**
 * Files still under rebuild by another workstream (résumé / optimizer, audit #1). They are skipped by
 * the retired-term check until that rebuild lands; nothing else may be added here.
 */
export const PENDING_REBUILD = Object.freeze([
  'app/resume/', 'components/resume/', 'components/optimizer/', 'components/ApplyOptimizeModal.tsx',
  'components/HumanProofPanel.tsx', 'components/SeenFitPanel.tsx',
])

/** The owner-only admin console: internal vocabulary, not public copy. */
export const INTERNAL = Object.freeze(['app/admin/', 'components/admin/'])

// Display-honesty helper for reports that did NOT come from a Seen user. Two third-party,
// attributed, low-trust (0.3) row shapes exist, and every surface that renders individual reports
// must label them so they never read as first-hand Seen submissions:
//
//   1. Reddit threads — platform "Reddit r/<subreddit>" (api/reports.js reddit_import).
//      Fusion: classifyPlatform → 'reddit' (/reddit/ anywhere in the platform string).
//   2. Public review sites / forums found by web search (scripts/credit/web-reports.mjs) — the
//      contract is platform "Public review · <hostname>", source 'web_public', outcome_weight 0.3,
//      trust_reason 'web_search_public_review'. Fusion: classifyPlatform → 'public_web'
//      (/^public review ·/i), checked BEFORE the reddit/ingest tests.
//
// These mirror api/_utils/companyIntel.js classifyPlatform exactly (kept self-contained so client
// bundles don't pull in the scoring module; lib/server/reportSource.test.mjs asserts they agree).
// Display only: scoring weights (SOURCE_TRUST) are untouched here.

import { pacificParts } from './time/pacific.js';
export const PUBLIC_REVIEW_PLATFORM_PREFIX = 'Public review · '
const PUBLIC_REVIEW_RE = /^public review ·\s*(.*)$/i
const HOST_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/

export const isRedditSourced = (platform?: string | null): boolean => {
  const p = String(platform ?? '')
  return !PUBLIC_REVIEW_RE.test(p) && /reddit/i.test(p)
}

/** Hostname of a "Public review · <host>" row (lowercased), or null for any other platform. */
export function publicReviewHost(platform?: string | null): string | null {
  const m = PUBLIC_REVIEW_RE.exec(String(platform ?? ''))
  if (!m) return null
  const host = m[1].trim().toLowerCase().replace(/^www\./, '')
  return HOST_RE.test(host) ? host : null
}

export const isPublicReviewSourced = (platform?: string | null): boolean =>
  PUBLIC_REVIEW_RE.test(String(platform ?? ''))

/** Any third-party, attributed, down-weighted source (Reddit thread OR public review site). */
export const isPublicDiscussion = (platform?: string | null): boolean =>
  isRedditSourced(platform) || isPublicReviewSourced(platform)

/** An employee review ("what it's like to work here") — shown, but never a hiring outcome or score input. */
// An admin-approved employee review is marked by trust_reason (lib/server/reportReview.js) even when
// its text does not say so; the ingest writes new ones the same way.
export const isEmployeeReview = (r: { report_text?: string | null; trust_reason?: string | null }): boolean =>
  r?.trust_reason === 'external_employee_review' || /\bemployee (?:review|discussion)\b/i.test(String(r?.report_text ?? ''))

// Same test as classifyPlatform's 'ingest' tier (api/_utils/companyIntel.js), so the label always
// matches how the row is weighted.
const IMPORT_SITE_RE = /glassdoor|blind|indeed|linkedin/i
const IMPORT_SITE_NAME: Record<string, string> = { glassdoor: 'Glassdoor', blind: 'Blind', indeed: 'Indeed', linkedin: 'LinkedIn' }
/** A review imported from a review site (Glassdoor / Indeed / LinkedIn / Blind) — not submitted to Seen. */
export const isImportedReview = (platform?: string | null): boolean =>
  !isPublicDiscussion(platform) && IMPORT_SITE_RE.test(String(platform ?? ''))
const importSiteName = (platform?: string | null): string => {
  const m = IMPORT_SITE_RE.exec(String(platform ?? ''))
  return m ? IMPORT_SITE_NAME[m[0].toLowerCase()] : ''
}

export const PUBLIC_DISCUSSION_LABEL = 'Sourced from public discussion'
export const PUBLIC_REVIEW_LABEL = 'Sourced from a public review site'

/** "Sourced from a public review site (glassdoor.com)" — host omitted if it can't be parsed. */
export const publicReviewLabel = (host?: string | null): string =>
  host ? `${PUBLIC_REVIEW_LABEL} (${host})` : PUBLIC_REVIEW_LABEL

/**
 * The honest provenance badge for a report row, or null for first-hand Seen reports.
 * `label` is the visible text; `title` is the hover explanation.
 */
export function reportSourceBadge(platform?: string | null, reportText?: string | null): { label: string; title: string } | null {
  const site = importSiteName(platform) || String(platform ?? '').trim().split(/\s+/)[0]
  if (isEmployeeReview({ report_text: reportText })) {
    return {
      label: `Employee review${site ? ` · ${site}` : ''}`,
      title: 'A current or former employee describing what it is like to work here, imported from a review site. It is not a hiring outcome, so it never counts as an applicant report — its letter grade adjusts the score by a small, capped amount.',
    }
  }
  if (isImportedReview(platform)) {
    return {
      label: `Imported from ${site}`,
      title: `An applicant's hiring account imported from ${site} — not submitted directly to Seen, and counted at reduced weight`,
    }
  }
  if (isPublicReviewSourced(platform)) {
    const host = publicReviewHost(platform)
    return {
      label: publicReviewLabel(host),
      title: `A first-hand account posted publicly${host ? ` on ${host}` : ' on a review site'}, found by web search — not submitted directly to Seen, and counted at reduced weight`,
    }
  }
  if (isRedditSourced(platform)) {
    return { label: PUBLIC_DISCUSSION_LABEL, title: 'Imported from a public Reddit thread, not submitted directly to Seen' }
  }
  return null
}

const hostOf = (url: string): string | null => {
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return u.hostname.toLowerCase().replace(/^(?:www|m|old|new)\./, '')
  } catch {
    return null
  }
}

const sameSite = (a: string, b: string) => a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`)

// Trailing attribution appended by the web-reports pipeline:
//   "<summary> [Public <host> post, posted <date>: <url>]"   (", posted <date>" optional)
const BRACKET_SUFFIX_RE = /\s*\[Public ([^\s\]]+) post(?:, posted ([^:\]]+))?: (https?:\/\/[^\s\]]+)\]\s*$/
//   "<words> [Source: <url>]"  (the rule-based collectors; 4,208 of 4,521 public rows on prod carry it)
const SOURCE_SUFFIX_RE = /\s*\[Source:\s*(https?:\/\/[^\s\]]+)\]\s*$/i
const BARE_URL_SUFFIX_RE = /\s*(https?:\/\/[^\s\]]+)\s*$/

/**
 * For a THIRD-PARTY row only (Reddit / public review), split a trailing source URL off report_text
 * so it can be rendered as an attribution link. The URL must belong to the row's own source site
 * (the platform's host, or reddit for Reddit rows) — first-hand Seen reports and mismatched hosts
 * never get a link, so a submitter can't turn report text into an outbound link.
 * Returns { body, url, host, posted } or null when there is nothing to link.
 */
export function reportSourceLink(
  platform?: string | null,
  reportText?: string | null,
): { body: string; url: string; host: string; posted: string | null } | null {
  const text = String(reportText ?? '')
  const reviewHost = publicReviewHost(platform)
  const reddit = !reviewHost && isRedditSourced(platform)
  if (!reviewHost && !reddit) return null
  // An opened-but-unclosed "[Public …" means the 2000-char cap cut the attribution — its URL may be
  // truncated, so never link it.
  if (/\[Public [^\]]*$/.test(text)) return null
  const m = BRACKET_SUFFIX_RE.exec(text) || SOURCE_SUFFIX_RE.exec(text) || BARE_URL_SUFFIX_RE.exec(text)
  if (!m) return null
  const url = (m.length === 4 ? m[3] : m[1]).replace(/[.,;)]+$/, '')
  const host = hostOf(url)
  if (!host) return null
  const ok = reviewHost ? sameSite(host, reviewHost) : (host === 'reddit.com' || host.endsWith('.reddit.com') || host === 'redd.it')
  if (!ok) return null
  return { body: text.slice(0, m.index).trim(), url, host, posted: m.length === 4 ? (m[2]?.trim() || null) : null }
}

// ── Report dates ─────────────────────────────────────────────────────────────────────────────
// A third-party row's created_at is when Seen IMPORTED it (a whole batch lands the same day), so it
// must never be shown as the experience date — every imported review would read "today". Those rows
// show the source's own posted date (the "[Public <host> post, posted <date>: <url>]" attribution)
// and NO date when the source gave none. First-hand Seen reports show when they were submitted.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "YYYY" | "YYYY-MM" | "YYYY-MM-DD" → epoch ms (UTC), plus its precision; null if unparseable. */
export function parsePostedDate(posted?: string | null): { ms: number; precision: 'year' | 'month' | 'day' } | null {
  const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(String(posted ?? '').trim())
  if (!m) return null
  const y = Number(m[1]), mo = m[2] ? Number(m[2]) : null, d = m[3] ? Number(m[3]) : null
  if (y < 2000 || (mo !== null && (mo < 1 || mo > 12)) || (d !== null && (d < 1 || d > 31))) return null
  const ms = Date.UTC(y, (mo ?? 7) - 1, d ?? (mo ? 15 : 1)) // month-only → mid-month; year-only → mid-year
  return { ms, precision: d !== null ? 'day' : mo !== null ? 'month' : 'year' }
}

/** today · yesterday · 5d ago · 3mo ago · 2y ago ('' for a missing/future/invalid time). */
export function relativeAgo(ms: number | null | undefined, now: number = Date.now()): string {
  if (ms == null || !Number.isFinite(ms) || ms > now + 86_400_000) return ''
  const days = Math.max(0, Math.floor((now - ms) / 86_400_000))
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

/**
 * The date a report card shows and the key it sorts by.
 *   • First-hand Seen report → when it was submitted ("5d ago").
 *   • Third-party row with a posted date → "posted 12d ago" when recent, else "posted Jul 2025"
 *     (year-only sources: "posted 2023").
 *   • Third-party row without one → label '' and sortMs null (never the import date).
 */
export function reportDate(
  platform?: string | null, reportText?: string | null, createdAt?: string | null, now: number = Date.now(),
): { label: string; sortMs: number | null } {
  if (!isPublicDiscussion(platform)) {
    const t = createdAt ? Date.parse(createdAt) : NaN
    return Number.isFinite(t) ? { label: relativeAgo(t, now), sortMs: t } : { label: '', sortMs: null }
  }
  const p = parsePostedDate(reportSourceLink(platform, reportText)?.posted)
  if (!p || p.ms > now + 86_400_000) return { label: '', sortMs: null }
  const d = pacificParts(new Date(p.ms))
  // Review-site style: recent → relative ("posted 12d ago"); older → month + year ("posted Jul 2025"),
  // which keeps cards from all reading "1y ago"; year-only sources → just the year.
  const label = p.precision === 'year' ? `posted ${d.year}`
    : now - p.ms < 30 * 86_400_000 ? `posted ${relativeAgo(p.ms, now)}`
    : `posted ${MONTHS[d.month - 1]} ${d.year}`
  return { label, sortMs: p.ms }
}

/** Newest first by reportDate's sort key; rows with no known date keep their order, after dated ones. */
export function sortReportsByDate<T extends { platform?: string | null; report_text?: string | null; created_at?: string | null }>(rows: T[], now: number = Date.now()): T[] {
  return rows
    .map((r, i) => ({ r, i, k: reportDate(r.platform, r.report_text, r.created_at, now).sortMs }))
    .sort((a, b) => (a.k === null ? (b.k === null ? a.i - b.i : 1) : b.k === null ? -1 : b.k - a.k || a.i - b.i))
    .map((x) => x.r)
}

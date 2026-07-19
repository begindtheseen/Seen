// Pure helpers for the LIVE per-company Reddit search (api/company-reddit.js).
//
// DEFAMATION-SAFE BY DESIGN: this module only ever surfaces LINKS to public Reddit
// threads with their real titles/subreddits/dates. It never asserts anything about a
// company — the UI frames every item as public third-party discussion
// (lib/reportSource.ts → PUBLIC_DISCUSSION_LABEL), never as Seen's own claim. Nothing
// here feeds a company's score; the scored Reddit-ingest path lives separately in
// api/reports.js (Anthropic-classified + down-weighted). This is display-only.
//
// Everything here is pure + dependency-free so the parse / relevance / ranking / TTL /
// empty-state / dispute-shape logic is unit-tested without a network or DB
// (api/_utils/companyReddit.test.mjs). The network fetch + Supabase cache live in the
// endpoint; these helpers receive already-fetched text/rows.

// Legal-suffix stripper shared with the reports.js company normalizer, so a cache key
// derived here collides with the same company however it was typed.
const LEGAL_SUFFIX = /[\s,]+(inc\.?|llc\.?|corp\.?|ltd\.?|co\.|plc\.?|group|holdings|enterprises|solutions|technologies)\.?$/i;

// Job-context terms. Three jobs: (1) bias Reddit's own search relevance toward
// hiring/interview discussion (the FIRST 8 form the query OR-group), (2) gate out
// off-topic collisions — a common-word brand ("Apple", "Amazon") otherwise floods the
// results with product/shopping threads, so a kept thread must be about employment, and
// (3) rank the most on-topic threads first. Keep the strongest 8 terms first (query set).
export const JOB_CONTEXT_TERMS = [
  'hiring', 'interview', 'interviewing', 'recruiter', 'recruiting', 'ghosted', 'ghosting',
  'offer', // ── first 8 above feed the search query ──
  'rejected', 'rejection', 'layoff', 'layoffs', 'laid', 'fired', 'salary', 'glassdoor',
  'apply', 'application', 'applicant', 'onsite', 'recruitment', 'hr', 'job', 'career',
  'employee', 'employer', 'coworker', 'manager', 'onboarding', 'severance', 'wfh',
  'benefits', 'wage', 'workplace', 'resume',
];

// The relevance GATE uses a stricter subset: several JOB_CONTEXT_TERMS are great for
// biasing the search query and ranking but too ambiguous to admit a thread on their own —
// "offer" matches gift-card / product / acquisition offers, "apply" matches "apply
// sunscreen", "benefits" matches "benefits of X". Excluding them from the gate stops those
// collisions; a genuine "Company SDE offer" still qualifies via its interview/career sub.
const GATE_AMBIGUOUS = new Set(['offer', 'apply', 'application']);
const GATE_TERMS = JOB_CONTEXT_TERMS.filter((t) => !GATE_AMBIGUOUS.has(t));

// Subreddits whose entire subject is work/careers/hiring. A thread in one of these is
// employment-relevant even if it doesn't repeat a job-context keyword in the title.
// Lowercased for case-insensitive matching.
const CAREER_SUBREDDITS = new Set([
  'recruitinghell', 'jobs', 'cscareerquestions', 'careerguidance', 'antiwork', 'askhr',
  'interviews', 'experienceddevs', 'humanresources', 'workreform', 'jobsearch',
  'careeradvice', 'itcareerquestions', 'layoffs', 'overemployed', 'recruiting',
  'askmanagers', 'consulting', 'jobsearchhacks', 'employment', 'work', 'askcorporate',
  'corporate', 'digitalnomad', 'salary', 'financialcareers', 'engineeringresumes',
  // interview-prep / job-hunt subs where real offer + interview posts live
  'leetcode', 'leetcodedesi', 'csmajors', 'cscareerquestionseu', 'developersindia',
  'resumes', 'jobhunting', 'getemployed', 'jobfair', 'techsales', 'sales', 'sysadmin',
]);

export function isCareerSubreddit(subreddit) {
  return CAREER_SUBREDDITS.has(String(subreddit || '').toLowerCase().replace(/^r\//, ''));
}

// Does this thread carry unambiguous employment context in its title or body? Uses the
// strict GATE_TERMS (not the fuller JOB_CONTEXT_TERMS) so ambiguous words like "offer"
// can't alone admit a shopping/product thread.
export function hasJobContext(item) {
  const hay = `${item?.title || ''}  ${item?._body || ''}`;
  return GATE_TERMS.some((term) => containsWord(hay, term));
}

// Placeholder / junk names that must never trigger a live Reddit call.
const BLOCKED_NAMES = new Set([
  'unknown', 'n/a', 'na', 'none', 'test', 'company', 'employer', 'null', 'undefined',
  'other', 'various', 'multiple', 'anonymous', 'private', 'confidential', 'tbd', 'tba',
  'not specified', 'not listed', 'not provided', 'see description',
]);

// TTLs (ms). A populated result is cached a full day; a genuinely-empty result is
// re-checked sooner (a company with no discussion today may have some next week, but we
// still must not hammer Reddit). Exported so the endpoint and tests share one source.
export const TTL_OK_MS = 24 * 60 * 60 * 1000;    // 24h
export const TTL_EMPTY_MS = 12 * 60 * 60 * 1000; // 12h

export const MAX_ITEMS = 10;      // most threads we ever store / show per company
const MIN_RELEVANT = 3;           // below this the endpoint widens the search (fallback query)
export { MIN_RELEVANT };

// Valid dispute reason categories. Kept small + closed so the review queue is triageable.
export const DISPUTE_REASONS = new Set([
  'not_us',      // "these threads aren't about our company" (name collision)
  'outdated',    // "this is old / no longer true"
  'misleading',  // "this misrepresents us"
  'resolved',    // "the issue discussed has been fixed"
  'other',
]);

// ── Company-name normalization + validation ────────────────────────────────────

// Cache key: lowercased, trimmed, legal suffix stripped, whitespace collapsed. Mirrors
// the reports.js `normalize()` so "Acme, Inc." and "acme" share one cache row.
export function normalizeCompanyKey(name) {
  if (!name || typeof name !== 'string') return '';
  return name.trim().toLowerCase().replace(LEGAL_SUFFIX, '').replace(/\s+/g, ' ').trim();
}

// Guard: is this a real, searchable company name (not a placeholder / junk)? Mirrors the
// reports.js isValidCompanyName so we never spend a Reddit request on garbage input.
export function isSearchableCompany(name) {
  if (!name || typeof name !== 'string') return false;
  const n = name.trim();
  if (n.length < 2 || n.length > 120) return false;
  if (!/[a-zA-Z]/.test(n)) return false;      // must contain a letter
  if (n.startsWith('#')) return false;         // hash-prefixed ids
  if (BLOCKED_NAMES.has(n.toLowerCase())) return false;
  return true;
}

// ── Reddit search Atom parsing ─────────────────────────────────────────────────

const unescapeXml = (s) => String(s)
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'");

// Parse a Reddit search RSS/Atom feed into display items. Unlike the reports.js parser
// (which keeps only id/title/body for AI classification), this keeps the permalink,
// subreddit, author and date — the fields we need to ATTRIBUTE and LINK every item.
// Returns [{ id, title, subreddit, permalink, author, created }] (created = ISO or '').
export function parseRedditSearchAtom(xml) {
  const out = [];
  if (!xml || typeof xml !== 'string') return out;
  const entryRx = /<entry>([\s\S]*?)<\/entry>/g;
  let m;
  while ((m = entryRx.exec(xml)) !== null) {
    const block = m[1];
    const permalink = (/<link[^>]+href="([^"]+)"/.exec(block)?.[1] || '').replace(/&amp;/g, '&');
    const idM = /\/comments\/([a-z0-9]+)\//i.exec(permalink);
    if (!idM) continue;                         // not a thread link — skip nav/self links
    const id = idM[1];
    const title = unescapeXml(
      /<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/.exec(block)?.[1] || '',
    ).trim().slice(0, 300);
    if (!title) continue;
    // Subreddit: prefer the <category term="..."> label, else derive from the permalink.
    const catTerm = /<category[^>]*\bterm="([^"]+)"/.exec(block)?.[1];
    const subFromLink = /reddit\.com\/r\/([^/]+)\//i.exec(permalink)?.[1];
    const subreddit = (catTerm || subFromLink || '').replace(/^r\//, '');
    const author = unescapeXml(
      /<author>[\s\S]*?<name>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/name>/.exec(block)?.[1] || '',
    ).replace(/^\/?u\//, '').trim().slice(0, 60);
    const rawDate = /<updated>([^<]+)<\/updated>/.exec(block)?.[1]
      || /<published>([^<]+)<\/published>/.exec(block)?.[1] || '';
    const t = rawDate ? Date.parse(rawDate) : NaN;
    const created = Number.isFinite(t) ? new Date(t).toISOString() : '';
    // Body/content (tags stripped) — used only for relevance, never displayed verbatim.
    const rawBody = /<content[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/content>/i.exec(block)?.[1] || '';
    const body = unescapeXml(rawBody.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).trim().slice(0, 1500);
    out.push({ id, title, subreddit, permalink, author, created, _body: body });
  }
  return out;
}

// ── Relevance + ranking ────────────────────────────────────────────────────────

// Word-boundary-ish token match, case-insensitive, punctuation-tolerant. Used so
// "Apple" matches "apple's hiring" but not "pineapple", and "HP" matches "HP" but not
// "help". Escapes the needle so a company name can never be a regex injection.
function containsWord(haystack, needle) {
  const n = String(needle).trim();
  if (!n) return false;
  const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`, 'i').test(String(haystack));
}

// Does the company name appear as a WORD in the thread's title or body? For multi-word
// names the full phrase OR a distinctive (>=4 char) first token qualifies; short names
// (<=3 chars, e.g. "HP", "3M") match only as a whole word (substring-collision guard).
function mentionsCompany(item, companyName) {
  if (!item) return false;
  const hay = `${item.title || ''}  ${item._body || ''}`;
  const key = normalizeCompanyKey(companyName);
  if (!key) return false;
  if (containsWord(hay, key)) return true;
  const tokens = key.split(' ').filter(Boolean);
  if (tokens.length > 1 && tokens[0].length >= 4 && containsWord(hay, tokens[0])) return true;
  return false;
}

// Is this thread relevant to show on a COMPANY page — i.e. about working at / applying to
// this company, not a name collision? Two conditions, both required:
//   1) the company is named (mentionsCompany), AND
//   2) it is employment context — the thread is in a career/work subreddit OR carries a
//      job-context keyword. Condition (2) is what keeps a common-word brand ("Amazon",
//      "Apple") from surfacing product-restock / shopping / recipe threads. Better an
//      honest empty state than off-topic noise on a company's page (also defamation-safe:
//      we only ever surface *employment* discussion, framed as such).
export function isRelevant(item, companyName) {
  if (!mentionsCompany(item, companyName)) return false;
  return isCareerSubreddit(item.subreddit) || hasJobContext(item);
}

// Rank score for a relevant thread: job-context threads and title (vs body-only)
// mentions float to the top; recency is the final tie-break (newer wins). Pure + total.
export function scoreRelevance(item, companyName) {
  let score = 0;
  const title = (item.title || '').toLowerCase();
  const body = (item._body || '').toLowerCase();
  if (mentionsCompany({ title: item.title, _body: '' }, companyName)) score += 3; // named in the title
  if (isCareerSubreddit(item.subreddit)) score += 2;                              // posted in a work/career sub
  for (const term of JOB_CONTEXT_TERMS) {
    if (containsWord(title, term)) { score += 2; break; }
  }
  for (const term of JOB_CONTEXT_TERMS) {
    if (containsWord(body, term)) { score += 1; break; }
  }
  const t = item.created ? Date.parse(item.created) : NaN;
  if (Number.isFinite(t)) {
    const ageDays = (Date.now() - t) / 86400000;
    if (ageDays <= 30) score += 2;
    else if (ageDays <= 180) score += 1;
  }
  return score;
}

// Filter to company-relevant threads, drop duplicate permalinks, rank, cap. Returns the
// clean display array [{ id, title, subreddit, permalink, author, created }] (the
// internal `_body` is stripped — it is never persisted or shown).
export function rankAndFilter(items, companyName, limit = MAX_ITEMS) {
  const seen = new Set();
  const relevant = [];
  for (const it of Array.isArray(items) ? items : []) {
    if (!it || !it.permalink || seen.has(it.permalink)) continue;
    if (!isRelevant(it, companyName)) continue;
    seen.add(it.permalink);
    relevant.push(it);
  }
  relevant.sort((a, b) => {
    const d = scoreRelevance(b, companyName) - scoreRelevance(a, companyName);
    if (d !== 0) return d;
    return (Date.parse(b.created) || 0) - (Date.parse(a.created) || 0);
  });
  return relevant.slice(0, Math.max(0, limit)).map(({ _body, ...rest }) => rest);
}

// ── Query building ─────────────────────────────────────────────────────────────

// Build a Reddit search RSS URL. `broad=false` biases relevance with a job-context
// OR-group (best for common-word company names like "Apple"); `broad=true` is the
// company-name-only fallback used when the biased query came back too thin.
export function buildSearchUrl(companyName, { broad = false, host = 'https://www.reddit.com', limit = 25 } = {}) {
  const phrase = `"${String(companyName).replace(/["\\]/g, '').trim()}"`;
  const context = JOB_CONTEXT_TERMS.slice(0, 8).join(' OR ');
  const q = broad ? phrase : `${phrase} (${context})`;
  // Relevance-sorted so Reddit weighs the job-context terms (sort=new floods common-word
  // brands with product spam). Biased pass bounds to the past year for freshness; the broad
  // fallback spans all time to maximize fill for less-discussed companies.
  const params = new URLSearchParams({ q, sort: 'relevance', limit: String(limit) });
  if (!broad) params.set('t', 'year');
  return `${host}/search/.rss?${params.toString()}`;
}

// ── Cache freshness + empty-state ──────────────────────────────────────────────

// TTL for a result of the given status.
export function ttlForStatus(status) {
  return status === 'ok' ? TTL_OK_MS : TTL_EMPTY_MS;
}

// Is a cache row still fresh? Prefers an explicit expires_at; otherwise falls back to
// fetched_at + the status TTL. Missing/garbage timestamps → stale (force a refresh).
export function cacheFresh(row, now = Date.now()) {
  if (!row) return false;
  if (row.expires_at) {
    const exp = Date.parse(row.expires_at);
    return Number.isFinite(exp) && now < exp;
  }
  const fetched = row.fetched_at ? Date.parse(row.fetched_at) : NaN;
  if (!Number.isFinite(fetched)) return false;
  return now < fetched + ttlForStatus(row.status || 'ok');
}

// Decide the cache status for a freshly-fetched set. 'ok' when we have >=1 relevant
// thread, else 'empty' (an honestly-empty result we still cache, briefly).
export function emptyStateDecision(items) {
  return (Array.isArray(items) && items.length > 0) ? 'ok' : 'empty';
}

// Whether the endpoint should widen to the broad fallback query after the biased one.
export function needsBroadFallback(relevantCount) {
  return (relevantCount || 0) < MIN_RELEVANT;
}

// ── Dispute submission shaping ─────────────────────────────────────────────────

// Validate + shape a dispute/correction submission into the row we store. No auth is
// required (good-faith public correction path), so this hard-caps every field and
// rejects junk. Returns { valid, row?, error? }.
export function sanitizeDispute(body = {}) {
  const company = String(body.company || '').trim().slice(0, 200).replace(/[<>`\\]/g, '');
  if (!isSearchableCompany(company)) return { valid: false, error: 'A valid company name is required.' };

  const reason = String(body.reason || '').trim().toLowerCase();
  if (!DISPUTE_REASONS.has(reason)) return { valid: false, error: 'Select a valid reason.' };

  const detail = body.detail ? String(body.detail).slice(0, 2000).replace(/[<>`]/g, '').trim() : '';
  if (detail.length < 10) return { valid: false, error: 'Please describe the correction (at least 10 characters).' };

  // Optional: the specific thread being disputed. Only accept a real reddit permalink.
  let permalink = body.permalink ? String(body.permalink).trim().slice(0, 500) : '';
  if (permalink && !/^https?:\/\/(www\.|old\.)?reddit\.com\/r\/[^\s"'<>]+/i.test(permalink)) permalink = '';

  // Optional contact for follow-up. Kept only if it looks like an email; never required.
  let contact = body.contact ? String(body.contact).trim().slice(0, 200) : '';
  if (contact && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact)) contact = '';

  return {
    valid: true,
    row: {
      company_name: company,
      company_key: normalizeCompanyKey(company),
      reason,
      detail,
      permalink: permalink || null,
      contact: contact || null,
      status: 'open',
    },
  };
}

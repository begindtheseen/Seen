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
import { mentionsCompany, isWeakMention, isCompanySubreddit, nameVariants } from '../../lib/reports/applicantRules.js';

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

// &amp; MUST be unescaped LAST: doing it first can synthesize a new entity from already-escaped
// text (e.g. "&amp;lt;" → "&lt;" → "<"), double-unescaping the content. Named/numeric refs first,
// ampersand last, so each source entity is decoded exactly once.
const unescapeXml = (s) => String(s)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'")
  .replace(/&amp;/g, '&');

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

// Hiring-context GATE for ONE sentence: the strict GATE_TERMS plus unambiguous phrases for the
// words that are too loose on their own ("offer" → "job offer" / "offer letter"; "apply" →
// "applied to"). A thread is about hiring only when such a word sits in the SAME SENTENCE as the
// company's name — "Jets rejected trade offer … first target" has "rejected" and "target" in the
// same title and is still about hockey, so the name must also be used as the EMPLOYER (below).
const GATE_PHRASES = [
  'job offer', 'offer letter', 'got an offer', 'got the offer', 'received an offer', 'applied to', 'applied at',
  'applied for', 'applied with', 'my application', 'application status', 'hired', 'hire', 'hires', 'phone screen',
  'background check', 'drug test', 'orientation', 'assessment', 'hiring manager', 'hiring process', 'laid off',
  'internship', 'intern', 'human resources', 'rejection', 'rejections', 'position', 'positions', 'applicant',
  'applicants', 'candidates', 'recruiters', 'interviews', 'jobs', 'hiring managers',
];
// "hr" is a GATE term no more: "1 hr later" matched it (Target's r/UkrainianConflict thread passed on a body
// mention). It still biases the search query and the ranking.
const SENTENCE_GATE = [...GATE_TERMS.filter((t) => t !== 'hr'), ...GATE_PHRASES];
export function hasHiringContext(text) {
  const t = String(text || '');
  return SENTENCE_GATE.some((term) => containsWord(t, term));
}

// Company names that are ordinary English words. For these a mention counts only when the word is
// used as the EMPLOYER (employerUsage) — otherwise "became the target of a public humiliation",
// "your target salary", "help Iran target …", "mind the gap", "apple pie" and "shell script" all
// land on a company page (audit 2026-10-23, /company/target). Extend when a real page shows the
// collision; keep brands that are not dictionary words (Walmart, Amazon, Twilio) OUT so their
// casual lowercase mentions still count.
export const COMMON_WORD_BRANDS = new Set([
  'target', 'apple', 'gap', 'chase', 'shell', 'sprint', 'square', 'box', 'snap', 'ring', 'meta', 'alphabet',
  'block', 'stripe', 'slack', 'discord', 'zoom', 'indeed', 'monster', 'subway', 'staples', 'boost', 'mint',
  'bumble', 'hinge', 'match', 'visa', 'total', 'orange', 'three', 'vans', 'coach', 'guess', 'express', 'limited',
  'dash', 'glass', 'bolt', 'root', 'nest', 'path', 'flow', 'ally', 'affirm', 'brex', 'chime', 'compass',
  'fidelity', 'harvest', 'honey', 'lemonade', 'lime', 'marathon', 'mosaic', 'oracle', 'pilot', 'progressive',
  'public', 'shift', 'simple', 'spring', 'tide', 'toast', 'wish', 'dish', 'fox', 'hub', 'kind', 'loft', 'marvel',
  'plaid', 'pure', 'quest', 'relay', 'rise', 'sage', 'scale', 'sonic', 'spark', 'sprout', 'stash', 'thrive',
  'true', 'unity', 'wave', 'west', 'wise', 'zip', 'anthem', 'carter', 'frontier', 'liberty', 'mutual', 'national',
  'northern', 'pioneer', 'regal', 'republic', 'sears', 'signature', 'standard', 'sterling', 'summit', 'united',
  'universal', 'western', 'aspen', 'atlas', 'beacon', 'bridge', 'cascade', 'crest', 'delta', 'echo', 'elevate',
  'forward', 'horizon', 'legacy', 'nova', 'prime', 'tribe', 'vertex', 'zenith',
]);
export const isCommonWordBrand = (companyName) => COMMON_WORD_BRANDS.has(normalizeCompanyKey(companyName));

// The company word used as an employer: preceded by a hiring preposition ("applied to Target",
// "job at target", "ghosted by Target"), followed by an employer noun ("Target's recruiter", "Target
// store", "target hiring process"), or written as a proper noun mid-sentence in text that is not
// headline-cased ("I interviewed and Target never called back").
const EMPLOYER_BEFORE = /\b(?:at|for|with|from|by|to|into|join(?:ed|ing)?|via|through|w\/|left|leaving|quit|working|work|hired|recruited|interview(?:ed|ing)?|offer(?:ed)?|apply(?:ing)?|applied|ghosted|rejected)\s+(?:the\s+|a\s+|my\s+|our\s+|local\s+|my local\s+)?$/i;
const EMPLOYER_AFTER = /^(?:'s|’s)?\s+(?:store|stores|warehouse|dc|distribution|fulfillment|corporate|hq|headquarters|hiring|hires|hired|recruiter|recruiters|recruiting|hr|interview|interviews|interviewer|job|jobs|career|careers|application|applications|team|employee|employees|manager|managers|position|positions|orientation|onboarding|background check|drug test|shift|shifts|associate|associates|cashier|driver|tech|intern|internship|internships|rejected|ghosted|never|didn'?t|hasn'?t|called|emailed|offered|reached|responded|replied|got back)\b/i;
const headlineCased = (s) => {
  const words = String(s).split(/\s+/).filter((w) => /^[a-z]/i.test(w) && w.length >= 4);
  return words.length >= 3 && words.filter((w) => /^[A-Z]/.test(w)).length / words.length >= 0.6;
};
export function employerUsage(sentence, companyName) {
  const key = normalizeCompanyKey(companyName);
  const s = String(sentence || '');
  if (!key) return false;
  const esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rx = new RegExp(`(^|[^a-z0-9])(${esc})(?=[^a-z0-9]|$)`, 'gi');
  const headline = headlineCased(s);
  let m;
  while ((m = rx.exec(s)) !== null) {
    const at = m.index + m[1].length;
    const before = s.slice(0, at);
    const after = s.slice(at + m[2].length);
    if (EMPLOYER_BEFORE.test(before) || EMPLOYER_AFTER.test(after)) return true;
    // Proper noun mid-sentence ("… and Target never …"), unless every word is capitalized anyway.
    const properNoun = /^[A-Z]/.test(m[2]) && /[a-z0-9]/i.test(before.replace(/^[\s"'“‘(\[]+/, '')) && !/[.!?]\s*$/.test(before);
    if (properNoun && !headline) return true;
  }
  return false;
}

// Sentences of a title/body. Titles use " — " / " | " / ":" as separators between clauses that are
// not about the same thing ("Jets rejected trade offer … — Read more: …").
const sentences = (text) => String(text || '').replace(/\s+/g, ' ').split(/(?<=[.!?])\s+|\s+[—|]\s+|\n+/).map((x) => x.trim()).filter(Boolean);

// The company named in a sentence, as a word and not as an ordinary word ("being a target", "a
// list: Target, Walmart, Costco") — applicantRules' mention tests, shared with the collectors. Names
// shorter than three letters ("HP", "3M") have no rule variants and fall back to a whole-word match.
function namedIn(sentence, companyName, key) {
  if (!nameVariants([companyName]).length) return containsWord(sentence, key);
  return mentionsCompany(sentence, [companyName]) && !isWeakMention(sentence, [companyName]);
}

// Is this thread relevant to show on a COMPANY page — about applying to / being hired by THIS
// company, not a name collision? A thread counts when, in ONE sentence of its title or body, the
// company is named as the employer (for a common-word brand: used as the employer) AND a hiring
// word appears — or the thread is in the company's own subreddit and talks about hiring. For a
// name that is not an ordinary word, a mention inside a career/work subreddit still counts.
export function isRelevant(item, companyName) {
  if (!item) return false;
  const key = normalizeCompanyKey(companyName);
  if (!key) return false;
  const common = COMMON_WORD_BRANDS.has(key);
  const sub = String(item.subreddit || '');
  let named = false;
  let titleNamed = false;
  for (const [field, text] of [['title', item.title || ''], ['body', item._body || '']]) {
    for (const s of sentences(text)) {
      if (!namedIn(s, companyName, key)) continue;
      if (common && !employerUsage(s, companyName)) continue;
      named = true;
      if (field === 'title') titleNamed = true;
      if (hasHiringContext(s)) return true;
    }
  }
  if (!named) return (isCompanySubreddit(sub, [companyName]) || isCompanySubreddit(sub, [key])) && hasJobContext(item);
  if (common) return false;
  // A thread titled after the company whose post talks about hiring is about hiring at the company.
  if (titleNamed && hasHiringContext(item._body || '')) return true;
  return isCareerSubreddit(sub);
}

// Rank score for a relevant thread: job-context threads and title (vs body-only)
// mentions float to the top; recency is the final tie-break (newer wins). Pure + total.
export function scoreRelevance(item, companyName) {
  let score = 0;
  const title = (item.title || '').toLowerCase();
  const body = (item._body || '').toLowerCase();
  const key = normalizeCompanyKey(companyName);
  if (key && sentences(item.title || '').some((s) => namedIn(s, companyName, key))) score += 3; // named in the title
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

// Stored items carry the relevance-rule version they passed. A cached row written under an older
// rule is re-judged at serve time (refilterCached) instead of waiting out its TTL.
export const ITEM_RULES_VERSION = 2;

// Fewer than this many relevant threads and the section is not shown at all (one thread is a
// coincidence, not "discussion"). Enforced here (status 'empty') and mirrored by the page.
export const MIN_SHOW_THREADS = 2;

// Filter to company-relevant threads, drop duplicate permalinks, rank, cap. Returns the
// clean display array [{ id, title, subreddit, permalink, author, created, v }] (the
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
  return relevant.slice(0, Math.max(0, limit)).map(({ _body, ...rest }) => ({ ...rest, v: ITEM_RULES_VERSION }));
}

// The list a page may show: the ranked threads, or nothing under MIN_SHOW_THREADS.
export function showableItems(items) {
  const list = Array.isArray(items) ? items : [];
  return list.length >= MIN_SHOW_THREADS ? list : [];
}

// Cached items written under an older relevance rule (no `v`, or a lower one) are re-judged on
// what the cache kept — title + subreddit (bodies are never stored). Items at the current version
// pass through untouched.
export function refilterCached(items, companyName) {
  const list = Array.isArray(items) ? items : [];
  return list.filter((it) => it && ((it.v || 0) >= ITEM_RULES_VERSION || isRelevant({ title: it.title, subreddit: it.subreddit }, companyName)));
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

// ── Admin review of disputes (the ADMIN side of the correction loop) ─────────────────
// The dispute lifecycle mirrors migration 054's `status` column exactly: 'open' is the intake
// state a submission lands in; an admin moves it to one of the review states below. Migration
// 054 has NO reviewed_at/updated_at column, so a status change IS the whole state transition.
export const DISPUTE_STATUSES = ['open', 'reviewed', 'actioned', 'dismissed'];
// The states an admin may SET from the review queue. Never back to 'open' — a dispute only
// leaves intake, it never re-enters it (open is where the submit endpoint puts new rows).
export const DISPUTE_REVIEW_STATUSES = ['reviewed', 'actioned', 'dismissed'];

// A valid status to FILTER the list by (any lifecycle state).
export function isDisputeStatus(s) {
  return typeof s === 'string' && DISPUTE_STATUSES.includes(s);
}
// A valid status for an admin to SET on a dispute (a review transition only).
export function isDisputeReviewStatus(s) {
  return typeof s === 'string' && DISPUTE_REVIEW_STATUSES.includes(s);
}

// Tally disputes by status for the review-queue header (open / reviewed / actioned / dismissed
// + total). Accepts any row list exposing a `status`; an unrecognized status still counts toward
// `total` but never invents a bucket, so a future lifecycle state can't corrupt the known counts.
export function disputeStatusCounts(rows = []) {
  const counts = { open: 0, reviewed: 0, actioned: 0, dismissed: 0, total: 0 };
  for (const r of Array.isArray(rows) ? rows : []) {
    const s = r && r.status;
    if (s !== 'total' && Object.prototype.hasOwnProperty.call(counts, s)) counts[s] += 1;
    counts.total += 1;
  }
  return counts;
}

// Order the default (unfiltered) review list "open first, newest first". The caller fetches rows
// already sorted newest-first (created_at desc); this is a STABLE partition that floats the still-
// open disputes to the top of the actionable queue while preserving recency order within each
// group. Pure — returns a new array, never mutates the input.
export function orderDisputesOpenFirst(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  return [
    ...list.filter(r => r && r.status === 'open'),
    ...list.filter(r => !(r && r.status === 'open')),
  ];
}

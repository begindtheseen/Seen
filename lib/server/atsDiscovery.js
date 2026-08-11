// ATS tenant discovery — turn a company NAME into a verified first-party job board.
//
// Why this exists: every job we hold from an aggregator decays (38% of the corpus went a week
// without re-verification), while every job pulled straight from an employer's own ATS is fresh by
// construction. The gap was never the ingest adapters — those work. It was that `company_sources`
// held 27 hand-typed seeds, 8 of them wrong slugs that 404, and nothing could find the other 11,700+
// companies we already have jobs for. This module is the missing discovery step.
//
// The hard part is NOT resolving a slug, it's resolving the RIGHT slug. "Capital One" naively
// shortens to `capital`, and `lever/capital` is a real board belonging to somebody else entirely.
// Accepting it would file another company's postings under Capital One and poison their score. So
// every candidate carries a strength, and a weak candidate is only ever accepted when the provider
// can independently confirm the board's own name (Greenhouse publishes one; Lever and Ashby do not).
//
// Pure module: no fetch, no DB. Callers supply responses — see scripts/discover-ats-tenants.mjs.

import { normalizeCompany } from './jobSources.js';

// Legal suffixes and filler that never appear in a board slug.
const SUFFIXES = /\b(inc|llc|l\.l\.c|ltd|limited|corp|corporation|company|co|holdings|group|gmbh|ag|sa|plc|nv|bv|pty|llp|lp|pc|pa|na|n\.a)\b\.?/gi;
// Names too generic to ever probe on their own — a bare match here is almost certainly someone else.
const TOO_GENERIC = new Set([
  'capital', 'health', 'medical', 'group', 'partners', 'solutions', 'systems', 'services', 'global',
  'digital', 'technology', 'technologies', 'labs', 'studio', 'studios', 'works', 'team', 'first',
  'united', 'american', 'national', 'general', 'standard', 'premier', 'advanced', 'network', 'data',
  'cloud', 'software', 'consulting', 'staffing', 'recruiting', 'talent', 'people', 'group1', 'the',
]);

// Trailing tokens that are branding, not identity — a board name differing from the company name by
// only one of these is still the same company. Anything else means they are different companies.
const NAME_FILLER = new Set([
  'pbc', 'labs', 'lab', 'technologies', 'technology', 'tech', 'software', 'systems', 'digital',
  'global', 'worldwide', 'international', 'usa', 'us', 'io', 'ai', 'app', 'hq', 'team', 'careers',
  'jobs', 'talent', 'recruiting', 'brands', 'ventures', 'capital', 'studios', 'studio', 'media',
]);

/** Normalize a display name to its comparable core: lowercase alphanumerics, no legal suffix. */
export function nameCore(raw) {
  return String(raw || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(SUFFIXES, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Ordered slug candidates for a company name, strongest first.
 *
 * strength:
 *   'exact'  — the whole name, squashed or hyphenated. Safe to accept on an HTTP 200 alone.
 *   'weak'   — a truncation (first word, dropped tail). NEVER accepted without name verification,
 *              because short slugs collide across unrelated companies.
 */
export function candidateSlugs(companyName) {
  const core = nameCore(companyName);
  if (!core || core.length < 2) return [];
  const words = core.split(' ').filter(Boolean);
  const squashed = words.join('');
  const hyphen = words.join('-');

  const out = [];
  const seen = new Set();
  const push = (slug, strength) => {
    if (!slug || slug.length < 2 || slug.length > 60 || seen.has(slug)) return;
    // A truncation that lands on a generic word ("capital", "health") is a collision waiting to
    // happen. Applied to EVERY weak form, not just the first word — dropping a trailing word
    // reproduces the same bare token ("capital one" → "capital").
    if (strength === 'weak' && TOO_GENERIC.has(slug)) return;
    seen.add(slug);
    out.push({ slug, strength });
  };

  push(squashed, 'exact');
  if (hyphen !== squashed) push(hyphen, 'exact');
  // Truncations only help multi-word names, and only as verification-gated guesses.
  if (words.length > 1) {
    push(words[0], 'weak');
    push(words.slice(0, -1).join(''), 'weak');
  }
  return out;
}

// ── Providers ───────────────────────────────────────────────────────────────────
// Public, unauthenticated JSON board endpoints. `boardUrl` is the metadata endpoint that returns the
// board's OWN name where the provider offers one — that name is what makes a weak slug safe.

// A provider may expose the board's own name two ways: inside the jobs payload (`nameFromJobs`, free)
// or via a separate metadata endpoint (`boardUrl` + `boardName`, one extra request). Either one makes
// a weak slug verifiable; providers with neither can only ever accept exact-slug matches.
export const PROVIDERS = {
  greenhouse: {
    jobsUrl: (t) => `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(t)}/jobs`,
    countJobs: (d) => (Array.isArray(d?.jobs) ? d.jobs.length : null),
    nameFromJobs: () => null,
    boardUrl: (t) => `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(t)}`,
    boardName: (d) => (typeof d?.name === 'string' ? d.name : null),
    verifiesName: true,
  },
  lever: {
    jobsUrl: (t) => `https://api.lever.co/v0/postings/${encodeURIComponent(t)}?mode=json`,
    countJobs: (d) => (Array.isArray(d) ? d.length : null),
    nameFromJobs: () => null,
    boardUrl: null, // Lever publishes no board name anywhere — exact slugs only.
    boardName: () => null,
    verifiesName: false,
  },
  ashby: {
    jobsUrl: (t) => `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(t)}`,
    countJobs: (d) => (Array.isArray(d?.jobs) ? d.jobs.length : null),
    nameFromJobs: () => null,
    boardUrl: null,
    boardName: () => null,
    verifiesName: false,
  },
  // SmartRecruiters matters because it reaches everyday employers (retail, logistics, healthcare),
  // not just tech. Two traits shape its handling: it answers HTTP 200 for ANY tenant string — a
  // nonexistent company returns `{totalFound: 0, content: []}`, so the status code proves nothing and
  // only `totalFound` does — and it echoes the real company name on each posting, which verifies
  // ownership for free.
  smartrecruiters: {
    jobsUrl: (t) => `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(t)}/postings?limit=1`,
    countJobs: (d) => (Number.isFinite(d?.totalFound) ? d.totalFound : null),
    nameFromJobs: (d) => {
      const c = Array.isArray(d?.content) ? d.content[0]?.company : null;
      return typeof c?.name === 'string' ? c.name : null;
    },
    boardUrl: null,
    boardName: () => null,
    verifiesName: true,
  },
  workable: {
    jobsUrl: (t) => `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(t)}?details=true`,
    countJobs: (d) => (Array.isArray(d?.jobs) ? d.jobs.length : null),
    nameFromJobs: (d) => (typeof d?.name === 'string' ? d.name : null),
    boardUrl: null,
    boardName: () => null,
    verifiesName: true,
  },
};

/** Can this provider ever confirm a board's identity? Gates whether weak slugs are worth probing. */
export function canVerifyName(provider) {
  return PROVIDERS[provider]?.verifiesName === true;
}

export const PROVIDER_NAMES = Object.keys(PROVIDERS);

/**
 * Extract {provider, tenant} from a careers/board URL. This is the HIGH-precision path: when a
 * company's careers page links straight at its ATS, there is no guessing left to do, so the result
 * is always 'exact'. Mirrors the host patterns listingImport.js already trusts.
 */
export function tenantFromUrl(rawUrl) {
  let u;
  try { u = new URL(String(rawUrl)); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const segs = u.pathname.split('/').filter(Boolean);
  const clean = (s) => (/^[A-Za-z0-9][A-Za-z0-9._-]{0,59}$/.test(s || '') ? s : null);

  if (/(^|\.)greenhouse\.io$/.test(host)) {
    // boards.greenhouse.io/{token}, boards.greenhouse.io/embed/job_board?for={token},
    // boards-api.greenhouse.io/v1/boards/{token}/...
    const forParam = clean(u.searchParams.get('for'));
    if (forParam) return { provider: 'greenhouse', tenant: forParam, strength: 'exact' };
    const vi = segs.indexOf('boards');
    if (vi >= 0 && clean(segs[vi + 1])) return { provider: 'greenhouse', tenant: segs[vi + 1], strength: 'exact' };
    const first = clean(segs[0]);
    if (first && !['embed', 'v1'].includes(first)) return { provider: 'greenhouse', tenant: first, strength: 'exact' };
    return null;
  }
  if (host === 'jobs.lever.co' || host === 'api.lever.co') {
    const i = segs.indexOf('postings');
    const t = clean(i >= 0 ? segs[i + 1] : segs[0]);
    return t ? { provider: 'lever', tenant: t, strength: 'exact' } : null;
  }
  if (host === 'jobs.ashbyhq.com' || host === 'api.ashbyhq.com') {
    const i = segs.indexOf('job-board');
    const t = clean(i >= 0 ? segs[i + 1] : segs[0]);
    return t ? { provider: 'ashby', tenant: t, strength: 'exact' } : null;
  }
  return null;
}

/** Find every ATS board link in a careers page's HTML. Ordered, de-duplicated, exact-strength. */
export function tenantsFromHtml(html) {
  const out = [];
  const seen = new Set();
  const re = /https?:\/\/[^\s"'<>)]+/g;
  for (const m of String(html || '').matchAll(re)) {
    const hit = tenantFromUrl(m[0].replace(/[.,;]+$/, ''));
    if (!hit) continue;
    const key = `${hit.provider}/${hit.tenant}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(hit);
  }
  return out;
}

/**
 * Does `boardName` (the board's self-reported name) plausibly refer to `companyName`?
 * Deliberately strict: this is the last line of defence against mis-attributing postings.
 */
export function namesMatch(companyName, boardName) {
  const a = nameCore(normalizeCompany(companyName) || companyName);
  const b = nameCore(normalizeCompany(boardName) || boardName);
  if (!a || !b) return false;
  if (a === b) return true;
  const sa = a.replace(/ /g, '');
  const sb = b.replace(/ /g, '');
  if (sa === sb) return true;
  // A prefix match is only safe when what's left over is corporate filler. A length ratio is NOT a
  // safe test: "capital" is 70% of "capitalone" and belongs to a different company entirely, while
  // "anthropic" is 75% of "anthropicpbc" and is the same one. The leftover word is what tells them
  // apart, so require it explicitly rather than guessing from proportions.
  const [short, long] = sa.length <= sb.length ? [sa, sb] : [sb, sa];
  if (short.length < 4 || !long.startsWith(short)) return false;
  return NAME_FILLER.has(long.slice(short.length));
}

/**
 * The accept/reject decision for one probed candidate.
 *
 * @param {object} p
 * @param {string} p.companyName    the company we are trying to resolve
 * @param {string} p.strength       'exact' | 'weak' (from candidateSlugs/tenantFromUrl)
 * @param {number|null} p.jobCount  jobs returned by the board (null = unparseable)
 * @param {string|null} p.boardName the board's own name, when the provider publishes one
 * @param {boolean} p.nameEndpointSupported whether this provider can ever supply a boardName
 * @returns {{accept: boolean, confidence: 'high'|'medium'|null, reason: string}}
 */
export function verdictFor({ companyName, strength, jobCount, boardName, nameEndpointSupported }) {
  if (jobCount == null) return { accept: false, confidence: null, reason: 'unparseable-response' };
  if (jobCount <= 0) return { accept: false, confidence: null, reason: 'board-empty' };

  if (boardName) {
    return namesMatch(companyName, boardName)
      ? { accept: true, confidence: 'high', reason: 'board-name-verified' }
      : { accept: false, confidence: null, reason: `board-name-mismatch:${String(boardName).slice(0, 40)}` };
  }
  if (strength === 'exact') {
    // Whole-name slug + a live board with postings. No name endpoint to confirm against, but the
    // slug is not a truncation, so a collision would require two companies with the same full name.
    return { accept: true, confidence: nameEndpointSupported ? 'medium' : 'high', reason: 'exact-slug' };
  }
  return { accept: false, confidence: null, reason: 'weak-slug-unverifiable' };
}

/** A `company_sources` row for an accepted discovery. */
export function sourceRow({ companyName, provider, tenant, jobCount, confidence, discoveredVia, careersUrl = null }) {
  return {
    company_name: companyName,
    provider,
    tenant,
    careers_url: careersUrl,
    source_type: 'ATS_DIRECT',
    ingestable: true,
    status: 'active',
    confidence,
    job_count: jobCount,
    consecutive_failures: 0,
    discovered_via: discoveredVia,
    last_verified_at: new Date().toISOString(),
  };
}

/**
 * Plan the probe order for one company: careers-page hits first (exact, no guessing), then slug
 * candidates across providers. Weak candidates are dropped entirely for providers that cannot verify
 * a board name, so we never spend a request on something we could not accept anyway.
 */
export function probePlan(companyName, { careersUrls = [], providers = PROVIDER_NAMES } = {}) {
  const plan = [];
  const seen = new Set();
  const add = (provider, tenant, strength, via) => {
    const key = `${provider}/${tenant}`;
    if (seen.has(key) || !providers.includes(provider)) return;
    seen.add(key);
    plan.push({ provider, tenant, strength, via });
  };

  for (const url of careersUrls) {
    const hit = tenantFromUrl(url);
    if (hit) add(hit.provider, hit.tenant, 'exact', 'careers-url');
  }
  for (const { slug, strength } of candidateSlugs(companyName)) {
    for (const provider of providers) {
      if (strength === 'weak' && !canVerifyName(provider)) continue; // unverifiable → skip
      add(provider, slug, strength, 'slug-probe');
    }
  }
  return plan;
}

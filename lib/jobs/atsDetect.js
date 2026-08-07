// Seen Job Ingestion — ATS PROVIDER DETECTION.
//
// Given any careers / apply URL, decide which Applicant Tracking System serves it and extract the
// company/tenant identifier. This is the engine of SNOWBALL DISCOVERY: every job Seen ingests from
// ANY source carries an apply URL, and the moment that URL reveals an ATS tenant (a Greenhouse
// board, a Lever account, an Ashby job board) Seen registers that employer as a first-class,
// employer-DIRECT source it can ingest from forever — without a human ever adding a company.
//
// `ingestable: true` = Seen has a safe public-JSON provider for it (atsProviders.js). `false` = the
// tenant is recorded for provenance/future support but not yet pulled directly. Pure, deterministic,
// no I/O. NO scraping, NO auth bypass — only public structured endpoints are ever ingested.

// Each pattern: { provider, sourceType, ingestable, test(url)->tenant|null }. Ordered most-specific
// first. Tenant is lowercased. Deterministic regex only.
const PATTERNS = [
  // ── Greenhouse (public JSON board API) ──
  { provider: 'greenhouse', ingestable: true, re: /(?:^|\/\/)(?:boards|job-boards|boards-api)\.greenhouse\.io\/(?:embed\/job_board\?for=)?([a-z0-9_-]+)/i, group: 1 },
  { provider: 'greenhouse', ingestable: true, re: /([a-z0-9_-]+)\.greenhouse\.io/i, group: 1 },
  // ── Lever (public JSON postings API) ──
  { provider: 'lever', ingestable: true, re: /jobs\.(?:eu\.)?lever\.co\/([a-z0-9_-]+)/i, group: 1 },
  { provider: 'lever', ingestable: true, re: /jobs\.lever\.co\/([a-z0-9_-]+)/i, group: 1 },
  // ── Ashby (public posting API) ──
  { provider: 'ashby', ingestable: true, re: /jobs\.ashbyhq\.com\/([a-z0-9_.-]+)/i, group: 1 },
  { provider: 'ashby', ingestable: true, re: /ashbyhq\.com\/([a-z0-9_.-]+)\/[a-f0-9-]{20,}/i, group: 1 },
  // ── SmartRecruiters (public postings API) ──
  { provider: 'smartrecruiters', ingestable: true, re: /(?:jobs|careers)\.smartrecruiters\.com\/([a-z0-9_-]+)/i, group: 1 },
  { provider: 'smartrecruiters', ingestable: true, re: /api\.smartrecruiters\.com\/v1\/companies\/([a-z0-9_-]+)/i, group: 1 },
  // ── Workable (public account widget API) ──
  { provider: 'workable', ingestable: true, re: /apply\.workable\.com\/([a-z0-9_-]+)/i, group: 1 },
  { provider: 'workable', ingestable: true, re: /([a-z0-9_-]+)\.workable\.com/i, group: 1 },
  // ── Recruitee (public JSON offers API) ──
  { provider: 'recruitee', ingestable: true, re: /([a-z0-9_-]+)\.recruitee\.com/i, group: 1 },
  // ── Detected-but-not-yet-ingestable (recorded for provenance + future providers) ──
  { provider: 'workday', ingestable: false, re: /([a-z0-9_-]+)\.(?:wd\d+\.)?myworkdayjobs\.com/i, group: 1 },
  { provider: 'icims', ingestable: false, re: /([a-z0-9_-]+)\.icims\.com/i, group: 1 },
  { provider: 'jobvite', ingestable: false, re: /jobs\.jobvite\.com\/([a-z0-9_-]+)/i, group: 1 },
  { provider: 'jazzhr', ingestable: false, re: /([a-z0-9_-]+)\.applytojob\.com/i, group: 1 },
  { provider: 'bamboohr', ingestable: false, re: /([a-z0-9_-]+)\.bamboohr\.com/i, group: 1 },
  { provider: 'personio', ingestable: false, re: /([a-z0-9_-]+)\.jobs\.personio\.(?:com|de)/i, group: 1 },
  { provider: 'successfactors', ingestable: false, re: /([a-z0-9_-]+)\.(?:successfactors|sapsf)\.(?:com|eu)/i, group: 1 },
  { provider: 'taleo', ingestable: false, re: /([a-z0-9_-]+)\.taleo\.net/i, group: 1 },
  { provider: 'oraclecloud', ingestable: false, re: /([a-z0-9_-]+)\.oraclecloud\.com/i, group: 1 },
  { provider: 'adp', ingestable: false, re: /workforcenow\.adp\.com/i, group: 0, staticTenant: 'adp' },
  { provider: 'paylocity', ingestable: false, re: /recruiting\.paylocity\.com\/recruiting\/jobs\/[^/]+\/([a-z0-9_-]+)/i, group: 1 },
];

// Reserved sub-labels that are the ATS's own hostname parts, never a tenant.
const RESERVED = new Set(['www', 'api', 'jobs', 'boards', 'job-boards', 'boards-api', 'careers', 'apply', 'app', 'secure', 'my', 'client', 'clients']);

// Detect the ATS provider + tenant from a URL. Returns { provider, tenant, sourceType, ingestable,
// careersUrl } or null when no known ATS matches.
export function detectAts(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  let url = rawUrl.trim();
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  let host = '';
  try { host = new URL(url).hostname.toLowerCase(); } catch { /* fall through to regex on raw */ }
  for (const p of PATTERNS) {
    const m = p.re.exec(url);
    if (!m) continue;
    const tenant = p.staticTenant || (m[p.group] || '').toLowerCase();
    if (!tenant || RESERVED.has(tenant) || tenant.length < 2 || tenant.length > 60) continue;
    return {
      provider: p.provider,
      tenant,
      sourceType: 'ATS_DIRECT',
      ingestable: !!p.ingestable,
      careersUrl: url,
      host,
    };
  }
  return null;
}

// Is a URL an employer-direct ATS URL (vs an aggregator/redirect)? Aggregator redirect URLs
// (adzuna, indeed, ziprecruiter, google) are explicitly NOT employer-direct.
const AGGREGATOR_HOSTS = /(^|\.)(adzuna|indeed|ziprecruiter|glassdoor|linkedin|monster|simplyhired|talent|jooble|neuvoo|careerbuilder|dice|snagajob)\.(com|co\.\w+|io)/i;
export function isAggregatorUrl(url) {
  if (!url) return false;
  try { return AGGREGATOR_HOSTS.test(new URL(/^https?:/i.test(url) ? url : 'https://' + url).hostname); }
  catch { return AGGREGATOR_HOSTS.test(String(url)); }
}

// The set of providers Seen can currently ingest DIRECTLY (has a public-JSON provider for).
export const INGESTABLE_PROVIDERS = new Set(PATTERNS.filter((p) => p.ingestable).map((p) => p.provider));

export { PATTERNS as ATS_PATTERNS };

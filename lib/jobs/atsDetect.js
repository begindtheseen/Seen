// Seen Job Ingestion — ATS PROVIDER DETECTION.
//
// Given any careers / apply URL, decide which Applicant Tracking System serves it and extract the
// company/tenant identifier. This is the engine of SNOWBALL DISCOVERY: every job Seen ingests from
// ANY source carries an apply URL, and the moment that URL reveals an ATS tenant (a Greenhouse
// board, a Lever account, an Ashby job board) Seen registers that employer as a first-class,
// employer-DIRECT source it can ingest from forever — without a human ever adding a company.
//
// SECURITY: matching is done on the PARSED, FULLY-ANCHORED hostname (never a substring regex over
// the raw URL) so a spoofed host like `boards.greenhouse.io.evil.com` can NEVER be mis-detected as a
// greenhouse board. `ingestable: true` = Seen has a safe public-JSON provider for it. Pure,
// deterministic, no I/O. NO scraping, NO auth bypass — only public structured endpoints.

// Each matcher tests the fully-anchored HOSTNAME (^…$). `tenant` says where the identifier lives:
//   'sub'   — the captured subdomain label (group 1 of hostRe)
//   'path0' — the first path segment
//   'gh'    — Greenhouse: the ?for= query param, else the first path segment
//   'sr'    — SmartRecruiters: the segment after "companies", else the first path segment
const HOST_MATCHERS = [
  { provider: 'greenhouse', ingestable: true, hostRe: /^(?:boards|job-boards|boards-api)\.greenhouse\.io$/, tenant: 'gh' },
  { provider: 'greenhouse', ingestable: true, hostRe: /^([a-z0-9-]+)\.greenhouse\.io$/, tenant: 'sub' },
  { provider: 'lever', ingestable: true, hostRe: /^jobs\.(?:eu\.)?lever\.co$/, tenant: 'path0' },
  { provider: 'ashby', ingestable: true, hostRe: /^jobs\.ashbyhq\.com$/, tenant: 'path0' },
  { provider: 'smartrecruiters', ingestable: true, hostRe: /^(?:jobs|careers|api)\.smartrecruiters\.com$/, tenant: 'sr' },
  { provider: 'workable', ingestable: true, hostRe: /^apply\.workable\.com$/, tenant: 'path0' },
  { provider: 'workable', ingestable: true, hostRe: /^([a-z0-9-]+)\.workable\.com$/, tenant: 'sub' },
  { provider: 'recruitee', ingestable: true, hostRe: /^([a-z0-9-]+)\.recruitee\.com$/, tenant: 'sub' },
  // Detected-but-not-yet-ingestable (recorded for provenance + future providers).
  { provider: 'workday', ingestable: false, hostRe: /^([a-z0-9-]+)\.(?:wd\d+\.)?myworkdayjobs\.com$/, tenant: 'sub' },
  { provider: 'icims', ingestable: false, hostRe: /^(?:careers-)?([a-z0-9-]+)\.icims\.com$/, tenant: 'sub' },
  { provider: 'jobvite', ingestable: false, hostRe: /^(?:jobs|careers)\.jobvite\.com$/, tenant: 'path0' },
  { provider: 'jazzhr', ingestable: false, hostRe: /^([a-z0-9-]+)\.applytojob\.com$/, tenant: 'sub' },
  { provider: 'bamboohr', ingestable: false, hostRe: /^([a-z0-9-]+)\.bamboohr\.com$/, tenant: 'sub' },
  { provider: 'personio', ingestable: false, hostRe: /^([a-z0-9-]+)\.jobs\.personio\.(?:com|de)$/, tenant: 'sub' },
  { provider: 'successfactors', ingestable: false, hostRe: /^([a-z0-9-]+)\.(?:successfactors|sapsf)\.(?:com|eu)$/, tenant: 'sub' },
  { provider: 'taleo', ingestable: false, hostRe: /^([a-z0-9-]+)\.taleo\.net$/, tenant: 'sub' },
  { provider: 'oraclecloud', ingestable: false, hostRe: /^([a-z0-9-]+)\.oraclecloud\.com$/, tenant: 'sub' },
  { provider: 'adp', ingestable: false, hostRe: /^workforcenow\.adp\.com$/, staticTenant: 'adp' },
];

// Reserved sub-labels that are the ATS's own hostname parts, never a tenant.
const RESERVED = new Set(['www', 'api', 'jobs', 'boards', 'job-boards', 'boards-api', 'careers', 'apply', 'app', 'secure', 'my', 'client', 'clients', 'recruiting', 'embed']);
const TENANT_RE = /^[a-z0-9][a-z0-9._-]*$/;

function parse(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  try { return new URL(/^https?:\/\//i.test(rawUrl) ? rawUrl.trim() : 'https://' + rawUrl.trim()); }
  catch { return null; }
}

// Detect the ATS provider + tenant from a URL. Returns { provider, tenant, sourceType, ingestable,
// careersUrl, host } or null when no known ATS matches the URL's actual host.
export function detectAts(rawUrl) {
  const u = parse(rawUrl);
  if (!u) return null;
  const host = u.hostname.toLowerCase();
  const segs = u.pathname.split('/').filter(Boolean);
  for (const p of HOST_MATCHERS) {
    const m = p.hostRe.exec(host);
    if (!m) continue;
    let tenant = p.staticTenant || '';
    if (!tenant) {
      if (p.tenant === 'sub') tenant = m[1] || '';
      else if (p.tenant === 'path0') tenant = segs[0] || '';
      else if (p.tenant === 'gh') tenant = u.searchParams.get('for') || segs[0] || '';
      else if (p.tenant === 'sr') { const i = segs.indexOf('companies'); tenant = (i >= 0 ? segs[i + 1] : segs[0]) || ''; }
    }
    tenant = tenant.toLowerCase();
    if (!tenant || RESERVED.has(tenant) || tenant.length < 2 || tenant.length > 60 || !TENANT_RE.test(tenant)) continue;
    return { provider: p.provider, tenant, sourceType: 'ATS_DIRECT', ingestable: !!p.ingestable, careersUrl: u.toString(), host };
  }
  return null;
}

// Aggregator/redirect hosts (NOT employer-direct). Matched on the parsed, anchored hostname.
const AGGREGATOR_DOMAINS = ['adzuna.com', 'indeed.com', 'ziprecruiter.com', 'glassdoor.com', 'linkedin.com', 'monster.com', 'simplyhired.com', 'talent.com', 'jooble.org', 'neuvoo.com', 'careerbuilder.com', 'dice.com', 'snagajob.com'];
export function isAggregatorUrl(url) {
  const u = parse(url);
  if (!u) return false;
  const host = u.hostname.toLowerCase();
  return AGGREGATOR_DOMAINS.some((d) => host === d || host.endsWith('.' + d));
}

// Providers Seen can currently ingest DIRECTLY (has a public-JSON provider for).
export const INGESTABLE_PROVIDERS = new Set(HOST_MATCHERS.filter((p) => p.ingestable).map((p) => p.provider));

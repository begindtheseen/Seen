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
//   'fn'    — a provider-specific key built from the host and path (see the functions below)
const HOST_MATCHERS = [
  { provider: 'greenhouse', ingestable: true, hostRe: /^(?:boards|job-boards|boards-api)\.greenhouse\.io$/, tenant: 'gh' },
  { provider: 'greenhouse', ingestable: true, hostRe: /^([a-z0-9-]+)\.greenhouse\.io$/, tenant: 'sub' },
  { provider: 'lever', ingestable: true, hostRe: /^jobs\.(?:eu\.)?lever\.co$/, tenant: 'path0' },
  { provider: 'ashby', ingestable: true, hostRe: /^jobs\.ashbyhq\.com$/, tenant: 'path0' },
  { provider: 'smartrecruiters', ingestable: true, hostRe: /^(?:jobs|careers|api)\.smartrecruiters\.com$/, tenant: 'sr' },
  { provider: 'workable', ingestable: true, hostRe: /^apply\.workable\.com$/, tenant: 'path0' },
  { provider: 'workable', ingestable: true, hostRe: /^([a-z0-9-]+)\.workable\.com$/, tenant: 'sub' },
  { provider: 'recruitee', ingestable: true, hostRe: /^([a-z0-9-]+)\.recruitee\.com$/, tenant: 'sub' },
  // List + detail boards (lib/jobs/providers/*). Their tenant is a PATH-shaped key built by `fn`; a URL
  // that lacks the part a sync needs (a Workday host with no site, an Oracle host with no site number)
  // falls through to the not-ingestable matcher after it, exactly as before these readers existed.
  { provider: 'workday', ingestable: true, hostRe: /^([a-z0-9-]+)(\.wd\d{1,3})?\.myworkdayjobs\.com$/, tenant: 'fn', fn: workdayTenant },
  { provider: 'oraclecloud', ingestable: true, hostRe: /^(?:[a-z0-9-]{1,63}\.){1,5}oraclecloud\.com$/, tenant: 'fn', fn: oracleTenant },
  { provider: 'ukg', ingestable: true, hostRe: /^recruiting\d{0,2}\.ultipro\.com$/, tenant: 'fn', fn: ukgTenant },
  { provider: 'empforce', ingestable: true, hostRe: /^([a-z0-9]{2,12})\.empforce\.com$/, tenant: 'fn', fn: empforceTenant },
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

// ── path-shaped tenants (one function per list + detail provider) ────────────────────────────────
// Each returns the full tenant key its provider parses (lib/jobs/providers/<provider>.js), lower case,
// or null when the URL does not carry every part of it. `m` is the host match, `segs` the path segments.
const PART_RE = /^[a-z0-9][a-z0-9_.-]{0,99}$/i;
const LOCALE_RE = /^[a-z]{2}(?:-[a-z]{2})?$/i;
const WD_NOT_SITE = new Set(['job', 'jobs', 'details', 'login', 'apply', 'wday', 'userhome', 'introduceyourself', 'search']);

// https://hpinc.wd5.myworkdayjobs.com/en-US/hpinc/job/… → "hpinc.wd5/hpinc/hpinc"
// https://x.wd1.myworkdayjobs.com/wday/cxs/<tenant>/<site>/jobs → "x.wd1/<tenant>/<site>"
function workdayTenant(m, segs) {
  let tenant = m[1];
  let site;
  if (segs[0] === 'wday' && segs[1] === 'cxs') { tenant = segs[2]; site = segs[3]; }
  else site = LOCALE_RE.test(segs[0] || '') ? segs[1] : segs[0];
  if (!site || !tenant || WD_NOT_SITE.has(site.toLowerCase()) || !PART_RE.test(site) || !PART_RE.test(tenant)) return null;
  return `${m[1]}${m[2] || ''}/${tenant}/${site}`.toLowerCase();
}

// https://<host>/hcmUI/CandidateExperience/en/sites/CX_1/job/123 → "<host>/cx_1"
function oracleTenant(m, segs, host) {
  const i = segs.findIndex((x) => x.toLowerCase() === 'sites');
  if (segs[0]?.toLowerCase() !== 'hcmui' || segs[1]?.toLowerCase() !== 'candidateexperience' || i < 2) return null;
  const site = segs[i + 1] || '';
  return /^[a-z0-9_]{1,40}$/i.test(site) ? `${host}/${site}`.toLowerCase() : null;
}

// https://recruiting2.ultipro.com/ATL1007ATSC/JobBoard/<guid>/… → "recruiting2.ultipro.com/atl1007atsc/<guid>"
function ukgTenant(m, segs, host) {
  const [code, kind, board] = segs;
  if (!/^[a-z0-9]{3,24}$/i.test(code || '') || String(kind || '').toLowerCase() !== 'jobboard') return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(board || '')) return null;
  return `${host}/${code}/${board}`.toLowerCase();
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
/**
 * An EmpForce board key (`Cd`, base64, case-sensitive) as hex — the registry lowercases tenants, and
 * hex survives that. null when the value is not canonical base64. Pure (no Buffer/atob).
 */
export function empforceKeyHex(cd) {
  const s = String(cd || '').trim();
  if (!s || s.length % 4 !== 0 || s.length > 160 || !/^[A-Za-z0-9+/]+={0,2}$/.test(s)) return null;
  let bits = 0; let acc = 0; let hex = '';
  for (const ch of s.replace(/=+$/, '')) {
    acc = (acc << 6) | B64.indexOf(ch);
    bits += 6;
    if (bits >= 8) { bits -= 8; hex += ((acc >> bits) & 0xff).toString(16).padStart(2, '0'); }
  }
  // canonical only: the bits left over after the last byte must be zero
  return hex && (acc & ((1 << bits) - 1)) === 0 ? hex : null;
}

// https://na1.empforce.com/Recruiting/Applicant/JobListings.aspx?Cd=cXSAlMyrKnU%3d → "na1/71748094ccab2a75"
function empforceTenant(m, segs, host, u) {
  if (String(segs[0] || '').toLowerCase() !== 'recruiting') return null;
  // URLSearchParams reads a literal "+" as a space; a base64 key never holds a space.
  const cd = (u.searchParams.get('Cd') || u.searchParams.get('cd') || '').replace(/ /g, '+');
  const hex = empforceKeyHex(cd);
  return hex ? `${m[1]}/${hex}` : null;
}

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
    if (p.tenant === 'fn') {
      const key = p.fn(m, segs, host, u);
      if (!key || key.length > 160) continue;
      return { provider: p.provider, tenant: key, sourceType: 'ATS_DIRECT', ingestable: !!p.ingestable, careersUrl: u.toString(), host };
    }
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

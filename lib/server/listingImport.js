// Paste-a-link listing import — pure extraction + URL safety helpers.
//
// Given the raw HTML of ANY job-listing page (Indeed, LinkedIn, Greenhouse, Lever,
// Workday, a company's own careers page, …), pull out a normalized listing the same
// shape the aggregation engine produces, so an imported job flows through the exact
// same optimize/track/score pipeline as a searched one.
//
// Extraction ladder (most→least structured, never fabricates):
//   1. schema.org JobPosting JSON-LD — what Google Jobs indexes; present on the vast
//      majority of job boards and ATS-hosted pages.
//   2. OpenGraph/Twitter meta + <title> heuristics — board-specific title patterns.
//   3. The URL itself — ATS hosts (greenhouse/lever/ashby/…) carry the company slug.
// Anything still missing is returned empty; the caller asks the user rather than
// inventing a value.
//
// This module is pure (no fetch, no DB) so it's unit-testable; api/import-listing.js
// owns the network + persistence.

import { normalizeCompany, cleanDescription, inferLevel, formatSalary } from './jobSources.js';
import { scoreJob, wasteScore } from './jobScore.js';

// ── URL safety ──────────────────────────────────────────────────────────────────
// The import endpoint fetches a user-supplied URL server-side, so it must never be
// pointable at anything private (SSRF). Hostname-level checks live here; the API
// handler additionally DNS-resolves every redirect hop through isPrivateIp().

export function isPrivateIp(ip) {
  const s = String(ip || '').trim().toLowerCase();
  if (!s) return true;
  // IPv6 (incl. IPv4-mapped)
  if (s.includes(':')) {
    if (s === '::' || s === '::1') return true;
    if (/^fe[89ab]/.test(s)) return true;            // link-local fe80::/10
    if (/^f[cd]/.test(s)) return true;               // unique-local fc00::/7
    const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    return false;
  }
  const parts = s.split('.').map(Number);
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;           // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 192 && b === 0) return true;             // 192.0.0.0/24 + 192.0.2.0/24 docs
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true;                         // multicast/reserved
  return false;
}

const BLOCKED_HOST_SUFFIXES = ['.local', '.localdomain', '.internal', '.lan', '.home', '.corp'];

// Tracking params stripped so the same listing pasted from two places dedupes to one
// row. ONLY well-known analytics params — job boards use significant query params
// (Indeed's jk=, Workday's locale) that must survive.
const TRACKING_PARAMS = /^(utm_\w+|fbclid|gclid|gclsrc|dclid|msclkid|mc_cid|mc_eid|igshid|vero_\w+|_hs\w+|trk|trackingid|refid|original_referer)$/i;

// Validate + canonicalize a pasted listing URL. Accepts scheme-less pastes
// ("www.indeed.com/…"). Returns { ok, url, host } or { ok:false, error }.
export function validateListingUrl(raw) {
  let s = String(raw || '').trim();
  if (!s) return { ok: false, error: 'Paste a job listing link.' };
  if (s.length > 2000) return { ok: false, error: 'That link is too long.' };
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s}`;
  let u;
  try { u = new URL(s); } catch { return { ok: false, error: 'That doesn’t look like a valid link.' }; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    return { ok: false, error: 'Only http(s) links are supported.' };
  }
  if (u.username || u.password) return { ok: false, error: 'Links with credentials aren’t supported.' };
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!host || host === 'localhost' || !host.includes('.')) {
    return { ok: false, error: 'That link isn’t reachable from here.' };
  }
  if (BLOCKED_HOST_SUFFIXES.some(sfx => host.endsWith(sfx))) {
    return { ok: false, error: 'That link isn’t reachable from here.' };
  }
  // IP-literal hosts: allow only public IPs (rare but legitimate); private → reject.
  const bareV6 = host.startsWith('[') ? host.slice(1, -1) : host;
  if (/^[\d.]+$/.test(host) || bareV6.includes(':')) {
    if (isPrivateIp(bareV6)) return { ok: false, error: 'That link isn’t reachable from here.' };
  }
  u.hash = '';
  for (const key of [...u.searchParams.keys()]) {
    if (TRACKING_PARAMS.test(key)) u.searchParams.delete(key);
  }
  return { ok: true, url: u.toString(), host };
}

// ── Company / title inference from the URL itself ──────────────────────────────
// ATS-hosted listing URLs carry the employer slug — the most reliable signal when a
// page blocks scraping (Indeed/LinkedIn bot walls) or omits structured data.

const slugToName = (slug) =>
  String(slug || '')
    .replace(/[-_+]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map(w => (w.length > 2 ? w[0].toUpperCase() + w.slice(1) : w.toUpperCase()))
    .join(' ');

export function companyFromUrl(urlStr) {
  let u;
  try { u = new URL(urlStr); } catch { return ''; }
  const host = u.hostname.toLowerCase();
  const segs = u.pathname.split('/').filter(Boolean);

  // path-slug ATSes: first path segment is the company
  if (/(^|\.)greenhouse\.io$/.test(host) && segs[0] && !['embed', 'jobs'].includes(segs[0])) return slugToName(segs[0]);
  if (host === 'jobs.lever.co' && segs[0]) return slugToName(segs[0]);
  if (host === 'jobs.ashbyhq.com' && segs[0]) return slugToName(segs[0]);
  if (host === 'apply.workable.com' && segs[0]) return slugToName(segs[0]);
  if (host === 'careers.smartrecruiters.com' && segs[0]) return slugToName(segs[0]);
  if (host === 'jobs.jobvite.com' && segs[0]) return slugToName(segs[0]);
  if (host === 'jobs.smartrecruiters.com' && segs[0]) return slugToName(segs[0]);

  // subdomain ATSes: company is the subdomain
  let m = host.match(/^([a-z0-9-]+)\.wd\d+\.myworkdayjobs\.com$/);
  if (m) return slugToName(m[1]);
  m = host.match(/^([a-z0-9-]+)\.(breezy\.hr|bamboohr\.com|recruitee\.com|applytojob\.com|workable\.com|teamtailor\.com|pinpointhq\.com)$/);
  if (m && m[1] !== 'www' && m[1] !== 'jobs' && m[1] !== 'apply' && m[1] !== 'careers') return slugToName(m[1]);

  // LinkedIn job slugs: /jobs/view/<title>-at-<company>-<numeric id>
  if (/(^|\.)linkedin\.com$/.test(host)) {
    const view = u.pathname.match(/\/jobs\/view\/(.+?)(?:\/|$)/);
    if (view) {
      const slug = view[1].replace(/-\d+$/, '');
      const at = slug.split('-at-');
      if (at.length === 2 && at[1]) return slugToName(at[1]);
    }
  }
  return '';
}

// Title from URL slug where the pattern is unambiguous (LinkedIn's <title>-at-<company>).
export function titleFromUrl(urlStr) {
  let u;
  try { u = new URL(urlStr); } catch { return ''; }
  if (/(^|\.)linkedin\.com$/.test(u.hostname.toLowerCase())) {
    const view = u.pathname.match(/\/jobs\/view\/(.+?)(?:\/|$)/);
    if (view) {
      const slug = view[1].replace(/-\d+$/, '');
      const at = slug.split('-at-');
      if (at.length === 2 && at[0]) return slugToName(at[0]);
    }
  }
  return '';
}

// ── HTML helpers (regex-level; no DOM in serverless) ────────────────────────────

const decodeEntities = (s) =>
  String(s || '')
    .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#(\d+);/g, (_, n) => { const c = Number(n); return c > 31 && c < 65536 ? String.fromCharCode(c) : ' '; });

function getMeta(html, key) {
  // <meta property="og:title" content="…"> — attribute order varies across sites.
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>`, 'i');
  const tag = html.match(re)?.[0];
  if (!tag) return '';
  const content = tag.match(/content=["']([\s\S]*?)["']/i)?.[1];
  return content ? decodeEntities(content).trim() : '';
}

function getTitleTag(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decodeEntities(m[1]).replace(/\s+/g, ' ').trim() : '';
}

// ── JSON-LD JobPosting ──────────────────────────────────────────────────────────

function parseJsonLdBlocks(html) {
  const out = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const raw = m[1].replace(/^\s*<!--/, '').replace(/-->\s*$/, '').trim();
    if (!raw) continue;
    try { out.push(JSON.parse(raw)); } catch { /* malformed block — skip */ }
  }
  return out;
}

function findJobPosting(node) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const n of node) { const hit = findJobPosting(n); if (hit) return hit; }
    return null;
  }
  const type = node['@type'];
  const types = Array.isArray(type) ? type : [type];
  if (types.some(t => String(t || '').toLowerCase() === 'jobposting')) return node;
  if (node['@graph']) return findJobPosting(node['@graph']);
  if (node.mainEntity) return findJobPosting(node.mainEntity);
  return null;
}

function locationFromJobPosting(jp) {
  if (String(jp.jobLocationType || '').toUpperCase() === 'TELECOMMUTE') return 'Remote';
  const locNode = Array.isArray(jp.jobLocation) ? jp.jobLocation[0] : jp.jobLocation;
  const addr = locNode && typeof locNode === 'object' ? (locNode.address ?? locNode) : null;
  if (typeof addr === 'string') return addr.trim();
  if (addr && typeof addr === 'object') {
    const city = String(addr.addressLocality || '').trim();
    const region = String(addr.addressRegion || '').trim();
    if (city && region) return `${city}, ${region}`;
    if (city || region) return city || region;
    const country = String(addr.addressCountry?.name || addr.addressCountry || '').trim();
    if (country) return country;
  }
  const applicant = Array.isArray(jp.applicantLocationRequirements)
    ? jp.applicantLocationRequirements[0] : jp.applicantLocationRequirements;
  if (applicant?.name) return String(applicant.name).trim();
  return '';
}

function salaryFromJobPosting(jp) {
  const base = jp.baseSalary;
  if (!base || typeof base !== 'object') return { salary: null, salaryMin: 0 };
  const val = base.value && typeof base.value === 'object' ? base.value : base;
  const min = Number(val.minValue ?? val.value ?? 0) || 0;
  const max = Number(val.maxValue ?? val.value ?? 0) || 0;
  return { salary: formatSalary(min, max), salaryMin: min };
}

function mapJobPosting(jp) {
  const org = jp.hiringOrganization;
  const employment = Array.isArray(jp.employmentType) ? jp.employmentType.join(' ') : String(jp.employmentType || '');
  const { salary, salaryMin } = salaryFromJobPosting(jp);
  return {
    title: decodeEntities(String(jp.title || jp.name || '')).replace(/\s+/g, ' ').trim(),
    company: decodeEntities(String((org && typeof org === 'object' ? org.name : org) || '')).replace(/\s+/g, ' ').trim(),
    location: locationFromJobPosting(jp),
    salary,
    salaryMin,
    description: String(jp.description || ''),
    type: /part[\s_-]?time/i.test(employment) ? 'Part-time' : 'Full-time',
  };
}

// ── Meta / <title> fallback ─────────────────────────────────────────────────────

// Board/aggregator brands that must never be mistaken for the hiring company.
const BOARD_BRANDS = /^(indeed|linkedin|glassdoor|ziprecruiter|monster|careerbuilder|simplyhired|snagajob|lensa|adzuna|jooble|talent\.com|dice|wellfound|angellist|builtin|built in|google|jobot|themuse|the muse|remotive|remoteok|remote ok|jobicy|greenhouse|lever|workday|ashby|workable|smartrecruiters|jobvite|indeed\.com|linkedin\.com)$/i;

const isBoardBrand = (s) => BOARD_BRANDS.test(String(s || '').trim().replace(/\.(com|io|co|org)$/i, ''));

// "Austin, TX" / "Remote" / "New York, New York" — used to tell a location segment
// from a company segment in split titles.
const looksLikeLocation = (s) =>
  /\bremote\b/i.test(s) || /,\s*[A-Z]{2}\b/.test(s) || /^[A-Za-z .'-]+,\s*[A-Za-z .'-]+$/.test(s.trim());

// Bot-challenge pages return 200 with titles like "Just a moment..." — those must never
// become a listing's title (verified live: jina hit Indeed's Cloudflare challenge).
export const CHALLENGE_TITLE = /just a moment|access denied|attention required|verify you are (a )?human|security check|cloudflare|captcha|robot check|request blocked|pardon our interruption|are you a robot/i;

// Parse a page <title>/og:title into { title, company, location } — only fills what
// the pattern makes unambiguous.
export function parseListingTitle(rawTitle) {
  const out = { title: '', company: '', location: '' };
  let t = decodeEntities(String(rawTitle || '')).replace(/\s+/g, ' ').trim();
  if (!t || CHALLENGE_TITLE.test(t)) return out;

  // "Company hiring Title in City, ST | LinkedIn"
  let m = t.match(/^(.{2,80}?) hiring (.{2,120}?) in (.{2,80}?)(?:\s*[|·-]\s*LinkedIn.*)?$/i);
  if (m) {
    out.company = m[1].trim(); out.title = m[2].trim(); out.location = m[3].trim();
    return out;
  }

  // Strip a trailing board brand: "… - Indeed.com", "… | Glassdoor"
  const parts = t.split(/\s+[|–—-]\s+/).map(p => p.trim()).filter(Boolean);
  while (parts.length > 1 && isBoardBrand(parts[parts.length - 1])) parts.pop();

  // "Title at Company"
  m = parts[0]?.match(/^(.{2,120}?) at (.{2,80})$/i);
  if (m) { out.title = m[1].trim(); out.company = m[2].trim(); }
  else out.title = parts[0] || '';

  // Remaining segments: a location-looking one fills location; the first
  // non-location, non-board segment fills company (if still empty).
  for (const seg of parts.slice(1)) {
    if (!out.location && looksLikeLocation(seg)) { out.location = seg; continue; }
    if (!out.company && !isBoardBrand(seg) && seg.length <= 80) out.company = seg;
  }
  return out;
}

// ── Top-level extraction ────────────────────────────────────────────────────────
// Returns { title, company, location, salary, salaryMin, description, type, via }.
// `via` records which rung of the ladder produced the core fields — honest provenance
// for confidence display and debugging. Missing fields are '' / null, never guessed.
export function extractListingFromHtml(html, urlStr) {
  const page = String(html || '');
  let fields = { title: '', company: '', location: '', salary: null, salaryMin: 0, description: '', type: 'Full-time' };
  let via = 'none';

  const jp = findJobPosting(parseJsonLdBlocks(page));
  if (jp) {
    fields = { ...fields, ...mapJobPosting(jp) };
    via = 'jsonld';
  }

  if (!fields.title || !fields.company) {
    const titleParsed = parseListingTitle(getMeta(page, 'og:title') || getMeta(page, 'twitter:title') || getTitleTag(page));
    if (!fields.title && titleParsed.title) { fields.title = titleParsed.title; if (via === 'none') via = 'meta'; }
    if (!fields.company && titleParsed.company && !isBoardBrand(titleParsed.company)) fields.company = titleParsed.company;
    if (!fields.location && titleParsed.location) fields.location = titleParsed.location;
    // og:site_name is the company on self-hosted careers pages — but the BOARD brand
    // on aggregators, so it only counts when it isn't a known board.
    if (!fields.company) {
      const site = getMeta(page, 'og:site_name');
      if (site && !isBoardBrand(site)) fields.company = site;
    }
  }

  if (!fields.description) {
    fields.description = getMeta(page, 'og:description') || getMeta(page, 'description') || '';
  }

  // Rung 3: the URL itself (ATS slugs) — fills whatever is still missing.
  if (!fields.company) {
    const fromUrl = companyFromUrl(urlStr);
    if (fromUrl) { fields.company = fromUrl; if (via === 'none') via = 'url'; }
  }
  if (!fields.title) {
    const fromUrl = titleFromUrl(urlStr);
    if (fromUrl) { fields.title = fromUrl; if (via === 'none') via = 'url'; }
  }

  return { ...fields, via };
}

// ── Keyless ATS JSON APIs ($0 enrichment) ───────────────────────────────────────
// Owner decision 2026-07-10: every imported listing must be scored, with no paid API.
// The scorer is already free (jobScore.js, deterministic) — what it needs is listing
// signal, and many ATS pages are JS-rendered or bot-walled so their HTML yields nothing.
// But the SAME listing is served as public, keyless JSON at a documented endpoint on
// each major ATS. atsApiPlan() maps a listing URL to that endpoint; mapAtsJson() maps
// the response back into extraction fields. No keys, no quotas we pay for.

export function atsApiPlan(urlStr) {
  let u;
  try { u = new URL(urlStr); } catch { return null; }
  const host = u.hostname.toLowerCase();
  const segs = u.pathname.split('/').filter(Boolean);

  // Greenhouse: boards(.|-)greenhouse.io/{board}/jobs/{id} and the embed form.
  // API: boards-api.greenhouse.io/v1/boards/{board}/jobs/{id}
  if (/(^|\.)greenhouse\.io$/.test(host)) {
    if (segs[0] === 'embed') {
      const board = u.searchParams.get('for');
      const id = u.searchParams.get('token') || u.searchParams.get('gh_jid');
      if (board && /^\d+$/.test(String(id || ''))) {
        return { kind: 'greenhouse', apiUrl: `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs/${id}`, company: slugToName(board) };
      }
      return null;
    }
    const ji = segs.indexOf('jobs');
    if (segs[0] && ji > 0 && /^\d+$/.test(segs[ji + 1] || '')) {
      return { kind: 'greenhouse', apiUrl: `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(segs[0])}/jobs/${segs[ji + 1]}`, company: slugToName(segs[0]) };
    }
    return null;
  }

  // Lever: jobs.lever.co/{company}/{uuid} → api.lever.co/v0/postings/{company}/{uuid}
  if (host === 'jobs.lever.co' && segs[0] && /^[0-9a-f-]{36}$/i.test(segs[1] || '')) {
    return { kind: 'lever', apiUrl: `https://api.lever.co/v0/postings/${encodeURIComponent(segs[0])}/${segs[1]}`, company: slugToName(segs[0]) };
  }

  // Ashby: jobs.ashbyhq.com/{org}/{uuid} → posting-api job board (filter by job id)
  if (host === 'jobs.ashbyhq.com' && segs[0] && /^[0-9a-f-]{36}$/i.test(segs[1] || '')) {
    return { kind: 'ashby', apiUrl: `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(segs[0])}?includeCompensation=true`, company: slugToName(segs[0]), jobId: segs[1].toLowerCase() };
  }

  // SmartRecruiters: (jobs|careers).smartrecruiters.com/{Company}/{digits}-{slug}
  if (/^(jobs|careers)\.smartrecruiters\.com$/.test(host) && segs[0] && segs[1]) {
    const m = segs[1].match(/^(\d{9,})/);
    if (m) return { kind: 'smartrecruiters', apiUrl: `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(segs[0])}/postings/${m[1]}`, company: slugToName(segs[0]) };
    return null;
  }

  // Workday: {tenant}.wd{n}.myworkdayjobs.com/({locale}/)?{site}/job/… — pages are fully
  // JS-rendered (HTML extraction always fails); the cxs endpoint serves the posting JSON.
  const wd = host.match(/^([a-z0-9-]+)\.wd\d+\.myworkdayjobs\.com$/);
  if (wd) {
    let s = segs;
    if (s[0] && /^[a-z]{2}-[A-Z]{2}$/.test(s[0])) s = s.slice(1); // strip locale (en-US)
    const ji = s.indexOf('job');
    if (ji >= 1) {
      return { kind: 'workday', apiUrl: `https://${host}/wday/cxs/${wd[1]}/${s.slice(0, ji).join('/')}/${s.slice(ji).join('/')}`, company: slugToName(wd[1]) };
    }
    return null;
  }

  return null;
}

export function mapAtsJson(plan, json) {
  if (!plan || !json || typeof json !== 'object') return null;
  const clean = (s) => decodeEntities(String(s || '')).replace(/\s+/g, ' ').trim();
  try {
    if (plan.kind === 'greenhouse') {
      if (!json.title && !json.content) return null;
      return {
        title: clean(json.title),
        company: clean(json.company_name) || plan.company,
        location: clean(json.location?.name),
        description: decodeEntities(String(json.content || '')), // HTML-escaped HTML
      };
    }
    if (plan.kind === 'lever') {
      if (!json.text) return null;
      const cat = json.categories || {};
      const sr = json.salaryRange || {};
      const min = Number(sr.min) || 0, max = Number(sr.max) || 0;
      return {
        title: clean(json.text),
        company: plan.company,
        location: clean(cat.location),
        salary: (min || max) ? formatSalary(min, max) : null,
        salaryMin: min,
        description: String(json.descriptionPlain || json.description || ''),
        type: /part/i.test(String(cat.commitment || '')) ? 'Part-time' : 'Full-time',
      };
    }
    if (plan.kind === 'ashby') {
      const jobs = Array.isArray(json.jobs) ? json.jobs : [];
      const hit = jobs.find(j => String(j.id || '').toLowerCase() === plan.jobId || String(j.jobUrl || '').toLowerCase().includes(plan.jobId));
      if (!hit) return null;
      return {
        title: clean(hit.title),
        company: plan.company,
        location: clean(hit.location),
        description: String(hit.descriptionHtml || hit.descriptionPlain || ''),
        type: /part/i.test(String(hit.employmentType || '')) ? 'Part-time' : 'Full-time',
      };
    }
    if (plan.kind === 'smartrecruiters') {
      if (!json.name) return null;
      const sec = json.jobAd?.sections || {};
      const loc = json.location || {};
      return {
        title: clean(json.name),
        company: clean(json.company?.name) || plan.company,
        location: [loc.city, loc.region || loc.country].map(x => clean(x)).filter(Boolean).join(', '),
        description: ['companyDescription', 'jobDescription', 'qualifications', 'additionalInformation']
          .map(k => String(sec[k]?.text || '')).filter(Boolean).join(' '),
        type: /part/i.test(String(json.typeOfEmployment?.label || '')) ? 'Part-time' : 'Full-time',
      };
    }
    if (plan.kind === 'workday') {
      const info = json.jobPostingInfo || {};
      if (!info.title) return null;
      return {
        title: clean(info.title),
        company: clean(json.hiringOrganization?.name) || plan.company,
        location: clean(info.location),
        description: String(info.jobDescription || ''),
        type: /part/i.test(String(info.timeType || '')) ? 'Part-time' : 'Full-time',
      };
    }
  } catch { /* malformed payload — enrichment is best-effort */ }
  return null;
}

// ── Realistic browser profiles (anti-blocking hygiene, not evasion) ─────────────
// A single hardcoded User-Agent with no matching client-hint headers is itself a bot
// signal — real Chrome/Safari/Firefox always send a self-CONSISTENT header set. We
// send exactly what the named browser sends, and vary across a small pool per request
// so our legitimate per-user, low-volume fetches read as ordinary browser traffic
// rather than one identical fingerprint repeated. This is politeness + resilience, the
// same reason we also pace per host (api layer) — NOT an attempt to defeat auth/CAPTCHA.
// Each profile is internally consistent: the UA, Sec-CH-UA brand list, platform, and
// Sec-Fetch-* headers all agree, because a mismatch is what actually flags a scraper.
export const BROWSER_PROFILES = [
  {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'sec-ch-ua': '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
  },
  {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'sec-ch-ua': '"Google Chrome";v="125", "Chromium";v="125", "Not.A/Brand";v="24"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"macOS"',
  },
  {
    // Safari sends no Sec-CH-UA — omitting it here is CORRECT for this UA, not a mistake.
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15',
  },
  {
    // Firefox likewise sends no Sec-CH-UA.
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0',
  },
  {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  },
];

// Build a complete, consistent browser header set for a URL. `seed` (a request counter)
// picks the profile so successive attempts vary; `mobile` forces the iPhone profile
// (used for Indeed's m/ pages so the UA matches the surface we're hitting). A same-host
// Referer + realistic Accept/Sec-Fetch headers complete the picture a real navigation
// would present.
export function browserHeaders(urlStr, { seed = 0, mobile = false, accept } = {}) {
  const profile = mobile
    ? BROWSER_PROFILES[BROWSER_PROFILES.length - 1] // iPhone
    : BROWSER_PROFILES[((seed % (BROWSER_PROFILES.length - 1)) + (BROWSER_PROFILES.length - 1)) % (BROWSER_PROFILES.length - 1)];
  let origin = '';
  try { const u = new URL(urlStr); origin = `${u.protocol}//${u.host}/`; } catch { /* no referer */ }
  const h = {
    Accept: accept || 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': origin ? 'same-origin' : 'none',
    'Sec-Fetch-User': '?1',
    ...profile,
  };
  if (origin) h.Referer = origin;
  return h;
}

// ── Bot-walled hosts: recovery ladder ($0, keyless) ─────────────────────────────
// Indeed/LinkedIn/Glassdoor block datacenter fetches outright, so the primary page
// fetch yields nothing. Recovery rungs, all free:
//   1. Host alternates — Indeed's mobile page (lighter wall) and its rpc/jobdescs
//      JSON endpoint (description by job key, used by Indeed's own SERP).
//   2. The r.jina.ai reader — a free, keyless public fetcher that renders the page
//      with a real browser off datacenter ranges and returns the content. Works for
//      any walled host; only the (public) listing URL is sent to it.

export function indeedJobKey(urlStr) {
  let u;
  try { u = new URL(urlStr); } catch { return null; }
  if (!/(^|\.)indeed\.com$/.test(u.hostname.toLowerCase())) return null;
  const jk = u.searchParams.get('jk') || u.searchParams.get('vjk');
  if (jk && /^[0-9a-f]{8,20}$/i.test(jk)) return jk.toLowerCase();
  // Slugged forms: /job/<title-slug>-<jk> and /viewjob/<jk>
  const m = u.pathname.match(/(?:^|-)([0-9a-f]{16})(?:\/|$)/i);
  return m ? m[1].toLowerCase() : null;
}

// Ordered alternate fetch plans for a URL whose primary fetch was blocked or yielded
// nothing usable. kind 'html' = fetch + run the normal extraction ladder;
// 'jina' = fetch via the reader; 'indeed-rpc' = JSON of {jk: descriptionHtml}.
export function alternateFetchPlans(urlStr) {
  let u;
  try { u = new URL(urlStr); } catch { return []; }
  const host = u.hostname.toLowerCase();
  const plans = [];
  if (/(^|\.)indeed\.com$/.test(host)) {
    const jk = indeedJobKey(urlStr);
    if (jk) {
      plans.push({ kind: 'html', url: `https://www.indeed.com/m/viewjob?jk=${jk}`, label: 'indeed-mobile' });
      plans.push({ kind: 'jina', url: `https://r.jina.ai/${urlStr}`, label: 'jina' });
      plans.push({ kind: 'indeed-rpc', url: `https://www.indeed.com/rpc/jobdescs?jks=${jk}`, label: 'indeed-rpc', jk });
      return plans;
    }
  }
  // Everything else (LinkedIn, Glassdoor, ZipRecruiter, unknown walls): the reader.
  plans.push({ kind: 'jina', url: `https://r.jina.ai/${urlStr}`, label: 'jina' });
  return plans;
}

// Indeed embeds its listing data as JSON in the page (window._initialData / viewjob
// models) rather than JSON-LD. These keys appear across desktop, mobile, and partial
// wall variants — pull them straight out of the raw HTML/JS.
const _jsonStr = (html, key) => {
  const m = html.match(new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`));
  if (!m) return '';
  try { return JSON.parse(`"${m[1]}"`).replace(/\s+/g, ' ').trim(); } catch { return ''; }
};
export function indeedEmbeddedFields(html) {
  const page = String(html || '');
  const title = _jsonStr(page, 'jobTitle');
  const company = _jsonStr(page, 'companyName') || _jsonStr(page, 'sourceEmployerName');
  const location = _jsonStr(page, 'formattedLocation') || _jsonStr(page, 'jobLocation');
  // sanitizedJobDescription is HTML-escaped inside the JSON string; decode entities later.
  let description = '';
  const desc = page.match(/"sanitizedJobDescription"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (desc) { try { description = JSON.parse(`"${desc[1]}"`); } catch { /* skip */ } }
  if (!title && !company && !description) return null;
  return { title, company, location, description: decodeEntities(description) };
}

// r.jina.ai plain-text/markdown response → extraction fields. Format:
//   Title: <page title>\nURL Source: …\nMarkdown Content:\n<markdown body>
export function parseJinaReader(text, urlStr) {
  const s = String(text || '');
  if (!s.trim()) return null;
  const titleLine = s.match(/^Title:\s*(.+)$/m)?.[1]?.trim() || '';
  // The reader can get challenged too — a challenge page must yield NOTHING, or its
  // "checking your browser" boilerplate would become a listing description.
  if (CHALLENGE_TITLE.test(titleLine)) return null;
  const bodyIdx = s.indexOf('Markdown Content:');
  let body = bodyIdx >= 0 ? s.slice(bodyIdx + 'Markdown Content:'.length) : s;
  // Strip markdown furniture so the description reads as text: images, links → label,
  // emphasis/heading markers. Good enough for scoring + the optimizer.
  body = body
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/[*_`>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const parsed = parseListingTitle(titleLine);
  const fromUrlCo = companyFromUrl(urlStr);
  if (!parsed.title && !body) return null;
  return {
    title: parsed.title || '',
    company: parsed.company || fromUrlCo || '',
    location: parsed.location || '',
    description: body.slice(0, 12000),
    via: 'jina',
  };
}

// ── Source label ────────────────────────────────────────────────────────────────
// The listing scorer (jobScore.js) earns ATS-trust points from the `source` string, so
// an import keeps honest provenance: the recognizable platform it came from, marked as
// user-imported. Unknown hosts (company careers sites, small boards) are just 'Imported'.
const SOURCE_HOSTS = [
  [/greenhouse\.io$/, 'Greenhouse'],
  [/lever\.co$/, 'Lever'],
  [/myworkdayjobs\.com$/, 'Workday'],
  [/ashbyhq\.com$/, 'Ashby'],
  [/workable\.com$/, 'Workable'],
  [/smartrecruiters\.com$/, 'SmartRecruiters'],
  [/bamboohr\.com$/, 'BambooHR'],
  [/breezy\.hr$/, 'Breezy'],
  [/linkedin\.com$/, 'LinkedIn'],
  [/indeed\.com$/, 'Indeed'],
  [/glassdoor\.com$/, 'Glassdoor'],
  [/ziprecruiter\.com$/, 'ZipRecruiter'],
  [/monster\.com$/, 'Monster'],
  [/wellfound\.com$/, 'Wellfound'],
];
export function sourceFromHost(host) {
  const h = String(host || '').toLowerCase();
  for (const [re, name] of SOURCE_HOSTS) if (re.test(h)) return `${name} (imported)`;
  return 'Imported';
}

// ── Row builder ─────────────────────────────────────────────────────────────────
// Normalized jobs-table row for an imported listing (verified against prod schema
// 2026-07-10: all columns exist; title is the only NOT NULL). Imported listings live
// 60 days (vs 14 for aggregated) — the user deliberately saved this one, and their
// tracker/optimizer links back to it must not die in two weeks.
export function buildImportedJobRow({ title, company, location, salary, salaryMin, description, type }, url) {
  const t = String(title || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  const co = normalizeCompany(String(company || '').replace(/\s+/g, ' ').trim().slice(0, 120));
  if (!t || !co) return null;
  const desc = cleanDescription(description || '');
  const now = new Date().toISOString();
  let host = '';
  try { host = new URL(url).hostname; } catch { /* validated upstream */ }
  const row = {
    title: t,
    company: co,
    location: String(location || '').replace(/\s+/g, ' ').trim().slice(0, 120) || 'See listing',
    salary: salary || null,
    description: desc,
    apply_url: url,
    source: sourceFromHost(host),
    type: type === 'Part-time' ? 'Part-time' : 'Full-time',
    level: inferLevel(t),
    expires_at: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
    availability_status: 'active',
    last_seen_at: now,
    last_checked_at: now,
    search_query: t.toLowerCase(),
    lat: null,
    lng: null,
  };
  // Owner decision 2026-07-10: EVERY imported listing carries a score, at $0 — the
  // canonical scorer (jobScore.js) is deterministic, no external AI or paid API. This
  // stays consistent with "score for a reason or no score": scoreFactors() earns each
  // point from signals the listing actually carries (source platform, salary, title,
  // description quality), so a description-less import simply has fewer factors —
  // including the honest thin-description penalty — never a fabricated number, and the
  // factor breakdown remains the full legal explanation of the score.
  const signals = { ...row, salary_min: Number(salaryMin) || 0 };
  row.score = scoreJob(signals);
  row.waste_score = wasteScore(signals);
  return row;
}

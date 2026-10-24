// Read a company's own career site: robots.txt → sitemaps → job pages → schema.org JobPosting.
//
// Most large employers publish every opening as schema.org JobPosting data on the job page (that is
// what Google for Jobs reads) and list the pages in a job sitemap. Checked live 2026-10-20:
//   careers.homedepot.com  robots 200 → /jobsitemap (25,300 job URLs) → JobPosting on every page
//   jobs.target.com        robots 200 → corporate.target.com/sitemapjob.xml
//   careers.walmart.com    robots 200 → sitemap index (job pages one level down)
//   www.tesla.com          403 "Access Denied" (Akamai) on robots.txt itself → servers cannot read it
// So: honour robots.txt, prefer job sitemaps, read at most `limit` job pages, keep only postings whose
// hiringOrganization is the company asked for, and when the site refuses servers say "blocked" with
// the URL a browser could try (Seen Command's local Chrome collector).
//
// Every fetch is bounded (timeout, byte cap, page cap) and fail-soft. Tests: lib/jobs/careerSite.test.mjs.

import { gunzipSync } from 'node:zlib';
import { buildJob } from '../server/jobSources.js';
import { mapLimit } from '../server/jobSources.js';
import { nameKey, sameCompanyName } from './boardFinder.js';
import { inUsMarket } from './usLocation.js';
import { normalizePay } from './pay.js';

const UA = 'SeenJobs/1.0 (+https://seenjobs.io)';
const UA_TOKEN = 'seenjobs';
const MAX_BYTES = 20 * 1024 * 1024;
const BLOCK_STATUSES = new Set([401, 403, 406, 429, 503]);

// ---- fetching -----------------------------------------------------------------------------------
async function fetchText(url, { fetchImpl = fetch, timeoutMs = 10000 } = {}) {
  try {
    const r = await fetchImpl(url, { headers: { 'User-Agent': UA, Accept: 'text/html,application/xml,text/xml,*/*' }, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
    const finalUrl = r.url || url;
    let text;
    if (/\.gz(?:$|\?)/i.test(finalUrl) && typeof r.arrayBuffer === 'function') {
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > MAX_BYTES) return { status: r.status, url: finalUrl, text: '', tooBig: true };
      try { text = gunzipSync(buf).toString('utf8'); } catch { text = buf.toString('utf8'); }
    } else {
      text = await r.text();
      if (text.length > MAX_BYTES) text = text.slice(0, MAX_BYTES);
    }
    const blocked = BLOCK_STATUSES.has(r.status) || (r.status === 200 && /<title>\s*Access Denied\s*<\/title>/i.test(text.slice(0, 2000)));
    return { status: r.status, url: finalUrl, text, blocked };
  } catch (e) {
    return { status: 0, url, text: '', error: String(e?.cause?.code || e?.name || e?.message || e) };
  }
}

// ---- robots.txt ---------------------------------------------------------------------------------
/** Rules that apply to Seen's crawler: the group naming "seenjobs", else the "*" group. */
export function parseRobots(text) {
  const groups = []; let cur = null; const sitemaps = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim(); if (!line) continue;
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line); if (!m) continue;
    const key = m[1].toLowerCase(); const val = m[2].trim();
    if (key === 'sitemap') { if (val) sitemaps.push(val); continue; }
    if (key === 'user-agent') {
      if (!cur || cur.rules.length) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(val.toLowerCase());
    } else if ((key === 'allow' || key === 'disallow') && cur) cur.rules.push({ allow: key === 'allow', path: val });
  }
  const mine = groups.find((g) => g.agents.some((a) => a !== '*' && UA_TOKEN.includes(a)))
    || groups.find((g) => g.agents.includes('*'));
  return { rules: mine ? mine.rules.filter((r) => r.path !== '' || !r.allow) : [], sitemaps };
}

/** Longest-match robots rule check (RFC 9309), with * and $ support. Empty Disallow = allow all. */
export function robotsAllows(rules, path) {
  let best = null;
  for (const r of rules || []) {
    if (r.path === '') continue;
    const re = new RegExp('^' + r.path.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*').replace(/\\\$$/, '$'));
    if (re.test(path) && (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow))) best = r;
  }
  return !best || best.allow;
}

// ---- sitemaps -----------------------------------------------------------------------------------
const JOBISH = /job|career|position|posting|opening|vacanc|requisition/i;
const JOB_PATH = /\/(?:jobs?|job-details?|positions?|openings?|postings?|vacanc(?:y|ies)|requisitions?)\/[^/?#]+/i;

export function parseSitemap(xml) {
  const isIndex = /<sitemapindex[\s>]/i.test(xml);
  const entries = [];
  const block = isIndex ? /<sitemap>([\s\S]*?)<\/sitemap>/gi : /<url>([\s\S]*?)<\/url>/gi;
  for (const m of String(xml || '').matchAll(block)) {
    const loc = /<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]\s]+)\s*(?:\]\]>)?\s*<\/loc>/i.exec(m[1])?.[1];
    const lastmod = /<lastmod>\s*([^<\s]+)\s*<\/lastmod>/i.exec(m[1])?.[1] || null;
    if (loc) entries.push({ loc: decodeXmlOnce(loc), lastmod });
  }
  return { isIndex, entries };
}

/** Job page URLs from a site's sitemaps (job sitemaps first), newest first when dated. */
export async function jobUrlsFromSitemaps(sitemapUrls, { host, fetchImpl, timeoutMs, maxFetches = 8, maxUrls = 5000 } = {}) {
  const queue = [...sitemapUrls].sort((a, b) => Number(JOBISH.test(b)) - Number(JOBISH.test(a)));
  const seen = new Set(); const urls = []; let fetches = 0;
  while (queue.length && fetches < maxFetches && urls.length < maxUrls) {
    const sm = queue.shift(); if (seen.has(sm)) continue; seen.add(sm);
    let smHost; try { smHost = new URL(sm).hostname; } catch { continue; }
    if (host && !sameSite(smHost, host)) continue; // a sitemap only speaks for its own site
    fetches++;
    const r = await fetchText(sm, { fetchImpl, timeoutMs });
    if (!r.text) continue;
    const { isIndex, entries } = parseSitemap(r.text);
    if (isIndex) {
      const kids = entries.map((e) => e.loc).sort((a, b) => Number(JOBISH.test(b)) - Number(JOBISH.test(a)));
      queue.unshift(...kids.filter((k) => JOBISH.test(k)), ...kids.filter((k) => !JOBISH.test(k)).slice(0, 2));
    } else {
      for (const e of entries) {
        let u; try { u = new URL(e.loc); } catch { continue; }
        if (JOB_PATH.test(u.pathname)) urls.push(e);
      }
    }
  }
  urls.sort((a, b) => (b.lastmod || '').localeCompare(a.lastmod || ''));
  return { urls: urls.slice(0, maxUrls), sitemapsRead: fetches };
}

const sameSite = (a, b) => { const base = (h) => h.split('.').slice(-2).join('.'); return base(a) === base(b); };

// ---- JobPosting ---------------------------------------------------------------------------------
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", '#x27': "'", '#34': '"' };
/** One-pass entity decode (never a chain of replaces — that double-unescapes "&amp;lt;"). */
export function decodeXmlOnce(s) {
  return String(s || '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    const k = e.toLowerCase();
    if (ENTITIES[k] != null) return ENTITIES[k];
    if (k.startsWith('#x')) { const n = parseInt(k.slice(2), 16); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
    if (k.startsWith('#')) { const n = parseInt(k.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
    return m;
  });
}

function* walkLd(node) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const n of node) yield* walkLd(n); return; }
  yield node;
  if (node['@graph']) yield* walkLd(node['@graph']);
}
const isJobPosting = (n) => [].concat(n['@type'] || []).some((t) => /^(?:https?:\/\/schema\.org\/)?JobPosting$/i.test(String(t)));

/** Every schema.org JobPosting object in an HTML page. */
export function jobPostingsFromHtml(html) {
  const out = [];
  for (const m of String(html || '').matchAll(/<script[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data; try { data = JSON.parse(m[1].trim()); } catch { continue; }
    for (const n of walkLd(data)) if (isJobPosting(n)) out.push(n);
  }
  return out;
}

const US = /^(?:us|usa|u\.s\.a?\.?|united states(?: of america)?)$/i;
function placeOf(jp) {
  if (/telecommute/i.test(String(jp.jobLocationType || ''))) return { text: 'Remote', us: null };
  const locs = [].concat(jp.jobLocation || []);
  const a = (locs[0] && (locs[0].address || locs[0])) || {};
  const country = typeof a.addressCountry === 'object' ? (a.addressCountry.name || a.addressCountry.identifier) : a.addressCountry;
  const text = [a.addressLocality, a.addressRegion].filter(Boolean).join(', ') || (country ? String(country) : '');
  return { text: text || 'Unknown', us: country ? US.test(String(country).trim()) : null };
}
// schema.org baseSalary → lib/jobs/pay.js (unitText HOUR/WEEK/MONTH/YEAR is the declared period; a
// figure that does not fit it, or DAY, is shown raw). `yearly` feeds the scorer.
const UNIT_PERIOD = { HOUR: 'hour', WEEK: 'week', MONTH: 'month', YEAR: 'year', DAY: 'day' };
function salaryOf(jp) {
  const v = jp.baseSalary?.value || jp.baseSalary;
  const lo = Number(v?.minValue ?? v?.value); const hi = Number(v?.maxValue);
  if (!Number.isFinite(lo) || lo <= 0) return { text: null, yearly: 0 };
  const unit = String(v?.unitText || jp.baseSalary?.unitText || '').toUpperCase();
  const n = normalizePay({ min: lo, max: Number.isFinite(hi) ? hi : 0, period: UNIT_PERIOD[unit] || null, text: `${jp.title || ''}\n${jp.description || ''}` });
  return n ? { text: n.text, yearly: n.yearlyMin } : { text: null, yearly: 0 };
}

/**
 * A JobPosting → a Seen job row, or { skip: reason }. `company` is the name the operator asked for;
 * the posting's hiringOrganization must be that company when it names one.
 */
export function rowFromPosting(jp, { company, pageUrl, host }) {
  const org = typeof jp.hiringOrganization === 'string' ? jp.hiringOrganization : jp.hiringOrganization?.name;
  if (org && !sameCompanyName(org, company)) return { skip: 'other_employer' };
  if (jp.validThrough && Date.parse(jp.validThrough) < Date.now()) return { skip: 'expired' };
  const place = placeOf(jp);
  if (place.us === false || (place.us === null && !inUsMarket(place.text))) return { skip: 'outside_market' };
  const { text: salary, yearly } = salaryOf(jp);
  const id = typeof jp.identifier === 'object' ? (jp.identifier?.value || jp.identifier?.name) : jp.identifier;
  let path = ''; try { path = new URL(pageUrl).pathname; } catch { /* ignore */ }
  const row = buildJob({
    title: decodeXmlOnce(jp.title || jp.name || ''),
    company: org || company,
    location: place.text,
    salary,
    description: decodeXmlOnce(String(jp.description || '')),
    apply_url: jp.url && /^https:\/\//i.test(jp.url) ? jp.url : pageUrl,
    source: 'Company site',
    type: /part/i.test([].concat(jp.employmentType || []).join(' ')) ? 'Part-time' : 'Full-time',
    searchQuery: jp.title || '',
    externalId: `site:${host}:${String(id || path).slice(0, 120)}`,
    salaryMin: yearly,
  });
  if (!row) return { skip: 'quality' };
  return { row: { ...row, source_type: 'EMPLOYER_SITE', canonical_url: pageUrl } };
}

// ---- the whole site -----------------------------------------------------------------------------
/** Host names a company's career site is likely on, most likely first. */
export function careerHostCandidates(company, website) {
  const hosts = [];
  if (website) { try { const h = new URL(/^https?:/i.test(website) ? website : `https://${website}`).hostname.replace(/^www\./, ''); hosts.push(`careers.${h}`, `jobs.${h}`, `www.${h}`); } catch { /* ignore */ } }
  const d = nameKey(company).replace(/\s+/g, '');
  if (d) hosts.push(`careers.${d}.com`, `jobs.${d}.com`, `www.${d}.com`);
  if (/^\s*the\s/i.test(company) && d) hosts.push(`careers.the${d}.com`);
  return [...new Set(hosts)];
}

/**
 * Read a company's career site. Returns
 *   { status: 'ok'|'blocked'|'needs_browser'|'none', host, careersUrl, sitemapJobs, pagesRead, rows, skipped, note }
 * 'blocked' / 'needs_browser' carry the URL a browser could open instead.
 */
export async function readCareerSite(company, { website = null, limit = 40, fetchImpl = fetch, timeoutMs = 10000, concurrency = 4 } = {}) {
  const max = Math.min(150, Math.max(1, limit));
  let blocked = null;
  for (const host of careerHostCandidates(company, website)) {
    const robots = await fetchText(`https://${host}/robots.txt`, { fetchImpl, timeoutMs });
    // A blocked www.* host is the company's main site: the browser should start at its careers page.
    if (robots.blocked) { blocked = blocked || { host, careersUrl: /^www\./.test(host) ? `https://${host}/careers` : `https://${host}/` }; continue; }
    if (!robots.status) continue; // no such host
    const parsed = robots.status === 200 ? parseRobots(robots.text) : { rules: [], sitemaps: [] };
    const sitemaps = parsed.sitemaps.length ? parsed.sitemaps : [`https://${host}/sitemap.xml`];
    const { urls, sitemapsRead } = await jobUrlsFromSitemaps(sitemaps, { host, fetchImpl, timeoutMs });
    const allowed = urls.filter((u) => { try { return robotsAllows(parsed.rules, new URL(u.loc).pathname); } catch { return false; } });
    if (!allowed.length) continue;
    const pick = allowed.slice(0, max);
    const skipped = {}; let pagesRead = 0; let pageBlocks = 0;
    const rows = (await mapLimit(pick, concurrency, async (u) => {
      const page = await fetchText(u.loc, { fetchImpl, timeoutMs });
      if (page.blocked) { pageBlocks++; return null; }
      if (!page.text) return null;
      pagesRead++;
      const postings = jobPostingsFromHtml(page.text);
      if (!postings.length) { skipped.no_job_data = (skipped.no_job_data || 0) + 1; return null; }
      const r = rowFromPosting(postings[0], { company, pageUrl: u.loc, host });
      if (r.skip) { skipped[r.skip] = (skipped[r.skip] || 0) + 1; return null; }
      return r.row;
    })).filter(Boolean);
    const listed = urls.length >= 5000 ? '5,000+' : urls.length.toLocaleString('en-US');
    if (!rows.length && pageBlocks && !pagesRead) return { status: 'blocked', host, careersUrl: pick[0].loc, sitemapJobs: urls.length, pagesRead, rows: [], skipped, note: 'job pages refuse servers — try them in your browser' };
    // Pages that load but carry no JobPosting data build their content with JavaScript (Walmart):
    // a real browser can still read them.
    if (!rows.length && pagesRead && skipped.no_job_data === pagesRead) return { status: 'needs_browser', host, careersUrl: pick[0].loc, sitemapJobs: urls.length, pagesRead, rows: [], skipped, note: `${listed} job pages listed, but they build their content in the browser — try them in your browser` };
    return { status: 'ok', host, careersUrl: `https://${host}/`, sitemapJobs: urls.length, sitemapsRead, pagesRead, rows, skipped,
      note: `${listed} job pages listed; read ${pagesRead}` };
  }
  if (blocked) return { status: 'blocked', ...blocked, sitemapJobs: 0, pagesRead: 0, rows: [], skipped: {}, note: 'the site refuses servers — try it in your browser' };
  return { status: 'none', host: null, careersUrl: null, sitemapJobs: 0, pagesRead: 0, rows: [], skipped: {}, note: 'no readable career site found under the usual addresses' };
}

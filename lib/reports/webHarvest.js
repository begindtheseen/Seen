// Applicant reports from ANY open web page Google finds — searched and read in the owner's own Chrome
// (OpenCLI Browser Bridge), because Google answers a server with a JavaScript wall and a datacenter
// browser with its "unusual traffic" CAPTCHA (both seen 2026-10-20). Free: no model, no API key.
//
// Per company: a handful of applicant-story searches ("Chipotle" interview "ghosted", "never heard back",
// "got the job", "rejection email"…), at a human pace (WEB_REPORTS_SEARCH_GAP_SECONDS, default 25 s
// between searches). Every result page that is not skipped is opened and read: its title plus its text
// blocks (posts, comments, answers, paragraphs), each through the strict first-hand rules
// (lib/reports/applicantRules.js) with the page title as context. Nothing is inferred from Google's snippet.
//
// Skipped hosts (SKIP_HOSTS): every owner-excluded source (lib/reports/excludedSources.js — Hacker News,
// Glassdoor, Indeed, LinkedIn, Facebook, Instagram, X/Twitter, TikTok), Reddit (the archive collector already
// reads it), video sites with no text, job boards (listings, not accounts), and Google itself. A CAPTCHA or "unusual traffic" page STOPS Google for the rest of the run: it is never
// solved or worked around.
// Tests: lib/reports/webHarvest.test.mjs (fake browser); the in-page scripts run in real Chrome in the e2e.

import { storableAccount, namePattern } from './applicantRules.js';
import { EXCLUDED_SOURCES, hostMatches } from './excludedSources.js';

export const SKIP_HOSTS = [
  ...EXCLUDED_SOURCES,
  'reddit.com', 'redd.it',
  'youtube.com', 'youtu.be', 'vimeo.com',
  'ziprecruiter.com', 'simplyhired.com', 'monster.com', 'careerbuilder.com', 'snagajob.com', 'jobs.lever.co', 'boards.greenhouse.io', 'myworkdayjobs.com', 'icims.com', 'talent.com', 'jooble.org', 'adzuna.com',
  'google.com', 'google.', 'googleusercontent.com', 'gstatic.com', 'bing.com', 'duckduckgo.com',
];
// The exclusions ride in the query too, so Google spends its ten results on pages we will read.
const QUERY_EXCLUDES = '-site:reddit.com -site:glassdoor.com -site:indeed.com -site:linkedin.com -site:facebook.com -site:youtube.com -site:news.ycombinator.com';
const PHRASES = ['interview "ghosted"', '"never heard back" interview', '"got the job" interview', '"rejection email"', '"hiring process" applied', 'interview experience', '"job offer" interview', '"never called back"'];

export function googleQueries(company) {
  const c = String(company || '').replace(/"/g, '').trim();
  return PHRASES.map((p) => `"${c}" ${p} ${QUERY_EXCLUDES}`);
}
export const googleSearchUrl = (q, start = 0) => `https://www.google.com/search?${new URLSearchParams({ q, hl: 'en', num: '10', ...(start ? { start: String(start) } : {}) })}`;

export function skipUrl(raw) {
  let u; try { u = new URL(raw); } catch { return 'bad_url'; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return 'bad_url';
  if (/\.(?:pdf|docx?|pptx?|xlsx?|zip|jpg|jpeg|png|gif|mp4)$/i.test(u.pathname)) return 'file';
  return SKIP_HOSTS.some((s) => hostMatches(u.hostname, s)) ? 'skipped_host' : null;
}

// ---- in-page scripts (serialized into the owner's Chrome by OpenCLI eval; return JSON strings) ----------
export function googleResultsInPage() {
  const text = (document.body && document.body.innerText) || '';
  if (/\/sorry\//.test(location.pathname) || /unusual traffic|not a robot|recaptcha/i.test(text.slice(0, 4000))
    || document.querySelector('form#captcha-form, #recaptcha, iframe[src*="recaptcha"]')) return JSON.stringify({ blocked: true, url: location.href });
  const root = document.querySelector('#search') || document.querySelector('#rso') || document.body;
  const out = []; const seen = new Set();
  for (const h3 of root.querySelectorAll('a h3')) {
    const a = h3.closest('a'); if (!a) continue;
    let url = a.href;
    try { const u = new URL(url); if (/^(?:www\.)?google\.[a-z]{2,3}(?:\.[a-z]{2})?$/.test(u.hostname) && u.pathname === '/url') url = u.searchParams.get('q') || u.searchParams.get('url') || url; } catch (e) { continue; }
    if (!/^https?:/.test(url) || seen.has(url)) continue;
    seen.add(url);
    out.push({ url, title: String(h3.innerText || '').trim().slice(0, 200) });
  }
  return JSON.stringify({ blocked: false, results: out.slice(0, 20), next: !!document.querySelector('#pnnext, a[aria-label="Next page"]') });
}

export function pageBlocksInPage(max) {
  const SEL = 'article, [itemprop="reviewBody"], [itemprop="text"], [class*="comment" i], [class*="post-body" i], [class*="message" i], [class*="answer" i], [class*="review" i], blockquote, p, li, dd';
  const NOISE = 'nav, header, footer, aside, form, [role="navigation"], [role="banner"], [role="contentinfo"], [class*="sidebar" i], [class*="related" i], [class*="footer" i], [class*="menu" i], [class*="cookie" i], [class*="newsletter" i]';
  const nodes = [...document.querySelectorAll(SEL)].slice(0, 4000).filter((el) => !el.closest(NOISE));
  const cand = new Set(nodes); const blocks = []; const seen = new Set();
  for (const el of nodes) {
    const t = String(el.innerText || '').replace(/\s+/g, ' ').trim();
    if (t.length < 40 || t.length > 4000 || seen.has(t)) continue;
    // A container whose own candidate child carries most of its text is read through that child instead.
    let covered = false;
    for (const c of el.querySelectorAll(SEL)) { if (cand.has(c) && String(c.innerText || '').length > t.length * 0.6) { covered = true; break; } }
    if (covered) continue;
    seen.add(t); blocks.push(t);
    if (blocks.length >= max) break;
  }
  const h1 = String((document.querySelector('h1') || {}).innerText || '').trim();
  const title = String(document.title || '').trim();
  return JSON.stringify({ url: location.href, title: (h1 && !title.toLowerCase().includes(h1.toLowerCase()) ? `${title} — ${h1}` : title).slice(0, 300), blocks });
}

export const GOOGLE_RESULTS_JS = `(${googleResultsInPage.toString()})()`;
export const pageBlocksJs = (max = 200) => `(${pageBlocksInPage.toString()})(${Math.max(1, Math.min(400, Number(max) || 200))})`;
const parse = (v) => { if (v && typeof v === 'object' && !Array.isArray(v)) { if (typeof v.result === 'string') v = v.result; else return v; } try { return JSON.parse(String(v)); } catch { return null; } };

/**
 * Harvest one company from Google. `browser` = { open(url), eval(js) } (lib/server/opencliBrowser.js).
 * `state` is shared across companies in a run: { blocked, lastSearchAt }. Returns { found, newReports,
 * searches, failedSearches, searchErrors, pagesRead, skipped, stoppedBy: goal|time|exhausted|google_blocked }.
 */
export async function harvestGoogle(company, {
  browser, goal = 10, deadlineAt = Infinity, onAccounts = async () => {}, log = () => {}, now = () => Date.now(),
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)), searchGapMs = 25_000, pageGapMs = 2_500, settleMs = 2_000,
  pagesPerQuery = 1, maxPagesRead = 30, maxBlocks = 200, state = { blocked: false, lastSearchAt: 0 }, seenUrls = new Set(),
  queries = googleQueries(company), jitter = () => Math.floor(Math.random() * 5000),
} = {}) {
  const out = { company, source: 'google', found: 0, newReports: null, searches: 0, failedSearches: 0, searchErrors: [], pagesRead: 0, skipped: 0, stoppedBy: null };
  if (!namePattern([company])) { out.stoppedBy = 'unsearchable_name'; return out; }
  if (state.blocked) { out.stoppedBy = 'google_blocked'; return out; }
  const done = () => goal > 0 && (out.newReports ?? out.found) >= goal;
  const err = (why) => { const w = String(why).slice(0, 200); if (out.searchErrors.length < 3 && !out.searchErrors.includes(w)) out.searchErrors.push(w); };
  const seenText = new Set();
  for (const q of queries) {
    for (let p = 0; p < pagesPerQuery; p++) {
      if (done()) { out.stoppedBy = 'goal'; return out; }
      if (now() >= deadlineAt) { out.stoppedBy = 'time'; return out; }
      // A human pace between Google searches, held across companies.
      const wait = (state.lastSearchAt || 0) + searchGapMs + jitter() - now();
      if (wait > 0) { if (now() + wait >= deadlineAt) { out.stoppedBy = 'time'; return out; } await sleep(wait); }
      state.lastSearchAt = now();
      out.searches++;
      let res;
      try { await browser.open(googleSearchUrl(q, p * 10)); await sleep(settleMs); res = parse(await browser.eval(GOOGLE_RESULTS_JS)); }
      catch (e) { out.failedSearches++; err(e?.message || e); continue; }
      if (!res) { out.failedSearches++; err('Google page could not be read'); continue; }
      if (res.blocked) { state.blocked = true; out.stoppedBy = 'google_blocked'; err('Google showed its “unusual traffic” check — Google stopped for this run (never solved)'); log(`  ${company}: Google asked for a CAPTCHA — stopping Google for this run`); return out; }
      const results = (res.results || []).filter((r) => { const why = skipUrl(r.url); if (why || seenUrls.has(r.url)) { out.skipped++; return false; } return true; });
      for (const r of results) {
        if (done()) { out.stoppedBy = 'goal'; return out; }
        if (now() >= deadlineAt) { out.stoppedBy = 'time'; return out; }
        if (out.pagesRead >= maxPagesRead) break;
        seenUrls.add(r.url);
        let page;
        try { await browser.open(r.url); await sleep(pageGapMs); page = parse(await browser.eval(pageBlocksJs(maxBlocks))); }
        catch (e) { err(`${new URL(r.url).hostname}: ${e?.message || e}`); continue; }
        out.pagesRead++;
        if (!page || !Array.isArray(page.blocks)) continue;
        const title = String(page.title || r.title || '');
        const url = skipUrl(page.url) ? r.url : String(page.url || r.url); // a redirect onto a skipped host keeps the result link
        const accounts = [];
        page.blocks.forEach((text, i) => {
          const a = storableAccount(text, { names: [company], title });
          if (!a) return;
          const key = a.excerpt.toLowerCase().replace(/\W+/g, ' ').trim();
          if (seenText.has(key)) return;
          seenText.add(key);
          accounts.push({ ...a, url, voice: `${url}#${i}`, isOp: false, title, created: null, host: new URL(url).hostname.replace(/^www\./, '') });
        });
        if (accounts.length) {
          out.found += accounts.length;
          const accepted = await onAccounts(accounts);
          if (typeof accepted === 'number') out.newReports = (out.newReports || 0) + accepted;
          log(`  ${company}: +${accounts.length} from ${accounts[0].host}`);
        }
      }
      if (!res.next) break;
    }
  }
  out.stoppedBy = done() ? 'goal' : 'exhausted';
  return out;
}

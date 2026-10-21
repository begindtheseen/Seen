#!/usr/bin/env node
// Mac-local career-site collector: finds and reads EVERY job on a company's career site through the
// owner's real Chrome (OpenCLI Browser Bridge) — the sites that refuse servers (Tesla) or build their
// lists in JavaScript (Workday, Walmart). For each company:
//   1. FIND the job list. Start at the page given, else at the company's usual career addresses; on each
//      page the agent (lib/server/careerAgent.js) says what it is. A landing page is followed deeper
//      ("Search jobs", "View all openings", the company's Workday/iCIMS/… site) up to 4 links deep.
//   2. LIST every job: the site's own feed (Tesla, Workday's jobs API, the JSON request the page made,
//      replayed page by page), else the page itself — Next buttons, numbered pages, "Load more",
//      infinite scroll. A Next link to another page is opened here and the list continues there.
//      Before listing, the agent uses the site's OWN search and filters like a person would: keywords go
//      into its search box (Enter / its search button / its form), and the location is set to the United
//      States through whatever control it has (dropdown, type-ahead, filter checkbox). A site with no
//      search box is listed in full and the titles are matched; a US filter that empties the list is undone.
//   3. Skip jobs the list already shows are outside the US, and any job already sent (one job = one link
//      or id, across pages, keywords and passes — no duplicates), then read each job's data.
//   4. Compare with the total the site states. A site that ends PARTIAL (fewer jobs than it says it has,
//      failed job reads, a time limit) is run again once, reading only what is missing; after 2 passes it
//      stops and says what is still missing.
// Seen applies every check itself (api/ingest-local-career-jobs.js → rowFromPosting).
//
// env: SEEN_LOCAL_INGEST_TOKEN (required), SEEN_LOCAL_INGEST_URL (optional, …/api/ingest-local-indeed),
//      CAREER_SITE_TARGETS_JSON ([{ company, url?, website?, keywords? }], 1–10) or CAREER_SITE_COMPANY (+ CAREER_SITE_URL,
//      CAREER_SITE_KEYWORDS); CAREER_SITE_MAX_JOBS (jobs read per site, 1–20000, default 5000);
//      CAREER_SITE_PASSES (1–2, default 2); CAREER_SITE_MAX_PAGES (list pages followed, 1–5000, default 1000);
//      CAREER_SITE_US_FILTER (default on; 0 = never touch the site's location filter).
// flags: --dry-run (read, send nothing). Prints one JSON summary on stdout.
import { createOpenCliBrowser } from '../lib/server/opencliBrowser.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { safeStartUrl, parseEvalJson } from '../lib/server/careerBrowser.js';
import { agentJs } from '../lib/server/careerAgent.js';
import { careerStartCandidates, keywordTerms, titleMatches, jobIdentity, outsideUs } from '../lib/server/careerNavigate.js';
import { unwrapOpenCli, opencliFailure } from '../lib/server/redditIntelCollector.js';

const exec = promisify(execFile);
const int = (v, lo, hi, d) => { const n = Number(v); return Number.isInteger(n) && n >= lo && n <= hi ? n : d; };
const token = process.env.SEEN_LOCAL_INGEST_TOKEN;
const base = (process.env.SEEN_LOCAL_INGEST_URL || 'https://seenjobs.io/api/ingest-local-indeed').replace(/\/api\/ingest-local-indeed\/?$/, '');
const maxJobs = int(process.env.CAREER_SITE_MAX_JOBS, 1, 20000, 5000);
const passes = int(process.env.CAREER_SITE_PASSES, 1, 2, 2);
const maxPages = int(process.env.CAREER_SITE_MAX_PAGES, 1, 5000, 1000);
const usFilter = process.env.CAREER_SITE_US_FILTER !== '0';
const pollMs = Math.max(200, Number(process.env.CAREER_SITE_POLL_MS) || 2500);
const renderMs = Math.max(0, Number(process.env.CAREER_SITE_RENDER_MS ?? 3500));
const siteMinutes = int(process.env.CAREER_SITE_MINUTES, 1, 240, 90);
const dryRun = process.argv.includes('--dry-run');
const SESSION = 'seen-careers';
if (!token) throw new Error('Set SEEN_LOCAL_INGEST_TOKEN first.');
const startUrl = (raw) => safeStartUrl(raw);

// Targets: [{ company, url?, website?, keywords? }] — the start page is optional (step 1 finds it).
const targets = (() => {
  const clean = (c, n = 120) => String(c || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, n);
  let list;
  if (process.env.CAREER_SITE_TARGETS_JSON) {
    try { list = JSON.parse(process.env.CAREER_SITE_TARGETS_JSON); } catch { throw new Error('CAREER_SITE_TARGETS_JSON must be a JSON array of { company, url?, website?, keywords? }.'); }
    if (!Array.isArray(list)) throw new Error('CAREER_SITE_TARGETS_JSON must be a JSON array of { company, url?, website?, keywords? }.');
  } else list = [{ company: process.env.CAREER_SITE_COMPANY, url: process.env.CAREER_SITE_URL, keywords: process.env.CAREER_SITE_KEYWORDS }];
  const out = list.map((t) => ({ company: clean(t?.company), url: t?.url ? startUrl(t.url) : null, website: clean(t?.website, 200) || null, keywords: clean(t?.keywords, 300) }))
    .filter((t) => t.company).slice(0, 10);
  if (!out.length) throw new Error('Give 1–10 targets, each with a company (a start page, website and keywords are optional).');
  return out;
})();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function opencli(args) {
  let stdout;
  try { ({ stdout } = await exec('opencli', args, { maxBuffer: 50 * 1024 * 1024, timeout: 120000 })); }
  catch (error) { throw new Error(opencliFailure(error)); }
  let parsed; try { parsed = JSON.parse(stdout); } catch { return stdout; }
  if (parsed?.ok === false) throw new Error(parsed?.error?.message || 'OpenCLI command failed');
  return unwrapOpenCli(parsed);
}
const browser = createOpenCliBrowser({ run: opencli, session: SESSION });
const agent = async (cmd) => parseEvalJson(await browser.eval(agentJs({ company: currentCompany, ...cmd })));
let currentCompany = '';
async function openPage(url) { await browser.open(url); await sleep(renderMs + Math.floor(Math.random() * 1000)); return agent({ op: 'scout' }); }
// Run a background op to the end, taking its results as they are ready.
async function runOp(cmd, onBatch, deadline) {
  const s = await agent(cmd);
  if (!s || (!s.started && !s.already)) throw new Error(s?.error || 'the page did not start the agent');
  let status;
  for (;;) {
    await sleep(pollMs);
    status = await agent({ op: 'poll' });
    if (!status) throw new Error('the page stopped answering (it navigated away?)');
    if (cmd.op === 'detail') while (status.ready > 0) { const b = await agent({ op: 'take', n: 50 }); if (!Array.isArray(b) || !b.length) break; await onBatch(b); status.ready -= b.length; }
    if (!status.running) break;
    if (Date.now() > deadline) { status.timedOut = true; break; }
  }
  if (cmd.op === 'list') for (;;) { const b = await agent({ op: 'take', n: 200 }); if (!Array.isArray(b) || !b.length) break; await onBatch(b); }
  return status;
}

// The site's own search box and location filter (the agent's `filter` op). A form submit navigates to a
// new page, which ends the agent there — that is noticed, and the new page is scouted.
async function filterPage(term, wantUs) {
  const s = await agent({ op: 'filter', keywords: term || undefined, us: wantUs });
  if (!s || !s.started) return { applied: [], missed: [s?.error || 'the filter step did not start'], scout: null };
  let status = null;
  for (let i = 0; i < 160; i++) {
    await sleep(Math.min(pollMs, 1500));
    try { status = await agent({ op: 'poll' }); } catch { status = null; }
    if (!status || status.op !== 'filter') {
      await sleep(renderMs);
      const sc = await agent({ op: 'scout' }).catch(() => null);
      const kw = term && sc && decodeURIComponent(String(sc.url || '')).toLowerCase().replace(/\+/g, ' ').includes(term.toLowerCase());
      return { applied: kw ? [{ what: 'keywords', how: 'the site\'s search form (new page)' }] : [], missed: term && !kw ? ['keywords: the search form opened a page that does not show the search'] : [], navigated: true, scout: sc };
    }
    if (!status.running) break;
  }
  return { applied: status?.applied || [], missed: status?.missed || [], before: status?.before, after: status?.after, scout: await agent({ op: 'scout' }).catch(() => null) };
}

// Step 1: the page that lists the jobs.
async function findListing(t, summary) {
  const queue = careerStartCandidates(t).map((url) => ({ url, depth: 0 }));
  const visited = new Set(); let fallback = null;
  while (queue.length && summary.pages_opened < 14) {
    const { url, depth } = queue.shift();
    if (visited.has(url)) continue; visited.add(url);
    let s; try { s = await openPage(url); summary.pages_opened++; } catch (e) { summary.tried.push({ url, error: String(e.message).slice(0, 120) }); continue; }
    if (!s) { summary.tried.push({ url, error: 'no answer from the page' }); continue; }
    summary.tried.push({ url: s.url || url, job_links: s.jobLinks, site_total: s.siteTotal, recipe: s.recipe });
    if (s.notFound || (!s.careerish && !s.jobLinks && depth === 0 && !t.url)) continue;
    const strong = (s.deeper || []).filter((d) => d.score >= 8 && !visited.has(d.url));
    if (s.recipe || s.jobLinks >= 10 || (s.jobLinks >= 1 && !strong.length)) return s;
    if (s.jobLinks >= 1 && !fallback) fallback = s;
    if (depth < 4) for (const d of strong.concat((s.deeper || []).filter((d) => d.score < 8)).slice(0, 4)) queue.push({ url: d.url, depth: depth + 1 });
  }
  if (fallback) { await openPage(fallback.url); return fallback; }
  return null;
}

async function collect(t) {
  currentCompany = t.company;
  const terms = keywordTerms(t.keywords);
  const summary = { company: t.company, start_url: t.url || null, keywords: terms, listing_url: null, method: null, detail: null, pages_opened: 0, list_pages: 0,
    site_total: null, listed: 0, matched: 0, outside_market: 0, duplicates: 0, postings_found: 0, no_data: 0, failed: 0, saved: 0, skipped: {},
    passes: 0, complete: null, missing: [], filters: [], tried: [], errors: [], notes: [] };
  const deadline = Date.now() + siteMinutes * 60_000;
  const sent = new Set();        // every job already read (link / id) — never twice
  let sendFailed = false;
  const send = async (items) => {
    const fresh = [];
    for (const it of items) { const k = jobIdentity(it.posting, it.page_url); if (sent.has(k)) { summary.duplicates++; continue; } sent.add(k); fresh.push({ page_url: it.page_url, posting: it.posting }); }
    summary.postings_found += fresh.length;
    if (dryRun || sendFailed || !fresh.length) return;
    for (let i = 0; i < fresh.length; i += 50) {
      const r = await fetch(`${base}/api/ingest-local-career-jobs`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ company: t.company, items: fresh.slice(i, i + 50) }) });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) { sendFailed = true; summary.errors.push(`ingest failed (${r.status}): ${b.error || 'unknown error'}`); return; }
      summary.saved += Number(b.saved) || 0;
      for (const [k, n] of Object.entries(b.skipped || {})) summary.skipped[k] = (summary.skipped[k] || 0) + Number(n || 0);
    }
  };

  try {
    const listing = await findListing(t, summary);
    if (!listing) { summary.errors.push('no job list found on the career site (pages tried are listed)'); summary.complete = false; summary.missing.push('the job list'); return summary; }
    summary.listing_url = listing.url;

    for (let pass = 1; pass <= passes; pass++) {
      summary.passes = pass;
      // Step 2: every job, page after page; once per keyword when the site can search for it.
      const jobs = new Map(); let siteTotal = 0; let capped = false; let recipe = listing.recipe;
      const feedRecipe = listing.recipe === 'workday' || listing.recipe === 'tesla';
      let listedAll = false;                       // the whole list (no keyword) was read once this pass
      for (const term of terms.length ? terms : ['']) {
        if (Date.now() > deadline) { capped = true; break; }
        // Workday searches through its API (the agent passes the keywords); Tesla's feed lists everything.
        let kwSite = !!term && listing.recipe === 'workday';
        let page = listing.url;
        const getForm = term && !feedRecipe && listing.searchForm && listing.searchForm.inForm && listing.searchForm.method === 'get' && listing.searchForm.name;
        if (getForm) { const u = new URL(listing.searchForm.action || listing.url); u.searchParams.set(listing.searchForm.name, term); page = u.toString(); kwSite = true; }
        if (pass > 1 || term || page !== listing.url || summary.list_pages > 0) { const s = await openPage(page); summary.pages_opened++; recipe = s?.recipe || recipe; }
        if (!feedRecipe && (usFilter || (term && !kwSite))) {
          const f = await filterPage(kwSite ? '' : term, usFilter);
          summary.filters.push({ term: term || null, applied: f.applied, missed: f.missed });
          if (f.applied.some((a) => a.what === 'keywords')) kwSite = true;
          const us = f.applied.some((a) => a.what === 'location');
          // A United States filter that emptied a list that had jobs is undone (the site's filter misfired).
          if (us && !term && f.before && f.before.links > 0 && f.after && f.after.links === 0 && !f.after.total) {
            await openPage(page); summary.pages_opened++;
            summary.notes.push('the site\'s United States filter emptied the list — listed without it');
          }
          if (f.scout?.recipe) recipe = f.scout.recipe;
        }
        // No way to search on this site: list everything ONCE and match the titles.
        if (term && !kwSite) {
          if (listedAll) continue;
          listedAll = true;
        }
        const seenPages = new Set([page]);
        for (let p = 0; p < maxPages; p++) {
          const status = await runOp({ op: 'list', maxJobs, keywords: term && listing.recipe === 'workday' ? term : undefined }, async (b) => { for (const j of b) { const k = jobIdentity(null, j.url, j.id); if (!jobs.has(k)) jobs.set(k, { ...j, term, kwSite }); else if (kwSite) jobs.get(k).kwSite = true; } }, deadline);
          summary.list_pages++;
          summary.method = summary.method || status.method;
          siteTotal = Math.max(siteTotal, Number(status.siteTotal) || 0);
          for (const e of status.errors || []) if (summary.errors.length < 8) summary.errors.push(`list: ${e}`);
          for (const n of status.notes || []) if (summary.notes.length < 8) summary.notes.push(n);
          if (status.timedOut) { capped = true; break; }
          if (!status.next || seenPages.has(status.next)) break;
          seenPages.add(status.next);
          await openPage(status.next); summary.pages_opened++;
          if (p === maxPages - 1) capped = true;
        }
      }
      summary.site_total = siteTotal || summary.site_total;
      summary.listed = Math.max(summary.listed, jobs.size);

      // Step 3: only jobs that match, are not known to be abroad, and were not read already.
      let todo = [...jobs.values()];
      if (terms.length) todo = todo.filter((j) => j.kwSite || titleMatches(j.title, terms));
      summary.matched = Math.max(summary.matched, todo.length);
      const before = todo.length; todo = todo.filter((j) => !outsideUs(j.location)); summary.outside_market = Math.max(summary.outside_market, before - todo.length);
      todo = todo.filter((j) => !sent.has(jobIdentity(null, j.url, j.id)));
      const failedBefore = summary.failed; const noDataBefore = summary.no_data;
      for (let i = 0; i < todo.length && Date.now() < deadline; i += 100) {
        const chunk = todo.slice(i, i + 100).map((j) => ({ url: j.url, id: j.id, title: j.title, location: j.location, description: j.description || '', wdPath: j.wdPath }));
        const st = await runOp({ op: 'detail', items: chunk, recipe }, send, deadline);
        summary.detail = summary.detail || st.detail; summary.no_data += st.noData || 0; summary.failed += st.failed || 0;
        for (const e of st.errors || []) if (summary.errors.length < 8) summary.errors.push(`job: ${e}`);
        if (st.timedOut) { capped = true; break; }
      }
      const unread = todo.filter((j) => !sent.has(jobIdentity(null, j.url, j.id))).length;

      // Step 4: complete, or run again for what is missing.
      summary.missing = [];
      if (siteTotal && !terms.length && jobs.size < siteTotal) summary.missing.push(`${siteTotal - jobs.size} of the ${siteTotal} jobs the site says it has were not listed`);
      if (capped) summary.missing.push('stopped at the time or page limit');
      if (summary.failed > failedBefore) summary.missing.push(`${summary.failed - failedBefore} job pages could not be read`);
      const notRead = unread - (summary.no_data - noDataBefore) - (summary.failed - failedBefore);
      if (notRead > 0) summary.missing.push(`${notRead} listed jobs were not read`);
      summary.complete = summary.missing.length === 0;
      console.log(`[pass ${pass}] ${t.company}: ${jobs.size} listed${siteTotal ? ` of ${siteTotal}` : ''} (${summary.method}), ${summary.postings_found} read, ${summary.complete ? 'complete' : `partial — ${summary.missing.join('; ')}`}`);
      if (summary.complete || Date.now() > deadline) break;
    }
  } catch (e) {
    summary.errors.push(String(e.message).split('\n')[0].slice(0, 300));
    summary.complete = false; if (!summary.missing.length) summary.missing.push('the run stopped on an error');
    console.warn(`[skip] ${t.company}: ${e.message}`);
  }
  console.log(`[postings] ${t.company}: ${summary.postings_found}${dryRun ? ' (dry run — nothing sent)' : `, ${summary.saved} saved by Seen`}`);
  summary.errors = summary.errors.slice(0, 8); summary.tried = summary.tried.slice(0, 14);
  return summary;
}

const sites = [];
try { for (const t of targets) sites.push(await collect(t)); }
finally { await browser.close().catch(() => {}); }
const total = (k) => sites.reduce((a, x) => a + (Number(x[k]) || 0), 0);
console.log(JSON.stringify({ ok: sites.some((x) => x.listing_url), dry_run: dryRun, targets: sites.length, complete: sites.every((x) => x.complete),
  pages_read: total('pages_opened'), listed: total('listed'), postings_found: total('postings_found'), saved: total('saved'), duplicates: total('duplicates'), sites }, null, 2));

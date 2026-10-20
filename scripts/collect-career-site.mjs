#!/usr/bin/env node
// Mac-local career-site collector: reads a company career site that refuses servers through the real
// Chrome (OpenCLI Browser Bridge), the same way the Indeed collector reads Indeed. For each site:
//   1. open the start page (the visitor's own Chrome session gets past the site's bot wall);
//   2. HARVEST inside that page (lib/server/careerBrowser.js harvestInPage): the site's own job list
//      (Tesla's careers feed, else scroll the page until no new job links appear), then each job's
//      schema.org JobPosting data, read with in-page fetch() — no tab per job. Finished postings
//      stream to Seen in batches of 50 while the harvest runs;
//   3. only when the harvest found nothing: open up to CAREER_SITE_LIMIT job pages one by one.
// Seen applies every check itself (api/ingest-local-career-jobs.js → rowFromPosting).
//
// EXPERIMENTAL until verified on the Mac: OpenCLI documents `browser open <url> --session <name>`,
// `browser eval` and `browser close`; the eval argument form is taken from its README and is reported
// verbatim if the installed OpenCLI disagrees.
//
// env: SEEN_LOCAL_INGEST_TOKEN (required), SEEN_LOCAL_INGEST_URL (optional, …/api/ingest-local-indeed),
//      CAREER_SITE_TARGETS_JSON ([{ company, url }], 1–10) or CAREER_SITE_COMPANY + CAREER_SITE_URL (https),
//      CAREER_SITE_MAX_JOBS (jobs the harvest reads per site, 1–5000, default 3000),
//      CAREER_SITE_LIMIT (job pages opened one by one when the harvest finds nothing, 1–60, default 20)
// flags: --dry-run (read, send nothing). Prints one JSON summary on stdout.
import { createOpenCliBrowser } from '../lib/server/opencliBrowser.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { EXTRACT_JS, parseExtract, safeStartUrl, harvestStartJs, HARVEST_POLL_JS, harvestTakeJs, parseEvalJson } from '../lib/server/careerBrowser.js';
import { unwrapOpenCli, opencliFailure } from '../lib/server/redditIntelCollector.js';

const exec = promisify(execFile);
const token = process.env.SEEN_LOCAL_INGEST_TOKEN;
const base = (process.env.SEEN_LOCAL_INGEST_URL || 'https://seenjobs.io/api/ingest-local-indeed').replace(/\/api\/ingest-local-indeed\/?$/, '');
const limit = Math.min(60, Math.max(1, Number(process.env.CAREER_SITE_LIMIT) || 20));
const maxJobs = Math.min(5000, Math.max(1, Number(process.env.CAREER_SITE_MAX_JOBS) || 3000));
const pollMs = Math.max(200, Number(process.env.CAREER_SITE_POLL_MS) || 3000);
const dryRun = process.argv.includes('--dry-run');
const SESSION = 'seen-careers';
if (!token) throw new Error('Set SEEN_LOCAL_INGEST_TOKEN first.');
// Targets: CAREER_SITE_TARGETS_JSON = [{ company, url }] (1–10), or one CAREER_SITE_COMPANY + CAREER_SITE_URL.
const targets = (() => {
  const clean = (c) => String(c || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120);
  let list;
  if (process.env.CAREER_SITE_TARGETS_JSON) {
    try { list = JSON.parse(process.env.CAREER_SITE_TARGETS_JSON); } catch { throw new Error('CAREER_SITE_TARGETS_JSON must be a JSON array of { company, url }.'); }
    if (!Array.isArray(list)) throw new Error('CAREER_SITE_TARGETS_JSON must be a JSON array of { company, url }.');
  } else list = [{ company: process.env.CAREER_SITE_COMPANY, url: process.env.CAREER_SITE_URL }];
  const out = list.map((t) => ({ company: clean(t?.company), url: safeStartUrl(t?.url) })).filter((t) => t.company && t.url).slice(0, 10);
  if (!out.length) throw new Error('Give 1–10 targets, each a company and an https career-site URL.');
  return out;
})();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function opencli(args) {
  let stdout;
  try { ({ stdout } = await exec('opencli', args, { maxBuffer: 20 * 1024 * 1024, timeout: 90000 })); }
  catch (error) { throw new Error(opencliFailure(error)); }
  let parsed; try { parsed = JSON.parse(stdout); } catch { return stdout; }
  if (parsed?.ok === false) throw new Error(parsed?.error?.message || 'OpenCLI command failed');
  return unwrapOpenCli(parsed);
}
// open/eval/close in whichever argument form the installed OpenCLI speaks (lib/server/opencliBrowser.js).
const browser = createOpenCliBrowser({ run: opencli, session: SESSION });
const evalInPage = (js) => browser.eval(js);
async function readPage(url) {
  await browser.open(url);
  await sleep(3500 + Math.floor(Math.random() * 1500)); // let the page render
  return parseExtract(await evalInPage(EXTRACT_JS));
}

async function collect({ company, url: start }) {
  const summary = { company, start_url: start, method: null, detail: null, listed: 0, links_found: 0, pages_read: 0,
    postings_found: 0, no_data: 0, failed: 0, saved: 0, skipped: {}, errors: [], notes: [] };
  let sendFailed = false;
  // Send postings to Seen as they arrive (a long harvest saves as it goes).
  const send = async (items) => {
    summary.postings_found += items.length;
    if (dryRun || sendFailed || !items.length) return;
    for (let i = 0; i < items.length; i += 50) {
      const r = await fetch(`${base}/api/ingest-local-career-jobs`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ company, items: items.slice(i, i + 50) }) });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) { sendFailed = true; summary.errors.push(`ingest failed (${r.status}): ${b.error || 'unknown error'}`); return; }
      summary.saved += Number(b.saved) || 0;
      for (const [k, n] of Object.entries(b.skipped || {})) summary.skipped[k] = (summary.skipped[k] || 0) + Number(n || 0);
    }
  };
  try {
    const first = await readPage(start);
    summary.pages_read++;
    summary.links_found = first.links.length;
    const firstItems = first.postings.map((p) => ({ page_url: first.url || start, posting: p }));

    // The harvest, in the open page. Postings are buffered and sent 50 at a time (fewer, fuller writes).
    let harvested = 0; let buffer = [];
    const flush = async (all = false) => { while (buffer.length >= 50 || (all && buffer.length)) await send(buffer.splice(0, 50)); };
    try {
      const started = parseEvalJson(await evalInPage(harvestStartJs({ company, maxJobs })));
      if (!started || (!started.started && !started.already)) throw new Error('the page did not start the harvest');
      const deadline = Date.now() + Math.min(60 * 60_000, 180_000 + maxJobs * 1500);
      let status = null;
      for (;;) {
        await sleep(pollMs);
        status = parseEvalJson(await evalInPage(HARVEST_POLL_JS));
        if (!status || status.missing) throw new Error('the harvest state disappeared (the page navigated away?)');
        while (status.ready > 0) {
          const batch = parseEvalJson(await evalInPage(harvestTakeJs(50)), []);
          if (!Array.isArray(batch) || !batch.length) break;
          harvested += batch.length;
          buffer.push(...batch);
          await flush();
          status.ready -= batch.length;
        }
        if (!status.running) break;
        if (Date.now() > deadline) { summary.errors.push(`harvest stopped at the time limit after ${status.done} of ${status.listed} jobs`); break; }
      }
      await flush(true);
      Object.assign(summary, { method: status.method, detail: status.detail, listed: status.listed, no_data: status.noData || 0, failed: status.failed || 0 });
      for (const e of status.errors || []) if (summary.errors.length < 5) summary.errors.push(`harvest: ${String(e).slice(0, 200)}`);
      summary.notes = (status.notes || []).map((n) => String(n).slice(0, 200)).slice(0, 5);
      console.log(`[harvest] ${company}: ${status.listed} jobs listed (${status.method}), ${harvested} with job data (${status.detail || 'none'}), ${status.noData || 0} without, ${status.failed || 0} failed`);
    } catch (e) { await flush(true).catch(() => {}); summary.errors.push(`harvest: ${String(e.message).split('\n')[0].slice(0, 200)}`); console.warn(`[skip] ${company}: harvest failed: ${e.message}`); }

    // The start page's own postings, unless the harvest already covered them.
    if (!harvested) await send(firstItems);

    // Fallback: open job pages one by one (a site whose job data only appears once a page renders).
    if (!harvested && !firstItems.length && first.links.length) {
      summary.method = summary.method || 'pages';
      console.log(`[collect] ${company}: harvest found no job data — opening ${Math.min(limit, first.links.length)} of ${first.links.length} job pages`);
      for (const link of first.links.slice(0, limit)) {
        try {
          const page = await readPage(link);
          summary.pages_read++;
          await send(page.postings.map((p) => ({ page_url: page.url || link, posting: p })));
        } catch (e) { summary.errors.push(`${link}: ${String(e.message).split('\n')[0].slice(0, 200)}`); console.warn(`[skip] ${company} page ${link}: ${e.message}`); }
        await sleep(1500 + Math.floor(Math.random() * 1500)); // polite pace
      }
    }
  } catch (e) {
    summary.errors.push(String(e.message).split('\n')[0].slice(0, 300));
    console.warn(`[skip] ${company}: could not read ${start}: ${e.message}`);
  }
  console.log(`[postings] ${company}: ${summary.postings_found}${dryRun ? ' (dry run — nothing sent)' : `, ${summary.saved} saved by Seen`}`);
  summary.errors = summary.errors.slice(0, 5);
  return summary;
}

const sites = [];
try { for (const t of targets) sites.push(await collect(t)); }
finally { await browser.close().catch(() => {}); }
const total = (k) => sites.reduce((a, x) => a + (Number(x[k]) || 0), 0);
console.log(JSON.stringify({ ok: sites.every((x) => !x.errors.length || x.pages_read > 0), dry_run: dryRun, targets: sites.length,
  pages_read: total('pages_read'), listed: total('listed'), postings_found: total('postings_found'), saved: total('saved'), sites }, null, 2));

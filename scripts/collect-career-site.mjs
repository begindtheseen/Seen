#!/usr/bin/env node
// Mac-local career-site collector: reads a company career site that refuses servers through the real
// Chrome (OpenCLI Browser Bridge), the same way the Indeed collector reads Indeed. It opens the start
// page, collects job links on that site, opens up to CAREER_SITE_LIMIT of them, takes each page's own
// schema.org JobPosting data, and sends it to Seen, which applies every check itself.
//
// EXPERIMENTAL until verified on the Mac: OpenCLI documents `browser open <url> --session <name>`,
// `browser eval` and `browser close`; the eval argument form is taken from its README and is reported
// verbatim if the installed OpenCLI disagrees.
//
// env: SEEN_LOCAL_INGEST_TOKEN (required), SEEN_LOCAL_INGEST_URL (optional, …/api/ingest-local-indeed),
//      CAREER_SITE_TARGETS_JSON ([{ company, url }], 1–10) or CAREER_SITE_COMPANY + CAREER_SITE_URL (https),
//      CAREER_SITE_LIMIT (job pages per site, 1–60, default 20)
// flags: --dry-run (read, send nothing). Prints one JSON summary on stdout.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { EXTRACT_JS, parseExtract, safeStartUrl } from '../lib/server/careerBrowser.js';
import { unwrapOpenCli, opencliFailure } from '../lib/server/redditIntelCollector.js';

const exec = promisify(execFile);
const token = process.env.SEEN_LOCAL_INGEST_TOKEN;
const base = (process.env.SEEN_LOCAL_INGEST_URL || 'https://seenjobs.io/api/ingest-local-indeed').replace(/\/api\/ingest-local-indeed\/?$/, '');
const limit = Math.min(60, Math.max(1, Number(process.env.CAREER_SITE_LIMIT) || 20));
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
async function readPage(url) {
  await opencli(['browser', 'open', url, '--session', SESSION]);
  await sleep(3500 + Math.floor(Math.random() * 1500)); // let the page render
  return parseExtract(await opencli(['browser', 'eval', EXTRACT_JS, '--session', SESSION]));
}

async function collect({ company, url: start }) {
  const summary = { company, start_url: start, links_found: 0, pages_read: 0, postings_found: 0, saved: 0, skipped: {}, errors: [] };
  const items = [];
  try {
    const first = await readPage(start);
    summary.pages_read++;
    for (const p of first.postings) items.push({ page_url: first.url || start, posting: p });
    summary.links_found = first.links.length;
    console.log(`[collect] ${company}: ${first.links.length} job links on ${new URL(start).hostname}`);
    for (const link of first.links.slice(0, limit)) {
      try {
        const page = await readPage(link);
        summary.pages_read++;
        for (const p of page.postings) items.push({ page_url: page.url || link, posting: p });
      } catch (e) { summary.errors.push(`${link}: ${String(e.message).split('\n')[0].slice(0, 200)}`); console.warn(`[skip] ${company} page ${link}: ${e.message}`); }
      await sleep(1500 + Math.floor(Math.random() * 1500)); // polite pace
    }
  } catch (e) {
    summary.errors.push(String(e.message).split('\n')[0].slice(0, 300));
    console.warn(`[skip] ${company}: could not read ${start}: ${e.message}`);
  }
  summary.postings_found = items.length;
  console.log(`[postings] ${company}: ${items.length}`);
  if (!dryRun && items.length) {
    for (let i = 0; i < items.length; i += 50) {
      const r = await fetch(`${base}/api/ingest-local-career-jobs`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ company, items: items.slice(i, i + 50) }) });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) { summary.errors.push(`ingest failed (${r.status}): ${b.error || 'unknown error'}`); break; }
      summary.saved += Number(b.saved) || 0;
      for (const [k, n] of Object.entries(b.skipped || {})) summary.skipped[k] = (summary.skipped[k] || 0) + Number(n || 0);
    }
  }
  summary.errors = summary.errors.slice(0, 5);
  return summary;
}

const sites = [];
try { for (const t of targets) sites.push(await collect(t)); }
finally { await opencli(['browser', 'close', '--session', SESSION]).catch(() => {}); }
const total = (k) => sites.reduce((a, x) => a + (Number(x[k]) || 0), 0);
console.log(JSON.stringify({ ok: sites.every((x) => !x.errors.length || x.pages_read > 0), dry_run: dryRun, targets: sites.length,
  pages_read: total('pages_read'), postings_found: total('postings_found'), saved: total('saved'), sites }, null, 2));

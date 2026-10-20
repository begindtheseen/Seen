#!/usr/bin/env node
// Mac-local applicant-report collection from Google: searches and reads in the owner's own Chrome through
// the OpenCLI Browser Bridge (Google refuses servers), at a human pace, free (no model, no API key).
// lib/reports/webHarvest.js decides what to search and read; lib/reports/collectorRun.js runs the companies
// with ONE goal of new reports each and streams accounts to Seen's /api/ingest-local-company-intel, which
// re-checks every account with the same strict rules and publishes passes as "Public review · <host>"
// (weight 0.3, trust_reason web_rule_match), or keeps them as commentary.
//
// env: SEEN_COMPANY_INTEL_INGEST_TOKEN (required), SEEN_COMPANY_INTEL_INGEST_URL (optional),
//      WEB_REPORTS_COMPANIES_JSON (JSON array of 1–500 names) — else Seen picks WEB_REPORTS_COMPANY_LIMIT (1–100,
//        default 10) of its active companies; with WEB_REPORTS_BELOW=K only those under K applicant reports,
//      WEB_REPORTS_GOAL (NEW reports per company — new_reports, not accounts found; default 10; 0 = no cap),
//      WEB_REPORTS_MINUTES_PER_COMPANY (1–240, default 15), WEB_REPORTS_TOTAL_MINUTES (1–1440; unset = none),
//      WEB_REPORTS_SEARCH_GAP_SECONDS (pause between Google searches, 10–600, default 25),
//      WEB_REPORTS_PAGES_PER_COMPANY (result pages opened per company, 1–200, default 30).
// flags: --dry-run (collect and print, send nothing). Prints one JSON summary on stdout.
// A Google CAPTCHA stops Google for the rest of the run (google_blocked) — it is never solved.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { harvestGoogle } from '../lib/reports/webHarvest.js';
import { runCollection } from '../lib/reports/collectorRun.js';
import { createOpenCliBrowser } from '../lib/server/opencliBrowser.js';
import { unwrapOpenCli, opencliFailure } from '../lib/server/redditIntelCollector.js';
import { censorExcerpt } from '../lib/server/companyIntelImport.js';
import { outcomeSentiment } from '../lib/reports/applicantRules.js';

const exec = promisify(execFile);
const token = process.env.SEEN_COMPANY_INTEL_INGEST_TOKEN;
const base = (process.env.SEEN_COMPANY_INTEL_INGEST_URL || 'https://seenjobs.io/api/ingest-local-company-intel').replace(/\/api\/ingest-local-company-intel\/?$/, '');
const int = (v, lo, hi, d) => { const n = Number(v); return Number.isInteger(n) && n >= lo && n <= hi ? n : d; };
const goal = int(process.env.WEB_REPORTS_GOAL, 0, 100000, 10);
const minutes = int(process.env.WEB_REPORTS_MINUTES_PER_COMPANY, 1, 240, 15);
const totalMinutes = int(process.env.WEB_REPORTS_TOTAL_MINUTES, 1, 1440, null);
const runDeadline = totalMinutes ? Date.now() + totalMinutes * 60_000 : Infinity;
const companyLimit = int(process.env.WEB_REPORTS_COMPANY_LIMIT, 1, 100, 10);
const below = int(process.env.WEB_REPORTS_BELOW, 1, 10000, null);
const searchGapSeconds = int(process.env.WEB_REPORTS_SEARCH_GAP_SECONDS, 10, 600, 25);
const pagesPerCompany = int(process.env.WEB_REPORTS_PAGES_PER_COMPANY, 1, 200, 30);
const dryRun = process.argv.includes('--dry-run');
if (!token) throw new Error('Set SEEN_COMPANY_INTEL_INGEST_TOKEN first.');

const explicit = (() => {
  const raw = process.env.WEB_REPORTS_COMPANIES_JSON;
  if (!raw) return null;
  let list; try { list = JSON.parse(raw); } catch { throw new Error('WEB_REPORTS_COMPANIES_JSON must be a JSON array of company names.'); }
  if (!Array.isArray(list)) throw new Error('WEB_REPORTS_COMPANIES_JSON must be a JSON array of company names.');
  const names = [...new Map(list.map((n) => String(n || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120)).filter(Boolean).map((n) => [n.toLowerCase(), n])).values()];
  if (!names.length || names.length > 500) throw new Error('WEB_REPORTS_COMPANIES_JSON must name 1–500 companies.');
  return names;
})();

const getJson = async (path) => {
  const r = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${path} failed (${r.status}): ${b.error || 'unknown error'}`);
  return b;
};
const postItems = async (items) => {
  const r = await fetch(`${base}/api/ingest-local-company-intel`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ items, require_existing: true }) });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Seen ingest failed (${r.status}): ${b.error || 'unknown error'}`);
  return b;
};
async function opencli(args) {
  let stdout;
  try { ({ stdout } = await exec('opencli', args, { maxBuffer: 20 * 1024 * 1024, timeout: 90000 })); }
  catch (error) { throw new Error(opencliFailure(error)); }
  let parsed; try { parsed = JSON.parse(stdout); } catch { return stdout; }
  if (parsed?.ok === false) throw new Error(parsed?.error?.message || 'OpenCLI command failed');
  return unwrapOpenCli(parsed);
}

const targets = explicit || (await getJson(`/api/local-company-intel-targets?limit=${companyLimit}${below ? `&below=${below}` : ''}`)).companies?.map((c) => c.company).filter(Boolean) || [];
console.log(`[targets] ${explicit ? 'chosen' : below ? `from Seen (under ${below} applicant reports)` : 'from Seen'}: ${targets.length} · goal ${goal || 'until exhausted'} new reports per company · Google in this Mac's Chrome · ${searchGapSeconds}s between searches · ${minutes} min each`);
const browser = createOpenCliBrowser({ run: opencli, session: 'seen-web-reports' });
const state = { blocked: false, lastSearchAt: 0 };
const seenUrls = new Set();
const google = {
  id: 'google', label: 'Google',
  harvest: (company, o) => harvestGoogle(company, { browser, state, seenUrls, searchGapMs: searchGapSeconds * 1000, maxPagesRead: pagesPerCompany, ...o }),
  toItem: (company, a) => ({ company, source: `Web · ${a.host}`, source_url: a.url, excerpt: censorExcerpt(a.excerpt), kind: 'applicant_outcome', outcome: a.outcome,
    sentiment: outcomeSentiment(a.outcome), context: { title: a.title, is_op: false, company_sub: false } }),
  preview: (a) => a.host,
};
let summary;
try { summary = await runCollection({ targets, goal, minutes, runDeadline, dryRun, postItems, sources: [google], meta: { search_gap_seconds: searchGapSeconds } }); }
finally { await browser.close().catch(() => {}); }
console.log(JSON.stringify({ ...summary, google_blocked: state.blocked, opencli_form: browser.form }, null, 2));

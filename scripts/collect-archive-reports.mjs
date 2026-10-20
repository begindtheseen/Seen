#!/usr/bin/env node
// Free, deep applicant-report collection (no model, no spend, no browser) with ONE goal of new reports per
// company (lib/reports/collectorRun.js), from:
//   reddit — the Arctic Shift Reddit archive (lib/reports/archiveHarvest.js): the company's own subreddits +
//            the job subreddits, year by year, every thread's post and comment tree.
// (Hacker News was removed 2026-10-20 by owner decision — lib/reports/excludedSources.js.)
// Everything passes the strict first-hand rules (lib/reports/applicantRules.js). Accounts stream to Seen's
// /api/ingest-local-company-intel in batches; Seen re-checks each one with the same rules and publishes it as
// attributed public discussion (weight 0.3), or keeps it as commentary when it fails.
//
// env: SEEN_COMPANY_INTEL_INGEST_TOKEN (required), SEEN_COMPANY_INTEL_INGEST_URL (optional),
//      ARCHIVE_REPORTS_COMPANIES_JSON (JSON array of 1–500 names) — else Seen picks ARCHIVE_REPORTS_COMPANY_LIMIT
//        (1–100, default 10) of its active companies; with ARCHIVE_REPORTS_BELOW=K (1–10000) only those with
//        fewer than K applicant reports (most open listings first) — the "fill every company to K" queue,
//      ARCHIVE_REPORTS_GOAL (NEW reports per company before moving on — new_reports, not accounts found; default 10;
//        0 = until every source is exhausted),
//      ARCHIVE_REPORTS_SOURCES (comma list, in order; default and only value "reddit"),
//      ARCHIVE_REPORTS_YEARS (history depth, 1–10, default 5),
//      ARCHIVE_REPORTS_MINUTES_PER_COMPANY (time budget per company, 1–240, default 20),
//      ARCHIVE_REPORTS_TOTAL_MINUTES (time budget for the whole run, 1–1440; unset = none). When it runs
//        out, the company in progress stops and the rest are listed as not_reached, so a caller with its
//        own wall-clock limit gets a clean summary instead of a killed process.
// flags: --dry-run (collect and print, send nothing). Prints one JSON summary on stdout.
import { harvestCompany } from '../lib/reports/archiveHarvest.js';
import { runCollection } from '../lib/reports/collectorRun.js';
import { createArcticFetcher } from './credit/lib/arcticShift.mjs';
import { censorExcerpt } from '../lib/server/companyIntelImport.js';
import { outcomeSentiment } from '../lib/reports/applicantRules.js';

const token = process.env.SEEN_COMPANY_INTEL_INGEST_TOKEN;
const base = (process.env.SEEN_COMPANY_INTEL_INGEST_URL || 'https://seenjobs.io/api/ingest-local-company-intel').replace(/\/api\/ingest-local-company-intel\/?$/, '');
const int = (v, lo, hi, d) => { const n = Number(v); return Number.isInteger(n) && n >= lo && n <= hi ? n : d; };
const goal = int(process.env.ARCHIVE_REPORTS_GOAL, 0, 100000, 10);
const years = int(process.env.ARCHIVE_REPORTS_YEARS, 1, 10, 5);
const minutes = int(process.env.ARCHIVE_REPORTS_MINUTES_PER_COMPANY, 1, 240, 20);
const totalMinutes = int(process.env.ARCHIVE_REPORTS_TOTAL_MINUTES, 1, 1440, null);
const runDeadline = totalMinutes ? Date.now() + totalMinutes * 60_000 : Infinity;
const companyLimit = int(process.env.ARCHIVE_REPORTS_COMPANY_LIMIT, 1, 100, 10);
const below = int(process.env.ARCHIVE_REPORTS_BELOW, 1, 10000, null);
const dryRun = process.argv.includes('--dry-run');
const SOURCE_IDS = ['reddit'];
const sourceIds = String(process.env.ARCHIVE_REPORTS_SOURCES || SOURCE_IDS.join(',')).split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
const unknownSource = sourceIds.find((x) => !SOURCE_IDS.includes(x));
if (unknownSource || !sourceIds.length) throw new Error(`ARCHIVE_REPORTS_SOURCES must list ${SOURCE_IDS.join(' and/or ')} (got "${unknownSource || ''}").`);
if (!token) throw new Error('Set SEEN_COMPANY_INTEL_INGEST_TOKEN first.');

const explicit = (() => {
  const raw = process.env.ARCHIVE_REPORTS_COMPANIES_JSON;
  if (!raw) return null;
  let list; try { list = JSON.parse(raw); } catch { throw new Error('ARCHIVE_REPORTS_COMPANIES_JSON must be a JSON array of company names.'); }
  if (!Array.isArray(list)) throw new Error('ARCHIVE_REPORTS_COMPANIES_JSON must be a JSON array of company names.');
  const names = [...new Map(list.map((n) => String(n || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120)).filter(Boolean).map((n) => [n.toLowerCase(), n])).values()];
  if (!names.length || names.length > 500) throw new Error('ARCHIVE_REPORTS_COMPANIES_JSON must name 1–500 companies.');
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

const targets = explicit || (await getJson(`/api/local-company-intel-targets?limit=${companyLimit}${below ? `&below=${below}` : ''}`)).companies?.map((c) => c.company).filter(Boolean) || [];
console.log(`[targets] ${explicit ? 'chosen' : below ? `from Seen (under ${below} applicant reports)` : 'from Seen'}: ${targets.length} · goal ${goal || 'until exhausted'} new reports per company · ${sourceIds.join(' → ')} · ${years} years · ${minutes} min each`);
const fetcher = createArcticFetcher({ log: () => {} });
const item = (company, a, source, context) => ({ company, source, source_url: a.url, excerpt: censorExcerpt(a.excerpt), kind: 'applicant_outcome', outcome: a.outcome,
  sentiment: outcomeSentiment(a.outcome), posted: a.created, context });
const SOURCES = {
  reddit: { id: 'reddit', label: 'Reddit', harvest: (company, o) => harvestCompany(company, { fetcher, years, ...o }),
    toItem: (company, a) => item(company, a, `Reddit r/${a.subreddit}`, { title: a.title, is_op: a.isOp, company_sub: a.inCompanySub }),
    preview: (a) => `r/${a.subreddit}${a.isOp ? ' OP' : ''}` },
};
const summary = await runCollection({ targets, goal, minutes, runDeadline, dryRun, postItems, sources: sourceIds.map((id) => SOURCES[id]), meta: { years } });
console.log(JSON.stringify(summary, null, 2));


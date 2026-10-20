#!/usr/bin/env node
// Free, deep applicant-report collection from the Arctic Shift Reddit archive (no model, no spend, no
// browser). For each company (lib/reports/archiveHarvest.js): its own subreddits + the job subreddits,
// year by year, every new thread's opening post and comment tree, through the strict first-hand rules
// (lib/reports/applicantRules.js). Accounts stream to Seen's /api/ingest-local-company-intel in batches as
// they are found; Seen re-checks each one with the same rules and publishes it as attributed public
// discussion (Reddit tier, weight 0.3), or keeps it as commentary when it fails.
//
// env: SEEN_COMPANY_INTEL_INGEST_TOKEN (required), SEEN_COMPANY_INTEL_INGEST_URL (optional),
//      ARCHIVE_REPORTS_COMPANIES_JSON (JSON array of 1–500 names) — else Seen picks ARCHIVE_REPORTS_COMPANY_LIMIT
//        (1–100, default 10) of its active companies; with ARCHIVE_REPORTS_BELOW=K (1–10000) only those with
//        fewer than K applicant reports (most open listings first) — the "fill every company to K" queue,
//      ARCHIVE_REPORTS_GOAL (new accounts per company before moving on; default 10; 0 = until every source is exhausted),
//      ARCHIVE_REPORTS_YEARS (history depth, 1–10, default 5),
//      ARCHIVE_REPORTS_MINUTES_PER_COMPANY (time budget per company, 1–240, default 20),
//      ARCHIVE_REPORTS_TOTAL_MINUTES (time budget for the whole run, 1–1440; unset = none). When it runs
//        out, the company in progress stops and the rest are listed as not_reached, so a caller with its
//        own wall-clock limit gets a clean summary instead of a killed process.
// flags: --dry-run (collect and print, send nothing). Prints one JSON summary on stdout.
import { harvestCompany } from '../lib/reports/archiveHarvest.js';
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
console.log(`[targets] ${explicit ? 'chosen' : below ? `from Seen (under ${below} applicant reports)` : 'from Seen'}: ${targets.length} · goal ${goal || 'until exhausted'} per company · ${years} years · ${minutes} min each`);
const fetcher = createArcticFetcher({ log: () => {} });
const totals = { found: 0, imported_reports: 0, published_reports: 0, downgraded: 0, duplicates: 0, rejected: 0 };
const reasons = [];
const companies = [];
let ingestDown = null;
const notReached = [];

for (const company of targets) {
  if (ingestDown || Date.now() >= runDeadline) { notReached.push(company); continue; }
  const row = { company, found: 0, new_reports: null, sent: 0, imported: 0, published: 0, duplicates: 0, downgraded: 0, rejected: 0, threads_read: 0, searches: 0, failed_searches: 0, company_subs: [], stopped_by: null, outcomes: {} };
  let buffer = [];
  // Sends what is buffered: in batches of 50, and also as soon as the buffer could complete the goal —
  // the goal counts reports Seen newly ACCEPTS (a re-run re-finds accounts Seen already holds), so Seen
  // has to answer before the harvester knows whether to stop. Returns the new reports this call added.
  const flush = async (all = false) => {
    const before = row.imported;
    while (!dryRun && !ingestDown && (buffer.length >= 50 || (buffer.length && (all || (goal > 0 && row.imported + buffer.length >= goal))))) {
      const batch = buffer.splice(0, 50);
      try {
        const b = await postItems(batch);
        row.sent += batch.length;
        row.imported += Number(b.imported_reports) || 0; row.published += Number(b.published_reports) || 0;
        row.duplicates += Number(b.duplicates) || 0; row.downgraded += Number(b.downgraded) || 0; row.rejected += Number(b.rejected) || 0;
        for (const e of b.errors || []) if (reasons.length < 10 && !reasons.includes(String(e))) reasons.push(String(e).slice(0, 160));
      } catch (e) { ingestDown = String(e.message).slice(0, 200); console.warn(`[skip] sending stopped: ${ingestDown}`); }
    }
    return row.imported - before;
  };
  try {
    const r = await harvestCompany(company, {
      fetcher, goal, years, deadlineAt: Math.min(runDeadline, Date.now() + minutes * 60_000),
      onAccounts: async (accounts) => {
        row.found += accounts.length;
        for (const a of accounts) {
          row.outcomes[a.outcome] = (row.outcomes[a.outcome] || 0) + 1;
          buffer.push({ company, source: `Reddit r/${a.subreddit}`, source_url: a.url, excerpt: censorExcerpt(a.excerpt), kind: 'applicant_outcome', outcome: a.outcome,
            sentiment: outcomeSentiment(a.outcome),
            posted: a.created, context: { title: a.title, is_op: a.isOp, company_sub: a.inCompanySub } });
          if (dryRun) console.log(`   [${a.outcome}] r/${a.subreddit}${a.isOp ? ' OP' : ''} | ${a.excerpt.slice(0, 160)}`);
        }
        const added = await flush();
        // A dry run sends nothing, so its goal counts accounts found; a stopped ingest stops the company.
        if (ingestDown) throw new Error(`sending stopped: ${ingestDown}`);
        return dryRun ? undefined : added;
      },
      log: (m) => console.log(`[harvest]${m}`),
    });
    await flush(true);
    Object.assign(row, { new_reports: dryRun ? null : row.imported, threads_read: r.threadsRead, searches: r.searches, failed_searches: r.failedSearches, company_subs: r.companySubs, stopped_by: r.stoppedBy });
  } catch (e) {
    await flush(true).catch(() => {});
    row.stopped_by = 'error'; row.error = String(e.message || e).split('\n')[0].slice(0, 200);
    console.warn(`[skip] ${company}: ${row.error}`);
  }
  console.log(`[company] ${company}: ${row.found} first-hand accounts (${row.stopped_by})${dryRun ? '' : ` · ${row.imported} new reports (${row.published} published), ${row.duplicates} already in Seen, ${row.downgraded} kept as commentary`}`);
  for (const k of ['found']) totals[k] += row[k];
  totals.imported_reports += row.imported; totals.published_reports += row.published; totals.duplicates += row.duplicates; totals.downgraded += row.downgraded; totals.rejected += row.rejected;
  companies.push(row);
}

const stoppedEarly = ingestDown ? 'ingest_error' : notReached.length ? 'time' : null;
console.log(JSON.stringify({ ok: !ingestDown, dry_run: dryRun, goal, years, targets: targets.length, ...totals, ingest_error: ingestDown,
  stopped_early: stoppedEarly, not_reached: notReached, rejection_reasons: reasons, companies }, null, 2));

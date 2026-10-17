#!/usr/bin/env node
// One-time Reddit backfill for the Staffing Agency Ghost Index + top companies.
// Resumable, phase by phase (each phase reads the previous phase's files under .credit-runs/reddit):
//
//   node scripts/credit/reddit-backfill.mjs fetch   [--companies 400] [--threads 25] [--only <substr>] [--refetch] [--dry-run]
//   node scripts/credit/reddit-backfill.mjs extract [--label reddit-extract] [--kind agency|company] [--dry-run]
//   node scripts/credit/reddit-backfill.mjs sample  [--label reddit-extract] [--n 40] [--seed 1]
//   node scripts/credit/qa-judge.mjs --input .credit-runs/reddit/qa-sample.json --label qa-reddit
//   node scripts/credit/reddit-backfill.mjs write   [--label reddit-extract] [--qa-label qa-reddit] [--dry-run]
//
// fetch   — Reddit Atom search (all time) per target → thread comment feeds → threads/<target>.json.
//           Needs SUPABASE_URL/SUPABASE_SERVICE_KEY (target list + reddit_imports dedupe). No API spend.
// extract — one Sonnet 5.5 batch request per (target, ≤8 threads); results → <label>/extractions.json.
// sample  — 40 random validated (source, extraction) pairs → qa-sample.json for the Opus judge.
// write   — validate + PII-filter + dedupe → reports + reddit_imports rows → recompute each company.
//           Refuses to write unless the qa-judge verdict for --qa-label passed (--skip-qa-gate overrides).
//
// Legal posture (docs/legal-notes.md): rows are attributed third-party public discussion
// (platform "Reddit r/<sub>", source 'reddit', weight 0.3) — never presented as Seen's own claim.

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseRedditSearchAtom } from '../../api/_utils/companyReddit.js';
import { recomputeCompanyScoreFromReports, resolveOrCreateCompany } from '../../api/_utils/reportWrite.js';
import { RUNS_DIR, argValue, isDryRun, runBatch, sb, sbAll, sbEnv } from './lib/batch.mjs';
import {
  DEFAULTS, buildExtractRequests, buildImportRow, buildReportRow, buildTargets, coverage, createRedditFetcher,
  expKey, extractionsFromResults, fetchTarget, importedIdsForTarget, loadAgencies, normKey, planWrite, sampleN,
  searchUrlBuilders, sourceFor, targetSlug,
} from './lib/reddit.mjs';

const DIR = join(RUNS_DIR, 'reddit');
const THREADS_DIR = join(DIR, 'threads');
const has = (flag) => process.argv.includes(`--${flag}`);
const num = (name, fallback) => { const v = Number(argValue(name, fallback)); return Number.isFinite(v) && v > 0 ? v : fallback; };
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
// Read-or-null in one step — no exists-then-read check (that pattern races).
const readJsonMaybe = (p) => { try { return readJson(p); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };
const writeJson = (p, v) => { mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, JSON.stringify(v, null, 2)); };
const hasSupabase = () => { try { sbEnv(); return true; } catch { return false; } };

function loadCaches() {
  let files;
  try { files = readdirSync(THREADS_DIR); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  return files.filter((f) => f.endsWith('.json')).map((f) => readJson(join(THREADS_DIR, f)));
}
const bySlug = (caches) => new Map(caches.map((c) => [targetSlug(c.target), c]));

// Run fn over items with at most n in flight (the fetcher's shared gate still spaces every request).
async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) await fn(items[i++]); }));
}

// ── fetch ────────────────────────────────────────────────────────────────────────

async function fetchPhase() {
  const limit = num('companies', DEFAULTS.companies);
  const threadsCap = num('threads', DEFAULTS.threadsPerTarget);
  const agencies = loadAgencies();
  let agencyScoreRows = [], companyRows = [], importRows = [];
  if (hasSupabase()) {
    const aliases = agencies.flatMap((a) => a.aliases);
    const inList = encodeURIComponent(`(${aliases.map((a) => `"${a.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',')})`);
    agencyScoreRows = await sb(`company_scores?company_name=in.${inList}&select=company_name,report_count,first_party_report_count`);
    // Over-fetch: invalid names, agency duplicates and spelling variants are dropped by buildTargets.
    companyRows = await sbAll('company_scores?select=company_name,report_count,first_party_report_count&report_count=gt.0&order=report_count.desc.nullslast,company_name.asc', { max: limit * 2 + 200 });
    importRows = await sbAll('reddit_imports?select=reddit_post_id,company_name&order=id.asc');
  } else if (isDryRun()) {
    console.warn('SUPABASE_URL / SUPABASE_SERVICE_KEY not set — dry run lists agencies only.');
  } else {
    throw new Error('fetch needs SUPABASE_URL / SUPABASE_SERVICE_KEY (target list + reddit_imports dedupe)');
  }
  let targets = buildTargets({ agencies, agencyScoreRows, companyRows, limit });
  const only = argValue('only');
  if (only) targets = targets.filter((t) => t.writeName.includes(only.toLowerCase()));
  writeJson(join(DIR, 'targets.json'), targets);

  const pending = targets.filter((t) => {
    const p = join(THREADS_DIR, `${targetSlug(t)}.json`);
    return has('refetch') || !readJsonMaybe(p)?.complete;
  });
  const perTarget = searchUrlBuilders(targets[0] || { searchTerm: 'x' }).length + threadsCap;
  const reqs = pending.length * perTarget;
  console.log(`[fetch] ${targets.length} targets (${targets.filter((t) => t.kind === 'agency').length} agencies) · ${pending.length} to fetch · ≤${reqs.toLocaleString()} Reddit requests · ≥${(reqs * DEFAULTS.intervalMs / 3.6e6).toFixed(1)}h at ${DEFAULTS.intervalMs}ms spacing (more with 429 back-offs)`);
  console.log(`[fetch] reddit_imports rows loaded for dedupe: ${importRows.length}`);
  if (isDryRun()) {
    for (const t of targets.slice(0, 40)) console.log(`  ${t.kind.padEnd(7)} ${t.displayName} → writes as "${t.writeName}" · search "${t.searchTerm}"`);
    if (targets.length > 40) console.log(`  … and ${targets.length - 40} more (full list: ${join(DIR, 'targets.json')})`);
    return;
  }

  mkdirSync(THREADS_DIR, { recursive: true });
  const fetcher = createRedditFetcher({ log: console.log });
  let done = 0;
  await pool(pending, DEFAULTS.concurrency, async (t) => {
    try {
      const cache = await fetchTarget(t, { fetcher, parseSearch: parseRedditSearchAtom, importedIds: importedIdsForTarget(importRows, t), threadsCap, log: console.log });
      writeJson(join(THREADS_DIR, `${targetSlug(t)}.json`), cache); // persisted per target → resumable
      if (!cache.complete) console.log(`  ${t.displayName}: every search failed — will retry on the next run`);
    } catch (e) {
      console.log(`  ${t.displayName}: ERROR ${e.message} — will retry on the next run`);
    }
    if (++done % 10 === 0) console.log(`[fetch] ${done}/${pending.length} · ${fetcher.stats.requests} requests · ${fetcher.stats.r429} × 429`);
  });
  const wanted = new Set(targets.map(targetSlug));
  const cov = coverage(loadCaches().filter((c) => wanted.has(targetSlug(c.target))));
  writeJson(join(DIR, 'coverage.json'), cov);
  console.log(`[fetch] coverage: ${cov.targetsWithThreads}/${cov.targets} targets with ≥1 thread (agencies ${cov.agenciesWithThreads}/${cov.agencies}) · ${cov.threads} threads · ${cov.comments} comments · ${cov.chars.toLocaleString()} chars · ${cov.threadsWithoutComments} threads without a comment feed`);
}

// ── extract ──────────────────────────────────────────────────────────────────────

async function extractPhase() {
  const label = argValue('label', 'reddit-extract');
  const runDir = join(RUNS_DIR, label);
  const kind = argValue('kind'); // 'agency' | 'company' — e.g. run the agencies first under their own label
  const caches = loadCaches().filter((c) => c.complete && c.threads.length && (!kind || c.target.kind === kind));
  if (!caches.length) throw new Error('no fetched threads — run `fetch` first');
  const { requests, manifest: fresh } = buildExtractRequests(caches, { log: console.log });
  // Resuming a submitted batch: the manifest saved at submit time is the join key, not a rebuild.
  const savedManifest = readJsonMaybe(join(runDir, 'batches.json')) ? readJsonMaybe(join(runDir, 'manifest.json')) : null;
  const submitted = !!savedManifest;
  const manifest = submitted ? savedManifest : fresh;
  if (submitted && Object.keys(fresh).length !== Object.keys(manifest).length) {
    console.warn(`[extract] note: threads changed since ${label} was submitted — resuming the original batch; use a new --label for the new threads`);
  }
  if (!submitted) writeJson(join(runDir, 'manifest.json'), manifest);
  const { results, dryRun } = await runBatch({ label, requests, estimate: { expectedOutTokens: 2500 } });
  if (dryRun) return;
  const extractions = extractionsFromResults(results, manifest);
  writeJson(join(runDir, 'extractions.json'), extractions);
  const errs = extractions.filter((x) => x.error);
  const n = extractions.reduce((k, x) => k + (x.experiences?.length || 0), 0);
  console.log(`[extract] ${extractions.length - errs.length}/${extractions.length} requests parsed · ${n} raw experiences · errors: ${JSON.stringify(errs.reduce((m, x) => ({ ...m, [x.error]: (m[x.error] || 0) + 1 }), {}))}`);
}

function loadPlan(label) {
  const p = join(RUNS_DIR, label, 'extractions.json');
  const extractions = readJsonMaybe(p);
  if (!extractions) throw new Error(`${p} not found — run \`extract --label ${label}\` (not as a dry run) first`);
  const caches = bySlug(loadCaches());
  return { caches, plan: planWrite(extractions, caches) };
}

// ── sample ───────────────────────────────────────────────────────────────────────

function samplePhase() {
  const label = argValue('label', 'reddit-extract');
  const { caches, plan } = loadPlan(label);
  const picks = sampleN(plan.kept, num('n', 40), num('seed', 1));
  const items = picks.map((e) => {
    const t = caches.get(e.target_slug).threads.find((x) => x.id === e.thread_id);
    return {
      id: expKey(e),
      company: caches.get(e.target_slug).target.displayName,
      source: sourceFor(e, t),
      extraction: { outcome: e.outcome, role: e.role, summary: e.summary, confidence: e.confidence, comment_index: e.comment_index },
    };
  });
  writeJson(join(DIR, 'qa-sample.json'), items);
  console.log(`[sample] ${items.length} of ${plan.kept.length} validated experiences → ${join(DIR, 'qa-sample.json')}`);
  console.log('[sample] next: node scripts/credit/qa-judge.mjs --input .credit-runs/reddit/qa-sample.json --label qa-reddit');
}

// ── write ────────────────────────────────────────────────────────────────────────

async function writePhase() {
  const label = argValue('label', 'reddit-extract');
  const dry = isDryRun();
  const { caches, plan } = loadPlan(label);
  const ledgerPath = join(DIR, 'written.json');
  const ledger = readJsonMaybe(ledgerPath) || { keys: [], reports: [], importedThreads: [] };
  const writtenKeys = new Set(ledger.keys);
  const importedDone = new Set(ledger.importedThreads);
  let kept = plan.kept.filter((e) => !writtenKeys.has(expKey(e)));
  let seenFor = new Set(); // `${normKey(company)}|${threadId}` already in reddit_imports
  const alreadyWritten = plan.kept.length - kept.length;

  if (!dry) {
    if (!has('skip-qa-gate')) {
      const qaLabel = argValue('qa-label', 'qa-reddit');
      const vp = join(RUNS_DIR, qaLabel, 'verdict.json');
      if (!readJsonMaybe(vp)?.pass) throw new Error(`QA gate: ${vp} missing or not PASS — run sample + qa-judge first (or pass --skip-qa-gate deliberately)`);
    }
    // Re-check reddit_imports right before writing (the live cron may have imported since fetch).
    const ids = [...new Set([...plan.processed].map((k) => `t3_${k.split('|')[1]}`))];
    const rows = [];
    for (let i = 0; i < ids.length; i += 100) {
      const inList = encodeURIComponent(`(${ids.slice(i, i + 100).join(',')})`);
      rows.push(...await sb(`reddit_imports?reddit_post_id=in.${inList}&select=reddit_post_id,company_name`));
    }
    seenFor = new Set(rows.map((r) => `${normKey(r.company_name)}|${r.reddit_post_id.replace(/^t3_/, '')}`));
    const before = kept.length;
    kept = kept.filter((e) => !seenFor.has(`${normKey(e.company)}|${e.thread_id}`));
    if (before !== kept.length) plan.dropped.already_in_reddit_imports = before - kept.length;
  }

  // Group by target; every successfully-processed thread gets a reddit_imports row (even with 0 kept).
  const groups = new Map();
  for (const [slug, cache] of caches) {
    const threads = cache.threads.filter((t) => plan.processed.has(`${slug}|${t.id}`));
    if (threads.length) groups.set(slug, { cache, threads, exps: [] });
  }
  for (const e of kept) groups.get(e.target_slug)?.exps.push(e);

  const summary = { label, dry_run: dry, generated_at: new Date().toISOString(), experiences_validated: plan.kept.length, already_written: alreadyWritten, to_write: kept.length, dropped: plan.dropped, failed_threads: plan.failed.size, companies: {}, errors: [] };
  for (const [, g] of groups) {
    if (!g.exps.length) continue;
    const outcomes = {};
    for (const e of g.exps) outcomes[e.outcome] = (outcomes[e.outcome] || 0) + 1;
    summary.companies[g.cache.target.writeName] = { kind: g.cache.target.kind, reports: g.exps.length, threads: g.threads.length, outcomes };
  }

  if (dry) {
    const rows = Object.entries(summary.companies).sort((a, b) => b[1].reports - a[1].reports);
    console.log(`[write] DRY RUN — would insert ${kept.length} reports across ${rows.length} companies (dropped: ${JSON.stringify(plan.dropped)})`);
    for (const [name, v] of rows) console.log(`  ${String(v.reports).padStart(4)}  ${name}  ${JSON.stringify(v.outcomes)}`);
    console.log('[write] samples:');
    for (const e of sampleN(kept, 10, 7)) console.log(`  · ${e.company} [${e.outcome}/${e.confidence}] r/${e.subreddit}: ${e.summary}`);
    writeJson(join(DIR, 'write-summary.json'), summary);
    return;
  }

  const { url } = sbEnv();
  const key = process.env.SUPABASE_SERVICE_KEY;
  const hdrs = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const recomputed = [];
  let inserted = 0;
  for (const [slug, g] of groups) {
    const t = g.cache.target;
    try {
      const firstReport = new Map();
      if (g.exps.length) {
        // Display spelling for a created companies row; resolve matches existing rows case-insensitively.
        const cid = await resolveOrCreateCompany(url, { ...hdrs, Prefer: 'return=representation' }, t.kind === 'agency' ? t.displayName : t.writeName);
        for (let i = 0; i < g.exps.length; i += 200) {
          const chunk = g.exps.slice(i, i + 200);
          const ins = await sb('reports?select=id', { method: 'POST', body: chunk.map((e) => buildReportRow(e, { companyId: cid })), prefer: 'return=representation' });
          if (!Array.isArray(ins) || ins.length !== chunk.length) throw new Error(`reports insert returned ${ins?.length} rows for ${chunk.length}`);
          inserted += chunk.length;
          chunk.forEach((e, j) => {
            ledger.keys.push(expKey(e));
            ledger.reports.push({ id: ins[j].id, key: expKey(e), company: e.company, permalink: e.permalink });
            if (!firstReport.has(e.thread_id)) firstReport.set(e.thread_id, ins[j].id);
          });
          writeJson(ledgerPath, ledger); // persist after every insert → a crash never double-writes
        }
      }
      const importRows = g.threads
        .filter((th) => !importedDone.has(`${slug}|${th.id}`) && !seenFor.has(`${normKey(t.writeName)}|${th.id}`))
        .map((th) => buildImportRow({ threadId: th.id, company: t.writeName, subreddit: th.subreddit, reportId: firstReport.get(th.id) || null, kept: g.exps.filter((e) => e.thread_id === th.id).length }));
      if (importRows.length) {
        // reddit_post_id is UNIQUE across companies: a thread already recorded for another company is left as is.
        await sb('reddit_imports?on_conflict=reddit_post_id', { method: 'POST', body: importRows, prefer: 'resolution=ignore-duplicates,return=minimal' });
        importRows.forEach((r) => ledger.importedThreads.push(`${slug}|${r.reddit_post_id.replace(/^t3_/, '')}`));
        writeJson(ledgerPath, ledger);
      }
      if (g.exps.length && await recomputeCompanyScoreFromReports(url, hdrs, t.writeName)) recomputed.push(t.writeName);
      if (g.exps.length) console.log(`  ${t.writeName}: ${g.exps.length} reports · ${importRows.length} import rows`);
    } catch (e) {
      summary.errors.push({ company: t.writeName, error: e.message });
      console.log(`  ${t.writeName}: ERROR ${e.message}`);
    }
  }
  summary.inserted = inserted;
  summary.recomputed = recomputed;
  writeJson(join(DIR, 'write-summary.json'), summary);
  console.log(`[write] inserted ${inserted}/${kept.length} reports across ${Object.keys(summary.companies).length} companies · recomputed ${recomputed.length} · errors ${summary.errors.length} · ledger ${ledgerPath}`);
}

async function main() {
  const cmd = process.argv[2];
  if (cmd === 'fetch') return fetchPhase();
  if (cmd === 'extract') return extractPhase();
  if (cmd === 'sample') return samplePhase();
  if (cmd === 'write') return writePhase();
  console.log('usage: node scripts/credit/reddit-backfill.mjs <fetch|extract|sample|write> [--dry-run] (see header)');
  process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e.message); process.exitCode = 1; });
}

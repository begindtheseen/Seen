// Company target selection for the breadth ("max fill") runs of web-reports.mjs and
// reddit-backfill.mjs fetch. Shared so both jobs pick the SAME companies in the SAME order.
//
// Order of the merged list (deduped on normKey, so "AutoZone" / "AutoZone, Inc." / "autozone" are one):
//   1. --targets-file entries, in file order (e.g. data/major-employers.json — the employers people
//      look up on day one, many of which have no company_scores row yet);
//   2. DEMAND: companies with the most current listings in `jobs` (availability_status = 'active' AND
//      expires_at > now — the same gate user search uses), counted from ONE paged read of only the
//      `company` column (PostgREST aggregates are disabled on this project: PGRST123, probed 2026-10-17);
//      lowercase one-token ATS slugs rank after every real display name (isSlugLike);
//   3. company_scores rows by report_count — pages that exist but have no current listings.
// Then: agencies (lib/agencies.ts — they have their own pass) and placeholder names are dropped, and
// any company that already holds ≥ skipIfReports first-party reports is skipped (it has data).
//
// Write-name rule (reports.company_name): an existing company_scores.company_name that matches one of
// the target's spellings EXACTLY (trim().toLowerCase()) wins, so recomputeCompanyScoreFromReports
// updates that row instead of splitting the company; otherwise the lowercase of the most common
// spelling (company pages decode their slug to exactly that). normKey (legal-suffix-stripped) is used
// ONLY to dedupe targets and to look up report counts — never to pick a write name, because it folds
// e.g. "compass group" into "compass".

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isValidCompanyName } from '../../../api/_utils/reportWrite.js';
import { normKey } from './reddit.mjs';
import { RUNS_DIR, readJsonOrNull } from './batch.mjs';

export const DEFAULT_SKIP_IF_REPORTS = 15;
export const DEMAND_CACHE_TTL_MS = 24 * 3600 * 1000;

const lower = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/** --targets-file JSON → [{ name, aliases[] }] (aliases lowercased, name first). Throws on a bad file. */
export function parseTargetsFile(json) {
  const list = Array.isArray(json) ? json : Array.isArray(json?.targets) ? json.targets : null;
  if (!list) throw new Error('targets file must be a JSON array of {name, aliases?}');
  const out = [];
  for (const [i, e] of list.entries()) {
    const name = typeof e === 'string' ? e : e?.name;
    if (!name || typeof name !== 'string' || !name.trim()) throw new Error(`targets file entry ${i} has no name`);
    const aliases = Array.isArray(e?.aliases) ? e.aliases.filter((a) => typeof a === 'string') : [];
    out.push({ name: name.trim(), aliases: [...new Set([lower(name), ...aliases.map(lower)].filter(Boolean))] });
  }
  return out;
}

export function loadTargetsFile(path) {
  return parseTargetsFile(JSON.parse(readFileSync(path, 'utf8')));
}

/** Rows [{company}] → Map normKey → { count, spellings: Map<display spelling, n> }. */
export function countJobCompanies(rows) {
  const m = new Map();
  for (const r of rows || []) {
    const raw = String(r?.company ?? '').trim().replace(/\s+/g, ' ');
    if (!raw) continue;
    const k = normKey(raw);
    if (!k) continue;
    let e = m.get(k);
    if (!e) { e = { count: 0, spellings: new Map() }; m.set(k, e); }
    e.count++;
    e.spellings.set(raw, (e.spellings.get(raw) || 0) + 1);
  }
  return m;
}

/** Every spelling is one lowercase token (an ATS board slug, not a display name). */
export const isSlugLike = (entry) => [...entry.spellings.keys()].every((s) => s === s.toLowerCase() && !/\s/.test(s));

const fpCount = (r) => Number(r?.first_party_report_count ?? r?.report_count ?? 0) || 0;

/**
 * Merge + rank. Inputs:
 *   fileTargets — parseTargetsFile output (may be [])
 *   jobCounts   — countJobCompanies output (may be empty)
 *   scoreRows   — company_scores rows {company_name, first_party_report_count, report_count}
 *   n           — max targets returned (null = all)
 *   skipIfReports — skip a company whose first-party report count (max over every company_scores
 *                   row with the same normKey) is ≥ this; 0 disables
 *   excludeKeys — normKeys never to return (agencies)
 *   valid       — extra name predicate (reddit uses isSearchableCompany)
 * Returns { targets: [{ name, writeName, aliases, keys, jobs, firstParty, origin }], skipped: {reason: n} }.
 */
export function rankCompanyTargets({ fileTargets = [], jobCounts = new Map(), scoreRows = [], n = null, skipIfReports = DEFAULT_SKIP_IF_REPORTS, excludeKeys = new Set(), valid = () => true } = {}) {
  const scoreByName = new Map();
  const fpByKey = new Map();
  for (const r of scoreRows) {
    const name = lower(r.company_name);
    if (!name) continue;
    const prev = scoreByName.get(name);
    if (!prev || fpCount(r) > fpCount(prev)) scoreByName.set(name, r);
    const k = normKey(name);
    if (k) fpByKey.set(k, Math.max(fpByKey.get(k) || 0, fpCount(r)));
  }
  const skipped = {};
  const bump = (why) => { skipped[why] = (skipped[why] || 0) + 1; };
  const taken = new Set();
  const out = [];

  const consider = ({ name, spellings, origin, jobs }) => {
    const aliases = [...new Set(spellings.map(lower).filter(Boolean))];
    const keys = [...new Set(aliases.map(normKey).filter(Boolean))];
    if (!keys.length || !isValidCompanyName(name) || !valid(name)) { bump('invalid_name'); return; }
    if (keys.some((k) => taken.has(k))) { bump('duplicate'); return; }
    keys.forEach((k) => taken.add(k));
    if (keys.some((k) => excludeKeys.has(k))) { bump('agency'); return; }
    const firstParty = Math.max(0, ...keys.map((k) => fpByKey.get(k) || 0));
    if (skipIfReports > 0 && firstParty >= skipIfReports) { bump('has_reports'); return; }
    // Existing exact company_scores spelling (most first-party reports) beats the default.
    let writeName = aliases[0];
    let best = -1;
    for (const a of aliases) { const r = scoreByName.get(a); if (r && fpCount(r) > best) { best = fpCount(r); writeName = a; } }
    out.push({ name, writeName, aliases: [writeName, ...aliases.filter((a) => a !== writeName)], keys, jobs: jobs || 0, firstParty, origin });
  };

  for (const t of fileTargets) {
    const k = normKey(t.name);
    consider({ name: t.name, spellings: t.aliases.length ? t.aliases : [t.name], origin: 'file', jobs: jobCounts.get(k)?.count || 0 });
  }
  // ATS board slugs ("ivcevidensia", "gongio", "geniussportssn" — 352 companies / 6.4k of 23.5k current
  // listings on 2026-10-17) top a raw listing count but are names nobody searches for and often aren't
  // the real name, so they rank AFTER every company that has a real display spelling.
  const demand = [...jobCounts.entries()].sort((a, b) => (isSlugLike(a[1]) - isSlugLike(b[1])) || b[1].count - a[1].count || a[0].localeCompare(b[0]));
  for (const [, e] of demand) {
    const spellings = [...e.spellings.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([s]) => s);
    consider({ name: spellings[0], spellings, origin: 'jobs', jobs: e.count });
  }
  const scored = [...scoreRows].sort((a, b) => (Number(b.report_count) || 0) - (Number(a.report_count) || 0) || lower(a.company_name).localeCompare(lower(b.company_name)));
  for (const r of scored) consider({ name: lower(r.company_name), spellings: [r.company_name], origin: 'company_scores', jobs: 0 });

  return { targets: n == null ? out : out.slice(0, n), skipped, candidates: out.length };
}

// ---------- I/O (thin; everything above is pure + unit-tested) ----------

/**
 * Current-listing company column from `jobs`, paged by offset over a company-sorted read. Selecting
 * ONLY `company` keeps egress to ~40 bytes/row. Offset paging over an ORDER BY company read is exact
 * for counting: the sorted sequence of values is unique, so ties swapping places across page edges
 * cannot change any count. Cached in .credit-runs/demand-cache.json for 24h (both jobs reuse it).
 */
export async function loadJobCompanyRows({ sbAll, refresh = false, now = Date.now(), log = console.log, cachePath = join(RUNS_DIR, 'demand-cache.json') } = {}) {
  const path = cachePath;
  const cached = refresh ? null : readJsonOrNull(path);
  if (cached && now - Date.parse(cached.fetchedAt) < DEMAND_CACHE_TTL_MS && Array.isArray(cached.rows)) {
    log(`[targets] jobs demand: ${cached.rows.length.toLocaleString()} listings from cache (${cached.fetchedAt}; --refresh-demand to re-read)`);
    return cached.rows;
  }
  const iso = new Date(now).toISOString();
  const rows = await sbAll(`jobs?select=company&availability_status=eq.active&expires_at=gt.${encodeURIComponent(iso)}&company=not.is.null&order=company.asc`, { pageSize: 1000 });
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ fetchedAt: iso, rows }));
  log(`[targets] jobs demand: read ${rows.length.toLocaleString()} current listings (company column only)`);
  return rows;
}

/** Every company_scores row (≈1k on prod, 2026-10-17). first_party_report_count is migration 063; falls back if absent. */
export async function loadScoreRows({ sbAll }) {
  try {
    return await sbAll('company_scores?select=company_name,first_party_report_count,report_count&order=company_name.asc');
  } catch {
    return sbAll('company_scores?select=company_name,report_count&order=company_name.asc');
  }
}

/** Everything a CLI needs: read inputs once, rank, print a one-line summary. */
export async function selectCompanyTargets({ sbAll, n, fileTargets = [], skipIfReports = DEFAULT_SKIP_IF_REPORTS, excludeKeys, valid, useDemand = true, refreshDemand = false, cachePath, log = console.log }) {
  const [jobRows, scoreRows] = await Promise.all([
    useDemand ? loadJobCompanyRows({ sbAll, refresh: refreshDemand, log, ...(cachePath ? { cachePath } : {}) }) : [],
    loadScoreRows({ sbAll }),
  ]);
  const jobCounts = countJobCompanies(jobRows);
  const r = rankCompanyTargets({ fileTargets, jobCounts, scoreRows, n, skipIfReports, excludeKeys, valid });
  const by = r.targets.reduce((m, t) => ({ ...m, [t.origin]: (m[t.origin] || 0) + 1 }), {});
  log(`[targets] ${r.targets.length} company targets (${JSON.stringify(by)}) from ${r.candidates} candidates · ${jobCounts.size.toLocaleString()} companies with current listings · skipped ${JSON.stringify(r.skipped)}`);
  return r.targets;
}

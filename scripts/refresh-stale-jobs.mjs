#!/usr/bin/env node
// Automated Job Refresh — re-check the stale/expired backlog for real liveness and correct
// each row's status, shrinking the "stale jobs" KPI
// (api/admin-stats.js › stale_or_expired = count of availability_status IN (stale,expired)).
//
// Jobs go `stale` purely by AGE (api/refresh-jobs.js › markStaleJobs: last_seen_at > 7d → stale,
// > 14d → expired). The only path back to `active` is a keyword re-ingest happening to re-surface
// the exact listing — which never reaches the long tail of still-open postings. This script closes
// that gap: it fetches each stale listing's own apply_url and re-derives status from the response
// (see lib/server/staleRefresh.js for the full rationale + write semantics):
//   • live    (2xx, no "posting gone" marker) → back to `active` (+ last_seen_at/last_checked_at/
//               expires_at bumped, EXACTLY like the ingest's re-confirmation) — leaves the KPI.
//   • dead    (404/410, or a 2xx page that says it's gone) → `expired` (expires_at=now) so the
//               next refresh-jobs cron's deleteExpired() purges it.
//   • unknown (403/429/5xx/timeout) → left untouched. We never guess on a blocked fetch.
//
// SAFE BY DEFAULT: dry-run unless you pass --apply. Dry-run does ZERO writes — it fetches +
// classifies + prints what it WOULD change and the projected KPI. (This is the inverse of
// scripts/rescore-jobs.mjs, whose default is apply; a bulk status writer should be opt-in.)
//
// SCHEDULING: the sibling cron api/refresh-stale-jobs.js runs this engine on a daily Vercel cron
// (vercel.json), env-gated to dry-run until STALE_REFRESH_APPLY=1 is set — so merging is inert
// until the owner turns it on. This script is the manual / full-backlog runner (no 60s serverless
// cap), and is what reproduces the "reduce stale by 20%" result in one pass.
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node scripts/refresh-stale-jobs.mjs             # DRY RUN (default)
//   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node scripts/refresh-stale-jobs.mjs --apply     # perform writes
//   ... node scripts/refresh-stale-jobs.mjs --limit 200 --concurrency 12 --timeout 10000      # tuning knobs

import { refreshStaleJobs } from '../lib/server/staleRefresh.js';

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const APPLY = process.argv.includes('--apply');

function argN(flag, def) {
  const i = process.argv.indexOf(flag);
  if (i === -1 || i === process.argv.length - 1) return def;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) ? v : def;
}

if (!URL || !KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_KEY in the environment.');
  process.exit(1);
}

const limit = argN('--limit', 0); // 0 = the whole backlog
const concurrency = argN('--concurrency', 10);
const timeoutMs = argN('--timeout', 12000);

console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — re-checking stale/expired listings${limit ? ` (first ${limit})` : ''} @ ${concurrency} concurrent, ${timeoutMs}ms timeout\n`);

const summary = await refreshStaleJobs({
  url: URL, key: KEY, apply: APPLY, limit, concurrency, timeoutMs,
  onProgress: ({ done, total }) => process.stdout.write(`\rchecked ${done}/${total}`),
});

console.log('\n');
console.log(`Stale/expired KPI before: ${summary.kpiBefore}`);
console.log(`Re-checked:               ${summary.scanned}`);
console.log(`  live  → reactivate:     ${summary.live}`);
console.log(`  dead  → expire:         ${summary.dead}`);
console.log(`  unknown → leave:        ${summary.unknown}  (blocked / ambiguous — untouched)`);

if (APPLY) {
  console.log(`\nReactivated (→ active):   ${summary.reactivated}`);
  console.log(`Expired (→ purge queue):  ${summary.expired}`);
  console.log(`Stale/expired KPI after:  ${summary.kpiAfter}`);
  if (summary.kpiBefore) {
    const drop = summary.kpiBefore - summary.kpiAfter;
    console.log(`KPI reduced by:           ${drop} (${((drop / summary.kpiBefore) * 100).toFixed(1)}%)`);
  }
} else {
  console.log(`\nProjected KPI after apply: ${summary.kpiProjectedAfter} (reactivations leave the stale set immediately)`);
  if (summary.kpiBefore) {
    const drop = summary.live;
    console.log(`Projected reduction:       ${drop} (${((drop / summary.kpiBefore) * 100).toFixed(1)}%)  — re-run with --apply to perform it`);
  }
}

const show = (label, rows) => {
  if (!rows.length) return;
  console.log(`\n${label}`);
  for (const r of rows) console.log(`  [${r.status}] ${(r.company || '?').slice(0, 28).padEnd(28)} ${(r.title || '').slice(0, 46)}`);
};
show('Sample — would reactivate (live):', summary.sampleLive);
show('Sample — would expire (dead):', summary.sampleDead);

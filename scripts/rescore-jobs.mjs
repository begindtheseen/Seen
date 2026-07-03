#!/usr/bin/env node
// One-time backfill: re-score every listing in the `jobs` table with the CURRENT canonical
// scorer (lib/server/jobScore.js), replacing scores written by the old thin scorer.
//
// WHY: before 2026-07-03 every listing was scored by a thin function that returned a bare 65
// for any unknown company and a flat waste_score of 25 for ~all of them — a number for no
// reason. The scorer now grades each listing from signals present in the POSTING itself
// (source/ATS, salary disclosure, description quality, red-flag titles), and every point is
// explainable. New and re-ingested listings already get honest scores; this script converges
// the EXISTING corpus immediately instead of waiting the ~14-day natural expiry/re-ingest.
//
// It recomputes purely from columns already stored on each row — it makes NO external calls
// and invents nothing. salary_min (used only for the ">$120k" nudge, not a stored column) is
// reconstructed from the salary STRING so the backfill matches ingest-time scoring.
//
// Idempotent: re-running only PATCHes rows whose stored score/waste_score differ from the
// recomputation, so a second run is a near-total no-op.
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node scripts/rescore-jobs.mjs          # apply
//   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node scripts/rescore-jobs.mjs --dry-run # report only

import { scoreJob, wasteScore } from '../lib/server/jobScore.js';

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const DRY = process.argv.includes('--dry-run');

if (!URL || !KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_KEY in the environment.');
  process.exit(1);
}

const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const PAGE = 500;

// Reconstruct the lower salary bound from the stored display string so the >$120k signal
// fires exactly as it did at ingest. Handles "$180k", "$180k–$220k", "$45/hr". Returns 0 when
// no annual figure is recoverable (hourly/blank) — the scorer then simply skips that nudge.
function salaryMinFromString(salary) {
  if (!salary) return 0;
  const s = String(salary);
  const k = s.match(/\$\s*([\d,.]+)\s*k/i);      // "$180k"
  if (k) return Math.round(parseFloat(k[1].replace(/,/g, '')) * 1000);
  const hr = /\/\s*hr/i.test(s);
  const n = s.match(/\$\s*([\d,]+)/);            // "$120000"
  if (n && !hr) { const v = parseInt(n[1].replace(/,/g, ''), 10); return Number.isFinite(v) ? v : 0; }
  return 0;
}

async function main() {
  let offset = 0, scanned = 0, changed = 0, unchanged = 0;
  const examples = [];

  for (;;) {
    const res = await fetch(
      `${URL}/rest/v1/jobs?select=id,title,company,location,salary,source,type,description,score,waste_score&order=id&offset=${offset}&limit=${PAGE}`,
      { headers: H, signal: AbortSignal.timeout(30000) },
    );
    if (!res.ok) { console.error(`Read failed at offset ${offset}: HTTP ${res.status}`); process.exit(1); }
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) break;

    for (const j of rows) {
      scanned++;
      const salary_min = salaryMinFromString(j.salary);
      const nextScore = scoreJob({ ...j, salary_min });
      const nextWaste = wasteScore({ ...j, salary_min });
      if (nextScore === j.score && nextWaste === j.waste_score) { unchanged++; continue; }
      changed++;
      if (examples.length < 12) examples.push({ id: j.id, company: j.company, from: `${j.score}/${j.waste_score}`, to: `${nextScore}/${nextWaste}` });
      if (!DRY) {
        const up = await fetch(`${URL}/rest/v1/jobs?id=eq.${encodeURIComponent(j.id)}`, {
          method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' },
          body: JSON.stringify({ score: nextScore, waste_score: nextWaste }),
          signal: AbortSignal.timeout(30000),
        });
        if (!up.ok) console.warn(`  PATCH failed for ${j.id}: HTTP ${up.status}`);
      }
    }
    process.stdout.write(`\rscanned ${scanned} · would-change ${changed} · unchanged ${unchanged}`);
    offset += rows.length;
    if (rows.length < PAGE) break;
  }

  console.log(`\n\n${DRY ? 'DRY RUN — no writes.' : 'Backfill applied.'}`);
  console.log(`Scanned:   ${scanned}`);
  console.log(`${DRY ? 'Would change' : 'Changed'}: ${changed}`);
  console.log(`Unchanged: ${unchanged}`);
  if (examples.length) {
    console.log('\nSample (score/waste  old → new):');
    for (const e of examples) console.log(`  ${e.company.padEnd(24).slice(0, 24)}  ${e.from.padStart(7)} → ${e.to}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });

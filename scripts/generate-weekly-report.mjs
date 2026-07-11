#!/usr/bin/env node
// Weekly progress report — REAL numbers from the live database, no placeholders.
//
// Counts the last 7 days against the 7 days before across the product's core tables and prints a
// markdown report (optionally writes it with --out <path>). Read-only: every query is a PostgREST
// count-only request (Range 0-0), so running this can never mutate anything.
//
// A table that is missing or unreadable degrades to "n/a" for its rows instead of failing the whole
// report — the report is honest about what it could and couldn't read.
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node scripts/generate-weekly-report.mjs
//   ... node scripts/generate-weekly-report.mjs --out reports/weekly-2026-07-10.md

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
if (!URL || !KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_KEY in the environment.');
  process.exit(1);
}
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

const DAY = 24 * 60 * 60 * 1000;
const now = new Date();
const weekAgo = new Date(now.getTime() - 7 * DAY).toISOString();
const twoWeeksAgo = new Date(now.getTime() - 14 * DAY).toISOString();

// Count rows matching `filter` without fetching them (content-range carries the exact total).
async function count(table, filter = '') {
  const res = await fetch(`${URL}/rest/v1/${table}?select=id${filter ? `&${filter}` : ''}`, {
    headers: { ...H, Prefer: 'count=exact', 'Range-Unit': 'items', Range: '0-0' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const total = Number((res.headers.get('content-range') || '').split('/')[1]);
  if (!Number.isFinite(total)) throw new Error('no count in response');
  return total;
}

// One metric row: total, last 7 days, and the 7 days before (for the trend arrow). Tables without
// a created_at column report total-only; unreadable tables report n/a — never a fake number.
async function metric(label, table) {
  const row = { label, total: 'n/a', week: 'n/a', prior: 'n/a' };
  try { row.total = await count(table); } catch (e) { row.note = `unreadable (${e.message})`; return row; }
  try {
    row.week = await count(table, `created_at=gte.${weekAgo}`);
    row.prior = await count(table, `created_at=gte.${twoWeeksAgo}&created_at=lt.${weekAgo}`);
  } catch { row.note = 'no created_at — total only'; }
  return row;
}

const arrow = (week, prior) => (typeof week !== 'number' || typeof prior !== 'number') ? ''
  : week > prior ? ` ▲ +${week - prior}` : week < prior ? ` ▼ ${week - prior}` : ' — flat';

async function main() {
  const rows = [];
  for (const [label, table] of [
    ['Users (profiles)', 'profiles'],
    ['Ghost reports', 'reports'],
    ['Applications tracked', 'applications'],
    ['Companies tracked', 'companies'],
    ['Companies scored (Ghost Index)', 'company_scores'],
    ['Job listings', 'jobs'],
  ]) rows.push(await metric(label, table));

  const stamp = now.toISOString().slice(0, 10);
  const lines = [
    `# Seen — weekly progress report (${stamp})`,
    '',
    `Window: last 7 days (since ${weekAgo.slice(0, 10)}), trend vs the 7 days before.`,
    '',
    '| Metric | Total | This week | Prior week | Trend |',
    '|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.label} | ${r.total} | ${r.week} | ${r.prior} |${arrow(r.week, r.prior)}${r.note ? ` _${r.note}_` : ''} |`),
    '',
    '_Read-only report generated from live data by scripts/generate-weekly-report.mjs — no placeholders._',
  ];
  const md = lines.join('\n');
  console.log(md);

  const outIdx = process.argv.indexOf('--out');
  if (outIdx !== -1 && process.argv[outIdx + 1]) {
    const { writeFileSync, mkdirSync } = await import('node:fs');
    const { dirname } = await import('node:path');
    mkdirSync(dirname(process.argv[outIdx + 1]), { recursive: true });
    writeFileSync(process.argv[outIdx + 1], md + '\n');
    console.error(`\nwritten → ${process.argv[outIdx + 1]}`);
  }
}

main().catch((e) => { console.error(`weekly report failed: ${e.message}`); process.exit(1); });

#!/usr/bin/env node
// Apply one SQL migration file to the production Supabase project via the Management API.
//   node scripts/credit/apply-migration.mjs supabase/migrations/20261017120000_job_enrichment.sql [--yes]
// Needs SUPABASE_URL (to derive the project ref) and SUPABASE_ACCESS_TOKEN (a personal access token).
// Without --yes it only prints what it would run. The migrations in this folder are additive and
// idempotent (IF NOT EXISTS), and CLAUDE.md's rule still applies: deploy code that tolerates the
// schema BEFORE relying on it — these new tables are only read by code that no-ops when they're absent.

import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file || !file.endsWith('.sql')) { console.error('usage: apply-migration.mjs <file.sql> [--yes]'); process.exit(1); }
const sql = readFileSync(file, 'utf8');
const ref = new URL(process.env.SUPABASE_URL || 'https://missing.supabase.co').hostname.split('.')[0];

if (!process.argv.includes('--yes')) {
  console.log(`Would apply ${file} (${sql.length} chars) to project ${ref}. Re-run with --yes.`);
  process.exit(0);
}
if (!process.env.SUPABASE_ACCESS_TOKEN || !process.env.SUPABASE_URL) {
  console.error('SUPABASE_ACCESS_TOKEN and SUPABASE_URL must be set'); process.exit(1);
}
const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: sql }),
});
const text = await res.text();
if (!res.ok) { console.error(`failed: HTTP ${res.status} ${text.slice(0, 400)}`); process.exit(1); }
console.log(`applied ${file} → HTTP ${res.status}`);

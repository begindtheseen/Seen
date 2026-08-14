#!/usr/bin/env node
// memory-status — print a COMPACT situational briefing for the current session.
//
// The whole point: a session shouldn't re-read 150 KB of docs to remember where things stand.
// This prints a ~1 KB high-signal orientation — what changed since last session, what still needs
// work, what's shaky — straight into context. That's the token save: recall, not re-read.
//
// Used by the SessionStart hook (.claude/hooks/session-start.sh) and mirrored by the
// memory_status MCP tool. Usage: node scripts/memory-status.mjs   (or npm run memory:status)

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIndex, buildBriefing } from '../lib/server/memoryGraph.js';
import { fetchNotes, cloudConfigured } from '../lib/server/brainCloud.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const VAULT = resolve(process.env.CHRONOS_VAULT || join(HERE, '..', 'memory'));

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === '.graph' || name === '.obsidian') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (name.endsWith('.md')) acc.push(full);
  }
  return acc;
}

export function renderBriefing(index, today) {
  const b = buildBriefing(index, { today });
  const L = [];
  L.push(`🧠 Chronos memory — session briefing (${today})`);
  L.push(`Recall, don't re-read. Full map: memory/HOME.md · loop: memory/protocol.md · decide: memory/decision-protocol.md`);
  L.push(`${b.counts.notes} notes · ${b.counts.currentFacts} current facts · ${b.counts.openThreads} open threads`);

  const add = b.changed.added, inv = b.changed.invalidated;
  if (add.length || inv.length) {
    L.push(`\n▸ Changed since ${b.since}:`);
    add.slice(0, 8).forEach((f) => L.push(`  + ${f.subject} ${f.predicate} → ${f.object}`));
    inv.slice(0, 8).forEach((f) => L.push(`  ~ ${f.subject} ${f.predicate} → ${f.object} (retired)`));
  }

  if (b.openThreads.length) {
    L.push(`\n▸ Still needs work (${b.openThreads.length}):`);
    b.openThreads.slice(0, 10).forEach((t) => L.push(`  [${t.priority}] ${t.title}${t.area ? ` (${t.area})` : ''}${t.status === 'blocked' ? ' — BLOCKED' : ''}`));
  }

  if (b.contradictions.length || b.lowConfidence.length) {
    L.push(`\n▸ Verify before trusting:`);
    b.contradictions.slice(0, 5).forEach((c) => L.push(`  ! conflict: ${c.a.subject} ${c.a.predicate} = "${c.a.object}" vs "${c.b.object}"`));
    b.lowConfidence.slice(0, 5).forEach((f) => L.push(`  ? low-confidence: ${f.subject} ${f.predicate} → ${f.object}`));
  }

  L.push(`\nBefore deciding, follow memory/decision-protocol.md. At session end: supersede changed facts, close/open threads, npm run memory:sync.`);
  return L.join('\n');
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const today = new Date().toISOString().slice(0, 10);
  // Source of truth: a cloud/repo-connected session reads the ALWAYS-ON online brain
  // through the gateway (the local vault under memory/ is stale or absent there); a
  // local Mac session reads the vault files. Mirrors the chronos MCP server's
  // resolveCloud(): CHRONOS_SOURCE forces local/cloud, else auto → cloud when brain
  // creds (all four identity-gateway values, or direct Supabase) are present.
  const useCloud = process.env.CHRONOS_SOURCE !== 'local' && cloudConfigured();
  const notes = useCloud
    ? await fetchNotes()
    : walk(VAULT).map((f) => ({ path: relative(VAULT, f).replace(/\\/g, '/'), text: readFileSync(f, 'utf8') }));
  process.stdout.write(renderBriefing(buildIndex(notes), today) + '\n');
}

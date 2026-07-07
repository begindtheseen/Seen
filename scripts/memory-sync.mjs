#!/usr/bin/env node
// memory-sync — derive the Chronos graph index from the Obsidian vault (memory/).
//
// The vault is the SINGLE SOURCE OF TRUTH; this script produces a DERIVED, rebuildable index
// under memory/.graph/. It never edits the vault. Run it at session end (or any time) to
// refresh the index the local MCP server (memory/mcp/server.mjs) queries — and to emit the
// exact payloads a Graphiti engine would ingest later (facts → add_triplet, episodes →
// add_episode), so the same vault feeds both the local layer now and the graph engine later.
//
// Deterministic: typed `facts:` are read straight from frontmatter — NO LLM call. (An optional
// prose→fact LLM pass via lib/server/llm.js is intentionally left off by default to control cost.)
//
// Usage:
//   node scripts/memory-sync.mjs [--vault memory] [--out memory/.graph] [--check]
//   --check  validate + print stats, do NOT write (for CI / pre-commit)

import { readdirSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { buildIndex, searchFacts, findContradictions } from '../lib/server/memoryGraph.js';

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : def;
}
const CHECK = process.argv.includes('--check');
const VAULT = resolve(arg('vault', 'memory'));
const OUT = resolve(arg('out', join(arg('vault', 'memory'), '.graph')));

// Walk the vault for .md files, skipping the derived index and Obsidian config.
function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === '.graph' || name === '.obsidian') continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, acc);
    else if (name.endsWith('.md')) acc.push(full);
  }
  return acc;
}

function main() {
  const files = walk(VAULT);
  const notes = files.map((f) => ({ path: relative(VAULT, f).replace(/\\/g, '/'), text: readFileSync(f, 'utf8') }));
  const index = buildIndex(notes);

  if (index.errors.length) {
    console.error(`\n✖ ${index.errors.length} fact validation error(s):`);
    for (const e of index.errors) console.error(`  - ${e}`);
  }
  const contradictions = findContradictions(index.facts);
  const currentFacts = searchFacts(index.facts, {}); // valid right now

  const stats = {
    notes: notes.length,
    facts: index.facts.length,
    currentFacts: currentFacts.length,
    historicalFacts: index.facts.length - currentFacts.length,
    episodes: index.episodes.length,
    edges: index.edges.length,
    entities: index.entities.length,
    contradictions: contradictions.length,
    errors: index.errors.length,
  };

  console.log('\nChronos memory-sync');
  console.log('─'.repeat(40));
  for (const [k, v] of Object.entries(stats)) console.log(`  ${k.padEnd(16)} ${v}`);
  if (contradictions.length) {
    console.log('\n⚠ contradictions (same subject+predicate, overlapping validity):');
    for (const c of contradictions) console.log(`  - ${c.a.subject} ${c.a.predicate}: "${c.a.object}" vs "${c.b.object}"`);
  }

  if (CHECK) {
    if (index.errors.length) { process.exitCode = 1; }
    console.log('\n(--check: no files written)');
    return;
  }

  mkdirSync(OUT, { recursive: true });
  const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '');
  writeFileSync(join(OUT, 'facts.jsonl'), jsonl(index.facts));
  writeFileSync(join(OUT, 'episodes.jsonl'), jsonl(index.episodes));
  writeFileSync(join(OUT, 'edges.jsonl'), jsonl(index.edges));
  writeFileSync(join(OUT, 'entities.jsonl'), jsonl(index.entities));
  writeFileSync(join(OUT, 'index.json'), JSON.stringify({ generatedFromVault: relative(process.cwd(), VAULT), stats, ...index }, null, 2));
  console.log(`\n✔ wrote derived index → ${relative(process.cwd(), OUT)}/ (facts, episodes, edges, entities .jsonl + index.json)`);
}

main();

#!/usr/bin/env node
// brain — one CLI for every Chronos brain call a session makes, so no session hand-writes
// `node -e "import(...)"` snippets. Wraps lib/server/brainCloud.js (gateway in cloud, direct on a
// trusted Mac); identity and credentials come only from the environment, never from arguments.
//
//   node scripts/brain.mjs status                              compact briefing (= npm run memory:status)
//   node scripts/brain.mjs ping                                 transport + counts (connectivity self-test)
//   node scripts/brain.mjs search --query X [--subject S] [--predicate P] [--as-of YYYY-MM-DD] [--limit N]
//   node scripts/brain.mjs fact --subject S --predicate P --object O [--confidence high|medium|low] [--source S] [--note N]
//   node scripts/brain.mjs timeline --heading H --text T [--date YYYY-MM-DD]
//   node scripts/brain.mjs contradictions
//
// `--text -` / `--object -` / `--note -` read that value from stdin (for long multi-line episodes).
// Exit 0 on success; non-zero with the gateway's error on failure. Output is JSON (except status).

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  cloudConfigured, gatewayConfigured, cloudCounts, searchFactsCloud,
  recordFactCloud, appendTimelineCloud, contradictionsCloud,
} from '../lib/server/brainCloud.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const [cmd, ...rest] = process.argv.slice(2);

function parseFlags(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new Error(`unexpected argument: ${a}`);
    const key = a.slice(2);
    const val = argv[i + 1];
    if (val === undefined || val.startsWith('--')) throw new Error(`--${key} needs a value`);
    out[key] = val === '-' ? readFileSync(0, 'utf8').trim() : val;
    i++;
  }
  return out;
}

function need(flags, ...keys) {
  const missing = keys.filter((k) => !flags[k] || !String(flags[k]).trim());
  if (missing.length) throw new Error(`${cmd} needs ${missing.map((k) => `--${k}`).join(', ')}`);
}

const today = () => new Date().toISOString().slice(0, 10);
const print = (v) => console.log(JSON.stringify(v, null, 2));

async function main() {
  if (cmd === 'status') {
    const r = spawnSync(process.execPath, [join(HERE, 'memory-status.mjs')], { stdio: 'inherit' });
    process.exit(r.status ?? 1);
  }
  if (!cmd || cmd === 'help' || cmd === '--help') {
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(4, 13).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
    return;
  }
  if (!cloudConfigured()) {
    throw new Error('brain not configured — needs BRAIN_API_URL + BRAIN_API_TOKEN + BRAIN_CLIENT + BRAIN_CLIENT_TOKEN (gateway) or SUPABASE_URL + SUPABASE_SERVICE_KEY (direct)');
  }
  if (gatewayConfigured() && process.env.BRAIN_CLIENT.trim() !== 'claude-seenjobs') {
    throw new Error(`BRAIN_CLIENT is "${process.env.BRAIN_CLIENT.trim()}" — this repo must identify as exactly claude-seenjobs`);
  }
  const f = parseFlags(rest);

  switch (cmd) {
    case 'ping':
      return print({ transport: gatewayConfigured() ? 'gateway' : 'direct', counts: await cloudCounts() });
    case 'search': {
      if (!f.query && !f.subject && !f.predicate) throw new Error('search needs at least one of --query, --subject, --predicate');
      const filters = {};
      for (const k of ['query', 'subject', 'predicate']) if (f[k]) filters[k] = f[k];
      if (f['as-of']) filters.as_of = f['as-of'];
      if (f.limit) filters.limit = Number(f.limit);
      return print(await searchFactsCloud(filters));
    }
    case 'fact': {
      need(f, 'subject', 'predicate', 'object');
      const fact = { subject: f.subject, predicate: f.predicate, object: f.object };
      if (f.confidence) fact.confidence = f.confidence; // high | medium | low
      if (f.source) fact.source = f.source;
      return print(await recordFactCloud(fact, { note: f.note }));
    }
    case 'timeline':
      need(f, 'heading', 'text');
      return print(await appendTimelineCloud(f.date || today(), f.heading, f.text));
    case 'contradictions':
      return print(await contradictionsCloud());
    default:
      throw new Error(`unknown command "${cmd}" — try: status | ping | search | fact | timeline | contradictions`);
  }
}

main().catch((e) => { console.error(`brain: ${e.message}`); process.exit(1); });

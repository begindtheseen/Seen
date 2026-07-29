#!/usr/bin/env node
// brain-repair — one-time repair for facts corrupted by the OLD (asymmetric) Chronos serializer.
//
// THE BUG IT REPAIRS: writeFact.js emitted double-quoted scalars with JSON.stringify (escaping `"`
// and `\`) while memoryGraph.js's parseScalar stripped the surrounding quotes WITHOUT unescaping.
// So parse(write(x)) !== x, and because applyFact re-emits a note's ENTIRE facts block on every
// write, each write re-escaped every neighbouring fact. Backslashes before a quote compounded
// n → 2n+1 per cycle (1, 3, 7, 15, 31 … 511, 1023). Both sides are fixed now; this script cleans up
// the values already stored in the brain.
//
// HOW IT REPAIRS — proof, never guesswork. `historicalCycle` reproduces the old lossy round-trip
// exactly; `uncorruptOnce` inverts one cycle and then RE-APPLIES the cycle to check it reproduces
// the input byte-for-byte. A step that can't be proven that way is refused, and a value whose
// escaping is genuinely ambiguous is SKIPPED and reported — never silently guessed at.
//
// SAFETY / SECRETS: dry-run by default. `--apply` against the brain requires DIRECT Supabase creds
// (the Mac / service-key environment). A cloud session holds only the gateway token, which this
// script uses for the READ-ONLY `notes` op to produce the dry-run report — it can never write.
// No token, key, or URL is ever printed.
//
// Usage:
//   node scripts/brain-repair.mjs                     # dry run against the brain (auto transport)
//   node scripts/brain-repair.mjs --vault memory      # dry run against local vault files
//   node scripts/brain-repair.mjs --apply             # repair the brain (service-key env only)
//   node scripts/brain-repair.mjs --vault memory --apply
//   flags: --note <path>  --include-single-cycle  --json  --verbose

import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter, normalizeFacts } from '../lib/server/memoryGraph.js';
import { rewriteFactsBlock } from '../lib/server/writeFact.js';

// ---------------------------------------------------------------------------
// PURE CORE (unit-tested in lib/server/brainRepair.test.mjs — no I/O, no creds)
// ---------------------------------------------------------------------------

// Fields a fact stores as free text, i.e. the ones the old serializer could corrupt.
export const REPAIRABLE_FIELDS = ['subject', 'predicate', 'object', 'source'];

// The OLD lossy round-trip, reproduced exactly: escape on write, DON'T unescape on read.
export const historicalCycle = (v) => JSON.stringify(String(v)).slice(1, -1);

// Compounding signature. `\\`+ = a run of >=2 backslashes; `\+"` = backslash(es) before a quote.
const RUN_OF_BACKSLASHES = /\\{2,}/;
const PATHOLOGICAL = /\\{2,}|\\+"/;
export const looksPathological = (s) => PATHOLOGICAL.test(String(s ?? ''));

// Invert ONE lossy cycle, or return null. The `historicalCycle(out) === s` check is a proof that
// `s` is exactly in the image of the cycle: a non-canonical escape (`\q`, `\/`, `A`, a lone
// trailing `\`) fails it and we refuse rather than guess.
export function uncorruptOnce(s) {
  let out;
  try { out = JSON.parse(`"${s}"`); } catch { return null; }
  return historicalCycle(out) === s ? out : null;
}

// Peel verified cycles while backslashes remain. Stops the moment a step can't be proven.
export function collapseEscapes(s, { maxCycles = 64 } = {}) {
  let value = String(s ?? '');
  let cycles = 0;
  while (cycles < maxCycles && value.includes('\\')) {
    const next = uncorruptOnce(value);
    if (next === null || next === value) break;
    value = next;
    cycles += 1;
  }
  return { value, cycles };
}

// Classify + repair one field value.
//   clean       — no compounding signature; nothing to do.
//   repaired    — CERTAIN corruption (a run of >=2 backslashes, or >=2 verified cycles); safe to apply.
//   review      — a single `\"` and no `\\` run: exactly one lossy cycle OR an author who literally
//                 typed a backslash-quote. NOT distinguishable, so it is reported and skipped unless
//                 the operator opts in with --include-single-cycle.
//   ambiguous   — the escaping is not a canonical re-escape, or doesn't converge. Never applied.
export function diagnoseValue(raw) {
  const before = String(raw ?? '');
  if (!looksPathological(before)) return { status: 'clean', before, after: before, cycles: 0 };

  const { value: after, cycles } = collapseEscapes(before);
  if (cycles === 0) {
    return { status: 'ambiguous', before, after: before, cycles: 0,
      reason: 'backslashes are not a canonical re-escape of any value — refusing to guess' };
  }
  if (looksPathological(after)) {
    return { status: 'ambiguous', before, after: before, cycles,
      reason: `still compounded after ${cycles} verified cycle(s) — refusing to guess` };
  }
  if (cycles === 1 && !RUN_OF_BACKSLASHES.test(before)) {
    return { status: 'review', before, after, cycles,
      reason: 'single \\" with no compounded run — could be one lossy cycle OR an intentional literal backslash' };
  }
  return { status: 'repaired', before, after, cycles };
}

// Diagnose every repairable field of every fact in one note.
// Returns { findings, facts, changed } — `facts` carries the repaired values when applyable.
export function diagnoseNote(text, notePath, { includeSingleCycle = false } = {}) {
  const { facts } = normalizeFacts(parseFrontmatter(text).data, notePath);
  const findings = [];
  let changed = 0;
  const repaired = facts.map((f) => {
    const out = { ...f };
    for (const field of REPAIRABLE_FIELDS) {
      if (out[field] == null) continue;
      const d = diagnoseValue(out[field]);
      if (d.status === 'clean') continue;
      findings.push({ note: notePath, id: f.id, field, ...d });
      const applyable = d.status === 'repaired' || (d.status === 'review' && includeSingleCycle);
      if (applyable) { out[field] = d.after; changed += 1; }
    }
    return out;
  });
  return { findings, facts: repaired, changed };
}

// Whole-note repair: returns the new markdown (or null when nothing applyable changed).
export function repairNoteText(text, notePath, opts = {}) {
  const { findings, facts, changed } = diagnoseNote(text, notePath, opts);
  if (!changed) return { text: null, findings, changed: 0 };
  return { text: rewriteFactsBlock(text, facts), findings, changed };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };

const trunc = (s, n = 110) => (s.length > n ? `${s.slice(0, n)}… (+${s.length - n} chars)` : s);
const bs = (s) => (String(s).match(/\\/g) || []).length;

function readVault(dir) {
  const walk = (d, acc = []) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p, acc);
      else if (p.endsWith('.md')) acc.push(p);
    }
    return acc;
  };
  return walk(dir).map((p) => ({ path: relative(dir, p), text: readFileSync(p, 'utf8'), file: p }));
}

async function main() {
  const vaultDir = val('--vault') ? resolve(val('--vault')) : null;
  const apply = has('--apply');
  const includeSingleCycle = has('--include-single-cycle');
  const onlyNote = val('--note');
  const asJson = has('--json');

  // Transport: local files, or the brain via brainStore (direct) / brainCloud (gateway, read-only).
  // Resolved BEFORE any I/O so a refusal to apply costs nothing and leaks nothing.
  let load;
  let transport;
  let canApply;
  if (vaultDir) {
    load = async () => readVault(vaultDir);
    transport = 'vault files';
    canApply = true;
  } else {
    const store = await import('../lib/server/brainStore.js');
    const cloud = await import('../lib/server/brainCloud.js');
    if (store.serviceConfigured()) {
      load = () => store.fetchNotes();
      transport = 'direct (service key)';
      canApply = true;
    } else if (cloud.gatewayConfigured()) {
      load = () => cloud.fetchNotes(); // read-only `notes` op — the gateway cannot write notes back
      transport = 'gateway (READ-ONLY)';
      canApply = false;
    } else {
      console.error('brain not reachable — set SUPABASE_URL+SUPABASE_SERVICE_KEY (Mac/direct) or');
      console.error('BRAIN_API_URL+BRAIN_API_TOKEN (cloud gateway, dry-run only), or pass --vault <dir>.');
      process.exit(1);
    }
  }

  if (apply && !canApply) {
    console.error('REFUSING TO APPLY: this session reaches the brain through the read-only gateway token.');
    console.error('Applying rewrites brain_notes + brain_facts and needs DIRECT Supabase creds —');
    console.error('re-run with --apply on the Mac (or any env holding SUPABASE_URL + SUPABASE_SERVICE_KEY).');
    console.error('Run it here WITHOUT --apply for the dry-run report.');
    process.exit(2);
  }

  let notes = await load();
  if (onlyNote) notes = notes.filter((n) => n.path === onlyNote);

  const all = [];
  const writes = [];
  for (const note of notes) {
    const { text, findings, changed } = repairNoteText(note.text, note.path, { includeSingleCycle });
    all.push(...findings);
    if (changed && text) writes.push({ note, text, changed });
  }

  const tally = (s) => all.filter((f) => f.status === s).length;
  const summary = {
    mode: apply ? 'APPLY' : 'DRY RUN',
    transport,
    notesScanned: notes.length,
    factFieldsFlagged: all.length,
    repaired: tally('repaired'),
    review: tally('review'),
    ambiguous: tally('ambiguous'),
    notesToWrite: writes.length,
  };

  if (asJson) {
    console.log(JSON.stringify({ summary, findings: all }, null, 2));
  } else {
    console.log(`Chronos brain repair — ${summary.mode}`);
    console.log(`source: ${transport} · notes: ${notes.length}\n`);
    for (const f of all) {
      const mark = f.status === 'repaired' ? 'REPAIR' : f.status === 'review' ? 'REVIEW' : 'SKIP  ';
      console.log(`[${mark}] ${f.note} · ${f.id} · ${f.field}`);
      console.log(`         cycles: ${f.cycles} · backslashes ${bs(f.before)} → ${bs(f.after)}`);
      if (f.reason) console.log(`         reason: ${f.reason}`);
      console.log(`         before: ${trunc(f.before)}`);
      console.log(`         after:  ${trunc(f.after)}\n`);
    }
    console.log(`SUMMARY  notes ${summary.notesScanned} · flagged ${summary.factFieldsFlagged}`
      + ` · repairable ${summary.repaired} · review ${summary.review} · ambiguous ${summary.ambiguous}`);
    if (summary.review && !includeSingleCycle) {
      console.log('         (REVIEW rows are NOT applied — re-run with --include-single-cycle if you');
      console.log('          confirm those values never contained a literal backslash.)');
    }
    if (!apply) {
      console.log(writes.length
        ? `\nDRY RUN — nothing written. ${writes.length} note(s) would be rewritten. Re-run with --apply${canApply ? '' : ' on the Mac/service-key environment'}.`
        : '\nDRY RUN — nothing to repair.');
    }
  }

  if (!apply) return;

  if (vaultDir) {
    for (const w of writes) writeFileSync(w.note.file, w.text);
  } else {
    const store = await import('../lib/server/brainStore.js');
    for (const w of writes) await store.putNote(w.note.path, w.text); // re-derives brain_facts too
  }
  console.log(`\nAPPLIED — ${writes.length} note(s) rewritten, ${summary.repaired + (includeSingleCycle ? summary.review : 0)} field(s) repaired.`);
}

const isMain = process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) main().catch((e) => { console.error(`brain-repair failed: ${e.message}`); process.exit(1); });

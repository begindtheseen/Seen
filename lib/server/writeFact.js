// Chronos WRITE side — the shared, supersede-aware fact writer.
//
// memoryGraph.js only PARSES the vault (it's the derived-index engine and does no I/O). This module
// is its write counterpart: it appends a bi-temporal fact to a note's `facts:` frontmatter, and —
// crucially — SUPERSEDES rather than overwrites (closes the prior open fact's valid_to+invalidated,
// then appends the new one). It's the single writer both the MCP server (Claude) and any external
// producer (Seen Command) call, so every writer emits byte-compatible frontmatter.
//
// Surgical by design: it edits ONLY the `facts:` block + `updated:` line in the frontmatter, leaving
// every other key, comment, and the body untouched. Pure logic; fs only at the edges (testable via
// the exported `applyFact`).

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { parseFrontmatter, normalizeFacts, findContradictions, parseScalar } from './memoryGraph.js';

const FIELD_ORDER = ['id', 'subject', 'predicate', 'object', 'valid_from', 'valid_to', 'confidence', 'source', 'recorded', 'recorded_at', 'invalidated', 'by', 'change', 'supersedes'];
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40);
const isoToday = () => new Date().toISOString().slice(0, 10);

// Chars that break the LINE/BLOCK layer if emitted bare (YAML-significant, edge whitespace,
// backslash — which the parser now unescapes — and any control char, incl. a newline that would
// split the value across frontmatter lines).
const UNSAFE_BARE = /[:#[\]"'\\]|^\s|\s$|[\u0000-\u001f\u007f]/;

// Serialize one scalar the way the vault's YAML-subset parser reads back IDENTICALLY.
// Bare emission is allowed only when it is provably lossless: no structurally-unsafe char AND
// parseScalar reads the bare form back as this exact string (which rules out values that would
// coerce — "42" → 42, "true" → true, "null"/"" → null, "[a, b]" → array). Everything else is
// JSON-quoted, and parseScalar's double-quoted branch is the exact inverse of JSON.stringify —
// that inverse pair is what makes parse(write(x)) === x and stops escapes from compounding.
function emitVal(v) {
  if (v === null || v === undefined) return 'null';
  const s = String(v);
  if (!UNSAFE_BARE.test(s) && parseScalar(s) === s) return s;
  return JSON.stringify(s);
}

// Emit a full `facts:` block from an array of fact objects (block-sequence-of-mappings).
function emitFactsBlock(facts) {
  if (!facts.length) return 'facts: []';
  const lines = ['facts:'];
  for (const f of facts) {
    lines.push(`  - id: ${emitVal(f.id)}`);
    for (const k of FIELD_ORDER) {
      if (k === 'id') continue;
      if (f[k] === undefined) continue;
      lines.push(`    ${k}: ${emitVal(f[k])}`);
    }
  }
  return lines.join('\n');
}

// Split "---\n<fm>\n---\n<body>". Returns null if no frontmatter.
function splitDoc(text) {
  const s = String(text).replace(/\r\n/g, '\n');
  const m = s.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return null;
  return { fm: m[1], body: s.slice(m[0].length) };
}

// Replace (or insert) the `facts:` block inside a frontmatter string.
function spliceFacts(fm, factsYaml) {
  const lines = fm.split('\n');
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^facts:(\s|$)/.test(lines[i])) { start = i; break; }
  }
  if (start === -1) { // no facts key yet — append at end of frontmatter
    return `${fm.replace(/\n*$/, '')}\n${factsYaml}`;
  }
  let end = start + 1;
  while (end < lines.length && (lines[end].trim() === '' ? false : /^\s+/.test(lines[end]))) end++;
  return [...lines.slice(0, start), factsYaml, ...lines.slice(end)].join('\n');
}

// Bump (or add) the `updated:` line.
function bumpUpdated(fm, today) {
  if (/^updated:.*$/m.test(fm)) return fm.replace(/^updated:.*$/m, `updated: ${today}`);
  // add after title if present, else at top
  if (/^title:.*$/m.test(fm)) return fm.replace(/^(title:.*)$/m, `$1\nupdated: ${today}`);
  return `updated: ${today}\n${fm}`;
}

function scaffold(noteRel, today) {
  const title = noteRel.replace(/\.md$/, '').split('/').pop().replace(/-/g, ' ');
  return `---\ntitle: ${title}\ntags: [observations]\nupdated: ${today}\nfacts: []\n---\n\n# ${title}\n\nBi-temporal facts recorded programmatically via the Chronos writer.\n`;
}

// PURE core: given the current file text + a fact, return the new text (or null if unchanged).
// Throws if the write would introduce a contradiction. `today` is injectable for tests.
export function applyFact(text, noteRel, fact, today = isoToday(), nowTs = new Date().toISOString()) {
  const { subject, predicate, object } = fact;
  if (!subject || !predicate || object === undefined || object === null) {
    throw new Error('recordFact requires subject, predicate, object');
  }
  const src = (text && text.trim()) ? text : scaffold(noteRel, today);
  const { facts } = normalizeFacts(parseFrontmatter(src).data, noteRel);

  const active = facts.find((f) => String(f.subject) === String(subject) && String(f.predicate) === String(predicate) && f.valid_to == null);
  if (active && String(active.object) === String(object)) return null; // unchanged → no-op

  const next = facts.map((f) => ({ ...f }));
  const act = next.find((f) => String(f.subject) === String(subject) && String(f.predicate) === String(predicate) && f.valid_to == null);
  if (act) { act.valid_to = today; act.invalidated = today; } // supersede: close the old window
  const supersededId = act ? act.id : undefined; // link the new fact to the one it replaced

  next.push({
    id: `${slug(subject)}-${slug(predicate)}-${today.replace(/-/g, '')}-${next.length}`,
    subject: String(subject), predicate: String(predicate), object: String(object),
    valid_from: today, valid_to: null,
    confidence: fact.confidence || 'medium',
    source: fact.source || `[[${noteRel.replace(/\.md$/, '').split('/').pop()}]]`,
    recorded: today, recorded_at: nowTs, invalidated: null,
    // provenance — emitFactsBlock omits undefined keys, so absent fields stay off-disk:
    by: fact.by != null ? String(fact.by) : undefined,
    change: fact.change != null ? String(fact.change) : undefined,
    supersedes: supersededId,
  });

  const conflicts = findContradictions(next);
  if (conflicts.length) throw new Error(`write would create a contradiction on ${subject}/${predicate}`);

  const doc = splitDoc(src);
  const fm = bumpUpdated(spliceFacts(doc.fm, emitFactsBlock(next)), today);
  return `---\n${fm}\n---\n${doc.body}`;
}

// PURE: re-emit a note's `facts:` block from an explicit fact array, leaving every other
// frontmatter key (including `updated:`) and the body untouched. Used by scripts/brain-repair.mjs
// to write back repaired values; NOT a fact-recording path (no supersede, no contradiction check),
// so it must only ever be handed facts that were parsed out of this same note.
// Returns null when the note has no frontmatter to splice.
export function rewriteFactsBlock(text, facts) {
  const doc = splitDoc(text);
  if (!doc) return null;
  return `---\n${spliceFacts(doc.fm, emitFactsBlock(facts.map((f) => {
    const out = {};
    for (const k of FIELD_ORDER) if (f[k] !== undefined) out[k] = f[k];
    return out;
  })))}\n---\n${doc.body}`;
}

// I/O wrapper: record a fact into <vaultDir>/<noteRel>, creating the note if needed.
export function recordFact(vaultDir, noteRel, fact, today = isoToday()) {
  const path = join(vaultDir, noteRel);
  const cur = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const out = applyFact(cur, noteRel, fact, today);
  if (out === null) return { written: 0, reason: 'unchanged', path };
  if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, out);
  return { written: 1, path };
}

// Append a dated timeline episode (prose note under timeline/). Used by memory_append_timeline.
export function appendTimeline(vaultDir, date, heading, text) {
  const rel = join('timeline', `${date}.md`);
  const path = join(vaultDir, rel);
  const entry = `\n## ${heading}\n\n${text}\n`;
  if (existsSync(path)) {
    writeFileSync(path, readFileSync(path, 'utf8').replace(/\n*$/, '\n') + entry);
  } else {
    if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `---\ntitle: ${date}\ndate: ${date}\ntags: [timeline]\n---\n${entry}`);
  }
  return { path };
}

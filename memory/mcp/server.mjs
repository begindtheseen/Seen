#!/usr/bin/env node
// Chronos MCP server — exposes the vault's bi-temporal memory to Claude as tools.
//
// Transport: MCP stdio (newline-delimited JSON-RPC 2.0). Dependency-free on purpose — no SDK,
// no npm install, so it runs anywhere Node does. Logs go to stderr; only protocol messages go
// to stdout.
//
// It re-reads the vault (the single source of truth) on startup, so answers are always current
// without a separate sync step. `scripts/memory-sync.mjs` writes the derived .graph/ index used
// for inspection and for later Graphiti ingestion; this server queries the vault directly.
//
// Wire it up (Claude Code):   claude mcp add chronos -- node memory/mcp/server.mjs
// See memory/mcp/README.md for Claude Desktop (mcp-remote) config.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildIndex, searchFacts, whatsChanged, findContradictions, getTimeline, getEntity, openThreads,
} from '../../lib/server/memoryGraph.js';
import { recordFact, appendTimeline } from '../../lib/server/writeFact.js';
import { renderBriefing } from '../../scripts/memory-status.mjs';

// Where Claude's own writes land (bi-temporal facts). Kept separate from human-curated knowledge notes.
const CLAUDE_NOTE = 'claude-observations.md';

const HERE = dirname(fileURLToPath(import.meta.url));
const VAULT = resolve(process.env.CHRONOS_VAULT || join(HERE, '..')); // memory/

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === '.graph' || name === '.obsidian') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (name.endsWith('.md')) acc.push(full);
  }
  return acc;
}

function loadIndex() {
  const notes = walk(VAULT).map((f) => ({ path: relative(VAULT, f).replace(/\\/g, '/'), text: readFileSync(f, 'utf8') }));
  return buildIndex(notes);
}
let INDEX = loadIndex();

// ---- formatting helpers ---------------------------------------------------
const fmtFact = (f) => {
  const window = f.valid_to == null ? `since ${f.valid_from}` : `${f.valid_from} → ${f.valid_to}`;
  const conf = f.confidence ? ` · ${f.confidence}` : '';
  const src = f.source ? ` · src: ${f.source}` : '';
  return `• ${f.subject} — ${f.predicate} → ${f.object}  [${window}${conf}]${src}`;
};
const text = (s) => ({ content: [{ type: 'text', text: s }] });

// ---- tools ----------------------------------------------------------------
const TOOLS = {
  memory_status: {
    def: {
      name: 'memory_status',
      description: 'One-call session orientation: what changed since last session, what still needs work (open threads), and what is shaky (contradictions / low-confidence facts). Call this FIRST each session instead of re-reading the vault — recall, not re-read.',
      inputSchema: { type: 'object', properties: {} },
    },
    run: () => {
      const today = new Date().toISOString().slice(0, 10);
      return text(renderBriefing(INDEX, today));
    },
  },
  memory_open_threads: {
    def: {
      name: 'memory_open_threads',
      description: 'List open work items ("what still needs work"), highest priority first. Optionally filter by area or include done.',
      inputSchema: { type: 'object', properties: { area: { type: 'string' }, includeDone: { type: 'boolean' } } },
    },
    run: (a) => {
      let ts = a.includeDone ? (INDEX.threads || []) : openThreads(INDEX.threads || []);
      if (a.area) ts = ts.filter((t) => String(t.area || '').toLowerCase() === String(a.area).toLowerCase());
      if (!ts.length) return text('No matching threads.');
      return text(ts.map((t) => `[${t.priority}] ${t.status === 'done' ? '✓ ' : ''}${t.title}${t.area ? ` (${t.area})` : ''}${t.ref ? ` · ${t.ref}` : ''}`).join('\n'));
    },
  },
  memory_search_facts: {
    def: {
      name: 'memory_search_facts',
      description: 'Search the memory vault for typed facts, optionally AS OF a past date (bi-temporal point-in-time recall). Returns facts true at that moment. Use as_of to ask "what was true on date X"; omit it for what is currently true.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'free-text terms matched against subject/predicate/object' },
          as_of: { type: 'string', description: 'ISO date YYYY-MM-DD; return facts valid at this moment. Omit for now.' },
          subject: { type: 'string' },
          predicate: { type: 'string' },
        },
      },
    },
    run: (a) => {
      const r = searchFacts(INDEX.facts, { query: a.query, asOf: a.as_of, subject: a.subject, predicate: a.predicate });
      const when = a.as_of ? `as of ${a.as_of}` : 'currently true';
      return text(r.length ? `${r.length} fact(s) ${when}:\n${r.map(fmtFact).join('\n')}` : `No facts ${when} for that query.`);
    },
  },
  memory_whats_changed: {
    def: {
      name: 'memory_whats_changed',
      description: 'Transaction-time delta: facts RECORDED or INVALIDATED on/after a date. Use at session start with the last session date to see what changed since.',
      inputSchema: { type: 'object', properties: { since: { type: 'string', description: 'ISO date YYYY-MM-DD' } }, required: ['since'] },
    },
    run: (a) => {
      const { added, invalidated } = whatsChanged(INDEX.facts, a.since);
      const parts = [];
      parts.push(`Added since ${a.since} (${added.length}):`);
      parts.push(added.map(fmtFact).join('\n') || '  (none)');
      parts.push(`\nInvalidated since ${a.since} (${invalidated.length}):`);
      parts.push(invalidated.map(fmtFact).join('\n') || '  (none)');
      return text(parts.join('\n'));
    },
  },
  memory_contradictions: {
    def: {
      name: 'memory_contradictions',
      description: 'Hygiene check: facts with the same subject+predicate whose validity windows overlap but whose values differ (usually a supersede that forgot to close valid_to).',
      inputSchema: { type: 'object', properties: {} },
    },
    run: () => {
      const c = findContradictions(INDEX.facts);
      return text(c.length ? `${c.length} contradiction(s):\n${c.map((p) => `• ${p.a.subject} ${p.a.predicate}: "${p.a.object}" (${p.a.note}) vs "${p.b.object}" (${p.b.note})`).join('\n')}` : 'No contradictions — validity windows are clean.');
    },
  },
  memory_timeline: {
    def: {
      name: 'memory_timeline',
      description: 'Return dated timeline episodes (session logs) in a date range, newest first.',
      inputSchema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } } },
    },
    run: (a) => {
      const eps = getTimeline(INDEX.episodes, { from: a.from || null, to: a.to || null });
      return text(eps.length ? eps.map((e) => `## ${e.date} (${e.id})\n${(e.sections['Shipped'] || e.text).slice(0, 600)}`).join('\n\n') : 'No episodes in that range.');
    },
  },
  memory_get_entity: {
    def: {
      name: 'memory_get_entity',
      description: 'Everything known about one entity (person/project/concept): its note, current + historical facts, and linked/backlinked notes.',
      inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    },
    run: (a) => {
      const e = getEntity(INDEX, a.name);
      if (!e) return text(`No entity matching "${a.name}".`);
      const out = [`# ${e.entity.title} (${e.entity.path})`];
      out.push(`\nFacts (${e.facts.length}):`);
      out.push(e.facts.map(fmtFact).join('\n') || '  (none)');
      out.push(`\nLinks → ${e.links.join(', ') || '(none)'}`);
      out.push(`Backlinks ← ${e.backlinks.join(', ') || '(none)'}`);
      return text(out.join('\n'));
    },
  },

  // ---- WRITE tools — the brain is now read AND write --------------------------
  memory_record_fact: {
    def: {
      name: 'memory_record_fact',
      description: 'Record a durable fact into the brain (bi-temporal, supersede-not-overwrite). If a fact with the same subject+predicate is already active with a DIFFERENT value, its window is closed and the new value appended (history preserved); an identical value is a no-op. Use at session end for anything worth remembering next time. Recall with memory_search_facts.',
      inputSchema: {
        type: 'object',
        properties: {
          subject: { type: 'string', description: 'the entity, e.g. "Seen" or "GITHUB_TOKEN"' },
          predicate: { type: 'string', description: 'the relation, e.g. "status" or "mrr"' },
          object: { type: 'string', description: 'the value' },
          confidence: { type: 'string', description: 'high | medium | low (default medium)' },
          source: { type: 'string', description: 'optional provenance, e.g. "[[note]]" or a URL' },
          note: { type: 'string', description: `which vault note to write into (default ${CLAUDE_NOTE})` },
        },
        required: ['subject', 'predicate', 'object'],
      },
    },
    run: (a) => {
      const r = recordFact(VAULT, a.note || CLAUDE_NOTE, { subject: a.subject, predicate: a.predicate, object: a.object, confidence: a.confidence, source: a.source });
      INDEX = loadIndex();
      return text(r.written ? `Recorded: ${a.subject} — ${a.predicate} → ${a.object}` : `No change (already current): ${a.subject} — ${a.predicate} → ${a.object}`);
    },
  },
  memory_append_timeline: {
    def: {
      name: 'memory_append_timeline',
      description: 'Append a dated episode to the timeline (session log / narrative memory). Use for "what happened" this session — decisions made, work shipped — as opposed to typed facts.',
      inputSchema: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'ISO date YYYY-MM-DD (defaults to today)' },
          heading: { type: 'string', description: 'short episode heading' },
          text: { type: 'string', description: 'the episode body (markdown)' },
        },
        required: ['heading', 'text'],
      },
    },
    run: (a) => {
      const date = a.date || new Date().toISOString().slice(0, 10);
      appendTimeline(VAULT, date, a.heading, a.text);
      INDEX = loadIndex();
      return text(`Appended to timeline/${date}.md: ${a.heading}`);
    },
  },
};

// ---- minimal MCP stdio JSON-RPC loop --------------------------------------
function send(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }
function reply(id, result) { send({ jsonrpc: '2.0', id, result }); }
function replyErr(id, code, message) { send({ jsonrpc: '2.0', id, error: { code, message } }); }

function handle(msg) {
  const { id, method, params } = msg;
  if (method === 'initialize') {
    return reply(id, {
      protocolVersion: (params && params.protocolVersion) || '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'chronos-memory', version: '0.1.0' },
    });
  }
  if (method === 'notifications/initialized' || method === 'notifications/cancelled') return; // no response
  if (method === 'ping') return reply(id, {});
  if (method === 'tools/list') return reply(id, { tools: Object.values(TOOLS).map((t) => t.def) });
  if (method === 'tools/call') {
    const t = TOOLS[params && params.name];
    if (!t) return replyErr(id, -32601, `Unknown tool: ${params && params.name}`);
    try {
      INDEX = loadIndex(); // always answer from the live vault
      return reply(id, t.run((params && params.arguments) || {}));
    } catch (e) {
      return reply(id, { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true });
    }
  }
  if (id !== undefined) replyErr(id, -32601, `Method not found: ${method}`);
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\n')) !== -1) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    try { handle(JSON.parse(line)); }
    catch (e) { process.stderr.write(`[chronos] parse error: ${e.message}\n`); }
  }
});
process.stderr.write(`[chronos] memory MCP server ready — vault ${VAULT}, ${INDEX.facts.length} facts, ${INDEX.episodes.length} episodes\n`);

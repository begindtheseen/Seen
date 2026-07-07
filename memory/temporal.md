---
title: Temporal Memory (Chronos)
tags: [meta, architecture]
aliases: [Chronos, bi-temporal, temporal memory]
updated: 2026-07-06
---

# Temporal Memory — Chronos

The bi-temporal layer on top of the flat vault. It lets memory answer not just *"what is
true now?"* but *"what was true on date X?"* and *"what changed since last session?"* —
without ever losing a fact's history. This is the upgrade past a plain Obsidian vault.

## The one rule that makes it work

**One authority, one derived index.** The markdown vault (`memory/`) is the single source
of truth. The graph is **derived from it and rebuildable** — never edited directly.

This deliberately avoids the trap of syncing a vault and a graph *bidirectionally* (each
updating the other), which produces two competing sources of truth and constant drift. Here
the flow is one-directional: **vault → `memory-sync` → derived index (`memory/.graph/`) →
query (local MCP now, Graphiti later).** If the graph engine ever changes, we clear it and
re-derive from the vault. No lock-in, no dual-authority.

## Bi-temporal: two independent time axes

Every typed fact carries two time axes — this is what a flat vault can't do:

| Axis | Fields | Answers |
|---|---|---|
| **Valid time** (real world) | `valid_from`, `valid_to` | "When was this *actually* true?" |
| **Transaction time** (our knowledge) | `recorded`, `invalidated` (+ git commit) | "When did *we* learn / stop believing it?" |

`valid_to: null` = still true. Windows are **half-open** `[valid_from, valid_to)` — the end
date is the first day the fact is no longer true.

## The lifecycle rule: supersede, never overwrite

When a fact changes, **do not edit the value in place**. Instead:
1. Set `valid_to` (and `invalidated`) on the OLD fact to the change date.
2. Append a NEW fact with the new value and `valid_from` = the change date.

The old fact stays in the note as history. Example already living in the vault — free-tier
AI credits went 3/day → 1/day on 2026-07-02 (see [[operation-50]] frontmatter):

```yaml
- id: free-credits-3
  subject: Seen free tier
  predicate: daily_ai_credits
  object: 3
  valid_from: 2026-06-01
  valid_to: 2026-07-02        # closed, not deleted
  invalidated: 2026-07-02
- id: free-credits-1
  subject: Seen free tier
  predicate: daily_ai_credits
  object: 1
  valid_from: 2026-07-02
  valid_to: null              # current truth
```

Now `memory_search_facts({subject:"Seen free tier", as_of:"2026-07-01"})` returns **3**, and
the same query today returns **1**. Ken's "past status of a memory," delivered.

## The typed-fact schema

Facts live in a note's frontmatter `facts:` list (prose stays for humans; facts are the
machine layer). Fields:

| Field | Req | Meaning |
|---|---|---|
| `id` | ✓ | stable slug, unique within the note |
| `subject` `predicate` `object` | ✓ | the triplet (e.g. Seen · deploys_from · next-migration) |
| `valid_from` | ✓ | ISO date the fact became true in the real world |
| `valid_to` | | ISO date it stopped being true; `null`/omitted = still true |
| `confidence` | | `high` / `medium` / `low` (reuses [[trust-and-anti-gaming]] vocabulary); default `medium` |
| `source` | | provenance — a `[[wiki-link]]` and/or `path:line` |
| `recorded` | | ISO date we first recorded it (transaction time) |
| `invalidated` | | ISO date we recorded that it stopped being true |

**Deterministic ingestion:** because facts are typed in the markdown, `memory-sync` reads
them with **no LLM call** — sidestepping the dominant cost of graph memory (an LLM extraction
per episode). Prose is left for humans / an optional, off-by-default LLM extraction pass.

## What Claude can ask (via the [[mcp/README|Chronos MCP server]])

- `memory_search_facts({query, as_of, subject, predicate})` — point-in-time recall.
- `memory_whats_changed({since})` — transaction-time delta (run at session start).
- `memory_contradictions()` — overlapping-validity conflicts (hygiene).
- `memory_timeline({from, to})` and `memory_get_entity({name})`.

## How the pieces fit

```
memory/*.md  ──(source of truth)──►  scripts/memory-sync.mjs
      │                                        │
      │ facts: frontmatter                     ▼
      │                              memory/.graph/*.jsonl   (derived, rebuildable, .gitignored)
      │                                        │
      ▼                                        ▼
lib/server/memoryGraph.js  ◄── queries ──  memory/mcp/server.mjs  ──► Claude (MCP tools)
      (pure bi-temporal engine)                                   later: Graphiti/FalkorDB
```

The same `facts.jsonl` / `episodes.jsonl` are the exact payloads a Graphiti engine ingests
(`add_triplet` for typed facts — no LLM; `add_episode` for prose), so standing up the cloud
graph later reuses this pipeline with zero vault changes. Runbook: [[graph/README]].

## Why this beats the common "Obsidian + Graphiti circle"

| | Common setup | Chronos |
|---|---|---|
| Sources of truth | vault **and** graph (bidirectional) → drift | vault only; graph derived |
| Time model | one axis ("state over time") | **bi-temporal** (valid + transaction) |
| Fact provenance/confidence | none | on every fact |
| Ingestion cost | LLM per episode | deterministic for typed facts (no LLM) |
| Lock-in | tied to the graph service | graph is disposable/rebuildable |

## Source docs
`memory/protocol.md` (session loop), `lib/server/memoryGraph.js` (engine),
`scripts/memory-sync.mjs` (sync), `memory/mcp/README.md` (wiring),
`memory/graph/README.md` (self-host Graphiti).

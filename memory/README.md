# Seen Memory Vault

This folder is an **Obsidian-compatible memory vault** for the Seen / SeenJobs
project. It is the persistent, structured memory that survives across Claude
sessions — an upgrade over relying on model context and one giant append-only
handoff file.

It has two layers:

| Layer | Folder | What it holds | Shape |
|---|---|---|---|
| **Temporal memory** | `timeline/` | What happened, when. One dated note per active day. | Append-only, reverse-chronological. |
| **Knowledge** | `knowledge/`, `decisions/`, `people/` | Durable facts that stay true across sessions. | Wiki-linked entity notes, edited in place. |

The rule of thumb: **time-bound events go in `timeline/`; durable truth goes in
`knowledge/`.** A timeline entry records *"on 2026-07-06 we shipped X and it
changed Y"*; the knowledge note for `Y` is edited to reflect the new truth and
links back to that day. That link between *when* and *what* is the whole point.

## Open it in Obsidian

1. Obsidian → **Open folder as vault** → select this `memory/` folder.
2. The graph view shows the knowledge notes and the days that touched them.
3. Start at [[HOME]] (the map of content) or the newest note in `timeline/`.

You do not need Obsidian to use it — it is plain Markdown and reads fine on
GitHub or in any editor. Obsidian just makes the `[[wiki-links]]` and graph
navigable.

## For the next Claude session

Read **[[protocol]]** first. It is short and tells you exactly what to read at
the start of a session and what to write at the end. In brief:

- **Start:** read [[HOME]], the newest `timeline/` note, and any knowledge
  notes relevant to your task.
- **End:** append to today's `timeline/` note (create it if missing) and edit
  any knowledge note whose facts your work changed.

## Relationship to the legacy docs

The big root-level docs (`CLAUDE_HANDOFF.md`, `MASTER_PROJECT_STATE.md`,
`SEENJOBS_BEHAVIORAL_FLYWHEEL.md`, the parity checklists, etc.) are **not
deleted** — they remain the deep reference. This vault is the fast-recall layer
distilled from them. Each knowledge note links to the source doc(s) it
summarizes under a **Source docs** heading, so you can always drill down.

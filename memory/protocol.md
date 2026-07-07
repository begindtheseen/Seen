---
title: Memory Protocol
tags: [meta, protocol]
updated: 2026-07-06
---

# Memory Protocol

How to use this vault every session. Keep it mechanical so it actually happens.

## At the START of a session

1. **Boot memory (recall, don't re-read).** Run `npm run memory:status` (or the
   `memory_status` MCP tool) for the compact briefing — what changed since last
   session, [[open-threads|what still needs work]], and what's shaky. That one
   read replaces re-reading the vault. Then skim [[HOME]].
2. Read the **newest note in `timeline/`** — where the last session ended.
3. **Temporal delta / gaps:** `memory_whats_changed({ since })` for fact changes;
   `memory_open_threads` for the backlog. See [[temporal|Chronos]].
4. Read the knowledge notes relevant to your task (follow the wiki-links from
   HOME or the timeline entry). If your task touches deploys, read
   [[deployment]]; if it touches money, read [[employer-engine]] and
   [[trust-and-anti-gaming]]; etc.
5. Then `git status` and pick up where the last timeline note said to.

The legacy root docs (`CLAUDE_HANDOFF.md`, `MASTER_PROJECT_STATE.md`, …) are the
deep reference. Drill into them via each knowledge note's **Source docs** links
when you need detail the vault doesn't carry.

## During the session

- **Every non-trivial decision goes through [[decision-protocol]]** — orient
  from memory (current facts · locked decisions · contradictions · open threads ·
  unknowns), decide, then write it back. That's the D1-decisions loop.
- When you verify a **fact** (a path, a schema column, an endpoint contract),
  fix the relevant knowledge note immediately — do not wait for end of session,
  and never write facts from memory. This mirrors the project's own rule 8
  ("leave ground truth better than you found it").
- When a knowledge note contradicts what you just verified in code, **the code
  wins** — update the note and record the correction in today's timeline entry.

## At the END of a session

1. **Append to today's timeline note** — `timeline/YYYY-MM-DD.md`. Create it
   from [[timeline/README|the timeline template]] if it does not exist yet.
   Record: what shipped, what you verified, decisions taken, and an explicit
   **Next** for the following session. Link `[[knowledge notes]]` you touched.
2. **Edit the knowledge notes** whose durable facts your work changed. The
   timeline says *what happened*; the knowledge note holds *what is now true*.
   Do not duplicate the whole story into the knowledge note — record the new
   fact and link back to the day: `Changed 2026-07-06 → [[timeline/2026-07-06]]`.
   - **Typed facts (bi-temporal):** if the changed fact has a `facts:` entry,
     **supersede — never overwrite.** Close the old fact (`valid_to:` +
     `invalidated:` = today) and append a new fact with `valid_from:` = today.
     Add `facts:` entries for durable new truths (deploy target, prices, schema,
     status) with `source` + `confidence`. Rules + schema: [[temporal|Chronos]].
   - Then run **`npm run memory:sync`** to rebuild the derived index (or
     `npm run memory:check` to validate without writing). Fix any reported
     contradictions before ending.
3. **Log decisions** in [[decisions/log]] (locked decisions that must not be
   relitigated — pricing, policy, infra, architecture choices).
   - For any **process / architecture / tooling** decision (one that changes
     *how effectively we build*), also attach a **`Projected impact:` line**
     (productivity Δ · effectiveness Δ · confidence · one-line basis) and add a
     row to the [[impact-ledger|Impact Ledger]], then recompute its compounded
     cumulative. Product/pricing decisions are exempt — their upside is revenue
     probability ([[operation-50]]), not build productivity.
4. Bump the `updated:` date in the frontmatter of any note you edited.

## Conventions

- **Dates** are ISO `YYYY-MM-DD`. Timeline filenames are the date.
- **Frontmatter** on every note: `title`, `tags`, `updated` (and `date` +
  `type: daily` on timeline notes). Obsidian reads YAML frontmatter natively.
- **Links** use `[[note-name]]` (Obsidian wiki-links). Prefer linking over
  copying; the graph is the value.
- **Tags** are a small controlled set: `#architecture #deploy #db #revenue
  #growth #security #decision #meta #person`. Add sparingly.
- **Append-only timeline, editable knowledge.** Never rewrite history in
  `timeline/`; correct a stale fact by editing the knowledge note and noting the
  correction in today's timeline entry.

## Why this exists

Memory used to live entirely in model context plus one ever-growing
`CLAUDE_HANDOFF.md`. That made recall slow (re-read a 20 KB log every time) and
lossy (facts buried in prose, corrections stacked on corrections). This vault
splits **temporal recall** (dated timeline) from **semantic recall** (linked
knowledge), so a session can answer "what happened last Tuesday?" and "what is
the deploy process right now?" without reading everything.

---
title: Open Threads
tags: [meta, backlog]
aliases: [backlog, what needs work, TODO]
updated: 2026-07-07
threads:
  - id: employer-portal-163
    title: "Confirm PR #163 (Employer portal) landed on next-migration"
    status: open
    area: employer
    priority: high
    opened: 2026-07-06
    ref: "[[employer-engine]]"
  - id: weekly-cadence
    title: Operation 50% weekly cadence — owner human-only work (posts, DMs, outreach)
    status: open
    area: growth
    priority: high
    opened: 2026-07-04
    ref: "[[operation-50]]"
  - id: phase2-candidate-profiles
    title: Phase-2 candidate profiles + employer sourcing (owner-gated opt-in model)
    status: open
    area: employer
    priority: medium
    opened: 2026-07-05
    ref: "[[employer-engine]]"
  - id: geo-company-restructure
    title: Company-page GEO restructure (real-data-first for AI citations)
    status: open
    area: growth
    priority: medium
    opened: 2026-07-05
    ref: "[[operation-50]]"
  - id: env-posthog
    title: Set NEXT_PUBLIC_POSTHOG_KEY in Vercel (analytics; code no-op without it)
    status: open
    area: ops
    priority: medium
    opened: 2026-07-05
    ref: "[[environment]]"
  - id: env-owner-email
    title: Set OWNER_EMAIL in Vercel (employer-sale alert emails)
    status: open
    area: ops
    priority: low
    opened: 2026-07-05
    ref: "[[environment]]"
  - id: graphiti-engine
    title: Optionally self-host Graphiti+FalkorDB on GCP for semantic recall
    status: open
    area: memory
    priority: low
    opened: 2026-07-06
    ref: "[[graph/README]]"
---

# Open Threads

The living backlog — **what still needs work**, so "what's missing" is a first-class,
queryable thing, not something a session has to reconstruct. Each thread lives in the
`threads:` frontmatter above (parsed by [[temporal|Chronos]]) and surfaces in the session
briefing and the `memory_open_threads` / `memory_status` MCP tools.

## Rules
- **Open** a thread when work is identified but not done; **close** it (`status: done`,
  add `closed:`) when finished — don't delete it (history stays queryable).
- `status`: `open` · `blocked` · `done`. `priority`: `high` · `medium` · `low`.
- A decision that spawns follow-up work **opens a thread** (see [[decision-protocol]]).
- Review open threads at session start (they're in the briefing) and update at session end.

## Current open threads
See the `threads:` list above. Highest priority first: confirm #163, run the weekly Operation
50% cadence, then Phase-2 candidate profiles, GEO restructure, and the env activations.

## Source
Derived from `CLAUDE_HANDOFF.md` "Next-session candidates",
[[operation-50]], and each session's timeline **Next** section.

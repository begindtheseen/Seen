---
title: HOME
tags: [meta, moc]
updated: 2026-07-06
---

# HOME — Seen Memory Map

The map of content for this vault. Start here every session, then read the
newest [[#Timeline|timeline]] note. New here? Read [[protocol]] and this
folder's `README.md`.

> **Temporal memory is live.** Typed facts carry bi-temporal validity, so memory
> answers "what was true on date X" and "what changed since last session" — not
> just current state. See [[temporal|Chronos]]; query via the
> [[mcp/README|Chronos MCP]] (`memory_search_facts`, `memory_whats_changed`, …).

> **What is Seen?** A hiring-intelligence platform whose moat is the **Hiring
> Outcome Graph** — the tracker is the data-acquisition engine, outcome cards
> drive virality, trust/confidence systems keep data clean. Full thesis:
> [[strategy]].

## Current state snapshot

*As of [[timeline/2026-07-06]] — keep this block current.*

- **Era:** [[operation-50|Operation 50%]] growth build — four parallel revenue
  engines toward ≥50% odds of $1–5k MRR.
- **Prod branch:** `next-migration`. Merge → auto-deploys to seenjobs.io. See
  [[deployment]]. `main` = old HTML app, unrelated history, **never touch**.
- **Health:** 259/259 tests pass, `tsc` clean, build 91/91 pages (as of
  2026-07-06). See [[testing]].
- **DB:** migrations `001`–`050` applied to prod; latest `050_account_type`.
  See [[database]].
- **Open thread:** PR **#163 Employer portal** — preview green, **not yet
  merged** at last handoff. Confirm it landed. See [[employer-engine]].
- **Owner activations pending (env only, code no-op-safe):**
  `NEXT_PUBLIC_POSTHOG_KEY`, `OWNER_EMAIL`. See [[environment]].

## Knowledge notes

**Product & strategy**
- [[seen]] — what the product is, top to bottom
- [[strategy]] — the north star / thesis (non-negotiable)
- [[operation-50]] — the current growth plan and locked decisions
- [[trust-and-anti-gaming]] — claims-not-facts, trust scores, confidence models

**Systems**
- [[behavioral-flywheel]] — apply checkpoint → outcome cards → credit rewards
- [[employer-engine]] — employer revenue (SKUs, checkout, perks, badges)
- [[seen-live]] — realtime admin activity (broadcast ping + poll fallback)

**Engineering**
- [[architecture]] — stack, directory layout, hard rules
- [[deployment]] — Vercel auto-deploy, promoted-preview rule
- [[database]] — migrations, verified schema truths
- [[environment]] — env vars and what's live vs pending
- [[testing]] — test command, build command, invariants

**People**
- [[people/brandon|Brandon]] — the owner

**Memory system (meta)**
- [[protocol]] — the session read/write loop
- [[decision-protocol]] — the D1 decision thought-process (run every decision)
- [[open-threads]] — the living backlog: what still needs work
- [[temporal]] — Chronos: the bi-temporal fact layer + typed-fact schema
- [[mcp/README|Chronos MCP]] — query tools (`memory_status`, `memory_open_threads`, …)
- [[session-hook]] — opt-in auto-boot hook (guarantees the briefing every session)
- [[graph/README]] — optional self-hosted Graphiti engine (your cloud steps)

**Decisions**
- [[decisions/log]] — locked owner decisions (do not relitigate)
- [[impact-ledger]] — projected productivity/effectiveness Δ per process
  decision (cumulative: **≈ +45% productivity · +55% effectiveness**)

## Timeline

Newest first. Full index and template in [[timeline/README]].

- [[timeline/2026-07-07]] — memory made load-bearing: briefing, decision-protocol, open-threads
- [[timeline/2026-07-06]] — memory vault created; Operation 50% build recap
- [[timeline/2026-07-05]] — Operation 50% build: Ghost Report, outcome emails,
  employer engine, Seen Live, employer portal (#157–#163)
- [[timeline/2026-07-02]] — full-app audit era (#124), 30 breaks fixed, prod
  schema reconciled

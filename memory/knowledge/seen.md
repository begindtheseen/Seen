---
title: Seen
tags: [product]
aliases: [SeenJobs, seenjobs.io]
updated: 2026-07-06
facts:
  - id: seen-category
    subject: Seen
    predicate: is_a
    object: hiring-intelligence platform
    valid_from: 2026-05-01
    valid_to: null
    confidence: high
    source: "[[seen]] · [[strategy]]"
    recorded: 2026-07-06
  - id: seen-live-url
    subject: Seen
    predicate: live_at
    object: seenjobs.io
    valid_from: 2026-06-30
    valid_to: null
    confidence: high
    source: "[[deployment]]"
    recorded: 2026-07-06
---

# Seen / SeenJobs

A **hiring-intelligence platform** live at **seenjobs.io**. Job seekers track
applications; those timelines become a proprietary dataset ("the Hiring Outcome
Graph") that powers company transparency scores, ghosting intelligence, and
benchmarks.

## The one-sentence thesis
The application **tracker is the primary data-acquisition engine**; outcome
cards drive virality; trust/confidence systems keep the data clean. Full north
star: [[strategy]].

## What a user does
1. Searches jobs (aggregated, keyless pipeline — no Anthropic in job search).
2. Applies; an **application record + hiring timeline** is created (not "done"
   — that's where it starts).
3. Gets one-click check-ins at **day 7 / 14 / 30** → hiring events.
4. Generates shareable **outcome cards** (HIRED / GHOSTED / REJECTED).
5. Sees company **transparency / ghost** intel built from everyone's outcomes.

The data to make the card *is* the data the intelligence engine needs — we ask
users to make artifacts, never to "help our database." See
[[behavioral-flywheel]] and [[trust-and-anti-gaming]].

## Money
- **Seekers:** AI credits (free tier 1/day), Pro subscription, one-time SKUs
  (Interview Sprint, Credit Pack). See [[operation-50]] / [[decisions/log]].
- **Employers:** featured listings + Transparency Verified badge. Money **never**
  changes a transparency score. See [[employer-engine]].

## Current era
[[operation-50|Operation 50%]] — four parallel revenue engines toward ≥50% odds
of $1–5k MRR. Prod branch `next-migration`, auto-deploy to seenjobs.io
([[deployment]]).

## Source docs
`SEEN_STRATEGY.md`, `CLAUDE.md`, `CLAUDE_HANDOFF.md`, `MASTER_PROJECT_STATE.md`,
`SEENJOBS_BEHAVIORAL_FLYWHEEL.md`.

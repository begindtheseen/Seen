---
title: Testing & Build
tags: [architecture]
updated: 2026-07-06
---

# Testing & Build

## Commands
- **Test:** `node --test --test-reporter=spec "**/*.test.mjs"` (or `npm test`).
- **Build:** `npm run build` — dual pass:
  `next build --experimental-build-mode=compile && … =generate`.
  `npm run build:default` is the plain single-pass fallback.

## Current status
- **259/259 tests pass, `tsc` clean, build 91/91 pages** (as of
  [[timeline/2026-07-06]]). Build must pass before every push — see
  [[deployment]].

## Where tests live
Pure logic modules under `lib/server/*.test.mjs` and `api/_utils/*.test.mjs`.
Every non-trivial pure module gets a `*.test.mjs` beside it (ghostReport,
outcomeEmails, credits, resumeAnalysis, pdfText, …).

## Verification discipline (the point of the 8 rules)
Passing tests + green build do **not** prove a feature works — the classic Seen
failure is code that "looked built but never once worked" at a
frontend→API→DB seam that unit tests don't cross. Also: **worktree subagents
start on `main` (old app), not your branch** — a green build there can be
22 PRs stale. Trace the contract and exercise the path once. See
[[architecture]] (Mandatory Thought Process) and [[timeline/2026-07-02]].

## Source docs
`CLAUDE_HANDOFF.md` (State / test cmd), `CLAUDE.md` (Mandatory Thought Process),
`SMOKE_TEST_RUNBOOK.md`.

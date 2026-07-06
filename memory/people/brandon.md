---
title: Brandon
tags: [person]
aliases: [owner, begindtheseen]
updated: 2026-07-06
---

# Brandon — owner

Solo owner/operator of [[seen|Seen / SeenJobs]]. GitHub `begindtheseen`.

## Role in the workflow
- **Approves** business decisions (pricing, trial, infra) and merges. Merging a
  PR to `next-migration` is the deploy ([[deployment]]).
- **Supplies the human-only half of [[operation-50|Operation 50%]]:** 5–8
  hrs/week of posting, DMs, outreach, community presence — the one thing AI
  cannot do for the plan.
- Runs the one-time env/dashboard setup (PostHog, Resend, Stripe webhooks —
  [[environment]]).

## How to work with him (from the docs)
- **"Don't ask, ship"** — make reasonable calls and ship; he redirects if wrong.
  BUT (rule 6) if a change hinges on an un-made *business* decision (pricing,
  policy, spend), ask first or park it — don't iterate strategy in code. See
  [[decisions/log]].
- Wants correctness the first time: no half-finished work, no
  backwards-compat hacks, no known approximations.
- Values verified ground truth over prose — update the vault + docs with facts
  you checked, never from memory ([[protocol]]).

## Source docs
`CLAUDE_HANDOFF.md` (Operating mode), `CLAUDE.md` (Code Principles),
`playbook/README.md` (the human-only contract).

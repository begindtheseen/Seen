---
title: Decision Log
tags: [decision]
updated: 2026-07-06
---

# Decision Log

Locked owner/engineering decisions. **Do not relitigate or silently unwind these**
(that is rule 6 in [[architecture]] — "decide once, build once"). If a decision
must change, it changes here explicitly, with a date and a reason, and a note in
that day's [[timeline/README|timeline]].

Format: `YYYY-MM-DD — decision — where it lives in code/docs`.

**Process / architecture decisions also carry a `Projected impact:` line**
(productivity Δ · effectiveness Δ) and get a row in the [[impact-ledger|Impact
Ledger]]. Product/pricing decisions do not — their upside is revenue probability
([[operation-50]]), not build productivity. See [[protocol]].

## Product / pricing (Operation 50%, see [[operation-50]])
- **2026-07-02 — Free tier = 1 AI credit/day.** SUPERSEDES an earlier "3/day".
  `lib/server/creditRules.js` `FREE_DAILY_CREDITS = 1`; pricing copy renders from
  the constant; migration 031/044 RPC resets to 1. Do NOT restore 3/day.
- **2026-07-04 — One-time SKUs:** Interview Sprint **$14.99** (+30 credits +
  7-day Pro via `ai_credits.pro_until`); Credit Pack **$4.99** (+20 credits).
- **2026-07-04 — 7-day NO-CARD trial** (rebuild approved). Charge nothing up
  front. Note: an older trial was built and deleted in #93 — this is a fresh,
  approved rebuild.
- **2026-07-04 — Beachhead niche = staffing-agency-ghosted / r/recruitinghell**,
  with the Staffing Agency Ghost Index (`/agencies`) as the hero asset.
- **2026-07-02 — "Stealth Mode" is renamed "Human Voice" in ALL UI strings**
  (authenticity framing — never evade/bypass/detection language). The `stealth`
  API field and code identifiers keep their names; only user-facing copy changes.

## Integrity (load-bearing)
- **Employer money NEVER changes a transparency score.** Featured = paid
  placement; Transparency Verified = admin-granted after review. See
  [[employer-engine]].

## Architecture / process
- **2026-07-06 — Project memory lives in-repo as an Obsidian Markdown vault**
  (`memory/`), split into temporal [[timeline/README|timeline]] + [[HOME|knowledge]].
  Chosen over an external store: git-backed, portable, populatable same-day. See
  [[protocol]] and [[timeline/2026-07-06]].
  - *Projected impact:* **+18% productivity · +25% effectiveness** (Med) —
    [[impact-ledger|Impact Ledger]] #1.
- **2026-07-06 — Every process/architecture decision carries a projected
  productivity + effectiveness stat**, logged in the [[impact-ledger|Impact
  Ledger]]. Makes the payoff of process changes legible so we scale winners and
  kill low-value churn (Operation 50% kill-gate discipline). See [[protocol]].
  - *Projected impact:* **+2% productivity · +5% effectiveness** (Low) —
    [[impact-ledger|Impact Ledger]] #2.
- **2026-07-06 — Temporal memory = one authority, derived graph (Chronos).** The
  markdown vault stays the single source of truth; a bi-temporal fact layer is
  *derived* from it (never edited directly), queried locally now and by
  self-hosted Graphiti later. Rejected the common bidirectional Obsidian↔graph
  "circle" (dual sources of truth). Facts are typed with valid-time +
  transaction-time and superseded, never overwritten. See [[temporal]].
  - *Projected impact:* **+22% productivity · +30% effectiveness** (Med) —
    [[impact-ledger|Impact Ledger]] #3.
- **Never touch `main`** (old HTML app, unrelated history). Prod branch is
  `next-migration`; merge = deploy. See [[deployment]].
- **Candidate sourcing is Phase 2** (owner: "portal on real data first") — needs
  a candidate opt-in profile model before employers browse talent. Not
  built/faked.

## Source docs
`CLAUDE.md` (Operation 50% / session decision blocks), `MONETIZATION_TODO.md`,
`CLAUDE_HANDOFF.md`.

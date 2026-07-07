---
title: Impact Ledger
tags: [meta, decision, analytics]
updated: 2026-07-06
---

# Impact Ledger

Projected **productivity** and **effectiveness** impact of each *process /
architecture / tooling* decision — the decisions that change *how effectively we
build*, logged in [[decisions/log]]. Every such decision gets a line here when
it lands (see [[protocol]]).

> **These are projections, not measurements.** Directional estimates with a
> stated basis and a confidence level — meant to force an honest cost/benefit
> call and to flag decisions that don't earn their keep. Not fake precision;
> treat a number as "this is the size of bet we think we're making."

## Definitions
- **Productivity Δ** — expected change in *throughput per session* (less time
  re-establishing context, hunting docs, redoing work).
- **Effectiveness Δ** — expected change in *getting the right thing right*
  (fewer wrong-thing builds, fewer relitigated/forgotten decisions, corrections
  captured once).
- **Confidence** — Low / Med / High: how much evidence backs the estimate.

## Scope
This ledger covers decisions about **how we work** (memory, workflow, tooling,
architecture process). **Product/pricing/business decisions** (free-tier size,
SKUs, trial) are *not* scored here — their upside is revenue probability, which
lives in [[operation-50|Operation 50%]], not build productivity. A decision in
[[decisions/log]] gets an Impact Ledger line only if it changes how effectively
we execute.

## Ledger

| # | Decision | Date | Productivity Δ | Effectiveness Δ | Conf. | Basis |
|---|----------|------|:---:|:---:|:---:|-------|
| 1 | Adopt in-repo Obsidian memory vault (temporal + knowledge) — [[timeline/2026-07-06]] | 2026-07-06 | **+18%** | **+25%** | Med | Kills the "re-read ~150 KB of overlapping root docs every session" startup tax and mid-session doc hunts (productivity); splits temporal vs semantic recall and captures corrections once, so fewer stale-context wrong builds — e.g. the APEX/Seen mix-up class — and fewer relitigated decisions (effectiveness). |
| 2 | Track projected impact per process decision (this ledger) — [[timeline/2026-07-06]] | 2026-07-06 | **+2%** | **+5%** | Low | Small direct throughput effect; forces an explicit cost/benefit before changing process and makes the payoff of process changes legible, so we double down on winners and kill low-value churn (mirrors the Operation 50% kill-gate discipline). |
| 3 | Temporal memory — Chronos: one-authority bi-temporal fact layer ([[temporal]]) — [[timeline/2026-07-06]] | 2026-07-06 | **+22%** | **+30%** | Med | Point-in-time recall + "what changed since last session" cut re-derivation of current state and re-reading history (productivity); typed facts with valid-time/transaction-time + supersede-not-overwrite + contradiction detection sharply cut acting on stale/overwritten facts — the dominant hallucination source — with provenance/confidence on every fact (effectiveness). Standalone vs a flat vault. |

## Cumulative (projected)

Gains **compound, they don't sum** — and overlapping gains are **discounted**, so
the cumulative is *not* the blind product of the factors.

- Blind product would be: productivity 1.18 × 1.02 × 1.22 = +46%; effectiveness
  1.25 × 1.05 × 1.30 = +71%.
- But #3 (Chronos) **overlaps** #1 (the vault) — both reduce stale-context errors
  — so its marginal contribution is discounted ~half. Honest combined estimate
  **vs the pre-vault baseline**:
  - **Productivity: ≈ +35%** per session.
  - **Effectiveness: ≈ +48%.**

*Interpretation: a session is projected to do ~35% more per unit time and land
the right outcome ~48% more often than under the old "context + one giant
handoff file" baseline. These are projections — revisit against reality as
sessions accumulate; downgrade any decision whose gain doesn't show up. The
biggest real-world lever in #3 is fewer confidently-wrong actions on facts that
silently went stale.*

## How to update (every time a process decision lands)
1. Add a row: decision, date, Productivity Δ, Effectiveness Δ, confidence,
   one-line basis. Link the timeline day.
2. Recompute the compounded cumulative line (product of factors, discount
   overlaps).
3. Mirror the same two Δ numbers on the decision's entry in [[decisions/log]].
4. Bump `updated:` here and in the log.

See [[protocol]] for where this sits in the session-end loop.

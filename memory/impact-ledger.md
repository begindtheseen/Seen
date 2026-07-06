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

## Cumulative (projected)

Gains **compound, they don't sum** — and overlapping gains are discounted, so
the cumulative is the product of the individual factors, not their addition.

- **Productivity:** 1.18 × 1.02 = **≈ +20%** per session.
- **Effectiveness:** 1.25 × 1.05 = **≈ +31%**.

*Interpretation: a session is projected to do ~20% more per unit time and land
the right outcome ~31% more often than under the old "context + one giant
handoff file" baseline. Revisit these against reality as we accumulate sessions;
downgrade any decision whose projected gain doesn't show up.*

## How to update (every time a process decision lands)
1. Add a row: decision, date, Productivity Δ, Effectiveness Δ, confidence,
   one-line basis. Link the timeline day.
2. Recompute the compounded cumulative line (product of factors, discount
   overlaps).
3. Mirror the same two Δ numbers on the decision's entry in [[decisions/log]].
4. Bump `updated:` here and in the log.

See [[protocol]] for where this sits in the session-end loop.

---
title: Strategy
tags: [product, decision]
aliases: [North Star, Thesis]
updated: 2026-07-06
---

# Strategy — the north star

Source of truth for *what* Seen builds and *why*. Every change must serve it.
Full text: `SEEN_STRATEGY.md` (read it at session start when the task is
product-shaped).

## The thesis (non-negotiable)
**The Hiring Outcome Graph is the core long-term moat.** Maximize the number of
high-quality hiring-outcome events collected — while making collection feel
valuable to the user, not extractive.

## The core shift
Applications are **not** a feature that ends at "submitted." They are the
**primary data-acquisition engine**. Every application starts a hiring timeline;
every timeline is a data asset; every outcome feeds company intelligence.

## How data gets collected (psychology)
- Never say "help us improve our database." Say **"generate your outcome card."**
- The user makes an artifact for themselves; data collection is the byproduct.
- Behavioral loops: progress ("your app is 3 days old, check in"), benchmark
  ("interview 2× faster than average here"), outcome card, analytics, streak.
  Built out in [[behavioral-flywheel]].

## Success metric
**Not** applications submitted. **Yes** applications *with outcomes*.
Optimize `outcome_rate` = (apps with ≥1 post-submit event) / (total apps).

## Hard "avoid" list
- Gamification (XP, coins, levels, leaderboards).
- Long forms for outcome collection.
- Presenting low-confidence data as fact (always show confidence — see
  [[trust-and-anti-gaming]]).
- Public individual application data.
- Over-engineered realtime before scale; complex payment tiers before PMF.

## Source docs
`SEEN_STRATEGY.md` (primary), `CLAUDE.md` (Core Mission).

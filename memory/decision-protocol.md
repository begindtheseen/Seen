---
title: Decision Protocol
tags: [meta, protocol, decision]
aliases: [how to decide, decision thought process]
updated: 2026-07-07
---

# Decision Protocol — the thought process

Run this **every time you make a non-trivial decision** on Seen. The goal: decide from full
context, know what's missing, and leave the next session smarter — a D1 athlete at decisions,
not a session that re-derives everything from scratch. It fuses the project's own rules (rule
6 "decide once", rule 8 "leave ground truth better") with the [[temporal|Chronos]] memory.

## Before deciding — orient from memory (don't guess, don't re-read everything)

1. **Pull current truth.** `memory_search_facts` on the subjects involved. Decide against
   what is true *now*, not a half-remembered value. If it's dated, check `as_of`.
2. **Is it already decided?** Scan [[decisions/log]]. If locked, **do not relitigate**
   (rule 6) — build on it. If you must change it, change it explicitly with a reason.
3. **What's shaky here?** `memory_contradictions` + low-confidence facts touching this area.
   Verify a shaky fact in the code before you lean on it (rule 2 — verify real schema/state).
4. **What's missing / open?** Check [[open-threads]]. Does this decision depend on, unblock,
   or duplicate an open thread?
5. **Name the unknowns.** State explicitly what you do NOT know. No silent approximations
   (rule 5) — an honest "blocked on X, need owner" beats confidently-wrong.
6. **Owner call?** If it hinges on a business decision (pricing, policy, spend), ask or park
   it in [[decisions/log]] — don't iterate strategy in code (rule 6).

## Decide
Make the call. Prefer reversible, small, verifiable moves. If you acted, verify it end-to-end
(rule 3) before calling it done.

## After deciding — write it back so it compounds
7. **Log it** in [[decisions/log]] (+ a projected productivity/effectiveness Δ in
   [[impact-ledger]] if it's a process/architecture decision).
8. **Supersede facts, never overwrite.** Close the old fact (`valid_to` + `invalidated` =
   today) and append the new one. History stays queryable ([[temporal|Chronos]]).
9. **Update [[open-threads]].** Close what's done; open a thread for follow-up work you created.
10. **Append to today's timeline**, then `npm run memory:sync`. Fix any contradiction it reports.

## The 30-second version
Orient (facts · locked? · shaky? · missing? · unknowns) → decide → write back (log · supersede
· threads · sync). If you skip the write-back, the next session pays the token cost you just saved.

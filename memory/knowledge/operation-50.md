---
title: Operation 50%
tags: [growth, revenue, decision]
updated: 2026-07-06
---

# Operation 50%

The current operating era. Approved **2026-07-04**. Goal: **$1–5k MRR within
24–36 months at ~50% probability.** Field manual in `playbook/`.

## Why 50% is real (the contract — all three required)
1. **The cadence runs 24–36 months.** Near-zero burn makes persistence
   affordable; **abandonment, not competition, is the dominant killer** of solo
   products.
2. **Owner supplies 5–8 hrs/week of human-only work** (posting, DMs, outreach,
   community). AI builds everything else but cannot be the human face.
3. **Kill-gates enforced.** An engine that misses its gate twice loses its
   effort allocation to the winners. No zombie engines.

Skip any one → odds revert toward the ~15% baseline.

## The four revenue engines
| # | Engine | Buyer |
|---|---|---|
| E1 | Ghost-Intel Beachhead — Staffing Agency Ghost Index (`/agencies`) + r/recruitinghell niche | Seekers (Pro) |
| E2 | Résumé Strategist + 7-day no-card trial | Seekers (Pro) |
| E3 | One-time SKUs — Interview Sprint $14.99, Credit Pack $4.99 | Seekers (one-time) |
| E4 | Employer side — featured listings, Transparency Verified badge, sponsorships | Employers |

**Amplifier:** weekly Ghost Report + outcome cards = 52 shots/yr at a viral hit.
E4 is built — see [[employer-engine]]. The Ghost Report + outcome loop are built
— see [[behavioral-flywheel]].

## The prime directive
Every week must produce a measurable shot on goal (a post, N DMs, N outreach
emails, KPIs reviewed). Inputs are the job; outcomes compound.

## Locked owner decisions
See [[decisions/log]] — pricing, trial, beachhead niche, employer integrity are
**decided; do not relitigate** (rule 6 in [[architecture]]).

## Owner one-time setup (playbook)
PostHog key, Resend domain verify (done — `RESEND_KEY` live), Stripe webhook
event subscriptions. Pending env: `NEXT_PUBLIC_POSTHOG_KEY`, `OWNER_EMAIL`
([[environment]]).

## Source docs
`playbook/README.md` + `WEEKLY_ROUTINE.md` / `OUTREACH_SCRIPTS.md` /
`CONTENT_ENGINE.md` / `90_DAY_CALENDAR.md`; `CLAUDE.md` (Operation 50% session);
`OPPORTUNITY_ENGINE.md`.

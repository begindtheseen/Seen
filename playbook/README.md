# Operation 50% — The Operating System

> Goal: $1–5k MRR within 24–36 months at ~50% probability. The probability comes from
> running FOUR revenue engines in parallel with a non-negotiable weekly cadence and
> numeric kill/scale gates. This folder is the owner's field manual.
>
> Approved 2026-07-04. Full plan + evidence: the probability assessment report and the
> approved Operation 50% plan (session artifacts). Strategy foundation: SEEN_STRATEGY.md,
> SEENJOBS_BEHAVIORAL_FLYWHEEL.md, OPPORTUNITY_ENGINE.md.

## The contract (what makes the 50% real)

1. **The cadence runs for 24–36 months.** Near-zero burn makes persistence affordable.
   Abandonment — not competition — is the statistically dominant killer of solo products.
2. **The owner supplies 5–8 hrs/week of HUMAN-ONLY work** (posting, DMs, outreach,
   community presence). AI builds everything else but cannot be the human face.
3. **Kill-gates are enforced.** Engines that miss their gates twice lose their effort
   allocation to the winners. No zombie engines, no sunk-cost loyalty.

Skip any of the three and the odds revert toward the ~15% baseline.

## The four engines

| # | Engine | Buyer | First dollar looks like |
|---|--------|-------|------------------------|
| E1 | Ghost-Intel Beachhead (Staffing Agency Ghost Index + niche community) | Job seekers (Pro) | A ghosted r/recruitinghell user subscribes after checking an agency |
| E2 | Résumé Strategist + 7-day no-card trial | Job seekers (Pro) | A trial started from a demo clip converts |
| E3 | One-time SKUs (Interview Sprint $14.99, Credit Pack $4.99) | Job seekers (one-time) | A desperate applicant buys a Sprint before a big application push |
| E4 | Employer side (featured listings, Transparency Verified badge, sponsorships) | Employers/agencies | An agency on the Ghost Index buys the badge/response program |

**The amplifier:** the weekly Ghost Report (auto-generated data story) + outcome cards.
52 shots per year at a Reddit/TikTok hit instead of zero.

## Files in this folder

- `WEEKLY_ROUTINE.md` — the Monday ritual, the KPI pack, the owner's weekly 3 tasks
- `OUTREACH_SCRIPTS.md` — report-seeding DMs + employer outreach emails (copy-paste ready)
- `CONTENT_ENGINE.md` — what to post, where, when; demo-clip scripts; title formulas
- `90_DAY_CALENDAR.md` — Sprint 1 week by week, with the Day-90 kill/scale gates

## One-time setup (do these once, ~40 minutes total)

1. **PostHog** (analytics): create free account at posthog.com → copy the Project API key →
   add `NEXT_PUBLIC_POSTHOG_KEY` in Vercel → redeploy. Without this we fly blind; it is
   the single highest-leverage 10 minutes in this plan.
2. **Resend** (email): create free account at resend.com → verify the seenjobs.io domain
   (DNS records) → add `RESEND_API_KEY` in Vercel. Powers the Day-7/14/30 outcome loop —
   which is both the data engine and the retention channel.
3. **Stripe**: no dashboard product setup needed (trial + one-time SKUs are code-level),
   but confirm the webhook endpoint is subscribed to `checkout.session.completed`,
   `customer.subscription.updated`, `customer.subscription.deleted`,
   `customer.subscription.trial_will_end`.

## The prime directive

Every week must produce a measurable shot on goal: a post published, N DMs sent,
N outreach emails sent, and the KPI numbers reviewed. A week where all four happened is
a won week regardless of outcomes — the outcomes compound; the inputs are the job.

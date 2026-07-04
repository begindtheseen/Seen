# The Weekly Routine (total: 5–8 owner-hours)

## Monday — Review + plan (30–45 min)

1. Open a Claude Code session and say: **"Run the weekly brief."** The session runs the
   KPI pack below against prod, compares to last week, and hands you your 3 human tasks.
2. Decide nothing else on Monday. The gates decide (see 90_DAY_CALENDAR.md).

### The KPI pack (SQL — any session can run these read-only via the Supabase MCP)

```sql
-- Growth & engine health, one row
SELECT
  (SELECT count(*) FROM auth.users)                                                   AS users_total,
  (SELECT count(*) FROM auth.users WHERE created_at > now() - interval '7 days')      AS users_7d,
  (SELECT count(*) FROM reports WHERE user_id IS NOT NULL)                            AS organic_reports_total,
  (SELECT count(*) FROM reports WHERE user_id IS NOT NULL
      AND created_at > now() - interval '7 days')                                     AS organic_reports_7d,
  (SELECT count(DISTINCT user_id) FROM reports WHERE user_id IS NOT NULL)             AS distinct_reporters,
  (SELECT count(*) FROM outcome_card_shares)                                          AS card_shares_total,
  (SELECT count(*) FROM outcome_card_shares WHERE created_at > now() - interval '7 days') AS card_shares_7d,
  (SELECT count(*) FROM search_logs WHERE created_at > now() - interval '7 days')     AS searches_7d,
  (SELECT count(*) FROM optimizer_runs WHERE created_at > now() - interval '7 days')  AS optimizer_runs_7d,
  (SELECT count(*) FROM applications WHERE created_at > now() - interval '7 days')    AS apps_tracked_7d,
  (SELECT count(*) FROM ai_credits WHERE pro = true)                                  AS pro_users;
```

```sql
-- Company pages with REAL report coverage (the SEO/GEO defensibility metric)
SELECT count(DISTINCT company_name) AS companies_with_organic_reports,
       count(*)                     AS organic_reports
FROM reports WHERE user_id IS NOT NULL;
```

Revenue: read from the Stripe dashboard (subscriptions + one-time payments) until it's
mirrored into admin. Trials: PostHog `trial_started` events once analytics is live.

## Tuesday–Sunday — the human inputs (pick your days; hit the counts)

| Input | Weekly count | Time | Engine |
|---|---|---|---|
| Post the weekly Ghost Report | 1 post (Reddit + LinkedIn crosspost) | 30 min | Amplifier |
| Demo clips (script provided in CONTENT_ENGINE.md) | 2 clips (TikTok/Shorts/Reddit where allowed) | 60–90 min | E2 |
| Report-seeding DMs (scripts in OUTREACH_SCRIPTS.md) | 10–15 DMs to people posting ghosting stories | 60–90 min | E1 |
| Employer/agency outreach emails (lists + copy provided) | 10 emails | 45 min | E4 |
| Authentic community presence (r/recruitinghell + adjacent) | 15 min/day — comment as a person, not a brand | ~90 min | E1 |

## Rules of engagement (do not skip)

- **Always disclose you're the founder** when the product comes up. Reddit destroys
  astroturf and rewards honest builders. "I built a site that tracks this" outperforms
  stealth marketing on every axis, including legally.
- **Follow each subreddit's self-promo rules.** When in doubt, give value with no link
  and let people ask. DMs only to people who publicly posted about being ghosted, one
  message, no follow-up if ignored.
- **Never fabricate or inflate numbers in posts.** The product's entire brand is
  "numbers with reasons." A post that says "3 reports so far — help us make it 300"
  builds more trust than fake scale.

## The weekly definition of DONE

☐ KPI pack reviewed  ☐ 1 Ghost Report posted  ☐ 2 clips posted  ☐ 10+ DMs sent
☐ 10 employer emails sent  ☐ next week's 3 tasks agreed with Claude

Four ☐ or fewer checked two weeks running = the cadence is broken = fix the cadence
before touching the product. The cadence IS the product of this plan.

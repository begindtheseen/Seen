---
title: Behavioral Flywheel
tags: [product, growth]
updated: 2026-07-07
facts:
  - id: flywheel-status
    subject: Behavioral flywheel
    predicate: status
    object: BUILT (apply checkpoint, outcome cards, day-7/14/30 check-ins)
    valid_from: 2026-07-02
    valid_to: null
    confidence: high
    source: "[[behavioral-flywheel]]"
    recorded: 2026-07-07
  - id: outcome-emails
    subject: Outcome email loop
    predicate: status
    object: live (day-7/14/30, daily cron 15:00 UTC, on RESEND_KEY)
    valid_from: 2026-07-05
    valid_to: null
    confidence: high
    source: "[[behavioral-flywheel]]"
    recorded: 2026-07-07
---

# Behavioral Flywheel

The data engine that makes Seen valuable — apply → track → outcome → share →
intel. This is **core product architecture, not optional growth**. Full spec:
`SEENJOBS_BEHAVIORAL_FLYWHEEL.md` (51 KB — read in full before touching it).

## Status: BUILT
ApplyCheckpoint, OutcomeCard, SurveyModal, ResumeSurveyModal, credit rewards,
day-7/14/30 check-ins, and `quick_submit → community-report` intel all exist and
were repaired end-to-end in PR #124 ([[timeline/2026-07-02]]).

## The loop
1. **Apply checkpoint** — "Did you apply?" modal → creates an application record
   + hiring timeline (per [[strategy]]).
2. **Update loop** — one-click check-ins at **day 7 / 14 / 30** ("Did they
   respond?" / "Got an interview?" / "What happened?").
3. **Outcome cards** — shareable HIRED / GHOSTED / REJECTED artifacts. The data
   to make the card *is* the intelligence data.
4. **Credit rewards** — completing check-ins / contributing intel earns AI
   credits (free tier is 1/day — see [[decisions/log]]).

## Event system
Store event *history*, not just status. Types: `application_submitted`,
`response_received`, `assessment_received`, `interview_received`,
`interview_completed`, `offer_received`, `rejected`, `ghosted`, `withdrawn`.
Every event carries `source`, `confidence`, `trust_weight`, `timestamp`,
`anomaly_flags` — treated as CLAIMS not facts ([[trust-and-anti-gaming]]).

## Outcome email loop (PR #158, 2026-07-05)
Day-7/14/30 follow-up emails via `api/outcome-followups.js` (daily cron 15:00
UTC), pure logic in `lib/server/outcomeEmails.js` (HMAC unsubscribe),
`api/unsubscribe.js`. On the live `RESEND_KEY`; `email_prefs` opt-out. DB:
`045_outcome_email_log`. See [[database]].

## Ghost Report (PR #157, 2026-07-05)
Weekly `/ghost-report` page + `opengraph-image` share card + admin
`GhostReportPanel` (copy-caption tool), pure `lib/server/ghostReport.js`. A
distribution asset — owner posts it. Reads existing data, no setup.

## Source docs
`SEENJOBS_BEHAVIORAL_FLYWHEEL.md` (primary), `SEEN_STRATEGY.md`,
`CLAUDE_HANDOFF.md`.

---
title: seen product
tags: [observations]
updated: 2026-07-18
facts:
  - id: seen-stale-jobs-kpi-definition-and-fix-20260718-0
    subject: Seen stale-jobs KPI
    predicate: definition_and_fix
    object: "KPI counts jobs with availability_status IN (stale, expired) (api/admin-stats.js:241); staleness is purely age-based via markStaleJobs (api/refresh-jobs.js:357-371); the only reactivation path was keyword re-ingest, so still-live postings rotted in the KPI. Closed by lib/server/staleRefresh.js (apply_url liveness re-check), shipped as Seen PR #193 (dry-run default, writes behind STALE_REFRESH_APPLY=1, daily cron 03:30). Prod smoke 2026-07-18: 1,953 stale / 4,058 total; projected -43.9% on apply."
    valid_from: 2026-07-18
    valid_to: null
    confidence: high
    source: "agent implementation session 2026-07-18 (Seen PR #193)"
    recorded: 2026-07-18
    invalidated: null
---

# seen product

Bi-temporal facts recorded programmatically via the Chronos writer.

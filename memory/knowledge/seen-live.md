---
title: Seen Live
tags: [architecture, product]
aliases: [realtime, admin live]
updated: 2026-07-06
---

# Seen Live (realtime admin activity)

Real-time admin activity feed (new reports, listing flags, employer sales).
Shipped PR #161 (poll v1) → #162 (INSTANT broadcast). See [[timeline/2026-07-05]].

## The constraint that shaped the design
Admin auth is a **custom token + service-key reads** — there is **no Supabase
session and no RLS** in the admin path. Therefore **Supabase Realtime
`postgres_changes` is NOT viable** (it needs an authenticated session / RLS).

## The design (broadcast ping + authenticated fetch)
1. `lib/server/realtime.js` `broadcastActivity(kind)` POSTs a **tiny,
   non-sensitive ping** to the public Realtime **broadcast** channel
   `seen-live`. Fired from report writes, listing flags, employer sales.
2. `lib/hooks/useAdminLive.ts` subscribes to `seen-live`; on a ping it
   **immediately fetches** the authenticated `recent_events` cursor action in
   `api/admin-stats.js`. The ping carries no data — it only says "go fetch."
3. A **12s poll is the fallback** if the broadcast is missed.

The broadcast channel never carries sensitive data; the real data always comes
from the authenticated cursor fetch.

## Toast system (global)
- `lib/notify.ts` — `seen:notify` event, extends the `seen:*` event bus.
- `components/ToastHost.tsx` — mounted in `app/layout.tsx`.
- `components/admin/LiveBell.tsx` — the admin bell.

## Source docs
`CLAUDE_HANDOFF.md` (Key architecture facts — Seen Live).

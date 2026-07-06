---
title: Environment
tags: [deploy, security]
aliases: [Env Vars]
updated: 2026-07-06
---

# Environment variables (Vercel)

| Var | Notes |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public, intentionally exposed. |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server-only. NEVER in frontend.** |
| `ANTHROPIC_API_KEY` | AI features (resume tools, company intel). Not used in job search. |
| `ADMIN_EMAIL` | Gates `/api/admin-stats` access. |
| `RESEND_KEY` | Email (outcome loop + employer notifications). **Live**, on verified `noreply@seenjobs.io`. |
| `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET` | Reddit import pipeline. |
| `NEXT_PUBLIC_POSTHOG_KEY` | Analytics. **Pending** — code is no-op without it. |
| `OWNER_EMAIL` | Employer-sale alert emails (`OWNER_EMAIL` \|\| `ADMIN_EMAIL` \|\| `NOTIFY_EMAIL`). **Pending** — no-op until set. |

## Rules
- All code that depends on a pending var is **no-op-safe** without it — features
  degrade gracefully, they don't crash. Setting the var activates the feature.
- Service key never reaches any client bundle (see [[architecture]] /
  `SECURITY_ENVIRONMENT.md`).

## Currently pending activations (env only — code already shipped)
- `NEXT_PUBLIC_POSTHOG_KEY` (analytics), `OWNER_EMAIL` (employer alerts).

## Source docs
`SECURITY_ENVIRONMENT.md`, `CLAUDE_HANDOFF.md` (Owner activations pending),
`MASTER_PROJECT_STATE.md` (Environment variables).

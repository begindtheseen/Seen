# Admin API Audit — `api/admin-stats.js`

_Audit date: 2026-06-15 · 723 lines · GET + POST · internal admin operations._

**Audit only. No admin code or behavior is changed by this document.** Prerequisite
for any future hardening/migration of admin logic into `lib/admin/`.

## Auth model (the critical security surface)

- **Login (`admin_login`, unauthenticated):** username + password. Passwords are
  verified with **scrypt** (`scryptSync`, 64-byte) + `timingSafeEqual` — no
  plaintext stored. **IP rate limit: 5 attempts / 15 min** via
  `increment_rate_limit` RPC. On success: issues a random session **token** stored
  in `admin_sessions` with an **8-hour `expires_at`**, returns the token.
- **All other actions:** require the `X-Admin-Token` header. The token is validated
  against `admin_sessions`; if missing or `expires_at < now` → `401`. This is the
  single admin gate (`_handler` checks it before dispatch).
- **CORS:** own inline block; allows `X-Admin-Token` header; methods `GET, POST, OPTIONS`.
- **Errors:** top-level try/catch returns a generic `500 { error: 'Internal server
  error' }` — internal details are logged, not exposed (good).
- **Caching:** `middleware.ts` + `vercel.json` force `no-store` on `/admin*`.

## Endpoints (X-Admin-Token required unless noted)

| Action | Method | Risk | Purpose |
|---|---|---|---|
| `admin_login` | POST (no token) | **Critical** | password auth → session token |
| `admin_logout` | POST | Low | delete session token |
| _GET dashboard_ | GET | Low | KPI/stats aggregation |
| `get_kpi_detail` | POST | Low | KPI drill-down |
| `find_duplicates` / `merge` / `auto_merge` | POST | Med | company dedupe |
| `scan_job_dupes` / `dedupe_jobs` / `update_cluster` / `remove_listing` | POST | Med | job dedupe/moderation |
| `get_recent_jobs` / `get_jobs_grouped` / `get_company_jobs` | POST | Low | job reads |
| `resolve_issue` / `dismiss_issue` | POST | Low | user-issue triage |
| `approve_report` / `deny_report` / `investigate_report` / `deny_hiring_report` | POST | Med | report moderation |
| `detect_duplicates_by_signals` | POST | Med | abuse/dup detection |
| `set_flag` / `seed_flags` | POST | Med | feature-flag control |
| `set_pro` | POST | **High** | grants/revokes user Pro — money-adjacent |

## Security invariants (MUST NOT regress)

- Admin identity = a **server-issued session token** validated against
  `admin_sessions` with expiry — never a client claim.
- Passwords: **scrypt + constant-time compare**; **brute-force rate limited**.
- `set_pro` and feature-flag writes are admin-gated.
- Error responses never leak internals.

## Risks / observations (no action taken)

| # | Observation | Severity | Note |
|---|---|---|---|
| A-1 | Inline rate limiter for `admin_login` duplicates `lib/server/ratelimit.js` | Med | fold into shared limiter later (audit finding F-06) |
| A-2 | Duplicated CORS / `db()` vs other routes | Med | centralize via foundation later |
| A-3 | `set_pro` shares the Pro/credits model with Stripe (`ai_credits.pro`, balance 999) | Med | coordinate with `PAYMENTS_AUDIT.md` before any credits refactor |
| A-4 | No automated tests for the admin-token gate / login rate limit | Med | add tests BEFORE migration (below) |
| A-5 | Session token validated by table lookup on every request | Low | fine; note for any caching change |

## Safe migration plan (future, only after tests exist)

1. **Add tests first** (behavior-neutral): the admin gate rejects missing/expired
   tokens; `admin_login` enforces the 5/15-min IP limit; scrypt verify accepts the
   right password and rejects wrong ones. This likely needs a small behavior-neutral
   extraction of the gate/verify into a pure `lib/admin/auth.ts`.
2. **Then** isolate per slice into `lib/admin/`: `auth.ts` (login + gate),
   `sessions.ts`, and per-feature operation services (dedupe, moderation, flags).
   Route becomes a thin dispatcher on the foundation.
3. Preserve every response shape and the exact auth flow.

## STOP conditions for this area

Do **not**, without explicit human review: change admin login behavior, change the
session/expiry model, change `set_pro`, or alter the admin-token gate. The admin UI
(`app/admin/page.tsx`) is **out of scope** here (Phase J page-splitting, separate).

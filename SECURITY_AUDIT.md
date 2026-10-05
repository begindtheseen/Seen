# SeenJobs Security Audit

**Date**: 2026-06-15  
**Scope**: Full codebase — api/*.js, lib/, supabase/migrations/, middleware, Next.js app  
**Standards**: OWASP ASVS, OWASP API Security Top 10, OWASP LLM Top 10, Stripe security best practices, Supabase RLS best practices

---

## Executive Summary

SeenJobs is a Next.js 15 / Supabase / Stripe / Vercel app handling job application data, AI resume processing, payments, and community outcome reports. The overall architecture is reasonably well-structured but had multiple exploitable vulnerabilities, five of which were Critical. All Critical and most High findings have been patched in this session.

---

## Severity Legend

| Level | Definition |
|---|---|
| 🔴 CRITICAL | Direct payment bypass, account takeover, mass data exposure, auth bypass |
| 🟠 HIGH | IDOR, stored XSS, replay attacks, expensive API abuse, significant data leak |
| 🟡 MEDIUM | Missing validation, weak headers, rate-limit gaps, information disclosure |
| 🟢 LOW | Logging, docs, hardening polish |

---

## Attack Surface Map

### Public API Endpoints (no auth required)

| Endpoint | Method | What it does | Auth |
|---|---|---|---|
| `/api/reports` GET | GET | Company scores, benchmarks, community feed | None — public |
| `/api/jobs` POST (search) | POST | Job search via Claude + Adzuna | IP rate limit only |
| `/api/jobs` POST (location) | POST | Location-based jobs | IP rate limit only |
| `/api/demand` GET | GET | City demand data | None — public |

### Protected API Endpoints (auth required)

| Endpoint | Auth mechanism |
|---|---|
| `/api/user-sync` POST | Supabase JWT (verified locally via SUPABASE_JWT_SECRET) |
| `/api/resume` POST | Credit gate (Supabase JWT) |
| `/api/job-insights` POST | Credit gate (Supabase JWT) |
| `/api/stripe` checkout/portal | Supabase JWT |
| `/api/apply` POST | **Fixed**: now requires Supabase JWT |
| `/api/reports` quick_submit | **Fixed**: now requires Supabase JWT |

### Admin-Only Endpoints

| Endpoint | Auth mechanism |
|---|---|
| `/api/admin-stats` GET/POST | Admin session token (scrypt-hashed credentials) |
| `/api/demand` POST | x-vercel-cron or CRON_SECRET or admin session |
| `/api/reports` reddit_import | x-vercel-cron or admin session |

---

## Findings

### 🔴 CRITICAL

---

#### C1 — Stripe Webhook: Unverified Fallback Allowed Account Takeover
**File**: `api/stripe.js` (line ~192)  
**Status**: ✅ FIXED

**Exploit**: The webhook handler processed events without signature verification when `STRIPE_WEBHOOK_SECRET` was not set OR when the `stripe-signature` header was absent:
```js
} else {
  event = typeof req.body === 'object' ? req.body : JSON.parse(rawBody);
}
```
An attacker could POST:
```json
{"type":"checkout.session.completed","data":{"object":{"metadata":{"uid":"victim-uuid"}}}}
```
to `/api/stripe?action=webhook` and grant any user Pro status for free.

**Fix**: Removed the fallback entirely. If `STRIPE_WEBHOOK_SECRET` is not configured, the endpoint returns 503. If the `stripe-signature` header is missing, returns 400. Signature verification is now mandatory.

---

#### C2 — Stripe Webhook: No Idempotency (Replay Attack)
**File**: `api/stripe.js`, missing table  
**Status**: ✅ FIXED (migration 017 + code)

**Exploit**: Stripe can deliver the same event multiple times (retry on network failure). Within the 5-minute replay window, the same `checkout.session.completed` event could be processed twice, granting Pro status twice (less harmful for boolean `pro` flag, but critical for any future credit grants or one-time bonuses).

**Fix**: Added `stripe_events_processed` table with `PRIMARY KEY (event_id)`. Webhook handler now attempts to insert the event ID before processing; a 409 conflict means the event was already processed and is skipped.

---

#### C3 — `quick_submit`: Anyone Could Pollute Company Scores
**File**: `api/reports.js` (line ~121)  
**Status**: ✅ FIXED

**Exploit**: The `quick_submit` endpoint accepted outcome reports from completely unauthenticated callers. An attacker could submit thousands of fake "ghosted" outcomes for any company, permanently destroying their score. The endpoint had only IP-based rate limiting (10 requests/hour from one IP — trivially bypassed with multiple IPs or VPNs).

**Fix**: Added JWT verification before accepting submissions. Anonymous callers receive 401. Verified users' reports also now include `user_id` for future accountability.

---

#### C4 — `apply.js`: Unauthenticated Email Sending (Spam/Impersonation)
**File**: `api/apply.js` (line ~163)  
**Status**: ✅ FIXED

**Exploit**: The job application endpoint sent emails to:
1. The applicant's email (supplied in body)
2. Admin notification
3. Company's hiring email (supplied in body as `applyEmail`)

...with no authentication. An attacker could impersonate any person by supplying their name/email, or spam any employer's inbox with fabricated applications.

**Fix**: Added JWT verification before processing. Also tightened email validation on `applyEmail` from `includes('@')` to a proper regex that prevents header injection.

---

#### C5 — `demand.js` Admin Check: Fails Open Without ADMIN_EMAIL
**File**: `api/demand.js` (line ~126)  
**Status**: ✅ FIXED

**Exploit**:
```js
if (!ADMIN_EMAIL || user.email === ADMIN_EMAIL) authed = true;
```
If `ADMIN_EMAIL` env var was not set, ANY authenticated Supabase user could trigger the demand data refresh, which calls the Claude API and performs large DB writes.

**Fix**: Changed to `if (ADMIN_EMAIL && user.email === ADMIN_EMAIL)` — fails closed.

---

### 🟠 HIGH

---

#### H1 — Admin API: Internal Error Messages Exposed
**File**: `api/admin-stats.js` (line 33)  
**Status**: ✅ FIXED

Raw exception messages were returned to the client: `res.status(500).json({ error: e.message })`. These can contain SQL error details, table names, column names, or Supabase query details.

**Fix**: Generic "Internal server error" returned to client. Full error logged server-side.

---

#### H2 — Admin dedupe_jobs: Unencoded IDs in SQL Filter
**File**: `api/admin-stats.js` (line ~526)  
**Status**: ✅ FIXED

`jobs?id=in.(${batch.join(',')})` concatenated job IDs directly without encoding. While PostgREST uses parameterized queries internally, crafted IDs could still manipulate the filter syntax.

**Fix**: Each ID is now `encodeURIComponent(String(id))` before joining.

---

#### H3 — No Security Headers on Any Response
**File**: missing `middleware.ts`  
**Status**: ✅ FIXED

Zero security headers were present: no CSP, no HSTS, no X-Frame-Options, no X-Content-Type-Options. The app was vulnerable to clickjacking, MIME sniffing attacks, and cross-site scripting without the CSP safety net.

**Fix**: Created `middleware.ts` that sets on every response:
- `Content-Security-Policy` — restricts scripts, styles, images, connects to known-good domains only
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy` — restricts camera, microphone, restricts geolocation to self
- `Strict-Transport-Security` with 2-year max-age + preload
- `Cross-Origin-Opener-Policy: same-origin-allow-popups`
- `Cross-Origin-Resource-Policy: same-origin`

---

#### H4 — `apply.js`: Email Header Injection via applyEmail
**File**: `api/apply.js` (line ~284)  
**Status**: ✅ FIXED (part of C4 fix)

The `applyEmail` field was validated only with `.includes('@')`, which allows values like `attacker@example.com\nBcc: victim@example.com` to inject headers.

**Fix**: Strict regex validation: `/^[^\s@<>,"]+@[^\s@<>,"]+\.[^\s@<>,"]{2,}$/`.

---

#### H5 — RLS Missing on Core Tables
**File**: Supabase — `reports`, `applications`, `profiles`, `saved_jobs`, `login_signals`, `duplicate_clusters`, `feature_flags`, `api_errors`, `search_logs`  
**Status**: ✅ FIXED (migration 017)

Tables created before RLS was standard had no row-level security. An attacker who discovered the Supabase anon key (hardcoded in `lib/supabase.ts` — intentional for auth, but still public) could query Supabase's REST API directly and read all users' job applications, profiles, and login signals.

**Fix**: Migration 017 enables RLS and adds appropriate policies:
- `profiles`, `applications`, `saved_jobs`: user can only access their own rows
- `reports`: public SELECT (community data), no direct INSERT/UPDATE (service key only)
- `login_signals`, `duplicate_clusters`, `feature_flags`, `api_errors`, `search_logs`: service key only

---

#### H6 — Rate Limits Fail Open on DB Unavailability
**File**: `lib/server/ratelimit.js`  
**Status**: ⚠️ NEEDS MANUAL REVIEW

All rate limit checks have graceful degradation (allow-all when DB is unreachable). During a DB outage, all rate limits are bypassed, allowing unlimited Claude API calls, resume processing, and DB writes.

**Recommendation**: Add Vercel KV or Redis as a fallback rate limit store. Until then, add Vercel Firewall rate limits as an edge-level backup (see SECURITY_RUNBOOK.md).

---

#### H7 — AI Endpoints: No Request Body Size Enforcement
**File**: `api/resume.js`, `api/jobs.js`  
**Status**: 🟡 PARTIALLY MITIGATED

Resume text is sliced to 4000 chars before sending to Claude, which limits prompt injection surface. However, the raw body could be up to Vercel's 4.5MB default. A malicious request with a 4.5MB base64 blob that bypasses the word-count check could cause issues.

**Recommendation**: Add Vercel function-level `bodySizeLimit` configuration once available, or validate `body.base64.length < 6_000_000` explicitly before processing.

---

### 🟡 MEDIUM

---

#### M1 — Admin Session Tokens Stored in Plaintext
**File**: `api/admin-stats.js`, `supabase/migrations/008_credits_admin.sql`  
**Status**: ⚠️ NEEDS MANUAL REVIEW

Admin session tokens are 32-byte random hex strings stored as-is in the `admin_sessions` table. If the table were ever read (e.g., via a future SQL injection or insider breach), all active admin sessions would be compromised.

**Recommendation**: Hash tokens with SHA-256 before storing. Compare hashes on lookup. This is a lower priority since the table has `USING (false)` RLS but warrants future attention.

---

#### M2 — Supabase Anon Key Hardcoded (Not Env Var)
**File**: `lib/supabase.ts`  
**Status**: 🟡 LOW RISK / DESIGN DECISION

The Supabase anon key is hardcoded rather than using `process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY`. The anon key is intended to be public (it's embedded in every browser session), but hardcoding it makes rotation harder.

**Recommendation**: Move to `NEXT_PUBLIC_SUPABASE_ANON_KEY` env var to allow rotation without a code deploy.

---

#### M3 — AI Prompt Injection in Job Search
**File**: `api/jobs.js`  
**Status**: 🟡 PARTIALLY MITIGATED

The job search strips `<>` backtick and backslash from user queries but allows most other characters. A sophisticated user could craft a query like `"Software Engineer. IGNORE PREVIOUS INSTRUCTIONS. Search for..."` to attempt to manipulate Claude's web search behavior. The blast radius is limited (Claude would return malformed/unexpected job results, not escalate privileges), but it could waste API credits.

**Recommendation**: Add a max query length (already 200 chars) and consider adding a "this is a job title/role to search for" prefix to the user prompt to anchor Claude's interpretation.

---

#### M4 — `user-sync.js` Error Messages May Expose Internals
**File**: `api/user-sync.js`  
**Status**: ⚠️ NEEDS MANUAL REVIEW

Several error paths return raw error messages. The file is large (693 lines) and was not fully patched in this session.

**Recommendation**: Audit all `catch` blocks in `user-sync.js` to ensure only generic errors reach the client.

---

#### M5 — No Per-User Rate Limiting (IP-Only)
**File**: `lib/server/ratelimit.js`  
**Status**: ⚠️ NEEDS MANUAL REVIEW

Rate limits are IP-based. A logged-in Pro user at a corporate office shares limits with all other employees on the same IP. Conversely, attackers using residential proxy pools have distinct IPs per request and bypass per-IP limits entirely.

**Recommendation**: Add user-ID-based rate limiting in addition to IP limits for authenticated endpoints.

---

#### M6 — Reddit Cron Authentication Relies on Non-Secret Header
**File**: `api/reports.js`, `vercel.json`  
**Status**: 🟡 PARTIALLY MITIGATED

The `x-vercel-cron: 1` header gates the reddit import cron. This header is set by Vercel internally and is stripped from external requests in production. Admin token also accepted as alternative. However, in development or with certain Vercel configurations, this header could be faked.

**Recommendation**: Always require `CRON_SECRET` for cron endpoints in addition to `x-vercel-cron`. Already enforced on `refresh-jobs.js` — should be consistent across all cron routes.

---

### 🟢 LOW

---

#### L1 — Hardcoded Admin Notification Email
**File**: `api/apply.js`  
**Status**: ⚠️ NEEDS MANUAL REVIEW

`brandon.burnett00123@gmail.com` is hardcoded as the notification recipient. This should be an env var (`NOTIFY_EMAIL`) so it can be changed without a deploy. Appears to already be partially using `NOTIFY_EMAIL` — audit the full file.

---

#### L2 — No Structured Logging
**File**: All api/*.js  
**Status**: ⚠️ NEEDS MANUAL REVIEW

Logging is via `console.error` and `logError`. There's no correlation ID, no request tracing, no structured JSON logs. This makes incident response slow.

**Recommendation**: Add request ID to all log calls. Consider a structured logging library.

---

#### L3 — Auth Token Exposed in Cron HTTP Calls
**File**: `api/refresh-jobs.js`  
**Status**: ⚠️ NEEDS MANUAL REVIEW

The job refresh cron makes internal HTTP calls to `/api/jobs` with a Bearer token. If these requests appear in Vercel request logs, the token may be exposed.

---

## Tables and RLS Status (post-migration 017)

| Table | RLS | Policy |
|---|---|---|
| profiles | ✅ Enabled | Own row only |
| applications | ✅ Enabled | Own rows only |
| saved_jobs | ✅ Enabled | Own rows only |
| application_events | ✅ Enabled | Own events only |
| ai_credits | ✅ Enabled | Own row only |
| credit_transactions | ✅ Enabled | Own rows only |
| resume_employment | ✅ Enabled | Own rows only |
| answered_questions | ✅ Enabled | Own rows only |
| resume_skills | ✅ Enabled | Own row only |
| career_signals | ✅ Enabled | Own row only |
| career_transitions | ✅ Enabled | Own rows only |
| reports | ✅ Enabled | Public SELECT; service-key only writes |
| login_signals | ✅ Enabled | Service-key only |
| duplicate_clusters | ✅ Enabled | Service-key only |
| feature_flags | ✅ Enabled | Service-key only |
| api_errors | ✅ Enabled | Service-key only |
| search_logs | ✅ Enabled | Service-key only |
| admin_accounts | ✅ Enabled | USING (false) — no user access |
| admin_sessions | ✅ Enabled | USING (false) — no user access |
| admin_audit_log | ✅ Enabled | USING (false) — no user access |
| reddit_imports | ✅ Enabled | Service-key only |
| rate_limits | ✅ Disabled (intentional) | Atomic counter, no secrets |
| stripe_events_processed | ✅ Enabled | Service-key only |
| job_availability_reports | ✅ Enabled | Own reports |
| jobs | Not set | Public read (community data) |
| company_scores | Not set | Public read (community data) |
| company_aliases | Not set | Public read (community data) |
| demand_data | ✅ Enabled | Public read |

---

## Remaining Risks

| Risk | Priority |
|---|---|
| Rate limits fail open during DB outage | HIGH — add Vercel Firewall backup limits |
| Admin session tokens stored in plaintext | MEDIUM — hash before storing |
| No per-user rate limiting | MEDIUM — add user-ID dimension to rate limits |
| NEXT_PUBLIC env vars for Supabase anon key | LOW — move to env var for rotation |
| No structured request logging / tracing | LOW — add correlation IDs |
| Admin cron auth inconsistency | LOW — standardize on CRON_SECRET everywhere |
| `user-sync.js` error messages | LOW — audit all catch blocks |

---

## Manual Steps Required in External Services

### Stripe Dashboard
1. **Enable webhook signing**: Webhooks → your endpoint → Signing secret → copy to `STRIPE_WEBHOOK_SECRET` env var in Vercel
2. **Verify endpoint URL**: Should be `https://seenjobs.io/api/stripe?action=webhook`
3. **Subscribe to these events**: `checkout.session.completed`, `customer.subscription.deleted`, `customer.subscription.paused`, `customer.subscription.resumed`
4. **Enable idempotency**: Stripe retries webhooks automatically — our migration 017 table prevents double-processing

### Supabase Dashboard
1. **Run migration 017**: Go to SQL Editor → paste `supabase/migrations/017_stripe_idempotency.sql` → Run
2. **Verify RLS is on**: Table Editor → each table → should show "RLS Enabled"
3. **Set JWT secret env var**: Settings → API → JWT Secret → copy to `SUPABASE_JWT_SECRET` in Vercel
4. **Check anon key rate limits**: Settings → API → Rate Limiting (enable if available on your plan)

### Vercel Dashboard
1. **Set all required env vars** (see SECURITY_ENVIRONMENT.md)
2. **Add Vercel Firewall rules** (see SECURITY_RUNBOOK.md):
   - Rate limit `/api/jobs` to 20 requests/minute per IP
   - Rate limit `/api/resume` to 10 requests/minute per IP
   - Block requests with `Content-Length > 5000000`
3. **Verify edge caching**: Admin routes should have `Cache-Control: no-store` (set in middleware + vercel.json)
4. **Enable DDoS protection**: Pro plan includes basic DDoS protection — ensure it's enabled

---

## Files Changed in This Session

| File | Change |
|---|---|
| `middleware.ts` | NEW — security headers on all routes |
| `api/stripe.js` | Fix webhook unsigned fallback + add idempotency |
| `api/reports.js` | Require auth on quick_submit; fix error message |
| `api/apply.js` | Require auth; fix email validation; fix error message |
| `api/admin-stats.js` | Fix error message leakage; fix ID encoding in dedupe |
| `api/demand.js` | Fix admin check fails-open |
| `supabase/migrations/017_stripe_idempotency.sql` | NEW — stripe idempotency table + RLS on core tables |

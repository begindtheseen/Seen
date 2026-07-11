# Security — Testing Seen Against Itself

RLS on, auth configured, HTTPS everywhere is the *baseline*, not the finish line.
This doc is the repeatable "try to hack your own app" process for Seen, plus what
the last self-audit found. Run the three steps below before a breach forces you to.

## The three steps

### 1. Dynamic scan (OWASP ZAP) — automated, on demand
`.github/workflows/zap-dast.yml` runs an OWASP ZAP baseline scan against a target
URL you choose (Actions → "ZAP DAST" → Run workflow → enter a **staging/preview**
URL you own — never production, never a site you don't control). ZAP crawls the
app and probes for the OWASP Top 10 (injection, XSS, broken auth, missing security
headers) and files a report + issue. Triage findings, then tune rule severities in
`.zap/rules.tsv`.

Local equivalent (the "one Docker command"):
```bash
docker run --rm -t ghcr.io/zaproxy/zaproxy:stable zap-baseline.py -t https://staging.example.com
```

### 2. Authorization / IDOR testing (Burp Suite, by hand)
The scanner won't find broken *object-level* authorization — you have to try it.
Intercept your own requests and mutate identity:
- Change a `user_id` / `application_id` / `customer_id` in the body or query — can
  you read or write another user's record?
- Swap the JWT for a different user's — does the server re-derive identity from the
  token, or trust the body?
- Change a `role` claim or hit an admin endpoint with a non-admin token.

**Why this matters here specifically:** Seen's API talks to Supabase with the
`service_role` key, which **bypasses RLS entirely**. On any endpoint that uses the
service key, RLS is *not* protecting you — the handler code is the only thing
standing between an attacker and another tenant's data. The rule is absolute:

> On a service-key path, every object identifier must come from the **verified
> JWT**, never from the request body/query. If the handler reads `user_id` from
> the body and doesn't cross-check it against the token, it's a live IDOR.

The correct pattern (already used across `api/*.js`): read `Authorization: Bearer
<token>`, call Supabase **with that token** (so RLS applies) or verify it against
`/auth/v1/user`, and derive identity from the result.

### 3. Automated scanning in CI — every push, every PR
- **SAST:** `.github/workflows/codeql.yml` — CodeQL `security-and-quality` suite
  over JS/TS on every push/PR to `next-migration` + weekly. Alerts land in the
  Security tab (requires code scanning enabled; free on public repos, GHAS on
  private).
- **Secrets:** `.github/workflows/secret-scan.yml` — TruffleHog OSS on every push/PR.
  Verified hits (live, exploitable credentials) fail the job. GitGuardian is a
  drop-in SaaS alternative.
- **Dependencies:** `npm audit --audit-level=high` runs in `ci.yml` (reported, not
  blocking).

## Secret handling — the load-bearing invariant
- **Supabase `anon` key is intentionally public.** It's hardcoded in
  `lib/supabase.ts` on purpose; RLS is what protects it. Expected in the client bundle.
- **Supabase `service_role` key is server-only, forever.** It must never appear in
  client code, and **never** behind a `NEXT_PUBLIC_*` variable — Next.js inlines
  every `NEXT_PUBLIC_*` value into the browser bundle, so a `NEXT_PUBLIC` service
  key is handed to every visitor = full RLS bypass = total DB compromise. Broadcast
  live events from a server handler (`lib/server/realtime.js` `broadcastActivity()`),
  never from the browser.
- Stripe/Resend/LLM keys are server-only. `.env*` is gitignored; only `.env.example`
  is committed.

## Last self-audit — 2026-07-11

**Fixed this pass**
- **[Critical] Service-role key exposable to the browser.** `lib/hooks/
  useRealtimeConnection.ts` had a client-side `broadcast()` helper that read
  `NEXT_PUBLIC_SUPABASE_SERVICE_KEY` and sent it as `apikey`/`Authorization`.
  Any deploy that set that (plausibly-named) env var would have shipped the
  RLS-bypass service key to every visitor. The helper was dead code — the correct
  server-side broadcast (`lib/server/realtime.js`) already exists. Removed the
  helper; the hook is now subscription-only (anon key), with a comment recording
  the invariant.

**Reviewed and confirmed sound**
- **Admin auth** (`api/admin-stats.js`): salted password hashes, IP rate-limit
  (5/15 min), per-account lockout after 5 failures, random 32-byte session tokens
  with 8h expiry, audit logging. PostgREST token filters use `encodeURIComponent`
  (no filter injection).
- **Stripe webhook** (`api/stripe.js`): HMAC-SHA256 signature verified with
  `timingSafeEqual`; refuses unsigned webhooks (503).
- **No committed secrets**; `.env*` gitignored; anon key public by design.

# Seen — Launch Readiness & Security Audit

_Last updated: 2026-06-23. Source: a 12-domain adversarial audit (auth, authorization, injection,
secrets, payments, data-integrity, rate-limiting, input-validation, DB/RLS, frontend state,
privacy, reliability) plus hands-on verification of every critical finding._

## Verdict

- **Confident public launch ("nobody can poke a hole in this"): NOT YET.** Finish the 🔴 P0 list below.
- **Soft / invite-only launch to start collecting data: defensible now.** The critical
  application-layer holes (token forgery, score poisoning, data leakage, GDPR deletion) are closed.

"Would any professional approve this?" is the wrong bar — every shipped product has a backlog. The
right bar is: **no unaddressed critical/high issues, and every remaining gap is known and owned.**
This doc is that ownership.

## What's already strong (verified — do not waste time "fixing" these)

- **Authorization / multi-tenant isolation:** every user-scoped query filters by `user_id`. No IDOR found.
- **Secrets:** `service_role`, Anthropic, and Stripe keys are server-only. The anon key in the client is public *by design*.
- **Stripe:** webhook signature + 5-min replay window + idempotency table. The "forgeable `metadata.uid`" one tool flagged is a **false positive** — it's set server-side from the verified token (`stripe.js:123,126`).
- **XSS:** none — React escaping, no `dangerouslySetInnerHTML`.
- **Security headers:** full CSP + HSTS + X-Frame-Options + nosniff via `middleware.ts`.
- **RLS:** enabled with service-role/user-scoped policies as defense-in-depth (migrations 020/021).

---

## FIXED in this audit pass

| Severity | Issue | Where | PR |
|---|---|---|---|
| 🔴 Critical | `submit` report endpoint was unauthenticated + unthrottled → score poisoning | `api/reports.js` | #65 |
| 🔴 Critical | `jobs.js` recommendations trusted an **unverified** JWT → token forgery | `api/jobs.js` | #65 |
| 🔴 Critical | Score math ignored `needs_review`, so anonymous/flagged reports counted at full trust | `api/reports.js _fuseWithReports` | #65 |
| 🟠 High | `company_jobs`/`recommended`/`get_by_id` ran before rate limiting | `api/jobs.js` | #65 |
| 🟠 High | `delete_account` orphaned 10+ tables (GDPR Art.17) | `api/user-sync.js` | #65 |
| 🟠 High | Welcome-bonus re-granted on DB read failure (free-credit exploit) | `lib/server/credits.js` | #65 |
| 🟠 High | Next.js 15.3.9 → **15.5.19** (SSRF, cache-poisoning, middleware-bypass CVEs) | `package.json` | this branch |
| 🟡 Med | PostgREST filter-injection in `batch_scores` | `api/reports.js` | #65 |
| 🟡 Med | FK `ON DELETE CASCADE` migration so deletes can never orphan | `migrations/024_*` | this branch |
| 🟢 Low | Company leaderboard not CDN-cached | `api/reports.js` | #65 |

---

## REMAINING — do before a confident public launch

### 🔴 P0 (launch-blockers)
1. **Observability — you are blind.** Crons return `200` even on failure; there's no Sentry/alerting,
   only an `api_errors` table you'd have to query by hand. If checkout or the score cron dies, you
   won't know. **Fix:** make cron handlers return non-200 on hard failure (Vercel surfaces it), and
   add an error sink (Sentry, or a Slack webhook in `lib/server/errlog.js`).
2. **Smoke-test the Next.js 15.5.19 upgrade on the live preview** before relying on it — the build is
   green but a minor bump can have runtime regressions (middleware, RSC). Click through auth, tracker,
   resume tools, checkout.

### 🟠 P1 (before you scale / make noise)
3. **Credit double-spend race** — `consume_credit` and `gateAI` read-then-write isn't atomic. Two
   parallel requests can spend one credit twice. **Fix:** a `consume_credit(uid)` SQL function doing
   `UPDATE ai_credits SET balance = balance - 1 WHERE user_id = $1 AND balance > 0 RETURNING balance`,
   wired with a fallback. (Deferred here because the wiring conflicts with #65's `credits.js` edits —
   do it after #65 merges.)
4. **Sybil score-poisoning (logged-in).** Rate-limit + `needs_review` close the anonymous firehose,
   but an attacker with N accounts can still move a company's score. `login_signals` (device/IP dedup)
   is collected but never used. **Fix:** per-account submission limits + cluster down-weighting.
5. **Unmetered secondary Claude calls.** Resume parse fires 2–3 Claude calls but only the first is
   credit-gated (`api/resume.js`); Reddit/research crons are unmetered. Cost-bleed risk. **Fix:** gate
   or cap each model call.
6. **Resume file not deleted on account deletion** — `delete_account` clears DB rows but not the
   Storage bucket object (migration 022). **Fix:** delete the user's storage path too.

### 🟡 P2 (resilience / scale hardening)
7. **Rate limiter fails open + hot-row.** A Supabase blip disables all throttling, and `rate_limits`
   takes a write on every request (contention at ~10k users). Consider Vercel KV / sharded keys.
8. **Silent client data-loss.** `_sync` failures are swallowed (`lib/sync.ts`); corrupt localStorage
   silently empties views (`AppStore`, `SavedJobs`, `ResumeStore`). Add a retry queue + surfaced errors.
9. **Multi-device conflict = last-write-wins.** Can clobber edits across devices. Merge `events` by id
   and resolve status/stage by `updatedAt`.
10. **Prompt-injection hardening.** Resume/company text flows into Claude prompts; escape/structure it.
11. **Per-cron failure visibility, PITR/restore runbook, `purge_old_signals` schedule.**

---

## The "choice → cost → next step" framing (use this in interviews)

Every item above is a *known* tradeoff, which is exactly what makes it defensible:

> "I built a service-key proxy: the client sends a JWT, the server verifies it and uses the admin key
> to do scoped DB work. **The cost** is that RLS becomes defense-in-depth and correctness depends on my
> `user_id` filters — **so** I audited every one for IDOR (none found) and treat the unauth report path
> as the highest-risk surface, which I've now rate-limited and trust-weighted."

Repeat that pattern — choice, cost, mitigation — for rate limiting (fail-open for availability),
localStorage-first (anonymous capture vs. last-write-wins), and the scoring model (confidence-gated so
thin data is never shown as fact). That is what surviving a senior's grilling actually looks like.

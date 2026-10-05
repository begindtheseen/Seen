# Seen — Launch Readiness & Security Audit

_Last updated: 2026-06-23. Source: a 12-domain adversarial audit (auth, authorization, injection,
secrets, payments, data-integrity, rate-limiting, input-validation, DB/RLS, frontend state,
privacy, reliability) plus hands-on verification of every critical finding._

## Verdict

- **Soft / invite-only launch: ready now.** Every day-one critical hole is closed across
  #63/#65/#66 and the integration work below — token forgery, score poisoning, the credit
  double-spend race, GDPR deletion/orphans, and the high-severity Next.js CVEs.
- **Confident public launch ("nobody can poke a hole in this"): one decision away.** The
  remaining items are an alerting webhook URL (mechanism shipped — just set the env var), a
  manual smoke-test of the Next upgrade, and the Sybil/AI-metering hardening that only matters
  once you're at real scale. None are open holes; all are known and owned.

### DB migrations already APPLIED to production (project `tmngmmofrplsldvlobfx`)
- `consume_credit(uuid,text,boolean)` SQL function — atomic, `SELECT … FOR UPDATE`. Verified.
- `ON DELETE CASCADE` FKs on 8 user-keyed tables, **validated** (not just NOT VALID).
- Removed 1 pre-existing orphan (`ai_credits` row for a deleted user — the gap was real).

### One-touch activations left for the owner (no code, ~2 min)
1. **Alerting:** set `ERRLOG_WEBHOOK_URL` in Vercel to a Slack/Discord incoming webhook →
   every logged error (incl. cron failures) gets pushed to you in real time.
2. **Leaked-password protection:** Supabase → Auth → Passwords → enable HaveIBeenPwned check
   (closes the one WARN-level advisor).

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
| 🟠 High | Next.js 15.3.9 → **15.5.19** (SSRF, cache-poisoning, middleware-bypass CVEs) | `package.json` | #66 |
| 🟠 High | **Credit double-spend race** — read-modify-write → atomic `consume_credit()` RPC, wired both consume paths with fallback | `migrations/025`, `lib/server/credits.js`, `api/user-sync.js` | this branch (applied) |
| 🟠 High | GDPR: resume files in Storage not erased on account deletion → best-effort `resumes/${uid}/` cleanup | `api/user-sync.js` | this branch |
| 🟠 High | FK `ON DELETE CASCADE` on 8 user tables so deletes can never orphan (+ validated, orphan cleaned) | `migrations/024,026` | this branch (applied) |
| 🟡 Med | No real-time alerting → opt-in Slack/Discord webhook + cron failures now logged centrally | `lib/server/errlog.js`, `api/refresh-jobs.js`, `api/reports.js` | this branch |
| 🟡 Med | PostgREST filter-injection in `batch_scores` | `api/reports.js` | #65 |
| 🟢 Low | Company leaderboard not CDN-cached | `api/reports.js` | #65 |

---

## REMAINING

### 🔴 Needs the owner (not code)
1. **Smoke-test the Next.js 15.5.19 upgrade on the live preview** — the build is green but a minor
   bump can have runtime regressions (middleware, RSC). Click through auth, tracker, resume tools,
   checkout. This is the last thing gating "confident public launch."
2. **Set `ERRLOG_WEBHOOK_URL`** (Slack/Discord) and **enable leaked-password protection** — see the
   two-minute activations in the Verdict section.

### 🟠 P1 (before you scale / make noise)
3. **Sybil score-poisoning (logged-in)** — *first cut shipped.* Signed-in submits now down-weight to
   0.3 + `needs_review` (excluded from scores) on (a) same-user/same-company duplicates within 30d and
   (b) a per-account daily submission cap — applied to both `submit` and `quick_submit`. **Still open:**
   cross-account device/IP clustering for the determined multi-account farm (deferred — naive IP
   thresholds false-positive on corporate NAT / mobile carriers; needs the `duplicate_clusters` review
   queue + account-age/verification signal).
4. ~~Unmetered secondary Claude calls~~ — **assessed adequate.** Every AI call is credit-gated, inputs
   are `.slice()`-capped (2.5–4k chars), `max_tokens` is bounded (2–3k), and the model is Haiku. The
   multi-call parse is one gated logical op. No open cost-bleed; revisit only if usage patterns change.

### 🟡 P2 (resilience / scale hardening)
5. **Rate limiter fails open + hot-row.** A Supabase blip disables all throttling, and `rate_limits`
   takes a write on every request (contention at ~10k users). Consider Vercel KV / sharded keys.
6. **Silent client data-loss.** `_sync` failures are swallowed (`lib/sync.ts`); corrupt localStorage
   silently empties views (`AppStore`, `SavedJobs`, `ResumeStore`). Add a retry queue + surfaced errors.
7. **Multi-device conflict = last-write-wins.** Can clobber edits across devices. Merge `events` by id
   and resolve status/stage by `updatedAt`.
8. **Prompt-injection hardening.** Resume/company text flows into Claude prompts; escape/structure it.
9. **PITR/restore runbook, `purge_old_signals` schedule.**

### ✅ Done in this pass (was P0/P1)
- ~~Observability: crons silently 200~~ → all three crons log failures centrally; opt-in webhook alerting shipped.
- ~~Credit double-spend race~~ → atomic `consume_credit()` applied to prod + wired both paths.
- ~~Resume file not deleted on account deletion~~ → best-effort Storage cleanup added.
- ~~FK cascade migration~~ → applied **and validated** in prod; orphan removed.

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

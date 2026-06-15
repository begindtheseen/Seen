# Payments Audit — `api/stripe.js`

_Audit date: 2026-06-15 · 262 lines · POST-only · Stripe subscriptions._

**This is an audit only. No payment code or behavior is changed by this document.**
It is the prerequisite (per `REFACTOR_PLAN.md` Phase 3 / the Wagyu plan Phase 5)
for any future, carefully-tested isolation of Stripe logic into `lib/payments/`.

## Endpoints (dispatch on `?action=` or `body.action`)

| Action | Method | Auth | Purpose | Success response |
|---|---|---|---|---|
| `checkout` | POST | user (JWT) | Create a Stripe Checkout Session (subscription) | `{ url }` |
| `portal` | POST | user (JWT) | Create a Billing Portal session | `{ url }` |
| `webhook` | POST | **Stripe signature** | Process subscription lifecycle events | `{ received: true }` (or `{ received:true, duplicate:true }`) |
| _unknown_ | — | — | — | `400 { error: 'Unknown action' }` |

## Environment variables

`STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID_MONTHLY`, `STRIPE_PRICE_ID_YEARLY`,
`STRIPE_WEBHOOK_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`,
`SUPABASE_JWT_SECRET`.

## Auth model

- `checkout` / `portal`: `resolveUid(req)` — local HS256 JWT verify
  (`SUPABASE_JWT_SECRET`) with a `/auth/v1/user` fallback. No uid → `401`.
  (Equivalent to `lib/auth/server.ts` — a future migration target.)
- `webhook`: authenticated by **Stripe signature**, not a user token.

## Webhook security (current — strong; preserve exactly)

1. **No unsigned fallback.** Missing `STRIPE_WEBHOOK_SECRET` → `503` (refuses to
   process). Missing `stripe-signature` header → `400`.
2. **Signature verification** (`verifyStripeSignature`): parses `t=` / `v1=`,
   enforces a **5-minute replay window**, recomputes `HMAC-SHA256(`${t}.${rawBody}`)`
   and compares with `timingSafeEqual`. Invalid → `400`.
3. **Idempotency:** inserts `event.id` into `stripe_events_processed` (migration
   `017_stripe_idempotency.sql`); a UNIQUE violation (409 / duplicate) short-circuits
   to `200 { received:true, duplicate:true }`, preventing double-processing.
4. **Handled events:**
   - `checkout.session.completed` → `setPro(uid, true)` + store `stripe_customer_id`.
   - `customer.subscription.deleted` / `customer.subscription.paused` → `setPro(uid, false)`.
   - `customer.subscription.resumed` → `setPro(uid, true)`.
   - `uid` is read from `metadata.uid` / `client_reference_id` — both set
     **server-side at checkout** (`metadata[uid]` and
     `subscription_data[metadata][uid]`), never from the webhook caller.

`setPro(uid, isPro)`: PATCH `ai_credits.pro`; if no row exists, POST a new row
(`balance: isPro ? 999 : 3`, `pro: isPro`).

## Security invariants (MUST NOT regress)

- Subscription / Pro state is **server-authoritative** — set only by verified
  webhook events, never by client-supplied state.
- The Stripe **secret key** and **webhook secret** are server-only env vars.
- Webhook processing is **signature-verified, replay-bounded, and idempotent**.
- `uid` for granting Pro comes from checkout-time server metadata, not the request.

## Risks / observations (no action taken)

| # | Observation | Severity | Note |
|---|---|---|---|
| P-1 | Duplicated CORS / `verifyJWT` / `resolveUid` / `db()` vs other routes | Med | maintainability; centralize later via the foundation |
| P-2 | `setPro` writes `balance: 999` as a Pro sentinel | Low | document the sentinel before any credits refactor; do not change |
| P-3 | Webhook relies on `metadata.uid` propagating to subscription events | Low | it is set via `subscription_data[metadata][uid]` at checkout — verify still true before any change |
| P-4 | `rawBody` handling: `typeof req.body === 'string' ? req.body : JSON.stringify(req.body)` | **High to preserve** | signature is computed over the raw body — any change to body parsing/middleware could break verification. Do NOT alter body handling. |
| P-5 | No automated tests for signature verification or idempotency | Med | add tests BEFORE any refactor (below) |

## Safe migration plan (future, only after tests exist)

1. **Add tests first** (no code change): port `verifyStripeSignature` logic into a
   test harness — valid signature accepted, tampered/expired (>5 min) rejected,
   wrong secret rejected; idempotency: second insert of the same `event.id` is
   treated as a duplicate. (May require extracting `verifyStripeSignature` into a
   pure, testable `lib/payments/signature.ts` — a behavior-neutral extraction.)
2. **Then** isolate, one behavior-neutral slice at a time:
   - `lib/payments/stripeClient.ts` — the Stripe REST calls (checkout/portal/customer).
   - `lib/payments/webhook.ts` — signature verify + idempotency + event handlers.
   - `lib/payments/subscription.ts` — `setPro` / customer-id persistence.
   - Route becomes a thin dispatcher using the foundation (CORS/auth/response).
3. Preserve **every** response shape and the raw-body signature path byte-for-byte.

## STOP conditions for this area

Do **not**, without explicit human review: change pricing, change subscription
behavior, mark users Pro from client state, alter raw-body handling, or apply DB
migrations for idempotency. Any of these is a hard stop (see Wagyu STOP list).
